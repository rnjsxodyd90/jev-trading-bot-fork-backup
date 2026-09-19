import { describe, expect, test } from "bun:test";
import { RiskGate, type RiskDecision, type RiskLimits, type RiskState } from "./risk";

const limits: RiskLimits = {
  minConfidence: 0.6, maxSessionLossUsd: 10, maxModelCalls: 100,
  maxSpreadBps: 20, maxBookLagBlocks: 2, maxDecisionMs: 500,
};
const state: RiskState = { pnlUsd: 0, modelCalls: 0, spreadBps: 10, bookBlock: 100, currentBlock: 100 };
const decision: RiskDecision = { action: "buy", probabilities: { buy: 0.7, sell: 0.2, hold: 0.1 }, latencyMs: 100 };
const gate = (overrides: Partial<RiskLimits> = {}) => new RiskGate({ ...limits, ...overrides });

describe("RiskGate construction", () => {
  test("starts unhalted", () => expect(gate().haltedReason).toBeNull());
  test("accepts confidence endpoints and fractional continuous limits", () => {
    expect(() => gate({ minConfidence: 0.5, maxDecisionMs: 0.1, maxSessionLossUsd: 0.1, maxSpreadBps: 0.1 })).not.toThrow();
    expect(() => gate({ minConfidence: 1 })).not.toThrow();
  });
  test("rejects invalid confidence", () => {
    for (const minConfidence of [0.49, 1.01, NaN, Infinity, -Infinity, "0.6" as unknown as number]) {
      expect(() => gate({ minConfidence })).toThrow();
    }
  });
  test("rejects nonpositive, nonfinite, and missing limits", () => {
    for (const key of ["maxSessionLossUsd", "maxModelCalls", "maxSpreadBps", "maxBookLagBlocks", "maxDecisionMs"] as const) {
      for (const value of [0, -1, NaN, Infinity, -Infinity, undefined, "1"]) {
        expect(() => gate({ [key]: value } as Partial<RiskLimits>)).toThrow();
      }
    }
    expect(() => new RiskGate(null as unknown as RiskLimits)).toThrow();
  });
  test("requires safe integers for count limits", () => {
    for (const key of ["maxModelCalls", "maxBookLagBlocks"] as const) {
      for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => gate({ [key]: value })).toThrow();
    }
  });
  test("copies limits instead of trusting subsequent caller mutations", () => {
    const mutable = { ...limits };
    const risk = new RiskGate(mutable);
    mutable.maxSessionLossUsd = 100;
    expect(risk.beforeDecision({ ...state, pnlUsd: -10 })).toBe("session_loss_limit");
  });
});

