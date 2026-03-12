import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentMessage,
  ContentResponse
} from "./lib/messages";
import { buildInlineViewModel } from "./lib/inlineAutofill";
import { countCandidateLoginForms, detectCrossOriginFrames, fillInput } from "./lib/dom";
import { detectOAuthProviders } from "./lib/oauth";
import {
  buildFormFingerprint,
  buildSelectorBundle,
  resolveMappedField
} from "./lib/selectors";
import type { PopupState, SaveFieldMappingPayload } from "./lib/types";

let mappingInProgress = false;
let cleanupOverlay: (() => void) | null = null;
let inlineController: InlineAutofillController | null = null;

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

function pickSetupAnchor(): HTMLElement | null {
  const passwordField =
    (document.querySelector("input[type='password']") as HTMLElement | null) ?? null;
  if (passwordField) {
    return passwordField;
  }

  return (
    (document.querySelector("input[autocomplete='username']") as HTMLElement | null) ??
    (document.querySelector("input[type='email']") as HTMLElement | null) ??
    (document.querySelector("input[type='text']") as HTMLElement | null) ??
    null
  );
}

class InlineAutofillController {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private root: HTMLDivElement;
  private trigger: HTMLButtonElement;
  private panel: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private accountListEl: HTMLDivElement;
  private footerEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private state: PopupState | null = null;
  private anchor: HTMLElement | null = null;
  private menuOpen = false;
  private rafId = 0;

