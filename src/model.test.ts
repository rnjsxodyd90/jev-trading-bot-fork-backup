import { test, expect, afterEach } from 'bun:test';
import { JevModel, type TradeState } from './model';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const state = {market:'MON-USDC', block:100} as TradeState;
test('JEV uses official endpoint and maps the typed response', async () => {
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(options!.body as string);
    expect(body.model).toBe('jev-latest'); expect(body.questions.direction.type).toBe('choice');
    return Response.json({ answers:{direction:{type:'choice', choice:'buy', probabilities:{buy:.8,sell:.2}}}, usage:{input_tokens:123} });
  }) as unknown as typeof fetch;
  const result = await new JevModel().decide(state);
  expect(result.action).toBe('buy'); expect(result.inputTokens).toBe(123); expect(result.probabilities.buy).toBe(.8);
});
test('JEV rejects malformed response instead of inventing confidence', async () => {
  globalThis.fetch = (async () => Response.json({answers:{direction:{type:'choice',choice:'buy'}}})) as unknown as typeof fetch;
  await expect(new JevModel().decide(state)).rejects.toThrow('Invalid JEV decision');
});
test('JEV HTTP failures are redacted and fail closed', async () => {
  globalThis.fetch = (async () => new Response('do not echo provider body', {status:429})) as unknown as typeof fetch;
  await expect(new JevModel().decide(state)).rejects.toThrow('HTTP 429');
});
