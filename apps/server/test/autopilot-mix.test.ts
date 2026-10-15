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
  let repeats = 0;
  for (let i = 0; i < cuts; i++) {
    const next = (eng as any).nextAutopilotScene(st);
    if (next === st.scene) repeats++;
    st.scene = next;
    counts.set(next, (counts.get(next) ?? 0) + 1);
    if (SCENES.find((s) => s.id === next)?.group === 'Score') score++;
    if (SCENES.find((s) => s.id === next)?.usesCameras) cams++;
  }
  return { score: score / cuts, cams: cams / cuts, repeats, distinct: counts.size };
}

describe('autopilot score focus', () => {
  it('gives Score scenes 70% of cuts by default', () => {
    const r = run(undefined);
    expect(r.score).toBeGreaterThan(0.69);
    expect(r.score).toBeLessThan(0.71);
    expect(r.repeats).toBe(0); // never the same scene twice in a row
    expect(r.distinct).toBeGreaterThan(10); // the 30% still rotates through other scenes
  });
  it('keeps 70% score with people on stage and splits the rest between cameras and stats', () => {
    const r = run(undefined, 1000, true);
    expect(r.score).toBeCloseTo(0.7, 1);
    expect(r.cams).toBeCloseTo(0.15, 1);
    expect(r.repeats).toBe(0);
  });
  it('honours a custom share', () => {
    expect(run(0.5).score).toBeCloseTo(0.5, 1);
    expect(run(0.9).score).toBeCloseTo(0.9, 1);
  });
});
