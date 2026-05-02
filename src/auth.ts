// src/auth.ts
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { JWT } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { fileURLToPath } from 'url';
import * as crypto from 'crypto';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..');

/** Credentials file path (legacy dev workflow fallback). */
const CREDENTIALS_PATH = path.join(projectRootDir, 'credentials.json');

/**
 * Token storage directory following XDG Base Directory spec.
 * Uses $XDG_CONFIG_HOME if set, otherwise ~/.config.
 *
 * When GOOGLE_MCP_PROFILE is set, tokens are stored in a subdirectory
 * per profile, allowing multiple Google accounts (one per project).
 */
function getConfigDir(): string {
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

function getTokenPath(): string {
  return path.join(getConfigDir(), 'token.json');
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.external_request',
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
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    if (!key?.client_id || !key?.client_secret) return null;
    return {
      client_id: key.client_id,
      client_secret: key.client_secret,
      origin: 'credentials.json',
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
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
async function loadClientSecrets(): Promise<CredentialSource> {
  const sources: CredentialSource[] = [];
  const fileSource = await readCredentialsJson();
  if (fileSource) sources.push(fileSource);
  const envSource = readEnvCredentials();
  if (envSource) sources.push(envSource);

  if (sources.length === 0) {
    throw new Error(
      'No OAuth credentials found. Place credentials.json in the project root, ' +
        'or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.'
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

async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
  try {
    const tokenPath = getTokenPath();
    const content = await fs.readFile(tokenPath, 'utf8');
    const credentials = sanitizeStoredTokenCredentials(JSON.parse(content));
    const { client_secret, client_id } = await loadClientSecrets();
    const client = new google.auth.OAuth2(client_id, client_secret);
    client.setCredentials(credentials);
    return client;
  } catch {
    return null;
  }
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

  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
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
  if (tokens.refresh_token) {
    await saveCredentials(oAuth2Client);
  } else {
    logger.warn('Did not receive refresh token. Token might expire.');
  }
  logger.info('Authentication successful!');
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
 *   3. Interactive browser OAuth flow -> OAuth2Client (saves token for next time)
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
  logger.info('No saved token found. Starting interactive authentication flow...');
  return authenticate();
}

/**
 * Forces the interactive OAuth browser flow, ignoring any saved token.
 * Used by the `auth` CLI subcommand to let users (re-)authorize.
 */
export async function runAuthFlow(): Promise<void> {
  await authenticate();
}
