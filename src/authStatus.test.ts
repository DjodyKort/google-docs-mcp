import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  PROBE_INTERVAL_MS,
  classifyOAuthError,
  computeAuthStatus,
  exitCodeForState,
  runAuthStatusCli,
} from './authStatus.js';

const REFRESH = 'SENTINEL-REFRESH-TOKEN';
const SECRET = 'SENTINEL-CLIENT-SECRET';
const ACCESS = 'SENTINEL-ACCESS-TOKEN';

let dir: string;
let profileDir: string;
const saved = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function fetchReturning(body: unknown, status = 400) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(body, status));
}

async function writeToken(token: Record<string, unknown> = { refresh_token: REFRESH }) {
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(path.join(profileDir, 'token.json'), JSON.stringify(token));
}

async function readMeta() {
  return JSON.parse(await fs.readFile(path.join(profileDir, 'auth-meta.json'), 'utf8'));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-auth-'));
  process.env.XDG_CONFIG_HOME = dir;
  process.env.GOOGLE_MCP_PROFILE = 'work';
  process.env.GOOGLE_CLIENT_ID = 'client-id.apps.example';
  process.env.GOOGLE_CLIENT_SECRET = SECRET;
  delete process.env.SERVICE_ACCOUNT_PATH;
  profileDir = path.join(dir, 'google-docs-mcp', 'work');
});

