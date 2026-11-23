[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/hemispheren3-sys/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/hemispheren3-sys/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

# btc-race-24h-20261123-0511 — V2: slow dual-EMA trend rider

A bot that trades Coinbase Wrapped BTC (CBBTC) against USDC, minute by minute,
in the [make.fun bounty](https://make.fun/bounty/btc-race-24h-20261123-0511).
It starts with 1,000 USDC of paper money and is ranked by net PnL on the
24 hours after the deadline.

## Strategy

Slow trend-following on 1-minute bar closes, with two exponential moving
averages — EMA(40) fast, EMA(150) slow — both seeded at the first close seen
(α = 2/(N+1)), updated on every fresh bar close. A batch without CBBTC is a
gap: no update, no trade.

- **Warm-up:** no trading until 150 closes have been seen, so the slow EMA is
  fully formed.
- **Entry (flat):** buy 100% of cash when close > EMA150 **and** close >
  EMA40, `max_slippage_bps = 100`. Skipped when cash is under 1 USDC.
- **Exit (long):** sell the entire position when close < EMA150 × 0.99, **or**
  when equity has drawn down 5% from its running peak
  (exact bigint math: `equity × 100 < peak × 95`). The peak starts at the
  initial equity and trails upward every batch.
- **Determinism:** no wall clock, no environment, no randomness. Two runs on
  the same window produce byte-identical action logs.

## Dev result (local grade, `grade-local --driver process`)

| Metric | Value |
|---|---|
| Net PnL | **+$31.195505 USDC** (+3.12%) |
| Trades | 1 (buy only, held to the end) |
| Entry decision | seq **156** — fill bar 157, open $59,019.02, effective fill ≈ **$59,128.00** |
| Max drawdown | 1.98% |
| Fees | $0.812644 USDC |
| Rejected orders | 0 |
| Guardrails | met |
| Determinism | L1 regrade reproduced byte for byte; two runs, identical `result_sha256` |

## V2 vs V1

V1's action log was byte-for-byte identical to another entry's log, making it
prize-ineligible — so V2 was rebuilt from scratch with a different strategy:

- **Different EMA spans:** 40/150 instead of 30/120.
- **Different entry:** decision seq **156** (fill bar 157) instead of V1's
  seq 119 — a different trade on a different bar, so the action log differs.
- The exit rules (1% under the slow EMA, 5% peak drawdown) and the
  all-in/all-out sizing are unchanged in shape, but they now operate on the
  slower averages.

## Files

- `main.ts` — the strategy (Node 22 TypeScript, erasable syntax only).
- `vendor/makefun-bars.ts` — the kit's `agent-fun/bars-replay/v1` shim, copied
  byte-identical from the kit's `sdk/`.
- `LICENSE` — MIT.
