export interface RiskLimits {
  minConfidence: number;
  maxSessionLossUsd: number;
  maxModelCalls: number;
  maxSpreadBps: number;
  maxBookLagBlocks: number;
  maxDecisionMs: number;
}

export interface RiskState {
  pnlUsd: number;
  modelCalls: number;
  spreadBps: number;
  bookBlock: number;
  currentBlock: number;
}

export interface RiskDecision {
  action: string;
  probabilities: { buy: number; sell: number; hold: number };
  latencyMs: number;
}

const nonnegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** Pure, local risk checks. Only session-loss and model-call limits latch a halt. */
export class RiskGate {
  public haltedReason: string | null = null;
  private readonly limits: Readonly<RiskLimits>;

  constructor(limits: RiskLimits) {
    if (!limits || !Number.isFinite(limits.minConfidence) || limits.minConfidence < 0.5 || limits.minConfidence > 1) {
      throw new RangeError("minConfidence must be between 0.5 and 1");
    }
    for (const key of ["maxSessionLossUsd", "maxModelCalls", "maxSpreadBps", "maxBookLagBlocks", "maxDecisionMs"] as const) {
      if (!Number.isFinite(limits[key]) || limits[key] <= 0) {
        throw new RangeError(`${key} must be positive and finite`);
      }
    }
    for (const key of ["maxModelCalls", "maxBookLagBlocks"] as const) {
      if (!Number.isSafeInteger(limits[key])) throw new RangeError(`${key} must be a safe integer`);
    }
    this.limits = Object.freeze({ ...limits });
  }

  beforeDecision(state: RiskState): string | null {
    if (this.haltedReason !== null) return this.haltedReason;
    if (!state) return "invalid_risk_state";
    // A known breached limit must halt even if the rest of the snapshot is invalid.
    if (Number.isFinite(state.pnlUsd) && state.pnlUsd <= -this.limits.maxSessionLossUsd) {
      return (this.haltedReason = "session_loss_limit");
    }
    if (nonnegativeInteger(state.modelCalls) && state.modelCalls >= this.limits.maxModelCalls) {
      return (this.haltedReason = "model_call_limit");
    }
    if (!Number.isFinite(state.pnlUsd) || !nonnegativeInteger(state.modelCalls)) return "invalid_risk_state";
    if (!Number.isFinite(state.spreadBps) || state.spreadBps < 0 ||
        !nonnegativeInteger(state.bookBlock) || !nonnegativeInteger(state.currentBlock)) return "invalid_market_data";
    if (state.bookBlock > state.currentBlock) return "future_book";
    if (state.currentBlock - state.bookBlock > this.limits.maxBookLagBlocks) return "stale_book";
    if (state.spreadBps > this.limits.maxSpreadBps) return "spread_too_wide";
    return null;
  }

  afterDecision(decision: RiskDecision): string | null {
    if (this.haltedReason !== null) return this.haltedReason;
    if (!decision || !Number.isFinite(decision.latencyMs) || decision.latencyMs < 0 ||
        decision.latencyMs > this.limits.maxDecisionMs) return "decision_too_slow";
    const { action, probabilities: p } = decision;
    if (action !== "buy" && action !== "sell" && action !== "hold") return "invalid_decision";
    if (!p || ![p.buy, p.sell, p.hold].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      return "invalid_probabilities";
    }
    // Tiny floating-point allowance preserves the inclusive 0.01 boundary.
    if (Math.abs(p.buy + p.sell + p.hold - 1) > 0.01 + 4 * Number.EPSILON) return "invalid_probabilities";
    if (action === "hold") return "model_hold";
    if (p[action] < this.limits.minConfidence) return "low_confidence";
    if (p[action] < Math.max(p.buy, p.sell, p.hold)) return "action_not_most_likely";
    return null;
  }
}
