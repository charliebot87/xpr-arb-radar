import type { MarketQuote, Opportunity, QuoteConfidence } from './types.js';
import { quotePairKey, tokenKey } from './normalize.js';

const CONFIDENCE_RANK: Record<QuoteConfidence, number> = { synthetic: 0, stale: 1, indicative: 2, executable: 3 };

export function routeConfidence(a: MarketQuote, b: MarketQuote): QuoteConfidence {
  return CONFIDENCE_RANK[a.confidence] < CONFIDENCE_RANK[b.confidence] ? a.confidence : b.confidence;
}

export function findOpportunities(quotes: MarketQuote[], minNetEdgePct = 1, minConfidence: QuoteConfidence = 'indicative'): Opportunity[] {
  const minRank = CONFIDENCE_RANK[minConfidence];
  const byPair = new Map<string, MarketQuote[]>();
  for (const q of quotes) {
    if (!q.ask || !q.bid) continue;
    if (CONFIDENCE_RANK[q.confidence] < minRank) continue;
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
        const confidence = routeConfidence(buyVenue, sellVenue);
        if (CONFIDENCE_RANK[confidence] < minRank) continue;
        const grossEdgePct = ((sellVenue.bid - buyVenue.ask) / buyVenue.ask) * 100;
        const feesPct = ((buyVenue.feeBps ?? 0) + (sellVenue.feeBps ?? 0)) / 100;
        const netEdgePct = grossEdgePct - feesPct;
        if (netEdgePct < minNetEdgePct) continue;
        const notes: string[] = [];
        if (confidence !== 'executable') notes.push(`confidence=${confidence}`);
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
          confidence,
          notes,
        });
      }
    }
  }

  return out.sort((a, b) => b.netEdgePct - a.netEdgePct || tokenKey(a.base).localeCompare(tokenKey(b.base)));
}
