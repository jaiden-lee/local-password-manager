import { describe, expect, it } from "vitest";

import { extractAuthAttemptFromContainer } from "../src/extension/lib/authForms";

describe("auth form detection", () => {
  it("detects a login form with username and password", () => {
    document.body.innerHTML = `
      <form action="/login">
        <label>Email <input type="email" name="email" value="me@example.com" /></label>
        <label>Password <input type="password" name="password" value="secret123" /></label>
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    const attempt = extractAuthAttemptFromContainer(form);

    expect(attempt).not.toBeNull();
    expect(attempt?.intent).toBe("login");
    expect(attempt?.identifier).toBe("me@example.com");
    expect(attempt?.password).toBe("secret123");
  });

  it("detects a signup form with two password fields", () => {
    document.body.innerHTML = `
      <form action="/signup">
        <input type="text" name="username" value="newuser" />
        <input type="password" name="password" value="secret123" />
        <input type="password" name="confirmPassword" value="secret123" />
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    const attempt = extractAuthAttemptFromContainer(form);

    expect(attempt).not.toBeNull();
    expect(attempt?.intent).toBe("signup");
    expect(attempt?.identifier).toBe("newuser");
    expect(attempt?.confirmPassword).toBe("secret123");
  });

  it("ignores signup forms with mismatched confirmation passwords", () => {
    document.body.innerHTML = `
      <form action="/signup">
        <input type="email" name="email" value="me@example.com" />
        <input type="password" name="password" value="secret123" />
        <input type="password" name="confirmPassword" value="different" />
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    const attempt = extractAuthAttemptFromContainer(form);

    expect(attempt).toBeNull();
  });
});
