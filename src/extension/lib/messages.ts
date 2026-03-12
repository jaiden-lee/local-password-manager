import type {
  AnalyzePageResponse,
  FieldMapping,
  FillFieldsResponse,
  PopupState,
  SaveFieldMappingPayload,
  SiteRecord,
  StoredAccount
} from "./types";

export type BackgroundMessage =
  | { type: "GET_POPUP_STATE"; tabId?: number }
  | { type: "SAVE_SITE_RULE"; tabId?: number; displayName: string; pathPrefix: string }
  | { type: "START_FIELD_MAPPING"; tabId?: number; siteId: string }
  | { type: "CLEAR_MAPPING"; siteId: string }
  | { type: "SAVE_DEMO_ACCOUNT"; siteId: string; label: string; username: string; password: string }
  | { type: "FILL_DEMO_ACCOUNT"; tabId?: number; siteId: string; accountId: string; forceOverwrite?: boolean }
  | { type: "SAVE_FIELD_MAPPING_FROM_PAGE"; payload: SaveFieldMappingPayload }
  | { type: "PAGE_ANALYSIS_UPDATE"; url: string; analysis: AnalyzePageResponse };

export type BackgroundResponse =
  | { ok: true; state: PopupState }
  | { ok: true; accepted: true }
  | { ok: true; site: SiteRecord }
  | { ok: true; account: StoredAccount }
  | { ok: true; mapping: FieldMapping }
  | { ok: false; error: string };

export type ContentMessage =
  | { type: "ANALYZE_PAGE" }
  | { type: "BEGIN_FIELD_MAPPING"; siteId: string }
  | { type: "FILL_FIELDS"; mapping: FieldMapping; account: StoredAccount; forceOverwrite?: boolean };

export type ContentResponse =
  | ({ ok: true } & AnalyzePageResponse)
  | ({ ok: true } & FillFieldsResponse)
  | { ok: true; accepted: true }
  | { ok: false; error: string };
