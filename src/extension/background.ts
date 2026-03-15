import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentMessage,
  ContentResponse
} from "./lib/messages";
import {
  addStoredAccount,
  addDemoAccount,
  clearMapping,
  ensureDefaultAccount,
  getStorage,
  setLastFillResult,
  setStorage,
  upsertMapping
} from "./lib/storage";
import {
  createId,
  type FillResult,
  type PendingCredentialSave,
  type PageDetectionResult,
  type PopupState,
  type SiteRecord
} from "./lib/types";
import { findMatchingSite, normalizePathPrefix, normalizeUrl } from "./lib/urlRules";

const BADGE_COLORS = {
  ready: "#0e6b56",
  needsMapping: "#c16b00",
  unsupported: "#7a1b1b"
};
const PENDING_SAVES_KEY = "pendingCredentialSavesByTab";

async function sendToTab<TResponse extends ContentResponse>(
  tabId: number,
  message: ContentMessage
): Promise<TResponse | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as TResponse;
  } catch {
    return null;
  }
}

async function getTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
  if (tabId !== undefined) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab ?? null;
}

async function buildPopupState(tabId?: number, senderTabId?: number): Promise<PopupState> {
  const tab = await getTab(tabId ?? senderTabId);
  const currentUrl = tab?.url ?? "";
  const normalizedUrl = currentUrl ? normalizeUrl(currentUrl) : null;
  const storage = await getStorage();
  const site = currentUrl ? findMatchingSite(storage.sites, currentUrl) : null;
  const mapping = site
    ? storage.mappings.find((entry) => entry.siteId === site.siteId) ?? null
    : null;
  const accounts = site
    ? storage.accounts.filter((entry) => entry.siteId === site.siteId)
    : [];

  const analysis = tab?.id ? await sendToTab(tab.id, { type: "ANALYZE_PAGE" }) : null;
  const detection: PageDetectionResult = {
    matchesRule: Boolean(site),
    hasMapping: Boolean(mapping),
    oauthProviders: analysis && analysis.ok && "oauthProviders" in analysis ? analysis.oauthProviders : [],
    candidateForms: analysis && analysis.ok && "candidateForms" in analysis ? analysis.candidateForms : 0,
    hasCrossOriginFrames:
      analysis && analysis.ok && "hasCrossOriginFrames" in analysis
        ? analysis.hasCrossOriginFrames
        : false
  };

  return {
    currentUrl,
    normalizedUrl,
    site,
    mapping,
    accounts,
    detection,
    lastFillResult:
      storage.lastFillResult && site && storage.lastFillResult.siteId === site.siteId
        ? storage.lastFillResult
        : null
  };
}

async function getPendingSaveMap(): Promise<Record<string, PendingCredentialSave>> {
  const stored = await chrome.storage.session.get(PENDING_SAVES_KEY);
  const raw = stored[PENDING_SAVES_KEY];
  return raw && typeof raw === "object" ? (raw as Record<string, PendingCredentialSave>) : {};
}

async function setPendingSaveMap(map: Record<string, PendingCredentialSave>): Promise<void> {
  await chrome.storage.session.set({
    [PENDING_SAVES_KEY]: map
  });
}

async function getPendingSave(tabId: number): Promise<PendingCredentialSave | null> {
  const map = await getPendingSaveMap();
  return map[String(tabId)] ?? null;
}

async function upsertPendingSave(tabId: number, pendingSave: PendingCredentialSave): Promise<void> {
  const map = await getPendingSaveMap();
  map[String(tabId)] = pendingSave;
  await setPendingSaveMap(map);
}

async function clearPendingSave(tabId: number): Promise<void> {
  const map = await getPendingSaveMap();
  delete map[String(tabId)];
  await setPendingSaveMap(map);
}

async function updateBadge(tabId: number, tabUrl?: string): Promise<void> {
  const tab = await getTab(tabId);
  const url = tabUrl ?? tab?.url ?? "";
  const normalized = normalizeUrl(url);
  if (!normalized) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }

  const storage = await getStorage();
  const site = findMatchingSite(storage.sites, url);
  const mapping = site
    ? storage.mappings.find((entry) => entry.siteId === site.siteId) ?? null
    : null;

  if (!site) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }

  const analysis = await sendToTab(tabId, { type: "ANALYZE_PAGE" });
  const hasCrossOriginFrames =
    analysis && analysis.ok && "hasCrossOriginFrames" in analysis
      ? analysis.hasCrossOriginFrames
      : false;

  const text = mapping ? "OK" : "MAP";
  const color = hasCrossOriginFrames
    ? BADGE_COLORS.unsupported
    : mapping
      ? BADGE_COLORS.ready
      : BADGE_COLORS.needsMapping;

  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
}

