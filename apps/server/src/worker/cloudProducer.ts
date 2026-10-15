import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
// static import on purpose: runtime dynamic imports under a TS loader can deadlock when stdout is a pipe
import puppeteer, { type Browser } from 'puppeteer-core';
import { config } from '../config';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findChrome(): string | null {
  if (config.chromePath && existsSync(config.chromePath)) return config.chromePath;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export interface ProducerHealth {
  fps: number;
  heapMb: number;
  ts: number;
}

/**
 * Headless Chrome that opens the studio's program page in "producer" mode:
 * it renders the 1080p program, mixes music/sfx/AI commentary and streams it to the
 * server pipeline — so a show can run 24/7 with no human browser open.
 *
 * Watchdog: restarts on crash, missing heartbeats or memory growth, and recycles on a
 * schedule. The RTMP relays stay connected during a restart (viewers see a short freeze).
 */
export class CloudProducer extends EventEmitter {
  private browser: Browser | null = null;
  private stopped = true;
  private startedAt = 0;
  private lastBeat = 0;
  private watchdog: NodeJS.Timeout | null = null;
  private failures = 0;
  private restarting = false;
  restarts = 0;
  health: ProducerHealth | null = null;

  constructor(
    readonly studioId: string,
    private readonly url: string,
  ) {
    super();
  }

  get running() {
    return !this.stopped;
  }

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    await this.launch();
    this.watchdog = setInterval(() => void this.check(), 10_000);
  }

  private async launch() {
    const exe = findChrome();
    if (!exe) {
      this.emit('error', new Error('No Chrome/Chromium found. Set CHROME_PATH (Docker image ships Chromium).'));
      return;
    }
    const args = [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio', // speakers muted; WebAudio → MediaStream capture is unaffected
      '--use-fake-ui-for-media-stream',
      '--window-size=1920,1080',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--use-angle=default',
      '--enable-unsafe-swiftshader', // software fallback on GPU-less cloud VMs
      '--js-flags=--max-old-space-size=1536',
    ];
    if (process.platform === 'linux') args.push('--no-sandbox', '--disable-setuid-sandbox');
    try {
      const browser = await puppeteer.launch({ executablePath: exe, headless: true, args, defaultViewport: { width: 1920, height: 1080 } });
      this.browser = browser;
      this.startedAt = Date.now();
      this.lastBeat = Date.now();
      this.health = null;
      browser.on('disconnected', () => {
        if (this.browser === browser) this.browser = null;
        if (!this.stopped && !this.restarting) void this.restart('browser exited');
      });
      const page = await browser.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') this.emit('log', `[producer] ${m.text()}`.slice(0, 300));
      });
      page.on('pageerror', (e) => this.emit('log', `[producer] ${String(e)}`.slice(0, 300)));
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      this.failures = 0;
      this.emit('started');
    } catch (e) {
      this.failures++;
      this.emit('log', `[producer] launch failed: ${(e as Error).message}`);
      if (!this.stopped) setTimeout(() => void this.restart('launch failed'), Math.min(60_000, 3000 * 2 ** this.failures));
    }
  }

  heartbeat(h: Omit<ProducerHealth, 'ts'>) {
    this.lastBeat = Date.now();
    this.health = { ...h, ts: this.lastBeat };
  }

  private async check() {
    if (this.stopped || this.restarting) return;
    const now = Date.now();
    // generous grace on startup (cold page load on a busy box), strict once running
    const grace = this.health ? 40_000 : 90_000;
    if (this.browser && now - this.lastBeat > grace) return this.restart('no heartbeat');
    if (this.health && this.health.heapMb > config.workerMaxHeapMb) return this.restart(`memory ${this.health.heapMb}MB`);
    if (config.workerRecycleHours > 0 && now - this.startedAt > config.workerRecycleHours * 3_600_000) return this.restart('scheduled recycle');
  }

  async restart(reason: string) {
    if (this.stopped || this.restarting) return;
    this.restarting = true;
    this.restarts++;
    this.emit('log', `[producer] restarting: ${reason}`);
    const old = this.browser;
    this.browser = null;
    await old?.close().catch(() => undefined);
    this.restarting = false;
    if (!this.stopped) await this.launch();
  }

  async stop() {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    const b = this.browser;
    this.browser = null;
    await b?.close().catch(() => undefined);
  }
}
