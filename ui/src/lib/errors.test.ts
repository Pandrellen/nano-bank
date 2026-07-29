import { describe, it, expect } from "vitest";
import { friendlyErrorMessage, type ApiErrorBody } from "@/lib/errors";

const body = (code: string, message = "raw"): ApiErrorBody => ({
  error: { code, message, details: "" },
});

describe("friendlyErrorMessage", () => {
  it("maps known developer-facing codes to safe copy", () => {
    expect(friendlyErrorMessage(body("VALIDATION_ERROR"), "fb")).toBe(
      "Please check the information you entered and try again.",
    );
  });
  it("passes through the API message for safe codes", () => {
    expect(friendlyErrorMessage(body("AUTH_ERROR", "Invalid credentials"), "fb")).toBe(
      "Invalid credentials",
    );
  });
  it("uses the fallback when no message is present", () => {
    const noMessage = { error: { code: "UNKNOWN" } } as unknown as ApiErrorBody;
    expect(friendlyErrorMessage(noMessage, "fb")).toBe("fb");
  });
});
