// Free live captions via the browser Web Speech API (Chrome/Edge). Sends text to the studio,
// which broadcasts it so the program renderer can burn captions into the stream.

type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (e: any) => void;
  onend: () => void;
  onerror: (e: any) => void;
  start(): void;
  stop(): void;
};

export function speechSupported() {
  return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
}

export class LiveCaptions {
  private rec: Rec | null = null;
  private running = false;

  constructor(
    private readonly onText: (text: string, final: boolean) => void,
    private readonly lang = navigator.language || 'en-IN',
  ) {}

  start() {
    if (!speechSupported() || this.running) return false;
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const rec: Rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        this.onText(r[0].transcript.trim(), r.isFinal);
      }
    };
    rec.onerror = () => undefined;
    rec.onend = () => {
      // Chrome stops after silence — keep going while enabled
      if (this.running) setTimeout(() => this.running && rec.start(), 250);
    };
    this.rec = rec;
    this.running = true;
    rec.start();
    return true;
  }

  stop() {
    this.running = false;
    this.rec?.stop();
    this.rec = null;
  }
}
