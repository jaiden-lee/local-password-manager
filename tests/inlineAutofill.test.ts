import { describe, expect, it } from "vitest";

import { buildAutofillPromptViewModel } from "../src/extension/lib/inlineAutofill";
import type { PopupState } from "../src/extension/lib/types";

function createBaseState(): PopupState {
  return {
    currentUrl: "https://example.com/login",
    normalizedUrl: {
      origin: "https://example.com",
      pathPrefix: "/login"
    },
    site: {
      siteId: "site_1",
      displayName: "Example",
      origin: "https://example.com",
      pathPrefix: "/login",
      loginMethod: "password",
      notes: ""
    },
    mapping: null,
    accounts: [],
    detection: {
      matchesRule: true,
      hasMapping: false,
      oauthProviders: [],
      candidateForms: 1,
      hasCrossOriginFrames: false
    },
    lastFillResult: null
  };
}

describe("buildAutofillPromptViewModel", () => {
  it("shows setup guidance when the site exists but fields are not mapped", () => {
    const model = buildAutofillPromptViewModel(createBaseState());

    expect(model.visible).toBe(true);
    expect(model.title).toBe("Set up autofill?");
    expect(model.primaryLabel).toBe("Map fields");
    expect(model.showSetupAction).toBe(true);
  });

  it("offers a direct fill prompt when exactly one account exists", () => {
    const state = createBaseState();
    state.mapping = {
      mappingId: "mapping_1",
      siteId: "site_1",
      username: {
        selector: "#username",
        fallbackPath: "html > body > input:nth-of-type(1)",
        fingerprint: {
          tagName: "input",
          type: "text",
          name: "username",
          autocomplete: "username",
          placeholder: "",
          ariaLabel: "",
          labelText: "Username"
        }
      },
      password: {
        selector: "#password",
        fallbackPath: "html > body > input:nth-of-type(2)",
        fingerprint: {
          tagName: "input",
          type: "password",
          name: "password",
          autocomplete: "current-password",
          placeholder: "",
          ariaLabel: "",
          labelText: "Password"
        }
      },
      formFingerprint: {
        actionPath: "/login",
        method: "post",
        fieldCount: 2,
        passwordFieldCount: 1
      },
      lastVerifiedAt: new Date().toISOString(),
      stale: false
    };
    state.accounts = [
      {
        id: "acct_1",
        siteId: "site_1",
        label: "Work",
        username: "me@example.com",
        password: "PASSWORD",
        isDemo: true
      }
    ];

    const model = buildAutofillPromptViewModel(state);

    expect(model.title).toBe("Would you like to autofill?");
    expect(model.primaryLabel).toBe("Fill Work");
    expect(model.subtitle).toContain("me@example.com");
  });

  it("shows chooser wording when multiple accounts exist", () => {
    const state = createBaseState();
    state.mapping = {
      mappingId: "mapping_1",
      siteId: "site_1",
      username: {
        selector: "#username",
        fallbackPath: "html > body > input:nth-of-type(1)",
        fingerprint: {
          tagName: "input",
          type: "text",
          name: "username",
          autocomplete: "username",
          placeholder: "",
          ariaLabel: "",
          labelText: "Username"
        }
      },
      password: {
        selector: "#password",
        fallbackPath: "html > body > input:nth-of-type(2)",
        fingerprint: {
          tagName: "input",
          type: "password",
          name: "password",
          autocomplete: "current-password",
          placeholder: "",
          ariaLabel: "",
          labelText: "Password"
        }
      },
      formFingerprint: {
        actionPath: "/login",
        method: "post",
        fieldCount: 2,
        passwordFieldCount: 1
      },
      lastVerifiedAt: new Date().toISOString(),
      stale: false
    };
    state.accounts = [
      {
        id: "acct_1",
        siteId: "site_1",
        label: "Work",
        username: "work@example.com",
        password: "PASSWORD",
        isDemo: true
      },
      {
        id: "acct_2",
        siteId: "site_1",
        label: "Personal",
        username: "me@example.com",
        password: "PASSWORD",
        isDemo: true
      }
    ];

    const model = buildAutofillPromptViewModel(state);

    expect(model.primaryLabel).toBe("Choose account (2)");
    expect(model.accountCount).toBe(2);
  });
});
