// src/auth.ts
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { JWT } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';
import { UserError } from 'fastmcp';
import { fileURLToPath } from 'url';
import * as crypto from 'crypto';
import { logger } from './logger.js';
import {
  AuthRequiredError,
  getConfigDir,
  getTokenPath,
  needsReauthMessage,
  updateAuthMeta,
} from './authMeta.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..');

/** Credentials file path (legacy dev workflow fallback). */
const CREDENTIALS_PATH = path.join(projectRootDir, 'credentials.json');

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
];

const TOKEN_CREDENTIAL_FIELDS = ['access_token', 'refresh_token', 'scope', 'token_type'] as const;

export function sanitizeStoredTokenCredentials(
  rawCredentials: unknown
): OAuth2Client['credentials'] {
  if (!rawCredentials || typeof rawCredentials !== 'object' || Array.isArray(rawCredentials)) {
    throw new Error('Invalid saved token format.');
  }

  const raw = rawCredentials as Record<string, unknown>;
  const credentials: Record<string, string | number> = {};

  for (const field of TOKEN_CREDENTIAL_FIELDS) {
    const value = raw[field];
    if (typeof value === 'string' && value.length > 0) {
      credentials[field] = value;
    }
  }

  if (typeof raw.expiry_date === 'number') {
    credentials.expiry_date = raw.expiry_date;
  }

  if (!credentials.refresh_token && !credentials.access_token) {
    throw new Error('Saved token does not contain OAuth token credentials.');
  }

  return credentials as OAuth2Client['credentials'];
}

export function createStoredTokenPayload(
  credentials: OAuth2Client['credentials']
): OAuth2Client['credentials'] {
  return sanitizeStoredTokenCredentials({
    refresh_token: credentials.refresh_token,
  });
}

// ---------------------------------------------------------------------------
// Client secrets resolution
// ---------------------------------------------------------------------------

export function describeMissingCredentials(
  credentialsPath: string,
  envId?: string,
  envSecret?: string
): string {
  // A half-configured environment is the most confusing case: the user believes
  // they configured the server, so "no credentials found" reads as a bug.
  if (envId && !envSecret) {
    return (
      'GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is not, so OAuth cannot start. ' +
      'Set GOOGLE_CLIENT_SECRET as well, or remove GOOGLE_CLIENT_ID and place a ' +
      `credentials.json file at ${credentialsPath} instead.`
    );
  }
  if (!envId && envSecret) {
    return (
      'GOOGLE_CLIENT_SECRET is set but GOOGLE_CLIENT_ID is not, so OAuth cannot start. ' +
      'Set GOOGLE_CLIENT_ID as well, or remove GOOGLE_CLIENT_SECRET and place a ' +
      `credentials.json file at ${credentialsPath} instead.`
    );
  }
  return (
    'No OAuth credentials found. Either set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, ' +
    `or download your OAuth client JSON from the Google Cloud Console and save it as ${credentialsPath}. ` +
    'Then run `npx @a-bonus/google-docs-mcp auth` to authorize.'
  );
}

type CredentialSource = {
  client_id: string;
  client_secret: string;
  origin: 'credentials.json' | 'env';
};

// Google client IDs share a `<project>-` prefix; show 6 chars after the dash so two
// IDs from the same project actually look different in logs.
const shortId = (id: string) => {
  const dash = id.indexOf('-');
  if (dash < 0) return `${id.slice(0, 12)}…`;
  return `${id.slice(0, dash + 7)}…`;
};

async function readCredentialsJson(): Promise<CredentialSource | null> {
  let content: string;
  try {
    content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    if (err.code === 'EACCES') {
      throw new Error(
        `credentials.json exists at ${CREDENTIALS_PATH} but is not readable (EACCES). ` +
          'Fix its permissions, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET instead.'
      );
    }
    throw err;
  }

  let keys: any;
  try {
    keys = JSON.parse(content);
  } catch {
    throw new Error(
      `${CREDENTIALS_PATH} is not valid JSON. Re-download the OAuth client JSON from the ` +
        'Google Cloud Console (APIs & Services -> Credentials -> your OAuth client -> Download JSON) ' +
        'and save it unmodified.'
    );
  }

  return { ...extractClientSecrets(keys, CREDENTIALS_PATH), origin: 'credentials.json' };
}

