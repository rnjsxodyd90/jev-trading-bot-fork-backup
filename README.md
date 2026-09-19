# JEV Trading Bot

A **paper-only MON/USDC trading research bot**, forked from [jarrodwatts/jev-trader](https://github.com/jarrodwatts/jev-trader). Watches the Kuru order book on Monad, asks TypeSafe JEV for a directional probability, and simulates post-only limit orders only when local risk checks pass.

**No real-money trading. No wallet required. No promise of profitability.** The original MIT license and attribution are preserved. JEV is a hosted proprietary model, not part of this open-source code.

## What changed from upstream

- Paper-only startup: rejects `PRIVATE_KEY` and `DRY_RUN=false`; only explicitly allowlisted read-only JSON-RPC methods are permitted.
- Confidence threshold, position cap, spread and stale-book checks, inference timeout, and cooldown.
- Latched session-loss and model-request limits. Stops inference and new quotes after a limit; continues monitoring. Restart resets the session, not a safe production loss budget.
- Never reverses a model signal just because the preferred side hits the position cap.
- Strict JEV response checks using the official HTTP API. Corrected prompt describes actual post-only orders.
- Local dashboard shows paper mode, hold reason, halt state, and request count.
- Tests, type-checking, offline smoke runner, and CI.

## Quick start

Requires [Bun](https://bun.sh) 1.4.2 or later.

```sh
git clone https://github.com/rnjsxodyd90/jev-trading-bot.git
cd jev-trading-bot
bun install --frozen-lockfile
cp .env.example .env
bun run start
```

The default `MODEL=mock` is a deterministic heuristic, **not JEV**. It needs no API key but reads public chain data. The backend is at `http://localhost:3000` and binds to loopback by default.

### Use your JEV key

In the local `.env`, set `MODEL=jev` and `TYPESAFE_API_KEY` to your own TypeSafe key. The legacy `TYPESAFE_AI_API_KEY` name is also supported. Keep the key in a secret manager or local ignored `.env`; never put it in frontend variables, screenshots, or commits. No key is included in this repository.

The backend calls `POST https://api.typesafe.ai/v1/systemone` with `jev-latest`. This can incur API charges. Defaults allow at most **300 attempted inference calls per process**, spaced by at least **10 observed block numbers**, with no immediate retry on provider errors. The cap limits requests, not dollars. Check [TypeSafe documentation](https://docs.typesafe.ai/api) and current billing before enabling JEV. No real-key inference was required for the automated tests.

### Dashboard

In a second terminal:

```sh
cd web
bun install --frozen-lockfile
cp .env.example .env.local
bun run dev --port 3001 --webpack
```

Open `http://localhost:3001`. It connects to **your local bot**, not the upstream author's deployed server. If changing ports/origins, update both `NEXT_PUBLIC_API_URL` and backend `ALLOWED_ORIGIN`.

### Verify without any network or API key

```sh
bun run test
bun run typecheck
bun run test:offline
```

The offline smoke runner uses synthetic prices and a fixed decision fixture. It exercises quotes and risk gates but does not benchmark performance or simulate market fills. Tests mock the JEV response and check unsafe startup rejection, transaction-RPC blocking, cooldown, confidence, position caps, stale data, malformed responses and latched limits.

## Risk settings

| Setting | Default | Meaning |
| --- | ---: | --- |
| `MIN_CONFIDENCE` | 0.65 | Minimum probability of the selected direction; not expected return |
| `MAX_SESSION_LOSS_USD` | 5 | Latch when realized + marked unrealized PnL minus modeled gas reaches -$5 |
| `MAX_MODEL_CALLS` | 300 | Maximum inference attempts before latched halt |
| `MAX_POSITION_MON` | 1000 | Simulated absolute inventory cap |
| `TRADE_SIZE_MON` | 200 | Simulated quote size, at least the upstream market minimum |
| `MAX_SPREAD_BPS` | 50 | Skip wide-spread books |
| `MAX_BOOK_LAG_BLOCKS` | 5 | Maximum accepted snapshot lag |
| `MAX_DECISION_MS` | 1000 | HTTP timeout and total decision-path freshness budget |
| `DECISION_EVERY_BLOCKS` | 10 | Minimum block-number gap between attempts |

A halt **does not liquidate inventory**. The simulated position remains marked to market and can keep losing value. Resting simulated quotes are cleared on a skipped/failed decision after reconciling available prints. Holds do not automatically close a position. A restart resets all inventory/accounting/limits; `data/events.jsonl` is an audit log, not a restart checkpoint.

## Endpoints

- `GET /`: mode, market, latest event, risk limits.
- `GET /health`: `starting` or `ready` plus paper-only flag. This is basic process/readiness reporting, not a market freshness guarantee.
- `GET /history`: last 1,000 events.
- `GET /events`: SSE snapshots, blocks, quotes and fills.

Events include `risk: { paperOnly, reason, halted, modelCalls }`. Disk logs append to ignored `data/events.jsonl`; rotate/delete them for long runs. API streams are unauthenticated, so do not expose the service publicly without access control. Docker binds to `0.0.0.0`; publish its port only on your intended interface.

## Important simulation limitations

This is an educational research fork, **not a production execution system or investment advice**. Public RPC can fail, lag, or rate-limit. The inherited fill model assumes a crossing trade print can fill our synthetic order; it does not faithfully model queue position, order placement latency, partial print allocation across competing orders, fees, gas, or adverse selection. Simulated short inventory is a signed accounting model, not a funded spot borrow facility. `BANKROLL_USD` is a PnL denominator, not a cash/margin account. Paper gas is zero and model charges are reported separately as an inherited rough estimate, not deducted from PnL; verify current pricing. Never interpret paper PnL as expected live returns. These controls have not been audited for live use.

## Layout

- `src/config.ts`: validated paper-only configuration.
- `src/model.ts`: official JEV HTTP adapter and mock heuristic.
- `src/risk.ts`: pure risk gates.
- `src/trader.ts`: book, decisions, simulated quoting, accounting, audit trail.
- `src/book.ts`, `src/market.ts`, `src/trades.ts`: inherited Kuru market adapters. Upstream live-order implementation remains for attribution/history but is disabled by this fork's configuration and RPC guard.
- `src/server.ts`: local JSON and SSE API.
- `web/`: upstream Next.js dashboard with paper-mode/risk visibility.
- `scripts/paper-smoke.ts`: network-free contract check.

## License and attribution

MIT. Original copyright (c) 2026 Jarrod Watts. See [LICENSE](LICENSE). Derived from upstream commit `b587759`; the GitHub fork retains the original history. This project is not affiliated with TypeSafe, Kuru, Monad, or the upstream author. Historical `SPEC.md` describes upstream behavior; this README describes the guarded fork.
