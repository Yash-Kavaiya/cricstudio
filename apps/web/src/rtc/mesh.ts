import type { Socket } from 'socket.io-client';
import type { RTCIceServerLike } from '@cricstudio/shared';

export interface RemoteMedia {
  cam: MediaStream | null;
  screen: MediaStream | null;
}

type Signal =
  | { type: 'description'; description: RTCSessionDescriptionInit; streams?: Record<string, 'cam' | 'screen'> }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'hello' };

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteKinds: Record<string, 'cam' | 'screen'>;
  media: RemoteMedia;
  senders: RTCRtpSender[];
}

/**
 * Full-mesh WebRTC with "perfect negotiation" (≤ 5 speakers + optional receive-only program peers).
 * Each peer gets our camera stream and (optionally) a screen stream; we label streams so the
 * remote side knows which is which.
 */
export class MeshRTC {
  private peers = new Map<string, Peer>();
  private cam: MediaStream | null = null;
  private screen: MediaStream | null = null;
  onMedia?: (peerId: string, media: RemoteMedia) => void;
  onPeerGone?: (peerId: string) => void;
  onState?: (peerId: string, state: RTCPeerConnectionState) => void;

  constructor(
    private readonly socket: Socket,
    private readonly selfId: string,
    private readonly iceServers: RTCIceServerLike[],
    /** program/receive-only clients publish nothing */
    private readonly sendMedia = true,
  ) {
    socket.on('rtc:signal', this.onSignal);
  }

  private onSignal = async ({ from, data }: { from: string; data: Signal }) => {
    const peer = this.peers.get(from) ?? this.connect(from, false);
    const pc = peer.pc;
    try {
      if (data.type === 'hello') return;
      if (data.type === 'description') {
        if (data.streams) Object.assign(peer.remoteKinds, data.streams);
        const d = data.description;
        const collision = d.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          await pc.setLocalDescription();
          this.send(from, { type: 'description', description: pc.localDescription!.toJSON(), streams: this.streamKinds() });
        }
      } else if (data.type === 'candidate') {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!peer.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn('[mesh] signal error', e);
    }
  };

  private send(to: string, data: Signal) {
    this.socket.emit('rtc:signal', { to, data });
  }

  private streamKinds(): Record<string, 'cam' | 'screen'> {
    const k: Record<string, 'cam' | 'screen'> = {};
    if (this.cam) k[this.cam.id] = 'cam';
    if (this.screen) k[this.screen.id] = 'screen';
    return k;
  }

  /** Create (or get) a connection to a peer. `initiator` = we start negotiation. */
  connect(peerId: string, initiator = true): Peer {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers as RTCIceServer[], bundlePolicy: 'max-bundle' });
    const peer: Peer = {
      pc,
      polite: this.selfId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      remoteKinds: {},
      media: { cam: null, screen: null },
      senders: [],
    };
    this.peers.set(peerId, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send(peerId, { type: 'candidate', candidate: candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send(peerId, { type: 'description', description: pc.localDescription!.toJSON(), streams: this.streamKinds() });
      } catch (e) {
        console.warn('[mesh] negotiation failed', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      const kind = peer.remoteKinds[stream.id] ?? (peer.media.cam && peer.media.cam.id !== stream.id ? 'screen' : 'cam');
      if (kind === 'screen') peer.media.screen = stream;
      else peer.media.cam = stream;
      const emit = () => this.onMedia?.(peerId, { ...peer.media });
      track.onunmute = emit;
      track.onended = () => {
        if (peer.media.screen === stream && stream.getVideoTracks().every((t) => t.readyState === 'ended')) peer.media.screen = null;
        emit();
      };
      stream.onremovetrack = () => {
        if (kind === 'screen' && !stream.getTracks().length) peer.media.screen = null;
        emit();
      };
      emit();
    };
    pc.onconnectionstatechange = () => {
      this.onState?.(peerId, pc.connectionState);
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    if (!this.sendMedia && initiator) {
      // receive-only initiator: ask for audio+video. When the remote side initiates, its offer
      // already carries its tracks — adding transceivers here would cause glare + inactive m-lines.
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    this.attachLocal(peer);
    return peer;
  }

  private attachLocal(peer: Peer) {
    if (!this.sendMedia) return;
    for (const s of peer.senders) {
      try {
        peer.pc.removeTrack(s);
      } catch {
        /* closed */
      }
    }
    peer.senders = [];
    for (const stream of [this.cam, this.screen]) {
      if (!stream) continue;
      for (const t of stream.getTracks()) peer.senders.push(peer.pc.addTrack(t, stream));
    }
  }

  /** Called when camera/mic or screen changes; renegotiates with every peer. */
  setLocal(cam: MediaStream | null, screen: MediaStream | null) {
    const camChanged = cam !== this.cam;
    const screenChanged = screen !== this.screen;
    this.cam = cam;
    this.screen = screen;
    if (!camChanged && !screenChanged) return;
    for (const peer of this.peers.values()) {
      // fast path: same stream objects but replaced tracks
      this.attachLocal(peer);
    }
  }

  /** Swap a track (e.g. device change) without renegotiation. */
  async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null) {
    for (const peer of this.peers.values()) {
      for (const s of peer.senders) {
        if (s.track?.kind === kind && this.cam?.getTracks().includes(s.track)) await s.replaceTrack(track);
      }
    }
  }

  drop(peerId: string) {
    const p = this.peers.get(peerId);
    if (!p) return;
    p.pc.close();
    this.peers.delete(peerId);
    this.onPeerGone?.(peerId);
  }

  peerIds() {
    return [...this.peers.keys()];
  }

  close() {
    this.socket.off('rtc:signal', this.onSignal);
    for (const id of [...this.peers.keys()]) this.drop(id);
  }
}
