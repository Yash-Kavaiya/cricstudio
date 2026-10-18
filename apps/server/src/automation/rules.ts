import {
  SCENES,
  countdownTarget,
  TRANSITIONS,
  type ActiveOverlay,
  type CricketEvent,
  type MatchDetail,
  type OverlayId,
  type SceneId,
  type SfxId,
  type StudioState,
  type Suggestion,
  type TransitionId,
} from '@cricstudio/shared';

export interface AutomationHost {
  state(): StudioState;
  commit(): void;
  suggest(s: Suggestion): void;
  match?(): MatchDetail | null;
}

interface OverlayPlan {
  overlay: OverlayId;
  sfx: SfxId;
  ms: number;
  priority: number;
  /** temporary scene shown after/with the overlay */
  then?: { scene: SceneId; ms: number };
  /** persistent scene change (becomes the new base scene) */
  base?: SceneId;
}

/** Scenes where automation must never cut away (host is presenting something deliberate). */
const PROTECTED: SceneId[] = ['startingSoon', 'screenShare', 'result', 'message'];
const MUSIC_ROTATION = ['stadium-anthem', 'powerplay-pulse', 'chill-pitch', 'victory-lap', 'tea-break'];
const MUSIC_TRACK_MS = 4 * 60_000;

export function pickTransition(st: StudioState, avoid?: TransitionId): TransitionId {
  const chosen = st.brand.transition;
  if (chosen !== 'mixed' && !st.autopilot.enabled) return chosen;
  const pool = TRANSITIONS.map((t) => t.id).filter((t) => t !== avoid);
  return pool[Math.floor(Math.random() * pool.length)];
}

export class AutomationEngine {
  private queue: { plan: OverlayPlan; ev: CricketEvent; cut: boolean }[] = [];
  private overlaySeq = 0;
  private lastSceneChange = Date.now();
  private playlist: SceneId[] = [];
  private scoreQueue: SceneId[] = [];
  private camQueue: SceneId[] = [];
  private otherPicks = 0;
  private scorePicks = 0;
  private totalPicks = 0;
  private musicIdx = 0;
  private lastMusicChange = 0;
  private timer: NodeJS.Timeout;

  constructor(private readonly host: AutomationHost) {
    this.timer = setInterval(() => this.tick(), 500);
    this.timer.unref?.();
  }

  dispose() {
    clearInterval(this.timer);
  }

  noteManualScene() {
    this.lastSceneChange = Date.now();
  }

  /** every scene change goes through here so all renderers use the same transition */
  cut(scene: SceneId, opts: { temporaryMs?: number; base?: boolean } = {}) {
    const st = this.host.state();
    if (st.scene !== scene) st.transition = pickTransition(st, st.transition);
    st.scene = scene;
    if (opts.base) {
      st.baseScene = scene;
      st.sceneUntil = null;
    } else if (opts.temporaryMs) st.sceneUntil = Date.now() + opts.temporaryMs;
    this.lastSceneChange = Date.now();
  }

