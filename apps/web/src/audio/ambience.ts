// Stadium crowd ambience bed — synthesised, original and royalty-free.
// A continuous murmur with slow swells, plus random claps, "ooh"s and distant horns/drums
// whose density depends on the mood.
import type { AmbienceMood } from '@cricstudio/shared';

function pinkNoise(ctx: BaseAudioContext, seconds = 4): AudioBuffer {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  }
  return buf;
}

const MOODS: Record<AmbienceMood, { level: number; claps: number; oohs: number; horns: number; brightness: number }> = {
  calm: { level: 0.55, claps: 0.08, oohs: 0.02, horns: 0, brightness: 900 },
  buzzing: { level: 0.8, claps: 0.25, oohs: 0.05, horns: 0.03, brightness: 1300 },
  packed: { level: 1, claps: 0.5, oohs: 0.09, horns: 0.08, brightness: 1800 },
};

export class CrowdAmbience {
  private out: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private bed: GainNode;
  private filter: BiquadFilterNode;
  private timer: number | null = null;
  private noise: AudioBuffer;
  mood: AmbienceMood = 'buzzing';

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.noise = pinkNoise(ctx);
    // murmur bed: band-limited noise, slow random swells
    this.bed = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.Q.value = 0.6;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain).connect(this.bed.gain);
    n.connect(this.filter).connect(this.bed).connect(this.out);
    n.start();
    lfo.start();
    this.sources.push(n, lfo);
  }

  /** volume 0..1; 0 fades out and stops the random events */
  set(on: boolean, volume: number, mood: AmbienceMood) {
    this.mood = mood;
    const m = MOODS[mood];
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(on ? volume : 0, t, 0.8);
    this.bed.gain.setTargetAtTime(0.5 * m.level, t, 0.8);
    this.filter.frequency.setTargetAtTime(m.brightness, t, 0.8);
    if (on && this.timer === null) this.timer = window.setInterval(() => this.tick(), 500);
    if (!on && this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const m = MOODS[this.mood];
    const t = this.ctx.currentTime + Math.random() * 0.4;
    if (Math.random() < m.claps) this.claps(t, 0.6 + Math.random() * 1.6);
    if (Math.random() < m.oohs) this.ooh(t);
    if (Math.random() < m.horns) (Math.random() < 0.5 ? this.horn(t) : this.drums(t));
  }

  private noiseBurst(t: number, dur: number, freq: number, q: number, peak: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random() * 3, dur + 0.05);
  }

  /** a patch of scattered clapping */
  private claps(t: number, dur: number) {
    const count = Math.round(dur * (8 + Math.random() * 10));
    for (let i = 0; i < count; i++) this.noiseBurst(t + Math.random() * dur, 0.05, 1400 + Math.random() * 1600, 1.5, 0.08 + Math.random() * 0.12);
  }

  /** collective "ooooh" — rising then falling filtered swell */
  private ooh(t: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(380, t);
    f.frequency.linearRampToValueAtTime(620, t + 0.7);
    f.frequency.linearRampToValueAtTime(420, t + 2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random() * 2, 2.4);
  }

  /** distant fan horn (vuvuzela-ish two-tone) */
  private horn(t: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 233 + Math.random() * 30;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.08);
    g.gain.setValueAtTime(0.035, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 1);
  }

  /** dhol-style drum pattern from the stands */
  private drums(t: number) {
    const pattern = [0, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.375, 1.5];
    for (const p of pattern) {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(120, t + p);
      o.frequency.exponentialRampToValueAtTime(60, t + p + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + p);
      g.gain.exponentialRampToValueAtTime(0.12, t + p + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p + 0.18);
      o.connect(g).connect(this.out);
      o.start(t + p);
      o.stop(t + p + 0.2);
    }
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    for (const s of this.sources) s.stop();
    this.out.disconnect();
  }
}
