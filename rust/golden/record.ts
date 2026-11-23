// Records what the original TypeScript engine does, so the Rust port can be held to it.
// Run from the repo root:  DATA_DIR=<tmp> npx tsx rust/golden/record.ts
// Writes rust/engine/tests/golden/{manifest.json,pure.jsonl}. GOLDEN_DUMP=<dir> also writes each full output.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  EventDetector,
  ballLabel,
  ballsToOvers,
  buildMatchDetail,
  buildOverSummaries,
  cleanDismissal,
  decodeEntities,
  normalizeBalls,
  normalizeScorepanel,
  oversToBalls,
  stripHtml,
} from '../../packages/cricket-engine/src/index';
import { applyBubblePatch, canEditBubble, sanitizeBubbleFields } from '../../packages/shared/src/bubbles';
import type { Ball, MatchDetail } from '../../packages/shared/src/index';
import { DemoReplay } from '../../apps/server/src/espn/demo';
import { speakable } from '../../apps/server/src/commentary/tts';
import { eventFacts, matchFacts } from '../../apps/server/src/commentary/ai';
import { targetCode } from '../../apps/server/src/commentary/translate';
import { cricketHints, silentWav } from '../../apps/server/src/stt/providers';
import { encoderArgs, preferVideoCopy, relayArgs, rtmpUrl } from '../../apps/server/src/stream/pipeline';

const root = resolve(import.meta.dirname, '..', '..');
const fixtures = join(root, 'packages', 'cricket-engine', 'test', 'fixtures');
const outDir = join(root, 'rust', 'engine', 'tests', 'golden');
const dump = process.env.GOLDEN_DUMP;
mkdirSync(outDir, { recursive: true });
if (dump) mkdirSync(dump, { recursive: true });

const fx = (n: string) => JSON.parse(readFileSync(join(fixtures, n), 'utf8'));
const manifest: Record<string, string> = {};
const rec = (name: string, value: unknown) => {
  const s = JSON.stringify(value);
  manifest[name] = createHash('sha256').update(s).digest('hex');
  if (dump) writeFileSync(join(dump, `${name}.json`), s);
};

/** key order of events varies by type in the original and is not part of the contract */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;

const pages = Array.from({ length: 8 }, (_, i) => fx(`pbp${i + 1}.json`));
const all: Ball[] = pages.flatMap((p) => normalizeBalls(p)).sort((a, b) => a.seq - b.seq);
const summary = fx('summary.json');
const still = <T extends MatchDetail>(d: T): T => ({ ...d, lastUpdated: 0 });

rec('scorepanel', normalizeScorepanel(fx('scorepanel.json')));
pages.forEach((p, i) => rec(`balls_page${i + 1}`, normalizeBalls(p)));
rec('balls_all', all);
for (const inn of [1, 2, 3]) rec(`overs_innings${inn}`, buildOverSummaries(all, inn));
rec('detail_full', still(buildMatchDetail({ leagueId: '24289', eventId: '1529233', summary, balls: all })));
rec('detail_no_balls', still(buildMatchDetail({ leagueId: 'l', eventId: 'e', summary, balls: [] })));
rec('detail_empty_summary', still(buildMatchDetail({ leagueId: 'l', eventId: 'e', summary: {}, balls: all })));
for (let n = 5; n < all.length; n += 13) rec(`detail_prefix_${n}`, still(buildMatchDetail({ leagueId: 'l', eventId: 'e', summary, balls: all.slice(0, n) })));

for (const chunk of [1, 7, 40]) {
  const det = new EventDetector('24289:1529233');
  det.process(all.slice(0, 10), 'in', 1000);
  const out: unknown[] = [];
  for (let n = 10 + chunk; ; n += chunk) {
    out.push(det.process(all.slice(0, Math.min(n, all.length)), 'in', 1000));
    if (n >= all.length) break;
  }
  out.push(det.process(all, 'post', 2000));
  out.push(det.process(all, 'post', 3000));
  rec(`events_chunk${chunk}`, canon(out));
}

