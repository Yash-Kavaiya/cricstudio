// Black-box session against a running server; writes a normalised transcript for comparison.
// Usage: node rust/golden/e2e.mjs <baseUrl> <transcript.json> [rtmpPort]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';

const [base, outFile, rtmpPort = '19350'] = process.argv.slice(2);
const log = [];
const sids = new Map();
const VOLATILE = new Set(['id', 'selfId', 'ts', 'joinedAt', 'startedAt', 'until', 'since', 'pinnedUntil', 'lastUpdated', 'hostToken', 'guestToken', 'programToken', 'transition', 'variant', 'seq', 'uptime', 'keyMasked_', 'startDate_', 'bitrateKbps', 'fps', 'speed']);
const KEEP_ID = new Set(['ball', 'batsman', 'nonStriker', 'bowler', 'currentBowler', 'currentBatters', 'batting', 'bowling', 'teams', 'squad', 'recentBalls', 'match', 'innings']);

function norm(v, parent = '') {
  if (typeof v === 'string') return sids.get(v) ?? v.replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT');
  if (Array.isArray(v)) return v.map((x) => norm(x, parent));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined) continue;
    if (VOLATILE.has(k) && !(k === 'id' && KEEP_ID.has(parent))) out[k] = '*';
    else out[sids.get(k) ?? k] = norm(v[k], k);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
