import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { DestinationStatus, LiveStatus, Platform } from '@cricstudio/shared';
import { config } from '../config';

export interface StreamTarget {
  id: string;
  platform: Platform;
  name: string;
  url: string;
  key: string;
}

export function rtmpUrl(t: Pick<StreamTarget, 'url' | 'key'>): string {
  if (!t.key) return t.url;
  return t.url.endsWith('/') ? `${t.url}${t.key}` : `${t.url}/${t.key}`;
}

/**
 * Encoder: browser WebM → H.264/AAC MPEG-TS on stdout. Timestamps continue across restarts.
 * When the browser already sends H.264 (Chrome MediaRecorder), video is passed through untouched
 * (`copy`) — only audio is converted to AAC. That removes ~90% of server CPU for 24/7 shows.
 */
export function encoderArgs(tsOffsetSec: number, opts = config, videoCopy = false): string[] {
  const v = opts.videoBitrateKbps;
  const head = [
    '-hide_banner',
    '-loglevel', 'info',
    '-fflags', '+genpts+discardcorrupt',
    '-thread_queue_size', '1024',
    '-i', 'pipe:0',
    '-map', '0:v:0',
    '-map', '0:a:0?',
  ];
  const tail = [
    '-c:a', 'aac',
    '-b:a', `${opts.audioBitrateKbps}k`,
    '-ar', '44100',
    '-ac', '2',
    '-output_ts_offset', tsOffsetSec.toFixed(3),
    '-f', 'mpegts',
    '-mpegts_flags', '+resend_headers',
    'pipe:1',
  ];
  if (videoCopy) return [...head, '-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb', ...tail];
  return [
    ...head,
    '-c:v', 'libx264',
    '-preset', opts.x264Preset,
    '-tune', 'zerolatency',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-x264-params', 'repeat-headers=1',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
    '-r', '30',
    '-fps_mode', 'cfr',
    '-g', '60',
    '-keyint_min', '60',
    '-sc_threshold', '0',
    '-b:v', `${v}k`,
    '-maxrate', `${v}k`,
    '-bufsize', `${v * 2}k`,
    ...tail,
  ];
}

/** Relay: copy the TS feed to one RTMP ingest. Can (re)join mid-stream at the next keyframe. */
export function relayArgs(url: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'info',
    '-fflags', '+genpts+discardcorrupt',
    '-f', 'mpegts',
    '-i', 'pipe:0',
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    '-avoid_negative_ts', 'make_zero',
    '-flvflags', 'no_duration_filesize',
    '-rtmp_live', 'live',
    '-f', 'flv',
    url,
  ];
}

const PROGRESS_RE = /frame=\s*(\d+)\s+fps=\s*([\d.]+)/;
const SPEED_RE = /speed=\s*([\d.]+)x/;
const MAX_RELAY_BACKLOG = 12 * 1024 * 1024; // bytes queued for a slow/stuck ingest before we recycle it
const MAX_ENCODER_BACKLOG = 24 * 1024 * 1024;

interface Relay {
  target: StreamTarget;
  status: DestinationStatus;
  proc: ChildProcessWithoutNullStreams | null;
  backoff: number;
  liveSince: number;
  timer: NodeJS.Timeout | null;
  tail: string[];
}

/**
 * 24/7-safe live pipeline:
 *
 *   producer (browser/cloud worker) ──WebM──► encoder ──TS──┬─► relay ► YouTube
 *                                                             ├─► relay ► Facebook
 *                                                             ├─► relay ► X
 *                                                             └─► relay ► Twitch
 *
 * - The encoder can restart (producer reconnect, crash) without dropping any RTMP connection.
 * - Each relay reconnects independently with exponential backoff; one bad platform never affects others.
 * - All buffers are bounded so a stuck ingest cannot grow memory without limit.
 */
export class LivePipeline extends EventEmitter {
  private encoder: ChildProcessWithoutNullStreams | null = null;
  private relays: Relay[];
  private stopped = true;
  private startedAt = 0;
  private lastIngest = 0;
  private lastOutput = 0;
  private watchdog: NodeJS.Timeout | null = null;
  private encTail: string[] = [];
  private encoderRestarts = 0;
  private encBytes = 0;
  /** producer sends H.264 → pass video through */
  private videoCopy = false;
  /** a fresh encoder only accepts a stream that starts with a WebM header (sent after `resetIngest`) */
  private awaitingHeader = true;
  readonly status: LiveStatus;
  bytesIn = 0;

