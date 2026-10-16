// Hardware program encoder: WebCodecs H.264 on the GPU (Intel Quick Sync / NVENC / AMF via Chrome)
// + Opus audio, muxed to fragmented MP4 and streamed to the server, which passes the H.264 through
// untouched exactly like the MediaRecorder path. On a typical laptop MediaRecorder tops out around
// 25 fps at 1080p (software x264-class encoder sharing the CPU with the compositor); the GPU encoder
// keeps a steady 30 fps with CPU to spare.
import { Muxer, StreamTarget } from 'mp4-muxer';
import type { RecorderSink } from './recorder';

const W = 1920;
const H = 1080;
const FPS = 30;
const KEYFRAME_US = 2_000_000; // platforms want a keyframe at least every 2–4 s
const AVC_CODEC = 'avc1.640028'; // High profile, level 4.0 (1080p30)
const MAX_VIDEO_QUEUE = 6; // frames waiting in the encoder before we start dropping

type TrackProcessorCtor = new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame | AudioData> };
const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;

let support: Promise<boolean> | null = null;

/** True when this browser can encode 1080p30 H.264 on the GPU and read raw tracks. Cached. */
export function hardwareEncodingSupported(): Promise<boolean> {
  support ??= (async () => {
    if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || !Processor) return false;
    try {
      const v = await VideoEncoder.isConfigSupported(videoConfig(6_000_000));
      if (!v.supported) return false;
      const a = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000 });
      return !!a.supported;
    } catch {
      return false;
    }
  })();
  return support;
}

function videoConfig(bps: number): VideoEncoderConfig {
  return {
    codec: AVC_CODEC,
    width: W,
    height: H,
    bitrate: bps,
    framerate: FPS,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'realtime',
    avc: { format: 'avc' },
  };
}

/** One encode session = one fMP4 stream with its own init segment. */
class HwSession {
  private stopped = false;
  private venc: VideoEncoder | null = null;
  private aenc: AudioEncoder | null = null;
  private muxer: Muxer<StreamTarget> | null = null;
  private readers: ReadableStreamDefaultReader<VideoFrame | AudioData>[] = [];
  /** per-session clones: cancelling a track processor ends its track, so never hand it the shared ones */
  private clones: MediaStreamTrack[] = [];
  private readonly t0 = performance.now();
  private videoOffset: number | null = null; // µs: our clock − source clock
  private audioOffset: number | null = null;
  private lastKey = -Infinity;
  private forceKey = true;
  private written = 0;
  private lastVideoTs = -Infinity; // source clock, µs
  private lastAudioTs = -Infinity;
  dropped = 0;
  /** encoded video frames, for the live fps readout */
  encoded = 0;

  constructor(
    private readonly video: MediaStreamTrack,
    private readonly audio: MediaStreamTrack | null,
    private readonly sink: RecorderSink,
    private readonly videoBps: number,
    private readonly onBytes: (n: number) => void,
    private readonly onFail: (why: string) => void,
  ) {}

  private now() {
    return Math.round((performance.now() - this.t0) * 1000);
  }

  private fail(why: string) {
    if (this.stopped) return;
    this.stop();
    this.onFail(why);
  }

  async start() {
    const audioFmt = this.audio ? await this.firstAudioFormat() : null;
    if (this.stopped) return;
    this.sink.reset('video/mp4;codecs=avc1,opus');
    this.muxer = new Muxer({
      target: new StreamTarget({
        // fragmented MP4 is written strictly in order, so `position` only ever moves forward
        onData: (data, position) => {
          if (this.stopped) return;
          if (position < this.written) return this.fail('muxer seeked backwards');
          this.written = position + data.byteLength;
          const copy = data.slice(); // the muxer reuses its buffer
          this.onBytes(copy.byteLength);
          this.sink.chunk(copy.buffer);
        },
      }),
      // no frameRate here: it would set a 1/30 s timescale and round jittery frames onto the same tick
      video: { codec: 'avc', width: W, height: H },
      audio: audioFmt ? { codec: 'opus', sampleRate: audioFmt.sampleRate, numberOfChannels: audioFmt.channels } : undefined,
      fastStart: 'fragmented',
      firstTimestampBehavior: 'cross-track-offset',
    });

    const venc = new VideoEncoder({
      output: (chunk, meta) => {
        if (this.stopped || !this.muxer || this.videoOffset === null) return;
        try {
          this.muxer.addVideoChunk(chunk, meta, chunk.timestamp + this.videoOffset);
          this.encoded++;
        } catch (e) {
          this.fail(`mux video: ${(e as Error).message}`);
        }
      },
      error: (e) => this.fail(`video encoder: ${e.message}`),
    });
    venc.configure(videoConfig(this.videoBps));
    this.venc = venc;

    if (audioFmt) {
      const aenc = new AudioEncoder({
        output: (chunk, meta) => {
          if (this.stopped || !this.muxer || this.audioOffset === null) return;
          try {
            this.muxer.addAudioChunk(chunk, meta, chunk.timestamp + this.audioOffset);
          } catch (e) {
            this.fail(`mux audio: ${(e as Error).message}`);
          }
        },
        error: (e) => this.fail(`audio encoder: ${e.message}`),
      });
      aenc.configure({ codec: 'opus', sampleRate: audioFmt.sampleRate, numberOfChannels: audioFmt.channels, bitrate: 160_000 });
      this.aenc = aenc;
      void this.pumpAudio(audioFmt.reader);
    }
    void this.pumpVideo();
  }