async function handleSaveSiteRule(
  tabId: number,
  displayName: string,
  pathPrefix: string
): Promise<BackgroundResponse> {
  const tab = await getTab(tabId);
  if (!tab?.url) {
    return { ok: false, error: "No active browser tab was available." };
  }

  const normalized = normalizeUrl(tab.url);
  if (!normalized) {
    return { ok: false, error: "Only http and https pages can be saved as site rules." };
  }

  const storage = await getStorage();
  const existing = storage.sites.find(
    (site) =>
      site.origin === normalized.origin &&
      site.pathPrefix === normalizePathPrefix(pathPrefix)
  );

  const site: SiteRecord = existing ?? {
    siteId: createId("site"),
    origin: normalized.origin,
    pathPrefix: normalizePathPrefix(pathPrefix || normalized.pathPrefix),
    displayName: displayName.trim() || new URL(tab.url).hostname,
    loginMethod: "password",
    notes: ""
  };

  if (existing) {
    site.displayName = displayName.trim() || site.displayName;
  }

  await setStorage({
    ...storage,
    sites: [...storage.sites.filter((entry) => entry.siteId !== site.siteId), site]
  });
  await ensureDefaultAccount(site.siteId);
  await updateBadge(tabId, tab.url);

  return { ok: true, site };
}

async function getOrCreateSiteForUrl(currentUrl: string): Promise<SiteRecord | null> {
  const normalized = normalizeUrl(currentUrl);
  if (!normalized) {
    return null;
  }

  const storage = await getStorage();
  const existing = findMatchingSite(storage.sites, currentUrl);
  if (existing) {
    return existing;
  }

  const site: SiteRecord = {
    siteId: createId("site"),
    origin: normalized.origin,
    pathPrefix: normalizePathPrefix(normalized.pathPrefix),
    displayName: new URL(currentUrl).hostname,
    loginMethod: "password",
    notes: ""
  };

  await setStorage({
    ...storage,
    sites: [...storage.sites, site]
  });

  return site;
}

async function handleSaveCapturedCredential(
  currentUrl: string,
  identifier: string,
  password: string,
  label?: string
): Promise<BackgroundResponse> {
  const site = await getOrCreateSiteForUrl(currentUrl);
  if (!site) {
    return { ok: false, error: "Only http and https pages can store captured credentials." };
  }

  const storage = await getStorage();
  const duplicate = storage.accounts.find(
    (account) =>
      account.siteId === site.siteId &&
      account.username.trim().toLowerCase() === identifier.trim().toLowerCase()
  );

  if (duplicate) {
    return { ok: false, error: "That credential is already saved for this site." };
  }

  const account = await addStoredAccount(
    site.siteId,
    label?.trim() || identifier.trim(),
    identifier.trim(),
    password,
    false
  );

  return { ok: true, account };
}

async function handleCreatePendingSave(
  tabId: number,
  currentUrl: string,
  identifier: string,
  password: string,
  label?: string
): Promise<BackgroundResponse> {
  const site = await getOrCreateSiteForUrl(currentUrl);
  if (!site) {
    return { ok: false, error: "Only http and https pages can store captured credentials." };
  }

  const storage = await getStorage();
  const duplicate = storage.accounts.find(
    (account) =>
      account.siteId === site.siteId &&
      account.username.trim().toLowerCase() === identifier.trim().toLowerCase()
  );

  if (duplicate) {
    await clearPendingSave(tabId);
    return { ok: false, error: "That credential is already saved for this site." };
  }

  const pendingSave: PendingCredentialSave = {
    currentUrl,
    identifier: identifier.trim(),
    password,
    label: label?.trim() || identifier.trim(),
    createdAt: new Date().toISOString(),
    siteId: site.siteId,
    displayName: site.displayName
  };

  await upsertPendingSave(tabId, pendingSave);
  return { ok: true, pendingSave };
}

async function handleConfirmPendingSave(tabId: number): Promise<BackgroundResponse> {
  const pendingSave = await getPendingSave(tabId);
  if (!pendingSave) {
    return { ok: false, error: "There is no pending credential save for this tab." };
  }

  const storage = await getStorage();
  const duplicate = storage.accounts.find(
    (account) =>
      account.siteId === pendingSave.siteId &&
      account.username.trim().toLowerCase() === pendingSave.identifier.trim().toLowerCase()
  );

  if (duplicate) {
    await clearPendingSave(tabId);
    return { ok: false, error: "That credential is already saved for this site." };
  }

  const account = await addStoredAccount(
    pendingSave.siteId,
    pendingSave.label?.trim() || pendingSave.identifier.trim(),
    pendingSave.identifier.trim(),
    pendingSave.password,
    false
  );

  await clearPendingSave(tabId);
  return { ok: true, account };
}

