// Thin client for ESPN's free (key-less) cricket endpoints.
// These are undocumented public endpoints used by espn.com / espncricinfo; keep polling polite.

export const ESPN_SITE_WEB = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket';
export const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/cricket';

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export interface EspnClientOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  userAgent?: string;
}

export class EspnClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(opts: EspnClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.headers = {
      accept: 'application/json',
      'user-agent': opts.userAgent ?? 'CricStudio/1.0 (+live cricket broadcast studio)',
    };
  }

  private async get(url: string): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal, headers: this.headers });
      if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  scorepanel(): Promise<any> {
    return this.get(`${ESPN_SITE_WEB}/scorepanel`);
  }

  summary(leagueId: string, eventId: string): Promise<any> {
    return this.get(`${ESPN_SITE_WEB}/${encodeURIComponent(leagueId)}/summary?event=${encodeURIComponent(eventId)}`);
  }

  playByPlay(leagueId: string, eventId: string, page = 1): Promise<any> {
    return this.get(
      `${ESPN_SITE}/${encodeURIComponent(leagueId)}/playbyplay?event=${encodeURIComponent(eventId)}&page=${page}`,
    );
  }
}
