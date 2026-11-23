// btc-race-24h-20261123-0511 — V2: slow dual-EMA trend rider.
//
// Idea: ride the slow trend only. A fast EMA(40) over bar closes tracks the
// near-term drift, a slow EMA(150) tracks the day's trend. We stay flat until
// the slow average is fully formed (150 closes), then go all-in when price
// sits above BOTH averages, and cut the whole position the moment price slips
// 1% under the slow average or equity falls 5% from its running peak.
//
// Everything is deterministic: the only inputs are the bar closes and the
// account the harness sends. No clock, no environment, no randomness —
// replaying the same window reproduces the same action log byte for byte.
//
// V2 vs V1: slower spans (40/150 instead of 30/120), so the entry fires later
// (backtest: decision seq 156, fill bar 157) and only on a confirmed trend.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// EMA spans. Alpha follows the textbook definition: alpha = 2 / (span + 1).
const FAST_SPAN = 40;
const SLOW_SPAN = 150;
const FAST_ALPHA = 2 / (FAST_SPAN + 1);
const SLOW_ALPHA = 2 / (SLOW_SPAN + 1);

// No trading until this many closes have been seen, so the slow EMA is real.
const WARMUP_CLOSES = 150;

// Smallest buy the rules allow: 1 USDC = 1,000,000 quote units.
const MIN_CASH = 1_000_000n;
// Slippage budget on every order, in basis points.
const MAX_SLIPPAGE_BPS = 100;
// Exit band: sell when close < slow EMA * 99 / 100.
const EXIT_BAND_NUM = 99;
const EXIT_BAND_DEN = 100;
// Peak-drawdown exit: sell when equity * 100 < peak * 95 (a 5% drawdown).
const DRAWDOWN_NUM = 95n;
const DRAWDOWN_DEN = 100n;

/**
 * The whole strategy state: two EMAs (null until the first close seeds them),
 * how many closes have been folded in, and the trailing equity peak.
 * EMAs are kept as plain numbers over the raw close units — the scale is the
 * same on both sides of every comparison, so no rescaling is ever needed.
 */
class TrendState {
  fastEma: number | null = null;
  slowEma: number | null = null;
  closesSeen = 0;
  peakEquity: bigint | null = null;

  /** Fold one fresh close in. Returns false when there was no bar to fold. */
  observe(closeRaw: bigint): boolean {
    const close = Number(closeRaw);
    if (this.fastEma === null || this.slowEma === null) {
      // Seed both averages at the very first close seen.
      this.fastEma = close;
      this.slowEma = close;
    } else {
      this.fastEma += FAST_ALPHA * (close - this.fastEma);
      this.slowEma += SLOW_ALPHA * (close - this.slowEma);
    }
    this.closesSeen += 1;
    return true;
  }

  get warmedUp(): boolean {
    return this.closesSeen >= WARMUP_CLOSES;
  }

  /** Track the equity peak upward; call on every batch, warm-up included. */
  trailPeak(equity: bigint): void {
    if (this.peakEquity === null || equity > this.peakEquity) {
      this.peakEquity = equity;
    }
  }

  get inUptrend(): boolean {
    return this.fastEma !== null && this.slowEma !== null;
  }
}

const trend = new TrendState();

/**
 * Decide the orders for one batch. At most one order ever leaves here:
 * a full-cash buy when flat in an uptrend, or a full-position sell when long
 * and an exit rule trips. Anything else returns no orders.
 */
function decide(state: BarsState, batch: Batch): OrderInput[] {
  // A batch without our symbol is a gap: no EMA update, no decision.
  const bar = batch.bars.find((b) => b.symbol === SYMBOL);
  if (bar === undefined) return [];

  const closeRaw = BigInt(bar.c);
  trend.observe(closeRaw);

  // The peak trails equity on every batch, warm-up included.
  trend.trailPeak(state.equity);

  // Warm-up batches reject every order, and the slow EMA is not formed yet:
  // in both cases the only correct answer is silence.
  if (state.warmingUp || !trend.warmedUp) return [];

  const close = Number(closeRaw);
  const fast = trend.fastEma as number;
  const slow = trend.slowEma as number;
  const held = state.positions.get(SYMBOL);
  const holdingQty = held === undefined ? 0n : held.qty;

  if (holdingQty > 0n) {
    // Long: exit on a 1% break under the slow average, or on a 5% drawdown
    // from the running equity peak (exact bigint comparison, no floats).
    const underBand = close < (slow * EXIT_BAND_NUM) / EXIT_BAND_DEN;
    const peak = trend.peakEquity as bigint;
    const drawnDown = state.equity * DRAWDOWN_DEN < peak * DRAWDOWN_NUM;
    if (underBand || drawnDown) {
      return [{ side: 'sell', symbol: SYMBOL, qty: holdingQty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  // Flat: go all-in only above both averages, and only with real cash.
  if (state.cash < MIN_CASH) return [];
  if (close > slow && close > fast) {
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({
  onHello(state) {
    // The peak starts at the initial equity and only ever moves up.
    trend.trailPeak(state.equity);
  },
  onBatch(state, batch) {
    return decide(state, batch);
  },
  onDone(state) {
    console.error(
      `done seq=${state.seq} equity=${state.equity} cash=${state.cash} closes=${trend.closesSeen}`,
    );
  },
});

