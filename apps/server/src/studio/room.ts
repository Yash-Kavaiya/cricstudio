import { existsSync } from 'node:fs';
import type { Server } from 'socket.io';
import { EDGE_LANG_VOICES, GNANI_VOICES, type AiCommentaryStatus, type ChatMessage, type CommentaryLine, type CricketEvent, type MatchDetail, type MatchListItem, type Participant, type StudioState, type SttProvider, type Suggestion } from '@cricstudio/shared';
import { eventFacts, geminiCommentary, gnaniSpeech, matchFacts } from '../commentary/ai';
import { AutomationEngine } from '../automation/rules';
import { Commentator } from '../commentary/commentator';
import { config } from '../config';
import { DEMO_KEY } from '../espn/demo';
import type { MatchHub } from '../espn/hub';
import { decrypt, encrypt } from '../store/crypto';
import { CLOUD_STT, cricketHints, silentWav, transcribeWith, type CloudStt } from '../stt/providers';
import type { Repo, StudioRecord } from '../store/repo';
import type { Bus } from '../bus';
import { LivePipeline, type StreamTarget } from '../stream/pipeline';
import { CloudProducer, findChrome } from '../worker/cloudProducer';

const LEASE_TTL_MS = 20_000;
const PERSISTED = ['scene', 'baseScene', 'automation', 'rules', 'music', 'brand', 'countdownTo', 'spotlightId', 'autopilot', 'wantLive', 'stt'] as const;

export function defaultState(rec: StudioRecord): StudioState {
  return {
    id: rec.id,
    name: rec.name,
    matchKey: rec.matchKey,
    participants: [],
    scene: 'startingSoon',
    baseScene: 'startingSoon',
    sceneUntil: null,
    overlay: null,
    automation: 'auto',
    rules: {
      wicket: true,
      boundary: true,
      overEnd: true,
      milestones: true,
      inningsBreak: true,
      idleRotation: true,
      idleSeconds: 75,
    },
    pinnedUntil: 0,
    live: { state: 'idle', mode: 'mesh', destinations: [] },
    music: { track: 'stadium-anthem', playing: false, volume: 0.35, duck: true, ambience: { on: false, volume: 0.3, mood: 'buzzing' } },
    brand: {
      title: rec.name,
      ticker: 'Welcome to the live cricket show! Drop your predictions in the chat 🏏',
      accent: '#1a73e8',
      showScorebug: true,
      showTicker: true,
      captions: false,
      sfx: true,
      sfxVolume: 0.8,
      background: 'stadiumNight',
      transition: 'mixed',
      fx3d: true,
      pollQuestion: 'Who wins this match? Vote in the comments!',
    },
    countdownTo: null,
    spotlightId: null,
    autopilot: {
      enabled: false,
      sceneSeconds: 8,
      scoreShare: 0.7,
      includeCameras: false,
      commentator: true,
      voice: config.ttsVoice,
      chatterSeconds: 35,
      autoMusic: true,
      autoMatch: false,
      cloud: false,
      writer: 'templates',
      voiceEngine: 'edge',
      gnaniVoice: 'Shubham',
      commentaryLanguage: 'en-IN',
    },
    stt: { provider: 'browser', language: 'en-IN', geminiModel: 'gemini-2.5-flash', configured: { gnani: false, google: false, gemini: false } },
    transition: 'fadeZoom',
    wantLive: false,
  };
}

/** prefer international cricket, then major T20 leagues, then everything else */
function matchRank(m: MatchListItem): number {
  const t = `${m.leagueName} ${m.description}`.toLowerCase();
  let r = m.state === 'in' ? 1000 : m.state === 'pre' ? 0 : -1000;
  if (/world cup|champions trophy|asia cup|tour of|test|odi|t20i/.test(t)) r += 300;
  if (/premier league|ipl|big bash|psl|caribbean|sa20|hundred|major league|ilt20|wpl/.test(t)) r += 200;
  if (/women/.test(t)) r += 20;
  if (m.teams.some((x) => x.score)) r += 10;
  return r;
}

