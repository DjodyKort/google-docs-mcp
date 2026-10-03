import * as fs from 'fs/promises';
import { loadClientSecrets } from './auth.js';
import {
  type AuthMeta,
  type AuthState,
  getProfileName,
  getTokenPath,
  readAuthMeta,
  updateAuthMeta,
} from './authMeta.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10_000;

export interface AuthStatus {
  profile: string;
  state: AuthState;
  reason: string;
  checkedAt: string;
  tokenFile: string;
  expiresAt?: string;
}

export type ProbeMode = 'never' | 'auto' | 'force';

export interface StatusOptions {
  probe?: ProbeMode;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function exitCodeForState(state: AuthState): number {
  switch (state) {
    case 'ok':
    case 'expiring':
      return 0;
    case 'needs_reauth':
    case 'revoked':
      return 10;
    case 'misconfigured':
      return 11;
    default:
      return 12;
  }
}

const MISCONFIGURED_ERRORS = new Set(['invalid_client', 'deleted_client', 'unauthorized_client']);

export function classifyOAuthError(
  error: string,
  description?: string
): { state: AuthState; reason: string } {
  if (error === 'invalid_grant') {
    const revoked = /revoked/i.test(description ?? '') && !/expired/i.test(description ?? '');
    return { state: revoked ? 'revoked' : 'needs_reauth', reason: 'invalid_grant' };
  }
  if (MISCONFIGURED_ERRORS.has(error)) return { state: 'misconfigured', reason: error };
  return { state: 'unknown', reason: `oauth_error:${error.slice(0, 64)}` };
}

type TokenFile = { refresh_token?: string; access_token?: string; expiry_date?: number };

async function readTokenFile(): Promise<
  { token: TokenFile; mtimeMs: number } | { problem: string }
> {
  const file = getTokenPath();
  let raw: string;
  let mtimeMs: number;
  try {
    raw = await fs.readFile(file, 'utf8');
    mtimeMs = (await fs.stat(file)).mtimeMs;
  } catch (err: any) {
    return { problem: err?.code === 'ENOENT' ? 'no_token_file' : 'token_file_unreadable' };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const token: TokenFile = {};
    if (typeof parsed.refresh_token === 'string' && parsed.refresh_token)
      token.refresh_token = parsed.refresh_token;
    if (typeof parsed.access_token === 'string' && parsed.access_token)
      token.access_token = parsed.access_token;
    if (typeof parsed.expiry_date === 'number') token.expiry_date = parsed.expiry_date;
    if (!token.refresh_token && !token.access_token) return { problem: 'token_file_invalid' };
    return { token, mtimeMs };
  } catch {
    return { problem: 'token_file_invalid' };
  }
}

type ProbeResult = { state: AuthState; reason: string; expiresAt?: string };

async function probeRefreshToken(
  refreshToken: string,
  client: { client_id: string; client_secret: string },
  fetchImpl: typeof fetch,
  now: number
): Promise<ProbeResult> {
  let body: any;
  try {
    const res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.client_id,
        client_secret: client.client_secret,
      }).toString(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    body = await res.json().catch(() => null);
  } catch (err: any) {
    const code = typeof err?.cause?.code === 'string' ? err.cause.code : err?.name;
    return { state: 'unknown', reason: `unreachable:${String(code ?? 'error').slice(0, 64)}` };
  }
  if (body && typeof body.error === 'string') {
    return classifyOAuthError(
      body.error,
      typeof body.error_description === 'string' ? body.error_description : undefined
    );
  }
  if (body && typeof body.access_token === 'string') {
    const ttl = Number(body.refresh_token_expires_in);
    if (Number.isFinite(ttl) && ttl > 0) {
      const expiresAt = new Date(now + ttl * 1000).toISOString();
      if (ttl * 1000 < EXPIRING_WINDOW_MS) {
        return { state: 'expiring', reason: 'refresh_token_expires_soon', expiresAt };
      }
      return { state: 'ok', reason: 'refresh_ok', expiresAt };
    }
    return { state: 'ok', reason: 'refresh_ok' };
  }
  return { state: 'unknown', reason: 'unexpected_token_response' };
}

