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

  if (result.status === "refreshed") {
    return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(new URL("/auth/signin", request.url));
}