export class StudioRoom {
  state: StudioState;
  automation: AutomationEngine;
  commentator: Commentator;
  chat: ChatMessage[] = [];
  pipeline: LivePipeline | null = null;
  cloud: CloudProducer | null = null;
  producerId: string | null = null; // cloud producer socket
  hostLeftTimer: NodeJS.Timeout | null = null;
  private unsubMatch: (() => void) | null = null;
  private emitQueued = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private autoMatchTimer: NodeJS.Timeout;
  private postSince = 0;
  latestMatch: MatchDetail | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  /** encrypted speech-to-text API keys (never broadcast) */
  private sttKeys: Partial<Record<CloudStt, string>> = {};

  constructor(
    readonly record: StudioRecord,
    private readonly io: Server,
    private readonly hub: MatchHub,
    private readonly repo: Repo,
    private readonly bus: Bus,
  ) {
    const base = defaultState(record);
    let saved: Partial<StudioState> = {};
    try {
      saved = JSON.parse(record.settings || '{}');
    } catch {
      /* ignore */
    }
    this.state = {
      ...base,
      ...Object.fromEntries(PERSISTED.filter((k) => saved[k] !== undefined).map((k) => [k, saved[k]])),
      rules: { ...base.rules, ...(saved.rules ?? {}) },
      brand: { ...base.brand, ...(saved.brand ?? {}) },
      music: { ...base.music, ...(saved.music ?? {}), playing: false },
      autopilot: { ...base.autopilot, ...(saved.autopilot ?? {}) },
      stt: { ...base.stt, ...(saved.stt ?? {}) },
    };
    // speech-to-text API keys: encrypted at rest, kept out of the broadcast state
    const savedKeys = ((saved as { sttKeys?: Partial<Record<CloudStt, string>> }).sttKeys ?? {}) as Partial<Record<CloudStt, string>>;
    for (const p of CLOUD_STT) if (typeof savedKeys[p] === 'string' && savedKeys[p]) this.sttKeys[p] = savedKeys[p];
    this.state.stt.configured = { gnani: !!this.sttKeys.gnani, google: !!this.sttKeys.google, gemini: !!this.sttKeys.gemini };
    this.state.sceneUntil = null;
    if (this.state.scene !== this.state.baseScene) this.state.scene = this.state.baseScene;
    this.automation = new AutomationEngine({
      state: () => this.state,
      commit: () => this.commit(),
      suggest: (s) => this.suggest(s),
      match: () => this.latestMatch,
    });
    this.commentator = new Commentator({
      enabled: () => this.state.autopilot.commentator && (this.state.autopilot.enabled || this.isLive),
      voice: () => this.state.autopilot.voice,
      chatterSeconds: () => this.state.autopilot.chatterSeconds,
      match: () => this.latestMatch,
      matches: () => this.hub.cachedMatches(),
      poll: () => this.state.brand.pollQuestion,
      emit: (line) => this.speak(line),
      write: (ev, fallback, recent) => this.writeLine(ev, fallback, recent),
    });
    this.autoMatchTimer = setInterval(() => void this.autoMatch(), 60_000);
    this.autoMatchTimer.unref?.();
    if (record.matchKey) this.setMatch(record.matchKey);
  }

  get roomName() {
    return `studio:${this.state.id}`;
  }

  get host(): Participant | undefined {
    return this.state.participants.find((p) => p.role === 'host');
  }

  get isLive() {
    return !!this.pipeline?.running;
  }

  guests(): Participant[] {
    return this.state.participants.filter((p) => p.role === 'guest');
  }

  setMatch(key: string | null) {
    this.unsubMatch?.();
    this.unsubMatch = null;
    this.latestMatch = null;
    this.postSince = 0;
    this.state.matchKey = key;
    this.automation.refreshPlaylist();
    if (key) {
      let first = true;
      this.unsubMatch = this.hub.subscribe(key, ({ detail, events }) => {
        this.latestMatch = detail;
        this.io.to(this.roomName).emit('match:update', detail);
        if (first) {
          first = false;
          if (this.state.autopilot.enabled) this.commentator.intro(detail, this.state.brand.title);
        }
        if (events.length) {
          this.io.to(this.roomName).emit('match:events', events);
          this.automation.onEvents(events);
          this.commentator.onEvents(events);
        }
      });
    }
    void this.repo.updateStudio(this.state.id, { matchKey: key });
    this.commit();
  }

