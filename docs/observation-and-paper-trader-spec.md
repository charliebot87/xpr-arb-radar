# XPR Arb Radar Observation + Paper Trader Spec

This is the audit trail for belief. The scanner must explain why something is or is not actionable.

## Operator actionability

Every observation and paper-trade decision must include one of:

- `none` — context only; no operator action.
- `monitor` — worth watching for persistence/freshness, not actionable yet.
- `manual_review` — interesting enough for human/agent inspection before modeling.
- `paper_route_candidate` — eligible for paper-trader simulation.
- `future_live_route_candidate` — only after paper results persist and risk controls are satisfied.

## 24h observation log fields

- `observed_at`
- `route_key`
- `base`
- `quote_value_bucket` — e.g. `USD_EQ` for XMD/XUSDC.
- `buy_venue`
- `sell_venue`
- `gross_edge_pct`
- `net_edge_pct`
- `confidence`
- `spread_frequency`
- `persistence_window_seconds`
- `venue_freshness_ms`
- `rejection_reason`
- `failure_type` — `depth_failure`, `price_failure`, `stale_data`, `precision_mismatch`, `treasury_friction`, `none`.
- `false_positive_class`
- `treasury_valve_needed` — whether XMD mint/redeem would be needed.
- `operator_actionability`

## Paper trader fields

- `decision_at`
- `route_key`
- `route`
- `quoted_edge_pct`
- `executable_size_assumption`
- `slippage_adjusted_edge_pct`
- `fee_adjusted_edge_pct`
- `treasury_valve_needed`
- `mint_redeem_cost_model`
- `simulated_fill`
- `simulated_pnl_value`
- `rejection_reason`
- `operator_actionability`

## Promotion rules

- `stale` and `synthetic` observations can never become paper routes directly.
- `indicative` observations require persistence plus manual review before becoming paper routes.
- `executable` observations may become paper routes only if executable size is modeled.
- `future_live_route_candidate` requires repeated positive paper results, explicit size caps, loss caps, and treasury valve modeling.

If the paperwork lies, shoot the paperwork.
