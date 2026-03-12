import type { PopupState, StoredAccount } from "./types";

export interface InlineViewModel {
  visible: boolean;
  triggerLabel: string;
  helperText: string;
  accountCount: number;
  showSetupAction: boolean;
}

export function pickPrimaryAccount(accounts: StoredAccount[]): StoredAccount | null {
  return accounts[0] ?? null;
}

export function buildInlineViewModel(state: PopupState | null): InlineViewModel {
  if (!state?.site) {
    return {
      visible: false,
      triggerLabel: "",
      helperText: "",
      accountCount: 0,
      showSetupAction: false
    };
  }

  if (!state.mapping) {
    return {
      visible: true,
      triggerLabel: "Set up autofill",
      helperText: "Map the username and password fields for this login page.",
      accountCount: state.accounts.length,
      showSetupAction: true
    };
  }

  if (state.accounts.length <= 1) {
    const account = pickPrimaryAccount(state.accounts);
    return {
      visible: true,
      triggerLabel: account ? `Fill ${account.label}` : "Fill account",
      helperText: account
        ? `Ready to fill ${account.username}.`
        : "Add a demo account or remap fields to continue.",
      accountCount: state.accounts.length,
      showSetupAction: false
    };
  }

  return {
    visible: true,
    triggerLabel: `Choose account (${state.accounts.length})`,
    helperText: "Pick which saved account to fill on this page.",
    accountCount: state.accounts.length,
    showSetupAction: false
  };
}