  /** 24/7: keep a live match on air; fall back to the demo replay when nothing is live. */
  async autoMatch(force = false) {
    const ap = this.state.autopilot;
    if (!ap.enabled || !ap.autoMatch) return;
    const cur = this.latestMatch;
    if (cur?.state === 'post') this.postSince ||= Date.now();
    const curDone = !!cur && cur.state === 'post' && Date.now() - this.postSince > 10 * 60_000;
    const curIdle = !this.state.matchKey || (cur && cur.state === 'pre') || this.state.matchKey === DEMO_KEY;
    if (!force && !curDone && !curIdle) return;
    const list = (await this.hub.listMatches()).filter((m) => !m.isDemo);
    const best = list.filter((m) => m.state === 'in').sort((a, b) => matchRank(b) - matchRank(a))[0];
    const key = best ? `${best.leagueId}:${best.id}` : DEMO_KEY;
    if (key !== this.state.matchKey) {
      this.setMatch(key);
      this.speakText(best ? `We're heading over to ${best.name}. ${best.statusText}.` : 'No live matches right now, so here is a classic replay.');
    }
  }

  /* ---------------- commentary ---------------- */

  /** Gemini rewrite of a commentary moment; resolves to the template line whenever AI is off or failing. */
  private async writeLine(ev: CricketEvent | null, fallback: string, recent: string[]): Promise<{ text: string; ai: boolean }> {
    const ap = this.state.autopilot;
    if (ap.writer !== 'gemini') return { text: fallback, ai: false };
    if (Date.now() < this.geminiDownUntil) return { text: fallback, ai: false }; // cooling off after a failure
    const key = this.sttKey('gemini');
    if (!key) {
      this.setAiStatus({ writer: 'fallback', error: 'Gemini selected but no Google AI Studio key is saved' });
      return { text: fallback, ai: false };
    }
    try {
      const text = await geminiCommentary({
        key,
        model: this.state.stt.geminiModel,
        language: ap.commentaryLanguage ?? 'en-IN',
        facts: matchFacts(this.latestMatch),
        event: eventFacts(ev),
        fallback,
        recent,
      });
      this.setAiStatus({ writer: 'gemini', error: undefined });
      return { text, ai: true };
    } catch (e) {
      this.geminiDownUntil = Date.now() + 30_000; // don't make every line wait on a failing API
      this.setAiStatus({ writer: 'fallback', error: (e as Error).message });
      return { text: fallback, ai: false };
    }
  }

  private geminiDownUntil = 0;
  private gnaniDownUntil = 0;

  private setAiStatus(p: Partial<AiCommentaryStatus>) {
    const ap = this.state.autopilot;
    const base: AiCommentaryStatus = this.state.aiStatus ?? { writer: ap.writer === 'gemini' ? 'gemini' : 'templates', voice: ap.voiceEngine === 'gnani' ? 'gnani' : 'edge' };
    const next = { ...base, ...p };
    if (JSON.stringify(next) === JSON.stringify(this.state.aiStatus)) return;
    this.state.aiStatus = next;
    this.commit();
  }

  /** recent lines (id -> line + Gnani audio) so 'commentary:tts' can only voice what the commentator said */
  private lines = new Map<string, { line: CommentaryLine; audio?: Promise<Buffer> }>();

