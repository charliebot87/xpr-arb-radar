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
