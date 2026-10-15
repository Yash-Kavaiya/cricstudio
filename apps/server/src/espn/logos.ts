// ESPN's API lists logo URLs for many small/associate teams that 404 on its CDN, which spams
// browser consoles and leaves empty images on the program canvas. We probe each logo once
// (HEAD, cached for a day) and drop the broken ones so the UI falls back to team initials.

const TTL_OK = 24 * 60 * 60_000;
const TTL_BAD = 6 * 60 * 60_000;
const cache = new Map<string, { ok: boolean; at: number }>();
const inflight = new Map<string, Promise<boolean>>();

const ALLOWED = /^https:\/\/a\d?\.espncdn\.com\//i; // only ever probe ESPN's image CDN

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return true; // network hiccup: don't hide a logo we couldn't check
  }
}

export async function logoOk(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  if (!ALLOWED.test(url)) return true;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.ok ? TTL_OK : TTL_BAD)) return hit.ok;
  let p = inflight.get(url);
  if (!p) {
    p = probe(url).then((ok) => {
      cache.set(url, { ok, at: Date.now() });
      if (cache.size > 5000) cache.delete(cache.keys().next().value!);
      inflight.delete(url);
      return ok;
    });
    inflight.set(url, p);
  }
  return p;
}

/** Remove broken `logo` URLs from every team object (match lists and match details). */
export async function stripBrokenLogos<T extends { teams?: { logo?: string }[] }>(items: T[]): Promise<T[]> {
  const teams = items.flatMap((m) => m.teams ?? []).filter((t) => t.logo);
  const results = await Promise.all(teams.map((t) => logoOk(t.logo)));
  teams.forEach((t, i) => {
    if (!results[i]) t.logo = undefined;
  });
  return items;
}
