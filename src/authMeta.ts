import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || path.join(os.homedir(), '.config');
  const baseDir = path.join(base, 'google-docs-mcp');
  const profile = process.env.GOOGLE_MCP_PROFILE;
  if (profile && !/^[\w-]+$/.test(profile)) {
    throw new Error(
      'GOOGLE_MCP_PROFILE must contain only alphanumeric characters, hyphens, or underscores.'
    );
  }
  return profile ? path.join(baseDir, profile) : baseDir;
}

export function getTokenPath(): string {
  return path.join(getConfigDir(), 'token.json');
}

export function getMetaPath(): string {
  return path.join(getConfigDir(), 'auth-meta.json');
}

export function getProfileName(): string {
  return process.env.GOOGLE_MCP_PROFILE || 'default';
}

export type AuthState =
  | 'ok'
  | 'expiring'
  | 'needs_reauth'
  | 'revoked'
  | 'misconfigured'
  | 'unknown';

export interface AuthMeta {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureState?: AuthState;
  lastFailureReason?: string;
  lastProbeAt?: string;
  lastProbeState?: AuthState;
  lastProbeReason?: string;
  lastProbeExpiresAt?: string;
}

export async function readAuthMeta(): Promise<AuthMeta> {
  try {
    const parsed = JSON.parse(await fs.readFile(getMetaPath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Best effort: a read-only config dir must never break a tool call.
export async function updateAuthMeta(patch: Partial<AuthMeta>): Promise<void> {
  try {
    const dir = getConfigDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const next = { ...(await readAuthMeta()), ...patch };
    const target = getMetaPath();
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(tmp, target);
  } catch {
    // ignored on purpose
  }
}

export function reauthCommand(): string {
  const profile = process.env.GOOGLE_MCP_PROFILE;
  const env = profile ? `GOOGLE_MCP_PROFILE=${profile} ` : '';
  return `${env}npx @a-bonus/google-docs-mcp auth`;
}

export function needsReauthMessage(detail?: string): string {
  const base =
    `[MCP_AUTH:needs_reauth profile=${getProfileName()}] ` +
    `Google authorization is missing or no longer valid. Do not retry this tool; ask the user to run: ${reauthCommand()}`;
  return detail ? `${base} (${detail})` : base;
}

export class AuthRequiredError extends Error {
  constructor(detail?: string) {
    super(needsReauthMessage(detail));
    this.name = 'AuthRequiredError';
  }
}
