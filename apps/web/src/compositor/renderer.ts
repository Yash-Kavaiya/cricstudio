import type { CaptionLine, MatchDetail, MatchListItem, SceneId, StudioState, TransitionId } from '@cricstudio/shared';
import { H, W, clamp, type RenderCtx, type VideoSource } from './draw';
import { Celebration3D } from './fx3d';
import { brandBug, captions, eventOverlay, scorebug, ticker } from './overlays';
import { NO_TICKER_SCENES, SCENE_DRAW, SCOREBUG_SCENES } from './scenes';
import { CAMERA_SCENES, camBubbles } from './camBubbles';
import { TRANSITION_MS, drawTransition } from './transitions';

const MAX_IMAGES = 160;

/** Timer that keeps ticking in background tabs (workers aren't throttled like rAF). */
export function workerTicker(fps: number, cb: () => void) {
  const src = `let t=setInterval(()=>postMessage(0),${Math.round(1000 / fps)});onmessage=e=>{if(e.data==='stop'){clearInterval(t);close()}}`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  w.onmessage = cb;
  return () => {
    w.postMessage('stop');
    URL.revokeObjectURL(url);
  };
}

function offscreen() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

/**
 * Renders the program (studio state + match data + cameras) onto a 1920x1080 canvas at 30fps.
 * The same renderer powers the host preview, guest preview, the streamed output and /program.
 */
export class ProgramRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frameA = offscreen();
  private frameB = offscreen();
  private state: StudioState | null = null;
  private match: MatchDetail | null = null;
  private matches: MatchListItem[] = [];
  private caption: CaptionLine | null = null;
  readonly videos = new Map<string, VideoSource>();
  private bubblesSince: number | null = null;
  private images = new Map<string, HTMLImageElement | 'loading' | 'error'>();
  private scene: SceneId | null = null;
  private sceneStart = 0;
  private prevScene: SceneId | null = null;
  private prevStart = 0;
  private transition: TransitionId = 'fadeZoom';
  private stop: (() => void) | null = null;
  private lastOverlaySeq = -1;
  private fx3d: Celebration3D | null = null;
  private frames = 0;
  private fpsWindow = performance.now();
  fps = 0;
  onSceneChange?: (scene: SceneId) => void;
  onOverlay?: (o: NonNullable<StudioState['overlay']>) => void;

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    try {
      if (Celebration3D.supported()) this.fx3d = new Celebration3D();
    } catch (e) {
      console.warn('[renderer] 3D celebrations unavailable', e);
    }
  }

  start(fps = 30) {
    if (this.stop) return;
    this.stop = workerTicker(fps, () => this.frame());
  }

  dispose() {
    this.stop?.();
    this.stop = null;
    this.fx3d?.dispose();
    this.fx3d = null;
    this.images.clear();
    this.videos.clear();
  }

  setState(s: StudioState) {
    this.state = s;
    if (s.scene !== this.scene) {
      const now = performance.now();
      if (this.scene) {
        this.prevScene = this.scene;
        this.prevStart = this.sceneStart;
      }
      this.scene = s.scene;
      this.sceneStart = now;
      this.transition = s.transition ?? 'fadeZoom';
      this.onSceneChange?.(s.scene);
    }
    if (s.overlay && s.overlay.seq !== this.lastOverlaySeq) {
      this.lastOverlaySeq = s.overlay.seq;
      // only react to overlays that are actually fresh (not on initial join)
      if (Date.now() - s.overlay.startedAt < 1500) this.onOverlay?.(s.overlay);
    }
  }

  setMatch(m: MatchDetail | null) {
    this.match = m;
  }

  setMatches(list: MatchListItem[]) {
    this.matches = list;
  }

  setCaption(c: CaptionLine | null) {
    this.caption = c;
  }

  private img = (url?: string): HTMLImageElement | null => {
    if (!url) return null;
    const c = this.images.get(url);
    if (c instanceof HTMLImageElement) return c;
    if (c) return null;
    if (this.images.size >= MAX_IMAGES) {
      // bounded cache for 24/7 runs: drop the oldest entry
      const first = this.images.keys().next().value;
      if (first) this.images.delete(first);
    }
    this.images.set(url, 'loading');
    const im = new Image();
    im.crossOrigin = 'anonymous'; // ESPN CDN sends ACAO:* — keeps canvas untainted for captureStream
    im.onload = () => this.images.set(url, im);
    im.onerror = () => this.images.set(url, 'error');
    im.src = url;
    return null;
  };

  private rc(ctx: CanvasRenderingContext2D, scene: SceneId, age: number): RenderCtx {
    const s = this.state!;
    const stage = s.participants
      .filter((p) => p.onStage && p.role !== 'program')
      .sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : a.joinedAt - b.joinedAt));
    return {
      ctx,
      now: performance.now(),
      age,
      state: { ...s, scene },
      match: this.match,
      matches: this.matches,
      stage,
      videos: this.videos,
      caption: this.caption,
      img: this.img,
      accent: s.brand.accent || '#1a73e8',
      fx3d: this.fx3d,
    };
  }

  private drawScene(ctx: CanvasRenderingContext2D, scene: SceneId, age: number) {
    ctx.save();
    (SCENE_DRAW[scene] ?? SCENE_DRAW.scoreHero)(this.rc(ctx, scene, age));
    ctx.restore();
  }

  frame() {
    const ctx = this.ctx;
    const s = this.state;
    this.frames++;
    const t0 = performance.now();
    if (t0 - this.fpsWindow > 2000) {
      this.fps = Math.round((this.frames * 1000) / (t0 - this.fpsWindow));
      this.frames = 0;
      this.fpsWindow = t0;
    }
    if (!s || !this.scene) {
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const now = performance.now();
    const age = now - this.sceneStart;
    const dur = TRANSITION_MS[this.transition] ?? 750;
    const t = clamp(age / dur);
    try {
      if (this.prevScene && t < 1) {
        const a = this.frameA.getContext('2d')!;
        const b = this.frameB.getContext('2d')!;
        this.drawScene(a, this.prevScene, now - this.prevStart);
        this.drawScene(b, this.scene, age);
        drawTransition(ctx, this.transition, this.frameA, this.frameB, t, s.brand.accent || '#1a73e8');
      } else {
        this.prevScene = null;
        this.drawScene(ctx, this.scene, age);
      }
      const rc = this.rc(ctx, this.scene, age);
      if (s.brand.showScorebug && SCOREBUG_SCENES.includes(this.scene)) scorebug(rc, clamp((age - 300) / 500));
      const tickerOn = s.brand.showTicker && !NO_TICKER_SCENES.includes(this.scene);
      if (tickerOn) ticker(rc, clamp((age - 200) / 500));
      // bubbles persist across data scenes; they only roll in when they first appear
      const bubblesOn = !!s.brand.camBubbles && !CAMERA_SCENES.includes(this.scene) && rc.stage.length > 0;
      if (!bubblesOn) this.bubblesSince = null;
      else if (this.bubblesSince === null) this.bubblesSince = now;
      if (this.bubblesSince !== null) camBubbles(rc, clamp((now - this.bubblesSince - 250) / 700), tickerOn);
      brandBug(rc);
      captions(rc);
      eventOverlay(rc);
    } catch (e) {
      // never let a bad data shape kill the stream
      console.error('[renderer]', e);
    }
  }
}
