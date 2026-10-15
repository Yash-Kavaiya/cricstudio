import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.API_URL ?? 'http://localhost:8787';

/** Self-host the MediaPipe wasm runtime (background blur) at /mediapipe/* — no CDN at runtime. */
function mediapipeWasm(): Plugin {
  const dir = join(dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision')), 'wasm');
  const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe', (req, res, next) => {
        const f = files.find((n) => req.url === `/${n}`);
        if (!f) return next();
        res.setHeader('Content-Type', f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(join(dir, f)).pipe(res);
      });
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: 'asset', fileName: `mediapipe/${f}`, source: readFileSync(join(dir, f)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), mediapipeWasm()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5180),
    strictPort: true,
    host: true,
    proxy: {
      '/api': target,
      '/uploads': target,
      '/socket.io': { target, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
