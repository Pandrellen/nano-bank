/** Reads the `exp` claim (unix seconds) out of a JWT without verifying its signature — for display only, never for auth decisions. */
export function decodeJwtExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}
