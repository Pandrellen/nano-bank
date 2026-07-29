export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8081";

// 7 days — mirrors api/config/default.toml's jwt.refresh_expires_in.
export const TOKEN_MAX_AGE_SECONDS = Number(
  process.env.TOKEN_MAX_AGE_SECONDS || 60 * 60 * 24 * 7,
);
