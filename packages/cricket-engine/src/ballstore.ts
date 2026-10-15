import type { Ball } from '@cricstudio/shared';
import type { EspnClient } from './espn';
import { normalizeBalls } from './normalize';

/**
 * Incrementally mirrors ESPN's paginated play-by-play (page 1 = oldest, 25 per page).
 * First sync loads up to `maxPages` most recent pages; later syncs only re-fetch the
 * last page plus any newly created pages, so a live match costs ~1 request per tick.
 */
export class BallStore {
  private balls = new Map<number, Ball>();
  private pageCount = 0;
  private initialized = false;

  constructor(
    private readonly client: Pick<EspnClient, 'playByPlay'>,
    readonly leagueId: string,
    readonly eventId: string,
    private readonly maxPages = 14,
    private readonly maxBalls = 900,
  ) {}

  list(): Ball[] {
    return [...this.balls.values()].sort((a, b) => a.seq - b.seq);
  }

  private ingest(pbp: any) {
    for (const b of normalizeBalls(pbp)) this.balls.set(b.seq, b);
  }

  async sync(): Promise<Ball[]> {
    if (!this.initialized) {
      const first = await this.client.playByPlay(this.leagueId, this.eventId, 1);
      this.pageCount = Number(first?.commentary?.pageCount ?? 1) || 1;
      const start = Math.max(1, this.pageCount - this.maxPages + 1);
      if (start === 1) this.ingest(first);
      const pages: number[] = [];
      for (let p = Math.max(2, start); p <= this.pageCount; p++) pages.push(p);
      // small concurrency to be polite
      for (let i = 0; i < pages.length; i += 4) {
        const chunk = await Promise.all(pages.slice(i, i + 4).map((p) => this.client.playByPlay(this.leagueId, this.eventId, p)));
        chunk.forEach((c) => this.ingest(c));
      }
      this.initialized = true;
    } else {
      const last = await this.client.playByPlay(this.leagueId, this.eventId, this.pageCount);
      this.ingest(last);
      const newCount = Number(last?.commentary?.pageCount ?? this.pageCount) || this.pageCount;
      for (let p = this.pageCount + 1; p <= newCount; p++) {
        this.ingest(await this.client.playByPlay(this.leagueId, this.eventId, p));
      }
      this.pageCount = newCount;
    }
    if (this.balls.size > this.maxBalls) {
      const keep = this.list().slice(-this.maxBalls);
      this.balls = new Map(keep.map((b) => [b.seq, b]));
    }
    return this.list();
  }
}