  constructor(
    readonly studioId: string,
    targets: StreamTarget[],
    private readonly broadcaster: 'host' | 'cloud' = 'host',
  ) {
    super();
    this.relays = targets.map((t) => ({
      target: t,
      status: { id: t.id, platform: t.platform, name: t.name, state: 'idle', retries: 0 },
      proc: null,
      backoff: 1000,
      liveSince: 0,
      timer: null,
      tail: [],
    }));
    this.status = { state: 'idle', mode: 'mesh', broadcaster, reconnects: 0, destinations: this.relays.map((r) => r.status) };
  }

  get running() {
    return !this.stopped;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.startedAt = Date.now();
    this.lastIngest = Date.now();
    this.status.state = 'starting';
    this.status.startedAt = undefined;
    this.status.error = undefined;
    for (const r of this.relays) this.spawnRelay(r);
    this.spawnEncoder();
    this.watchdog = setInterval(() => this.checkHealth(), 2000);
    this.emitStatus();
  }

  /* ---------------- encoder ---------------- */

  private spawnEncoder() {
    const offset = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    const proc = spawn(config.ffmpegPath, encoderArgs(offset, config, this.videoCopy && config.encoderMode !== 'x264'), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.encoder = proc;
    this.encBytes = 0;
    this.awaitingHeader = true;
    proc.stdin.on('error', () => undefined);
    proc.stdout.on('data', (buf: Buffer) => {
      this.lastOutput = Date.now();
      for (const r of this.relays) {
        const p = r.proc;
        if (!p || p.stdin.destroyed) continue;
        if (p.stdin.writableLength > MAX_RELAY_BACKLOG) {
          // ingest can't keep up (network stall) — recycle this relay only
          this.log(r, 'backlog overflow, reconnecting');
          p.kill('SIGKILL');
          continue;
        }
        p.stdin.write(buf);
      }
    });
    let pending = '';
    proc.stderr.on('data', (d: Buffer) => {
      pending += d.toString();
      const lines = pending.split(/\r|\n/);
      pending = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        this.encTail.push(l.trim());
        if (this.encTail.length > 20) this.encTail.shift();
        const m = PROGRESS_RE.exec(l);
        if (m && !this.stopped) {
          this.status.fps = Number(m[2]);
          const sp = SPEED_RE.exec(l);
          this.status.speed = sp ? Number(sp[1]) : undefined;
          if (this.status.state === 'starting' || this.status.state === 'reconnecting') {
            this.status.state = 'live';
            this.status.error = undefined; // recovered
            this.status.startedAt ??= Date.now();
            this.emitStatus();
          }
        }
      }
    });
    proc.on('error', (e) => {
      this.status.error = `ffmpeg failed to start: ${e.message}`;
      this.status.state = 'error';
      this.emitStatus();
    });
    proc.on('exit', (code, signal) => {
      if (this.encoder === proc) this.encoder = null;
      if (this.stopped) return;
      this.encoderRestarts++;
      this.status.reconnects = this.encoderRestarts;
      this.status.state = 'reconnecting';
      const why = signal
        ? signal === 'SIGKILL'
          ? 'Encoder stalled or ran out of memory (killed) — restarting'
          : `Encoder stopped by ${signal} (server instance shutting down) — restarting`
        : `Encoder exited (code ${code}) — restarting`;
      const err = this.encTail.filter((l) => /error|invalid|fail/i.test(l)).slice(-1);
      this.status.error = `${why}${err.length ? `. ${err[0]}` : ''}`.slice(0, 300);
      this.emitStatus();
      setTimeout(() => {
        if (this.stopped || this.encoder) return;
        this.spawnEncoder();
        this.emit('needRestart'); // producer must send a fresh WebM header
      }, 800);
    });
  }

  /** Called when the producer (re)starts its MediaRecorder: next chunk is a new WebM header. */
  resetIngest(mime?: string) {
    if (this.stopped) return;
    // no mime = internal restart (e.g. backlog): keep the current mode instead of falling back to x264
    const copy = mime ? /h264|avc1/i.test(mime) : this.videoCopy;
    const modeChanged = copy !== this.videoCopy;
    this.videoCopy = copy;
    if (this.encBytes === 0 && !modeChanged && this.encoder) {
      this.awaitingHeader = false; // fresh encoder is already waiting — the header comes next
      return;
    }
    const old = this.encoder;
    this.encoder = null;
    if (old) {
      old.removeAllListeners('exit');
      old.stdin.end();
      setTimeout(() => old.kill('SIGKILL'), 1500).unref();
    }
    this.spawnEncoder();
    this.awaitingHeader = false;
  }

