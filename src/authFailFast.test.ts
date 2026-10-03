import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { UserError } from 'fastmcp';
import { authorize } from './auth.js';
import { AuthRequiredError, needsReauthMessage } from './authMeta.js';

const saved = { ...process.env };
let dir: string;
let profileDir: string;

async function writeToken(refresh: string) {
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(profileDir, 'token.json'),
    JSON.stringify({ refresh_token: refresh })
  );
}

const invalidGrant = () =>
  Object.assign(new Error('invalid_grant'), {
    response: {
      data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
    },
  });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-ff-'));
  process.env.XDG_CONFIG_HOME = dir;
  process.env.GOOGLE_MCP_PROFILE = 'work';
  process.env.GOOGLE_CLIENT_ID = 'client-id.apps.example';
  process.env.GOOGLE_CLIENT_SECRET = 'SENTINEL-CLIENT-SECRET';
  delete process.env.SERVICE_ACCOUNT_PATH;
  profileDir = path.join(dir, 'google-docs-mcp', 'work');
});

afterEach(async () => {
  process.env = { ...saved };
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('fail fast without a token', () => {
  it('rejects immediately instead of starting an interactive login', async () => {
    const err = await authorize().catch((e) => e);
    expect(err).toBeInstanceOf(AuthRequiredError);
    expect(err.message.startsWith('[MCP_AUTH:needs_reauth profile=work]')).toBe(true);
    expect(err.message).toContain('GOOGLE_MCP_PROFILE=work npx @a-bonus/google-docs-mcp auth');
  });

  it('writes the sidecar', async () => {
    await authorize().catch(() => undefined);
    const meta = JSON.parse(await fs.readFile(path.join(profileDir, 'auth-meta.json'), 'utf8'));
    expect(meta.lastFailureState).toBe('needs_reauth');
    expect(meta.lastFailureReason).toBe('no_token_file');
  });

  it('omits the profile env for the default profile', () => {
    delete process.env.GOOGLE_MCP_PROFILE;
    const message = needsReauthMessage();
    expect(message.startsWith('[MCP_AUTH:needs_reauth profile=default]')).toBe(true);
    expect(message).toContain('run: npx @a-bonus/google-docs-mcp auth');
  });

  it('surfaces as a UserError from the client helpers', async () => {
    vi.resetModules();
    const { getDocsClient } = await import('./clients.js');
    const err = await getDocsClient().catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(String(err.message).startsWith('[MCP_AUTH:needs_reauth profile=work]')).toBe(true);
  });
});

describe('invalid_grant recovery', () => {
  async function setup(first: string) {
    await writeToken(first);
    const client = (await authorize()) as any;
    const request = vi.fn();
    client.transporter = { request };
    return { client, request };
  }

  const ok = { data: { access_token: 'NEW-ACCESS', expires_in: 3600 } };

  it('re-reads token.json once and retries with the new refresh token', async () => {
    const { client, request } = await setup('OLD-REFRESH');
    await writeToken('NEW-REFRESH');
    request.mockRejectedValueOnce(invalidGrant()).mockResolvedValueOnce(ok);

    const { token } = await client.getAccessToken();
    expect(token).toBe('NEW-ACCESS');
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0].data)).toContain('OLD-REFRESH');
    expect(String(request.mock.calls[1][0].data)).toContain('NEW-REFRESH');
    const meta = JSON.parse(await fs.readFile(path.join(profileDir, 'auth-meta.json'), 'utf8'));
    expect(meta.lastSuccessAt).toBeTruthy();
  });

  it('surfaces the root cause when the disk token is unchanged', async () => {
    const { client, request } = await setup('OLD-REFRESH');
    request.mockRejectedValue(invalidGrant());

    const err = await client.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toContain('[MCP_AUTH:needs_reauth profile=work]');
    expect((err as Error).message).toContain('invalid_grant: Token has been expired or revoked.');
    expect((err as Error).message).not.toContain('OLD-REFRESH');
    expect(request).toHaveBeenCalledTimes(1);
    const meta = JSON.parse(await fs.readFile(path.join(profileDir, 'auth-meta.json'), 'utf8'));
    expect(meta.lastFailureReason).toBe('invalid_grant');
  });

  it('retries only once when the new token is also rejected', async () => {
    const { client, request } = await setup('OLD-REFRESH');
    await writeToken('NEW-REFRESH');
    request.mockRejectedValue(invalidGrant());

    const err = await client.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not intercept other refresh errors', async () => {
    const { client, request } = await setup('OLD-REFRESH');
    await writeToken('NEW-REFRESH');
    const boom = new Error('network down');
    request.mockRejectedValue(boom);

    await expect(client.getAccessToken()).rejects.toBe(boom);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
