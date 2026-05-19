# xpr-arb-radar

Watch-only arbitrage scanner for XPR Network venues:

- Metal X orderbook/ticker data
- SimpleDEX AMM pool implied prices
- Alcor ticker/AMM liquidity data on Proton/XPR

This is **not** a live trading bot yet. It is deliberately scanner-first because fake arb is everywhere: stale quotes, thin books, slippage, fees, partial fills, and weird token precision will eat the cheese before the rat gets there.

## Safety model

- No private keys in `.env`.
- No `XPR_PRIVATE_KEY` support.
- v0.1 contains no live executor.
- Future execution should shell out to the Proton CLI keychain, e.g. `proton action ... charliebot`.
- Metal X deposit memo must be the empty string `""`. Do not use `"deposit"`.
- Charlie operational rule: max `$2 XMD` per Metal X trade when live execution is eventually added.

## Install

```bash
npm install --include=dev
npm run build
```

If your shell has `NODE_ENV=production` or your npm config omits dev dependencies, plain `npm install` will not install `typescript`, so the build cannot run. Use `npm install --include=dev` or `npm ci --include=dev` for testing/building.

## Run

```bash
npm run dev -- scan --min-edge=2
# or after build
node dist/cli.js scan --min-edge=2
# defaults to XMD and XUSDC as stable-equivalent quote pairs. override with --quote=XMD if needed.
```

JSON output:

```bash
node dist/cli.js scan --min-edge=2 --json
```

Limit venues:

```bash
VENUES=metalx,alcor node dist/cli.js scan
```

## What it does

1. Fetches quotes from each enabled venue.
2. Normalizes token identity as `SYMBOL@contract`.
3. Compares matching pairs across venues.
4. Reports buy venue, sell venue, gross edge, and fee-adjusted net edge.

## Current caveats

- Some Metal X orderbook depth shapes vary; the adapter falls back to daily ticker data when depth parsing fails.
- Alcor ticker bid/ask is not a full executable-depth model.
- SimpleDEX prices are reserve-implied AMM quotes with a simple fee adjustment, not a full route simulation yet.
- Cross-venue inventory/settlement friction is not modeled.
- Treat all opportunities as leads for investigation, not trades.

## Roadmap

- Persist observations to SQLite.
- Add route-level paper trader.
- Model AMM slippage for exact trade sizes.
- Parse full Metal X depth reliably by symbol/step.
- Add Alcor pool route quotes where available.
- Add a disabled-by-default Proton CLI executor with hard limits and kill switch.

## Proton CLI execution pattern for later

Future live execution should build commands like:

```bash
proton action dex placeorder '{"market_id":1,"account":"charliebot", ...}' charliebot
```

The key stays in the local Proton CLI keychain. The Node process never sees a private key.

## Confidence tiers

Every quote is tagged before route scoring:

- `executable` — real top-of-book / executable quote shape is understood.
- `indicative` — useful radar signal, but not enough depth/size proof for autonomous execution.
- `stale` — context only, usually ticker/open/close data without executable bid/ask.
- `synthetic` — derived/fallback data; never trade from this directly.

Default scans require `indicative` or better:

```bash
node dist/cli.js scan --min-edge=2 --quote=XMD,XUSDC --min-confidence=indicative
```

For stricter testing:

```bash
node dist/cli.js scan --min-edge=2 --quote=XMD,XUSDC --min-confidence=executable
```

Stable quote handling: `XMD@xmd.token` and `XUSDC@xtokens` are treated as value-equivalent for route comparison, but mixed-quote routes are annotated so execution can rebalance intentionally.


## Metal Dollar mint/redeem planning

When a route needs to move between XUSDC and XMD, use the Metal Dollar treasury contract rather than treating the spread as a normal venue trade.

Observed on-chain pattern:

```bash
# Mint XMD from XUSDC
proton action xtokens transfer '{"from":"charliebot","to":"xmd.treasury","quantity":"1.000000 XUSDC","memo":"mint"}' charliebot

# Redeem XMD back to XUSDC
proton action xmd.token transfer '{"from":"charliebot","to":"xmd.treasury","quantity":"1.000000 XMD","memo":"redeem,XUSDC"}' charliebot
```

The scanner only builds command drafts for this. It does not execute them.


## Durable observations

By default, `scan` appends route observations to `state/observations.jsonl`.

Each JSONL row records timestamp, route, venues, confidence, rejection reason, failure type, treasury-valve requirement, and `operator_actionability`.

```bash
node dist/cli.js scan --min-edge=2
node dist/cli.js scan --min-edge=2 --state=state/observations.jsonl
node dist/cli.js scan --min-edge=2 --no-persist
```

This makes the scanner say: what was observed, how it was classified, why it was rejected, and whether it deserves escalation.