  private speak(lineIn: CommentaryLine) {
    const ap = this.state.autopilot;
    // AI lines are written in the chosen language; templates and system lines are English
    const lang = lineIn.ai ? (ap.commentaryLanguage ?? 'en-IN') : (lineIn.lang ?? 'en-IN');
    const edgeVoice = lang.startsWith('en') ? ap.voice : (EDGE_LANG_VOICES[lang] ?? ap.voice);
    const gnani = ap.voiceEngine === 'gnani' && !!this.sttKey('gnani') && Date.now() >= this.gnaniDownUntil;
    if (ap.voiceEngine === 'gnani' && !gnani) this.setAiStatus({ voice: 'fallback', error: 'Gnani voice selected but no Gnani key is saved' });
    const line: CommentaryLine = { ...lineIn, lang, voice: edgeVoice, engine: gnani ? 'gnani' : 'edge' };
    const entry: { line: CommentaryLine; audio?: Promise<Buffer> } = { line };
    if (gnani) {
      // start synthesis now so the audio is ready (or nearly) when the program page asks for it
      entry.audio = gnaniSpeech({
        key: this.sttKey('gnani')!,
        text: line.text,
        voice: GNANI_VOICES.some((v) => v.id === ap.gnaniVoice) ? ap.gnaniVoice! : 'Shubham',
        language: lang,
        excited: line.priority >= 2,
      });
      entry.audio.then(
        () => this.setAiStatus({ voice: 'gnani' }),
        (e: Error) => {
          this.gnaniDownUntil = Date.now() + 30_000;
          this.setAiStatus({ voice: 'fallback', error: e.message });
        },
      );
    }
    this.lines.set(line.id, entry);
    while (this.lines.size > 20) this.lines.delete(this.lines.keys().next().value!);
    this.io.to(this.roomName).emit('commentary:say', line);
    this.io.to(this.roomName).emit('captions:text', { from: 'AI Commentator', text: line.text, final: true, ts: Date.now() });
  }

  speakText(text: string, priority = 2, lang?: string) {
    if (!this.state.autopilot.commentator) return;
    this.speak({ id: `m${Date.now()}`, text, voice: this.state.autopilot.voice, priority, ts: Date.now(), lang });
  }

  /** Gnani audio for a line this room spoke (WAV), or null -> client uses the Edge fallback voice. */
  async ttsLine(id: string): Promise<Buffer | null> {
    const e = this.lines.get(id);
    if (!e?.audio) return null;
    try {
      return await e.audio;
    } catch {
      return null;
    }
  }

  /** Check the AI commentary setup end-to-end with a sample line. */
  async testCommentary(): Promise<{ text: string; ai: boolean; writerError?: string; voiceOk?: boolean; voiceError?: string; audio?: Buffer }> {
    const ap = this.state.autopilot;
    const fallback = 'What a shot! That races away to the boundary for four.';
    const out: { text: string; ai: boolean; writerError?: string; voiceOk?: boolean; voiceError?: string; audio?: Buffer } = { text: fallback, ai: false };
    if (ap.writer === 'gemini') {
      const key = this.sttKey('gemini');
      if (!key) out.writerError = 'No Google AI Studio key saved';
      else
        try {
          out.text = await geminiCommentary({ key, model: this.state.stt.geminiModel, language: ap.commentaryLanguage ?? 'en-IN', facts: matchFacts(this.latestMatch), event: 'A cracking boundary just now.', fallback, recent: [] });
          out.ai = true;
        } catch (e) {
          out.writerError = (e as Error).message;
        }
    }
    if (ap.voiceEngine === 'gnani') {
      const key = this.sttKey('gnani');
      if (!key) out.voiceError = 'No Gnani key saved';
      else
        try {
          out.audio = await gnaniSpeech({ key, text: out.text, voice: ap.gnaniVoice ?? 'Shubham', language: out.ai ? (ap.commentaryLanguage ?? 'en-IN') : 'en-IN', excited: true });
          out.voiceOk = true;
        } catch (e) {
          out.voiceError = (e as Error).message;
        }
    }
    return out;
  }

  /* ---------------- live pipeline ---------------- */

  private internalWebUrl() {
    if (config.internalWebUrl) return config.internalWebUrl;
    // production serves the built UI itself; in development the Vite dev server has the latest code
    return process.env.NODE_ENV === 'production' && existsSync(config.webDist) ? `http://127.0.0.1:${config.port}` : config.publicUrl;
  }

  /** socket that must produce the WebM feed right now */
  producerSocket(): string | undefined {
    if (!this.pipeline) return undefined;
    return this.state.live.broadcaster === 'cloud' ? this.producerId ?? undefined : this.host?.id;
  }

