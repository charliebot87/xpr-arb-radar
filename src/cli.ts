#!/usr/bin/env node
import { getAlcorQuotes } from './venues/alcor.js';
import { getMetalXQuotes } from './venues/metalx.js';
import { getSimpleDexQuotes } from './venues/simpledex.js';
import { findOpportunities } from './routes.js';
import { pairKey } from './normalize.js';
import type { MarketQuote, QuoteConfidence } from './types.js';

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const command = process.argv[2] ?? 'scan';
  if (command !== 'scan') {
    console.error('usage: xpr-arb-radar scan [--min-edge=1] [--quote=XMD] [--min-confidence=indicative] [--json]');
    process.exit(1);
  }

  const minEdge = Number(arg('min-edge', process.env.MIN_EDGE_PCT ?? '1'));
  const minConfidence = (arg('min-confidence', process.env.MIN_CONFIDENCE ?? 'indicative') ?? 'indicative') as QuoteConfidence;
  const quoteSymbols = new Set((arg('quote', process.env.QUOTE_SYMBOLS ?? 'XMD,XUSDC') ?? 'XMD').split(',').map((v) => v.trim().toUpperCase()).filter(Boolean));
  const enabled = new Set((arg('venues', process.env.VENUES ?? 'metalx,simpledex,alcor') ?? '').split(',').map((v) => v.trim()));
  const tasks: Promise<MarketQuote[]>[] = [];
  if (enabled.has('metalx')) tasks.push(getMetalXQuotes());
  if (enabled.has('simpledex')) tasks.push(getSimpleDexQuotes());
  if (enabled.has('alcor')) tasks.push(getAlcorQuotes());

  const settled = await Promise.allSettled(tasks);
  const allQuotes = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const quotes = allQuotes.filter((q) => quoteSymbols.has(q.quote.symbol.toUpperCase()));
  const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason));
  const opportunities = findOpportunities(quotes, Number.isFinite(minEdge) ? minEdge : 1, minConfidence);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ scannedAt: new Date().toISOString(), quoteSymbols: [...quoteSymbols], quoteCount: quotes.length, totalQuoteCount: allQuotes.length, minConfidence, failures, opportunities }, null, 2));
    return;
  }

  console.log(`xpr-arb-radar watch-only scan`);
  const confidenceCounts = quotes.reduce<Record<string, number>>((acc, q) => { acc[q.confidence] = (acc[q.confidence] ?? 0) + 1; return acc; }, {});
  console.log(`quotes: ${quotes.length}/${allQuotes.length} | quote filter: ${[...quoteSymbols].join(',')} | confidence: ${JSON.stringify(confidenceCounts)} | opportunities >= ${minEdge}% net (${minConfidence}+): ${opportunities.length}`);
  if (failures.length) console.log(`failures: ${failures.join(' | ')}`);
  for (const o of opportunities.slice(0, 20)) {
    console.log(`\n${pairKey(o.base, o.quote)}`);
    console.log(`  buy  ${o.buyVenue.venue.padEnd(9)} @ ${o.buyPrice}`);
    console.log(`  sell ${o.sellVenue.venue.padEnd(9)} @ ${o.sellPrice}`);
    console.log(`  edge gross ${o.grossEdgePct.toFixed(2)}% | net ${o.netEdgePct.toFixed(2)}% | confidence ${o.confidence}`);
    if (o.notes.length) console.log(`  notes: ${o.notes.join('; ')}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
