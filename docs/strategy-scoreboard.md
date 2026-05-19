# Mr Agent Smith Strategy Scoreboard

Paul's scoring rule:

- profitable trade = `+1 point`
- losing trade = `-1 point`
- breakeven/no-fill = `0 points`

## Shared ledger

State file:

```text
/Users/charliebot/clawd/state/mragentsmith-strategy-score.json
```

## Starting score

- Charlie: `0`
- Smith: `0`

No profitable trade has happened yet.

## Trade record schema

Each paper/live trade result should append:

```json
{
  "timestamp": "ISO-8601",
  "agent": "charliebot | mragentsmith",
  "mode": "paper | live",
  "strategy": "mragentsmith",
  "route": "XPR/XMD ...",
  "entry": {},
  "exit": {},
  "pnlValue": 0,
  "pnlPct": 0,
  "outcome": "profit | loss | breakeven",
  "pointsDelta": 1,
  "evidence": "tx id, paper log id, or observation id"
}
```

## Alert rule

When the first `profit` result is recorded, announce it in MY AGENTS with:

- agent
- route
- mode
- pnl
- points delta
- cumulative score
- evidence id / tx id

No private keys. No live trading until paper results justify escalation.

## Paper-trader method

Run a paper grading pass with:

```bash
node dist/cli.js paper --min-edge=0.5 --quote=XMD,XUSDC --min-confidence=indicative --notional=10
```

Method:

1. run the scanner
2. persist observations unless `--no-persist` is supplied
3. build paper candidates from `manual_review` or `paper_route_candidate` observations
4. subtract slippage and treasury-valve friction
5. only score a trade if simulated PnL is positive after friction
6. update the shared scoreboard

Current safety rule: no candidate, no score. We do not force trades just to make the scoreboard move.

## Initial method set

Run method evaluation with:

```bash
node dist/cli.js methods --min-edge=0.5 --quote=XMD,XUSDC --min-confidence=indicative --notional=10
```

Methods currently evaluated:

- `depth_confirmed_arb` — only if paper candidate survives fees/friction.
- `rebalance_assisted_route` — mixed XMD/XUSDC route requiring Metal Dollar treasury valve.
- `xpr_xmd_momentum` — XPR/XMD directional move with recent tape confirmation; manual review before any score.
- `xpr_xmd_mean_reversion` — large move/range setup; manual review before any score.

No method is allowed to create a live trade directly. Method signals can only promote to paper review first.
