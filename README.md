# BTC Race 24h — Slow-Trend Hold Bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/hemispheren3-sys/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/hemispheren3-sys/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A make.fun `agent-fun/bars-replay/v1` bot for the [`btc-race-24h-20261123-0511` bounty on make.fun](https://make.fun/bounty/btc-race-24h-20261123-0511).

## Strategy — slow-trend hold with wide hysteresis + trailing stop

- **Indicators:** EMA fast (span 30) and EMA slow (span 120) over bar
  closes, both seeded with the first close seen and updated on every fresh
  bar close (`ema += (close - ema) * 2 / (span + 1)`). A symbol absent from
  a batch is a gap: no update.
- **Warm-up:** no trading until 120 closes have been seen, so the slow EMA
  is fully formed.
- **Entry (flat):** buy 100% of cash when the close is above both EMAs
  (`close > emaSlow` and `close > emaFast`), capped by the weight room,
  `max_slippage_bps = 100`. Skipped when cash is under 1 USDC.
- **Exit (long):** sell the entire position when the close falls 1% below
  the slow EMA (`close < emaSlow * 0.99`), or when equity has drawn down
  5% from its running peak (`equity * 100 < peak * 95`, bigint math).
  The peak starts at the initial equity and trails upward every batch.
- **Determinism:** no wall clock, no environment, no randomness — two runs
  on the same window produce byte-identical action logs.

## Dev-window result

<!-- GRADE: filled in by the coordinator after the local grade run. -->
- Net PnL (backtest, dev window): **+$31.09, 1 trade, max drawdown -1.98%**
  (per the coordinator's backtest; local grade numbers to be confirmed).

## Run locally

```sh
# Grade the bot on the dev window (from the kit directory):
node cli/makefun.mjs grade-local --entry <path-to-this-repo>
```

Or pipe NDJSON harness input straight into the bot (Node 22 type-strips
`.ts`):

```sh
node main.ts < input.ndjson
```

## Layout

- `main.ts` — the bot.
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's
  `sdk/makefun-bars.ts` protocol shim.
- `LICENSE` — MIT.
