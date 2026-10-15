import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { workerTicker } from '../compositor/renderer';
import { virtualBackground } from './virtualBackgrounds';

/* ---------------- settings ---------------- */

export type VideoMode = 'none' | 'blur' | 'image' | 'chroma';

export interface ChromaSettings {
  /** key colour, #rrggbb */
  color: string;
  /** how close to the key colour gets removed (0.01–0.4) */
  similarity: number;
  /** edge softness (0.01–0.3) */
  smoothness: number;
  /** green/blue spill suppression on edges (0.01–0.5) */
  spill: number;
}

export interface VideoFx {
  mode: VideoMode;
  /** blur radius in px (at 720p) */
  blur: number;
  /** virtual background id (built-in or 'custom') for 'image' and 'chroma' */
  bg: string;
  chroma: ChromaSettings;
  /** colour correction, 1 = unchanged */
  brightness: number;
  contrast: number;
  saturation: number;
}

export const DEFAULT_VIDEO_FX: VideoFx = {
  mode: 'none',
  blur: 14,
  bg: 'stadium',
  chroma: { color: '#00b140', similarity: 0.14, smoothness: 0.08, spill: 0.12 },
  brightness: 1,
  contrast: 1,
  saturation: 1,
};

export const VIDEO_MODES: { id: VideoMode; label: string; icon: string }[] = [
  { id: 'none', label: 'Off', icon: 'block' },
  { id: 'blur', label: 'Blur', icon: 'blur_on' },
  { id: 'image', label: 'Background', icon: 'wallpaper' },
  { id: 'chroma', label: 'Green screen', icon: 'filter_center_focus' },
];

export const KEY_COLORS = [
  { label: 'Chroma green', color: '#00b140' },
  { label: 'Chroma blue', color: '#0047bb' },
];

export function normalizeVideoFx(v: Partial<VideoFx> | null | undefined): VideoFx {
  return { ...DEFAULT_VIDEO_FX, ...(v ?? {}), chroma: { ...DEFAULT_VIDEO_FX.chroma, ...(v?.chroma ?? {}) } };
}

const adjusted = (fx: VideoFx) => fx.brightness !== 1 || fx.contrast !== 1 || fx.saturation !== 1;

/** True when the camera must go through the processor (otherwise the raw track is sent untouched). */
export function needsProcessing(fx: VideoFx) {
  return fx.mode !== 'none' || adjusted(fx);
}

/* ---------------- person segmentation (MediaPipe) ---------------- */

// segmentation runs on a small frame; the mask is upscaled + feathered, so edges stay soft
const SEG_W = 256;
const SEG_H = 144;

let segmenter: Promise<ImageSegmenter> | null = null;
let lastTs = 0;

/** One shared MediaPipe selfie segmenter per page (model + wasm are self-hosted). */
function loadSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(new URL('/mediapipe', location.origin).href);
    const make = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    try {
      return await make('GPU');
    } catch {
      return await make('CPU');
    }
  })();
  segmenter.catch(() => (segmenter = null)); // allow a retry later
  return segmenter;
}

/* ---------------- chroma key (WebGL) ---------------- */

const VERT = `attribute vec2 p;varying vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.,1.);}`;
// YCbCr-distance keyer with smoothness + spill desaturation (same idea as broadcast/OBS keyers)
const FRAG = `precision mediump float;
uniform sampler2D tex;uniform vec3 key;uniform float sim,smooth_,spill;varying vec2 uv;
vec2 cbcr(vec3 c){return vec2(c.r*-0.1687+c.g*-0.3313+c.b*0.5+0.5,c.r*0.5+c.g*-0.4187+c.b*-0.0813+0.5);}
void main(){
  vec4 c=texture2D(tex,uv);
  float d=distance(cbcr(c.rgb),cbcr(key))-sim;
  float a=pow(clamp(d/smooth_,0.,1.),1.5);
  float s=pow(clamp(d/spill,0.,1.),1.5);
  float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722));
  gl_FragColor=vec4(mix(vec3(l),c.rgb,s)*a,a);
}`;

