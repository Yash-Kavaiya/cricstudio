import { createHash } from 'node:crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { EDGE_LANG_VOICES, VOICES } from '@cricstudio/shared';
import { config } from '../config';

/**
 * Free neural text-to-speech (Microsoft Edge "Read aloud" voices) with a bounded LRU cache.
 * Returns MP3 bytes that the program mixer decodes and plays into the broadcast.
 */
export class TtsService {
  private cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  private readonly maxBytes = 24 * 1024 * 1024;
  private clients = new Map<string, MsEdgeTTS>();
  private inflight = new Map<string, Promise<Buffer>>();
  failures = 0;

  private async client(voice: string): Promise<MsEdgeTTS> {
    let c = this.clients.get(voice);
    if (!c) {
      c = new MsEdgeTTS();
      await c.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      this.clients.set(voice, c);
    }
    return c;
  }

  private remember(key: string, buf: Buffer) {
    this.cache.set(key, buf);
    this.cacheBytes += buf.length;
    while (this.cacheBytes > this.maxBytes && this.cache.size) {
      const [k, v] = this.cache.entries().next().value as [string, Buffer];
      this.cache.delete(k);
      this.cacheBytes -= v.length;
    }
  }

  async synth(textIn: string, voiceIn?: string, rate = '+0%', pitch = '+0Hz'): Promise<Buffer> {
    const text = textIn.replace(/\s+/g, ' ').trim().slice(0, 400);
    const voice = VOICES.some((v) => v.id === voiceIn) || Object.values(EDGE_LANG_VOICES).includes(voiceIn ?? '') ? voiceIn! : config.ttsVoice;
    const key = createHash('sha1').update(`${voice}|${rate}|${pitch}|${text}`).digest('hex');
    const hit = this.cache.get(key);
    if (hit) {
      // LRU bump
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const c = await this.client(voice);
        const { audioStream } = c.toStream(text, { rate, pitch });
        const buf = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const t = setTimeout(() => reject(new Error('TTS timeout')), 12_000);
          audioStream.on('data', (d: Buffer) => chunks.push(d));
          audioStream.on('close', () => {
            clearTimeout(t);
            resolve(Buffer.concat(chunks));
          });
          audioStream.on('error', (e: Error) => {
            clearTimeout(t);
            reject(e);
          });
        });
        if (!buf.length) throw new Error('empty TTS audio');
        this.remember(key, buf);
        this.failures = 0;
        return buf;
      } catch (e) {
        this.failures++;
        this.clients.delete(voice); // reconnect next time
        throw e;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}
