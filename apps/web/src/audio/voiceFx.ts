// Broadcast voice chain for the local microphone (applied before the mic is sent to guests/program).
//
//  mic ─► high-pass ─► noise gate ─► EQ (low · mud · presence · air) ─► de-esser ─► compressor
//      ─► character (radio band-limit) ─► room (dry/wet convolution) ─► output gain ─► limiter ─► out
//                                                                                         └─► "hear yourself"

export type RoomId = 'none' | 'box' | 'studio' | 'stadium';
export type CharacterId = 'clean' | 'radio' | 'warm';

export interface VoiceFx {
  preset: string;
  /** browser DSP (applied at capture, needs the mic to reopen) */
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Chrome's ML voice isolation where supported */
  voiceIsolation: boolean;
  /** 0 = off, else cutoff Hz */
  highpass: number;
  gate: boolean;
  /** gate threshold, dBFS */
  gateThreshold: number;
  /** EQ gains in dB */
  eqLow: number;
  eqMud: number;
  eqPresence: number;
  eqAir: number;
  /** 0..1 */
  deEss: number;
  /** 0..1 amount (maps to threshold/ratio) */
  compress: number;
  character: CharacterId;
  room: RoomId;
  /** 0..1 */
  roomMix: number;
  /** output gain dB */
  gain: number;
  /** hear yourself in headphones */
  monitor: boolean;
}

export const BROWSER_DEFAULTS = { noiseSuppression: true, echoCancellation: true, autoGainControl: false, voiceIsolation: false };

const base: Omit<VoiceFx, 'preset'> = {
  ...BROWSER_DEFAULTS,
  highpass: 80,
  gate: true,
  gateThreshold: -50,
  eqLow: 0,
  eqMud: -2,
  eqPresence: 2,
  eqAir: 1.5,
  deEss: 0.4,
  compress: 0.5,
  character: 'clean',
  room: 'none',
  roomMix: 0,
  gain: 0,
  monitor: false,
};

export interface VoicePreset {
  id: string;
  label: string;
  icon: string;
  hint: string;
  fx: Partial<VoiceFx>;
}

/** Cricket-flavoured presets; everything stays tweakable afterwards ("Custom"). */
export const VOICE_PRESETS: VoicePreset[] = [
  { id: 'broadcast', label: 'Broadcast commentator', icon: 'mic_external_on', hint: 'Clear, punchy TV commentary', fx: {} },
  { id: 'natural', label: 'Natural', icon: 'record_voice_over', hint: 'Light touch, just cleaned up', fx: { gate: false, eqMud: 0, eqPresence: 0, eqAir: 0, deEss: 0.2, compress: 0.2 } },
  { id: 'radio', label: 'Radio commentary', icon: 'radio', hint: 'Classic AM-radio ball-by-ball', fx: { character: 'radio', highpass: 250, eqPresence: 4, eqAir: 0, compress: 0.75, deEss: 0.2 } },
  { id: 'box', label: 'Commentary box', icon: 'stadium', hint: 'Small glass-box room above the ground', fx: { room: 'box', roomMix: 0.18, compress: 0.55 } },
  { id: 'stadium', label: 'Stadium announcer', icon: 'campaign', hint: 'Big PA echo around the ground', fx: { room: 'stadium', roomMix: 0.32, eqLow: 2, eqPresence: 3, compress: 0.7, highpass: 110 } },
  { id: 'ground', label: 'Noisy ground / pitch-side', icon: 'sports_cricket', hint: 'Fights crowd, wind and traffic', fx: { highpass: 150, gate: true, gateThreshold: -40, voiceIsolation: true, eqLow: -3, eqPresence: 4, compress: 0.65 } },
  { id: 'warm', label: 'Warm podcast', icon: 'podcasts', hint: 'Close, rich voice for analysis shows', fx: { character: 'warm', eqLow: 3, eqMud: -1, eqAir: 2, compress: 0.55, highpass: 60 } },
];

export const DEFAULT_VOICE_FX: VoiceFx = { preset: 'broadcast', ...base };

export function presetFx(id: string, keepBrowser?: Partial<VoiceFx>): VoiceFx {
  const p = VOICE_PRESETS.find((x) => x.id === id) ?? VOICE_PRESETS[0];
  return { ...base, ...(keepBrowser ? pickBrowser(keepBrowser) : {}), ...p.fx, preset: p.id };
}

export function normalizeVoiceFx(v: Partial<VoiceFx> | null | undefined): VoiceFx {
  return { ...DEFAULT_VOICE_FX, ...(v ?? {}) };
}

function pickBrowser(v: Partial<VoiceFx>) {
  const o: Partial<VoiceFx> = {};
  for (const k of Object.keys(BROWSER_DEFAULTS) as (keyof typeof BROWSER_DEFAULTS)[]) if (v[k] !== undefined) o[k] = v[k] as boolean;
  return o;
}

