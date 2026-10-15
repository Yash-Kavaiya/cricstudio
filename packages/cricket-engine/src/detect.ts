import type { Ball, CricketEvent, MatchStateCode } from '@cricstudio/shared';

const BAT_MILESTONES = [50, 100, 150, 200, 250, 300];
const PARTNERSHIP_MILESTONES = [50, 100, 150, 200, 250];

const isLegal = (b: Ball) => b.type !== 'wide' && b.type !== 'noball';

/**
 * Turns a stream of balls (ESPN play-by-play) into broadcast events.
 * Stateful per match: call `prime` with history first so we only emit for new deliveries.
 */
export class EventDetector {
  private lastSeq = -1;
  private lastInnings = 0;
  private lastState: MatchStateCode | null = null;
  private partnershipBase = new Map<number, number>(); // innings -> runs at last wicket
  private bowlerStreak = new Map<string, number>(); // consecutive wickets per bowler (own deliveries)
  primed = false;

  constructor(private readonly matchKey: string) {}

  get lastSequence() {
    return this.lastSeq;
  }

  prime(balls: Ball[], state: MatchStateCode) {
    const sorted = balls.slice().sort((a, b) => a.seq - b.seq);
    for (const b of sorted) this.track(b);
    this.lastSeq = sorted.at(-1)?.seq ?? -1;
    this.lastInnings = sorted.at(-1)?.innings ?? 0;
    this.lastState = state;
    this.primed = true;
  }

  private track(b: Ball) {
    if (b.isWicket) this.partnershipBase.set(b.innings, b.inningsRuns);
    if (b.bowler && isLegal(b)) {
      const k = b.bowler.id;
      if (b.isWicket && !/run out/i.test(b.dismissalType ?? '')) this.bowlerStreak.set(k, (this.bowlerStreak.get(k) ?? 0) + 1);
      else this.bowlerStreak.set(k, 0);
    }
  }

  process(balls: Ball[], state: MatchStateCode, now = Date.now()): CricketEvent[] {
    if (!this.primed) {
      this.prime(balls, state);
      return [];
    }
    const events: CricketEvent[] = [];
    const fresh = balls.filter((b) => b.seq > this.lastSeq).sort((a, b) => a.seq - b.seq);
    const ev = (e: Omit<CricketEvent, 'matchKey' | 'ts'>) => events.push({ ...e, matchKey: this.matchKey, ts: now });

    for (const b of fresh) {
      if (this.lastInnings && b.innings > this.lastInnings) {
        ev({ type: 'INNINGS_END', title: 'Innings Break', subtitle: `Innings ${this.lastInnings} complete`, value: this.lastInnings });
      }
      this.lastInnings = b.innings;

      const prevPartnership = b.inningsRuns - b.runs - (this.partnershipBase.get(b.innings) ?? 0);

      ev({ type: 'BALL', ball: b, title: b.short, subtitle: b.text });
      switch (b.type) {
        case 'four':
          ev({ type: 'FOUR', ball: b, title: 'FOUR!', subtitle: b.short, player: b.batsman?.name });
          break;
        case 'six':
          ev({ type: 'SIX', ball: b, title: 'SIX!', subtitle: b.short, player: b.batsman?.name });
          break;
        case 'out':
          ev({
            type: 'WICKET',
            ball: b,
            title: 'WICKET!',
            subtitle: b.dismissalText || b.short,
            player: b.batsman?.name,
            value: b.inningsWickets,
          });
          break;
        case 'wide':
          ev({ type: 'WIDE', ball: b, title: 'Wide', subtitle: b.short });
          break;
        case 'noball':
          ev({ type: 'NOBALL', ball: b, title: 'No Ball — Free Hit!', subtitle: b.short });
          break;
      }

      // Batting milestones (crossing on this delivery)
      if (b.batsman && b.batRuns > 0) {
        const before = b.batsman.runs - b.batRuns;
        for (const m of BAT_MILESTONES) {
          if (before < m && b.batsman.runs >= m) {
            ev({
              type: 'MILESTONE_BAT',
              ball: b,
              value: m,
              player: b.batsman.name,
              title: m >= 100 ? `CENTURY! ${b.batsman.name}` : `FIFTY! ${b.batsman.name}`,
              subtitle: `${b.batsman.runs} off ${b.batsman.balls} balls · ${b.batsman.fours}x4 · ${b.batsman.sixes}x6`,
            });
          }
        }
      }

      // Bowling milestone & hat-trick watch
      if (b.isWicket && b.bowler) {
        if (b.bowler.wickets === 5) {
          ev({
            type: 'MILESTONE_BOWL',
            ball: b,
            value: 5,
            player: b.bowler.name,
            title: `FIVE-WICKET HAUL! ${b.bowler.name}`,
            subtitle: `${b.bowler.wickets}/${b.bowler.conceded} in ${b.bowler.overs} overs`,
          });
        }
      }
      this.track(b);
      if (b.isWicket && b.bowler && (this.bowlerStreak.get(b.bowler.id) ?? 0) === 2) {
        ev({ type: 'HATTRICK_WATCH', ball: b, player: b.bowler.name, title: 'ON A HAT-TRICK!', subtitle: `${b.bowler.name} — two in two` });
      }

      // Partnership milestones (only when no wicket fell on this ball)
      if (!b.isWicket) {
        const now = b.inningsRuns - (this.partnershipBase.get(b.innings) ?? 0);
        for (const m of PARTNERSHIP_MILESTONES) {
          if (prevPartnership < m && now >= m) {
            ev({
              type: 'PARTNERSHIP',
              ball: b,
              value: m,
              title: `${m} PARTNERSHIP`,
              subtitle: [b.batsman?.name, b.nonStriker?.name].filter(Boolean).join(' & '),
            });
          }
        }
      }

      if (b.overComplete && isLegal(b)) {
        ev({
          type: 'OVER_END',
          ball: b,
          value: b.overNumber,
          title: `End of over ${b.overNumber}`,
          subtitle: `${b.overRuns} run${b.overRuns === 1 ? '' : 's'} · ${b.battingTeamAbbr} ${b.inningsRuns}/${b.inningsWickets}`,
        });
      }
      this.lastSeq = b.seq;
    }

    if (state === 'post' && this.lastState && this.lastState !== 'post') {
      ev({ type: 'MATCH_END', title: 'Match Over', subtitle: '' });
    }
    this.lastState = state;
    return events;
  }
}
