import {
  STORAGE_VERSION,
  createId,
  type ExtensionStorage,
  type FieldMapping,
  type FillResult,
  type SiteRecord,
  type StoredAccount
} from "./types";

const STORAGE_KEY = "localPasswordManagerState";

function createDefaultStorage(): ExtensionStorage {
  return {
    version: STORAGE_VERSION,
    sites: [],
    accounts: [],
    mappings: [],
    lastFillResult: null
  };
}

export function ensureStorageShape(rawState: unknown): ExtensionStorage {
  const fallback = createDefaultStorage();
  if (!rawState || typeof rawState !== "object") {
    return fallback;
  }

  const source = rawState as Partial<ExtensionStorage>;
  return {
    version: STORAGE_VERSION,
    sites: Array.isArray(source.sites) ? source.sites : fallback.sites,
    accounts: Array.isArray(source.accounts) ? source.accounts : fallback.accounts,
    mappings: Array.isArray(source.mappings) ? source.mappings : fallback.mappings,
    lastFillResult:
      source.lastFillResult && typeof source.lastFillResult === "object"
        ? (source.lastFillResult as FillResult)
        : null
  };
}

export async function getStorage(): Promise<ExtensionStorage> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = ensureStorageShape(stored[STORAGE_KEY]);

  if (state.version !== STORAGE_VERSION) {
    state.version = STORAGE_VERSION;
    await setStorage(state);
  }

  return state;
}

export async function setStorage(state: ExtensionStorage): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...state,
      version: STORAGE_VERSION
    }
  });
}

export async function upsertSite(site: SiteRecord): Promise<void> {
  const state = await getStorage();
  const sites = state.sites.filter((entry) => entry.siteId !== site.siteId);
  sites.push(site);
  await setStorage({ ...state, sites });
}

export async function upsertMapping(mapping: FieldMapping): Promise<void> {
  const state = await getStorage();
  const mappings = state.mappings.filter((entry) => entry.siteId !== mapping.siteId);
  mappings.push(mapping);
  await setStorage({ ...state, mappings });
}

export async function clearMapping(siteId: string): Promise<void> {
  const state = await getStorage();
  await setStorage({
    ...state,
    mappings: state.mappings.filter((mapping) => mapping.siteId !== siteId)
  });
}

export async function addDemoAccount(
  siteId: string,
  label: string,
  username: string,
  password: string
): Promise<StoredAccount> {
  return addStoredAccount(siteId, label, username, password, true);
}

export async function addStoredAccount(
  siteId: string,
  label: string,
  username: string,
  password: string,
  isDemo = false
): Promise<StoredAccount> {
  const state = await getStorage();
  const account: StoredAccount = {
    id: createId("acct"),
    siteId,
    label,
    username,
    password,
    isDemo
  };

  await setStorage({
    ...state,
    accounts: [...state.accounts, account]
  });

  return account;
}

export async function ensureDefaultAccount(siteId: string): Promise<void> {
  const state = await getStorage();
  const existing = state.accounts.some((account) => account.siteId === siteId);
  if (existing) {
    return;
  }

  const account: StoredAccount = {
    id: createId("acct"),
    siteId,
    label: "Default Demo",
    username: "USERNAME",
    password: "PASSWORD",
    isDemo: true
  };

  await setStorage({
    ...state,
    accounts: [...state.accounts, account]
  });
}

export async function setLastFillResult(result: FillResult | null): Promise<void> {
  const state = await getStorage();
  await setStorage({
    ...state,
    lastFillResult: result
  });
}