  /** Reads one AudioData to learn the real sample rate / channel count, then keeps reading from it. */
  private async firstAudioFormat(): Promise<{ sampleRate: number; channels: number; reader: ReadableStreamDefaultReader<AudioData> } | null> {
    const track = this.audio!.clone();
    this.clones.push(track);
    const reader = new Processor!({ track }).readable.getReader() as ReadableStreamDefaultReader<AudioData>;
    this.readers.push(reader);
    const first = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    if (!first || first.done || !first.value) return null; // silent/absent track → video only
    const d = first.value;
    const fmt = { sampleRate: d.sampleRate, channels: Math.min(2, d.numberOfChannels) || 1, reader };
    d.close();
    return fmt;
  }

  private async pumpVideo() {
    const track = this.video.clone();
    this.clones.push(track);
    const reader = new Processor!({ track }).readable.getReader() as ReadableStreamDefaultReader<VideoFrame>;
    this.readers.push(reader);
    try {
      while (!this.stopped) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        const venc = this.venc;
        if (this.stopped || !venc || venc.state !== 'configured') {
          frame.close();
          break;
        }
        // GPU busy or tab stalled: drop rather than build latency (the next frame is newer anyway)
        if (venc.encodeQueueSize > MAX_VIDEO_QUEUE) {
          this.dropped++;
          frame.close();
          this.forceKey = true;
          continue;
        }
        // the muxer needs strictly increasing timestamps; capture clocks occasionally step back a few ms
        if (frame.timestamp <= this.lastVideoTs) {
          frame.close();
          continue;
        }
        this.lastVideoTs = frame.timestamp;
        if (this.videoOffset === null) this.videoOffset = this.now() - frame.timestamp;
        const ts = frame.timestamp + this.videoOffset;
        const key = this.forceKey || ts - this.lastKey >= KEYFRAME_US;
        if (key) {
          this.lastKey = ts;
          this.forceKey = false;
        }
        venc.encode(frame, { keyFrame: key });
        frame.close();
      }
    } catch (e) {
      this.fail(`video input: ${(e as Error).message}`);
    }
  }

  private async pumpAudio(reader: ReadableStreamDefaultReader<AudioData>) {
    try {
      while (!this.stopped) {
        const { value: data, done } = await reader.read();
        if (done || !data) break;
        const aenc = this.aenc;
        if (this.stopped || !aenc || aenc.state !== 'configured') {
          data.close();
          break;
        }
        if (data.timestamp <= this.lastAudioTs) {
          data.close();
          continue;
        }
        this.lastAudioTs = data.timestamp;
        if (this.audioOffset === null) this.audioOffset = this.now() - data.timestamp;
        aenc.encode(data);
        data.close();
      }
    } catch (e) {
      this.fail(`audio input: ${(e as Error).message}`);
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const r of this.readers) void r.cancel().catch(() => undefined);
    this.readers = [];
    for (const t of this.clones) t.stop();
    this.clones = [];
    for (const enc of [this.venc, this.aenc]) {
      try {
        if (enc && enc.state !== 'closed') enc.close();
      } catch {
        /* already closed */
      }
    }
    this.venc = null;
    this.aenc = null;
    this.muxer = null; // the server restarts its encoder on the next init segment; no finalize needed
  }
}

/** Same contract as ProgramRecorder (start / restart / stop), backed by the GPU encoder. */
export class HwProgramRecorder {
  private session: HwSession | null = null;
  private readonly video: MediaStreamTrack;
  private readonly audio: MediaStreamTrack | null;
  bytesSent = 0;

  constructor(
    canvas: HTMLCanvasElement,
    audio: MediaStream | null,
    private readonly sink: RecorderSink,
    private readonly onFail: (why: string) => void,
    private readonly videoBps = 6_000_000,
  ) {
    // no rate cap: captureStream(30) drops any frame painted slightly sooner than 33.3 ms after the last
    this.video = canvas.captureStream().getVideoTracks()[0];
    this.audio = audio?.getAudioTracks()[0] ?? null;
  }

  get running() {
    return !!this.session;
  }

  get dropped() {
    return this.session?.dropped ?? 0;
  }

  private fpsMark = { t: performance.now(), n: 0 };
  /** frames per second actually leaving the encoder (sampled since the last call) */
  sampleFps(): number {
    const now = performance.now();
    const n = this.session?.encoded ?? 0;
    const dt = now - this.fpsMark.t;
    const fps = dt > 0 && n >= this.fpsMark.n ? ((n - this.fpsMark.n) * 1000) / dt : 0;
    this.fpsMark = { t: now, n };
    return fps;
  }

  start() {
    this.session?.stop();
    const s = new HwSession(
      this.video,
      this.audio,
      this.sink,
      this.videoBps,
      (n) => (this.bytesSent += n),
      (why) => {
        if (this.session !== s) return;
        this.session = null;
        this.onFail(why);
      },
    );
    this.session = s;
    s.start().catch((e: Error) => {
      if (this.session !== s) return;
      s.stop();
      this.session = null;
      this.onFail(`start: ${e.message}`);
    });
  }

  restart() {
    this.start();
  }

  stop() {
    this.session?.stop();
    this.session = null;
  }

  dispose() {
    this.stop();
    this.video.stop();
  }
}
