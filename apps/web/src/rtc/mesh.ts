import type { Socket } from 'socket.io-client';
import type { RTCIceServerLike } from '@cricstudio/shared';

export interface RemoteMedia {
  cam: MediaStream | null;
  screen: MediaStream | null;
}

type Signal =
  | { type: 'description'; description: RTCSessionDescriptionInit; streams?: Record<string, 'cam' | 'screen'> }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'hello' }
  | { type: 'reset' };

/** One sender per published source. Mute swaps the track; it does not remove the sender. */
type Role = 'mic' | 'cam' | 'screen';

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteKinds: Record<string, 'cam' | 'screen'>;
  media: RemoteMedia;
  roles: Map<Role, RTCRtpSender>;
  heal: ReturnType<typeof setTimeout> | null;
  healAttempts: number;
}

const HEAL_LIMIT = 6;

/**
 * Full-mesh WebRTC with "perfect negotiation" (≤ 5 speakers + optional receive-only program peers).
 * Each peer gets our camera stream and (optionally) a screen stream; we label streams so the
 * remote side knows which is which.
 *
 * Mic and camera mute replace the outbound track (silence / black) instead of disabling it.
 * Disabling a live sender makes Chrome stop RTP, and the peer connection often stays disconnected
 * after unmute. ICE restarts, then a one-shot connection rebuild, recover a link that still drops.
 */
export class MeshRTC {
  private peers = new Map<string, Peer>();
  private cam: MediaStream | null = null;
  private screen: MediaStream | null = null;
  /** Tracks that temporarily replace the mic or camera without a renegotiation. */
  private hold = new Map<'audio' | 'video', MediaStreamTrack>();
  private chain: Promise<void> = Promise.resolve();
  private resetting = new Set<string>();
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
    if (data.type === 'reset') {
      if (this.resetting.has(from)) return;
      this.acceptReset(from);
      return;
    }
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

  private run(fn: () => void | Promise<void>) {
    this.chain = this.chain.then(fn).catch((e) => console.warn('[mesh]', e));
    return this.chain;
  }

  private streamKinds(): Record<string, 'cam' | 'screen'> {
    const k: Record<string, 'cam' | 'screen'> = {};
    if (this.cam) k[this.cam.id] = 'cam';
    if (this.screen) k[this.screen.id] = 'screen';
    return k;
  }

  private wanted(): { role: Role; track: MediaStreamTrack; stream: MediaStream }[] {
    const out: { role: Role; track: MediaStreamTrack; stream: MediaStream }[] = [];
    if (this.cam) {
      const mic = this.hold.get('audio') ?? this.cam.getAudioTracks()[0];
      const vid = this.hold.get('video') ?? this.cam.getVideoTracks()[0];
      if (mic) out.push({ role: 'mic', track: mic, stream: this.cam });
      if (vid) out.push({ role: 'cam', track: vid, stream: this.cam });
    }
    if (this.screen) {
      const scr = this.screen.getVideoTracks()[0];
      if (scr) out.push({ role: 'screen', track: scr, stream: this.screen });
    }
    return out;
  }

  /** Add a sender once. Later track swaps use replaceTrack so mute does not renegotiate. */
  private async applySenders(peer: Peer) {
    if (!this.sendMedia || peer.pc.connectionState === 'closed') return;
    const keep = new Set<Role>();
    for (const w of this.wanted()) {
      keep.add(w.role);
      const sender = peer.roles.get(w.role);
      if (!sender) {
        try {
          peer.roles.set(w.role, peer.pc.addTrack(w.track, w.stream));
        } catch (e) {
          console.warn('[mesh] addTrack', e);
        }
      } else if (sender.track !== w.track) {
        await sender.replaceTrack(w.track).catch((e) => console.warn('[mesh] replaceTrack', e));
      }
    }
    for (const [role, sender] of [...peer.roles]) {
      if (keep.has(role)) continue;
      try {
        peer.pc.removeTrack(sender);
      } catch {
        /* closed */
      }
      peer.roles.delete(role);
    }
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
      roles: new Map(),
      heal: null,
      healAttempts: 0,
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
      // mute/unmute does not change the stream object; listeners still need a fresh play().
      track.onunmute = emit;
      track.onmute = emit;
      track.onended = () => {
        if (peer.media.screen === stream && stream.getVideoTracks().every((t) => t.readyState === 'ended')) peer.media.screen = null;
        if (peer.media.cam === stream && stream.getTracks().every((t) => t.readyState === 'ended')) peer.media.cam = null;
        emit();
      };
      stream.onremovetrack = () => {
        if (kind === 'screen' && !stream.getTracks().length) peer.media.screen = null;
        emit();
      };
      emit();
    };
    const onLink = () => {
      this.onState?.(peerId, pc.connectionState);
      this.scheduleHeal(peerId, peer);
    };
    pc.onconnectionstatechange = onLink;
    pc.oniceconnectionstatechange = onLink;
    if (!this.sendMedia && initiator) {
      // receive-only initiator: ask for audio+video. When the remote side initiates, its offer
      // already carries its tracks — adding transceivers here would cause glare + inactive m-lines.
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    this.applySenders(peer);
    return peer;
  }

