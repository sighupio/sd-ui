/**
 * Builds the Pomerium sign-out URL for the current Headlamp origin.
 *
 * Hitting `/.pomerium/sign_out` with no destination makes Pomerium land the user on its own
 * branded "signed out" page, which is meaningless to anyone who doesn't know Pomerium exists.
 * Passing `pomerium_redirect_uri` back to Headlamp's root means Pomerium finds no session there
 * and immediately restarts the OIDC flow, so the user ends up on the login page instead.
 */
export function buildSignOutUrl(origin: string): string {
  return `/.pomerium/sign_out?pomerium_redirect_uri=${encodeURIComponent(`${origin}/`)}`;
}
