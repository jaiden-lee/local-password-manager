import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentMessage,
  ContentResponse
} from "./lib/messages";
import { buildAutofillPromptViewModel, pickPrimaryAccount } from "./lib/inlineAutofill";
import { countCandidateLoginForms, detectCrossOriginFrames, fillInput } from "./lib/dom";
import { detectOAuthProviders } from "./lib/oauth";
import {
  buildFormFingerprint,
  buildSelectorBundle,
  resolveMappedField
} from "./lib/selectors";
import type { PopupState, SaveFieldMappingPayload, StoredAccount } from "./lib/types";

let mappingInProgress = false;
let cleanupOverlay: (() => void) | null = null;
let promptController: FocusPromptController | null = null;
let lastKnownUrl = window.location.href;

function analyzePage() {
  return {
    oauthProviders: detectOAuthProviders(document),
    candidateForms: countCandidateLoginForms(document),
    hasCrossOriginFrames: detectCrossOriginFrames(document)
  };
}

function isFillableInput(element: EventTarget | null): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function isLikelyLoginField(element: HTMLElement): boolean {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    return false;
  }

  const type = (element.getAttribute("type") || "").toLowerCase();
  const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();
  return ["password", "email", "text"].includes(type) || ["username", "current-password"].includes(autocomplete);
}

function createBanner(text: string): HTMLDivElement {
  const banner = document.createElement("div");
  banner.textContent = text;
  banner.style.position = "fixed";
  banner.style.top = "16px";
  banner.style.right = "16px";
  banner.style.zIndex = "2147483647";
  banner.style.background = "#084b3d";
  banner.style.color = "#ffffff";
  banner.style.padding = "10px 14px";
  banner.style.borderRadius = "999px";
  banner.style.font = "600 13px/1.2 'Segoe UI', sans-serif";
  banner.style.boxShadow = "0 12px 28px rgba(0, 0, 0, 0.22)";
  return banner;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function sendBackgroundMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(message) as Promise<BackgroundResponse>;
}

async function loadPopupState(): Promise<PopupState | null> {
  const response = await sendBackgroundMessage({ type: "GET_POPUP_STATE" });
  if (!response.ok || !("state" in response)) {
    return null;
  }

  return response.state;
}

async function sendPageAnalysisUpdate(): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "PAGE_ANALYSIS_UPDATE",
    url: window.location.href,
    analysis: analyzePage()
  });
}

class FocusPromptController {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private card: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private anchor: HTMLElement | null = null;
  private state: PopupState | null = null;
  private rafId = 0;

