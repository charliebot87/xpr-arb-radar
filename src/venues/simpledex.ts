import { fetchJson } from '../http.js';
import type { MarketQuote, TokenRef } from '../types.js';

const API = process.env.SIMPLEDEX_API ?? 'https://indexer.protonnz.com/api';

export type SimplePool = {
  poolId: number;
  tokenA: { symbol: string; symbolFull?: string; contract: string };
  tokenB: { symbol: string; symbolFull?: string; contract: string };
  reserveA: string | number;
  reserveB: string | number;
  paused?: boolean;
  feeRate?: number; // observed as 30 for 0.30%
  depth5pct?: { tokenA?: number; tokenB?: number };
};

type PoolResponse = SimplePool[] | { data?: SimplePool[]; pools?: SimplePool[] };

export function simpleDexPrecision(symbolFull?: string): number | undefined {
  const p = symbolFull?.split(',')[0];
  const n = p ? Number(p) : undefined;
  return Number.isFinite(n) ? n : undefined;
}

export function simpleDexToken(t: SimplePool['tokenA']): TokenRef {
  return { symbol: t.symbol, contract: t.contract, precision: simpleDexPrecision(t.symbolFull) };
}

export function simpleDexReserves(pool: SimplePool): { a: number; b: number } | undefined {
  const pa = simpleDexPrecision(pool.tokenA.symbolFull) ?? 4;
  const pb = simpleDexPrecision(pool.tokenB.symbolFull) ?? 4;
  const a = Number(pool.reserveA) / 10 ** pa;
  const b = Number(pool.reserveB) / 10 ** pb;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return undefined;
  return { a, b };
}

export async function getSimpleDexQuotes(): Promise<MarketQuote[]> {
  const pools = await getSimpleDexPools();
  const quotes: MarketQuote[] = [];
  for (const p of pools) {
    const r = simpleDexReserves(p);
    if (!r) continue;
    const feeBps = p.feeRate ?? 30;
    const feeMultiplier = 1 - feeBps / 10_000;
    const midAinB = r.b / r.a;
    const midBinA = r.a / r.b;
    quotes.push({
      venue: 'simpledex',
      pairId: String(p.poolId),
      base: simpleDexToken(p.tokenA),
      quote: simpleDexToken(p.tokenB),
      bid: midAinB * feeMultiplier,
      ask: midAinB / feeMultiplier,
      mid: midAinB,
      feeBps,
      maxQuoteSize: p.depth5pct?.tokenB,
      source: 'amm',
      confidence: 'indicative',
      updatedAt: new Date().toISOString(),
      raw: p,
    });
    quotes.push({
      venue: 'simpledex',
      pairId: `${p.poolId}:inverted`,
      base: simpleDexToken(p.tokenB),
      quote: simpleDexToken(p.tokenA),
      bid: midBinA * feeMultiplier,
      ask: midBinA / feeMultiplier,
      mid: midBinA,
      feeBps,
      maxQuoteSize: p.depth5pct?.tokenA,
      source: 'amm',
      confidence: 'indicative',
      updatedAt: new Date().toISOString(),
      raw: p,
    });
  }
  return quotes;
}

export async function getSimpleDexPools(): Promise<SimplePool[]> {
  const res = await fetchJson<PoolResponse>(`${API}/pools`);
  const pools = Array.isArray(res) ? res : res.data ?? res.pools ?? [];
  return pools.filter((p) => !p.paused);
}