async function handleFill(
  tabId: number,
  siteId: string,
  accountId: string,
  forceOverwrite?: boolean
): Promise<BackgroundResponse> {
  const storage = await getStorage();
  const mapping = storage.mappings.find((entry) => entry.siteId === siteId);
  const account = storage.accounts.find((entry) => entry.id === accountId && entry.siteId === siteId);

  if (!mapping || !account) {
    return { ok: false, error: "A saved mapping and selected account are required before fill." };
  }

  const response = await sendToTab(tabId, {
    type: "FILL_FIELDS",
    mapping,
    account,
    forceOverwrite
  });

  if (!response || !response.ok || !("status" in response)) {
    return {
      ok: false,
      error: response && !response.ok ? response.error : "The page did not accept the fill request."
    };
  }

  const result: FillResult = {
    siteId,
    accountId,
    status: response.status,
    message: response.message,
    timestamp: new Date().toISOString(),
    usedFallback: response.usedFallback
  };

  if (response.usedFallback) {
    await upsertMapping({
      ...mapping,
      stale: true,
      lastVerifiedAt: new Date().toISOString()
    });
  }

  await setLastFillResult(result);
  return {
    ok: true,
    state: await buildPopupState(tabId)
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void getStorage();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    void updateBadge(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearPendingSave(tabId);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void updateBadge(activeInfo.tabId);
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  const senderTabId = _sender.tab?.id;

  const respond = async (): Promise<BackgroundResponse> => {
    switch (message.type) {
      case "GET_POPUP_STATE":
        return { ok: true, state: await buildPopupState(message.tabId, senderTabId) };

      case "SAVE_SITE_RULE":
        if (message.tabId === undefined && senderTabId === undefined) {
          return { ok: false, error: "No browser tab context was available for this action." };
        }
        return handleSaveSiteRule(message.tabId ?? senderTabId!, message.displayName, message.pathPrefix);

      case "START_FIELD_MAPPING": {
        const tabId = message.tabId ?? senderTabId;
        if (tabId === undefined) {
          return { ok: false, error: "No browser tab context was available for field mapping." };
        }
        const response = await sendToTab(tabId, {
          type: "BEGIN_FIELD_MAPPING",
          siteId: message.siteId
        });
        if (!response?.ok) {
          return { ok: false, error: response?.error ?? "Unable to start field mapping on this page." };
        }

        return { ok: true, accepted: true };
      }

      case "CLEAR_MAPPING":
        await clearMapping(message.siteId);
        return { ok: true, accepted: true };

      case "SAVE_DEMO_ACCOUNT": {
        const account = await addDemoAccount(
          message.siteId,
          message.label,
          message.username,
          message.password
        );
        return { ok: true, account };
      }

      case "CREATE_PENDING_SAVE": {
        const tabId = message.tabId ?? senderTabId;
        if (tabId === undefined) {
          return { ok: false, error: "No browser tab context was available for pending save." };
        }
        return handleCreatePendingSave(
          tabId,
          message.payload.currentUrl,
          message.payload.identifier,
          message.payload.password,
          message.payload.label
        );
      }

      case "GET_PENDING_SAVE": {
        const tabId = message.tabId ?? senderTabId;
        if (tabId === undefined) {
          return { ok: false, error: "No browser tab context was available for pending save lookup." };
        }
        return { ok: true, pendingSave: await getPendingSave(tabId) };
      }

      case "DISMISS_PENDING_SAVE": {
        const tabId = message.tabId ?? senderTabId;
        if (tabId === undefined) {
          return { ok: false, error: "No browser tab context was available for pending save dismissal." };
        }
        await clearPendingSave(tabId);
        return { ok: true, accepted: true };
      }

      case "CONFIRM_PENDING_SAVE": {
        const tabId = message.tabId ?? senderTabId;
        if (tabId === undefined) {
          return { ok: false, error: "No browser tab context was available for pending save confirmation." };
        }
        return handleConfirmPendingSave(tabId);
      }

      case "SAVE_CAPTURED_CREDENTIAL":
        return handleSaveCapturedCredential(
          message.payload.currentUrl,
          message.payload.identifier,
          message.payload.password,
          message.payload.label
        );

      case "FILL_DEMO_ACCOUNT":
        if (message.tabId === undefined && senderTabId === undefined) {
          return { ok: false, error: "No browser tab context was available for fill." };
        }
        return handleFill(
          message.tabId ?? senderTabId!,
          message.siteId,
          message.accountId,
          message.forceOverwrite
        );

      case "SAVE_FIELD_MAPPING_FROM_PAGE":
        await upsertMapping({
          mappingId: createId("mapping"),
          siteId: message.payload.siteId,
          username: message.payload.username,
          password: message.payload.password,
          formFingerprint: message.payload.formFingerprint,
          lastVerifiedAt: new Date().toISOString(),
          stale: false
        });
        return {
          ok: true,
          mapping: (await getStorage()).mappings.find((entry) => entry.siteId === message.payload.siteId)!
        };

      case "PAGE_ANALYSIS_UPDATE": {
        const tab = await getTab();
        if (tab?.id && tab.url === message.url) {
          await updateBadge(tab.id, tab.url);
        }
        return { ok: true, accepted: true };
      }

      default:
        return { ok: false, error: "Unsupported background message." };
    }
  };

  void respond().then(sendResponse);
  return true;
});
