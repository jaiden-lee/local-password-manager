export type AuthIntent = "login" | "signup";

export interface AuthAttempt {
  intent: AuthIntent;
  identifier: string;
  password: string;
  confirmPassword: string;
  signature: string;
}

function textOf(element: Element | null): string {
  return (element?.textContent || "").trim().toLowerCase();
}

function fieldSignal(element: HTMLInputElement | HTMLTextAreaElement): string {
  return [
    element.name,
    element.id,
    element.getAttribute("autocomplete"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    textOf(element.closest("label"))
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isUsableTextField(element: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  const type = (element.getAttribute("type") || "text").toLowerCase();
  return ["text", "email", "search", "tel", "url", ""].includes(type);
}

function scoreIdentifierField(element: HTMLInputElement | HTMLTextAreaElement): number {
  const type = element instanceof HTMLInputElement ? (element.type || "").toLowerCase() : "text";
  const signal = fieldSignal(element);
  let score = 0;

  if (element.getAttribute("autocomplete") === "username") score += 8;
  if (type === "email") score += 6;
  if (signal.includes("email")) score += 5;
  if (signal.includes("username")) score += 5;
  if (signal.includes("user")) score += 3;
  if (signal.includes("login")) score += 2;
  if (signal.includes("phone")) score += 2;
  if (isUsableTextField(element)) score += 1;

  return score;
}

function closestAuthContainer(target: HTMLElement): HTMLElement | null {
  const form = target.closest("form");
  if (form) {
    return form;
  }

  let current: HTMLElement | null = target;
  while (current && current !== document.body) {
    if (current.querySelector("input[type='password']")) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

export function isLikelySubmitControl(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement) {
    const type = (element.type || "submit").toLowerCase();
    if (type === "submit") {
      return true;
    }
  }

  if (element instanceof HTMLInputElement) {
    const type = (element.type || "").toLowerCase();
    if (["submit", "button"].includes(type)) {
      return true;
    }
  }

  const signal = [
    textOf(element),
    element.getAttribute("aria-label")?.toLowerCase() || "",
    element.getAttribute("title")?.toLowerCase() || "",
    element.getAttribute("value")?.toLowerCase() || ""
  ].join(" ");

  return ["sign in", "log in", "login", "continue", "submit", "create account", "sign up", "register"].some(
    (keyword) => signal.includes(keyword)
  );
}

export function extractAuthAttemptFromContainer(container: ParentNode): AuthAttempt | null {
  const fields = Array.from(
    container.querySelectorAll("input, textarea")
  ).filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
  );

  const passwordFields = fields.filter(
    (field): field is HTMLInputElement =>
      field instanceof HTMLInputElement &&
      field.type.toLowerCase() === "password" &&
      !field.disabled &&
      !field.readOnly
  );

  if (!passwordFields.length) {
    return null;
  }

  const identifierField = fields
    .filter((field) => isUsableTextField(field) && !field.disabled && !field.readOnly)
    .sort((left, right) => scoreIdentifierField(right) - scoreIdentifierField(left))[0] ?? null;

  const identifier = identifierField?.value.trim() || "";
  if (!identifier) {
    return null;
  }

  const newPasswordField =
    passwordFields.find((field) => (field.autocomplete || "").toLowerCase() === "new-password") ?? null;
  const confirmField =
    passwordFields.find((field, index) => index > 0 && /confirm|repeat|verify/.test(fieldSignal(field))) ?? null;
  const intent: AuthIntent =
    passwordFields.length >= 2 || newPasswordField !== null || confirmField !== null ? "signup" : "login";

  const primaryPasswordField =
    intent === "signup"
      ? newPasswordField ?? passwordFields[0]
      : passwordFields.find((field) => (field.autocomplete || "").toLowerCase() === "current-password") ??
        passwordFields[0];

  const confirmPassword =
    intent === "signup"
      ? (confirmField ?? passwordFields.find((field) => field !== primaryPasswordField) ?? null)?.value.trim() || ""
      : "";
  const password = primaryPasswordField?.value.trim() || "";

  if (!password) {
    return null;
  }

  if (intent === "signup" && confirmPassword && password !== confirmPassword) {
    return null;
  }

  const formElement = container instanceof HTMLFormElement ? container : primaryPasswordField.form;
  const formKey =
    formElement?.getAttribute("action") ||
    (container instanceof HTMLElement ? container.getAttribute("id") || container.className : "page");

  return {
    intent,
    identifier,
    password,
    confirmPassword,
    signature: [intent, identifier.toLowerCase(), formKey || "page"].join("::")
  };
}

export function extractAuthAttemptFromTarget(target: EventTarget | null): AuthAttempt | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const container = closestAuthContainer(target);
  if (!container) {
    return null;
  }

  return extractAuthAttemptFromContainer(container);
}
