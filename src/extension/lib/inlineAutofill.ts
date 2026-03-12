import type { PopupState, StoredAccount } from "./types";

export interface AutofillPromptViewModel {
  visible: boolean;
  title: string;
  subtitle: string;
  accountCount: number;
  primaryLabel: string;
  showSetupAction: boolean;
}

export function pickPrimaryAccount(accounts: StoredAccount[]): StoredAccount | null {
  return accounts[0] ?? null;
}

export function buildAutofillPromptViewModel(
  state: PopupState | null
): AutofillPromptViewModel {
  if (!state?.site) {
    return {
      visible: false,
      title: "",
      subtitle: "",
      accountCount: 0,
      primaryLabel: "",
      showSetupAction: false
    };
  }

  if (!state.mapping) {
    return {
      visible: true,
      title: "Set up autofill?",
      subtitle: "Map the username and password fields for this page before filling credentials here.",
      accountCount: state.accounts.length,
      primaryLabel: "Map fields",
      showSetupAction: true
    };
  }

  if (state.accounts.length <= 1) {
    const account = pickPrimaryAccount(state.accounts);
    return {
      visible: true,
      title: "Would you like to autofill?",
      subtitle: account
        ? `Use ${account.label} (${account.username}) on this page.`
        : "A saved mapping exists, but there are no accounts to fill yet.",
      accountCount: state.accounts.length,
      primaryLabel: account ? `Fill ${account.label}` : "Fill account",
      showSetupAction: false
    };
  }

  return {
    visible: true,
    title: "Would you like to autofill?",
    subtitle: "Choose which saved account to use on this page.",
    accountCount: state.accounts.length,
    primaryLabel: `Choose account (${state.accounts.length})`,
    showSetupAction: false
  };
}