export function browserConstraintsChanged(a: VoiceFx, b: VoiceFx) {
  return (Object.keys(BROWSER_DEFAULTS) as (keyof typeof BROWSER_DEFAULTS)[]).some((k) => a[k] !== b[k]);
}

export function voiceIsolationSupported() {
  try {
    return 'voiceIsolation' in (navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>);
  } catch {
    return false;
  }
}

/* ---------------- noise gate worklet ---------------- */

const GATE_SRC = `
class Gate extends AudioWorkletProcessor {
  constructor(){super();this.th=Math.pow(10,-50/20);this.on=true;this.env=0;this.g=1;this.hold=0;
    this.port.onmessage=e=>{if('threshold'in e.data)this.th=Math.pow(10,e.data.threshold/20);if('on'in e.data)this.on=e.data.on;};}
  process(inputs,outputs){
    const i=inputs[0],o=outputs[0];if(!i.length){return true;}
    const n=i[0].length;let s=0;for(let k=0;k<n;k++)s+=i[0][k]*i[0][k];
    const rms=Math.sqrt(s/n);
    this.env=rms>this.env?rms:this.env*0.92;
    const open=!this.on||this.env>this.th;
    if(open)this.hold=Math.round(0.18*sampleRate/n);else if(this.hold>0)this.hold--;
    const target=(open||this.hold>0)?1:0.03;           // -30 dB floor sounds natural, not chopped
    const coef=target>this.g?1/(0.003*sampleRate):1/(0.12*sampleRate);  // 3 ms attack, 120 ms release
    for(let c=0;c<o.length;c++){const ic=i[c]||i[0],oc=o[c];let g=this.g;
      for(let k=0;k<n;k++){g+=(target-g)*coef;oc[k]=ic[k]*g;}if(c===o.length-1)this.g=g;}
    return true;
  }
}
registerProcessor('cricstudio-gate',Gate);`;

const gateLoaded = new WeakMap<BaseAudioContext, Promise<void>>();
function loadGate(ctx: AudioContext) {
  let p = gateLoaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([GATE_SRC], { type: 'text/javascript' }));
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    gateLoaded.set(ctx, p);
  }
  return p;
}

/* ---------------- impulse responses ---------------- */

/** Synthetic room impulse: exponentially decaying stereo noise with early reflections. */
function impulse(ctx: BaseAudioContext, room: RoomId): AudioBuffer {
  const spec = { none: [0.05, 8, []], box: [0.45, 5, [0.006, 0.011, 0.017]], studio: [0.9, 4, [0.013, 0.021]], stadium: [3.2, 2.2, [0.12, 0.26, 0.41]] } as const;
  const [len, decay, taps] = spec[room];
  const n = Math.round(ctx.sampleRate * len);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (room === 'stadium' ? 0.6 : 0.9);
    // discrete echoes (stadium PA slap-back, box reflections)
    for (const t of taps) {
      const at = Math.round(t * ctx.sampleRate) + ch * 37;
      if (at < n) d[at] += room === 'stadium' ? 0.55 : 0.35;
    }
  }
  return buf;
}

function shaperCurve(amount: number) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = amount ? Math.tanh(x * (1 + amount * 4)) / Math.tanh(1 + amount * 4) : x;
  }
  return c;
}

const db = (v: number) => Math.pow(10, v / 20);

/* ---------------- processor ---------------- */

export class VoiceProcessor {
  readonly ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  readonly track: MediaStreamTrack;
  readonly analyser: AnalyserNode;
  private src: MediaStreamAudioSourceNode;
  private dest: MediaStreamAudioDestinationNode;
  private hp = this.ctx.createBiquadFilter();
  private gateNode: AudioWorkletNode | null = null;
  private gateIn = this.ctx.createGain();
  private gateOut = this.ctx.createGain();
  private low = this.ctx.createBiquadFilter();
  private mud = this.ctx.createBiquadFilter();
  private presence = this.ctx.createBiquadFilter();
  private air = this.ctx.createBiquadFilter();
  private essLow = this.ctx.createBiquadFilter();
  private essHigh = this.ctx.createBiquadFilter();
  private essComp = this.ctx.createDynamicsCompressor();
  private essSum = this.ctx.createGain();
  private comp = this.ctx.createDynamicsCompressor();
  private makeup = this.ctx.createGain();
  private bandLo = this.ctx.createBiquadFilter();
  private bandHi = this.ctx.createBiquadFilter();
  private shaper = this.ctx.createWaveShaper();
  private dry = this.ctx.createGain();
  private wet = this.ctx.createGain();
  private verb = this.ctx.createConvolver();
  private out = this.ctx.createGain();
  private limiter = this.ctx.createDynamicsCompressor();
  private monitorGain = this.ctx.createGain();
  private room: RoomId | null = null;

