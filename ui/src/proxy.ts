import { NextRequest, NextResponse } from "next/server";

/** Cheap edge-level gate: bounces requests with no session cookie at all before
 * they reach the page. This is a presence check only — the authoritative check
 * (does the token still verify against the API?) happens in requireSession(),
 * called from the protected Server Component itself. */
export function proxy(request: NextRequest) {
  const accessToken = request.cookies.get("access_token")?.value;

  if (!accessToken) {
    return NextResponse.redirect(new URL("/auth/signin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
