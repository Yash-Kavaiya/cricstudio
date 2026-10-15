// Generative background music — composed in code at runtime, so it is original and royalty-free.

export interface TrackDef {
  id: string;
  title: string;
  mood: string;
  bpm: number;
  swing: number; // 0..0.3
  chords: number[][]; // one chord per bar (MIDI notes)
  bass: (number | null)[]; // 16 steps: semitone offset from chord root, null = rest
  kick: string; // 16-char pattern, x = hit
  snare: string;
  hat: string;
  arp?: (number | null)[]; // index into chord tones (+3 = octave up of first)
  lead: OscillatorType;
  padType: OscillatorType;
  lofi?: boolean;
  bright: number; // filter cutoff for pads
}

const C = (root: number, q: 'maj' | 'min' | 'maj7' | 'min7' | 'dom7' | 'sus') =>
  ({
    maj: [0, 4, 7],
    min: [0, 3, 7],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dom7: [0, 4, 7, 10],
    sus: [0, 5, 7],
  })[q].map((i) => root + i);

export const TRACKS: TrackDef[] = [
  {
    id: 'stadium-anthem',
    title: 'Stadium Anthem',
    mood: 'Big, uplifting · 124 BPM',
    bpm: 124,
    swing: 0,
    chords: [C(62, 'maj'), C(57, 'maj'), C(59, 'min'), C(55, 'maj')],
    bass: [0, null, 0, null, 0, null, 0, 12, 0, null, 0, null, 0, null, 7, null],
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 2, 3],
    lead: 'square',
    padType: 'sawtooth',
    bright: 2200,
  },
  {
    id: 'powerplay-pulse',
    title: 'Powerplay Pulse',
    mood: 'Driving, electronic · 138 BPM',
    bpm: 138,
    swing: 0,
    chords: [C(57, 'min'), C(53, 'maj'), C(60, 'maj'), C(55, 'maj')],
    bass: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 7, 12, 7],
    kick: 'x...x...x...x...',
    snare: '....x.......x..x',
    hat: 'xxxxxxxxxxxxxxxx',
    arp: [0, 2, 3, 2, 1, 2, 3, 2, 0, 2, 3, 2, 1, 3, 2, 3],
    lead: 'sawtooth',
    padType: 'sawtooth',
    bright: 1800,
  },
  {
    id: 'chill-pitch',
    title: 'Chill Pitch',
    mood: 'Relaxed, warm · 96 BPM',
    bpm: 96,
    swing: 0.08,
    chords: [C(53, 'maj7'), C(50, 'min7'), C(55, 'min7'), C(48, 'dom7')],
    bass: [0, null, null, null, null, null, 7, null, 0, null, null, null, 5, null, null, null],
    kick: 'x.........x.....',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    arp: [0, null, 2, null, 1, null, 3, null, 0, null, 2, null, 3, null, 1, null],
    lead: 'triangle',
    padType: 'triangle',
    bright: 1400,
  },
  {
    id: 'tea-break',
    title: 'Tea Break Lo-fi',
    mood: 'Lo-fi, mellow · 78 BPM',
    bpm: 78,
    swing: 0.2,
    chords: [C(50, 'min7'), C(55, 'dom7'), C(48, 'maj7'), C(57, 'min7')],
    bass: [0, null, null, null, null, null, null, 7, 0, null, null, null, null, null, 5, null],
    kick: 'x......x..x.....',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    arp: [3, null, null, 2, null, null, 1, null, 3, null, null, 2, null, 0, null, null],
    lead: 'sine',
    padType: 'triangle',
    lofi: true,
    bright: 900,
  },
  {
    id: 'drs-tension',
    title: 'DRS Tension',
    mood: 'Suspense · 100 BPM',
    bpm: 100,
    swing: 0,
    chords: [C(45, 'min'), C(45, 'sus'), C(46, 'maj'), C(44, 'maj')],
    bass: [0, null, null, 0, null, null, 0, null, 0, null, null, 0, null, null, 0, 1],
    kick: 'x..x..x.x..x..x.',
    snare: '............x...',
    hat: '....x.......x...',
    arp: [0, null, 0, null, 2, null, 0, null, 1, null, 0, null, 2, null, 3, null],
    lead: 'square',
    padType: 'sawtooth',
    bright: 900,
  },
  {
    id: 'victory-lap',
    title: 'Victory Lap',
    mood: 'Triumphant · 132 BPM',
    bpm: 132,
    swing: 0,
    chords: [C(60, 'maj'), C(65, 'maj'), C(57, 'min'), C(55, 'maj')],
    bass: [0, null, 0, 0, null, 0, 0, null, 0, null, 0, 0, null, 7, 12, null],
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...xx',
    arp: [0, 1, 2, 3, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1],
    lead: 'sawtooth',
    padType: 'sawtooth',
    bright: 2600,
  },
];

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

