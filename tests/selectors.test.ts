import { describe, expect, it } from "vitest";

import { inferAutofillMapping } from "../src/extension/lib/selectors";

describe("inferAutofillMapping", () => {
  it("infers username and password fields from a standard login form", () => {
    document.body.innerHTML = `
      <form action="/login">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" autocomplete="username" />
        <label for="password">Password</label>
        <input id="password" type="password" name="password" autocomplete="current-password" />
      </form>
    `;

    const mapping = inferAutofillMapping(document, "site_1");

    expect(mapping).not.toBeNull();
    expect(mapping?.username.selector).toContain("#email");
    expect(mapping?.password.selector).toContain("#password");
  });

  it("uses the field before the password as a fallback username candidate", () => {
    document.body.innerHTML = `
      <form action="/signin">
        <input type="text" name="identifier" />
        <input type="password" name="passcode" />
      </form>
    `;

    const mapping = inferAutofillMapping(document, "site_1");

    expect(mapping).not.toBeNull();
    expect(mapping?.username.fingerprint.name).toBe("identifier");
    expect(mapping?.password.fingerprint.name).toBe("passcode");
  });

  it("returns null when no usable password field exists", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="username" />
      </form>
    `;

    expect(inferAutofillMapping(document, "site_1")).toBeNull();
  });
});