  private linkDown(pc: RTCPeerConnection) {
    return (
      pc.connectionState === 'disconnected' ||
      pc.connectionState === 'failed' ||
      pc.iceConnectionState === 'disconnected' ||
      pc.iceConnectionState === 'failed'
    );
  }

  /** ICE restart first. If the link stays down, both sides build a fresh connection once. */
  private scheduleHeal(peerId: string, peer: Peer) {
    const pc = peer.pc;
    if (pc.connectionState === 'closed') return;
    if (!this.linkDown(pc)) {
      if (peer.heal) clearTimeout(peer.heal);
      peer.heal = null;
      if (pc.connectionState === 'connected') peer.healAttempts = 0;
      return;
    }
    if (peer.heal) return;
    const failed = pc.connectionState === 'failed' || pc.iceConnectionState === 'failed';
    peer.heal = setTimeout(() => {
      peer.heal = null;
      const cur = this.peers.get(peerId);
      if (!cur || cur.pc !== pc || pc.connectionState === 'closed' || !this.linkDown(pc)) return;
      peer.healAttempts += 1;
      if (peer.healAttempts > HEAL_LIMIT) return;
      if (peer.healAttempts < 3) {
        try {
          pc.restartIce();
        } catch (e) {
          console.warn('[mesh] ice restart failed', e);
        }
        // restartIce does not always emit a new state, so arm the next attempt here.
        this.scheduleHeal(peerId, peer);
        return;
      }
      this.resetPeer(peerId);
    }, failed ? 400 : 2000);
  }

  /** Ask the other side to drop this peer connection, then dial again. */
  private resetPeer(peerId: string) {
    if (this.resetting.has(peerId)) return;
    this.resetting.add(peerId);
    window.setTimeout(() => this.resetting.delete(peerId), 8000);
    const old = this.peers.get(peerId);
    if (old?.heal) clearTimeout(old.heal);
    old?.pc.close();
    this.peers.delete(peerId);
    this.send(peerId, { type: 'reset' });
    const next = this.connect(peerId, true);
    next.healAttempts = Math.min(HEAL_LIMIT, (old?.healAttempts ?? 3));
    console.warn(`[mesh] rebuilding connection with ${peerId}`);
  }

  private acceptReset(peerId: string) {
    this.resetting.add(peerId);
    window.setTimeout(() => this.resetting.delete(peerId), 8000);
    const old = this.peers.get(peerId);
    if (old?.heal) clearTimeout(old.heal);
    old?.pc.close();
    this.peers.delete(peerId);
    this.connect(peerId, false);
  }

  /** Called when camera/mic or screen changes. Existing senders are retargeted, not removed. */
  setLocal(cam: MediaStream | null, screen: MediaStream | null) {
    this.cam = cam;
    this.screen = screen;
    this.run(async () => {
      for (const peer of this.peers.values()) await this.applySenders(peer);
    });
  }

  /**
   * Swap the published mic or camera without renegotiation.
   * Passing the track that is already on the local stream clears a mute hold.
   */
  replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack) {
    const current = this.cam?.getTracks().find((t) => t.kind === kind);
    if (current === track) this.hold.delete(kind);
    else this.hold.set(kind, track);
    return this.run(async () => {
      for (const peer of this.peers.values()) await this.applySenders(peer);
    });
  }

  drop(peerId: string) {
    const p = this.peers.get(peerId);
    if (!p) return;
    if (p.heal) clearTimeout(p.heal);
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
    this.hold.clear();
  }
}
