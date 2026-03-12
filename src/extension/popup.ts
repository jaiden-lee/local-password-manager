import type { BackgroundMessage, BackgroundResponse } from "./lib/messages";
import type { PopupState } from "./lib/types";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Popup root element was not found.");
}

type PendingAction = "none" | "overwrite";
type StatusTone = "neutral" | "warn" | "error";

const uiState = {
  popupState: null as PopupState | null,
  activeTabId: null as number | null,
  pendingAction: "none" as PendingAction,
  statusMessage: "",
  statusTone: "neutral" as StatusTone
};

function setStatus(message: string, tone: StatusTone = "neutral"): void {
  uiState.statusMessage = message;
  uiState.statusTone = tone;
  render();
}

async function sendBackgroundMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(message) as Promise<BackgroundResponse>;
}

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSiteForm(state: PopupState): string {
  const defaultDisplayName = state.normalizedUrl
    ? new URL(state.currentUrl).hostname
    : "";
  const defaultPathPrefix = state.normalizedUrl?.pathPrefix ?? "/";

  return `
    <section class="card">
      <div class="hero">
        <span class="eyebrow">New Site</span>
        <div class="title">Save a login rule</div>
        <div class="subtitle">The extension only activates on pages you explicitly save.</div>
      </div>
      <form id="save-site-form" class="form-grid">
        <label>
          Display name
          <input name="displayName" value="${escapeHtml(defaultDisplayName)}" required />
        </label>
        <label>
          Path prefix
          <input name="pathPrefix" value="${escapeHtml(defaultPathPrefix)}" required />
        </label>
        <button type="submit">Save Current Page</button>
      </form>
    </section>
  `;
}

function renderAccounts(state: PopupState): string {
  if (!state.site) {
    return "";
  }

  const accountOptions = state.accounts
    .map(
      (account, index) => `
        <label class="account-chip">
          <input type="radio" name="account-choice" value="${account.id}" ${index === 0 ? "checked" : ""} />
          <span class="account-label">${escapeHtml(account.label)}</span>
          <span class="account-meta">${escapeHtml(account.username)}</span>
        </label>
      `
    )
    .join("");

  return `
    <section class="card">
      <div class="hero">
        <span class="eyebrow">Accounts</span>
        <div class="title">${escapeHtml(state.site.displayName)}</div>
        <div class="subtitle">${escapeHtml(state.site.origin)}${escapeHtml(state.site.pathPrefix)}</div>
      </div>
      <div class="account-list">${accountOptions || '<div class="hint">No demo accounts saved for this site yet.</div>'}</div>
      <div class="actions">
        <button id="fill-account-button" ${!state.mapping || !state.accounts.length ? "disabled" : ""}>Fill Selected Account</button>
        <button id="map-fields-button" class="secondary">Map Fields</button>
        <button id="clear-mapping-button" class="secondary" ${!state.mapping ? "disabled" : ""}>Clear Mapping</button>
        ${
          uiState.pendingAction === "overwrite"
            ? '<button id="overwrite-fill-button" class="warn">Overwrite Existing Password</button>'
            : ""
        }
      </div>
    </section>
  `;
}

function renderAccountForm(state: PopupState): string {
  if (!state.site) {
    return "";
  }

  return `
    <section class="card">
      <div class="hero">
        <span class="eyebrow">Demo Account</span>
        <div class="title">Add another account</div>
        <div class="subtitle">Use demo values to exercise multi-account fill before native integration.</div>
      </div>
      <form id="account-form" class="form-grid">
        <label>
          Label
          <input name="label" placeholder="Work account" required />
        </label>
        <div class="row inline">
          <label>
            Username
            <input name="username" value="USERNAME" required />
          </label>
          <label>
            Password
            <input name="password" value="PASSWORD" required />
          </label>
        </div>
        <button type="submit" class="secondary">Add Demo Account</button>
      </form>
    </section>
  `;
}