/**
 * Validates the shape of a parsed credentials.json and returns the OAuth client
 * pair, or throws an error that says what is wrong with the file.
 *
 * Kept separate from the filesystem so every branch is testable, and because the
 * shape errors are what users actually hit: issue #57 reported the failure
 * surfacing as "Cannot destructure property 'client_secret' of
 * 'credentials.installed' as it is undefined", which names no file and suggests
 * no fix.
 */
export function extractClientSecrets(
  keys: any,
  credentialsPath: string
): { client_id: string; client_secret: string } {
  const key = keys?.installed || keys?.web;
  if (!key) {
    // Usually a service-account key or an API key rather than an OAuth client.
    const shape =
      Object.keys(keys ?? {})
        .slice(0, 5)
        .join(', ') || 'no top-level keys';
    throw new Error(
      `${credentialsPath} has no "installed" or "web" section, so it is not an OAuth client ` +
        `file (found: ${shape}). Download an OAuth 2.0 Client ID of type "Desktop app" or ` +
        '"Web application" from the Google Cloud Console; a service-account key will not work.'
    );
  }

  const missing = ['client_id', 'client_secret'].filter((field) => !key[field]);
  if (missing.length > 0) {
    throw new Error(
      `${credentialsPath} is missing ${missing.join(' and ')} inside its ` +
        `"${keys.installed ? 'installed' : 'web'}" section. Re-download the OAuth client JSON ` +
        'from the Google Cloud Console and save it unmodified.'
    );
  }

  return { client_id: key.client_id, client_secret: key.client_secret };
}

function readEnvCredentials(): CredentialSource | null {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { client_id: id, client_secret: secret, origin: 'env' };
}

