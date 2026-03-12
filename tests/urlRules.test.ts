import { describe, expect, it } from "vitest";

import { normalizeUrl, pathMatches } from "../src/extension/lib/urlRules";

describe("urlRules", () => {
  it("normalizes origin and path without query strings", () => {
    expect(normalizeUrl("https://example.com/login?next=%2Fhome#fragment")).toEqual({
      origin: "https://example.com",
      pathPrefix: "/login"
    });
  });

  it("matches a path prefix and nested routes", () => {
    expect(pathMatches("/login", "/login")).toBe(true);
    expect(pathMatches("/login/mfa", "/login")).toBe(true);
    expect(pathMatches("/account/login", "/login")).toBe(false);
  });
});
