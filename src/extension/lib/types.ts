export const STORAGE_VERSION = 1;

export type LoginMethod = "password" | "oauth" | "mixed";
export type InputKind = "username" | "password";

export interface UrlRule {
  origin: string;
  pathPrefix: string;
}

export interface SiteRecord extends UrlRule {
  siteId: string;
  displayName: string;
  loginMethod: LoginMethod;
  notes: string;
}

export interface StoredAccount {
  id: string;
  siteId: string;
  label: string;
  username: string;
  password: string;
  isDemo: boolean;
}

export interface FieldFingerprint {
  tagName: string;
  type: string;
  name: string;
  autocomplete: string;
  placeholder: string;
  ariaLabel: string;
  labelText: string;
}

export interface FormFingerprint {
  actionPath: string;
  method: string;
  fieldCount: number;
  passwordFieldCount: number;
}

export interface SelectorBundle {
  selector: string;
  fallbackPath: string;
  fingerprint: FieldFingerprint;
}

export interface FieldMapping {
  mappingId: string;
  siteId: string;
  username: SelectorBundle;
  password: SelectorBundle;
  formFingerprint: FormFingerprint;
  lastVerifiedAt: string;
  stale: boolean;
}

export interface FillRequest {
  siteId: string;
  accountId: string;
  forceOverwrite?: boolean;
}

export interface FillResult {
  siteId: string;
  accountId: string;
  status: "filled" | "requires-overwrite" | "error" | "unsupported";
  message: string;
  timestamp: string;
  usedFallback: boolean;
}

export interface PageDetectionResult {
  matchesRule: boolean;
  hasMapping: boolean;
  oauthProviders: string[];
  candidateForms: number;
  hasCrossOriginFrames: boolean;
}

export interface ExtensionStorage {
  version: number;
  sites: SiteRecord[];
  accounts: StoredAccount[];
  mappings: FieldMapping[];
  lastFillResult: FillResult | null;
}

export interface PopupState {
  currentUrl: string;
  normalizedUrl: UrlRule | null;
  site: SiteRecord | null;
  mapping: FieldMapping | null;
  accounts: StoredAccount[];
  detection: PageDetectionResult;
  lastFillResult: FillResult | null;
}

export interface AnalyzePageResponse {
  oauthProviders: string[];
  candidateForms: number;
  hasCrossOriginFrames: boolean;
}

export interface SaveFieldMappingPayload {
  siteId: string;
  username: SelectorBundle;
  password: SelectorBundle;
  formFingerprint: FormFingerprint;
}

export interface FillFieldsResponse {
  status: FillResult["status"];
  message: string;
  usedFallback: boolean;
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

