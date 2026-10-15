// Speech-to-text providers for live captions. The browser cuts the mic into spoken phrases
// (16 kHz mono WAV) and the server forwards each phrase to the chosen provider — API keys never
// leave the server. Order: chosen provider → other configured cloud providers → browser fallback.
import type { MatchDetail, SttProvider } from '@cricstudio/shared';

export type CloudStt = Exclude<SttProvider, 'browser'>;
export const CLOUD_STT: CloudStt[] = ['gnani', 'google', 'gemini'];

export interface SttRequest {
  wav: Buffer;
  language: string; // BCP-47, e.g. en-IN
  key: string;
  geminiModel: string;
  /** cricket words + player names to bias recognition towards */
  hints: string[];
}

const TIMEOUT_MS = 15_000;

async function call(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const det = typeof json?.detail === 'object' && json?.detail ? json.detail : null; // Gnani nests errors in `detail`
    const raw = json?.error?.message ?? json?.message ?? det?.message ?? json?.detail ?? text.slice(0, 160);
    const code = json?.error_code ?? det?.error_code ?? json?.error?.status;
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const auth = res.status === 401 || res.status === 403 || /api key|INVALID_API_KEY|PERMISSION_DENIED/i.test(`${code} ${msg}`);
    throw new Error(auth ? `API key rejected (${res.status}${code ? ` ${code}` : ''}): ${msg}` : `HTTP ${res.status}${code ? ` ${code}` : ''}: ${msg}`);
  }
  return json;
}

/** Gnani Prisma v2.5 REST — https://docs.gnani.ai/api/STT/speech-to-text */
async function gnani(r: SttRequest): Promise<string> {
  const form = new FormData();
  form.append('audio_file', new Blob([new Uint8Array(r.wav)], { type: 'audio/wav' }), 'phrase.wav');
  form.append('language_code', r.language);
  form.append('format', 'transcribe'); // ITN: "two hundred and five" → 205
  // word boosting: single words, letters only, max 100
  const words = [...new Set(r.hints.flatMap((h) => h.split(/\s+/)).filter((w) => /^[A-Za-z]{3,}$/.test(w)))].slice(0, 100);
  if (words.length) {
    form.append('bias_list', JSON.stringify(words));
    form.append('bias_score', '1.0');
  }
  const j = await call('https://api.vachana.ai/stt/v3', { method: 'POST', headers: { 'X-API-Key-ID': r.key }, body: form });
  if (j?.success === false) throw new Error(j?.message ?? 'Gnani transcription failed');
  return String(j?.transcript ?? '').trim();
}

/** Google Cloud Speech-to-Text v1 (API key) — https://cloud.google.com/speech-to-text */
async function google(r: SttRequest): Promise<string> {
  const j = await call(`https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(r.key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: r.language,
        enableAutomaticPunctuation: true,
        model: 'latest_long',
        speechContexts: r.hints.length ? [{ phrases: r.hints.slice(0, 500), boost: 10 }] : undefined,
      },
      audio: { content: r.wav.toString('base64') },
    }),
  });
  return ((j?.results ?? []) as any[])
    .map((x) => x?.alternatives?.[0]?.transcript ?? '')
    .join(' ')
    .trim();
}

/** Google AI Studio (Gemini API) audio understanding — https://ai.google.dev */
async function gemini(r: SttRequest): Promise<string> {
  const model = r.geminiModel.replace(/^models\//, '');
  const prompt =
    `Transcribe this live cricket commentary audio verbatim in language ${r.language}. ` +
    (r.hints.length ? `Names and terms that may appear: ${r.hints.slice(0, 60).join(', ')}. ` : '') +
    'Return ONLY the spoken words as plain text, no quotes, labels or notes. If there is no clear speech, return an empty string.';
  const j = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': r.key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: 'audio/wav', data: r.wav.toString('base64') } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 512 },
    }),
  });
  const text = ((j?.candidates?.[0]?.content?.parts ?? []) as any[]).map((p) => p?.text ?? '').join('').trim();
  return text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

export function transcribeWith(provider: CloudStt, r: SttRequest): Promise<string> {
  return provider === 'gnani' ? gnani(r) : provider === 'google' ? google(r) : gemini(r);
}

const CRICKET_TERMS = [
  'wicket', 'boundary', 'four', 'six', 'LBW', 'leg before', 'caught', 'bowled', 'stumped', 'run out', 'no ball', 'wide',
  'leg bye', 'maiden', 'over', 'powerplay', 'yorker', 'bouncer', 'googly', 'doosra', 'cover drive', 'pull shot',
  'sweep', 'reverse sweep', 'slip', 'gully', 'mid-wicket', 'third man', 'fine leg', 'square leg', 'mid-on', 'mid-off',
  'run rate', 'required rate', 'DRS', 'umpire', 'innings', 'century', 'fifty', 'hat-trick', 'free hit', 'death overs',
];

/** Vocabulary hints: cricket terms plus the names in the current match. */
export function cricketHints(m: MatchDetail | null): string[] {
  const names = new Set<string>();
  if (m) {
    for (const t of m.teams ?? []) {
      if (t?.name) names.add(t.name);
      if (t?.abbr) names.add(t.abbr);
    }
    for (const inn of m.innings ?? []) {
      for (const b of inn.batting ?? []) if (b?.name) names.add(b.name);
      for (const b of inn.bowling ?? []) if (b?.name) names.add(b.name);
    }
  }
  return [...names, ...CRICKET_TERMS];
}

/** A tiny valid 16 kHz WAV (0.5 s of silence) used by "Test key". */
export function silentWav(seconds = 0.5): Buffer {
  const n = Math.round(16000 * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}
