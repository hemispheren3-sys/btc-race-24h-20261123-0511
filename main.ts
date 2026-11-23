// BTC race bot: slow-trend hold with wide hysteresis + trailing stop.
//
// One symbol (CBBTC), long only, all-in. Two exponential moving averages of
// the bar closes (fast span 30, slow span 120) decide the trend: enter when
// the close sits above both averages, exit when it breaks decisively below
// the slow average (1% under) or when equity has fallen 5% from its running
// peak. The wide hysteresis keeps the bot in through ordinary chop; the
// trailing peak stop caps the loss on a sharp turn. Warm-up is 120 closes,
// so the slow average is fully formed before any order is sent.
//
// Deterministic: the only inputs are the bars the harness sends. No clock,
// no environment, no randomness — two runs on the same window produce
// byte-identical action logs. Diagnostics go to stderr; stdout carries
// replies only, as the protocol requires.

import { runBars, type Bar, type BarsState, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Spans of the two trend averages, in bars. */
const FAST_SPAN = 30;
const SLOW_SPAN = 120;
/** No trading until this many closes have been seen (the slow average's span). */
const WARMUP_CLOSES = 120;
/** Exit when the close falls this far below the slow average (1%). */
const BREAKDOWN_FACTOR = 0.99;
/** Exit when equity falls this far from its running peak (5%). */
const STOP_NUM = 95n;
const STOP_DEN = 100n;
/** Smallest buy the harness accepts is its min notional; we also refuse to trade dust. */
const MIN_CASH_USDC = 1_000_000n; // 1 USDC in quote units
const MAX_SLIPPAGE_BPS = 100;

/** Smoothing constants, 2 / (span + 1), computed once. */
const FAST_ALPHA = 2 / (FAST_SPAN + 1);
const SLOW_ALPHA = 2 / (SLOW_SPAN + 1);

/** The trend state: both averages, seeded with the first close seen. */
let fastEma: number | null = null;
let slowEma: number | null = null;
/** Closes folded in so far (counts only bars actually present in a batch). */
let closesSeen = 0;
/** Running peak equity, in quote units; seeded from the hello capital. */
let peakEquity: bigint | null = null;

/** Fold one fresh close into both averages. A bar the batch does not carry adds nothing. */
function foldClose(close: number): void {
  if (fastEma === null || slowEma === null) {
    fastEma = close;
    slowEma = close;
  } else {
    fastEma += (close - fastEma) * FAST_ALPHA;
    slowEma += (close - slowEma) * SLOW_ALPHA;
  }
  closesSeen += 1;
}

/** The close is above both trend averages: the uptrend the entry wants. */
function aboveBoth(close: number): boolean {
  return fastEma !== null && slowEma !== null && close > slowEma && close > fastEma;
}

/** The close has broken decisively below the slow average: 1% under it. */
function brokenDown(close: number): boolean {
  return slowEma !== null && close < slowEma * BREAKDOWN_FACTOR;
}

/** Equity has drawn down 5% or more from its running peak (bigint-exact). */
function stoppedOut(equity: bigint): boolean {
  return peakEquity !== null && equity * STOP_DEN < peakEquity * STOP_NUM;
}

/** The whole-cash buy, capped by the weight room the caps allow. */
function buyAllIn(state: BarsState): BuyInput | null {
  const room = state.weightRoom(SYMBOL);
  const spend = state.cash < room ? state.cash : room;
  if (spend < MIN_CASH_USDC) return null;
  return { side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

/** Sell the entire held quantity of the symbol. */
function sellAll(state: BarsState): SellInput {
  const held = state.positions.get(SYMBOL)!;
  return { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

await runBars({
  onHello(state) {
    // The peak starts at the starting equity, so the first 5% slide from the
    // open is already a stop-out, not a free fall.
    peakEquity = state.equity;
  },

  onBatch(state, batch): OrderInput[] {
    // The peak trails equity upward, bar by bar, before any decision.
    if (peakEquity === null) peakEquity = state.equity;
    if (state.equity > peakEquity) peakEquity = state.equity;

    // Fold in this batch's fresh closes. A symbol absent from the batch is a
    // gap: no close, no update, no decision on it.
    let freshClose: number | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      const close = Number(bar.c);
      foldClose(close);
      freshClose = close;
    }
    if (freshClose === null) return [];

    // Warm-up batches are rejected by the replay, and the slow average is
    // not formed until 120 closes: send nothing until both are past.
    if (state.warmingUp || closesSeen < WARMUP_CLOSES) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      // Long: leave only on a decisive breakdown below the slow average, or
      // on a 5% drawdown from the running peak. Either reason sells it all.
      if (brokenDown(freshClose) || stoppedOut(state.equity)) return [sellAll(state)];
      return [];
    }

    // Flat: enter all-in when the close is above both trend averages.
    if (aboveBoth(freshClose)) {
      const buy = buyAllIn(state);
      if (buy !== null) return [buy];
    }
    return [];
  },
});
