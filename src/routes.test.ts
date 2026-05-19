import test from 'node:test';
import assert from 'node:assert/strict';
import { findOpportunities } from './routes.js';
import { invertQuote, parseAsset } from './normalize.js';
import type { MarketQuote } from './types.js';

const base = { symbol: 'XPR', contract: 'eosio.token', precision: 4 };
const quote = { symbol: 'XUSDT', contract: 'xtokens', precision: 6 };

function q(venue: MarketQuote['venue'], bid: number, ask: number, feeBps = 0): MarketQuote {
  return { venue, pairId: venue, base, quote, bid, ask, feeBps, source: 'ticker', updatedAt: new Date(0).toISOString() };
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
