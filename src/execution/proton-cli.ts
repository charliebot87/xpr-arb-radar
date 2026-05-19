export interface ProtonActionDraft {
  contract: string;
  action: string;
  data: Record<string, unknown>;
  actor: string;
}

export function buildProtonActionCommand(draft: ProtonActionDraft): string[] {
  return ['proton', 'action', draft.contract, draft.action, JSON.stringify(draft.data), draft.actor];
}

export function assertWatchOnly(): never {
  throw new Error('live execution is intentionally disabled in xpr-arb-radar v0.1. use the proton CLI manually after reviewing paper logs. no env private keys. no raccoon fire.');
}
