// LiveKit SFU transport (MEDIA_MODE=livekit). Same surface as MeshRTC so the studio is transport-agnostic.
import type { RemoteMedia } from './mesh';

type LK = typeof import('livekit-client');

export class LiveKitRTC {
  private lk: LK | null = null;
  private room: import('livekit-client').Room | null = null;
  private published = new Map<MediaStreamTrack, import('livekit-client').LocalTrackPublication>();
  private media = new Map<string, RemoteMedia>();
  onMedia?: (peerId: string, media: RemoteMedia) => void;
  onPeerGone?: (peerId: string) => void;

  async connect(url: string, token: string) {
    this.lk = await import('livekit-client');
    const { Room, RoomEvent, Track } = this.lk;
    const room = new Room({ adaptiveStream: false, dynacast: true });
    this.room = room;
    const update = (identity: string) => {
      const m = this.media.get(identity) ?? { cam: null, screen: null };
      const p = room.remoteParticipants.get(identity);
      const cam = new MediaStream();
      const screen = new MediaStream();
      p?.trackPublications.forEach((pub) => {
        const t = pub.track?.mediaStreamTrack;
        if (!t) return;
        if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) screen.addTrack(t);
        else cam.addTrack(t);
      });
      m.cam = cam.getTracks().length ? cam : null;
      m.screen = screen.getTracks().length ? screen : null;
      this.media.set(identity, m);
      this.onMedia?.(identity, { ...m });
    };
    room.on(RoomEvent.TrackSubscribed, (_t, _pub, p) => update(p.identity));
    room.on(RoomEvent.TrackUnsubscribed, (_t, _pub, p) => update(p.identity));
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      this.media.delete(p.identity);
      this.onPeerGone?.(p.identity);
    });
    await room.connect(url, token, { autoSubscribe: true });
    room.remoteParticipants.forEach((p) => update(p.identity));
  }

  async setLocal(cam: MediaStream | null, screen: MediaStream | null) {
    if (!this.room || !this.lk) return;
    const { Track } = this.lk;
    const want = new Map<MediaStreamTrack, import('livekit-client').Track.Source>();
    cam?.getAudioTracks().forEach((t) => want.set(t, Track.Source.Microphone));
    cam?.getVideoTracks().forEach((t) => want.set(t, Track.Source.Camera));
    screen?.getVideoTracks().forEach((t) => want.set(t, Track.Source.ScreenShare));
    for (const [t, pub] of this.published) {
      if (!want.has(t)) {
        await this.room.localParticipant.unpublishTrack(pub.track!, false);
        this.published.delete(t);
      }
    }
    for (const [t, source] of want) {
      if (this.published.has(t)) continue;
      const pub = await this.room.localParticipant.publishTrack(t, { source, simulcast: false });
      this.published.set(t, pub);
    }
  }

  async replaceTrack(_kind: 'audio' | 'video', _track: MediaStreamTrack | null) {
    /* handled by setLocal republish */
  }

  close() {
    void this.room?.disconnect();
    this.room = null;
  }
}
