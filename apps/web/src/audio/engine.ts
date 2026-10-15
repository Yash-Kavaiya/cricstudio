import type { MusicState, SfxId } from '@cricstudio/shared';
import { CrowdAmbience } from './ambience';
import { GenerativeMusic, TRACKS } from './music';
import { playSfx } from './sfx';
import { apiUrl } from '../lib/api';

export interface AudioEngineOptions {
  /** produce a MediaStream with the full program mix (host compositor / program page) */
  program: boolean;
  /** play voices to speakers (program page for egress) */
  monitorVoices: boolean;
  /** local monitor level for music + sfx */
  monitorLevel: number;
}

/**
 * Program audio mixer:
 *   voices ─┬─────────────────────────────► program
 *           └─ analyser (ducking)
 *   music ──► duck ─┬──────────────────────► program
 *                   └─ monitor ──► speakers
 *   sfx  ───────────┴──────────────────────►
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly programDest: MediaStreamAudioDestinationNode | null;
  private voiceBus: GainNode;
  private musicBus: GainNode;
  private duck: GainNode;
  private sfxBus: GainNode;
  private commentBus: GainNode;
  private speaking = 0;
  private monitor: GainNode;
  private analyser: AnalyserNode;
  private voices = new Map<string, { src: MediaStreamAudioSourceNode; gain: GainNode; stream: MediaStream }>();
  private music: GenerativeMusic | null = null;
  private ambience: CrowdAmbience | null = null;
  private ambienceBus: GainNode;
  private fileMusic: { el: HTMLAudioElement; node: MediaElementAudioSourceNode; url: string } | null = null;
  private duckTimer: number;
  private duckEnabled = true;
  sfxVolume = 0.8;

  constructor(private readonly opts: AudioEngineOptions) {
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.programDest = opts.program ? this.ctx.createMediaStreamDestination() : null;
    this.voiceBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.duck = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.commentBus = this.ctx.createGain();
    this.commentBus.gain.value = 1.15;
    this.ambienceBus = this.ctx.createGain();
    this.monitor = this.ctx.createGain();
    this.monitor.gain.value = opts.monitorLevel;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;

    // bus glue compressor → brick-wall-ish limiter keeps the stream under 0 dBFS
    const glue = this.ctx.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.25;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    const trim = this.ctx.createGain();
    trim.gain.value = 0.85;
    glue.connect(limiter).connect(trim);

    this.voiceBus.connect(this.analyser);
    this.musicBus.connect(this.duck);
    if (this.programDest) {
      this.voiceBus.connect(glue);
      this.duck.connect(glue);
      this.sfxBus.connect(glue);
      this.commentBus.connect(glue);
      this.ambienceBus.connect(glue);
      trim.connect(this.programDest);
    }
    this.duck.connect(this.monitor);
    this.sfxBus.connect(this.monitor);
    this.commentBus.connect(this.monitor);
    this.ambienceBus.connect(this.monitor);
    // commentary drives the music ducker just like a live mic
    this.commentBus.connect(this.analyser);
    this.monitor.connect(this.ctx.destination);
    if (opts.monitorVoices) this.voiceBus.connect(this.ctx.destination);

    const buf = new Float32Array(this.analyser.fftSize);
    this.duckTimer = window.setInterval(() => {
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const speaking = (this.duckEnabled && rms > 0.02) || this.speaking > 0;
      this.duck.gain.setTargetAtTime(speaking ? 0.28 : 1, this.ctx.currentTime, speaking ? 0.08 : 0.6);
    }, 100);
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
  }

  get programStream(): MediaStream | null {
    return this.programDest?.stream ?? null;
  }

  /** Add/replace a participant's voice in the program mix. */
  setVoice(id: string, stream: MediaStream | null, gain = 1) {
    const ex = this.voices.get(id);
    const track = stream?.getAudioTracks()[0];
    if (ex && (!stream || ex.stream !== stream || !track)) {
      ex.src.disconnect();
      ex.gain.disconnect();
      this.voices.delete(id);
    }
    if (!stream || !track) return;
    const cur = this.voices.get(id);
    if (cur) {
      cur.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
      return;
    }
    const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.voiceBus);
    this.voices.set(id, { src, gain: g, stream });
  }

  removeMissingVoices(keep: Set<string>) {
    for (const id of [...this.voices.keys()]) if (!keep.has(id)) this.setVoice(id, null);
  }

  sfx(id: SfxId, volume = this.sfxVolume) {
    void this.resume();
    playSfx(this.ctx, this.sfxBus, id, volume);
  }

  /** Play AI-commentator speech (MP3/WAV bytes) into the program mix. Resolves when finished. */
  async speak(bytes: ArrayBuffer): Promise<void> {
    await this.resume();
    const buf = await this.ctx.decodeAudioData(bytes);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.commentBus);
    this.speaking++;
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      src.start();
      // safety in case onended never fires (tab suspended etc.)
      setTimeout(resolve, buf.duration * 1000 + 1500);
    });
    this.speaking = Math.max(0, this.speaking - 1);
    src.disconnect();
  }

  setMonitorLevel(v: number) {
    this.monitor.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Reconcile music with shared studio state. */
  applyMusic(m: MusicState) {
    this.duckEnabled = m.duck;
    this.applyAmbience(m.ambience);
    this.musicBus.gain.setTargetAtTime(m.volume, this.ctx.currentTime, 0.1);
    const want = m.playing ? m.track : null;
    const isFile = !!want && (want.startsWith('/') || want.startsWith('http'));
    // stop what shouldn't play
    if (this.music && (!want || isFile || this.music.id !== want)) {
      this.music.stop();
      this.music = null;
    }
    if (this.fileMusic && (!want || !isFile || this.fileMusic.url !== want)) {
      this.fileMusic.el.pause();
      this.fileMusic.node.disconnect();
      this.fileMusic = null;
    }
    if (!want) return;
    void this.resume();
    if (isFile && !this.fileMusic) {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.src = apiUrl(want);
      el.loop = true;
      const node = this.ctx.createMediaElementSource(el);
      node.connect(this.musicBus);
      void el.play().catch(() => undefined);
      this.fileMusic = { el, node, url: want };
    } else if (!isFile && !this.music) {
      const def = TRACKS.find((t) => t.id === want) ?? TRACKS[0];
      this.music = new GenerativeMusic(this.ctx, this.musicBus, def);
      this.music.start();
    }
  }

  /** Crowd bed sits under voices, never ducked hard (like a real stadium mic). */
  private applyAmbience(a: MusicState['ambience']) {
    if (!a?.on && !this.ambience) return;
    if (!this.ambience) this.ambience = new CrowdAmbience(this.ctx, this.ambienceBus);
    void this.resume();
    this.ambience.set(!!a?.on, a?.volume ?? 0.3, a?.mood ?? 'buzzing');
  }

  close() {
    window.clearInterval(this.duckTimer);
    this.ambience?.stop();
    this.music?.stop(0.1);
    this.fileMusic?.el.pause();
    void this.ctx.close();
  }
}