const rec = (name, value) => log.push({ name, value: norm(value) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(name, method, path, { body, headers = {}, raw } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  if (raw) init.body = raw;
  const res = await fetch(base + path, init);
  const type = res.headers.get('content-type') ?? '';
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  rec(`http ${name}`, { status: res.status, json: json ?? (type.startsWith('text/html') ? '<html>' : text.slice(0, 80)) });
  return json;
}

function client(label) {
  const s = io(base, { transports: ['websocket'], reconnection: false });
  s.events = [];
  for (const ev of ['peer:joined', 'peer:left', 'chat:msg', 'chat:history', 'captions:text', 'studio:kicked', 'studio:replaced', 'rtc:signal', 'participant:muteRequest', 'match:events']) {
    s.on(ev, (d) => s.events.push({ ev, d }));
  }
  s.on('match:update', (m) => (s.match = m));
  s.on('studio:state', (st) => (s.state = st));
  s.label = label;
  return new Promise((resolve, reject) => {
    s.once('connect', () => {
      sids.set(s.id, `<${label}>`);
      resolve(s);
    });
    s.once('connect_error', reject);
  });
}
const call = async (s, name, ev, data) => {
  const r = await s.timeout(8000).emitWithAck(ev, data);
  rec(`${s.label} ${name}`, r);
  return r;
};
const drain = (s, name) => {
  // different clients race each other, so only the set of events is part of the contract
  const seen = s.events.map((e) => norm({ ev: e.ev, d: e.d ?? undefined })) /* no-payload events: Rust sends null, handlers ignore it */.map((e) => JSON.stringify(e)).sort();
  rec(`${s.label} events ${name}`, seen);
  s.events = [];
};
const stateView = (st) => {
  const { participants, ...rest } = st;
  return { ...rest, participants: participants.map((p) => ({ ...p })) };
};

/* ---------------- HTTP ---------------- */

const h = await fetch(`${base}/api/health`).then((r) => r.json());
rec('health keys', Object.keys(h).sort());
await http('unknown api', 'GET', '/api/nope');
await http('post unknown', 'POST', '/nope');
await http('tts no text', 'GET', '/api/tts');
await http('studio 404', 'GET', '/api/studios/nope');
await http('demo detail', 'GET', '/api/matches/demo/replay');
const created = await http('create', 'POST', '/api/studios', { body: { name: '  E2E Show  ', matchKey: 'demo:replay' } });
const defaults = await http('create default name', 'POST', '/api/studios', { body: {} });
await http('create long name', 'POST', '/api/studios', { body: { name: 'x'.repeat(200) } });
const id = created.id;
sids.set(id, '<studio>');
sids.set(defaults.id, '<studio2>');
const auth = { 'x-host-token': created.hostToken };
await http('get', 'GET', `/api/studios/${id}`);
await http('invite no token', 'GET', `/api/studios/${id}/invite`);
await http('invite bad token', 'GET', `/api/studios/${id}/invite`, { headers: { 'x-host-token': 'bad' } });
const inv = await fetch(`${base}/api/studios/${id}/invite`, { headers: auth }).then((r) => r.json());
rec('invite matches', inv.guestToken === created.guestToken);
await http('dest list empty', 'GET', `/api/studios/${id}/destinations`, { headers: auth });
await http('dest bad platform', 'POST', `/api/studios/${id}/destinations`, { headers: auth, body: { platform: 'tiktok', key: 'k' } });
await http('dest bad url', 'POST', `/api/studios/${id}/destinations`, { headers: auth, body: { platform: 'custom', url: 'http://x', key: 'k' } });
await http('dest no key', 'POST', `/api/studios/${id}/destinations`, { headers: auth, body: { platform: 'youtube' } });
const d1 = await http('dest add', 'POST', `/api/studios/${id}/destinations`, { headers: auth, body: { platform: 'youtube', key: 'abcd1234efgh' } });
sids.set(d1.destination.id, '<dest1>');
await http('dest patch bad url', 'PATCH', `/api/studios/${id}/destinations/${d1.destination.id}`, { headers: auth, body: { url: 'ftp://x' } });
await http('dest patch', 'PATCH', `/api/studios/${id}/destinations/${d1.destination.id}`, { headers: auth, body: { name: 'Main', enabled: false, key: 'newkey123456' } });
await http('dest list', 'GET', `/api/studios/${id}/destinations`, { headers: auth });
await http('dest delete', 'DELETE', `/api/studios/${id}/destinations/${d1.destination.id}`, { headers: auth });
await http('dest list after', 'GET', `/api/studios/${id}/destinations`, { headers: auth });
await http('stt put', 'PUT', `/api/studios/${id}/stt`, { headers: auth, body: { language: 'hi-IN', provider: 'gemini', geminiModel: 'gemini-2.5-pro', keys: { gemini: 'secret-key' } } });
await http('stt put bad', 'PUT', `/api/studios/${id}/stt`, { headers: auth, body: { language: 'not a lang!', provider: 'nope', keys: { gemini: null } } });
await http('stt test unknown', 'POST', `/api/studios/${id}/stt/test`, { headers: auth, body: { provider: 'zzz' } });
await http('stt test no key', 'POST', `/api/studios/${id}/stt/test`, { headers: auth, body: { provider: 'google' } });
const form = new FormData();
form.append('file', new Blob([new Uint8Array(2048).fill(7)], { type: 'audio/mpeg' }), 'My Song.mp3');
const up = await fetch(`${base}/api/studios/${id}/music`, { method: 'POST', headers: auth, body: form });
const upJson = await up.json();
rec('upload', { status: up.status, title: upJson.title, url: /^\/uploads\/[^/]+-[a-z0-9]+\.mp3$/.test(upJson.url) });
const got = await fetch(base + upJson.url);
rec('upload fetch', { status: got.status, size: (await got.arrayBuffer()).byteLength });
const bad = new FormData();
bad.append('file', new Blob(['x']), 'evil.exe');
const upBad = await fetch(`${base}/api/studios/${id}/music`, { method: 'POST', headers: auth, body: bad });
rec('upload bad ext', { status: upBad.status, json: await upBad.json() });
await http('upload traversal', 'GET', '/uploads/..%2f..%2fsecret.key');
await http('upload missing', 'GET', '/uploads/nothing.mp3');

/* ---------------- sockets ---------------- */

const host = await client('host');
const guestToken = created.guestToken.split('.')[1];
await call(host, 'scene before join', 'studio:scene', { scene: 'panel' });
await call(host, 'join bad studio', 'studio:join', { studioId: 'nope', token: 'x', name: 'H', role: 'host' });
await call(host, 'join bad token', 'studio:join', { studioId: id, token: 'wrong', name: 'H', role: 'host' });
const hj = await host.timeout(8000).emitWithAck('studio:join', { studioId: id, token: created.hostToken, name: 'Host Person', role: 'host' });
rec('host join', { ok: hj.ok, mediaMode: hj.mediaMode, ice: hj.iceServers, state: stateView(hj.state) });
await sleep(300);
rec('demo match on join', host.match ?? null);

const guests = [];
for (let i = 1; i <= 4; i++) {
  const g = await client(`guest${i}`);
  await call(g, 'join', 'studio:join', { studioId: id, token: guestToken, name: `Guest ${i}`, role: 'guest' }).then(() => {});
  log.at(-1).value = { ok: log.at(-1).value.ok, selfId: log.at(-1).value.selfId };
  guests.push(g);
}
const fifth = await client('guest5');
await call(fifth, 'join full', 'studio:join', { studioId: id, token: guestToken, name: 'Too many', role: 'guest' });
fifth.close();
await sleep(150);
drain(host, 'after guests');

await call(guests[0], 'scene as guest', 'studio:scene', { scene: 'panel' });
await call(host, 'scene unknown', 'studio:scene', { scene: 'nope' });
await call(host, 'scene', 'studio:scene', { scene: 'scoreHero' });
await sleep(60);
rec('scene state', { scene: host.state.scene, base: host.state.baseScene, until: host.state.sceneUntil });

await call(host, 'patch brand', 'studio:patch', { brand: { background: 'nope', transition: 'glitch', fontPair: 'barlow', title: 'New', sponsors: ['  A ', '', 'B'], camBubbleSize: 999, camBubbleCorner: 'zz', camBubbleShape: 'oval', camBubbleSlots: { a: { x: 5, y: 6, shape: 'wide' } } } });
await call(host, 'patch rules', 'studio:patch', { rules: { wicket: false }, automation: 'assist' });
await call(host, 'patch bad automation', 'studio:patch', { automation: 'chaos' });
await call(host, 'patch music', 'studio:patch', { music: { volume: 0.5, track: 'chill-pitch' } });
await call(host, 'patch misc', 'studio:patch', { name: '  Renamed  ', spotlightId: guests[0].id, countdownTo: 1893456000000, banner: { kind: 'sponsor' } });
await call(host, 'patch banner off', 'studio:patch', { banner: { kind: 'nope' } });
await call(host, 'patch autopilot', 'studio:patch', { autopilot: { sceneSeconds: 1, scoreShare: 9, chatterSeconds: 999, voice: 'bad', writer: 'gemini', voiceEngine: 'x', commentaryLanguage: 'ta-IN', autoMusic: false, autoMatch: false, commentator: false } });
await sleep(60);
rec('patched state', stateView(host.state));
await call(host, 'patch reset', 'studio:patch', { automation: 'auto', rules: { wicket: true }, countdownTo: null, autopilot: { writer: 'templates' } });

await call(host, 'announce empty', 'studio:announce', { title: ' ', text: '' });
await call(host, 'announce', 'studio:announce', { title: 'Rain', text: 'Covers on', show: true });
await sleep(60);
rec('announce state', { scene: host.state.scene, a: host.state.announcement });
await call(host, 'announce clear', 'studio:announce', null);
await call(host, 'back to panel', 'studio:scene', { scene: 'panel' });
await call(host, 'overlay', 'studio:overlay', { id: 'custom', title: 'Hello', subtitle: 'World', ms: 90000, sfx: 'whoosh' });
await sleep(60);
const ov = host.state.overlay;
rec('overlay state', { ...ov, dur: ov.until - ov.startedAt });
await call(host, 'overlay clear', 'studio:overlay', null);

await call(host, 'stage guest', 'studio:stage', { participantId: guests[0].id, onStage: true });
await call(host, 'stage unknown', 'studio:stage', { participantId: 'ghost', onStage: true });
await call(guests[0], 'bubble self', 'studio:bubble', { participantId: guests[0].id, patch: { x: 100, y: 200, shape: 'stumps' } });
await call(guests[1], 'bubble other', 'studio:bubble', { participantId: guests[0].id, patch: { x: 1, y: 1 } });
await call(host, 'bubble ghost', 'studio:bubble', { participantId: 'ghost', patch: { x: 1, y: 1 } });
await call(host, 'bubble any', 'studio:bubble', { participantId: guests[1].id, patch: { x: 99999, y: -99999 } });
await sleep(60);
rec('bubble slots', host.state.brand.camBubbleSlots);

guests[0].emit('participant:update', { muted: true, camOff: true, name: '  New Name  ' });
guests[0].emit('chat:send', { text: `  hello ${'x'.repeat(600)}` });
guests[0].emit('chat:send', { text: '   ' });
guests[1].emit('captions:text', { text: 'caption line', final: true });
guests[1].emit('rtc:signal', { to: guests[2].id, data: { sdp: 'offer' } });
guests[1].emit('rtc:signal', { to: 'ghost', data: 1 });
host.emit('participant:muteRequest', { participantId: guests[3].id });
await sleep(250);
rec('participant after update', host.state.participants.find((p) => p.id === guests[0].id));
drain(host, 'chat');
drain(guests[2], 'signal');
drain(guests[3], 'mute');

const stepped = await call(host, 'demo step', 'demo:step', { n: 7 });
await sleep(200);
rec('demo after step', host.match ?? null);
rec('demo events', (host.events.filter((e) => e.ev === 'match:events').flatMap((e) => e.d)).map((e) => ({ ...e })));
host.events = [];
void stepped;

for (const type of ['FOUR', 'SIX', 'WICKET', 'MILESTONE_BAT', 'MILESTONE_BOWL', 'PARTNERSHIP', 'HATTRICK_WATCH', 'OVER_END', 'INNINGS_END', 'MATCH_END', 'NOPE']) {
  await call(host, `simulate ${type}`, 'dev:simulate', { type });
}
await sleep(100);
host.events = [];

await call(host, 'stt save', 'stt:save', { language: 'en-GB', keys: { google: 'gkey' } });
await call(host, 'stt test bad', 'stt:test', { provider: 'zzz' });
const commentaryTest = await host.timeout(8000).emitWithAck('commentary:test', {});
rec('commentary test', { ok: commentaryTest.ok, ai: commentaryTest.ai, text: commentaryTest.text, voiceError: commentaryTest.voiceError ?? null });
await call(host, 'tts unknown line', 'commentary:tts', { id: 'nope' });
await call(host, 'livekit off', 'livekit:token', {});
await call(guests[0], 'stream as guest', 'stream:start', {});
await call(host, 'stream no dest', 'stream:start', { broadcaster: 'host' });

await call(host, 'kick', 'studio:kick', { participantId: guests[3].id });
await sleep(200);
rec('kicked', guests[3].events.some((e) => e.ev === 'studio:kicked') && !guests[3].connected);
guests[2].close();
await sleep(200);
rec('participants after leave', host.state.participants.map((p) => sids.get(p.id) ?? p.id));
drain(host, 'leave');

const host2 = await client('host2');
const h2 = await host2.timeout(8000).emitWithAck('studio:join', { studioId: id, token: created.hostToken, name: 'Host Again', role: 'host' });
rec('host replaced', { ok: h2.ok });
await sleep(250);
rec('replaced old host', { event: host.events.some((e) => e.ev === 'studio:replaced'), connected: host.connected });
rec('hosts after replace', host2.state.participants.filter((p) => p.role === 'host').length);

const prog = await client('program');
await call(prog, 'program wrong', 'studio:join', { studioId: id, token: 'x', name: 'P', role: 'program' });
const pj = await prog.timeout(8000).emitWithAck('studio:join', { studioId: id, token: created.programToken, name: 'P', role: 'program' });
rec('program join', { ok: pj.ok, onStage: pj.state.participants.find((p) => p.role === 'program').onStage });
await call(prog, 'program host action', 'studio:scene', { scene: 'panel' });

/* ---------------- real stream: producer → encoder → relay → RTMP ---------------- */

const dir = mkdtempSync(join(tmpdir(), 'cric-e2e-'));
const flv = join(dir, 'out.flv');
const sink = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-listen', '1', '-timeout', '30', '-f', 'flv', '-i', `rtmp://127.0.0.1:${rtmpPort}/live/streamkey`, '-c', 'copy', flv], { stdio: 'ignore' });
await sleep(700);
await http('stream dest', 'POST', `/api/studios/${id}/destinations`, { headers: { 'x-host-token': created.hostToken }, body: { platform: 'custom', name: 'Local', url: `rtmp://127.0.0.1:${rtmpPort}/live`, key: 'streamkey' } }).then((r) => sids.set(r.destination.id, '<dest2>'));
const started = await call(host2, 'stream start', 'stream:start', { broadcaster: 'host' });
await sleep(200);
await call(host2, 'stream start twice', 'stream:start', { broadcaster: 'host' });
const statuses = new Set();
const destStates = new Set();
host2.on('studio:state', (st) => {
  statuses.add(st.live.state);
  for (const x of st.live.destinations) destStates.add(x.state);
});
host2.emit('ingest:reset', { mime: 'video/webm;codecs=vp8,opus' });
guests[1].emit('ingest:chunk', Buffer.from('not the producer'));
const src = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '7', '-c:v', 'libvpx', '-b:v', '800k', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
let bytes = 0;
src.stdout.on('data', (b) => {
  bytes += b.length;
  host2.emit('ingest:chunk', b);
});
await new Promise((r) => src.on('close', r));
await sleep(1500);
const liveSeen = statuses.has('live');
const relaySeen = destStates.has('live');
await call(host2, 'stream stop', 'stream:stop', {});
await sleep(3500);
sink.kill();
await sleep(600);
const size = existsSync(flv) ? statSync(flv).size : 0;
const probe = await new Promise((resolve) => {
  if (!size) return resolve(null);
  const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', flv]);
  let o = '';
  p.stdout.on('data', (d) => (o += d));
  p.on('close', () => resolve(JSON.parse(o || '{}')));
});
await sleep(100);
rec('stream result', {
  started: started.ok,
  encoderLive: liveSeen,
  relayLive: relaySeen,
  gotOutput: size > 50_000,
  codecs: (probe?.streams ?? []).map((x) => `${x.codec_type}:${x.codec_name}`).sort(),
  atLeast4s: Number(probe?.format?.duration ?? 0) >= 4,
  finalState: host2.state.live.state,
  wantLive: host2.state.wantLive,
});
console.log(`stream: ${bytes} bytes in, ${size} bytes at RTMP sink, duration ${probe?.format?.duration}`);

for (const s of [host2, prog, ...guests]) s.close();
writeFileSync(outFile, JSON.stringify(log, null, 1));
console.log(`${log.length} steps recorded`);
process.exit(0);