async function readSavedTokenClientId(): Promise<string | null> {
  try {
    const content = await fs.readFile(getTokenPath(), 'utf8');
    const parsed = JSON.parse(content);
    return parsed?.client_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves the OAuth client to use.
 *
 * Resolution rules (in order):
 *   1. If a saved token exists, pick the credential source whose `client_id`
 *      matches the token. This auto-recovers when env vars and credentials.json
 *      disagree but only one of them matches the token actually on disk.
 *   2. If no saved token exists, prefer `credentials.json` over env vars.
 *      Local dev usually has both; the file is the more deliberate source.
 *   3. If credential sources disagree, log a warning so stale env vars or
 *      stale credentials.json files surface immediately instead of silently
 *      forcing re-auth.
 *
 * Throws a clear actionable error when nothing matches the saved token,
 * rather than silently dropping the token and blocking on an interactive flow.
 */
export async function loadClientSecrets(): Promise<CredentialSource> {
  const envSource = readEnvCredentials();
  let fileSource: CredentialSource | null = null;
  try {
    fileSource = await readCredentialsJson();
  } catch (fileError: any) {
    // A broken credentials.json must not block startup when env vars can stand in.
    if (!envSource) throw fileError;
    logger.warn(`Ignoring credentials.json: ${fileError?.message || fileError}`);
  }

  const sources: CredentialSource[] = [];
  if (fileSource) sources.push(fileSource);
  if (envSource) sources.push(envSource);

  if (sources.length === 0) {
    throw new Error(
      describeMissingCredentials(
        CREDENTIALS_PATH,
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      )
    );
  }

  if (fileSource && envSource && fileSource.client_id !== envSource.client_id) {
    logger.warn(
      `Conflicting OAuth client IDs: credentials.json=${shortId(fileSource.client_id)} ` +
        `vs env=${shortId(envSource.client_id)}. credentials.json takes priority unless a ` +
        `saved token forces otherwise.`
    );
  }

  const tokenClientId = await readSavedTokenClientId();
  if (tokenClientId) {
    const match = sources.find((s) => s.client_id === tokenClientId);
    if (match) {
      logger.info(`Using OAuth client from ${match.origin} (matches saved token).`);
      return match;
    }
    throw new Error(
      `Saved token at ${getTokenPath()} is bound to client ${shortId(tokenClientId)} ` +
        `but no available credential source provides it. ` +
        `Available sources: ${sources.map((s) => `${s.origin}=${shortId(s.client_id)}`).join(', ')}. ` +
        `Either re-run "npm run auth" with the credentials you actually want to use, or ` +
        `align credentials.json / env vars with the saved token (then restart). ` +
        `To wipe and start fresh: delete ${getTokenPath()}.`
    );
  }

  const chosen = sources[0];
  logger.info(`Using OAuth client from ${chosen.origin} (no saved token yet).`);
  return chosen;
}

// ---------------------------------------------------------------------------
// Service account auth (unchanged)
// ---------------------------------------------------------------------------

async function authorizeWithServiceAccount(): Promise<JWT> {
  const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH!;
  const impersonateUser = process.env.GOOGLE_IMPERSONATE_USER;
  try {
    const keyFileContent = await fs.readFile(serviceAccountPath, 'utf8');
    const serviceAccountKey = JSON.parse(keyFileContent);

    const auth = new JWT({
      email: serviceAccountKey.client_email,
      key: serviceAccountKey.private_key,
      scopes: SCOPES,
      subject: impersonateUser,
    });
    await auth.authorize();
    if (impersonateUser) {
      logger.info(`Service Account authentication successful, impersonating: ${impersonateUser}`);
    } else {
      logger.info('Service Account authentication successful!');
    }
    return auth;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.error(`FATAL: Service account key file not found at path: ${serviceAccountPath}`);
      throw new Error(
        'Service account key file not found. Please check the path in SERVICE_ACCOUNT_PATH.'
      );
    }
    logger.error('FATAL: Error loading or authorizing the service account key:', error.message);
    throw new Error(
      'Failed to authorize using the service account. Ensure the key file is valid and the path is correct.'
    );
  }
}

// ---------------------------------------------------------------------------
// Token persistence (XDG path)
// ---------------------------------------------------------------------------

function isInvalidGrant(err: any): boolean {
  return err?.response?.data?.error === 'invalid_grant' || err?.message === 'invalid_grant';
}

async function readRefreshTokenFromDisk(): Promise<string | null> {
  try {
    const parsed = sanitizeStoredTokenCredentials(
      JSON.parse(await fs.readFile(getTokenPath(), 'utf8'))
    );
    return parsed.refresh_token ?? null;
  } catch {
    return null;
  }
}

/**
 * The OAuth2Client is cached for the process lifetime, so a re-auth done in another
 * process would never reach it. On invalid_grant, re-read token.json once and retry
 * with the refresh token found there, if it differs from the one that just failed.
 */
export function installInvalidGrantRecovery(client: OAuth2Client): void {
  const target = client as any;
  const original = target.refreshTokenNoCache.bind(client);
  const succeed = async (result: unknown) => {
    await updateAuthMeta({ lastSuccessAt: new Date().toISOString() });
    return result;
  };
  target.refreshTokenNoCache = async (refreshToken?: string | null) => {
    let failure: any;
    try {
      return await succeed(await original(refreshToken));
    } catch (err: any) {
      if (!isInvalidGrant(err)) throw err;
      failure = err;
    }
    const fromDisk = await readRefreshTokenFromDisk();
    if (fromDisk && fromDisk !== refreshToken) {
      logger.info('Refresh token rejected; token.json changed on disk, retrying once.');
      client.setCredentials({
        refresh_token: fromDisk,
        access_token: null,
        expiry_date: null,
      });
      try {
        return await succeed(await original(fromDisk));
      } catch (err: any) {
        if (!isInvalidGrant(err)) throw err;
        failure = err;
      }
    }
    const description = failure?.response?.data?.error_description;
    await updateAuthMeta({
      lastFailureAt: new Date().toISOString(),
      lastFailureState: 'needs_reauth',
      lastFailureReason: 'invalid_grant',
    });
    throw new UserError(
      needsReauthMessage(
        `invalid_grant${typeof description === 'string' ? `: ${description.slice(0, 200)}` : ''}`
      )
    );
  };
}

async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
  let credentials: OAuth2Client['credentials'];
  try {
    const content = await fs.readFile(getTokenPath(), 'utf8');
    credentials = sanitizeStoredTokenCredentials(JSON.parse(content));
  } catch {
    return null;
  }
  const { client_secret, client_id } = await loadClientSecrets();
  const client = new google.auth.OAuth2(client_id, client_secret);
  client.setCredentials(credentials);
  installInvalidGrantRecovery(client);
  return client;
}