describe("beforeDecision", () => {
  test("allows healthy state without mutation", () => {
    expect(gate().beforeDecision(Object.freeze({ ...state }))).toBeNull();
  });
  test("allows loss and calls just below limits", () => {
    expect(gate().beforeDecision({ ...state, pnlUsd: -9.99, modelCalls: 99 })).toBeNull();
  });
  test("profits do not trigger the loss cap", () => expect(gate().beforeDecision({ ...state, pnlUsd: 100 })).toBeNull());
  test("latches loss at and past the inclusive boundary", () => {
    for (const pnlUsd of [-10, -11]) {
      const risk = gate();
      expect(risk.beforeDecision({ ...state, pnlUsd })).toBe("session_loss_limit");
      expect(risk.haltedReason).toBe("session_loss_limit");
      expect(risk.beforeDecision(state)).toBe("session_loss_limit");
      expect(risk.afterDecision(decision)).toBe("session_loss_limit");
    }
  });
  test("latches calls at and past the inclusive boundary", () => {
    for (const modelCalls of [100, 101]) {
      const risk = gate();
      expect(risk.beforeDecision({ ...state, modelCalls })).toBe("model_call_limit");
      expect(risk.haltedReason).toBe("model_call_limit");
      expect(risk.beforeDecision(state)).toBe("model_call_limit");
      expect(risk.afterDecision(decision)).toBe("model_call_limit");
    }
  });
  test("never replaces a previously latched reason", () => {
    const risk = gate();
    risk.beforeDecision({ ...state, modelCalls: 100 });
    expect(risk.beforeDecision({ ...state, pnlUsd: -20 })).toBe("model_call_limit");
  });
  test("known breaches win over invalid unrelated data", () => {
    expect(gate().beforeDecision({ ...state, pnlUsd: -10, spreadBps: NaN })).toBe("session_loss_limit");
    expect(gate().beforeDecision({ ...state, pnlUsd: NaN, modelCalls: 100 })).toBe("model_call_limit");
    expect(gate().beforeDecision({ ...state, pnlUsd: -10, modelCalls: 100 })).toBe("session_loss_limit");
  });
  test("invalid accounting holds without latching", () => {
    for (const patch of [{ pnlUsd: NaN }, { pnlUsd: Infinity }, { pnlUsd: -Infinity }, { modelCalls: NaN }, { modelCalls: Infinity }, { modelCalls: -1 }, { modelCalls: 0.5 }, { modelCalls: Number.MAX_SAFE_INTEGER + 1 }]) {
      const risk = gate();
      expect(risk.beforeDecision({ ...state, ...patch })).toBe("invalid_risk_state");
      expect(risk.haltedReason).toBeNull();
      expect(risk.beforeDecision(state)).toBeNull();
    }
  });
  test("invalid spread holds without latching", () => {
    for (const spreadBps of [-1, NaN, Infinity, -Infinity, "10" as unknown as number]) {
      const risk = gate();
      expect(risk.beforeDecision({ ...state, spreadBps })).toBe("invalid_market_data");
      expect(risk.haltedReason).toBeNull();
      expect(risk.beforeDecision(state)).toBeNull();
    }
  });
  test("invalid block numbers fail closed without latching", () => {
    for (const key of ["bookBlock", "currentBlock"] as const) {
      for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
        const risk = gate();
        expect(risk.beforeDecision({ ...state, [key]: value } as RiskState)).toBe("invalid_market_data");
        expect(risk.haltedReason).toBeNull();
      }
    }
  });
  test("allows exact lag limit, zero spread and genesis block", () => {
    expect(gate().beforeDecision({ ...state, bookBlock: 98 })).toBeNull();
    expect(gate().beforeDecision({ ...state, spreadBps: 0, bookBlock: 0, currentBlock: 0 })).toBeNull();
  });
  test("stale and future book holds recover", () => {
    const risk = gate();
    expect(risk.beforeDecision({ ...state, bookBlock: 97 })).toBe("stale_book");
    expect(risk.beforeDecision({ ...state, bookBlock: 101 })).toBe("future_book");
    expect(risk.haltedReason).toBeNull();
    expect(risk.beforeDecision(state)).toBeNull();
  });
  test("spread cap is inclusive and wide spread does not latch", () => {
    const risk = gate();
    expect(risk.beforeDecision({ ...state, spreadBps: 20 })).toBeNull();
    expect(risk.beforeDecision({ ...state, spreadBps: 20.01 })).toBe("spread_too_wide");
    expect(risk.haltedReason).toBeNull();
    expect(risk.beforeDecision(state)).toBeNull();
  });
  test("missing state fails closed", () => expect(gate().beforeDecision(null as unknown as RiskState)).toBe("invalid_risk_state"));
});

