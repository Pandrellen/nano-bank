"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeJwtExpiry } from "@/lib/jwt";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8081";

interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function setSessionCookies({ access_token, refresh_token, expires_in }: SessionTokens) {
  const cookieStore = await cookies();
  cookieStore.set("access_token", access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: expires_in,
  });
  cookieStore.set("refresh_token", refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export interface SignUpResult {
  success: boolean;
  message: string;
}

export async function signUpAction(formData: FormData): Promise<SignUpResult> {
  const email = formData.get("email");
  const phoneNumber = formData.get("phoneNumber");
  const firstName = formData.get("firstName");
  const lastName = formData.get("lastName");
  const dateOfBirth = formData.get("dateOfBirth");
  const sin = formData.get("sin");
  const password = formData.get("password");

  if (!email || !password || !firstName || !lastName || !phoneNumber || !dateOfBirth || !sin) {
    return {
      success: false,
      message: "All fields are required.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/customers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        phone_number: phoneNumber,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dateOfBirth,
        sin: String(sin).replace(/\D/g, ""),
        password,
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Sign-up request failed:", error);
    return {
      success: false,
      message: "Unable to reach the server. Please try again.",
    };
  }

  const data = await response.json();

  if (!response.ok) {
    return {
      success: false,
      message: data?.error?.message || "Unable to create account.",
    };
  }

  return {
    success: true,
    message: `Account successfully created for ${firstName} ${lastName}!`,
  };
}

export interface SignInResult {
  success: boolean;
  message: string;
}

export async function signInAction(formData: FormData): Promise<SignInResult> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (!email || !password) {
    return {
      success: false,
      message: "Email and password are required.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Sign-in request failed:", error);
    return {
      success: false,
      message: "Unable to reach the server. Please try again.",
    };
  }

  const data = await response.json();

  if (!response.ok) {
    return {
      success: false,
      message: data?.error?.message || "Invalid email or password.",
    };
  }

  await setSessionCookies(data);

  return {
    success: true,
    message: "Successfully signed in!",
  };
}

export interface RefreshResult {
  success: boolean;
  expiresAt?: number;
}

/** Exchanges the refresh_token cookie for a new access/refresh pair. Called by
 * TokenCountdown once the access token's exp passes. On failure the session is
 * truly over (refresh token missing, expired, or already used) — cookies are
 * cleared and the caller should send the user back to sign in. */
export async function refreshSessionAction(): Promise<RefreshResult> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;

  if (!refreshToken) {
    return { success: false };
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Token refresh request failed:", error);
    return { success: false };
  }

  if (!response.ok) {
    cookieStore.delete("access_token");
    cookieStore.delete("refresh_token");
    return { success: false };
  }

  const data = await response.json();
  await setSessionCookies(data);

  return { success: true, expiresAt: decodeJwtExpiry(data.access_token) ?? undefined };
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;

  if (accessToken) {
    try {
      await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch (error) {
      console.error("Logout request failed:", error);
    }
  }

  cookieStore.delete("access_token");
  cookieStore.delete("refresh_token");

  redirect("/auth/signin");
}
