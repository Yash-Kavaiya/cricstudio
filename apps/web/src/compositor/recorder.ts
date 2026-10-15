const MIME_CANDIDATES = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=avc1,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

export function pickMime(): string {
  for (const m of MIME_CANDIDATES) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

export interface RecorderSink {
  /** called before the first chunk of every new recording (fresh WebM header) */
  reset(mime: string): void;
  chunk(buf: ArrayBuffer): void;
}

/**
 * Captures the composited program (canvas video + mixed audio) as WebM chunks.
 * The server encodes once and relays to every RTMP destination.
 */
export class ProgramRecorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream;
  bytesSent = 0;

  constructor(
    canvas: HTMLCanvasElement,
    audio: MediaStream | null,
    private readonly sink: RecorderSink,
    private readonly videoBps = 6_000_000,
  ) {
    const v = canvas.captureStream(30);
    this.stream = new MediaStream([...v.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
  }

  get running() {
    return !!this.rec && this.rec.state !== 'inactive';
  }

  start() {
    this.stopRecorder();
    const mimeType = pickMime();
    // keyframe every 2s so platforms (and relays joining mid-stream) can decode the passthrough H.264
    const rec = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: this.videoBps,
      audioBitsPerSecond: 160_000,
      videoKeyFrameIntervalDuration: 2000,
    } as MediaRecorderOptions);
    this.sink.reset(rec.mimeType || mimeType);
    rec.ondataavailable = async (e) => {
      if (!e.data.size || this.rec !== rec) return;
      const buf = await e.data.arrayBuffer();
      this.bytesSent += buf.byteLength;
      this.sink.chunk(buf);
    };
    rec.onerror = () => setTimeout(() => this.rec === rec && this.start(), 1000);
    rec.start(250);
    this.rec = rec;
  }

  /** server encoder restarted → it needs a fresh WebM header */
  restart() {
    this.start();
  }

  private stopRecorder() {
    const r = this.rec;
    this.rec = null;
    if (r && r.state !== 'inactive') r.stop();
  }

  stop() {
    this.stopRecorder();
  }
}
