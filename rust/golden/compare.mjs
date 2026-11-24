// Compares two e2e transcripts step by step. Usage: node rust/golden/compare.mjs node.json rust.json
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const paths = (x, y, at = '', out = []) => {
  if (JSON.stringify(x) === JSON.stringify(y)) return out;
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) paths(x[k], y[k], `${at}.${k}`, out);
    return out;
  }
  out.push(`${at}: node=${JSON.stringify(x)?.slice(0, 140)} rust=${JSON.stringify(y)?.slice(0, 140)}`);
  return out;
};
let same = 0;
const bad = [];
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i]?.name !== b[i]?.name) {
    bad.push({ name: `step ${i}: ${a[i]?.name} vs ${b[i]?.name}`, diff: ['step order differs'] });
    break;
  }
  const d = paths(a[i].value, b[i].value);
  if (d.length) bad.push({ name: a[i].name, diff: d });
  else same++;
}
console.log(`${same} of ${Math.max(a.length, b.length)} steps identical`);
for (const x of bad.slice(0, 25)) {
  console.log(`\n✗ ${x.name}`);
  for (const l of x.diff.slice(0, 6)) console.log(`   ${l}`);
  if (x.diff.length > 6) console.log(`   … ${x.diff.length - 6} more`);
}
process.exit(bad.length ? 1 : 0);