  write(chunk: Buffer) {
    if (this.stopped) return;
    this.lastIngest = Date.now();
    this.bytesIn += chunk.length;
    const e = this.encoder;
    if (!e || e.stdin.destroyed) return;
    // mid-stream bytes (e.g. flushed after a reconnect) would crash a fresh encoder — wait for a header
    if (this.awaitingHeader) return;
    if (e.stdin.writableLength > MAX_ENCODER_BACKLOG) {
      // encoder can't keep up (CPU starved): restart cleanly rather than buffer forever
      this.resetIngest();
      this.emit('needRestart');
      return;
    }
    this.encBytes += chunk.length;
    e.stdin.write(chunk);
  }

  /* ---------------- relays ---------------- */

  private spawnRelay(r: Relay) {
    if (this.stopped) return;
    r.timer = null;
    r.status.state = 'connecting';
    const proc = spawn(config.ffmpegPath, relayArgs(rtmpUrl(r.target)), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    r.proc = proc;
    r.liveSince = 0;
    proc.stdin.on('error', () => undefined);
    proc.stdout.resume();
    let pending = '';
    proc.stderr.on('data', (d: Buffer) => {
      pending += d.toString();
      const lines = pending.split(/\r|\n/);
      pending = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        r.tail.push(l.trim());
        if (r.tail.length > 12) r.tail.shift();
        if (/frame=\s*\d+|size=\s*\d+/.test(l) && r.status.state !== 'live') {
          r.status.state = 'live';
          r.status.error = undefined;
          r.liveSince = Date.now();
          this.emitStatus();
        }
      }
    });
    proc.on('error', () => undefined);
    proc.on('exit', () => {
      if (r.proc === proc) r.proc = null;
      if (this.stopped) return;
      // healthy for a minute → reset backoff
      if (r.liveSince && Date.now() - r.liveSince > 60_000) r.backoff = 1000;
      r.status.state = 'retrying';
      r.status.retries = (r.status.retries ?? 0) + 1;
      r.status.error = (r.tail.filter((l) => /error|fail|refused|denied|timed out|invalid|broken|reset/i.test(l)).pop() ?? r.tail.at(-1) ?? 'Connection dropped').slice(0, 200);
      this.emit('log', `[${r.target.name}] relay exited, reconnecting: ${r.status.error}`);
      this.emitStatus();
      const wait = r.backoff;
      r.backoff = Math.min(r.backoff * 2, 30_000);
      r.timer = setTimeout(() => this.spawnRelay(r), wait);
    });
    this.emitStatus();
  }

  private log(r: Relay, msg: string) {
    this.emit('log', `[${r.target.name}] ${msg}`);
  }

  /* ---------------- health ---------------- */

  private checkHealth() {
    if (this.stopped) return;
    const now = Date.now();
    if (this.status.state === 'live' && now - this.lastIngest > 5000) {
      this.status.state = 'reconnecting';
      this.status.error = 'Waiting for the program feed (producer reconnecting)…';
      this.emitStatus();
      this.emit('ingestStalled');
    }
    // encoder alive but silent for a long time → restart it
    if (this.encoder && now - this.lastIngest < 3000 && this.lastOutput && now - this.lastOutput > 15_000) {
      this.encoder.kill('SIGKILL');
    }
    this.emitStatus(false);
  }

  private lastEmit = 0;
  private emitStatus(force = true) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 2000) return;
    this.lastEmit = now;
    const secs = (now - (this.status.startedAt ?? now)) / 1000;
    this.status.bitrateKbps = secs > 1 ? Math.round((this.bytesIn * 8) / 1000 / secs) : undefined;
    this.emit('status', this.status);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.status.state = 'idle';
    this.status.startedAt = undefined;
    const enc = this.encoder;
    this.encoder = null;
    if (enc) {
      enc.stdin.end();
      setTimeout(() => enc.kill('SIGKILL'), 2000).unref();
    }
    for (const r of this.relays) {
      if (r.timer) clearTimeout(r.timer);
      const p = r.proc;
      r.proc = null;
      r.status.state = 'idle';
      if (p) {
        p.stdin.end();
        setTimeout(() => p.kill('SIGKILL'), 3000).unref();
      }
    }
    this.emit('status', this.status);
    this.removeAllListeners('needRestart');
  }
}
