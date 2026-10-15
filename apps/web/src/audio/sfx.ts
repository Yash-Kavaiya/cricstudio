// Cricket sound effects synthesised with WebAudio — 100% original, royalty-free, zero assets.
import type { SfxId } from '@cricstudio/shared';

let noiseCache: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) return noiseCache;
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // pinkish noise (Paul Kellet filter) – warmer crowd texture than white noise
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
  noiseCache = buf;
  return buf;
}

function noiseSrc(ctx: BaseAudioContext, loop = true) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  s.loop = loop;
  return s;
}

function env(g: GainNode, t: number, peak: number, attack: number, hold: number, release: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.setValueAtTime(Math.max(peak, 0.0002), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
}

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

type Out = AudioNode;

function batCrack(ctx: BaseAudioContext, out: Out, t: number, v = 1) {
  // wood "tock"
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(1150, t);
  o.frequency.exponentialRampToValueAtTime(520, t + 0.05);
  const og = ctx.createGain();
  env(og, t, 0.9 * v, 0.001, 0.005, 0.07);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.15);
  // crack transient
  const n = noiseSrc(ctx, false);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400;
  bp.Q.value = 1.2;
  const ng = ctx.createGain();
  env(ng, t, 1.6 * v, 0.0008, 0.004, 0.05);
  n.connect(bp).connect(ng).connect(out);
  n.start(t, Math.random() * 2);
  n.stop(t + 0.1);
  // body thump
  const th = ctx.createOscillator();
  th.frequency.setValueAtTime(160, t);
  th.frequency.exponentialRampToValueAtTime(70, t + 0.1);
  const tg = ctx.createGain();
  env(tg, t, 0.5 * v, 0.002, 0.01, 0.12);
  th.connect(tg).connect(out);
  th.start(t);
  th.stop(t + 0.2);
}

function crowd(ctx: BaseAudioContext, out: Out, t: number, dur = 3.5, v = 1, excitement = 1) {
  const n = noiseSrc(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  const bp = ctx.createBiquadFilter();
  bp.type = 'peaking';
  bp.frequency.value = 650;
  bp.gain.value = 9;
  bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55 * v * excitement, t + 0.35);
  g.gain.exponentialRampToValueAtTime(0.75 * v * excitement, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  // "voices" — slow random amplitude wobble
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.18 * v;
  lfo.connect(lfoG).connect(g.gain);
  n.connect(lp).connect(bp).connect(g).connect(out);
  // whistles / high cheers
  const n2 = noiseSrc(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 2600;
  hp.Q.value = 3;
  const g2 = ctx.createGain();
  env(g2, t + 0.15, 0.18 * v * excitement, 0.3, dur * 0.3, dur * 0.5);
  n2.connect(hp).connect(g2).connect(out);
  const off = Math.random() * 2;
  n.start(t, off);
  n2.start(t, (off + 1) % 2.5);
  lfo.start(t);
  n.stop(t + dur + 0.1);
  n2.stop(t + dur + 0.1);
  lfo.stop(t + dur + 0.1);
}

function applause(ctx: BaseAudioContext, out: Out, t: number, dur = 3, v = 1) {
  const claps = Math.floor(dur * 55);
  for (let i = 0; i < claps; i++) {
    const p = i / claps;
    const at = t + p * dur + Math.random() * 0.05;
    const dens = Math.sin(Math.PI * Math.min(1, p * 1.3)) ** 0.6;
    const s = noiseSrc(ctx, false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 2200;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    env(g, at, (0.25 + Math.random() * 0.35) * v * dens, 0.001, 0.003, 0.03 + Math.random() * 0.03);
    s.connect(bp).connect(g).connect(out);
    s.start(at, Math.random() * 2.5);
    s.stop(at + 0.09);
  }
  crowd(ctx, out, t, dur, 0.35 * v, 0.8);
}

function brassChord(ctx: BaseAudioContext, out: Out, t: number, notes: number[], dur: number, v = 1) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(800, t);
  lp.frequency.linearRampToValueAtTime(2600, t + 0.12);
  lp.frequency.linearRampToValueAtTime(1600, t + dur);
  const g = ctx.createGain();
  env(g, t, 0.16 * v, 0.03, dur * 0.6, dur * 0.4);
  lp.connect(g).connect(out);
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.2;
  const vibG = ctx.createGain();
  vibG.gain.value = 3;
  vib.connect(vibG);
  vib.start(t);
  vib.stop(t + dur + 0.1);
  for (const n of notes) {
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n);
      o.detune.value = det;
      vibG.connect(o.frequency);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }
}

function stumps(ctx: BaseAudioContext, out: Out, t: number, v = 1) {
  [0, 0.045, 0.11].forEach((dt, i) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = [760, 980, 640][i];
    const g = ctx.createGain();
    env(g, t + dt, 0.7 * v, 0.001, 0.004, 0.09);
    o.connect(g).connect(out);
    o.start(t + dt);
    o.stop(t + dt + 0.15);
  });
  const n = noiseSrc(ctx, false);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3200;
  const g = ctx.createGain();
  env(g, t, 0.8 * v, 0.001, 0.02, 0.18);
  n.connect(bp).connect(g).connect(out);
  n.start(t);
  n.stop(t + 0.3);
}