function renderStatus(state: PopupState): string {
  const messages: string[] = [];
  if (uiState.statusMessage) {
    messages.push(
      `<div class="status ${uiState.statusTone === "neutral" ? "" : uiState.statusTone}">${escapeHtml(uiState.statusMessage)}</div>`
    );
  }

  if (state.detection.oauthProviders.length) {
    messages.push(
      `<div class="status warn">OAuth options detected: ${escapeHtml(
        state.detection.oauthProviders.join(", ")
      )}. The prototype does not automate federated sign-in.</div>`
    );
  }

  if (state.detection.hasCrossOriginFrames) {
    messages.push(
      '<div class="status warn">Cross-origin iframes detected. Login fields inside them are intentionally unsupported in v1.</div>'
    );
  }

  if (state.mapping?.stale) {
    messages.push(
      '<div class="status warn">A previous fill used fallback recovery. Remap the page fields to refresh selector accuracy.</div>'
    );
  }

  if (!messages.length) {
    return "";
  }

  return `
    <section class="card">
      <div class="hero">
        <span class="eyebrow">Status</span>
        <div class="title">Page signals</div>
      </div>
      ${messages.join("")}
    </section>
  `;
}

function renderDebug(state: PopupState): string {
  const lastFillResult = state.lastFillResult
    ? `${state.lastFillResult.status} at ${new Date(state.lastFillResult.timestamp).toLocaleTimeString()}`
    : "No fill attempts yet";

  return `
    <section class="card">
      <details>
        <summary>Debug view</summary>
        <div class="divider"></div>
        <div class="kv">
          <div><strong>Current URL</strong>${escapeHtml(state.currentUrl || "Unavailable")}</div>
          <div><strong>Matched rule</strong>${state.site ? `${escapeHtml(state.site.origin)}${escapeHtml(state.site.pathPrefix)}` : "No match"}</div>
          <div><strong>Candidate forms</strong>${state.detection.candidateForms}</div>
          <div><strong>Username selector</strong>${escapeHtml(state.mapping?.username.selector ?? "Not saved")}</div>
          <div><strong>Password selector</strong>${escapeHtml(state.mapping?.password.selector ?? "Not saved")}</div>
          <div><strong>Last fill result</strong>${escapeHtml(lastFillResult)}</div>
        </div>
      </details>
    </section>
  `;
}

function selectedAccountId(): string | null {
  const selected = document.querySelector<HTMLInputElement>("input[name='account-choice']:checked");
  return selected?.value ?? null;
}

function render(): void {
  const state = uiState.popupState;

  if (!state) {
    app.innerHTML = `
      <div class="shell">
        <section class="card">
          <div class="hero">
            <span class="eyebrow">Loading</span>
            <div class="title">Preparing page context</div>
            <div class="subtitle">The extension is reading the active tab and saved rules.</div>
          </div>
        </section>
      </div>
    `;
    return;
  }

  const unsupported = !state.currentUrl || !state.normalizedUrl;

  app.innerHTML = `
    <div class="shell">
      <section class="card">
        <div class="hero">
          <span class="eyebrow">Prototype</span>
          <div class="title">Local Password Manager</div>
          <div class="subtitle">Explicit fill only. Demo accounts only. No native host yet.</div>
        </div>
        <div class="pill">${state.site ? "Rule matched" : unsupported ? "Unsupported tab" : "No rule saved"}</div>
      </section>
      ${
        unsupported
          ? `
        <section class="card">
          <div class="status error">This prototype only runs on regular http and https pages.</div>
        </section>
      `
          : ""
      }
      ${!unsupported && !state.site ? renderSiteForm(state) : ""}
      ${!unsupported && state.site ? renderAccounts(state) : ""}
      ${!unsupported && state.site ? renderAccountForm(state) : ""}
      ${!unsupported ? renderStatus(state) : ""}
      ${renderDebug(state)}
    </div>
  `;

  attachEventHandlers();
}

async function refreshState(): Promise<void> {
  if (uiState.activeTabId === null) {
    uiState.activeTabId = await getActiveTabId();
  }

  const response = await sendBackgroundMessage({
    type: "GET_POPUP_STATE",
    tabId: uiState.activeTabId ?? undefined
  });

  if (!response.ok || !("state" in response)) {
    setStatus(response.ok ? "Unable to read popup state." : response.error, "error");
    return;
  }

  uiState.popupState = response.state;
  render();
}

