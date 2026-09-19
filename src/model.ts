import { config } from "./config";

/** Models answer buy or sell; risk checks and skipped/late blocks can hold. */
export type Action = "buy" | "sell" | "hold";

/** What the model sees. Compact, relative, human-readable. */
export interface TradeState {
  market: "MON-USDC";
  block: number;
  horizonBlocks: number; // the question is about the move over this many blocks
  blockMs: number;
  mid: number;
  spreadBps: number;
  bookImbalance: number; // -1 (all asks) .. 1 (all bids), within 1% of mid
  /** Cumulative resting MON within 10/25/50 bps of mid, per side. */
  depth: { [band: string]: { bid: number; ask: number } };
  /** Top 5 levels each side, best first, as "price x size". */
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string; // oldest..newest, sampled every 5 blocks over the horizon, space separated
  /** Taker prints over the last `horizonBlocks`. cvdMon = taker buy volume - taker sell volume. */
  trades: { count: number; buyMon: number; sellMon: number; cvdMon: number; vwap: number | null; lastPrice: number | null; lastSide: "buy" | "sell" | null };
  recentTrades: string[]; // newest last, "block side size @ price"
  allowed: { buy: boolean; sell: boolean };
}

export interface Decision {
  action: Action;
  probabilities: Record<Action, number>;
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<Decision>;
}

const QUESTIONS = {
  direction: {
    type: "choice",
    instructions: {
      question: "Will MON be higher or lower than the current mid after `horizonBlocks` more blocks?",
      goal: "Trade MON-USDC on Kuru. Blocks are ~300ms; `horizonBlocks` (~30 s) is the horizon. A decision is made every few blocks and held until the next one. Orders are post-only limit orders, not market orders. Consider adverse selection and uncertainty; a directional probability is not a guarantee of profitability.",
      timing: "A post-only order rests inside or at the touch and may never fill.",
      inputs: "Taker flow is the strongest signal: `trades.cvdMon` (taker buys minus taker sells over the horizon), `trades.lastSide` and `recentTrades` show who is hitting the book. `depth` and `book` show resting liquidity per side at several distances from mid; thin depth on one side means price moves easily that way. `returnsBps` and `recentMids` show the path over the horizon. If the selected side is not allowed, no order is placed.",
    },
    criteria: {
      buy: "Buy MON now: mid more likely to be higher after `horizonBlocks` blocks, by more than the spread.",
      sell: "Sell MON now: mid more likely to be lower after `horizonBlocks` blocks, by more than the spread.",
    },
  },
} as const;

/** Official TypeSafe HTTP API; secrets stay server-side. */
export class JevModel implements Model {
  readonly name = config.jevModelId;

  async decide(state: TradeState): Promise<Decision> {
    const t0 = performance.now();
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + (process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_AI_API_KEY) },
      body: JSON.stringify({ model: config.jevModelId, state, questions: QUESTIONS }),
      signal: AbortSignal.timeout(config.maxDecisionMs),
    });
    // Do not print upstream bodies: provider errors may contain private request details.
    if (!response.ok) throw new Error("JEV request failed (HTTP " + response.status + "); no quote placed");
    const r = await response.json() as { answers?: { direction?: { type?: string; choice?: string; probabilities?: Record<string, number> } }; usage?: { input_tokens?: number } };
    const a = r.answers?.direction;
    if (!a || a.type !== "choice" || !["buy", "sell"].includes(a.choice ?? "") || !a.probabilities) throw new Error("Invalid JEV decision; no quote placed");
    const p = a.probabilities;
    const buy = p.buy, sell = p.sell;
    if (![buy, sell].every(x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1) || Math.abs(buy! + sell! - 1) > 1e-6) throw new Error("Invalid JEV probabilities");
    return {
      action: a.choice as Action,
      probabilities: { buy: buy!, sell: sell!, hold: 0 },
      upIn10: buy!,
      latencyMs: performance.now() - t0,
      inputTokens: Number.isFinite(r.usage?.input_tokens) && r.usage!.input_tokens! >= 0 ? r.usage!.input_tokens! : 0,
    };
  }
}

/** Deterministic stand-in: momentum + imbalance + mean reversion toward flat. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<Decision> {
    const t0 = performance.now();
    // momentum + book imbalance + noise, pulled back toward flat so it trades both ways
    const flow = state.trades.buyMon + state.trades.sellMon ? state.trades.cvdMon / (state.trades.buyMon + state.trades.sellMon) : 0;
    const signal = state.returnsBps.last20 / 8 + state.bookImbalance * 1.5 + flow * 2 + this.noise(state.block);
    const buy = 1 / (1 + Math.exp(-signal)); // binary softmax
    const probabilities = { buy, sell: 1 - buy, hold: 0 };
    const action: Action = buy >= 0.5 ? "buy" : "sell";
    await Bun.sleep(80); // stand in for inference time so the pipeline behaves like production
    return {
      action, probabilities,
      upIn10: buy,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    };
  }

  private noise(block: number) {
    let h = block * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => (config.model === "jev" ? new JevModel() : new MockModel());
