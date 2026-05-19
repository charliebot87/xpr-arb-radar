import test from 'node:test';
import assert from 'node:assert/strict';
import { findOpportunities } from './routes.js';
import { invertQuote, parseAsset } from './normalize.js';
import { priceFromDepthLevel } from './venues/metalx.js';
import type { MarketQuote } from './types.js';

const base = { symbol: 'XPR', contract: 'eosio.token', precision: 4 };
const quote = { symbol: 'XUSDT', contract: 'xtokens', precision: 6 };

function q(venue: MarketQuote['venue'], bid: number, ask: number, feeBps = 0): MarketQuote {
  return { venue, pairId: venue, base, quote, bid, ask, feeBps, source: 'ticker', confidence: 'indicative', updatedAt: new Date(0).toISOString() };
}

test('finds net-positive cross venue opportunity', () => {
  const opps = findOpportunities([q('metalx', 0.10, 0.11, 10), q('alcor', 0.13, 0.14, 10)], 5);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].buyVenue.venue, 'metalx');
  assert.equal(opps[0].sellVenue.venue, 'alcor');
  assert.ok(opps[0].netEdgePct > 17);
});

test('ignores opportunities eaten by fees/min edge', () => {
  const opps = findOpportunities([q('metalx', 0.10, 0.11, 100), q('alcor', 0.111, 0.12, 100)], 1);
  assert.equal(opps.length, 0);
});

test('inverts quote safely', () => {
  const inv = invertQuote(q('simpledex', 2, 4));
  assert.equal(inv?.base.symbol, 'XUSDT');
  assert.equal(inv?.quote.symbol, 'XPR');
  assert.equal(inv?.bid, 0.25);
  assert.equal(inv?.ask, 0.5);
});

test('parses EOSIO asset strings', () => {
  assert.deepEqual(parseAsset('123.4500 XPR'), { amount: 123.45, symbol: 'XPR', precision: 4 });
});

test('does not treat Metal X aggregate depth buckets as executable prices', () => {
  assert.equal(priceFromDepthLevel({ count: 2, level: 1000000, bid: 100508.2739, ask: 90005.082739 }), undefined);
  assert.equal(priceFromDepthLevel({ price: 0.0027 }), 0.0027);
});

test('filters opportunities below requested confidence tier', () => {
  const indicative = [q('metalx', 0.10, 0.11), q('alcor', 0.13, 0.14)];
  assert.equal(findOpportunities(indicative, 1, 'executable').length, 0);
  const executableA = { ...q('metalx', 0.10, 0.11), confidence: 'executable' as const, source: 'orderbook' as const };
  const executableB = { ...q('alcor', 0.13, 0.14), confidence: 'executable' as const, source: 'orderbook' as const };
  assert.equal(findOpportunities([executableA, executableB], 1, 'executable').length, 1);
});

test('xmd pair fixture still detects indicative route math', () => {
  const xmd = { symbol: 'XMD', contract: 'xmd.token', precision: 6 };
  const a = { ...q('simpledex', 0.0026, 0.0027), quote: xmd };
  const b = { ...q('alcor', 0.0030, 0.0031), quote: xmd };
  const opps = findOpportunities([a, b], 5, 'indicative');
  assert.equal(opps.length, 1);
  assert.equal(opps[0].quote.symbol, 'XMD');
});

test('treats XMD and XUSDC as stable-equivalent quote value', () => {
  const xmd = { symbol: 'XMD', contract: 'xmd.token', precision: 6 };
  const xusdc = { symbol: 'XUSDC', contract: 'xtokens', precision: 6 };
  const buy = { ...q('simpledex', 0.0026, 0.0027), quote: xusdc };
  const sell = { ...q('alcor', 0.0030, 0.0031), quote: xmd };
  const opps = findOpportunities([buy, sell], 5, 'indicative');
  assert.equal(opps.length, 1);
  assert.match(opps[0].notes.join(' '), /stable-equivalent/);
});

import { buildMintXmdCommand, buildRedeemXmdCommand } from './execution/metaldollar.js';

test('builds Metal Dollar mint/redeem proton CLI commands without key material', () => {
  assert.deepEqual(buildMintXmdCommand('charliebot', 1.23), [
    'proton',
    'action',
    'xtokens',
    'transfer',
    JSON.stringify({ from: 'charliebot', to: 'xmd.treasury', quantity: '1.230000 XUSDC', memo: 'mint' }),
    'charliebot',
  ]);
  assert.deepEqual(buildRedeemXmdCommand('charliebot', 2), [
    'proton',
    'action',
    'xmd.token',
    'transfer',
    JSON.stringify({ from: 'charliebot', to: 'xmd.treasury', quantity: '2.000000 XMD', memo: 'redeem,XUSDC' }),
    'charliebot',
  ]);
});

import { buildRouteObservations } from './observations.js';

test('persists route observations with operator actionability', () => {
  const observations = buildRouteObservations([q('metalx', 0.10, 0.11), q('alcor', 0.105, 0.12)], [], 1);
  assert.ok(observations.length > 0);
  assert.ok(observations.every((o) => o.observed_at && o.route_key && o.operator_actionability));
  assert.ok(observations.some((o) => o.rejection_reason === 'net edge below threshold after fees'));
});

import { buildPaperTradeCandidates } from './paper.js';

test('builds and grades paper trade candidates after friction', () => {
  const obs = buildRouteObservations([q('metalx', 0.10, 0.11), q('alcor', 0.13, 0.14)], findOpportunities([q('metalx', 0.10, 0.11), q('alcor', 0.13, 0.14)], 1), 1);
  const candidates = buildPaperTradeCandidates(obs, 10, 25, 5);
  assert.ok(candidates.some((c) => c.simulatedPnlValue > 0));
});
