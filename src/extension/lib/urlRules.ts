import type { SiteRecord, UrlRule } from "./types";

export function normalizePathPrefix(pathPrefix: string): string {
  const trimmed = (pathPrefix || "/").trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") && withLeadingSlash.length > 1
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

export function normalizeUrl(rawUrl: string): UrlRule | null {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    const normalizedPath = normalizePathPrefix(url.pathname || "/");
    return {
      origin: url.origin,
      pathPrefix: normalizedPath
    };
  } catch {
    return null;
  }
}

export function pathMatches(currentPath: string, rulePathPrefix: string): boolean {
  const path = normalizePathPrefix(currentPath);
  const prefix = normalizePathPrefix(rulePathPrefix);

  if (prefix === "/") {
    return true;
  }

  return path === prefix || path.startsWith(`${prefix}/`);
}

export function findMatchingSite(sites: SiteRecord[], rawUrl: string): SiteRecord | null {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return null;
  }

  const matches = sites.filter(
    (site) =>
      site.origin === normalized.origin &&
      pathMatches(normalized.pathPrefix, site.pathPrefix)
  );

  if (!matches.length) {
    return null;
  }

  return matches.sort((left, right) => right.pathPrefix.length - left.pathPrefix.length)[0];
}

