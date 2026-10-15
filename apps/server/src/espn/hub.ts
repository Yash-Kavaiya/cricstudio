import { stripBrokenLogos } from './logos';
import { BallStore, EspnClient, EventDetector, buildMatchDetail, normalizeScorepanel } from '@cricstudio/cricket-engine';
import type { CricketEvent, MatchDetail, MatchListItem } from '@cricstudio/shared';
import type { Bus } from '../bus';
import { config } from '../config';
import { DEMO_KEY, DemoReplay } from './demo';

export interface MatchUpdate {
  detail: MatchDetail;
  events: CricketEvent[];
}

type Listener = (u: MatchUpdate) => void;

interface Poller {
  key: string;
  refs: number;
  timer: NodeJS.Timeout | null;
  store?: BallStore;
  detector: EventDetector;
  latest: MatchDetail | null;
  unsub: () => void;
  listeners: Set<Listener>;
  errors: number;
  demo?: DemoReplay;
}

export const parseMatchKey = (key: string) => {
  const [leagueId, eventId] = key.split(':');
  return { leagueId, eventId };
};

/**
 * One poller per match no matter how many studios watch it.
 * With a Redis bus, only the node holding the match lock polls ESPN; all nodes receive updates.
 */
export class MatchHub {
  private pollers = new Map<string, Poller>();
  private scorepanelCache: { at: number; data: MatchListItem[] } | null = null;
  private scorepanelInflight: Promise<MatchListItem[]> | null = null;
  private demoPreview = new DemoReplay();

  constructor(
    private readonly bus: Bus,
    private readonly client = new EspnClient(),
  ) {}

  async listMatches(): Promise<MatchListItem[]> {
    const now = Date.now();
    const demo = (this.pollers.get(DEMO_KEY)?.demo ?? this.demoPreview).listItem();
    if (this.scorepanelCache && now - this.scorepanelCache.at < config.scorepanelTtlMs) return [demo, ...this.scorepanelCache.data];
    if (!this.scorepanelInflight) {
      this.scorepanelInflight = this.client
        .scorepanel()
        .then(async (raw) => {
          const data = await stripBrokenLogos(normalizeScorepanel(raw));
          this.scorepanelCache = { at: Date.now(), data };
          return data;
        })
        .catch((e) => {
          console.warn('[espn] scorepanel failed:', (e as Error).message);
          return this.scorepanelCache?.data ?? [];
        })
        .finally(() => {
          this.scorepanelInflight = null;
        });
    }
    return [demo, ...(await this.scorepanelInflight)];
  }

  /** last scorepanel snapshot (no fetch) */
  cachedMatches(): MatchListItem[] {
    return this.scorepanelCache?.data ?? [];
  }

  latest(key: string): MatchDetail | null {
    return this.pollers.get(key)?.latest ?? null;
  }

  /** One-off detail fetch (used by REST preview). */
  async fetchDetail(key: string): Promise<MatchDetail> {
    const live = this.latest(key);
    if (live) return live;
    if (key === DEMO_KEY) return this.demoPreview.detail();
    const { leagueId, eventId } = parseMatchKey(key);
    const store = new BallStore(this.client, leagueId, eventId, 6);
    const [summary, balls] = await Promise.all([this.client.summary(leagueId, eventId), store.sync().catch(() => [])]);
    return (await stripBrokenLogos([buildMatchDetail({ leagueId, eventId, summary, balls })]))[0];
  }

  subscribe(key: string, listener: Listener): () => void {
    let p = this.pollers.get(key);
    if (!p) {
      p = {
        key,
        refs: 0,
        timer: null,
        detector: new EventDetector(key),
        latest: null,
        listeners: new Set(),
        errors: 0,
        unsub: () => {},
      };
      const poller = p;
      p.unsub = this.bus.subscribe(`match:${key}`, (u: MatchUpdate) => {
        poller.latest = u.detail;
        for (const l of poller.listeners) l(u);
      });
      if (key === DEMO_KEY) p.demo = new DemoReplay();
      else {
        const { leagueId, eventId } = parseMatchKey(key);
        p.store = new BallStore(this.client, leagueId, eventId);
      }
      this.pollers.set(key, p);
      void this.tick(p);
    }
    p.refs++;
    p.listeners.add(listener);
    if (p.latest) listener({ detail: p.latest, events: [] });
    return () => {
      const cur = this.pollers.get(key);
      if (!cur) return;
      cur.listeners.delete(listener);
      if (--cur.refs <= 0) {
        if (cur.timer) clearTimeout(cur.timer);
        cur.unsub();
        this.pollers.delete(key);
      }
    };
  }

  /** Demo controls: jump/step the replay (dev + rehearsals). */
  demoStep(n = 1) {
    const p = this.pollers.get(DEMO_KEY);
    if (!p?.demo) return;
    for (let i = 0; i < n; i++) p.demo.step();
    void this.publishDemo(p);
  }

  private async publishDemo(p: Poller) {
    const detail = p.demo!.detail();
    const events = p.detector.process(p.demo!.balls(), 'in');
    await this.bus.publish(`match:${p.key}`, { detail, events } satisfies MatchUpdate);
  }

  private async tick(p: Poller) {
    if (!this.pollers.has(p.key)) return;
    let next = config.pollLiveMs;
    try {
      if (p.demo) {
        if (p.latest) {
          if (!p.demo.step()) p.detector = new EventDetector(p.key); // loop restart
        }
        await this.publishDemo(p);
        next = config.demoBallMs;
      } else {
        const lockTtl = Math.max(config.pollIdleMs, config.pollLiveMs) * 3;
        if (await this.bus.tryLock(`lock:match:${p.key}`, lockTtl)) {
          const { leagueId, eventId } = parseMatchKey(p.key);
          const [summary, balls] = await Promise.all([this.client.summary(leagueId, eventId), p.store!.sync()]);
          const [detail] = await stripBrokenLogos([buildMatchDetail({ leagueId, eventId, summary, balls })]);
          const events = p.detector.process(balls, detail.state);
          await this.bus.publish(`match:${p.key}`, { detail, events } satisfies MatchUpdate);
          next = detail.state === 'in' ? config.pollLiveMs : config.pollIdleMs;
        }
      }
      p.errors = 0;
    } catch (e) {
      p.errors++;
      next = Math.min(60_000, 5000 * 2 ** Math.min(p.errors, 4));
      console.warn(`[espn] poll ${p.key} failed (${p.errors}):`, (e as Error).message);
    }
    if (this.pollers.get(p.key) === p) p.timer = setTimeout(() => void this.tick(p), next);
  }

  stats() {
    return [...this.pollers.values()].map((p) => ({ key: p.key, refs: p.refs, errors: p.errors, state: p.latest?.state }));
  }
}
