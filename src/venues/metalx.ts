import { fetchJson } from '../http.js';
import { toNumber } from '../normalize.js';
import type { MarketQuote, TokenRef } from '../types.js';

const API = process.env.METALX_API ?? 'https://dex.api.mainnet.metalx.com/dex/v1';

type MetalXMarket = {
  market_id: number;
  symbol: string;
  status_code: number;
  maker_fee?: number;
  taker_fee?: number;
  bid_token: { code: string; precision: number; contract: string };
  ask_token: { code: string; precision: number; contract: string };
};

type MetalXMarketsResponse = { data: MetalXMarket[] };
type MetalXDaily = { symbol: string; close?: number; open?: number; high?: number; low?: number };
type MetalXDailyResponse = { data: MetalXDaily[] | MetalXDaily };

type MetalXDepthResponse = { data?: { bids?: unknown[]; asks?: unknown[] } | unknown; bids?: unknown[]; asks?: unknown[] };

const DEPTH_STEP = 0.000001;

function token(t: MetalXMarket['bid_token']): TokenRef {
  return { symbol: t.code, contract: t.contract, precision: t.precision };
}

function priceFromLevel(level: unknown): number | undefined {
  if (Array.isArray(level)) return toNumber(level[0]);
  if (level && typeof level === 'object') {
    const o = level as Record<string, unknown>;
    const direct = toNumber(o.price ?? o.rate ?? o[0]);
    if (direct) return direct;
    const bucket = toNumber(o.level);
    // Metal X depth returns bucket levels. With step=0.000001, level 2744 means 0.002744.
    // Level 0 is not executable price information; it only means below the selected bucket.
    return bucket ? bucket * DEPTH_STEP : undefined;
  }
  return undefined;
}

export async function getMetalXQuotes(): Promise<MarketQuote[]> {
  const markets = await fetchJson<MetalXMarketsResponse>(`${API}/markets/all`);
  let daily: MetalXDaily[] = [];
  try {
    const dailyRes = await fetchJson<MetalXDailyResponse>(`${API}/trades/daily`);
    daily = Array.isArray(dailyRes.data) ? dailyRes.data : [dailyRes.data];
  } catch {
    daily = [];
  }
  const dailyBySymbol = new Map(daily.map((d) => [d.symbol, d]));

  const quotes: MarketQuote[] = [];
  for (const m of markets.data.filter((m) => m.status_code === 1)) {
    let bid: number | undefined;
    let ask: number | undefined;
    try {
      const depth = await fetchJson<MetalXDepthResponse>(`${API}/orders/depth?symbol=${encodeURIComponent(m.symbol)}&step=${DEPTH_STEP}`, 5_000);
      const data = (depth.data && typeof depth.data === 'object' ? depth.data : depth) as { bids?: unknown[]; asks?: unknown[] };
      bid = data.bids?.map(priceFromLevel).find((v): v is number => Boolean(v));
      ask = data.asks?.map(priceFromLevel).find((v): v is number => Boolean(v));
    } catch {
      // Depth endpoint shape occasionally changes; fallback below keeps scanner useful but marks source as ticker.
    }

    const d = dailyBySymbol.get(m.symbol);
    const mid = toNumber(d?.close ?? d?.open);
    // Do NOT promote daily ticker/mid to executable bid/ask. That created fantasy arb.
    // A quote needs real depth on each side before it can participate in route matching.
    if (!bid && !ask && !mid) continue;

    quotes.push({
      venue: 'metalx',
      pairId: String(m.market_id),
      base: token(m.bid_token),
      quote: token(m.ask_token),
      bid,
      ask,
      mid,
      feeBps: (m.taker_fee ?? m.maker_fee ?? 0) * 100,
      source: bid || ask ? 'orderbook' : 'ticker',
      updatedAt: new Date().toISOString(),
      raw: m,
    });
  }
  return quotes;
}
