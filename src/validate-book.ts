import type { Book } from './market';

/** Reject corrupt snapshots before they reach the model or a simulated quote. */
export function validBook(book: Book): boolean {
  if (!book || !Number.isSafeInteger(book.block) || book.block < 0) return false;
  if (![book.bid, book.ask, book.mid].every(n => Number.isFinite(n) && n > 0)) return false;
  if (book.bid > book.mid || book.mid > book.ask) return false;
  if (!Number.isFinite(book.imbalance) || Math.abs(book.imbalance) > 1) return false;
  const spread = (book.ask - book.bid) / book.mid * 10000;
  if (!Number.isFinite(book.spreadBps) || Math.abs(book.spreadBps - spread) > .1) return false;
  for (const side of ['bids','asks'] as const) {
    const levels = book.levels?.[side];
    if (!Array.isArray(levels) || !levels.length) return false;
    if (levels[0]![0] !== (side === 'bids' ? book.bid : book.ask)) return false;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      if (!Array.isArray(level) || level.length !== 2 || !Number.isFinite(level[0]) || level[0] <= 0 || !Number.isFinite(level[1]) || level[1] < 0) return false;
      if (i && (side === 'bids' ? levels[i-1]![0] < level[0] : levels[i-1]![0] > level[0])) return false;
    }
  }
  if (!book.depthBps || typeof book.depthBps !== 'object') return false;
  return Object.values(book.depthBps).every(d => !!d && [d.bid,d.ask].every(n => Number.isFinite(n) && n >= 0));
}
