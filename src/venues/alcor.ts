import { fetchJson } from '../http.js';
import { toNumber } from '../normalize.js';
import type { MarketQuote, TokenRef } from '../types.js';

const API = process.env.ALCOR_API ?? 'https://proton.alcor.exchange/api/v2';

type AlcorTicker = {
  ticker_id: string;
  market_id?: number;
  frozen?: boolean;
  bid?: number;
  ask?: number;
  last_price?: number;
  fee?: number; // docs: fee / 1000 = percent
  base_currency: string;
  target_currency: string;
  base_amm_liquidity?: number;
  target_amm_liquidity?: number;
};

type AlcorToken = { symbol: string; contract: string; precision?: number };
type AlcorPairs = Array<{ base: AlcorToken; target: AlcorToken; ticker_id: string }>;

function parseId(id: string): TokenRef {
  const [symbol, ...contractParts] = id.split('-');
  return { symbol: symbol.toUpperCase(), contract: contractParts.join('-') };
}

export async function getAlcorQuotes(): Promise<MarketQuote[]> {
  const [tickers, pairs] = await Promise.all([
    fetchJson<AlcorTicker[]>(`${API}/tickers`),
    fetchJson<AlcorPairs>(`${API}/pairs`).catch(() => [] as AlcorPairs),
  ]);
  const pairInfo = new Map(pairs.map((p) => [p.ticker_id, p]));
  const quotes: MarketQuote[] = [];
  for (const t of tickers.filter((t) => !t.frozen)) {
    const p = pairInfo.get(t.ticker_id);
    const base: TokenRef = p ? { symbol: p.base.symbol, contract: p.base.contract, precision: p.base.precision } : parseId(t.base_currency);
    const quote: TokenRef = p ? { symbol: p.target.symbol, contract: p.target.contract, precision: p.target.precision } : parseId(t.target_currency);
    const bid = toNumber(t.bid);
    const ask = toNumber(t.ask);
    const mid = toNumber(t.last_price);
    if (!bid && !ask && !mid) continue;
    const fallback = mid;
    quotes.push({
      venue: 'alcor',
      pairId: t.ticker_id,
      base,
      quote,
      bid: bid ?? fallback,
      ask: ask ?? fallback,
      mid,
      // Alcor docs: fee is represented as fee / 1000 percent. 20 => 2% => 200 bps.
      feeBps: typeof t.fee === 'number' ? t.fee * 10 : undefined,
      maxBaseSize: toNumber(t.base_amm_liquidity),
      maxQuoteSize: toNumber(t.target_amm_liquidity),
      source: bid && ask ? 'ticker' : 'synthetic',
      confidence: bid && ask ? 'indicative' : 'synthetic',
      updatedAt: new Date().toISOString(),
      raw: t,
    });
  }
  return quotes;
}
