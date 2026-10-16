// Free machine translation for template commentary lines (no API key), so every commentary
// language works even without Gemini. Google's public "gtx" endpoint; failures fall back to English.

const cache = new Map<string, string>();
const MAX_CACHE = 2000;
let downUntil = 0;

/** "hi-IN" -> "hi"; English variants need no translation */
export function targetCode(lang: string | undefined): string | null {
  const code = (lang ?? 'en-IN').split('-')[0].toLowerCase();
  return code && code !== 'en' ? code : null;
}

/** Translate an English commentary line into `lang` (BCP-47). Resolves to null when not needed or unavailable. */
export async function translateLine(text: string, lang: string | undefined, timeoutMs = 4000): Promise<string | null> {
  const tl = targetCode(lang);
  if (!tl || !text.trim()) return null;
  const key = `${tl}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (Date.now() < downUntil) return null; // cooling off after a failure, don't delay every line
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
    const body = (await res.json()) as [Array<[string, ...unknown[]]>];
    const out = (body?.[0] ?? []).map((seg) => (typeof seg?.[0] === 'string' ? seg[0] : '')).join('').trim();
    if (!out) throw new Error('empty translation');
    cache.set(key, out);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    return out;
  } catch {
    downUntil = Date.now() + 30_000;
    return null;
  }
}