class ChromaKeyer {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    for (const n of ['key', 'sim', 'smooth_', 'spill']) this.u[n] = gl.getUniformLocation(prog, n);
  }

  /** key `src` (already colour-corrected) into this canvas: transparent where the screen was */
  render(src: TexImageSource, c: ChromaSettings) {
    const gl = this.gl;
    const n = parseInt(c.color.slice(1), 16);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.uniform3f(this.u.key, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    gl.uniform1f(this.u.sim, c.similarity);
    gl.uniform1f(this.u.smooth_, Math.max(0.001, c.smoothness));
    gl.uniform1f(this.u.spill, Math.max(0.001, c.spill));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/* ---------------- processor ---------------- */

/**
 * Camera track → processed canvas track: colour correction, background blur, virtual
 * background (AI person cut-out) or green-screen chroma key over a background.
 * Until the AI model is ready (or if it fails) frames pass through, so the camera never goes black.
 */
export class VideoProcessor {
  readonly track: MediaStreamTrack;
  status: 'loading' | 'ready' | 'error' = 'ready';
  onStatus?: () => void;
  private video = document.createElement('video');
  private out = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private small = document.createElement('canvas');
  private sctx: CanvasRenderingContext2D;
  private mask = document.createElement('canvas');
  private mctx: CanvasRenderingContext2D;
  private person = document.createElement('canvas');
  private pctx: CanvasRenderingContext2D;
  private graded = document.createElement('canvas');
  private gctx: CanvasRenderingContext2D;
  private maskData = new ImageData(SEG_W, SEG_H);
  private seg: ImageSegmenter | null = null;
  private keyer: ChromaKeyer | null = null;
  private stopTicker: () => void;
  private stopped = false;

  constructor(
    src: MediaStream,
    private fx: VideoFx,
  ) {
    const s = src.getVideoTracks()[0]?.getSettings() ?? {};
    const w = s.width ?? 1280;
    const h = s.height ?? 720;
    for (const c of [this.out, this.person, this.graded]) {
      c.width = w;
      c.height = h;
    }
    this.small.width = this.mask.width = SEG_W;
    this.small.height = this.mask.height = SEG_H;
    this.ctx = this.out.getContext('2d')!;
    this.pctx = this.person.getContext('2d')!;
    this.gctx = this.graded.getContext('2d')!;
    this.sctx = this.small.getContext('2d', { willReadFrequently: true })!;
    this.mctx = this.mask.getContext('2d')!;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream(src.getVideoTracks());
    void this.video.play().catch(() => undefined);
    this.track = this.out.captureStream(30).getVideoTracks()[0];
    this.stopTicker = workerTicker(30, () => this.frame());
    this.prepare();
  }

  get settings() {
    return this.fx;
  }

  setFx(fx: VideoFx) {
    this.fx = fx;
    this.prepare();
  }

  private prepare() {
    const m = this.fx.mode;
    if ((m === 'blur' || m === 'image') && !this.seg) {
      this.setStatus('loading');
      loadSegmenter().then(
        (seg) => {
          this.seg = seg;
          this.setStatus('ready');
        },
        () => this.setStatus('error'),
      );
    } else if (m === 'chroma' && !this.keyer) {
      try {
        this.keyer = new ChromaKeyer(this.out.width, this.out.height);
        this.setStatus('ready');
      } catch {
        this.setStatus('error');
      }
    } else if (m === 'none' || (m === 'chroma' && this.keyer) || this.seg) this.setStatus('ready');
  }

  private setStatus(s: VideoProcessor['status']) {
    if (this.stopped || this.status === s) return;
    this.status = s;
    this.onStatus?.();
  }

  /** Average colour of the frame border — a good guess for the green/blue screen colour. */
  sampleKeyColor(): string | null {
    const v = this.video;
    if (v.readyState < 2) return null;
    this.sctx.drawImage(v, 0, 0, SEG_W, SEG_H);
    const d = this.sctx.getImageData(0, 0, SEG_W, SEG_H).data;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let y = 0; y < SEG_H; y++)
      for (let x = 0; x < SEG_W; x++) {
        const edge = x < 24 || x >= SEG_W - 24 || y < 14;
        if (!edge) continue;
        const i = (y * SEG_W + x) * 4;
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
    if (!n) return null;
    const hex = (c: number) => Math.round(c / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  /** camera frame with colour correction applied */
  private resize(w: number, h: number) {
    for (const c of [this.out, this.person, this.graded]) {
      c.width = w;
      c.height = h;
    }
    if (this.keyer) {
      this.keyer.canvas.width = w;
      this.keyer.canvas.height = h;
    }
  }

  private gradedFrame(): CanvasImageSource {
    const fx = this.fx;
    if (!adjusted(fx)) return this.video;
    const { width: w, height: h } = this.graded;
    this.gctx.filter = `brightness(${fx.brightness}) contrast(${fx.contrast}) saturate(${fx.saturation})`;
    this.gctx.drawImage(this.video, 0, 0, w, h);
    this.gctx.filter = 'none';
    return this.graded;
  }

  private drawBackground(w: number, h: number) {
    const bg = virtualBackground(this.fx.bg);
    if (bg) {
      // cover-fit so a 16:9 background never stretches onto a 4:3 / portrait camera
      const bw = bg.width,
        bh = bg.height,
        k = Math.max(w / bw, h / bh);
      this.ctx.drawImage(bg, (w - bw * k) / 2, (h - bh * k) / 2, bw * k, bh * k);
    } else {
      this.ctx.fillStyle = '#0b1020';
      this.ctx.fillRect(0, 0, w, h);
    }
  }

  private personMask(): boolean {
    if (!this.seg) return false;
    this.sctx.drawImage(this.video, 0, 0, SEG_W, SEG_H);
    let conf: Float32Array | null = null;
    try {
      lastTs = Math.max(lastTs + 1, performance.now());
      const r = this.seg.segmentForVideo(this.small, lastTs);
      conf = r.confidenceMasks?.[0]?.getAsFloat32Array() ?? null;
      r.close();
    } catch {
      conf = null;
    }
    if (!conf) return false;
    const px = this.maskData.data;
    for (let i = 0; i < conf.length; i++) {
      // soft threshold keeps hair/shoulders instead of a hard cut-out
      const a = Math.min(1, Math.max(0, (conf[i] - 0.25) / 0.5));
      px[i * 4 + 3] = a * 255;
    }
    this.mctx.putImageData(this.maskData, 0, 0);
    return true;
  }

  private frame() {
    const v = this.video;
    if (this.stopped || v.readyState < 2 || !v.videoWidth) return;
    // follow the camera's real frame size (4:3 webcams, rotated phones, resolution changes)
    if (v.videoWidth !== this.out.width || v.videoHeight !== this.out.height) this.resize(v.videoWidth, v.videoHeight);
    const { width: w, height: h } = this.out;
    const ctx = this.ctx;
    const fx = this.fx;
    const cam = this.gradedFrame();

    if (fx.mode === 'chroma' && this.keyer) {
      this.keyer.render(cam as TexImageSource, fx.chroma);
      this.drawBackground(w, h);
      ctx.drawImage(this.keyer.canvas, 0, 0, w, h);
      return;
    }
    if ((fx.mode === 'blur' || fx.mode === 'image') && this.personMask()) {
      // sharp person layer = upscaled feathered mask ∩ camera
      const p = this.pctx;
      p.globalCompositeOperation = 'copy';
      p.filter = 'blur(3px)';
      p.drawImage(this.mask, 0, 0, w, h);
      p.filter = 'none';
      p.globalCompositeOperation = 'source-in';
      p.drawImage(cam, 0, 0, w, h);
      p.globalCompositeOperation = 'source-over';
      if (fx.mode === 'blur') {
        // drawn oversize so the blur doesn't fade at the frame edge
        const pad = fx.blur * 2;
        ctx.filter = `blur(${fx.blur}px)`;
        ctx.drawImage(cam, -pad, -pad, w + pad * 2, h + pad * 2);
        ctx.filter = 'none';
      } else this.drawBackground(w, h);
      ctx.drawImage(this.person, 0, 0);
      return;
    }
    ctx.drawImage(cam, 0, 0, w, h);
  }

  stop() {
    this.stopped = true;
    this.stopTicker();
    this.track.stop();
    this.keyer?.dispose();
    this.video.pause();
    this.video.srcObject = null;
  }
}
