import { NextRequest, NextResponse } from "next/server";

/** Cheap edge-level gate: bounces requests with no session at all before they
 * reach the page. This is a presence check only — the authoritative check (does
 * the token still verify against the API?) happens in requireSession(), called
 * from the protected Server Component itself.
 *
 * We key off the refresh_token, not the access_token: the access token is
 * short-lived and legitimately absent between refreshes, whereas the presence of
 * a refresh_token is what says "this browser has a live session." */
export function proxy(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value;

  if (!refreshToken) {
    return NextResponse.redirect(new URL("/auth/signin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
