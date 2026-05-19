import { buildProtonActionCommand, type ProtonActionDraft } from './proton-cli.js';

export const XMD_CONTRACT = 'xmd.token';
export const XUSDC_CONTRACT = 'xtokens';
export const XMD_TREASURY = 'xmd.treasury';

export function formatStableAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be positive');
  return amount.toFixed(6);
}

export function buildMintXmdDraft(account: string, xusdcAmount: number): ProtonActionDraft {
  return {
    contract: XUSDC_CONTRACT,
    action: 'transfer',
    actor: account,
    data: {
      from: account,
      to: XMD_TREASURY,
      quantity: `${formatStableAmount(xusdcAmount)} XUSDC`,
      memo: 'mint',
    },
  };
}

export function buildRedeemXmdDraft(account: string, xmdAmount: number, receiveSymbol = 'XUSDC'): ProtonActionDraft {
  if (receiveSymbol !== 'XUSDC') throw new Error('only XUSDC redemption is modeled for now');
  return {
    contract: XMD_CONTRACT,
    action: 'transfer',
    actor: account,
    data: {
      from: account,
      to: XMD_TREASURY,
      quantity: `${formatStableAmount(xmdAmount)} XMD`,
      memo: `redeem,${receiveSymbol}`,
    },
  };
}

export function buildMintXmdCommand(account: string, xusdcAmount: number): string[] {
  return buildProtonActionCommand(buildMintXmdDraft(account, xusdcAmount));
}

export function buildRedeemXmdCommand(account: string, xmdAmount: number, receiveSymbol = 'XUSDC'): string[] {
  return buildProtonActionCommand(buildRedeemXmdDraft(account, xmdAmount, receiveSymbol));
}