  constructor() {
    this.host = document.createElement("div");
    this.host.setAttribute("data-local-password-manager-inline", "true");
    this.host.style.position = "fixed";
    this.host.style.zIndex = "2147483645";
    this.host.style.top = "0";
    this.host.style.left = "0";

    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .shell {
          font-family: "Segoe UI", sans-serif;
          position: fixed;
          inset: 0 auto auto 0;
          pointer-events: none;
        }
        .trigger {
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid rgba(7, 45, 36, 0.12);
          background: linear-gradient(135deg, #0f7a61 0%, #084b3d 100%);
          color: #fff;
          border-radius: 999px;
          padding: 10px 14px;
          box-shadow: 0 14px 32px rgba(8, 36, 31, 0.24);
          cursor: pointer;
          transition: transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease;
          font: 600 13px/1 "Segoe UI", sans-serif;
        }
        .trigger:hover,
        .trigger[data-open="true"] {
          transform: translateY(-1px) scale(1.02);
          box-shadow: 0 18px 36px rgba(8, 36, 31, 0.28);
        }
        .trigger__icon {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          display: inline-grid;
          place-items: center;
          background: rgba(255, 255, 255, 0.14);
          font-size: 12px;
        }
        .trigger__meta {
          display: grid;
          gap: 2px;
          text-align: left;
        }
        .trigger__label {
          font-size: 13px;
          font-weight: 700;
        }
        .trigger__hint {
          font-size: 11px;
          opacity: 0.86;
        }
        .panel {
          pointer-events: auto;
          margin-top: 10px;
          min-width: 280px;
          max-width: 320px;
          padding: 14px;
          border-radius: 18px;
          background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,248,242,0.98));
          color: #172016;
          border: 1px solid rgba(17, 24, 39, 0.08);
          box-shadow: 0 24px 56px rgba(17, 24, 39, 0.18);
          backdrop-filter: blur(14px);
          transform-origin: top left;
          transform: translateY(-4px) scale(0.98);
          opacity: 0;
          transition: opacity 160ms ease, transform 160ms ease;
          display: none;
        }
        .panel[data-open="true"] {
          display: block;
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #5d6a58;
          font-size: 10px;
          margin-bottom: 4px;
        }
        .title {
          font-weight: 700;
          font-size: 16px;
          margin-bottom: 4px;
        }
        .subtitle,
        .status {
          color: #4d5a49;
          font-size: 12px;
          line-height: 1.45;
        }
        .status {
          margin-top: 10px;
        }
        .status.warn { color: #a55a00; }
        .status.error { color: #a2261b; }
        .accounts {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }
        .account {
          border: 1px solid rgba(17, 24, 39, 0.08);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.88);
          padding: 11px 12px;
          display: grid;
          gap: 3px;
          cursor: pointer;
          transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
        }
        .account:hover {
          transform: translateY(-1px);
          border-color: rgba(14, 107, 86, 0.35);
          box-shadow: 0 10px 24px rgba(8, 36, 31, 0.08);
        }
        .account__label {
          font-weight: 700;
          font-size: 13px;
        }
        .account__meta {
          color: #5d6a58;
          font-size: 12px;
        }
        .footer {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }
        .row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
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
      <div class="shell">
        <button class="trigger" type="button" aria-expanded="false">
          <span class="trigger__icon">🔐</span>
          <span class="trigger__meta">
            <span class="trigger__label">Fill account</span>
            <span class="trigger__hint">Local Password Manager</span>
          </span>
        </button>
        <div class="panel" data-open="false">
          <div class="eyebrow">Inline Autofill</div>
          <div class="title"></div>
          <div class="subtitle"></div>
          <div class="accounts"></div>
          <div class="footer"></div>
          <div class="status"></div>
        </div>
      </div>
    `;

    this.root = this.shadow.querySelector(".shell") as HTMLDivElement;
    this.trigger = this.shadow.querySelector(".trigger") as HTMLButtonElement;
    this.panel = this.shadow.querySelector(".panel") as HTMLDivElement;
    this.titleEl = this.shadow.querySelector(".title") as HTMLDivElement;
    this.subtitleEl = this.shadow.querySelector(".subtitle") as HTMLDivElement;
    this.accountListEl = this.shadow.querySelector(".accounts") as HTMLDivElement;
    this.footerEl = this.shadow.querySelector(".footer") as HTMLDivElement;
    this.statusEl = this.shadow.querySelector(".status") as HTMLDivElement;

    this.trigger.addEventListener("click", () => {
      this.setMenuOpen(!this.menuOpen);
    });

    document.addEventListener("pointerdown", this.handleOutsidePointerDown, true);
    document.addEventListener("keydown", this.handleDocumentKeyDown, true);
    window.addEventListener("scroll", this.schedulePosition, true);
    window.addEventListener("resize", this.schedulePosition, true);
  }

  destroy(): void {
    this.host.remove();
    document.removeEventListener("pointerdown", this.handleOutsidePointerDown, true);
    document.removeEventListener("keydown", this.handleDocumentKeyDown, true);
    window.removeEventListener("scroll", this.schedulePosition, true);
    window.removeEventListener("resize", this.schedulePosition, true);
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
  }

  hide(): void {
    this.state = null;
    this.anchor = null;
    this.setMenuOpen(false);
    this.host.remove();
  }

  async refresh(): Promise<void> {
    const state = await loadPopupState();
    if (!state?.site) {
      this.hide();
      return;
    }

    const viewModel = buildInlineViewModel(state);
    if (!viewModel.visible) {
      this.hide();
      return;
    }

    const anchor = this.resolveAnchor(state);
    if (!anchor) {
      this.hide();
      return;
    }

    this.state = state;
    this.anchor = anchor;

    if (!document.documentElement.contains(this.host)) {
      document.documentElement.append(this.host);
    }

    const labelEl = this.shadow.querySelector(".trigger__label") as HTMLSpanElement;
    const hintEl = this.shadow.querySelector(".trigger__hint") as HTMLSpanElement;
    labelEl.textContent = viewModel.triggerLabel;
    hintEl.textContent = state.site.displayName;

    this.titleEl.textContent = state.site.displayName;
    this.subtitleEl.textContent = viewModel.helperText;
    this.statusEl.textContent = "";
    this.statusEl.className = "status";

    this.renderAccounts(state);
    this.renderFooter(state);
    this.schedulePosition();
  }

  private handleOutsidePointerDown = (event: PointerEvent) => {
    const path = event.composedPath();
    if (path.includes(this.host)) {
      return;
    }
    this.setMenuOpen(false);
  };

  private handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      this.setMenuOpen(false);
    }
  };

  private schedulePosition = () => {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
    this.rafId = window.requestAnimationFrame(() => this.position());
  };

  private position(): void {
    if (!this.anchor || !document.documentElement.contains(this.anchor)) {
      this.hide();
      return;
    }

    const rect = this.anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const panelWidth = 320;
    const left = Math.min(Math.max(rect.right - 164, 12), viewportWidth - panelWidth - 12);
    const top = Math.max(rect.top - 8, 12);

    this.root.style.transform = `translate(${left}px, ${top}px)`;
  }

  private setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.trigger.dataset.open = String(open);
    this.trigger.setAttribute("aria-expanded", String(open));
    this.panel.dataset.open = String(open);
  }

  private resolveAnchor(state: PopupState): HTMLElement | null {
    if (!state.mapping) {
      return pickSetupAnchor();
    }

    const passwordField = resolveMappedField(document, state.mapping.password, state.mapping.formFingerprint, "password");
    if (passwordField.element) {
      return passwordField.element;
    }

    const usernameField = resolveMappedField(document, state.mapping.username, state.mapping.formFingerprint, "username");
    return usernameField.element;
  }

  private renderAccounts(state: PopupState): void {
    if (!state.mapping || !state.accounts.length) {
      this.accountListEl.innerHTML = "";
      return;
    }

    this.accountListEl.innerHTML = state.accounts
      .map(
        (account) => `
          <button class="account" type="button" data-account-id="${account.id}">
            <span class="account__label">${escapeHtml(account.label)}</span>
            <span class="account__meta">${escapeHtml(account.username)}</span>
          </button>
        `
      )
      .join("");

    this.accountListEl.querySelectorAll<HTMLButtonElement>("[data-account-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const accountId = button.dataset.accountId;
        if (!accountId || !this.state?.site) {
          return;
        }
        await this.fill(accountId);
      });
    });
  }

  private renderFooter(state: PopupState): void {
    const actions: string[] = [];

    if (!state.mapping) {
      actions.push(`<button class="btn btn--primary" type="button" data-action="map">Map Fields</button>`);
    } else {
      actions.push(`<button class="btn btn--secondary" type="button" data-action="map">Remap Fields</button>`);
      actions.push(`<button class="btn btn--secondary" type="button" data-action="refresh">Refresh</button>`);
    }

    this.footerEl.innerHTML = `<div class="row">${actions.join("")}</div>`;

    this.footerEl.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.action;
        if (action === "map" && this.state?.site) {
          await this.startMapping(this.state.site.siteId);
        }
        if (action === "refresh") {
          await this.refresh();
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

    this.setMenuOpen(false);
    this.setStatus("Click the username field, then the password field to save the mapping.");
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
        <div class="row">
          <button class="btn btn--primary" type="button" data-action="overwrite" data-account-id="${accountId}">
            Overwrite existing password
          </button>
          <button class="btn btn--secondary" type="button" data-action="dismiss">Cancel</button>
        </div>
      `;
      this.footerEl.querySelector<HTMLButtonElement>("[data-action='overwrite']")?.addEventListener("click", async () => {
        await this.fill(accountId, true);
      });
      this.footerEl.querySelector<HTMLButtonElement>("[data-action='dismiss']")?.addEventListener("click", async () => {
        this.setMenuOpen(false);
        if (this.state) {
          this.renderFooter(this.state);
        }
      });
      this.setStatus(lastFill.message, "warn");
      return;
    }

    const tone = lastFill?.status === "filled" ? "neutral" : "warn";
    this.setStatus(lastFill?.message || "Fill completed.", tone);
    this.setMenuOpen(false);
    await this.refresh();
  }

  private setStatus(message: string, tone: "neutral" | "warn" | "error" = "neutral"): void {
    this.statusEl.textContent = message;
    this.statusEl.className = `status ${tone === "neutral" ? "" : tone}`.trim();
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function beginFieldMapping(siteId: string): void {
  if (mappingInProgress) {
    return;
  }

  mappingInProgress = true;
  inlineController?.hide();

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
    void inlineController?.refresh();
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

    banner.textContent = "Field mapping saved. Autofill is ready on this page.";
    window.setTimeout(clear, 900);
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

async function refreshInlineUi(): Promise<void> {
  if (window.top !== window.self) {
    return;
  }

  inlineController ??= new InlineAutofillController();
  await inlineController.refresh();
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
  void refreshInlineUi();
});

document.addEventListener("focusin", () => {
  void refreshInlineUi();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refreshInlineUi();
  }
});

void chrome.runtime.sendMessage({
  type: "PAGE_ANALYSIS_UPDATE",
  url: window.location.href,
  analysis: analyzePage()
});

void refreshInlineUi();
