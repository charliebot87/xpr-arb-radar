import type { MarketQuote, Opportunity } from './types.js';
import { quotePairKey, tokenKey } from './normalize.js';

export function findOpportunities(quotes: MarketQuote[], minNetEdgePct = 1): Opportunity[] {
  const byPair = new Map<string, MarketQuote[]>();
  for (const q of quotes) {
    if (!q.ask || !q.bid) continue;
    const key = quotePairKey(q);
    const list = byPair.get(key) ?? [];
    list.push(q);
    byPair.set(key, list);
  }

  const out: Opportunity[] = [];
  for (const pairQuotes of byPair.values()) {
    for (const buyVenue of pairQuotes) {
      for (const sellVenue of pairQuotes) {
        if (buyVenue.venue === sellVenue.venue && buyVenue.pairId === sellVenue.pairId) continue;
        if (!buyVenue.ask || !sellVenue.bid) continue;
        const grossEdgePct = ((sellVenue.bid - buyVenue.ask) / buyVenue.ask) * 100;
        const feesPct = ((buyVenue.feeBps ?? 0) + (sellVenue.feeBps ?? 0)) / 100;
        const netEdgePct = grossEdgePct - feesPct;
        if (netEdgePct < minNetEdgePct) continue;
        const notes: string[] = [];
        if (buyVenue.source === 'ticker' || sellVenue.source === 'ticker') notes.push('ticker price, not full executable depth');
        if (!buyVenue.maxBaseSize || !sellVenue.maxBaseSize) notes.push('size/depth unknown');
        out.push({
          base: buyVenue.base,
          quote: buyVenue.quote,
          buyVenue,
          sellVenue,
          buyPrice: buyVenue.ask,
          sellPrice: sellVenue.bid,
          grossEdgePct,
          netEdgePct,
          notes,
        });
      }
    }
  }

  return out.sort((a, b) => b.netEdgePct - a.netEdgePct || tokenKey(a.base).localeCompare(tokenKey(b.base)));
}
