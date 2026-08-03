import { describe, it, expect } from "vitest";
import { sanitizeNextPath } from "@/lib/redirects";

describe("sanitizeNextPath", () => {
  it("allows an internal absolute path", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/accounts/123")).toBe("/accounts/123");
  });
  it("rejects protocol-relative and absolute URLs", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("https://evil.com")).toBe("/dashboard");
  });
  it("rejects backslash-based open-redirect bypasses", () => {
    // `new URL()` normalises `\` to `/`, so these would resolve to an external host.
    expect(sanitizeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/\\/evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("\\\\evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/foo\\bar")).toBe("/dashboard");
  });
  it("falls back on empty / missing input", () => {
    expect(sanitizeNextPath("")).toBe("/dashboard");
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath(undefined)).toBe("/dashboard");
  });
  it("honours a custom fallback", () => {
    expect(sanitizeNextPath("//x", "/home")).toBe("/home");
  });
});
