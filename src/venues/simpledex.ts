import { fetchJson } from '../http.js';
import type { MarketQuote, TokenRef } from '../types.js';

const API_ENDPOINTS = (process.env.SIMPLEDEX_API_ENDPOINTS ?? process.env.SIMPLEDEX_API ?? 'https://simpledex.fun/api,https://indexer.protonnz.com/api')
  .split(',')
  .map((v) => v.trim().replace(/\/$/, ''))
  .filter(Boolean);
const RPC = process.env.XPR_RPC ?? 'https://api.protonnz.com';

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
type ChainPool = {
  id: number;
  tokenAContract: string;
  tokenASymbol: string;
  tokenBContract: string;
  tokenBSymbol: string;
  reserveA: string | number;
  reserveB: string | number;
  feeRate?: number;
  paused?: number | boolean;
};
type ChainRowsResponse = { rows?: ChainPool[]; more?: boolean; next_key?: string };

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
  const errors: string[] = [];
  for (const api of API_ENDPOINTS) {
    try {
      const res = await fetchJson<PoolResponse>(`${api}/pools`, { timeoutMs: 15_000, retries: 2, retryDelayMs: 500 });
      const pools = Array.isArray(res) ? res : res.data ?? res.pools ?? [];
      return pools.filter((p) => !p.paused);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  try {
    return await getSimpleDexPoolsFromRpc();
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  throw new Error(`all SimpleDEX pool endpoints failed: ${errors.join(' | ')}`);
}

function symbolFromFull(symbolFull: string): string {
  return symbolFull.split(',')[1] ?? symbolFull;
}

function chainPoolToSimplePool(row: ChainPool): SimplePool {
  return {
    poolId: row.id,
    tokenA: { symbol: symbolFromFull(row.tokenASymbol), symbolFull: row.tokenASymbol, contract: row.tokenAContract },
    tokenB: { symbol: symbolFromFull(row.tokenBSymbol), symbolFull: row.tokenBSymbol, contract: row.tokenBContract },
    reserveA: row.reserveA,
    reserveB: row.reserveB,
    feeRate: row.feeRate,
    paused: Boolean(row.paused),
  };
}

async function getSimpleDexPoolsFromRpc(): Promise<SimplePool[]> {
  const rows: ChainPool[] = [];
  let lower_bound: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await fetchJson<ChainRowsResponse>(`${RPC}/v1/chain/get_table_rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'simpledex', scope: 'simpledex', table: 'pools', json: true, limit: 200, lower_bound }),
      timeoutMs: 15_000,
      retries: 2,
      retryDelayMs: 500,
    });
    rows.push(...(res.rows ?? []));
    if (!res.more || !res.next_key) break;
    lower_bound = res.next_key;
  }
  return rows.map(chainPoolToSimplePool).filter((p) => !p.paused);
}