  plan(ev: CricketEvent): OverlayPlan | null {
    const r = this.host.state().rules;
    switch (ev.type) {
      case 'FOUR':
        return r.boundary ? { overlay: 'four', sfx: 'boundaryHorn', ms: 5000, priority: 2 } : null;
      case 'SIX':
        return r.boundary ? { overlay: 'six', sfx: 'sixFanfare', ms: 5500, priority: 3 } : null;
      case 'WICKET':
        return r.wicket
          ? { overlay: 'wicket', sfx: 'wicketSting', ms: 6000, priority: 5, then: { scene: 'battingCard', ms: 11000 } }
          : null;
      case 'MILESTONE_BAT':
        return r.milestones
          ? { overlay: 'milestone', sfx: 'milestone', ms: 7000, priority: 4, then: { scene: 'starPerformer', ms: 9000 } }
          : null;
      case 'MILESTONE_BOWL':
        return r.milestones
          ? { overlay: 'fiveWickets', sfx: 'milestone', ms: 7000, priority: 4, then: { scene: 'bowlerSpotlight', ms: 9000 } }
          : null;
      case 'PARTNERSHIP':
        return r.milestones ? { overlay: 'partnership', sfx: 'applause', ms: 5000, priority: 2, then: { scene: 'batters', ms: 8000 } } : null;
      case 'HATTRICK_WATCH':
        return r.wicket ? { overlay: 'hattrick', sfx: 'drumroll', ms: 6000, priority: 4 } : null;
      case 'OVER_END':
        return r.overEnd
          ? {
              overlay: 'overSummary',
              sfx: 'overChime',
              ms: 7000,
              priority: 1,
              then: (ev.value ?? 0) % 5 === 0 ? { scene: 'manhattan', ms: 10000 } : { scene: 'ballByBall', ms: 8000 },
            }
          : null;
      case 'INNINGS_END':
        return r.inningsBreak ? { overlay: 'inningsEnd', sfx: 'applause', ms: 6000, priority: 5, base: 'break' } : null;
      case 'MATCH_END':
        return r.inningsBreak ? { overlay: 'matchEnd', sfx: 'crowdRoar', ms: 8000, priority: 6, base: 'result' } : null;
      default:
        return null;
    }
  }

  onEvents(events: CricketEvent[]) {
    const st = this.host.state();
    const mode = st.autopilot.enabled ? 'auto' : st.automation;
    if (mode === 'manual') return;
    for (const ev of events) {
      const plan = this.plan(ev);
      if (!plan) continue;
      // pre-show countdown stays clean; only match-level events break through
      if ((st.scene === 'startingSoon' || st.scene === 'message') && plan.priority < 5) continue;
      if (mode === 'assist') {
        this.host.suggest({
          id: `${ev.type}-${ev.ts}-${Math.random().toString(36).slice(2, 6)}`,
          overlay: plan.overlay,
          scene: plan.base ?? plan.then?.scene,
          reason: `${ev.title}${ev.subtitle ? ` — ${ev.subtitle}` : ''}`,
          event: ev,
        });
        continue;
      }
      // only Auto Live switches scenes by itself; otherwise the host's scene stays and the overlay plays over it
      this.enqueue(plan, ev, st.autopilot.enabled);
    }
    this.tick();
  }

  /** Apply a suggestion the host accepted (assist mode) or a dev-simulated event. */
  applyEvent(ev: CricketEvent) {
    const plan = this.plan(ev);
    if (plan) this.enqueue(plan, ev, true);
    this.tick();
  }

  private enqueue(plan: OverlayPlan, ev: CricketEvent, cut: boolean) {
    // keep highest priority first, cap backlog so we stay "live"
    this.queue.push({ plan, ev, cut });
    this.queue.sort((a, b) => b.plan.priority - a.plan.priority);
    if (this.queue.length > 3) this.queue.length = 3;
  }

  showOverlay(o: Omit<ActiveOverlay, 'seq' | 'startedAt' | 'until'> & { ms: number }) {
    const st = this.host.state();
    const now = Date.now();
    st.overlay = { id: o.id, title: o.title, subtitle: o.subtitle, value: o.value, sfx: o.sfx, startedAt: now, until: now + o.ms, seq: ++this.overlaySeq };
    this.host.commit();
  }

