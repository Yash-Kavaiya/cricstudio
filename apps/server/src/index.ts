import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { createRedisBus, InMemoryBus, type Bus } from './bus';
import { config } from './config';
import { MatchHub } from './espn/hub';
import { registerHttp } from './http';
import { registerSocket } from './socket';
import { TtsService } from './commentary/tts';
import { createRepo } from './store/repo';
import { StudioManager } from './studio/manager';
import { LiveKitService } from './stream/livekit';

async function main() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 1_000_000 });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 40 * 1024 * 1024, files: 1 } });

  const hasWeb = existsSync(config.webDist);
  await app.register(fastifyStatic, {
    root: hasWeb ? config.webDist : config.dataDir,
    prefix: '/',
    wildcard: false,
    decorateReply: true,
    serve: hasWeb,
  });

  const bus: Bus = config.redisUrl ? await createRedisBus(config.redisUrl) : new InMemoryBus();
  const repo = await createRepo();
  const hub = new MatchHub(bus);
  const livekit = new LiveKitService();

  const io = new Server(app.server, {
    cors: { origin: true },
    maxHttpBufferSize: 16 * 1024 * 1024, // media chunks from the compositor
    pingTimeout: 30_000,
  });
  if (config.redisUrl) {
    const [{ createAdapter }, { default: Redis }] = await Promise.all([import('@socket.io/redis-adapter'), import('ioredis')]);
    const pub = new Redis(config.redisUrl);
    io.adapter(createAdapter(pub, pub.duplicate()));
  }

  const studios = new StudioManager(io, hub, repo, bus);
  registerHttp(app, hub, repo, studios, new TtsService());
  registerSocket(io, studios, hub, livekit);

  // SPA fallback for client-side routes in production builds
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/socket.io')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`CricStudio server on :${config.port} · media=${config.mediaMode} · bus=${config.redisUrl ? 'redis' : 'memory'} · db=${config.databaseUrl ? 'postgres' : config.redisUrl ? 'redis' : 'sqlite'}`);

  // 24/7: resume every studio that was live when the process stopped (deploys, crashes, reboots)
  setTimeout(async () => {
    for (const id of await repo.listLiveStudios().catch(() => [])) {
      const room = await studios.load(id);
      if (!room || room.isLive || !room.state.wantLive) continue;
      const broadcaster = room.state.autopilot.cloud ? 'cloud' : 'host';
      if (broadcaster === 'host') continue; // a human producer must come back and press Go live
      const res = await room.startLive('cloud');
      app.log.info(`[resume] studio ${id} → ${res.ok ? 'live (cloud producer)' : res.error}`);
    }
  }, 3000);

  const shutdown = async () => {
    // release live studios first so another instance can resume them within seconds
    await studios.suspendAll();
    io.close();
    await app.close();
    await repo.close();
    await bus.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
