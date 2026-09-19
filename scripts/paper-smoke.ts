// Offline contract check. No RPC, inference calls, keys or real transactions.
import { Trader } from '../src/trader';
import type { Book, Market, Quote } from '../src/market';
import type { Model } from '../src/model';
import { config } from '../src/config';
let block = 100, quotes = 0;
const book = (): Book => ({block, bid:.02, ask:.02002, mid:.02001, spreadBps:10, imbalance:.2, levels:{bids:[[.02,1000]],asks:[[.02002,1000]]},depthBps:{}});
const market = {wallet:null,address:null, refresh:async()=>{},pollPending:async()=>[],readBook:async()=>book(),send:async (_:number,side:'buy'|'sell',size:number):Promise<Quote>=>{quotes++; return {side,size,price:.02,status:'sim',txHash:null,gasMon:0,cancel:[],orderId:null,capped:false};}} as unknown as Market;
const model: Model = {name:'offline-fixture',decide:async()=>({action:'buy',probabilities:{buy:.9,sell:.1,hold:0},upIn10:.9,inputTokens:0,latencyMs:1})};
const trader = new Trader(market,model,()=>{});
for (;block<130;block++) await trader.onBlock(block);
if (!quotes || trader.history.some(e => e.quote && (e.quote.status !== 'sim' || e.quote.txHash))) throw new Error('Paper-only contract failed');
console.log(JSON.stringify({mode:'offline fixture, synthetic prices, no fill simulation',blocks:trader.history.length,quotes,paperOnly:config.dryRun,latestRisk:trader.history.at(-1)?.risk},null,2));
