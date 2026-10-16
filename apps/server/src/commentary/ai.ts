// AI commentary: Gemini (Google AI Studio) writes the line, Gnani Timbre speaks it.
// Both are optional — the commentator falls back to templates and free Edge voices.
import type { CricketEvent, MatchDetail } from '@cricstudio/shared';
import { speakable } from './tts';

const LANG_NAMES: Record<string, string> = {
  'en-IN': 'Indian English (a little Hinglish flavour is fine)',
  'en-GB': 'British English',
  'en-US': 'American English',
  'en-AU': 'Australian English',
  'hi-IN': 'Hindi (Devanagari script)',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'pa-IN': 'Punjabi (Gurmukhi script)',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
};

/** Compact, factual match context so the model never has to guess numbers. */
export function matchFacts(d: MatchDetail | null): string {
  if (!d) return 'No live match attached.';
  const inn = d.innings.find((i) => i.number === d.currentInnings) ?? d.innings.at(-1);
  const bat = d.teams.find((t) => t.id === d.battingTeamId);
  const lines = [
    `Match: ${d.title}, ${d.description}${d.venue ? ` at ${d.venue}` : ''}.`,
    d.statusText && `Status: ${d.statusText}.`,
    inn && `${inn.teamName}: ${inn.runs}/${inn.wickets} in ${inn.overs} overs${inn.target ? `, chasing ${inn.target}` : ''}.`,
    d.need && `Need ${d.need.runs} from ${d.need.balls} balls${d.rrr ? ` (required rate ${d.rrr.toFixed(2)})` : ''}.`,
    d.crr ? `Current run rate ${d.crr.toFixed(2)}.` : '',
    ...d.currentBatters.map((b) => `Batter ${b.name}: ${b.runs} (${b.balls}b, ${b.fours}x4, ${b.sixes}x6).`),
    d.currentBowler && `Bowler ${d.currentBowler.name}: ${d.currentBowler.wickets}/${d.currentBowler.conceded} in ${d.currentBowler.overs} overs.`,
    d.partnership?.balls ? `Partnership ${d.partnership.runs} off ${d.partnership.balls}.` : '',
    d.recentBalls?.length ? `Last balls (oldest first): ${d.recentBalls.slice(-6).map((b) => `${b.over} ${b.short || b.label}`).join(' | ')}.` : '',
    bat && d.summary ? `Summary: ${d.summary}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function eventFacts(ev: CricketEvent | null): string {
  if (!ev) return 'Quiet spell between deliveries — offer insight, a stat-driven observation or a question to viewers.';
  const parts = [`Event: ${ev.type} — ${ev.title}`, ev.subtitle, ev.player && `player ${ev.player}`, ev.value != null && `value ${ev.value}`, ev.ball?.text && `delivery: ${ev.ball.text}`];
  return parts.filter(Boolean).join(', ') + '.';
}

export async function geminiCommentary(opts: {
  key: string;
  model: string;
  language: string;
  facts: string;
  event: string;
  fallback: string;
  recent: string[];
  timeoutMs?: number;
}): Promise<string> {
  const lang = LANG_NAMES[opts.language] ?? opts.language;
  const prompt = [
    'You are the lead TV commentator on a live cricket broadcast — energetic, knowledgeable, natural, never robotic.',
    `Write ONE spoken line (max 32 words) in ${lang} for this exact moment.`,
    'Use ONLY the facts given; never invent scores, names or numbers. No hashtags, emojis, quotes, stage directions or labels.',
    'Vary your phrasing; do not repeat these recent lines:',
    ...opts.recent.slice(-5).map((r) => `- ${r}`),
    '',
    'MATCH FACTS:',
    opts.facts,
    '',
    `MOMENT: ${opts.event}`,
    `(A plain version for reference: "${opts.fallback}")`,
  ].join('\n');
  const model = opts.model.replace(/^models\//, '');
  const send = (fast: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // thinking off = fast lines; some models don't accept it, so we retry without
        generationConfig: { temperature: 0.9, maxOutputTokens: 400, ...(fast ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
    });
  let res = await send(true);
  let j: any = await res.json().catch(() => null);
  if (res.status === 400 && /think/i.test(j?.error?.message ?? '')) {
    res = await send(false);
    j = await res.json().catch(() => null);
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${j?.error?.message ?? 'request failed'}`);
  const text = ((j?.candidates?.[0]?.content?.parts ?? []) as any[])
    .map((p) => p?.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”*]+|["'“”*]+$/g, '')
    .trim();
  if (!text) throw new Error('Gemini returned no text');
  return text.slice(0, 320);
}

/** Gnani Timbre v3.0 REST TTS → 24 kHz mono WAV. https://docs.gnani.ai/api/TTS/tts-inference */
export async function gnaniSpeech(opts: { key: string; text: string; voice: string; language: string; excited?: boolean }): Promise<Buffer> {
  const res = await fetch('https://api.vachana.ai/api/v1/tts/inference', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key-ID': opts.key },
    body: JSON.stringify({
      text: `${opts.excited ? '<excited> ' : ''}${speakable(opts.text)}`,
      voice: opts.voice,
      model: 'timbre-v3.0',
      language: opts.language.startsWith('en') ? 'en-IN' : opts.language,
      speed: 1.05,
      audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'wav' },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = t.slice(0, 160);
    try {
      const j = JSON.parse(t);
      const d = typeof j?.detail === 'object' ? j.detail : j;
      msg = d?.message ?? (typeof j?.detail === 'string' ? j.detail : msg);
    } catch {
      /* not JSON */
    }
    throw new Error(`Gnani TTS ${res.status}: ${msg}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error('Gnani TTS returned no audio');
  return buf;
}
