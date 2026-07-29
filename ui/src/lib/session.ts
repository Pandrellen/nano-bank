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

/** Verifies an access token against the API, returning the customer's profile if it's valid. */
export async function verifySession(accessToken: string | undefined): Promise<CustomerProfile | null> {
  if (!accessToken) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/customers/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.error("Failed to verify session:", error);
    return null;
  }
}

/** For protected Server Components: verifies the session cookie and redirects to
 * sign-in if it's missing or invalid, otherwise returns the token and profile. */
export async function requireSession(): Promise<Session> {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("access_token")?.value;
  let profile = await verifySession(accessToken);

  if (!profile) {
    const refreshResult = await refreshSessionAction();
    if (refreshResult.success) {
      accessToken = cookieStore.get("access_token")?.value;
      profile = await verifySession(accessToken);
    }
  }

  if (!accessToken || !profile) {
    redirect("/auth/signin");
  }

  return { accessToken, profile };
}
