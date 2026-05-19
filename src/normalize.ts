import type { MarketQuote, TokenRef } from './types.js';

export function tokenKey(token: TokenRef): string {
  return `${token.symbol.toUpperCase()}@${token.contract}`;
}

export function pairKey(base: TokenRef, quote: TokenRef): string {
  return `${tokenKey(base)}/${tokenKey(quote)}`;
}

export function quotePairKey(q: MarketQuote): string {
  return pairKey(q.base, q.quote);
}

export function invertQuote(q: MarketQuote): MarketQuote | undefined {
  if (!q.bid && !q.ask && !q.mid) return undefined;
  const bid = q.ask && q.ask > 0 ? 1 / q.ask : undefined;
  const ask = q.bid && q.bid > 0 ? 1 / q.bid : undefined;
  const mid = q.mid && q.mid > 0 ? 1 / q.mid : undefined;
  return {
    ...q,
    pairId: `${q.pairId}:inverted`,
    base: q.quote,
    quote: q.base,
    bid,
    ask,
    mid,
    raw: q.raw,
  };
}

export function parseAsset(asset: string): { amount: number; symbol: string; precision: number } | undefined {
  const match = asset.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s+([A-Z0-9]+)$/i);
  if (!match) return undefined;
  const [, amount, symbol] = match;
  const decimals = amount.includes('.') ? amount.split('.')[1].length : 0;
  return { amount: Number(amount), symbol: symbol.toUpperCase(), precision: decimals };
}

export function toNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