  async loadTargets(): Promise<StreamTarget[]> {
    const dests = (await this.repo.listDestinations(this.state.id)).filter((d) => d.enabled);
    return dests.map((d) => ({ id: d.id, platform: d.platform, name: d.name, url: d.url, key: decrypt(d.keyEnc) }));
  }

  async startLive(broadcaster: 'host' | 'cloud'): Promise<{ ok: boolean; error?: string }> {
    if (this.pipeline?.running) return { ok: false, error: 'Already live' };
    if (config.streamingDisabled) {
      return {
        ok: false,
        error:
          'Live streaming is off on this hosted site: Vercel cuts every connection after ~5 minutes, which ends YouTube streams. ' +
          'Run CricStudio on your PC (npm run dev) and go live from http://localhost:5180.',
      };
    }
    const targets = await this.loadTargets();
    if (!targets.length) return { ok: false, error: 'Add and enable at least one destination (YouTube, Facebook, X, Twitch…).' };
    if (broadcaster === 'cloud' && !findChrome()) return { ok: false, error: 'Cloud producer needs Chrome/Chromium on the server (set CHROME_PATH).' };
    // one encoder per studio across all server instances — two would fight over the same stream keys
    if (!(await this.bus.tryLock(this.leaseKey, LEASE_TTL_MS))) {
      return { ok: false, error: 'This studio is already streaming from another server instance. Try again in ~20 seconds.' };
    }
    this.startLease();
    const p = new LivePipeline(this.state.id, targets, broadcaster);
    this.pipeline = p;
    p.on('status', (s) => {
      if (this.pipeline !== p) return;
      this.state.live = { ...s, mode: 'mesh', broadcaster: this.state.live.broadcaster ?? broadcaster };
      this.commit();
    });
    p.on('needRestart', () => {
      const id = this.producerSocket();
      if (id) this.io.to(id).emit('stream:restart');
    });
    p.on('log', (line: string) => this.logToHost(line));
    this.state.live = { ...this.state.live, broadcaster };
    p.start();
    this.state.wantLive = true;
    if (broadcaster === 'cloud') {
      this.state.autopilot = { ...this.state.autopilot, enabled: true, cloud: true };
      await this.ensureCloud();
    }
    this.commit();
    void this.persist();
    return { ok: true };
  }

  async ensureCloud() {
    if (this.cloud?.running) return;
    const web = this.internalWebUrl();
    // connect the producer's socket straight to this server (never through a dev proxy) — it carries ~6 Mbps
    const api = `http://127.0.0.1:${config.port}`;
    const url = `${web}/program/${this.state.id}?k=${encodeURIComponent(config.workerSecret)}&producer=1${web.startsWith(api) ? '' : `&api=${encodeURIComponent(api)}`}`;
    const c = new CloudProducer(this.state.id, url);
    this.cloud = c;
    c.on('log', (l: string) => this.logToHost(l));
    c.on('error', (e: Error) => {
      this.state.live = { ...this.state.live, state: 'error', error: e.message };
      this.commit();
    });
    await c.start();
  }

  /** producer (cloud page) connected → tell it to start recording if we're live */
  onProducerJoined(socketId: string) {
    this.producerId = socketId;
    if (this.pipeline?.running && this.state.live.broadcaster === 'cloud') this.io.to(socketId).emit('producer:start');
  }

  /** host browser dropped while it was the producer → hand the show to the cloud */
  scheduleFailover() {
    if (!this.pipeline?.running || this.state.live.broadcaster !== 'host') return;
    if (this.hostLeftTimer) clearTimeout(this.hostLeftTimer);
    this.hostLeftTimer = setTimeout(async () => {
      this.hostLeftTimer = null;
      if (this.host || !this.pipeline?.running) return;
      if (!findChrome()) {
        this.logToHost('Host disconnected and no cloud producer is available — stream paused.');
        return;
      }
      this.state.live = { ...this.state.live, broadcaster: 'cloud' };
      this.state.autopilot = { ...this.state.autopilot, enabled: true };
      this.commit();
      await this.ensureCloud();
    }, config.hostFailoverMs);
  }