  /** Scenes the autopilot can rotate through right now. */
  private autopilotPlaylist(st: StudioState): SceneId[] {
    const hasMatch = !!st.matchKey;
    const onStage = st.participants.some((p) => p.onStage && p.role !== 'program');
    const ok = SCENES.filter((s) => {
      if (!s.autopilot) return false;
      if (s.usesCameras) return st.autopilot.includeCameras && onStage;
      if (!hasMatch) return s.id === 'aroundGrounds' || s.id === 'upcomingMatches' || s.id === 'fanPoll';
      return true;
    }).map((s) => s.id);
    const m = this.host.match?.();
    return ok.filter((id) => {
      if (!m) return true;
      if (id === 'winPredictor' || id === 'projectedScore') return m.state === 'in';
      if (id === 'matchup' || id === 'batters' || id === 'wagonWheel') return m.currentBatters.length > 0;
      if (id === 'bowlerSpotlight') return !!m.currentBowler;
      if (id === 'chaseCalculator') return m.state === 'in' && (!!m.need || m.innings.some((i) => i.isCurrent && i.target > i.runs));
      if (id === 'inningsComparison') return m.innings.filter((i) => i.overSummaries.length).length >= 2;
      if (id === 'momentum' || id === 'overHeatmap' || id === 'runRateGraph') return m.innings.some((i) => i.overSummaries.length >= 3);
      if (id === 'matchReport') return m.state === 'post' || m.innings.length >= 2;
      return true;
    });
  }

  /**
   * Weighted rotation: Score scenes (live score, ball-by-ball, batting, bowling) get `scoreShare`
   * of the cuts (default 70%), everything else shares the rest. The split is kept exact over time
   * (deficit counting, not dice rolls); each pool is shuffled and cycled so nothing repeats back-to-back.
   */
  private nextAutopilotScene(st: StudioState): SceneId | null {
    const pool = this.autopilotPlaylist(st);
    if (!pool.length) return null;
    const isScore = (id: SceneId) => SCENES.find((x) => x.id === id)?.group === 'Score';
    const score = pool.filter(isScore);
    const other = pool.filter((id) => !isScore(id));
    const isCam = (id: SceneId) => !!SCENES.find((x) => x.id === id)?.usesCameras;
    const cams = other.filter(isCam);
    const rest = other.filter((id) => !isCam(id));
    const share = Math.max(0, Math.min(1, st.autopilot.scoreShare ?? 0.7));
    const pickScore = !!score.length && (!other.length || this.scorePicks < share * (this.totalPicks + 1));
    this.totalPicks++;
    if (pickScore) {
      this.scorePicks++;
      return this.take(this.scoreQueue, score, st.scene);
    }
    // people on stage: alternate camera shots with stats/insights inside the "other" share
    const camTurn = cams.length > 0 && (!rest.length || this.otherPicks++ % 2 === 0);
    return camTurn ? this.take(this.camQueue, cams, st.scene) : this.take(this.playlist, rest, st.scene);
  }

  /** shift the next scene off a shuffled queue (refilled from `src`), skipping the scene already on air */
  private take(queue: SceneId[], src: SceneId[], current: SceneId): SceneId {
    for (let i = queue.length - 1; i >= 0; i--) if (!src.includes(queue[i])) queue.splice(i, 1);
    if (!queue.length) queue.push(...[...src].sort(() => Math.random() - 0.5));
    let next = queue.shift()!;
    if (next === current && src.some((s) => s !== current)) {
      if (!queue.length) queue.push(...[...src].sort(() => Math.random() - 0.5));
      const alt = queue.findIndex((s) => s !== current);
      queue.push(next);
      next = alt >= 0 ? queue.splice(alt, 1)[0] : next;
    }
    return next;
  }

  private manageMusic(st: StudioState, now: number) {
    if (!st.autopilot.enabled || !st.autopilot.autoMusic) return false;
    let dirty = false;
    const wantTrack =
      st.scene === 'result' ? 'victory-lap' : st.scene === 'break' ? 'tea-break' : null;
    if (!st.music.playing) {
      st.music = { ...st.music, playing: true, track: wantTrack ?? MUSIC_ROTATION[this.musicIdx % MUSIC_ROTATION.length], volume: Math.min(st.music.volume, 0.4) || 0.3, duck: true };
      this.lastMusicChange = now;
      dirty = true;
    } else if (wantTrack && st.music.track !== wantTrack) {
      st.music = { ...st.music, track: wantTrack };
      this.lastMusicChange = now;
      dirty = true;
    } else if (!wantTrack && now - this.lastMusicChange > MUSIC_TRACK_MS && !st.music.track?.startsWith('/')) {
      this.musicIdx++;
      st.music = { ...st.music, track: MUSIC_ROTATION[this.musicIdx % MUSIC_ROTATION.length] };
      this.lastMusicChange = now;
      dirty = true;
    }
    return dirty;
  }

