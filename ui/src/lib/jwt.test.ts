import { describe, it, expect } from "vitest";
import { decodeJwtExpiry } from "@/lib/jwt";

function makeToken(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${b64}.sig`;
}

describe("decodeJwtExpiry", () => {
  it("reads a numeric exp claim", () => {
    expect(decodeJwtExpiry(makeToken({ exp: 1_700_000_000 }))).toBe(1_700_000_000);
  });
  it("returns null when exp is missing or non-numeric", () => {
    expect(decodeJwtExpiry(makeToken({ foo: 1 }))).toBeNull();
    expect(decodeJwtExpiry(makeToken({ exp: "soon" }))).toBeNull();
  });
  it("returns null for a malformed token", () => {
    expect(decodeJwtExpiry("only-one-part")).toBeNull();
    expect(decodeJwtExpiry("a.!!!.c")).toBeNull();
  });
});
