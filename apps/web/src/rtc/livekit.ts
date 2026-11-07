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
    const want: { track: MediaStreamTrack; source: import('livekit-client').Track.Source }[] = [];
    cam?.getAudioTracks().forEach((t) => want.push({ track: t, source: Track.Source.Microphone }));
    cam?.getVideoTracks().forEach((t) => want.push({ track: t, source: Track.Source.Camera }));
    screen?.getVideoTracks().forEach((t) => want.push({ track: t, source: Track.Source.ScreenShare }));
    const kept = new Set<MediaStreamTrack>();
    for (const item of want) {
      const existing = [...this.published.entries()].find(([, pub]) => pub.source === item.source);
      // A disabled device track is the camera/mic at rest. Never put that on the sender —
      // the mute path has already swapped in a live black or silent track.
      if (!item.track.enabled) {
        if (existing) kept.add(existing[0]);
        continue;
      }
      if (!existing) {
        const pub = await this.room.localParticipant.publishTrack(item.track, { source: item.source, simulcast: false });
        this.published.set(item.track, pub);
        kept.add(item.track);
        continue;
      }
      const [current, pub] = existing;
      if (current !== item.track) {
        const local = pub.track as { replaceTrack?: (t: MediaStreamTrack) => Promise<void> } | undefined;
        if (local?.replaceTrack) await local.replaceTrack(item.track);
        this.published.delete(current);
        this.published.set(item.track, pub);
      }
      kept.add(item.track);
    }
    for (const [track, pub] of [...this.published]) {
      if (kept.has(track)) continue;
      await this.room.localParticipant.unpublishTrack(pub.track!, false);
      this.published.delete(track);
    }
  }

  /** Swap mic or camera in place. Unpublishing here would drop the subscriber. */
  async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack) {
    if (!this.room || !this.lk) return;
    const { Track } = this.lk;
    let found = false;
    for (const [current, pub] of [...this.published]) {
      if (current.kind !== kind) continue;
      if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) continue;
      found = true;
      if (current === track) continue;
      const local = pub.track as { replaceTrack?: (t: MediaStreamTrack) => Promise<void> } | undefined;
      if (!local?.replaceTrack) continue;
      await local.replaceTrack(track);
      this.published.delete(current);
      this.published.set(track, pub);
    }
    if (found) return;
    const source = kind === 'audio' ? Track.Source.Microphone : Track.Source.Camera;
    const pub = await this.room.localParticipant.publishTrack(track, { source, simulcast: false });
    this.published.set(track, pub);
  }

  close() {
    void this.room?.disconnect();
    this.room = null;
  }
}
