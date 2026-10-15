import { describe, expect, it } from 'vitest';
import { SCENES } from '@cricstudio/shared';
import { AutomationEngine } from '../src/automation/rules';
import { defaultState } from '../src/studio/room';

const rec = { id: 't', name: 'T', matchKey: 'demo:replay', hostTokenHash: '', guestTokenHash: '', programTokenHash: '', guestTokenEnc: '', settings: '{}', createdAt: 0 };

function run(share: number | undefined, cuts = 1000) {
  const st = defaultState(rec);
  st.autopilot.enabled = true;
  st.autopilot.scoreShare = share;
  const eng = new AutomationEngine({ state: () => st, commit: () => undefined, suggest: () => undefined });
  eng.dispose();
  const counts = new Map<string, number>();
  let score = 0;
  let repeats = 0;
  for (let i = 0; i < cuts; i++) {
    const next = (eng as any).nextAutopilotScene(st);
    if (next === st.scene) repeats++;
    st.scene = next;
    counts.set(next, (counts.get(next) ?? 0) + 1);
    if (SCENES.find((s) => s.id === next)?.group === 'Score') score++;
  }
  return { score: score / cuts, repeats, distinct: counts.size };
}

describe('autopilot score focus', () => {
  it('gives Score scenes 70% of cuts by default', () => {
    const r = run(undefined);
    expect(r.score).toBeGreaterThan(0.69);
    expect(r.score).toBeLessThan(0.71);
    expect(r.repeats).toBe(0); // never the same scene twice in a row
    expect(r.distinct).toBeGreaterThan(10); // the 30% still rotates through other scenes
  });
  it('honours a custom share', () => {
    expect(run(0.5).score).toBeCloseTo(0.5, 1);
    expect(run(0.9).score).toBeCloseTo(0.9, 1);
  });
});
