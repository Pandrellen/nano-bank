import { NextRequest, NextResponse } from "next/server";
import { refreshSessionAction } from "@/actions/auth";
import { sanitizeNextPath } from "@/lib/redirects";

/** Silent token-refresh entry point for protected Server Components.
 *
 * `requireSession()` redirects here when the access token is missing or expired.
 * A Route Handler (unlike a Server Component render) may write cookies, so this
 * is where the refresh_token is exchanged for a fresh access/refresh pair. On
 * success we bounce back to the originally requested page (now carrying fresh
 * cookies); otherwise — session truly over, or the refresh call failed — we send
 * the user to sign in. */
export async function GET(request: NextRequest) {
  // Only allow same-origin relative paths as the redirect target (no open redirect).
  const next = sanitizeNextPath(request.nextUrl.searchParams.get("next"));

  const result = await refreshSessionAction();
  const target = result.status === "refreshed" ? next : "/auth/signin";

  // Build the absolute redirect from the browser-facing host, NOT request.url:
  // the Next standalone server reports request.url's host as its bind address
  // (0.0.0.0), so redirecting there would bounce the browser to a different
  // origin and drop the host-only session cookies. Prefer the proxy's forwarded
  // host, then the Host header, and only fall back to the request origin.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const base = host ? `${proto}://${host}` : request.nextUrl.origin;

  return NextResponse.redirect(new URL(target, base));
}