  private tick() {
    const st = this.host.state();
    const now = Date.now();
    let dirty = false;

    // expire overlay
    const curPriority = st.overlay && st.overlay.until > now ? st.overlay.priority ?? 0 : -1;
    if (st.overlay && st.overlay.until <= now) {
      st.overlay = null;
      dirty = true;
    }

    // next queued overlay (preempts lower priority)
    const next = this.queue[0];
    if (next && (!st.overlay || next.plan.priority > curPriority)) {
      this.queue.shift();
      const { plan, ev, cut } = next;
      st.overlay = {
        id: plan.overlay,
        title: ev.title,
        subtitle: ev.subtitle,
        value: ev.value,
        sfx: plan.sfx,
        startedAt: now,
        until: now + plan.ms,
        seq: ++this.overlaySeq,
        priority: plan.priority,
      };
      dirty = true;
      const pinned = st.pinnedUntil > now && !st.autopilot.enabled;
      if (!cut) {
        // Auto Live is off: keep the host's scene
      } else if (plan.base && !(st.scene === 'screenShare' && pinned)) {
        this.cut(plan.base, { base: true });
      } else if (plan.then && !pinned && !PROTECTED.includes(st.scene) && st.scene !== 'break') {
        this.cut(plan.then.scene, { temporaryMs: plan.ms + plan.then.ms });
      }
    }

    // revert temporary scene
    if (st.sceneUntil && st.sceneUntil <= now) {
      st.sceneUntil = null;
      // Auto Live was switched off mid-cut: stay on what's on air instead of cutting again
      if (!st.autopilot.enabled) st.baseScene = st.scene;
      else this.lastSceneChange = 0; // autopilot picks the next scene right away
      dirty = true;
    }

    if (st.autopilot.enabled) {
      // autopilot: rotate every N seconds; break/result hold longer while they make sense
      const hold = st.scene === 'result' || st.scene === 'break' ? Math.max(30, st.autopilot.sceneSeconds * 2) : st.autopilot.sceneSeconds;
      const busy = !!st.sceneUntil || (st.overlay && (st.overlay.priority ?? 0) >= 4);
      if (!busy && now - this.lastSceneChange > hold * 1000) {
        const m = this.host.match?.();
        // a typed announcement (rain delay ...) and a running pre-show countdown stay on air until the host moves on
        const cd = countdownTarget(st, m);
        if (st.scene === 'message' || (st.scene === 'startingSoon' && cd && cd.at > now)) {
          this.lastSceneChange = now;
          if (this.manageMusic(st, now)) dirty = true;
          if (dirty) this.host.commit();
          return;
        }
        const stay = (st.scene === 'result' && m?.state === 'post') || (st.scene === 'break' && m?.innings.some((i) => i.description === 'complete') && m.innings.length < 2);
        const scene = stay && now - this.lastSceneChange < 90_000 ? null : this.nextAutopilotScene(st);
        if (scene) {
          this.cut(scene, { base: true });
          dirty = true;
        } else this.lastSceneChange = now;
      }
      if (this.manageMusic(st, now)) dirty = true;
    }

    if (dirty) this.host.commit();
  }

  /** reset the autopilot playlist (e.g. participants or match changed) */
  refreshPlaylist() {
    this.playlist = [];
    this.scoreQueue = [];
    this.camQueue = [];
  }
}
