import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refreshSessionAction } from "@/actions/auth";
import { API_BASE_URL } from "@/lib/config";

export interface CustomerProfile {
  first_name: string;
  last_name: string;
  email: string;
}

export interface Session {
  accessToken: string;
  profile: CustomerProfile;
}

/** `unauthorized` means the token is genuinely missing/invalid — the caller
 * should treat the session as over. `error` means the check itself failed
 * (network blip, 5xx) and says nothing about the token's validity, so the
 * caller should surface an error rather than sign the user out. */
export type SessionVerification =
  | { status: "valid"; profile: CustomerProfile }
  | { status: "unauthorized" }
  | { status: "error" };

/** Verifies an access token against the API. */
export async function verifySession(accessToken: string | undefined): Promise<SessionVerification> {
  if (!accessToken) return { status: "unauthorized" };

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/customers/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.ok) {
      return { status: "valid", profile: await response.json() };
    }
    if (response.status === 401) {
      return { status: "unauthorized" };
    }
    console.error(`Session verification failed with status ${response.status}`);
    return { status: "error" };
  } catch (error) {
    console.error("Failed to verify session:", error);
    return { status: "error" };
  }
}

/** For protected Server Components: verifies the session cookie and redirects to
 * sign-in if it's missing or invalid, otherwise returns the token and profile.
 * An infra error (network/5xx from either the profile check or the refresh
 * call) throws instead of redirecting — the session may still be good, so it's
 * left alone rather than being treated as signed out. */
export async function requireSession(): Promise<Session> {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("access_token")?.value;
  let verification = await verifySession(accessToken);

  if (verification.status === "error") {
    throw new Error("Unable to verify session: the API is unreachable or returned an error.");
  }

  if (verification.status === "unauthorized") {
    const refreshResult = await refreshSessionAction();
    if (refreshResult.status === "error") {
      throw new Error("Unable to refresh session: the API is unreachable or returned an error.");
    }
    if (refreshResult.status === "refreshed") {
      accessToken = cookieStore.get("access_token")?.value;
      verification = await verifySession(accessToken);
      if (verification.status === "error") {
        throw new Error("Unable to verify session: the API is unreachable or returned an error.");
      }
    }
  }

  if (verification.status !== "valid" || !accessToken) {
    redirect("/auth/signin");
  }

  return { accessToken, profile: verification.profile };
}