describe("afterDecision", () => {
  test("accepts confident buy and sell", () => {
    expect(gate().afterDecision(decision)).toBeNull();
    expect(gate().afterDecision({ ...decision, action: "sell", probabilities: { buy: 0.2, sell: 0.7, hold: 0.1 } })).toBeNull();
  });
  test("accepts exact confidence threshold", () => {
    expect(gate().afterDecision({ ...decision, probabilities: { buy: 0.6, sell: 0.3, hold: 0.1 } })).toBeNull();
  });
  test("rejects confidence below threshold on either side", () => {
    for (const action of ["buy", "sell"]) {
      expect(gate().afterDecision({ ...decision, action, probabilities: { buy: 0.5, sell: 0.5, hold: 0 } })).toBe("low_confidence");
    }
  });
  test("selected action must be most likely, even within sum tolerance", () => {
    expect(gate({ minConfidence: 0.5 }).afterDecision({ ...decision, probabilities: { buy: 0.5, sell: 0.505, hold: 0 } })).toBe("action_not_most_likely");
    expect(gate({ minConfidence: 0.5 }).afterDecision({ ...decision, action: "sell", probabilities: { buy: 0, sell: 0.5, hold: 0.505 } })).toBe("action_not_most_likely");
  });
  test("ties are allowed when confidence is met", () => {
    for (const action of ["buy", "sell"]) {
      expect(gate({ minConfidence: 0.5 }).afterDecision({ ...decision, action, probabilities: { buy: 0.5, sell: 0.5, hold: 0 } })).toBeNull();
    }
  });
  test("explicit hold always holds without a confidence requirement", () => {
    expect(gate().afterDecision({ ...decision, action: "hold" })).toBe("model_hold");
  });
  test("rejects malformed actions", () => {
    for (const action of ["BUY", "", "wait", undefined, null, 1]) {
      expect(gate().afterDecision({ ...decision, action } as RiskDecision)).toBe("invalid_decision");
    }
  });
  test("rejects invalid probability values in every side", () => {
    for (const side of ["buy", "sell", "hold"] as const) {
      for (const value of [-0.1, 1.1, NaN, Infinity, -Infinity, undefined, null, "0.7"]) {
        expect(gate().afterDecision({ ...decision, probabilities: { ...decision.probabilities, [side]: value } } as RiskDecision)).toBe("invalid_probabilities");
      }
    }
  });
  test("rejects missing or malformed probability objects, including hold", () => {
    for (const probabilities of [undefined, null, {}, [], 1, "invalid"]) {
      for (const action of ["buy", "hold"]) {
        expect(gate().afterDecision({ ...decision, action, probabilities } as RiskDecision)).toBe("invalid_probabilities");
      }
    }
  });
  test("accepts inclusive probability sum tolerance", () => {
    for (const buy of [0.69, 0.7, 0.71]) {
      expect(gate().afterDecision({ ...decision, probabilities: { buy, sell: 0.2, hold: 0.1 } })).toBeNull();
    }
  });
  test("rejects sums outside tolerance and all-zero vectors", () => {
    for (const probabilities of [{ buy: 0.689, sell: 0.2, hold: 0.1 }, { buy: 0.711, sell: 0.2, hold: 0.1 }, { buy: 0, sell: 0, hold: 0 }]) {
      expect(gate().afterDecision({ ...decision, probabilities })).toBe("invalid_probabilities");
    }
  });
  test("allows probability endpoints and confidence one", () => {
    expect(gate({ minConfidence: 1 }).afterDecision({ ...decision, probabilities: { buy: 1, sell: 0, hold: 0 } })).toBeNull();
  });
  test("accepts zero and exact maximum latency", () => {
    for (const latencyMs of [0, 500]) expect(gate().afterDecision({ ...decision, latencyMs })).toBeNull();
  });
  test("rejects slow and malformed latency even on a hold", () => {
    for (const latencyMs of [500.01, -1, NaN, Infinity, -Infinity, undefined, null, "100"]) {
      for (const action of ["buy", "hold"]) {
        expect(gate().afterDecision({ ...decision, action, latencyMs } as RiskDecision)).toBe("decision_too_slow");
      }
    }
  });
  test("missing decision fails closed", () => {
    expect(gate().afterDecision(null as unknown as RiskDecision)).toBe("decision_too_slow");
  });
  test("decision rejections never latch and inputs are not mutated", () => {
    const risk = gate();
    const frozen = Object.freeze({ ...decision, probabilities: Object.freeze({ ...decision.probabilities }) });
    risk.afterDecision({ ...decision, latencyMs: 1000 });
    risk.afterDecision({ ...decision, action: "invalid" });
    risk.afterDecision({ ...decision, probabilities: { buy: 0, sell: 0, hold: 0 } });
    expect(risk.haltedReason).toBeNull();
    expect(risk.afterDecision(frozen)).toBeNull();
  });
});
