import { config } from '../config';
import { rtmpUrl, type StreamTarget } from './pipeline';

/**
 * Production media path (MEDIA_MODE=livekit):
 *  - participants publish to a LiveKit SFU room named after the studio
 *  - LiveKit Web Egress opens /program/:id (the same canvas compositor) in headless Chrome
 *    and pushes it to all RTMP destinations — no encoding load on the host's laptop.
 */
export class LiveKitService {
  private sdk: typeof import('livekit-server-sdk') | null = null;
  private egress = new Map<string, string>(); // studioId -> egressId

  get enabled() {
    return config.mediaMode === 'livekit' && !!config.livekit.url && !!config.livekit.apiKey;
  }

  private async load() {
    if (!this.sdk) this.sdk = await import('livekit-server-sdk');
    return this.sdk;
  }

  private httpUrl() {
    return config.livekit.url.replace(/^ws/, 'http');
  }

  async token(studioId: string, identity: string, name: string, canPublish: boolean): Promise<string> {
    const { AccessToken } = await this.load();
    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, { identity, name, ttl: '8h' });
    at.addGrant({ roomJoin: true, room: `studio-${studioId}`, canPublish, canSubscribe: true, canPublishData: true });
    return at.toJwt();
  }

  async startEgress(studioId: string, programUrl: string, targets: StreamTarget[]): Promise<string> {
    const { EgressClient, StreamOutput, StreamProtocol, EncodingOptionsPreset } = await this.load();
    const client = new EgressClient(this.httpUrl(), config.livekit.apiKey, config.livekit.apiSecret);
    const output = new StreamOutput({ protocol: StreamProtocol.RTMP, urls: targets.map((t) => rtmpUrl(t)) });
    const info = await client.startWebEgress(programUrl, { stream: output }, { encodingOptions: EncodingOptionsPreset.H264_1080P_30 });
    this.egress.set(studioId, info.egressId);
    return info.egressId;
  }

  async stopEgress(studioId: string) {
    const id = this.egress.get(studioId);
    if (!id) return;
    const { EgressClient } = await this.load();
    const client = new EgressClient(this.httpUrl(), config.livekit.apiKey, config.livekit.apiSecret);
    await client.stopEgress(id).catch(() => undefined);
    this.egress.delete(studioId);
  }
}