function fromMeta(meta: AuthMeta): ProbeResult | null {
  if (!meta.lastProbeState) return null;
  return {
    state: meta.lastProbeState,
    reason: meta.lastProbeReason ?? 'cached_probe',
    expiresAt: meta.lastProbeExpiresAt,
  };
}

export async function computeAuthStatus(options: StatusOptions = {}): Promise<AuthStatus> {
  const mode = options.probe ?? 'auto';
  const nowMs = (options.now ?? Date.now)();
  const profile = getProfileName();
  const tokenFile = getTokenPath();
  const make = (r: ProbeResult, checkedAtMs = nowMs): AuthStatus => ({
    profile,
    state: r.state,
    reason: r.reason,
    checkedAt: new Date(checkedAtMs).toISOString(),
    tokenFile,
    ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
  });

  if (process.env.SERVICE_ACCOUNT_PATH) {
    return make({ state: 'ok', reason: 'service_account_not_probed' });
  }

  const read = await readTokenFile();
  if ('problem' in read) return make({ state: 'needs_reauth', reason: read.problem });

  const { token, mtimeMs } = read;
  const meta = await readAuthMeta();
  const lastProbeMs = meta.lastProbeAt ? Date.parse(meta.lastProbeAt) : NaN;
  const cachedUsable =
    Number.isFinite(lastProbeMs) &&
    nowMs - lastProbeMs < PROBE_INTERVAL_MS &&
    nowMs >= lastProbeMs &&
    mtimeMs <= lastProbeMs;
  const cached = cachedUsable ? fromMeta(meta) : null;

  if (mode !== 'force' && cached) return make(cached, lastProbeMs);

  if (mode === 'never') {
    if (!token.refresh_token) return make(withoutRefreshToken(token, nowMs));
    return make({ state: 'unknown', reason: 'not_probed' });
  }

  if (!token.refresh_token) return make(withoutRefreshToken(token, nowMs));

  let client: { client_id: string; client_secret: string };
  try {
    client = await loadClientSecrets();
  } catch (err: any) {
    return make({ state: 'misconfigured', reason: 'client_credentials_unavailable' });
  }

  const result = await probeRefreshToken(
    token.refresh_token,
    client,
    options.fetchImpl ?? fetch,
    nowMs
  );
  const iso = new Date(nowMs).toISOString();
  const patch: Partial<AuthMeta> = {
    lastProbeAt: iso,
    lastProbeState: result.state,
    lastProbeReason: result.reason,
    lastProbeExpiresAt: result.expiresAt,
  };
  if (result.state === 'ok' || result.state === 'expiring') {
    patch.lastSuccessAt = iso;
  } else if (result.state !== 'unknown') {
    patch.lastFailureAt = iso;
    patch.lastFailureState = result.state;
    patch.lastFailureReason = result.reason;
  }
  await updateAuthMeta(patch);
  return make(result);
}

function withoutRefreshToken(token: TokenFile, nowMs: number): ProbeResult {
  if (token.expiry_date && token.expiry_date > nowMs) {
    return {
      state: 'expiring',
      reason: 'access_token_only',
      expiresAt: new Date(token.expiry_date).toISOString(),
    };
  }
  return { state: 'needs_reauth', reason: 'no_refresh_token' };
}

export async function runAuthStatusCli(argv: string[]): Promise<number> {
  const status = await computeAuthStatus({ probe: argv.includes('--force') ? 'force' : 'auto' });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(status)}\n`);
  } else {
    process.stdout.write(`${status.profile}: ${status.state} (${status.reason})\n`);
  }
  return exitCodeForState(status.state);
}
