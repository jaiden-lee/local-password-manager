import type { ContentMessage, ContentResponse } from "./lib/messages";
import { countCandidateLoginForms, detectCrossOriginFrames, fillInput } from "./lib/dom";
import { detectOAuthProviders } from "./lib/oauth";
import {
  buildFormFingerprint,
  buildSelectorBundle,
  resolveMappedField
} from "./lib/selectors";
import type { SaveFieldMappingPayload } from "./lib/types";

let mappingInProgress = false;
let cleanupOverlay: (() => void) | null = null;

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

function beginFieldMapping(siteId: string): void {
  if (mappingInProgress) {
    return;
  }

  mappingInProgress = true;

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

    banner.textContent = "Field mapping saved. Re-open the popup to fill.";
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
    status:
      usernameField.usedFallback || passwordField.usedFallback ? "unsupported" : "filled",
    message:
      usernameField.usedFallback || passwordField.usedFallback
        ? "Filled account values, but the saved selector drifted and should be remapped."
        : "Filled account values into the mapped login fields.",
    usedFallback: usernameField.usedFallback || passwordField.usedFallback
  };
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

void chrome.runtime.sendMessage({
  type: "PAGE_ANALYSIS_UPDATE",
  url: window.location.href,
  analysis: analyzePage()
});