async function saveCredentials(client: OAuth2Client): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  const tokenPath = getTokenPath();
  const payload = JSON.stringify(createStoredTokenPayload(client.credentials), null, 2);
  await fs.writeFile(tokenPath, payload, { mode: 0o600 });
  logger.info('Token stored to', tokenPath);
}

// ---------------------------------------------------------------------------
// Interactive OAuth browser flow
// ---------------------------------------------------------------------------

async function authenticate(): Promise<OAuth2Client> {
  const { client_secret, client_id } = await loadClientSecrets();

  // Start a temporary local server to receive the OAuth callback
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://localhost:${port}`;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const state = crypto.randomBytes(32).toString('hex');

  // prompt: 'consent' is what makes re-authorization actually work. Google returns a refresh
  // token only when it re-asks for consent; for an app the user already granted, an offline
  // request without it yields an access token and no refresh token. Since only the refresh
  // token is persisted, a re-auth would then save nothing and leave the old grant — and its
  // old, narrower scope set — in place, while still reporting success. Adding a scope to
  // SCOPES would appear to do nothing at all.
  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES.join(' '),
    state,
  });

  logger.info('Authorize this app by visiting this url:', authorizeUrl);

  const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
  const timeout = setTimeout(() => {
    server.close();
  }, AUTH_TIMEOUT_MS);

  // Wait for the OAuth callback
  const code = await new Promise<string>((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization failed</h1><p>You can close this tab.</p>');
        reject(new Error(`Authorization error: ${error}`));
        clearTimeout(timeout);
        server.close();
        return;
      }

      const returnedState = url.searchParams.get('state');
      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Invalid state parameter</h1><p>Possible CSRF attack. Please try again.</p>');
        return;
      }

      if (authCode) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization successful!</h1><p>You can close this tab.</p>');
        resolve(authCode);
        clearTimeout(timeout);
        server.close();
      }
    });
  });

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  if (!tokens.refresh_token) {
    // Nothing is persisted without a refresh token, so this run changed nothing on disk. Said
    // as a warning it reads as a minor caveat under a success message, and the stale grant
    // goes unnoticed until some tool fails for a reason that looks unrelated.
    throw new Error(
      'Google returned no refresh token, so nothing was saved and the previous authorization ' +
        '(with whatever scopes it had) is still in force. Revoke this app at ' +
        'https://myaccount.google.com/permissions and run the auth flow again.'
    );
  }
  await saveCredentials(oAuth2Client);
  logger.info(`Authentication successful! Granted scopes: ${tokens.scope ?? '(not reported)'}`);
  return oAuth2Client;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main authorization entry point used by the server at startup.
 *
 * Resolution order:
 *   1. SERVICE_ACCOUNT_PATH env var -> service account JWT
 *   2. Saved token in ~/.config/google-docs-mcp/token.json -> OAuth2Client
 *   3. Otherwise throws AuthRequiredError; the interactive flow only runs via `auth`
 */
export async function authorize(): Promise<OAuth2Client | JWT> {
  if (process.env.SERVICE_ACCOUNT_PATH) {
    logger.info('Service account path detected. Attempting service account authentication...');
    return authorizeWithServiceAccount();
  }

  logger.info('Attempting OAuth 2.0 authentication...');
  const client = await loadSavedCredentialsIfExist();
  if (client) {
    logger.info('Using saved credentials.');
    return client;
  }
  // An interactive flow inside a tool call blocks on a local callback server for
  // the whole auth timeout and never rejects, which hangs the MCP host.
  await updateAuthMeta({
    lastFailureAt: new Date().toISOString(),
    lastFailureState: 'needs_reauth',
    lastFailureReason: 'no_token_file',
  });
  throw new AuthRequiredError('no saved token');
}

/**
 * Forces the interactive OAuth browser flow, ignoring any saved token.
 * Used by the `auth` CLI subcommand to let users (re-)authorize.
 */
export async function runAuthFlow(): Promise<void> {
  await authenticate();
}
