# CricStudio Rust port: decisions

These were made without an interview because the goal asked for no pauses. Each is open to review.

## ADR-001: Port the server, keep the browser app
Status: accepted (2026-11-24)
Context: rust-anything's analysis marks the React UI as code to keep. Cameras, WebRTC, MediaRecorder, canvas and WebGL are browser APIs.
Decision: Everything in `apps/server`, `packages/cricket-engine` and the server's use of `packages/shared` is Rust. `apps/web` stays TypeScript, unchanged, and the Rust binary serves its build.
Consequences: Node is needed to build the UI, but not to run the server.

## ADR-002: Stack
Status: accepted (2026-11-24)
Decision: axum and tokio for HTTP, socketioxide for Socket.IO, rusqlite for storage, tokio-tungstenite for Edge TTS, FFmpeg as a child process.
Consequences: The browser's `socket.io-client` works without changes.

## ADR-003: Equivalence bar
Status: accepted (2026-11-24)
Decision: Engine output must match the original byte for byte, except event key order, which varies by event type in the original and is compared sorted. Server behaviour must match in a scripted HTTP and Socket.IO session against both servers.
Consequences: See "Known differences".

## ADR-004: Compatibility
Status: accepted (2026-11-24)
Decision: Keep the environment variables, routes, status codes, socket events, SQLite schema and stream-key encryption.
Consequences: An existing `data/` directory should open as-is. Decryption of Node-written ciphertext is covered by a test.

## ADR-005: Single-instance deployments only
Status: accepted (2026-11-24)
Context: Redis, Postgres and LiveKit are optional and could not be exercised here.
Decision: Not ported. The server exits with a clear message if `REDIS_URL`, `KV_URL`, `DATABASE_URL` or `MEDIA_MODE=livekit` is set, rather than ignoring them.
Consequences: Multi-instance and LiveKit deployments stay on the Node server.

## ADR-006: Cloud producer launches Chrome directly
Status: accepted (2026-11-24)
Decision: Replace Puppeteer with a supervised `chrome --headless=new <url>`. The watchdog uses the page's socket heartbeats.
Consequences: The producer page's console errors no longer reach the stream log.

## Known differences
- Events without a payload arrive with `null` instead of no argument. The browser's handlers ignore it.
- An HTML entity for a lone surrogate code point stays as literal text.
- Google's free translation endpoint (unofficial, no key) returned HTTP 429 to the Rust client in later test runs while still answering Node. Template commentary in non-English languages then falls back to English. The client was deliberately not disguised to avoid this.
- ESPN date parsing covers the ISO-8601 forms ESPN sends, not everything `Date.parse` accepts.

## Verifying
From the repo root:

```sh
npx tsx rust/golden/record.ts            # re-record the original engine (set DATA_DIR to a temp folder)
cargo test --manifest-path rust/Cargo.toml --workspace
cargo build --release --manifest-path rust/Cargo.toml
bash rust/golden/run-e2e.sh release      # same session against Node and Rust, then compare
```