  constructor(
    input: MediaStreamTrack,
    private fx: VoiceFx,
  ) {
    const c = this.ctx;
    this.src = c.createMediaStreamSource(new MediaStream([input]));
    this.dest = c.createMediaStreamDestination();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;
    this.hp.type = 'highpass';
    this.hp.Q.value = 0.7;
    this.low.type = 'lowshelf';
    this.low.frequency.value = 120;
    this.mud.type = 'peaking';
    this.mud.frequency.value = 350;
    this.mud.Q.value = 1.1;
    this.presence.type = 'peaking';
    this.presence.frequency.value = 3200;
    this.presence.Q.value = 0.9;
    this.air.type = 'highshelf';
    this.air.frequency.value = 10000;
    // de-esser: split at 5.5 kHz and squash only the top band
    this.essLow.type = 'lowpass';
    this.essLow.frequency.value = 5500;
    this.essHigh.type = 'highpass';
    this.essHigh.frequency.value = 5500;
    this.essComp.knee.value = 6;
    this.essComp.attack.value = 0.002;
    this.essComp.release.value = 0.06;
    this.comp.knee.value = 8;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.18;
    this.bandLo.type = 'highpass';
    this.bandHi.type = 'lowpass';
    this.shaper.oversample = '2x';
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;

    this.src.connect(this.hp).connect(this.gateIn);
    this.gateIn.connect(this.gateOut); // bypass until the worklet loads
    this.gateOut.connect(this.low).connect(this.mud).connect(this.presence).connect(this.air);
    this.air.connect(this.essLow).connect(this.essSum);
    this.air.connect(this.essHigh).connect(this.essComp).connect(this.essSum);
    this.essSum.connect(this.comp).connect(this.makeup).connect(this.bandLo).connect(this.bandHi).connect(this.shaper);
    this.shaper.connect(this.dry).connect(this.out);
    this.shaper.connect(this.verb).connect(this.wet).connect(this.out);
    this.out.connect(this.limiter);
    this.limiter.connect(this.dest);
    this.limiter.connect(this.analyser);
    this.limiter.connect(this.monitorGain).connect(c.destination);
    this.track = this.dest.stream.getAudioTracks()[0];
    this.apply(fx, true);
    void loadGate(c)
      .then(() => {
        const g = new AudioWorkletNode(c, 'cricstudio-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.gateIn.disconnect();
        this.gateIn.connect(g).connect(this.gateOut);
        this.gateNode = g;
        this.apply(this.fx, true);
      })
      .catch(() => undefined);
    void c.resume().catch(() => undefined);
    // browsers only start an AudioContext after a gesture; retry on the next click/key
    const kick = () => void c.resume().catch(() => undefined);
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
  }

  get settings() {
    return this.fx;
  }

  /** Update every stage smoothly (no clicks). */
  apply(fx: VoiceFx, immediate = false) {
    this.fx = fx;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => (immediate ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.04));
    set(this.hp.frequency, fx.highpass > 0 ? fx.highpass : 10);
    this.gateNode?.port.postMessage({ on: fx.gate, threshold: fx.gateThreshold });
    set(this.low.gain, fx.eqLow);
    set(this.mud.gain, fx.eqMud);
    set(this.presence.gain, fx.eqPresence);
    set(this.air.gain, fx.eqAir);
    // de-ess: 0 → transparent, 1 → −24 dB threshold 10:1 on sibilance
    set(this.essComp.threshold, -6 - fx.deEss * 30);
    set(this.essComp.ratio, 1 + fx.deEss * 11);
    // compressor amount → threshold/ratio, with automatic makeup gain
    set(this.comp.threshold, -8 - fx.compress * 22);
    set(this.comp.ratio, 1.5 + fx.compress * 4.5);
    set(this.makeup.gain, db(fx.compress * 7));
    // character
    const radio = fx.character === 'radio';
    set(this.bandLo.frequency, radio ? 320 : 10);
    set(this.bandHi.frequency, radio ? 3400 : 22000);
    this.shaper.curve = shaperCurve(radio ? 0.5 : fx.character === 'warm' ? 0.18 : 0);
    // room
    if (fx.room !== this.room) {
      this.room = fx.room;
      this.verb.buffer = impulse(this.ctx, fx.room === 'none' ? 'none' : fx.room);
    }
    const mix = fx.room === 'none' ? 0 : fx.roomMix;
    set(this.dry.gain, 1 - mix * 0.5);
    set(this.wet.gain, mix * 1.4);
    set(this.out.gain, db(fx.gain));
    set(this.monitorGain.gain, fx.monitor ? 1 : 0);
  }

  stop() {
    this.track.stop();
    void this.ctx.close().catch(() => undefined);
  }
}
