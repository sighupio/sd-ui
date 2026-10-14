import { describe, expect, it } from 'vitest';
import { buildSignOutUrl } from './pomeriumSignOut';

describe('buildSignOutUrl', () => {
  it('targets the Pomerium sign-out endpoint', () => {
    expect(buildSignOutUrl('https://headlamp.example.com')).toMatch(/^\/\.pomerium\/sign_out\?/);
  });

  it('redirects back to the Headlamp root so Pomerium restarts the OIDC flow', () => {
    const url = new URL(buildSignOutUrl('https://headlamp.example.com'), 'https://headlamp.example.com');
    expect(url.searchParams.get('pomerium_redirect_uri')).toBe('https://headlamp.example.com/');
  });

  it('percent-encodes the redirect so Pomerium parses it as a single query value', () => {
    // An unencoded "https://host/" would break at the "//" and drop the value.
    expect(buildSignOutUrl('https://headlamp.example.com')).toBe(
      '/.pomerium/sign_out?pomerium_redirect_uri=https%3A%2F%2Fheadlamp.example.com%2F'
    );
  });

  it('keeps the port, which Pomerium needs to match the route host', () => {
    const url = new URL(buildSignOutUrl('https://headlamp.example.com:8443'), 'https://x');
    expect(url.searchParams.get('pomerium_redirect_uri')).toBe('https://headlamp.example.com:8443/');
  });

  it('produces a redirect URI with a scheme and host, as Pomerium validation requires', () => {
    const url = new URL(buildSignOutUrl('https://headlamp.172-16-6-210.nip.io'), 'https://x');
    const redirect = new URL(url.searchParams.get('pomerium_redirect_uri') as string);
    expect(redirect.protocol).toBe('https:');
    expect(redirect.host).toBe('headlamp.172-16-6-210.nip.io');
  });
});
