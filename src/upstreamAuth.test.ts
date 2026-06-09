import { describe, it, expect } from 'vitest';
import { OAuthProxy } from 'fastmcp/auth';
import { withOfflineAccess, enableUpstreamOfflineAccess } from './upstreamAuth.js';

const GOOGLE_AUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth' +
  '?client_id=test-client-id' +
  '&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback' +
  '&response_type=code' +
  '&state=txn-1' +
  '&scope=openid+email' +
  '&code_challenge=abc123' +
  '&code_challenge_method=S256';

function redirect(location: string | null, status = 302): Response {
  const headers = new Headers();
  if (location !== null) headers.set('Location', location);
  return new Response(null, { status, headers });
}

describe('withOfflineAccess', () => {
  it('adds access_type=offline and prompt=consent to the Location URL', () => {
    const out = withOfflineAccess(redirect(GOOGLE_AUTH_URL));
    const url = new URL(out.headers.get('Location')!);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('preserves all pre-existing authorization parameters', () => {
    const out = withOfflineAccess(redirect(GOOGLE_AUTH_URL));
    const url = new URL(out.headers.get('Location')!);
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/oauth/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('txn-1');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('code_challenge')).toBe('abc123');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('preserves the redirect status code', () => {
    expect(withOfflineAccess(redirect(GOOGLE_AUTH_URL, 302)).status).toBe(302);
    expect(withOfflineAccess(redirect(GOOGLE_AUTH_URL, 307)).status).toBe(307);
  });

  it('overwrites a pre-existing prompt/access_type rather than duplicating it', () => {
    const out = withOfflineAccess(redirect(`${GOOGLE_AUTH_URL}&access_type=online&prompt=none`));
    const url = new URL(out.headers.get('Location')!);
    expect(url.searchParams.getAll('access_type')).toEqual(['offline']);
    expect(url.searchParams.getAll('prompt')).toEqual(['consent']);
  });

  it('returns the response unchanged when there is no Location header', () => {
    const res = redirect(null);
    expect(withOfflineAccess(res)).toBe(res);
  });

  it('returns the response unchanged when the Location is not an absolute URL', () => {
    const res = redirect('/relative/path');
    expect(withOfflineAccess(res)).toBe(res);
  });
});

describe('enableUpstreamOfflineAccess', () => {
  it('wraps redirectToUpstream so its output requests offline access', () => {
    const proxy = {
      redirectToUpstream(_transaction: unknown): Response {
        return redirect(GOOGLE_AUTH_URL);
      },
    };

    enableUpstreamOfflineAccess(proxy as unknown as OAuthProxy);

    const out = proxy.redirectToUpstream({ id: 'txn-1' });
    const url = new URL(out.headers.get('Location')!);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    // original params still present
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
  });

  it('patches a real OAuthProxy instance end-to-end', () => {
    const proxy = new OAuthProxy({
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

    enableUpstreamOfflineAccess(proxy);

    const response = (
      proxy as unknown as { redirectToUpstream: (t: unknown) => Response }
    ).redirectToUpstream({
      id: 'txn-1',
      scope: ['openid', 'email'],
      proxyCodeChallenge: 'challenge',
    });

    const url = new URL(response.headers.get('Location')!);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    // FastMCP-built params survive the rewrite
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('txn-1');
  });
});
