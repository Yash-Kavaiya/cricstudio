// Pub/sub + distributed lock abstraction.
// InMemoryBus for a single node; RedisBus lets many server instances share one ESPN poller per match.

export type Handler = (msg: any) => void;

export interface Bus {
  publish(channel: string, msg: unknown): Promise<void>;
  subscribe(channel: string, handler: Handler): () => void;
  /** Acquire/renew a lock owned by this node. */
  tryLock(key: string, ttlMs: number): Promise<boolean>;
  /** Drop a lock this node owns (no-op if another node holds it). */
  release(key: string): Promise<void>;
  close(): Promise<void>;
}

export class InMemoryBus implements Bus {
  private handlers = new Map<string, Set<Handler>>();

  async publish(channel: string, msg: unknown) {
    for (const h of this.handlers.get(channel) ?? []) {
      try {
        h(msg);
      } catch (e) {
        console.error('[bus] handler error', e);
      }
    }
  }

  subscribe(channel: string, handler: Handler) {
    let set = this.handlers.get(channel);
    if (!set) this.handlers.set(channel, (set = new Set()));
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (!set!.size) this.handlers.delete(channel);
    };
  }

  async tryLock() {
    return true;
  }

  async release() {}

  async close() {
    this.handlers.clear();
  }
}

export async function createRedisBus(url: string): Promise<Bus> {
  const { default: Redis } = await import('ioredis');
  const pub = new Redis(url);
  const sub = new Redis(url);
  const nodeId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const local = new InMemoryBus();
  const subscribed = new Set<string>();

  sub.on('message', (channel: string, raw: string) => {
    try {
      void local.publish(channel, JSON.parse(raw));
    } catch {
      /* ignore */
    }
  });

  return {
    async publish(channel, msg) {
      await pub.publish(channel, JSON.stringify(msg));
    },
    subscribe(channel, handler) {
      if (!subscribed.has(channel)) {
        subscribed.add(channel);
        void sub.subscribe(channel);
      }
      return local.subscribe(channel, handler);
    },
    async tryLock(key, ttlMs) {
      const got = await pub.set(key, nodeId, 'PX', ttlMs, 'NX');
      if (got === 'OK') return true;
      const owner = await pub.get(key);
      if (owner === nodeId) {
        await pub.pexpire(key, ttlMs);
        return true;
      }
      return false;
    },
    async release(key) {
      // compare-and-delete so we never drop a lock another node has since taken
      await pub.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, nodeId);
    },
    async close() {
      pub.disconnect();
      sub.disconnect();
    },
  };
}
