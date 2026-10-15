import type { Server } from 'socket.io';
import type { MatchHub } from '../espn/hub';
import type { Repo } from '../store/repo';
import { StudioRoom } from './room';

/** Lazily loads studios into memory while anyone is connected; unloads idle ones. */
export class StudioManager {
  private rooms = new Map<string, StudioRoom>();
  private loading = new Map<string, Promise<StudioRoom | null>>();

  constructor(
    private readonly io: Server,
    private readonly hub: MatchHub,
    readonly repo: Repo,
  ) {}

  get(id: string): StudioRoom | undefined {
    return this.rooms.get(id);
  }

  async load(id: string): Promise<StudioRoom | null> {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    let p = this.loading.get(id);
    if (!p) {
      p = this.repo.getStudio(id).then((rec) => {
        if (!rec) return null;
        const room = new StudioRoom(rec, this.io, this.hub, this.repo);
        this.rooms.set(id, room);
        return room;
      });
      this.loading.set(id, p);
      p.finally(() => this.loading.delete(id));
    }
    return p;
  }

  maybeUnload(id: string) {
    const room = this.rooms.get(id);
    if (!room) return;
    if (room.state.participants.length === 0 && !room.keepAlive) {
      room.dispose();
      this.rooms.delete(id);
    }
  }

  stats() {
    return [...this.rooms.values()].map((r) => ({
      id: r.state.id,
      participants: r.state.participants.length,
      live: r.state.live.state,
      broadcaster: r.state.live.broadcaster,
      producer: r.cloud?.health ?? null,
      producerRestarts: r.cloud?.restarts ?? 0,
      reconnects: r.state.live.reconnects ?? 0,
      destinations: r.state.live.destinations.map((d) => ({ name: d.name, state: d.state, retries: d.retries ?? 0, error: d.error })),
      match: r.state.matchKey,
    }));
  }
}