  private get leaseKey() {
    return `cs:live:${this.state.id}`;
  }

  /** Renew the live lease; if another instance took it, stop our copy of the stream. */
  private startLease() {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.leaseTimer = setInterval(async () => {
      if (!this.pipeline?.running) return;
      const ok = await this.bus.tryLock(this.leaseKey, LEASE_TTL_MS).catch(() => true);
      if (ok) return;
      this.logToHost('Another server instance took over this live stream — stopping the duplicate here.');
      this.stopLease();
      this.pipeline?.stop();
      this.pipeline = null;
      await this.cloud?.stop();
      this.cloud = null;
    }, 5000);
    this.leaseTimer.unref?.();
  }

  private stopLease() {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.leaseTimer = null;
    void this.bus.release(this.leaseKey).catch(() => undefined);
  }

  /** Server instance shutting down: stop cleanly but keep `wantLive` so the next instance resumes. */
  async suspendLive() {
    if (!this.pipeline?.running) return;
    this.pipeline.stop();
    this.pipeline = null;
    await this.cloud?.stop();
    this.cloud = null;
    this.stopLease();
    await this.persist();
  }

  async stopLive() {
    this.state.wantLive = false;
    this.stopLease();
    this.pipeline?.stop();
    this.pipeline = null;
    await this.cloud?.stop();
    this.cloud = null;
    const id = this.producerId;
    if (id) this.io.to(id).emit('producer:stop');
    this.state.live = {
      ...this.state.live,
      state: 'idle',
      startedAt: undefined,
      error: undefined,
      destinations: this.state.live.destinations.map((d) => ({ ...d, state: 'idle' })),
    };
    this.commit();
    void this.persist();
  }

  private logToHost(line: string) {
    const h = this.host;
    if (h) this.io.to(h.id).emit('stream:log', line);
  }

  /* ---------------- state sync ---------------- */