const demo = new DemoReplay(0);
const total = demo.total;
manifest.demo_total = String(total);
for (let c = 0; c <= total; c++) {
  demo.cursor = c;
  rec(`demo_detail_${c}`, still(demo.detail()));
  if (c % 25 === 0) rec(`demo_item_${c}`, { ...demo.listItem(), startDate: '' });
}

const demoDetail = (() => {
  const d = new DemoReplay(150);
  return still(d.detail());
})();
const fullDetail = still(buildMatchDetail({ leagueId: '24289', eventId: '1529233', summary, balls: all }));
rec('facts_full', matchFacts(fullDetail));
rec('facts_demo', matchFacts(demoDetail));
rec('facts_none', matchFacts(null));
rec('hints_full', cricketHints(fullDetail));
rec('hints_none', cricketHints(null));
const sampleBalls = [all[0], all[50], all.find((b) => b.isWicket)!, all.at(-1)!];
rec('event_facts', sampleBalls.map((ball) => eventFacts({ type: 'FOUR', matchKey: 'k', ball, title: 'FOUR!', subtitle: ball.short, player: ball.batsman?.name, value: 4, ts: 1 }, fullDetail)));
rec('event_facts_quiet', [eventFacts(null, fullDetail), eventFacts(null, { ...fullDetail, state: 'pre' }), eventFacts(null, null)]);
rec('silent_wav', Buffer.from(silentWav()).toString('base64'));

/* ---------- small pure functions: inputs and outputs kept in the clear ---------- */

const TRAPS = [
  '', ' ', 'plain', 'c †Samson b Singh', 'c &dagger;Samson b Singh', '&amp;&lt;b&gt;', '&#65;&#x42;&#X43;', '&#0;&#1114112;&#xFFFFFFFFF;',
  '&unknown; &AMP; &Dagger;', '<b>bold</b> text<br/>next<BR >line', 'a<br>b', '<', '>', 'x < y > z', '  many\t\tspaces\n\nhere  ',
  'nbsp here', 'feff﻿here', 'nel\u0085here', 'emoji 🏏 done', 'हिंदी कमेंट्री', 'İstanbul ıi', 'KKelvin', '&hellip;&ndash;&mdash;&bull;&middot;&times;',
  '&lsquo;a&rsquo; &ldquo;b&rdquo;', 'J Andrew lbw b Patel 21 (23m 16b 2x4 1x6) SR: 131.25', 'SV Samson c Hope b Motie 56 (30m 23b 3x4 5x6) SR: 243.47',
  'Ishan Kishan run out (Powell) 6 (5m 3b) SR: 200', 'X c & b Y 10 (5b)', 'A hit wicket b B 3 (2b)', 'retired hurt 12 (9b)', 'not out', 'Abc st †Keeper b Spin 4 (3b)',
  'obstructing the field', 'handled the ball', 'timed out', 'éc x', 'abc lbw', 'b ', 'c ', 'b x', 'line one 5 (2b)\nline two', 'What & why', 'c & b Kumar', 'C & B Kumar', '*not out*', '<excited>',
];

