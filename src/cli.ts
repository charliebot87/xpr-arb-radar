#!/usr/bin/env node
import { getAlcorQuotes } from './venues/alcor.js';
import { getMetalXQuotes } from './venues/metalx.js';
import { getSimpleDexQuotes } from './venues/simpledex.js';
import { findOpportunities } from './routes.js';
import { appendObservations, buildRouteObservations } from './observations.js';
import { scoreBestPaperCandidate } from './paper.js';
import { evaluateTradingMethods } from './methods.js';
import { pairKey } from './normalize.js';
import type { MarketQuote, QuoteConfidence } from './types.js';
import type { ScoreAgent } from './scoreboard.js';

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const command = process.argv[2] ?? 'scan';
  if (command !== 'scan' && command !== 'paper' && command !== 'methods') {
    console.error('usage: xpr-arb-radar scan|paper|methods [--min-edge=1] [--quote=XMD] [--min-confidence=indicative] [--state=state/observations.jsonl] [--scoreboard=/Users/charliebot/clawd/state/mragentsmith-strategy-score.json] [--agent=charliebot] [--notional=10] [--no-persist] [--json]');
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
  const minNetEdge = Number.isFinite(minEdge) ? minEdge : 1;
  const opportunities = findOpportunities(quotes, minNetEdge, minConfidence);
  const observations = buildRouteObservations(quotes, opportunities, minNetEdge);
  const statePath = arg('state', process.env.OBSERVATIONS_PATH ?? 'state/observations.jsonl') ?? 'state/observations.jsonl';
  if (!process.argv.includes('--no-persist')) await appendObservations(statePath, observations);

  const paperResult = command === 'paper'
    ? await scoreBestPaperCandidate({
        observations,
        scoreboardPath: arg('scoreboard', process.env.SCOREBOARD_PATH ?? '/Users/charliebot/clawd/state/mragentsmith-strategy-score.json') ?? '/Users/charliebot/clawd/state/mragentsmith-strategy-score.json',
        agent: (arg('agent', process.env.SCORE_AGENT ?? 'charliebot') ?? 'charliebot') as ScoreAgent,
        notionalValue: Number(arg('notional', process.env.PAPER_NOTIONAL ?? '10')) || 10,
      })
    : undefined;

  const methodSignals = command === 'methods' ? await evaluateTradingMethods(observations, Number(arg('notional', process.env.PAPER_NOTIONAL ?? '10')) || 10) : undefined;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ scannedAt: new Date().toISOString(), command, quoteSymbols: [...quoteSymbols], quoteCount: quotes.length, totalQuoteCount: allQuotes.length, minConfidence, persisted: !process.argv.includes('--no-persist'), observationCount: observations.length, failures, opportunities, paper: paperResult, methods: methodSignals }, null, 2));
    return;
  }

  console.log(`xpr-arb-radar ${command === 'paper' ? 'paper trader' : 'watch-only scan'}`);
  const confidenceCounts = quotes.reduce<Record<string, number>>((acc, q) => { acc[q.confidence] = (acc[q.confidence] ?? 0) + 1; return acc; }, {});
  console.log(`quotes: ${quotes.length}/${allQuotes.length} | observations: ${observations.length} | quote filter: ${[...quoteSymbols].join(',')} | confidence: ${JSON.stringify(confidenceCounts)} | opportunities >= ${minEdge}% net (${minConfidence}+): ${opportunities.length}`);
  if (!process.argv.includes('--no-persist')) console.log(`persisted observations: ${statePath}`);
  if (methodSignals) {
    console.log('method signals:');
    for (const m of methodSignals) console.log(`  ${m.method}: ${m.actionability} — ${m.reason}`);
  }
  if (paperResult) {
    console.log(`paper candidates: ${paperResult.candidates.length}`);
    if (paperResult.scored) {
      console.log(`paper trade scored: ${paperResult.scored.recorded.outcome} ${paperResult.scored.recorded.pointsDelta > 0 ? '+' : ''}${paperResult.scored.recorded.pointsDelta} | pnl ${paperResult.scored.recorded.pnlValue.toFixed(6)} (${paperResult.scored.recorded.pnlPct.toFixed(4)}%)`);
      if (paperResult.scored.firstProfit) console.log('FIRST PROFITABLE PAPER TRADE DETECTED');
    } else {
      console.log('paper trade scored: none; no positive candidate after friction');
    }
  }
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
