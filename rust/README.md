# CricStudio in Rust

The CricStudio server as one native binary. The browser studio is the original app, unchanged.

## Run it

You need Rust, Node (to build the UI once) and FFmpeg on PATH. From the repo root:

```sh
npm ci
npm run build -w @cricstudio/web
cargo build --release --manifest-path rust/Cargo.toml
NODE_ENV=production ./rust/target/release/cricstudio
```

Open http://localhost:8787. Configuration is the same `.env` as the original (see `.env.example`).

Redis, Postgres and LiveKit are not supported; see [DECISIONS.md](DECISIONS.md).

## Layout

- `engine/`: cricket data, event detection, demo replay and other pure logic.
- `app/`: HTTP API, Socket.IO rooms, automation, commentary, stream pipeline, cloud producer.
- `golden/`: recorders and the side-by-side comparison against the Node server.
