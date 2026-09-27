/** Janela deslizante de eventos com timestamp; remove o que ficou mais velho que `spanMs`. */
export class SlidingWindow<T extends { ts: number }> {
  private items: T[] = [];
  constructor(readonly spanMs: number) {}
  push(item: T): void { this.items.push(item); }
  prune(now: number): void {
    const cutoff = now - this.spanMs;
    let i = 0;
    while (i < this.items.length && this.items[i]!.ts < cutoff) i++;
    if (i > 0) this.items.splice(0, i);
  }
  /** Itens com ts >= now - spanMs (assume push em ordem cronológica aproximada). */
  since(now: number, spanMs = this.spanMs): readonly T[] {
    const cutoff = now - spanMs;
    let i = this.items.length;
    while (i > 0 && this.items[i - 1]!.ts >= cutoff) i--;
    return this.items.slice(i);
  }
  all(): readonly T[] { return this.items; }
  get size(): number { return this.items.length; }
}