  /** Coalesce state broadcasts to one per tick. */
  commit() {
    if (!this.emitQueued) {
      this.emitQueued = true;
      queueMicrotask(() => {
        this.emitQueued = false;
        this.io.to(this.roomName).emit('studio:state', this.state);
      });
    }
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persist(), 1500);
  }

  /* ---------------- speech-to-text (live captions) ---------------- */

  /** Update provider/language/model and save or clear API keys (null/'' clears). */
  setStt(p: { provider?: SttProvider; language?: string; geminiModel?: string; keys?: Partial<Record<CloudStt, string | null>> }) {
    const stt = { ...this.state.stt };
    if (p.provider && (p.provider === 'browser' || CLOUD_STT.includes(p.provider))) stt.provider = p.provider;
    if (typeof p.language === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(p.language)) stt.language = p.language;
    if (typeof p.geminiModel === 'string' && /^[\w.\-/]{3,80}$/.test(p.geminiModel.trim())) stt.geminiModel = p.geminiModel.trim();
    for (const k of CLOUD_STT) {
      const v = p.keys?.[k];
      if (v === undefined) continue;
      if (v === null || !String(v).trim()) delete this.sttKeys[k];
      else this.sttKeys[k] = encrypt(String(v).trim().slice(0, 400));
    }
    stt.configured = { gnani: !!this.sttKeys.gnani, google: !!this.sttKeys.google, gemini: !!this.sttKeys.gemini };
    this.state.stt = stt;
    this.state.aiStatus = undefined; // keys changed: let the AI commentary status re-evaluate
    this.geminiDownUntil = this.gnaniDownUntil = 0;
    this.commit();
    void this.persist();
    return stt;
  }

  private sttKey(p: CloudStt): string | null {
    try {
      return this.sttKeys[p] ? decrypt(this.sttKeys[p]!) : null;
    } catch {
      return null; // secret rotated
    }
  }

  /** Chosen provider first, then any other provider with a key. Throws when every cloud engine fails. */
  async transcribe(wav: Buffer): Promise<{ text: string; provider: CloudStt }> {
    const stt = this.state.stt;
    const order = [stt.provider, ...CLOUD_STT].filter((p, i, a): p is CloudStt => p !== 'browser' && a.indexOf(p) === i);
    const hints = cricketHints(this.latestMatch);
    let lastErr: Error | null = null;
    for (const p of order) {
      const key = this.sttKey(p);
      if (!key) continue;
      try {
        return { text: await transcribeWith(p, { wav, language: stt.language, key, geminiModel: stt.geminiModel, hints }), provider: p };
      } catch (e) {
        lastErr = e as Error;
        console.warn(`[stt] ${p} failed: ${lastErr.message}`);
      }
    }
    throw lastErr ?? new Error('No speech-to-text API key saved');
  }

  /** Check a key (the saved one when `key` is omitted) with half a second of silence. */
  async testStt(p: CloudStt, key?: string): Promise<{ ok: boolean; error?: string; ms: number }> {
    const k = key?.trim() || this.sttKey(p);
    const t0 = Date.now();
    if (!k) return { ok: false, error: 'No API key saved', ms: 0 };
    try {
      await transcribeWith(p, { wav: silentWav(), language: this.state.stt.language, key: k, geminiModel: this.state.stt.geminiModel, hints: [] });
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: (e as Error).message, ms: Date.now() - t0 };
    }
  }

  async persist() {
    const settings = JSON.stringify({ ...Object.fromEntries(PERSISTED.map((k) => [k, this.state[k]])), sttKeys: this.sttKeys });
    await this.repo.updateStudio(this.state.id, { settings, name: this.state.name });
  }

  suggest(s: Suggestion) {
    const host = this.host;
    if (host) this.io.to(host.id).emit('automation:suggestion', s);
  }

  simulate(type: CricketEvent['type']): CricketEvent {
    const last = this.latestMatch?.recentBalls.at(-1);
    const titles: Record<string, [string, string?, number?]> = {
      FOUR: ['FOUR!', last ? `${last.batsman?.name ?? 'Batter'} finds the rope` : 'Cracking shot to the fence'],
      SIX: ['SIX!', last ? `${last.batsman?.name ?? 'Batter'} goes downtown` : 'Into the stands!'],
      WICKET: ['WICKET!', last?.batsman ? `${last.batsman.name} has to go` : 'Big breakthrough', (last?.inningsWickets ?? 0) + 1],
      MILESTONE_BAT: [`FIFTY! ${last?.batsman?.name ?? ''}`.trim(), 'Raises the bat to the dressing room', 50],
      MILESTONE_BOWL: [`FIVE-WICKET HAUL! ${last?.bowler?.name ?? ''}`.trim(), 'A spell to remember', 5],
      PARTNERSHIP: ['50 PARTNERSHIP', [last?.batsman?.name, last?.nonStriker?.name].filter(Boolean).join(' & '), 50],
      HATTRICK_WATCH: ['ON A HAT-TRICK!', `${last?.bowler?.name ?? 'Bowler'} — two in two`],
      OVER_END: [`End of over ${last?.overNumber ?? 1}`, `${last?.overRuns ?? 0} runs`, last?.overNumber ?? 1],
      INNINGS_END: ['Innings Break', 'Time for the experts'],
      MATCH_END: ['Match Over', this.latestMatch?.summary ?? ''],
    };
    const [title, subtitle, value] = titles[type] ?? [type];
    const ev: CricketEvent = {
      type,
      matchKey: this.state.matchKey ?? 'sim',
      ball: last,
      title,
      subtitle,
      value,
      player: last?.batsman?.name,
      ts: Date.now(),
    };
    this.io.to(this.roomName).emit('match:events', [ev]);
    this.automation.applyEvent(ev);
    this.commentator.onEvents([ev]);
    return ev;
  }

  get keepAlive() {
    return this.isLive || this.state.wantLive;
  }

  dispose() {
    this.stopLease();
    this.unsubMatch?.();
    this.automation.dispose();
    this.commentator.dispose();
    clearInterval(this.autoMatchTimer);
    this.pipeline?.stop();
    void this.cloud?.stop();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    void this.persist();
  }
}
