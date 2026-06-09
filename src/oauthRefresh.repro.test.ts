// Reproduction of the production OAuth bug on production-equivalent code.
//
// Bug: the remote OAuthProxy never requests Google "offline access", so Google
// returns no refresh_token. The stored Google access token (1-hour TTL) is then
// never renewed, and every Google API call fails ~1 hour after a user
// authenticates.
//
// This file is written to PASS on the un-fixed (synced) code: it documents the
// broken behavior (root cause) and proves the runtime consequence with the real
// `createClients` against a mock Google. The fix is verified separately in
// upstreamAuth.test.ts (the patched OAuthProxy DOES request offline access).
//
// The two layers below are independent of the fix module, so they run against
// production-equivalent code with no fix present.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OAuthProxy } from 'fastmcp/auth';
import { createClients } from './remoteWrapper.js';

// Mirrors the OAuthProxy configuration in src/index.ts (remote mode).
function buildProductionProxy(): OAuthProxy {
  return new OAuthProxy({
    upstreamAuthorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    upstreamTokenEndpoint: 'https://oauth2.googleapis.com/token',
    upstreamClientId: 'test-client-id',
    upstreamClientSecret: 'test-secret',
    baseUrl: 'https://example.com',
    scopes: ['openid', 'email'],
    allowedRedirectUriPatterns: ['https://example.com/*'],
    jwtSigningKey: '0'.repeat(64),
    encryptionKey: '0'.repeat(64),
    consentRequired: false,
  });
}

describe('ROOT CAUSE: remote OAuthProxy authorization URL (unpatched)', () => {
  it('does NOT request offline access, so Google returns no refresh_token', () => {
    const proxy = buildProductionProxy();
    const response = (
      proxy as unknown as { redirectToUpstream: (t: unknown) => Response }
    ).redirectToUpstream({
      id: 'txn-1',
      scope: ['openid', 'email'],
      proxyCodeChallenge: 'challenge',
    });
    const url = new URL(response.headers.get('Location')!);

    // This is the bug: no access_type=offline => no refresh_token from Google.
    expect(url.searchParams.get('access_type')).toBeNull();
    expect(url.searchParams.get('prompt')).toBeNull();
  });
});

describe('CONSEQUENCE: an expired Google access token (real createClients vs mock Google)', () => {
  let server: http.Server;
  let base: string;
  let tokenEndpointHits = 0;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';

    server = http.createServer((req, res) => {
      // Mock Google token endpoint: exchanges a refresh_token for a fresh access token.
      if (req.method === 'POST' && req.url === '/token') {
        tokenEndpointHits++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'FRESH_ACCESS_TOKEN',
            expires_in: 3600,
            token_type: 'Bearer',
          })
        );
        return;
      }
      // Mock Google API: 200 only when presented a fresh token, else 401 (expired).
      if (req.url?.startsWith('/api')) {
        const auth = req.headers['authorization'] ?? '';
        if (auth.includes('FRESH_ACCESS_TOKEN')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }));
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('REPRODUCES the outage: with NO refresh_token, an expired token is never renewed and the call fails', async () => {
    tokenEndpointHits = 0;
    const clients = createClients('EXPIRED_STALE_TOKEN'); // no refresh token — current prod reality
    (
      clients.auth as unknown as { endpoints: { oauth2TokenUrl: string } }
    ).endpoints.oauth2TokenUrl = `${base}/token`;

    await expect(clients.auth.request({ url: `${base}/api`, method: 'GET' })).rejects.toThrow();
    expect(tokenEndpointHits).toBe(0); // no refresh was even attempted
  });

  it('FIX PREMISE: with a refresh_token present, the same expired token auto-refreshes and the call succeeds', async () => {
    tokenEndpointHits = 0;
    const clients = createClients('EXPIRED_STALE_TOKEN', 'VALID_REFRESH_TOKEN');
    (
      clients.auth as unknown as { endpoints: { oauth2TokenUrl: string } }
    ).endpoints.oauth2TokenUrl = `${base}/token`;

    const res = await clients.auth.request<{ ok: boolean }>({ url: `${base}/api`, method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true });
    expect(tokenEndpointHits).toBe(1); // exactly one refresh happened, then the retry succeeded
  });
});