function boom(ctx: BaseAudioContext, out: Out, t: number, v = 1) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(34, t + 0.9);
  const g = ctx.createGain();
  env(g, t, 1.1 * v, 0.005, 0.1, 0.9);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 1.2);
}

function pad(ctx: BaseAudioContext, out: Out, t: number, notes: number[], dur: number, v = 1, type: OscillatorType = 'sine') {
  const g = ctx.createGain();
  env(g, t, 0.12 * v, 0.25, dur * 0.4, dur * 0.6);
  g.connect(out);
  for (const n of notes) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(n);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.2);
  }
}

function whoosh(ctx: BaseAudioContext, out: Out, t: number, v = 1) {
  const n = noiseSrc(ctx, false);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(4200, t + 0.32);
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.28);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
  n.connect(bp).connect(g).connect(out);
  n.start(t, Math.random() * 2);
  n.stop(t + 0.7);
}

function bell(ctx: BaseAudioContext, out: Out, t: number, f: number, v = 1) {
  [1, 2.01, 3.03, 4.2].forEach((h, i) => {
    const o = ctx.createOscillator();
    o.frequency.value = f * h;
    const g = ctx.createGain();
    env(g, t, (0.22 / (i + 1)) * v, 0.002, 0.01, 1.4 / (i * 0.4 + 1));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.6);
  });
}

function drumroll(ctx: BaseAudioContext, out: Out, t: number, v = 1) {
  let at = t;
  let gap = 0.09;
  while (at < t + 1.7) {
    const s = noiseSrc(ctx, false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    const g = ctx.createGain();
    env(g, at, (0.25 + ((at - t) / 1.7) * 0.5) * v, 0.001, 0.005, 0.06);
    s.connect(bp).connect(g).connect(out);
    s.start(at, Math.random() * 2);
    s.stop(at + 0.1);
    at += gap;
    gap = Math.max(0.035, gap * 0.94);
  }
  // cymbal
  const c = noiseSrc(ctx, false);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  const cg = ctx.createGain();
  env(cg, t + 1.7, 0.5 * v, 0.002, 0.05, 1.3);
  c.connect(hp).connect(cg).connect(out);
  c.start(t + 1.7);
  c.stop(t + 3.2);
  boom(ctx, out, t + 1.7, 0.6 * v);
}

export const SFX_LABELS: Record<SfxId, string> = {
  batCrack: 'Bat crack',
  crowdRoar: 'Crowd roar',
  boundaryHorn: 'Boundary horn',
  sixFanfare: 'Six fanfare',
  stumps: 'Stumps rattle',
  wicketSting: 'Wicket sting',
  whoosh: 'Transition whoosh',
  overChime: 'Over chime',
  applause: 'Applause',
  milestone: 'Milestone fanfare',
  drumroll: 'Drumroll',
};

export function playSfx(ctx: BaseAudioContext, out: AudioNode, id: SfxId, volume = 1) {
  const t = ctx.currentTime + 0.02;
  const v = volume;
  switch (id) {
    case 'batCrack':
      return batCrack(ctx, out, t, v);
    case 'crowdRoar':
      return crowd(ctx, out, t, 4, v, 1.2);
    case 'applause':
      return applause(ctx, out, t, 3.2, v);
    case 'boundaryHorn':
      batCrack(ctx, out, t, v);
      brassChord(ctx, out, t + 0.12, [57, 61, 64, 69], 0.5, v);
      brassChord(ctx, out, t + 0.66, [57, 61, 64, 69], 0.9, v);
      return crowd(ctx, out, t + 0.05, 3.4, v, 1);
    case 'sixFanfare':
      batCrack(ctx, out, t, v * 1.1);
      [60, 64, 67, 72].forEach((n, i) => brassChord(ctx, out, t + 0.14 + i * 0.12, [n, n + 12], 0.16, v));
      brassChord(ctx, out, t + 0.62, [60, 64, 67, 72], 1.3, v);
      return crowd(ctx, out, t + 0.05, 4.5, v, 1.35);
    case 'stumps':
      return stumps(ctx, out, t, v);
    case 'wicketSting':
      stumps(ctx, out, t, v);
      boom(ctx, out, t + 0.05, v);
      pad(ctx, out, t + 0.1, [45, 52, 57, 60], 2.2, v * 1.5, 'triangle');
      return crowd(ctx, out, t + 0.15, 4, v, 1.3);
    case 'whoosh':
      return whoosh(ctx, out, t, v);
    case 'overChime':
      bell(ctx, out, t, 880, v);
      return bell(ctx, out, t + 0.22, 660, v);
    case 'milestone':
      [60, 64, 67].forEach((n, i) => brassChord(ctx, out, t + i * 0.15, [n, n + 12], 0.2, v));
      brassChord(ctx, out, t + 0.48, [60, 64, 67, 72, 76], 1.6, v);
      return applause(ctx, out, t + 0.3, 4, v);
    case 'drumroll':
      return drumroll(ctx, out, t, v);
  }
}
