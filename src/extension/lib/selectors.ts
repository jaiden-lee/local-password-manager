import type {
  FieldFingerprint,
  FieldMapping,
  FormFingerprint,
  InputKind,
  SelectorBundle
} from "./types";

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function getLabelText(element: Element): string {
  const htmlElement = element as HTMLElement;
  const ariaLabel = htmlElement.getAttribute("aria-label");
  if (ariaLabel) {
    return ariaLabel.trim();
  }

  const labelledBy = htmlElement.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() || "")
      .filter(Boolean)
      .join(" ");
    if (text) {
      return text;
    }
  }

  const id = htmlElement.getAttribute("id");
  if (id) {
    const explicitLabel = element.ownerDocument.querySelector(`label[for="${escapeCssIdentifier(id)}"]`);
    if (explicitLabel?.textContent?.trim()) {
      return explicitLabel.textContent.trim();
    }
  }

  const wrappingLabel = element.closest("label");
  return wrappingLabel?.textContent?.trim() || "";
}

export function buildFieldFingerprint(element: HTMLElement): FieldFingerprint {
  return {
    tagName: element.tagName.toLowerCase(),
    type: (element.getAttribute("type") || "").toLowerCase(),
    name: element.getAttribute("name") || "",
    autocomplete: element.getAttribute("autocomplete") || "",
    placeholder: element.getAttribute("placeholder") || "",
    ariaLabel: element.getAttribute("aria-label") || "",
    labelText: getLabelText(element)
  };
}

export function buildFormFingerprint(element: HTMLElement): FormFingerprint {
  const form = element.closest("form");
  const scope = form ?? element.ownerDocument;
  const inputs = Array.from(scope.querySelectorAll("input, textarea"));
  const passwordFieldCount = inputs.filter(
    (input) => (input.getAttribute("type") || "").toLowerCase() === "password"
  ).length;

  return {
    actionPath: form ? new URL(form.getAttribute("action") || element.ownerDocument.URL, element.ownerDocument.URL).pathname : "",
    method: form?.getAttribute("method")?.toLowerCase() || "get",
    fieldCount: inputs.length,
    passwordFieldCount
  };
}

function getNthOfTypeSelector(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const siblings = Array.from(element.parentElement?.children || []).filter(
    (sibling) => sibling.tagName === element.tagName
  );
  const index = siblings.indexOf(element) + 1;
  return `${tagName}:nth-of-type(${index})`;
}

export function buildFallbackPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.tagName.toLowerCase() !== "html") {
    segments.unshift(getNthOfTypeSelector(current));
    current = current.parentElement;
  }

  return `html > ${segments.join(" > ")}`;
}

function candidateSelectors(element: HTMLElement, kind: InputKind): string[] {
  const tagName = element.tagName.toLowerCase();
  const type = element.getAttribute("type")?.toLowerCase() || "";
  const id = element.getAttribute("id");
  const name = element.getAttribute("name");
  const autocomplete = element.getAttribute("autocomplete");
  const ariaLabel = element.getAttribute("aria-label");
  const placeholder = element.getAttribute("placeholder");
  const dataset = Object.entries(element.dataset);

  const selectors = [
    id ? `#${escapeCssIdentifier(id)}` : "",
    id ? `${tagName}#${escapeCssIdentifier(id)}` : "",
    name ? `${tagName}[name="${escapeCssIdentifier(name)}"]` : "",
    name && type ? `${tagName}[name="${escapeCssIdentifier(name)}"][type="${escapeCssIdentifier(type)}"]` : "",
    autocomplete ? `${tagName}[autocomplete="${escapeCssIdentifier(autocomplete)}"]` : "",
    ariaLabel ? `${tagName}[aria-label="${escapeCssIdentifier(ariaLabel)}"]` : "",
    placeholder ? `${tagName}[placeholder="${escapeCssIdentifier(placeholder)}"]` : "",
    `${tagName}${type ? `[type="${escapeCssIdentifier(type)}"]` : ""}`
  ];

  for (const [key, value] of dataset) {
    selectors.push(`${tagName}[data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${escapeCssIdentifier(value)}"]`);
  }

  if (kind === "password" && !type) {
    selectors.unshift(`${tagName}[autocomplete="current-password"]`);
  }

  return selectors.filter(Boolean);
}