afterEach(async () => {
  process.env = { ...saved };
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('classifyOAuthError', () => {
  it('maps invalid_grant to needs_reauth or revoked by description', () => {
    expect(classifyOAuthError('invalid_grant', 'Token has been expired or revoked.').state).toBe(
      'needs_reauth'
    );
    expect(classifyOAuthError('invalid_grant', 'Token has been revoked.').state).toBe('revoked');
    expect(classifyOAuthError('invalid_grant').reason).toBe('invalid_grant');
  });

  it.each(['invalid_client', 'deleted_client', 'unauthorized_client'])(
    'maps %s to misconfigured',
    (code) => {
      expect(classifyOAuthError(code)).toEqual({ state: 'misconfigured', reason: code });
    }
  );

  it('maps anything else to unknown', () => {
    expect(classifyOAuthError('temporarily_unavailable').state).toBe('unknown');
  });
});

describe('exitCodeForState', () => {
  it.each([
    ['ok', 0],
    ['expiring', 0],
    ['needs_reauth', 10],
    ['revoked', 10],
    ['misconfigured', 11],
    ['unknown', 12],
  ] as const)('%s -> %i', (state, code) => {
    expect(exitCodeForState(state)).toBe(code);
  });
});

describe('computeAuthStatus', () => {
  it('reports needs_reauth when the token file is missing, without any network call', async () => {
    const fetchImpl = fetchReturning({});
    const status = await computeAuthStatus({ fetchImpl });
    expect(status).toMatchObject({
      profile: 'work',
      state: 'needs_reauth',
      reason: 'no_token_file',
      tokenFile: path.join(profileDir, 'token.json'),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports needs_reauth for a corrupt token file', async () => {
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, 'token.json'), '{nope');
    expect((await computeAuthStatus({ fetchImpl: fetchReturning({}) })).reason).toBe(
      'token_file_invalid'
    );
  });

  it('reports ok after a successful refresh exchange and records the sidecar', async () => {
    await writeToken();
    const fetchImpl = fetchReturning({ access_token: ACCESS, expires_in: 3599 }, 200);
    const status = await computeAuthStatus({ fetchImpl, now: () => 1_000_000 });
    expect(status.state).toBe('ok');
    expect(status.reason).toBe('refresh_ok');
    expect(status.checkedAt).toBe(new Date(1_000_000).toISOString());
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String((init as RequestInit).body)).toContain('grant_type=refresh_token');
    const meta = await readMeta();
    expect(meta.lastSuccessAt).toBe(new Date(1_000_000).toISOString());
    expect(meta.lastProbeState).toBe('ok');
    expect((await fs.stat(path.join(profileDir, 'auth-meta.json'))).mode & 0o777).toBe(0o600);
  });

  it('reports expiring when the refresh token has a short remaining lifetime', async () => {
    await writeToken();
    const status = await computeAuthStatus({
      fetchImpl: fetchReturning({ access_token: ACCESS, refresh_token_expires_in: 86400 }, 200),
      now: () => 0,
    });
    expect(status.state).toBe('expiring');
    expect(status.expiresAt).toBe(new Date(86400 * 1000).toISOString());
  });

  it('classifies invalid_grant by the OAuth error field, not the HTTP status', async () => {
    await writeToken();
    const status = await computeAuthStatus({
      fetchImpl: fetchReturning(
        { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
        200
      ),
    });
    expect(status.state).toBe('needs_reauth');
    expect(status.reason).toBe('invalid_grant');
    const meta = await readMeta();
    expect(meta.lastFailureReason).toBe('invalid_grant');
  });

  it('reports revoked when Google says the token was revoked', async () => {
    await writeToken();
    const status = await computeAuthStatus({
      fetchImpl: fetchReturning({
        error: 'invalid_grant',
        error_description: 'Token has been revoked.',
      }),
    });
    expect(status.state).toBe('revoked');
  });

  it('reports misconfigured for invalid_client even on a 401', async () => {
    await writeToken();
    const status = await computeAuthStatus({
      fetchImpl: fetchReturning({ error: 'invalid_client' }, 401),
    });
    expect(status).toMatchObject({ state: 'misconfigured', reason: 'invalid_client' });
  });

  it('reports misconfigured when no OAuth client credentials are available', async () => {
    await writeToken();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const fetchImpl = fetchReturning({});
    const status = await computeAuthStatus({ fetchImpl });
    expect(status.state).toBe('misconfigured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports unknown when the endpoint is unreachable', async () => {
    await writeToken();
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    });
    const status = await computeAuthStatus({ fetchImpl });
    expect(status).toMatchObject({ state: 'unknown', reason: 'unreachable:ENOTFOUND' });
    expect((await readMeta()).lastFailureAt).toBeUndefined();
  });

  it('reports unknown for a malformed token response', async () => {
    await writeToken();
    const status = await computeAuthStatus({ fetchImpl: fetchReturning({ hello: 1 }, 200) });
    expect(status.state).toBe('unknown');
  });

  it('probes at most once per 6 hours unless forced', async () => {
    await writeToken();
    const fetchImpl = fetchReturning({ access_token: ACCESS }, 200);
    const t0 = Date.now() + 1000;
    await computeAuthStatus({ fetchImpl, now: () => t0 });
    const cached = await computeAuthStatus({ fetchImpl, now: () => t0 + PROBE_INTERVAL_MS - 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.state).toBe('ok');
    expect(cached.checkedAt).toBe(new Date(t0).toISOString());

    await computeAuthStatus({ fetchImpl, now: () => t0 + PROBE_INTERVAL_MS + 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await computeAuthStatus({ fetchImpl, now: () => t0 + PROBE_INTERVAL_MS + 2, probe: 'force' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('re-probes when token.json changed after the last probe', async () => {
    await writeToken();
    const fetchImpl = fetchReturning({ error: 'invalid_grant' });
    const t0 = Date.now();
    await computeAuthStatus({ fetchImpl, now: () => t0 });
    const future = new Date(t0 + 5000);
    await fs.utimes(path.join(profileDir, 'token.json'), future, future);
    await computeAuthStatus({ fetchImpl, now: () => t0 + 10_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('makes no network call with probe never and reports not_probed', async () => {
    await writeToken();
    const fetchImpl = fetchReturning({});
    const status = await computeAuthStatus({ fetchImpl, probe: 'never' });
    expect(status).toMatchObject({ state: 'unknown', reason: 'not_probed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serves the cached probe result with probe never', async () => {
    await writeToken();
    const t0 = Date.now() + 1000;
    await computeAuthStatus({
      fetchImpl: fetchReturning({ error: 'invalid_grant' }),
      now: () => t0,
    });
    const fetchImpl = fetchReturning({});
    const status = await computeAuthStatus({ fetchImpl, probe: 'never', now: () => t0 + 60_000 });
    expect(status.state).toBe('needs_reauth');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('handles an access-token-only file without probing', async () => {
    await writeToken({ access_token: ACCESS, expiry_date: Date.now() - 1000 });
    const fetchImpl = fetchReturning({});
    const status = await computeAuthStatus({ fetchImpl });
    expect(status).toMatchObject({ state: 'needs_reauth', reason: 'no_refresh_token' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never leaks tokens or secrets into the status or the sidecar', async () => {
    await writeToken({ refresh_token: REFRESH, access_token: ACCESS });
    const outputs: string[] = [];
    for (const body of [
      { access_token: ACCESS, refresh_token: 'NEW-SENTINEL', expires_in: 3600 },
      { error: 'invalid_grant', error_description: `bad ${REFRESH}` },
      { error: 'invalid_client' },
    ]) {
      const status = await computeAuthStatus({
        fetchImpl: fetchReturning(body, 200),
        probe: 'force',
      });
      outputs.push(JSON.stringify(status));
      outputs.push(await fs.readFile(path.join(profileDir, 'auth-meta.json'), 'utf8'));
    }
    const joined = outputs.join('\n');
    for (const secret of [REFRESH, ACCESS, SECRET, 'NEW-SENTINEL']) {
      expect(joined).not.toContain(secret);
    }
  });
});

describe('runAuthStatusCli', () => {
  async function run(args: string[]) {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const code = await runAuthStatusCli(args);
    return { code, out: writes.join('') };
  }

  it('prints a single JSON object and exits 10 when re-auth is needed', async () => {
    const { code, out } = await run(['--status', '--json']);
    expect(code).toBe(10);
    expect(out.trim().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed).sort()).toEqual(
      ['checkedAt', 'profile', 'reason', 'state', 'tokenFile'].sort()
    );
    expect(parsed.state).toBe('needs_reauth');
  });

  it('exits 0 for a healthy token (network mocked through global fetch)', async () => {
    await writeToken();
    vi.stubGlobal('fetch', fetchReturning({ access_token: ACCESS, expires_in: 3600 }, 200));
    const { code, out } = await run(['--status', '--json']);
    vi.unstubAllGlobals();
    expect(code).toBe(0);
    expect(JSON.parse(out).state).toBe('ok');
    expect(out).not.toContain(ACCESS);
    expect(out).not.toContain(REFRESH);
  });

  it.each([
    [{ error: 'invalid_client' }, 11],
    [{ error: 'invalid_grant' }, 10],
    [{ error: 'temporarily_unavailable' }, 12],
  ])('exits with the mapped code for %j', async (body, expected) => {
    await writeToken();
    vi.stubGlobal('fetch', fetchReturning(body, 400));
    const { code } = await run(['--status', '--json', '--force']);
    vi.unstubAllGlobals();
    expect(code).toBe(expected);
  });
});
