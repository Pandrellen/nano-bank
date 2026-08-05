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

  // Redirect with a RELATIVE Location, which the browser resolves against its own
  // address-bar origin. We deliberately avoid an absolute URL built from
  // request.url (the Next standalone server reports its bind address 0.0.0.0,
  // which would bounce the browser off-origin and drop host-only session cookies)
  // AND from the Host / X-Forwarded-Host headers (client-controlled on the plain
  // NodePort Service — trusting them is an open-redirect vector). `target` is
  // always a sanitised same-origin path, so a relative redirect suffices.
  return new NextResponse(null, {
    status: 307,
    headers: { Location: target },
  });
}
