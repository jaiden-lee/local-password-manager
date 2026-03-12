export function countCandidateLoginForms(root: Document): number {
  const forms = Array.from(root.querySelectorAll("form"));
  const qualifyingForms = forms.filter((form) => {
    const inputs = Array.from(form.querySelectorAll("input, textarea"));
    const hasPassword = inputs.some(
      (input) => (input.getAttribute("type") || "").toLowerCase() === "password"
    );
    const hasUsernameLike = inputs.some((input) => {
      const autocomplete = input.getAttribute("autocomplete") || "";
      const type = (input.getAttribute("type") || "").toLowerCase();
      return ["username", "email"].includes(autocomplete) || ["email", "text"].includes(type);
    });

    return hasPassword || (hasUsernameLike && inputs.length >= 2);
  });

  if (qualifyingForms.length) {
    return qualifyingForms.length;
  }

  const standalonePasswordFields = root.querySelectorAll("input[type='password']").length;
  return standalonePasswordFields ? 1 : 0;
}

export function detectCrossOriginFrames(root: Document): boolean {
  const pageOrigin = new URL(root.URL).origin;
  return Array.from(root.querySelectorAll("iframe"))
    .map((iframe) => iframe.getAttribute("src") || "")
    .filter(Boolean)
    .some((src) => {
      try {
        return new URL(src, root.URL).origin !== pageOrigin;
      } catch {
        return false;
      }
    });
}

function setElementValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

export function fillInput(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  element.focus();
  setElementValue(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.blur();
}