export class GenerativeMusic {
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private out: GainNode;
  private crackle: AudioBufferSourceNode | null = null;
  private noise: AudioBuffer;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    private track: TrackDef,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.out.connect(dest);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get id() {
    return this.track.id;
  }

  start() {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
    if (this.track.lofi) this.startCrackle();
    // setInterval keeps running in background tabs (throttled to 1s at worst; lookahead covers it)
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop(fade = 0.8) {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0.0001, t, fade / 4);
    const c = this.crackle;
    this.crackle = null;
    setTimeout(() => {
      c?.stop();
      this.out.disconnect();
    }, fade * 1000 + 200);
  }

  private startCrackle() {
    const s = this.ctx.createBufferSource();
    const len = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.6 : (Math.random() * 2 - 1) * 0.004;
    s.buffer = b;
    s.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.25;
    s.connect(g).connect(this.out);
    s.start();
    this.crackle = s;
  }

  private schedule() {
    const lookahead = 1.2; // seconds — survives background-tab timer throttling
    const spb = 60 / this.track.bpm / 4; // seconds per 16th
    while (this.nextTime < this.ctx.currentTime + lookahead) {
      const s = this.step % 16;
      const swing = s % 2 === 1 ? this.track.swing * spb : 0;
      this.playStep(this.step, this.nextTime + swing, spb);
      this.nextTime += spb;
      this.step++;
    }
  }

  private playStep(step: number, t: number, spb: number) {
    const tr = this.track;
    const s = step % 16;
    const bar = Math.floor(step / 16) % tr.chords.length;
    const chord = tr.chords[bar];
    const phrase = Math.floor(step / 64); // every 4 bars
    const intro = phrase === 0 && bar < 1; // first bar: pads + hats only

    if (s === 0) this.pad(chord, t, spb * 16);
    if (!intro && tr.kick[s] === 'x') this.kick(t);
    if (!intro && tr.snare[s] === 'x') this.snare(t);
    if (tr.hat[s] === 'x') this.hat(t, s % 4 === 2 ? 0.09 : 0.05);
    const b = tr.bass[s];
    if (!intro && b !== null && b !== undefined) this.bass(mtof(chord[0] - 24 + b), t, spb * 1.6);
    const a = tr.arp?.[s];
    // arp only plays on alternating phrases to give the track some shape
    if (a !== null && a !== undefined && phrase % 2 === 1) {
      const note = a >= chord.length ? chord[a % chord.length] + 12 : chord[a];
      this.pluck(mtof(note + 12), t, spb * 1.8);
    }
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.32);
  }

  private snare(t: number) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = this.track.lofi ? 1400 : 1900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(this.track.lofi ? 0.25 : 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(bp).connect(g).connect(this.out);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.18);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 185;
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.25, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(og).connect(this.out);
    o.start(t);
    o.stop(t + 0.1);
  }

  private hat(t: number, v: number) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(this.track.lofi ? v * 0.6 : v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    n.connect(hp).connect(g).connect(this.out);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.06);
  }

  private bass(f: number, t: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = this.track.lofi ? 'sine' : 'sawtooth';
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(this.track.lofi ? 400 : 900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(chord: number[], t: number, dur: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.track.bright;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.25);
    g.gain.linearRampToValueAtTime(0.04, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.02);
    lp.connect(g).connect(this.out);
    for (const n of chord) {
      for (const det of [-8, 7]) {
        const o = this.ctx.createOscillator();
        o.type = this.track.padType;
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur * 1.05);
      }
    }
  }

  private pluck(f: number, t: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = this.track.lead;
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