  constructor() {
    this.host = document.createElement("div");
    this.host.setAttribute("data-local-password-manager-prompt", "true");
    this.host.style.position = "fixed";
    this.host.style.zIndex = "2147483645";
    this.host.style.top = "0";
    this.host.style.left = "0";

    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          font-family: "Segoe UI", sans-serif;
          width: min(320px, calc(100vw - 24px));
          color: #172016;
          background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(244,247,240,0.98));
          border: 1px solid rgba(17, 24, 39, 0.08);
          border-radius: 18px;
          box-shadow: 0 24px 56px rgba(17, 24, 39, 0.18);
          backdrop-filter: blur(14px);
          padding: 14px;
          display: grid;
          gap: 12px;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #5d6a58;
          font-size: 10px;
        }
        .title {
          font-size: 16px;
          font-weight: 700;
          margin-top: 2px;
        }
        .subtitle,
        .status {
          color: #4d5a49;
          font-size: 12px;
          line-height: 1.45;
        }
        .status.warn { color: #a55a00; }
        .status.error { color: #a2261b; }
        .accounts {
          display: grid;
          gap: 8px;
        }
        .account {
          border: 1px solid rgba(17, 24, 39, 0.08);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.86);
          padding: 11px 12px;
          display: grid;
          gap: 3px;
          cursor: pointer;
          transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
        }
        .account:hover {
          transform: translateY(-1px);
          border-color: rgba(14, 107, 86, 0.35);
          box-shadow: 0 10px 24px rgba(8, 36, 31, 0.08);
        }
        .account__label {
          font-size: 13px;
          font-weight: 700;
        }
        .account__meta {
          color: #5d6a58;
          font-size: 12px;
        }
        .footer {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .btn {
          border: none;
          border-radius: 999px;
          padding: 9px 12px;
          cursor: pointer;
          font: 600 12px/1 "Segoe UI", sans-serif;
          transition: transform 120ms ease, opacity 120ms ease;
        }
        .btn:hover { transform: translateY(-1px); }
        .btn--primary {
          background: #0f7a61;
          color: #fff;
        }
        .btn--secondary {
          background: #e9efe5;
          color: #172016;
        }
      </style>
      <div class="card" role="dialog" aria-modal="false" aria-label="Autofill prompt">
        <div>
          <div class="eyebrow">Local Password Manager</div>
          <div class="title"></div>
        </div>
        <div class="subtitle"></div>
        <div class="body"></div>
        <div class="footer"></div>
        <div class="status"></div>
      </div>
    `;

    this.card = this.shadow.querySelector(".card") as HTMLDivElement;
    this.titleEl = this.shadow.querySelector(".title") as HTMLDivElement;
    this.subtitleEl = this.shadow.querySelector(".subtitle") as HTMLDivElement;
    this.bodyEl = this.shadow.querySelector(".body") as HTMLDivElement;
    this.footerEl = this.shadow.querySelector(".footer") as HTMLDivElement;
    this.statusEl = this.shadow.querySelector(".status") as HTMLDivElement;

    document.addEventListener("pointerdown", this.handleOutsidePointerDown, true);
    document.addEventListener("keydown", this.handleDocumentKeyDown, true);
    window.addEventListener("scroll", this.schedulePosition, true);
    window.addEventListener("resize", this.schedulePosition, true);
  }

  destroy(): void {
    this.hide();
    document.removeEventListener("pointerdown", this.handleOutsidePointerDown, true);
    document.removeEventListener("keydown", this.handleDocumentKeyDown, true);
    window.removeEventListener("scroll", this.schedulePosition, true);
    window.removeEventListener("resize", this.schedulePosition, true);
  }

  hide(): void {
    this.host.remove();
    this.anchor = null;
    this.state = null;
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  async maybeOpenForTarget(target: HTMLElement): Promise<void> {
    if (!isLikelyLoginField(target)) {
      this.hide();
      return;
    }

    const state = await loadPopupState();
    if (!state?.site) {
      this.hide();
      return;
    }

    const relevantFields = this.resolveRelevantFields(state);
    if (state.mapping) {
      const isMappedField =
        relevantFields.username === target || relevantFields.password === target;
      if (!isMappedField) {
        this.hide();
        return;
      }
    } else if (!target.matches("input, textarea")) {
      this.hide();
      return;
    }

    const viewModel = buildAutofillPromptViewModel(state);
    if (!viewModel.visible) {
      this.hide();
      return;
    }

    this.state = state;
    this.anchor = target;

    this.titleEl.textContent = viewModel.title;
    this.subtitleEl.textContent = viewModel.subtitle;
    this.statusEl.textContent = "";
    this.statusEl.className = "status";

    this.renderBody(state);
    this.renderFooter(state);

    if (!document.documentElement.contains(this.host)) {
      document.documentElement.append(this.host);
    }

    this.schedulePosition();
  }

  async refreshForActiveElement(): Promise<void> {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      await this.maybeOpenForTarget(active);
    } else {
      this.hide();
    }
  }

  private resolveRelevantFields(state: PopupState): {
    username: HTMLElement | null;
    password: HTMLElement | null;
  } {
    if (!state.mapping) {
      return { username: null, password: null };
    }

    const username = resolveMappedField(
      document,
      state.mapping.username,
      state.mapping.formFingerprint,
      "username"
    ).element;
    const password = resolveMappedField(
      document,
      state.mapping.password,
      state.mapping.formFingerprint,
      "password"
    ).element;

    return { username, password };
  }

  private renderBody(state: PopupState): void {
    if (!state.mapping) {
      this.bodyEl.innerHTML = "";
      return;
    }

    if (state.accounts.length <= 1) {
      const account = pickPrimaryAccount(state.accounts);
      this.bodyEl.innerHTML = account
        ? `
          <div class="accounts">
            <button class="account" type="button" data-account-id="${account.id}">
              <span class="account__label">${escapeHtml(account.label)}</span>
              <span class="account__meta">${escapeHtml(account.username)}</span>
            </button>
          </div>
        `
        : "";
    } else {
      this.bodyEl.innerHTML = `
        <div class="accounts">
          ${state.accounts
            .map(
              (account) => `
                <button class="account" type="button" data-account-id="${account.id}">
                  <span class="account__label">${escapeHtml(account.label)}</span>
                  <span class="account__meta">${escapeHtml(account.username)}</span>
                </button>
              `
            )
            .join("")}
        </div>
      `;
    }

    this.bodyEl.querySelectorAll<HTMLButtonElement>("[data-account-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const accountId = button.dataset.accountId;
        if (!accountId) {
          return;
        }
        await this.fill(accountId);
      });
    });
  }

  private renderFooter(state: PopupState): void {
    const actions: string[] = [];

    if (!state.mapping) {
      actions.push(`<button class="btn btn--primary" type="button" data-action="map">Map fields</button>`);
    } else {
      if (state.accounts.length === 1) {
        const account = state.accounts[0] as StoredAccount;
        actions.push(
          `<button class="btn btn--primary" type="button" data-action="fill" data-account-id="${account.id}">Fill now</button>`
        );
      }
      actions.push(`<button class="btn btn--secondary" type="button" data-action="map">Remap fields</button>`);
    }

    actions.push(`<button class="btn btn--secondary" type="button" data-action="close">Close</button>`);
    this.footerEl.innerHTML = actions.join("");

    this.footerEl.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.action;
        if (action === "map" && this.state?.site) {
          await this.startMapping(this.state.site.siteId);
        }
        if (action === "fill") {
          const accountId = button.dataset.accountId;
          if (accountId) {
            await this.fill(accountId);
          }
        }
        if (action === "close") {
          this.hide();
        }
      });
    });
  }

  private async startMapping(siteId: string): Promise<void> {
    const response = await sendBackgroundMessage({
      type: "START_FIELD_MAPPING",
      siteId
    });

    if (!response.ok) {
      this.setStatus(response.error, "error");
      return;
    }

    this.hide();
    this.setStatus("Click the username field, then the password field to save the mapping.", "warn");
  }

  private async fill(accountId: string, forceOverwrite = false): Promise<void> {
    if (!this.state?.site) {
      return;
    }

    const response = await sendBackgroundMessage({
      type: "FILL_DEMO_ACCOUNT",
      siteId: this.state.site.siteId,
      accountId,
      forceOverwrite
    });

    if (!response.ok || !("state" in response)) {
      this.setStatus(response.ok ? "Fill request failed." : response.error, "error");
      return;
    }

    this.state = response.state;
    const lastFill = response.state.lastFillResult;
    if (lastFill?.status === "requires-overwrite") {
      this.footerEl.innerHTML = `
        <button class="btn btn--primary" type="button" data-action="overwrite" data-account-id="${accountId}">
          Overwrite existing password
        </button>
        <button class="btn btn--secondary" type="button" data-action="close">
          Cancel
        </button>
      `;
      this.footerEl.querySelector<HTMLButtonElement>("[data-action='overwrite']")?.addEventListener("click", async () => {
        await this.fill(accountId, true);
      });
      this.footerEl.querySelector<HTMLButtonElement>("[data-action='close']")?.addEventListener("click", () => {
        this.hide();
      });
      this.setStatus(lastFill.message, "warn");
      return;
    }

    this.setStatus(lastFill?.message || "Fill completed.");
    window.setTimeout(() => this.hide(), 500);
  }

  private handleOutsidePointerDown = (event: PointerEvent) => {
    const path = event.composedPath();
    if (path.includes(this.host)) {
      return;
    }
    this.hide();
  };

  private handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      this.hide();
    }
  };

  private schedulePosition = () => {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
    this.rafId = window.requestAnimationFrame(() => this.position());
  };

  private position(): void {
    if (!this.anchor || !document.documentElement.contains(this.anchor) || !document.documentElement.contains(this.host)) {
      this.hide();
      return;
    }

    const rect = this.anchor.getBoundingClientRect();
    const cardRect = this.card.getBoundingClientRect();
    const width = cardRect.width || 320;
    const height = cardRect.height || 220;
    const left = Math.min(Math.max(rect.left, 12), window.innerWidth - width - 12);
    const preferredTop = rect.bottom + 10;
    const top =
      preferredTop + height < window.innerHeight
        ? preferredTop
        : Math.max(rect.top - height - 10, 12);

    this.host.style.transform = `translate(${left}px, ${top}px)`;
  }

  private setStatus(message: string, tone: "neutral" | "warn" | "error" = "neutral"): void {
    this.statusEl.textContent = message;
    this.statusEl.className = `status ${tone === "neutral" ? "" : tone}`.trim();
  }
}

function beginFieldMapping(siteId: string): void {
  if (mappingInProgress) {
    return;
  }

  mappingInProgress = true;
  promptController?.hide();

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "2147483646";
  overlay.style.pointerEvents = "none";
  overlay.style.background = "rgba(9, 33, 27, 0.06)";

  const highlight = document.createElement("div");
  highlight.style.position = "fixed";
  highlight.style.zIndex = "2147483647";
  highlight.style.border = "2px solid #0e6b56";
  highlight.style.borderRadius = "8px";
  highlight.style.pointerEvents = "none";
  highlight.style.background = "rgba(14, 107, 86, 0.12)";
  highlight.style.display = "none";

  const banner = createBanner("Select the username field. Press Esc to cancel.");

  document.documentElement.append(overlay, highlight, banner);

  let stage: "username" | "password" = "username";
  let usernameSelection: SaveFieldMappingPayload["username"] | null = null;
  let formFingerprint: SaveFieldMappingPayload["formFingerprint"] | null = null;

  const clear = () => {
    mappingInProgress = false;
    overlay.remove();
    highlight.remove();
    banner.remove();
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    cleanupOverlay = null;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isFillableInput(event.target)) {
      highlight.style.display = "none";
      return;
    }

    const rect = event.target.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.top = `${rect.top - 2}px`;
    highlight.style.left = `${rect.left - 2}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  };

  const handleClick = async (event: MouseEvent) => {
    if (!isFillableInput(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const bundle = buildSelectorBundle(event.target, stage);

    if (stage === "username") {
      usernameSelection = bundle;
      formFingerprint = buildFormFingerprint(event.target);
      stage = "password";
      banner.textContent = "Select the password field. Press Esc to cancel.";
      return;
    }

    if (!usernameSelection || !formFingerprint) {
      clear();
      return;
    }

    const payload: SaveFieldMappingPayload = {
      siteId,
      username: usernameSelection,
      password: bundle,
      formFingerprint
    };

    await chrome.runtime.sendMessage({
      type: "SAVE_FIELD_MAPPING_FROM_PAGE",
      payload
    });

    banner.textContent = "Field mapping saved. Focus the field again to autofill.";
    window.setTimeout(async () => {
      clear();
      await promptController?.refreshForActiveElement();
    }, 900);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      clear();
    }
  };

  cleanupOverlay = clear;
  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
}

async function handleFill(message: Extract<ContentMessage, { type: "FILL_FIELDS" }>): Promise<ContentResponse> {
  const { mapping, account, forceOverwrite } = message;
  const analysis = analyzePage();

  const usernameField = resolveMappedField(document, mapping.username, mapping.formFingerprint, "username");
  const passwordField = resolveMappedField(document, mapping.password, mapping.formFingerprint, "password");

  if (!usernameField.element || !passwordField.element) {
    return {
      ok: false,
      error: analysis.hasCrossOriginFrames
        ? "Login fields may be inside a cross-origin iframe, which the prototype does not support."
        : "Saved field mapping no longer resolves on this page."
    };
  }

  if (
    !(usernameField.element instanceof HTMLInputElement || usernameField.element instanceof HTMLTextAreaElement) ||
    !(passwordField.element instanceof HTMLInputElement || passwordField.element instanceof HTMLTextAreaElement)
  ) {
    return { ok: false, error: "Mapped nodes are not fillable inputs." };
  }

  if (passwordField.element.value && !forceOverwrite) {
    return {
      ok: true,
      status: "requires-overwrite",
      message: "The password field already contains a value. Confirm overwrite to continue.",
      usedFallback: usernameField.usedFallback || passwordField.usedFallback
    };
  }

  if (
    usernameField.element.hasAttribute("readonly") ||
    passwordField.element.hasAttribute("readonly") ||
    usernameField.element.hasAttribute("disabled") ||
    passwordField.element.hasAttribute("disabled")
  ) {
    return {
      ok: true,
      status: "unsupported",
      message: "The mapped inputs are read-only or disabled on this page.",
      usedFallback: usernameField.usedFallback || passwordField.usedFallback
    };
  }

  fillInput(usernameField.element, account.username);
  fillInput(passwordField.element, account.password);

  return {
    ok: true,
    status: "filled",
    message:
      usernameField.usedFallback || passwordField.usedFallback
        ? "Filled account values, but the saved selector drifted and should be remapped."
        : "Filled account values into the mapped login fields.",
    usedFallback: usernameField.usedFallback || passwordField.usedFallback
  };
}

function installSpaNavigationWatcher(): void {
  const notifyIfUrlChanged = () => {
    if (window.location.href === lastKnownUrl) {
      return;
    }

    lastKnownUrl = window.location.href;
    cleanupOverlay?.();
    promptController?.hide();
    void sendPageAnalysisUpdate();
    window.setTimeout(() => {
      void promptController?.refreshForActiveElement();
    }, 0);
  };

  const wrapHistoryMethod = (method: "pushState" | "replaceState") => {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      notifyIfUrlChanged();
      return result;
    };
  };

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("popstate", notifyIfUrlChanged);
  window.addEventListener("hashchange", notifyIfUrlChanged);
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  const respond = async (): Promise<ContentResponse> => {
    switch (message.type) {
      case "ANALYZE_PAGE":
        return {
          ok: true,
          ...analyzePage()
        };

      case "BEGIN_FIELD_MAPPING":
        if (window.top !== window.self) {
          return {
            ok: false,
            error: "Field mapping is only supported in the top-level page, not inside iframes."
          };
        }

        cleanupOverlay?.();
        beginFieldMapping(message.siteId);
        return { ok: true, accepted: true };

      case "FILL_FIELDS":
        return handleFill(message);

      default:
        return { ok: false, error: "Unsupported content message." };
    }
  };

  void respond().then(sendResponse);
  return true;
});

chrome.storage.onChanged.addListener(() => {
  void promptController?.refreshForActiveElement();
});

document.addEventListener("focusin", (event) => {
  if (!promptController) {
    promptController = new FocusPromptController();
  }

  if (event.target instanceof HTMLElement) {
    void promptController.maybeOpenForTarget(event.target);
  }
});

document.addEventListener("focusout", () => {
  const nextFocus = document.activeElement;
  if (!(nextFocus instanceof HTMLElement) || !isLikelyLoginField(nextFocus)) {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !isLikelyLoginField(active)) {
        promptController?.hide();
      }
    }, 0);
  }
});

installSpaNavigationWatcher();
void sendPageAnalysisUpdate();
