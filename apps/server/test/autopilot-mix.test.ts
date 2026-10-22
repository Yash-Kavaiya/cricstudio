import { describe, expect, it } from 'vitest';
import { SCENES } from '@cricstudio/shared';
import { AutomationEngine } from '../src/automation/rules';
import { defaultState } from '../src/studio/room';

const rec = { id: 't', name: 'T', matchKey: 'demo:replay', hostTokenHash: '', guestTokenHash: '', programTokenHash: '', guestTokenEnc: '', settings: '{}', createdAt: 0 };

function run(share: number | undefined, cuts = 1000, cameras = false) {
  const st = defaultState(rec);
  st.autopilot.enabled = true;
  st.autopilot.scoreShare = share;
  if (cameras) {
    st.autopilot.includeCameras = true;
    st.participants = [{ id: 'h', name: 'Host', role: 'host', onStage: true, muted: false, camOff: false, screenSharing: false, joinedAt: 0 }];
  }
  const eng = new AutomationEngine({ state: () => st, commit: () => undefined, suggest: () => undefined });
  eng.dispose();
  const counts = new Map<string, number>();
  let score = 0;
  let cams = 0;
  let data = 0;
  const groups = new Set<string>();
  let repeats = 0;
  for (let i = 0; i < cuts; i++) {
    const next = (eng as any).nextAutopilotScene(st);
    if (next === st.scene) repeats++;
    st.scene = next;
    counts.set(next, (counts.get(next) ?? 0) + 1);
    if (SCENES.find((s) => s.id === next)?.group === 'Score') score++;
    const meta = SCENES.find((s) => s.id === next);
    if (meta?.usesCameras) cams++;
    else if (meta?.group !== 'Score') {
      data++;
      groups.add(meta!.group);
    }
  }
  return { score: score / cuts, cams: cams / cuts, data: data / cuts, groups, repeats, distinct: counts.size };
}

describe('autopilot score focus', () => {
  it('gives Score scenes 70% of cuts by default', () => {
    const r = run(undefined);
    expect(r.score).toBeGreaterThan(0.69);
    expect(r.score).toBeLessThan(0.71);
    expect(r.repeats).toBe(0); // never the same scene twice in a row
    expect(r.distinct).toBeGreaterThan(10); // the 30% still rotates through other scenes
  });
  it('keeps the full 30% for stats, insights and analysis with people on stage', () => {
    const r = run(undefined, 1000, true);
    expect(r.data).toBeCloseTo(0.3, 2);
    expect(r.cams).toBeGreaterThan(0.2); // every third live cut is a camera shot
    expect(r.score + r.cams).toBeCloseTo(0.7, 2);
    expect(r.repeats).toBe(0);
  });
  it('walks every data group in the 30% share', () => {
    const r = run(undefined);
    expect(r.data).toBeCloseTo(0.3, 2);
    for (const g of ['Stats', 'Insights', 'Analysis', 'Match']) expect(r.groups.has(g)).toBe(true);
  });
  it('honours a custom share', () => {
    expect(run(0.5).score).toBeCloseTo(0.5, 1);
    expect(run(0.9).score).toBeCloseTo(0.9, 1);
  });
});