function pickUniqueSelector(element: HTMLElement, kind: InputKind): string {
  const selectors = candidateSelectors(element, kind);
  for (const selector of selectors) {
    try {
      const matches = element.ownerDocument.querySelectorAll(selector);
      if (matches.length === 1 && matches[0] === element) {
        return selector;
      }
    } catch {
      continue;
    }
  }

  return buildFallbackPath(element);
}

export function buildSelectorBundle(element: HTMLElement, kind: InputKind): SelectorBundle {
  return {
    selector: pickUniqueSelector(element, kind),
    fallbackPath: buildFallbackPath(element),
    fingerprint: buildFieldFingerprint(element)
  };
}

export function resolveFallbackPath(root: ParentNode, fallbackPath: string): HTMLElement | null {
  try {
    return root.querySelector(fallbackPath) as HTMLElement | null;
  } catch {
    return null;
  }
}

function scoreFingerprint(
  candidate: FieldFingerprint,
  target: FieldFingerprint,
  exactTypeRequired: boolean
): number {
  let score = 0;
  if (candidate.tagName === target.tagName) score += 2;
  if (candidate.type === target.type) score += 3;
  if (candidate.name && candidate.name === target.name) score += 2;
  if (candidate.autocomplete && candidate.autocomplete === target.autocomplete) score += 2;
  if (candidate.placeholder && candidate.placeholder === target.placeholder) score += 1;
  if (candidate.ariaLabel && candidate.ariaLabel === target.ariaLabel) score += 2;
  if (candidate.labelText && candidate.labelText === target.labelText) score += 2;

  if (exactTypeRequired && target.type && candidate.type !== target.type) {
    return -1;
  }

  return score;
}

function scoreFormFingerprint(candidate: FormFingerprint, target: FormFingerprint): number {
  let score = 0;
  if (candidate.actionPath && candidate.actionPath === target.actionPath) score += 3;
  if (candidate.method && candidate.method === target.method) score += 1;
  if (candidate.passwordFieldCount === target.passwordFieldCount) score += 2;
  if (Math.abs(candidate.fieldCount - target.fieldCount) <= 1) score += 1;
  return score;
}

function findBestForm(root: Document, target: FormFingerprint): ParentNode {
  const forms = Array.from(root.querySelectorAll("form"));
  if (!forms.length) {
    return root;
  }

  let bestScore = -1;
  let bestForm: HTMLFormElement | null = null;

  for (const form of forms) {
    const fingerprint = buildFormFingerprint(form as unknown as HTMLElement);
    const score = scoreFormFingerprint(fingerprint, target);
    if (score > bestScore) {
      bestScore = score;
      bestForm = form;
    }
  }

  return bestScore >= 2 && bestForm ? bestForm : root;
}

export function resolveMappedField(
  root: Document,
  bundle: SelectorBundle,
  formFingerprint: FormFingerprint,
  kind: InputKind
): { element: HTMLElement | null; usedFallback: boolean } {
  const bySelector = root.querySelector(bundle.selector) as HTMLElement | null;
  if (bySelector) {
    return { element: bySelector, usedFallback: false };
  }

  const byFallbackPath = resolveFallbackPath(root, bundle.fallbackPath);
  if (byFallbackPath) {
    return { element: byFallbackPath, usedFallback: true };
  }

  const scope = findBestForm(root, formFingerprint);
  const candidates = Array.from(scope.querySelectorAll("input, textarea")) as HTMLElement[];
  let bestMatch: HTMLElement | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const score = scoreFingerprint(buildFieldFingerprint(candidate), bundle.fingerprint, kind === "password");
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  if (bestScore >= 4) {
    return { element: bestMatch, usedFallback: true };
  }

  return { element: null, usedFallback: false };
}