function attachEventHandlers(): void {
  const siteForm = document.getElementById("save-site-form") as HTMLFormElement | null;
  siteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (uiState.activeTabId === null) {
      return;
    }

    const formData = new FormData(siteForm);
    const response = await sendBackgroundMessage({
      type: "SAVE_SITE_RULE",
      tabId: uiState.activeTabId,
      displayName: String(formData.get("displayName") || ""),
      pathPrefix: String(formData.get("pathPrefix") || "/")
    });

    if (!response.ok) {
      setStatus(response.error, "error");
      return;
    }

    setStatus("Saved the current page as a site rule.");
    await refreshState();
  });

  const mapButton = document.getElementById("map-fields-button");
  mapButton?.addEventListener("click", async () => {
    if (!uiState.popupState?.site || uiState.activeTabId === null) {
      return;
    }

    const response = await sendBackgroundMessage({
      type: "START_FIELD_MAPPING",
      tabId: uiState.activeTabId,
      siteId: uiState.popupState.site.siteId
    });

    if (!response.ok) {
      setStatus(response.error, "error");
      return;
    }

    setStatus("Field mapping started. Click the username field, then the password field on the page.");
    window.close();
  });

  const clearButton = document.getElementById("clear-mapping-button");
  clearButton?.addEventListener("click", async () => {
    if (!uiState.popupState?.site) {
      return;
    }

    const response = await sendBackgroundMessage({
      type: "CLEAR_MAPPING",
      siteId: uiState.popupState.site.siteId
    });

    if (!response.ok) {
      setStatus(response.error, "error");
      return;
    }

    uiState.pendingAction = "none";
    setStatus("Cleared the saved field mapping.");
    await refreshState();
  });

  const accountForm = document.getElementById("account-form") as HTMLFormElement | null;
  accountForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!uiState.popupState?.site) {
      return;
    }

    const formData = new FormData(accountForm);
    const response = await sendBackgroundMessage({
      type: "SAVE_DEMO_ACCOUNT",
      siteId: uiState.popupState.site.siteId,
      label: String(formData.get("label") || ""),
      username: String(formData.get("username") || ""),
      password: String(formData.get("password") || "")
    });

    if (!response.ok) {
      setStatus(response.error, "error");
      return;
    }

    accountForm.reset();
    (accountForm.elements.namedItem("username") as HTMLInputElement).value = "USERNAME";
    (accountForm.elements.namedItem("password") as HTMLInputElement).value = "PASSWORD";
    setStatus("Added a demo account for this site.");
    await refreshState();
  });

  const fillButton = document.getElementById("fill-account-button");
  fillButton?.addEventListener("click", async () => {
    if (!uiState.popupState?.site || uiState.activeTabId === null) {
      return;
    }

    const accountId = selectedAccountId();
    if (!accountId) {
      setStatus("Select an account to fill.", "warn");
      return;
    }

    const response = await sendBackgroundMessage({
      type: "FILL_DEMO_ACCOUNT",
      tabId: uiState.activeTabId,
      siteId: uiState.popupState.site.siteId,
      accountId
    });

    if (!response.ok || !("state" in response)) {
      setStatus(response.ok ? "Fill request failed." : response.error, "error");
      return;
    }

    uiState.popupState = response.state;
    uiState.pendingAction =
      response.state.lastFillResult?.status === "requires-overwrite" ? "overwrite" : "none";

    const tone: StatusTone =
      response.state.lastFillResult?.status === "requires-overwrite"
        ? "warn"
        : response.state.lastFillResult?.status === "filled"
          ? "neutral"
          : "error";

    setStatus(response.state.lastFillResult?.message || "Fill attempted.", tone);
  });

  const overwriteButton = document.getElementById("overwrite-fill-button");
  overwriteButton?.addEventListener("click", async () => {
    if (!uiState.popupState?.site || uiState.activeTabId === null) {
      return;
    }

    const accountId = selectedAccountId();
    if (!accountId) {
      setStatus("Select an account to overwrite with.", "warn");
      return;
    }

    const response = await sendBackgroundMessage({
      type: "FILL_DEMO_ACCOUNT",
      tabId: uiState.activeTabId,
      siteId: uiState.popupState.site.siteId,
      accountId,
      forceOverwrite: true
    });

    if (!response.ok || !("state" in response)) {
      setStatus(response.ok ? "Overwrite request failed." : response.error, "error");
      return;
    }

    uiState.popupState = response.state;
    uiState.pendingAction = "none";
    setStatus(response.state.lastFillResult?.message || "Overwrite fill attempted.");
  });
}

void (async () => {
  uiState.activeTabId = await getActiveTabId();
  await refreshState();
})();
