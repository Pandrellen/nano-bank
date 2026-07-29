/** Mirrors the API's `{ "error": { "code", "message", "details" } }` envelope
 * (see api/src/errors/mod.rs — every AppError variant serializes to this shape). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: string;
  };
}

/** Own copy for API error codes whose `message` can be developer/DB-facing
 * (e.g. handlers/customers.rs formats a raw Postgres check-violation message
 * straight into a BAD_REQUEST). Codes not listed here (CONFLICT, AUTH_ERROR,
 * RATE_LIMIT, ...) already carry a message that's safe to show verbatim, so
 * they fall through to it. */
export const ERROR_CODE_COPY: Record<string, string> = {
  VALIDATION_ERROR: "Please check the information you entered and try again.",
  BAD_REQUEST: "We couldn't process those details. Please double-check your information and try again.",
  DATABASE_ERROR: "Something went wrong on our end. Please try again in a moment.",
  INTERNAL_ERROR: "Something went wrong on our end. Please try again in a moment.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Please try again shortly.",
};

export function friendlyErrorMessage(errorBody: ApiErrorBody, fallback: string): string {
  const { code, message } = errorBody.error;
  return ERROR_CODE_COPY[code] ?? message ?? fallback;
}