function scorePasswordField(element: HTMLInputElement): number {
  let score = 0;
  const autocomplete = (element.autocomplete || "").toLowerCase();
  const signal = [
    element.name,
    element.id,
    element.placeholder,
    element.getAttribute("aria-label") || "",
    getLabelText(element)
  ]
    .join(" ")
    .toLowerCase();

  score += 10;
  if (autocomplete === "current-password") score += 8;
  if (autocomplete === "password") score += 6;
  if (signal.includes("password")) score += 4;
  if (signal.includes("current")) score += 2;
  if (signal.includes("confirm") || signal.includes("repeat") || signal.includes("verify")) score -= 6;
  if (autocomplete === "new-password") score -= 6;
  return score;
}

function scoreUsernameField(element: HTMLInputElement | HTMLTextAreaElement): number {
  const type = element instanceof HTMLInputElement ? (element.type || "text").toLowerCase() : "text";
  const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();
  const signal = [
    element.getAttribute("name") || "",
    element.getAttribute("id") || "",
    element.getAttribute("placeholder") || "",
    element.getAttribute("aria-label") || "",
    getLabelText(element)
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  if (autocomplete === "username") score += 10;
  if (type === "email") score += 8;
  if (signal.includes("email")) score += 7;
  if (signal.includes("username")) score += 7;
  if (signal.includes("user")) score += 4;
  if (signal.includes("login")) score += 3;
  if (signal.includes("phone")) score += 2;
  if (["text", "email", "search", "tel", "url"].includes(type)) score += 1;
  return score;
}

function getRelevantScope(root: Document, anchor?: HTMLElement | null): ParentNode {
  const form = anchor?.closest("form");
  if (form) {
    return form;
  }

  if (anchor?.parentElement?.querySelector("input[type='password']")) {
    return anchor.parentElement;
  }

  const forms = Array.from(root.querySelectorAll("form"));
  const authForm = forms.find((formElement) => formElement.querySelector("input[type='password']"));
  return authForm ?? root;
}

export function inferAutofillMapping(
  root: Document,
  siteId: string,
  anchor?: HTMLElement | null
): FieldMapping | null {
  const scope = getRelevantScope(root, anchor);
  const inputs = Array.from(scope.querySelectorAll("input, textarea")).filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
  );

  const passwordCandidates = inputs
    .filter((element): element is HTMLInputElement => element instanceof HTMLInputElement && element.type.toLowerCase() === "password")
    .sort((left, right) => scorePasswordField(right) - scorePasswordField(left));

  const passwordField = passwordCandidates[0] ?? null;
  if (!passwordField || scorePasswordField(passwordField) < 8) {
    return null;
  }

  const usernameCandidates = inputs
    .filter((element) => element !== passwordField)
    .filter((element) => {
      if (element instanceof HTMLTextAreaElement) {
        return true;
      }
      const type = (element.type || "text").toLowerCase();
      return ["text", "email", "search", "tel", "url"].includes(type);
    })
    .sort((left, right) => scoreUsernameField(right) - scoreUsernameField(left));

  const usernameField =
    usernameCandidates.find((candidate) => scoreUsernameField(candidate) >= 3) ??
    (() => {
      const passwordIndex = inputs.indexOf(passwordField);
      return passwordIndex > 0 ? inputs[passwordIndex - 1] : null;
    })();

  if (!usernameField) {
    return null;
  }

  return {
    mappingId: `inferred_${siteId}`,
    siteId,
    username: buildSelectorBundle(usernameField as HTMLElement, "username"),
    password: buildSelectorBundle(passwordField, "password"),
    formFingerprint: buildFormFingerprint(passwordField),
    lastVerifiedAt: new Date().toISOString(),
    stale: false
  };
}