const lines: string[] = [];
const pure = (fn: string, args: unknown[], result: unknown) => lines.push(JSON.stringify({ fn, args, result }));
for (const t of TRAPS) {
  pure('decodeEntities', [t], decodeEntities(t));
  pure('stripHtml', [t], stripHtml(t));
  pure('cleanDismissal', [t], cleanDismissal(t));
  pure('speakable', [t], speakable(t));
}
for (const o of [0, 0.1, 0.5, 1, 4.2, 8.2, 19.5, 20, 49.6]) for (const bpo of [6, 5]) pure('oversToBalls', [o, bpo], oversToBalls(o, bpo));
for (const b of [0, 1, 5, 6, 7, 50, 119, 120, 121]) for (const bpo of [6, 5]) pure('ballsToOvers', [b, bpo], ballsToOvers(b, bpo));
for (const type of ['dot', 'run', 'four', 'six', 'wide', 'noball', 'legbye', 'bye', 'out'] as const) for (const [r, br] of [[0, 0], [1, 0], [1, 1], [3, 2], [5, 4]]) pure('ballLabel', [type, r, br], ballLabel(type, r, br));
for (const l of [undefined, '', 'en', 'en-IN', 'hi-IN', 'PA-in', 'ta']) pure('targetCode', [l ?? null], targetCode(l));
for (const m of ['', 'video/webm', 'video/webm;codecs=h264', 'video/mp4', 'video/mp4;codecs=avc1.42', 'VIDEO/MP4;CODECS=H264', 'video/mp4;codecs=vp9']) pure('preferVideoCopy', [m], preferVideoCopy(m));
for (const t of [{ url: 'rtmp://a/live2', key: 'k' }, { url: 'rtmp://a/live2/', key: 'k' }, { url: 'rtmp://x', key: '' }]) pure('rtmpUrl', [t], rtmpUrl(t));
pure('relayArgs', ['rtmp://a/live/k'], relayArgs('rtmp://a/live/k'));
const enc = { videoBitrateKbps: 4500, audioBitrateKbps: 160, x264Preset: 'veryfast' } as Parameters<typeof encoderArgs>[1];
for (const off of [0, 1.5, 12.3456]) for (const copy of [false, true]) pure('encoderArgs', [off, 4500, 160, 'veryfast', copy], encoderArgs(off, enc, copy));

for (const [r, a, b] of [['host', 'a', 'b'], ['guest', 'a', 'a'], ['guest', 'a', 'b'], ['program', 'a', 'a'], ['host', 'a', ''], ['host', 'a', 'b c']]) pure('canEditBubble', [r, a, b], canEditBubble(r, a, b));

const slotSets: unknown[] = [null, {}, { a: { x: 10, y: 20 } }, { a: { x: 10, y: 20, shape: 'wide' }, b: { shape: 'oval' } }, { 'bad id': { x: 1, y: 1 }, c: { x: 3, y: 4 } }, Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`p${i}`, { x: i, y: i }]))];
const patches: Record<string, unknown>[] = [{}, { x: 100, y: 200 }, { x: 99999, y: -99999 }, { x: 5 }, { y: 5 }, { shape: 'stumps' }, { shape: null }, { shape: 'nope' }, { clearPosition: true }, { clear: true }, { x: 'abc', y: 2 }, { x: '12', y: '34' }];
for (const s of slotSets) for (const id of ['a', 'zz', '', 'has space']) for (const p of patches) pure('applyBubblePatch', [s, id, p], applyBubblePatch(s as never, id, p as never));

const prev = { camBubbles: false, camBubblesAllScenes: true, camBubbleCorner: 'br', camBubbleSize: 220, camBubbleShape: 'ball', camBubbleSlots: { old: { x: 1, y: 2 } } };
const nexts: Record<string, unknown>[] = [{}, { camBubbles: true, camBubblesAllScenes: false }, { camBubbles: 'yes' }, { camBubbleCorner: 'tl' }, { camBubbleCorner: 'zz' }, { camBubbleSize: 50 }, { camBubbleSize: 999 }, { camBubbleSize: 250.6 }, { camBubbleSize: 'x' }, { camBubbleShape: 'shield' }, { camBubbleShape: 'x' }, { camBubbleSlots: {} }, { camBubbleSlots: { a: { x: 5, y: 6, shape: 'wide' }, b: null, c: 7, d: { shape: 'bad' } } }];
for (const n of nexts) pure('sanitizeBubbleFields', [n, prev], sanitizeBubbleFields(n as never, prev as never));


writeFileSync(join(outDir, 'pure.jsonl'), `${lines.join('\n')}\n`);
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1))), null, 0)}\n`);
console.log(`recorded ${Object.keys(manifest).length} outputs, ${lines.length} pure cases, ${total} demo balls`);
