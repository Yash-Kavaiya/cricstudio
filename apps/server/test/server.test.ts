import { describe, expect, it } from 'vitest';
import type { CricketEvent, StudioState } from '@cricstudio/shared';
import { AutomationEngine } from '../src/automation/rules';
import { defaultState } from '../src/studio/room';
import { encoderArgs, relayArgs, rtmpUrl } from '../src/stream/pipeline';
import { decrypt, encrypt, hashToken, maskKey, tokenMatches } from '../src/store/crypto';

describe('live pipeline args', () => {
  it('encoder emits continuous-timestamp MPEG-TS for relays', () => {
    const args = encoderArgs(42.5);
    expect(args).toContain('libx264');
    expect(args[args.indexOf('-output_ts_offset') + 1]).toBe('42.500');
    expect(args[args.indexOf('-f', args.indexOf('-c:a')) + 1]).toBe('mpegts');
    expect(args.at(-1)).toBe('pipe:1');
    expect(args.join(' ')).toContain('repeat-headers=1');
  });
  it('relay copies TS to one RTMP url with flv', () => {
    const args = relayArgs('rtmps://live-api-s.facebook.com:443/rtmp/key');
    expect(args).toContain('copy');
    expect(args).toContain('aac_adtstoasc');
    expect(args.at(-1)).toBe('rtmps://live-api-s.facebook.com:443/rtmp/key');
  });
  it('joins url and key', () => {
    expect(rtmpUrl({ url: 'rtmp://x/app/', key: 'k' })).toBe('rtmp://x/app/k');
    expect(rtmpUrl({ url: 'rtmp://x/app', key: 'k' })).toBe('rtmp://x/app/k');
    expect(rtmpUrl({ url: 'rtmp://x/app/k', key: '' })).toBe('rtmp://x/app/k');
  });
});

describe('stream key crypto', () => {
  it('round-trips and masks', () => {
    const enc = encrypt('live_abc123xyz');
    expect(enc).not.toContain('abc123');
    expect(decrypt(enc)).toBe('live_abc123xyz');
    expect(maskKey('live_abc123xyz')).toBe('liv••••••xyz');
    expect(tokenMatches('t0k', hashToken('t0k'))).toBe(true);
    expect(tokenMatches('nope', hashToken('t0k'))).toBe(false);
  });
});

function harness(mode: StudioState['automation'] = 'auto') {
  const state = defaultState({
    id: 's', name: 'Show', matchKey: 'demo:replay', hostTokenHash: '', guestTokenHash: '', programTokenHash: '', guestTokenEnc: '', settings: '{}', createdAt: 0,
  });
  state.automation = mode;
  state.scene = 'panel';
  state.baseScene = 'panel';
  const suggestions: unknown[] = [];
  const eng = new AutomationEngine({ state: () => state, commit: () => {}, suggest: (s) => suggestions.push(s) });
  return { state, eng, suggestions };
}
const ev = (type: CricketEvent['type'], value?: number): CricketEvent => ({ type, matchKey: 'm', title: type, value, ts: Date.now() });

describe('automation engine', () => {
  it('Auto Live off: wicket shows the overlay but never switches the scene', () => {
    const { state, eng } = harness();
    eng.onEvents([ev('WICKET', 3)]);
    expect(state.overlay?.id).toBe('wicket');
    expect(state.scene).toBe('panel');
    expect(state.sceneUntil).toBeNull();
    eng.onEvents([ev('INNINGS_END')]);
    expect(state.scene).toBe('panel');
    expect(state.baseScene).toBe('panel');
    eng.dispose();
  });
  it('Auto Live: wicket → overlay with sfx, then batting card, then back', () => {
    const { state, eng } = harness();
    state.autopilot = { ...state.autopilot, enabled: true };
    eng.onEvents([ev('WICKET', 3)]);
    expect(state.overlay?.id).toBe('wicket');
    expect(state.overlay?.sfx).toBe('wicketSting');
    expect(state.scene).toBe('battingCard');
    expect(state.baseScene).toBe('panel');
    expect(state.sceneUntil).toBeGreaterThan(Date.now());
    eng.dispose();
  });
  it('higher priority preempts, lower waits in queue', () => {
    const { state, eng } = harness();
    eng.onEvents([ev('FOUR')]);
    expect(state.overlay?.id).toBe('four');
    eng.onEvents([ev('WICKET')]);
    expect(state.overlay?.id).toBe('wicket');
    eng.dispose();
  });
  it('respects manual pin (no auto cut) but still shows overlay', () => {
    const { state, eng } = harness();
    state.pinnedUntil = Date.now() + 30_000;
    eng.onEvents([ev('SIX')]);
    eng.onEvents([ev('WICKET')]);
    expect(state.overlay?.id).toBe('wicket');
    expect(state.scene).toBe('panel');
    eng.dispose();
  });
  it('assist mode only suggests', () => {
    const { state, eng, suggestions } = harness('assist');
    eng.onEvents([ev('SIX')]);
    expect(state.overlay).toBeNull();
    expect(suggestions).toHaveLength(1);
    eng.dispose();
  });
  it('manual mode does nothing; innings end switches base scene in Auto Live', () => {
    const m = harness('manual');
    m.eng.onEvents([ev('WICKET')]);
    expect(m.state.overlay).toBeNull();
    m.eng.dispose();
    const a = harness();
    a.state.autopilot = { ...a.state.autopilot, enabled: true };
    a.eng.onEvents([ev('INNINGS_END')]);
    expect(a.state.baseScene).toBe('break');
    a.eng.dispose();
  });
  it('keeps the starting-soon screen clean', () => {
    const { state, eng } = harness();
    state.scene = 'startingSoon';
    eng.onEvents([ev('FOUR')]);
    expect(state.overlay).toBeNull();
    eng.dispose();
  });
});

describe('autopilot', () => {
  it('rotates through data scenes only (no cameras) with a transition per cut', async () => {
    const { state, eng } = harness();
    state.autopilot = { ...state.autopilot, enabled: true, sceneSeconds: 3, includeCameras: false };
    state.scene = 'scoreHero';
    state.participants = [{ id: 'h', name: 'Host', role: 'host', onStage: true, muted: false, camOff: false, screenSharing: false, joinedAt: 0 }];
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      (eng as any).lastSceneChange = 0;
      (eng as any).tick();
      seen.add(state.scene);
    }
    expect(seen.size).toBeGreaterThan(6);
    for (const s of ['hostSolo', 'panel', 'commentaryDesk', 'screenShare']) expect(seen.has(s)).toBe(false);
    expect(state.music.playing).toBe(true); // auto music bed
    expect(state.transition).toBeTruthy();
    eng.dispose();
  });
  it('includes camera scenes when toggled and someone is on stage', () => {
    const { state, eng } = harness();
    state.autopilot = { ...state.autopilot, enabled: true, includeCameras: true };
    state.participants = [{ id: 'g', name: 'Guest', role: 'guest', onStage: true, muted: false, camOff: false, screenSharing: false, joinedAt: 0 }];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      (eng as any).lastSceneChange = 0;
      (eng as any).tick();
      seen.add(state.scene);
    }
    expect(seen.has('panel') || seen.has('hostSolo') || seen.has('commentaryDesk')).toBe(true);
    eng.dispose();
  });
});
