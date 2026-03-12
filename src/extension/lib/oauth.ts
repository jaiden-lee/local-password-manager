const OAUTH_PROVIDERS = [
  { key: "google", patterns: ["google", "gsi", "sign in with google", "continue with google"] },
  { key: "microsoft", patterns: ["microsoft", "azure", "live.com", "continue with microsoft"] },
  { key: "apple", patterns: ["apple", "sign in with apple", "continue with apple"] },
  { key: "github", patterns: ["github", "continue with github", "sign in with github"] },
  { key: "generic-sso", patterns: ["single sign-on", "sso", "federated", "enterprise login"] }
];

export function detectOAuthProviders(root: ParentNode): string[] {
  const textSamples = Array.from(
    root.querySelectorAll("button, a, input[type='button'], input[type='submit']")
  )
    .map((element) => {
      const text = element.textContent?.trim() || "";
      const value = (element as HTMLInputElement).value || "";
      const ariaLabel = element.getAttribute("aria-label") || "";
      const title = element.getAttribute("title") || "";
      return [text, value, ariaLabel, title].join(" ").toLowerCase();
    })
    .join(" || ");

  return OAUTH_PROVIDERS.filter((provider) =>
    provider.patterns.some((pattern) => textSamples.includes(pattern))
  ).map((provider) => provider.key);
}

