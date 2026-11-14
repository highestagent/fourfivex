/**
 * Only this site's own pages may call its API routes.
 *
 * Browsers send `Sec-Fetch-Site` on every request and `Origin` on every POST, so another site
 * cannot use a visitor's browser to spend this app's 1Click partner key or its RPC allowance.
 * A script can forge both headers; the firewall's rate limit is what slows those down.
 */
export function isCrossSite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  // Same-origin GETs carry no Origin header, so only writes are held to it.
  if (request.method === "GET" || request.method === "HEAD") return false;
  return request.headers.get("origin") !== new URL(request.url).origin;
}
