# ---------- build web ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --no-audit --no-fund
RUN npm run build -w @cricstudio/web && npm run build -w @cricstudio/server

# ---------- runtime ----------
FROM node:24-bookworm-slim
# ffmpeg for encoding/relays · chromium + fonts for the 24/7 cloud producer
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium fonts-noto-color-emoji fonts-roboto ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data CHROME_PATH=/usr/bin/chromium
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# plain Node (no TS loader thread) — safest for 24/7
CMD ["node", "apps/server/dist/index.js"]
