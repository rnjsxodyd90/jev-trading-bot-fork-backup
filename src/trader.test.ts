import { describe, test, expect } from 'bun:test';
import { Trader, type BlockEvent } from './trader';
import { config } from './config';
import { rpc } from './chain';
import type { Book, Market, Quote } from './market';
import type { Decision, Model } from './model';

function fixture(probability = 0.9) {
  let block = 100, calls = 0, sends = 0;
  const book: Book = { block, bid: .02, ask: .02002, mid: .02001, spreadBps: 10, imbalance: .1, levels: { bids: [[.02, 1000]], asks: [[.02002, 1000]] }, depthBps: {} };
  const market = { wallet: null, address: null, refresh: async () => {}, pollPending: async () => [], readBook: async () => ({...book, block}), send: async (_b: number, side: 'buy'|'sell', size: number): Promise<Quote> => {
    sends++; return { side, size, price: book.bid, status: 'sim', txHash: null, gasMon: 0, cancel: [], orderId: null, capped: false };
  }} as unknown as Market;
  const model: Model = { name: 'test', decide: async (): Promise<Decision> => { calls++; return { action: 'buy', probabilities: { buy: probability, sell: 1-probability, hold: 0 }, upIn10: probability, inputTokens: 0, latencyMs: 1 }; }};
  const events: BlockEvent[] = [];
  const trader = new Trader(market, model, e => events.push(e));
  return { trader, model, events, book, calls: () => calls, sends: () => sends, run: async (b: number) => {block=b; await trader.onBlock(b);} };
}

describe('paper trading integration', () => {
  test('good signal makes only a simulated quote', async () => {
    const f = fixture(); await f.run(100);
    expect(f.sends()).toBe(1); expect(f.events[0]!.quote!.status).toBe('sim');
    expect(f.events[0]!.risk.paperOnly).toBe(true);
  });
  test('low-confidence signal does not trade', async () => {
    const f = fixture(.51); await f.run(100);
    expect(f.sends()).toBe(0); expect(f.events[0]!.decision!.action).toBe('hold');
  });
  test('cooldown avoids additional model calls and removes old quotes', async () => {
    const f = fixture(); await f.run(100); await f.run(101);
    expect(f.calls()).toBe(1); expect(f.events[1]!.risk.reason).toBe('decision_cooldown');
    expect(f.events[1]!.resting.bidMon).toBe(0);
  });
  test('position cap skips rather than reverses model direction', async () => {
    const f = fixture(); (f.trader as any).position = { mon: config.maxPositionMon, costUsd: config.maxPositionMon * f.book.mid };
    await f.run(100); expect(f.sends()).toBe(0); expect(f.events[0]!.risk.reason).toBe('position_cap');
  });
  test('session loss latches before asking model and stays latched', async () => {
    const f = fixture(); (f.trader as any).totals.realizedUsd = -config.maxSessionLossUsd;
    await f.run(100); (f.trader as any).totals.realizedUsd = 10; await f.run(120);
    expect(f.calls()).toBe(0); expect(f.sends()).toBe(0); expect(f.events.at(-1)!.risk.halted).toBe(true);
  });
  test('request cap stops model calls', async () => {
    const f = fixture(); (f.trader as any).modelCalls = config.maxModelCalls;
    await f.run(100); expect(f.calls()).toBe(0); expect(f.events[0]!.risk.halted).toBe(true);
  });
  test('model error removes existing paper orders and emits hold', async () => {
    const f = fixture(); await f.run(100); f.model.decide = async () => {throw new Error('fixture error');};
    await f.run(120); expect(f.sends()).toBe(1); expect(f.events.at(-1)!.risk.reason).toBe('data_or_model_error');
    expect(f.events.at(-1)!.resting.bidMon).toBe(0);
  });
  test('wide spread avoids inference', async () => {
    const f = fixture(); f.book.spreadBps = config.maxSpreadBps + 1;
    await f.run(100); expect(f.calls()).toBe(0); expect(f.sends()).toBe(0);
  });
  test('transaction RPC methods fail before any HTTP request', async () => {
    await expect(rpc('eth_sendRawTransaction', ['test'])).rejects.toThrow('Paper-only RPC');
    await expect(rpc('eth_sign', ['test'])).rejects.toThrow('Paper-only RPC');
  });
  test('unsafe startup environment is rejected', () => {
    for (const unsafe of [{PRIVATE_KEY:'not-a-real-key'}, {DRY_RUN:'false'}]) {
      const env = {...process.env, MODEL:'mock', PRIVATE_KEY:'', DRY_RUN:'true', ...unsafe};
      const child = Bun.spawnSync([process.execPath, '-e', 'import "./src/config.ts"'], {env, stdout:'pipe', stderr:'pipe'});
      expect(child.exitCode).not.toBe(0);
      expect(child.stderr.toString()).toContain('Paper-only build');
    }
  });
});

test('rejects a market instance that carries a wallet', () => {
  expect(() => new Trader({wallet: {}} as Market, {} as Model, () => {})).toThrow('Paper-only trader');
});
test('unknown/provider-specific transaction methods are denied', async () => {
  for (const method of ['eth_submitTransaction', 'eth_sendUserOperation', 'custom_executeBundle', 'unknown']) {
    await expect(rpc(method)).rejects.toThrow('Paper-only RPC');
  }
});
test('corrupt book levels do not reach inference', async () => {
  const f = fixture(); f.book.levels.bids = [[NaN,1000]];
  await f.run(100); expect(f.calls()).toBe(0); expect(f.sends()).toBe(0);
});
