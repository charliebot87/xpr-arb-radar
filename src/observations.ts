import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MarketQuote, Opportunity, QuoteConfidence, TokenRef } from './types.js';
import { quoteValuePairKey, sameValueToken, tokenKey } from './normalize.js';
import { routeConfidence } from './routes.js';

export type OperatorActionability = 'none' | 'monitor' | 'manual_review' | 'paper_route_candidate' | 'future_live_route_candidate';
export type FailureType = 'depth_failure' | 'price_failure' | 'stale_data' | 'precision_mismatch' | 'treasury_friction' | 'none';

export interface RouteObservation {
  observed_at: string;
  route_key: string;
  base: TokenRef;
  quote_value_bucket: string;
  buy_venue: string;
  sell_venue: string;
  buy_pair_id: string;
  sell_pair_id: string;
  gross_edge_pct?: number;
  net_edge_pct?: number;
  confidence: QuoteConfidence;
  venue_freshness_ms?: number;
  rejection_reason: string;
  failure_type: FailureType;
  false_positive_class?: string;
  treasury_valve_needed: boolean;
  operator_actionability: OperatorActionability;
}

const CONFIDENCE_RANK: Record<QuoteConfidence, number> = { synthetic: 0, stale: 1, indicative: 2, executable: 3 };

function quoteBucket(token: TokenRef): string {
  const symbol = token.symbol.toUpperCase();
  if ((symbol === 'XMD' && token.contract === 'xmd.token') || (symbol === 'XUSDC' && token.contract === 'xtokens')) return 'USD_EQ';
  return tokenKey(token);
}

function ageMs(q: MarketQuote, now: number): number | undefined {
  const t = Date.parse(q.updatedAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : undefined;
}

function classify(
  buy: MarketQuote,
  sell: MarketQuote,
  confidence: QuoteConfidence,
  netEdgePct: number | undefined,
  minNetEdgePct: number,
): Pick<RouteObservation, 'rejection_reason' | 'failure_type' | 'false_positive_class' | 'operator_actionability'> {
  if (!buy.ask || !sell.bid) {
    return { rejection_reason: 'missing executable bid/ask on one side', failure_type: 'depth_failure', false_positive_class: 'missing_top_of_book', operator_actionability: 'none' };
  }
  if (confidence === 'stale') {
    return { rejection_reason: 'stale/context quote cannot rank', failure_type: 'stale_data', false_positive_class: 'stale_ticker_context', operator_actionability: 'none' };
  }
  if (confidence === 'synthetic') {
    return { rejection_reason: 'synthetic quote cannot rank', failure_type: 'price_failure', false_positive_class: 'synthetic_price', operator_actionability: 'none' };
  }
  if (netEdgePct === undefined || netEdgePct < minNetEdgePct) {
    return { rejection_reason: 'net edge below threshold after fees', failure_type: 'price_failure', operator_actionability: 'monitor' };
  }
  if (confidence === 'indicative') {
    return { rejection_reason: 'indicative only; needs persistence/manual review before paper route', failure_type: 'none', operator_actionability: 'manual_review' };
  }
  return { rejection_reason: 'eligible for paper route simulation', failure_type: 'none', operator_actionability: 'paper_route_candidate' };
}

export function buildRouteObservations(quotes: MarketQuote[], opportunities: Opportunity[], minNetEdgePct: number): RouteObservation[] {
  const now = Date.now();
  const observed_at = new Date(now).toISOString();
  const byPair = new Map<string, MarketQuote[]>();
  for (const q of quotes) {
    const list = byPair.get(quoteValuePairKey(q)) ?? [];
    list.push(q);
    byPair.set(quoteValuePairKey(q), list);
  }

  const oppKeys = new Set(opportunities.map((o) => `${o.buyVenue.venue}:${o.buyVenue.pairId}->${o.sellVenue.venue}:${o.sellVenue.pairId}`));
  const observations: RouteObservation[] = [];

  for (const pairQuotes of byPair.values()) {
    for (const buy of pairQuotes) {
      for (const sell of pairQuotes) {
        if (buy.venue === sell.venue && buy.pairId === sell.pairId) continue;
        const confidence = routeConfidence(buy, sell);
        const grossEdgePct = buy.ask && sell.bid ? ((sell.bid - buy.ask) / buy.ask) * 100 : undefined;
        const feesPct = ((buy.feeBps ?? 0) + (sell.feeBps ?? 0)) / 100;
        const netEdgePct = grossEdgePct === undefined ? undefined : grossEdgePct - feesPct;
        const key = `${buy.venue}:${buy.pairId}->${sell.venue}:${sell.pairId}`;
        const classified = classify(buy, sell, confidence, netEdgePct, minNetEdgePct);
        if (oppKeys.has(key) && CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK.executable) {
          classified.rejection_reason = 'ranked opportunity; paper route candidate';
          classified.failure_type = 'none';
          classified.operator_actionability = 'paper_route_candidate';
        }

        observations.push({
          observed_at,
          route_key: `${quoteValuePairKey(buy)}:${key}`,
          base: buy.base,
          quote_value_bucket: quoteBucket(buy.quote),
          buy_venue: buy.venue,
          sell_venue: sell.venue,
          buy_pair_id: buy.pairId,
          sell_pair_id: sell.pairId,
          gross_edge_pct: grossEdgePct,
          net_edge_pct: netEdgePct,
          confidence,
          venue_freshness_ms: Math.max(ageMs(buy, now) ?? 0, ageMs(sell, now) ?? 0),
          ...classified,
          treasury_valve_needed: sameValueToken(buy.quote, sell.quote) && tokenKey(buy.quote) !== tokenKey(sell.quote),
        });
      }
    }
  }

  return observations;
}

export async function appendObservations(path: string, observations: RouteObservation[]): Promise<void> {
  if (!observations.length) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, observations.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');
}
