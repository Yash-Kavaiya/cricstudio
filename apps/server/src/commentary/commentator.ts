import type { CommentaryLine, CricketEvent, MatchDetail, MatchListItem } from '@cricstudio/shared';

/* Template-driven, context-aware commentary that sounds like a person, not a ticker. */

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const say = {
  four: [
    'Shot! {bat} finds the gap and that races away to the boundary. Four runs.',
    'Oh, that is gorgeous from {bat}! Timed to perfection, four more.',
    'Cracking shot! {bat} threads it through the field, and nobody is stopping that. Four.',
    "That's a boundary! {bat} puts it away. {team} move to {score}.",
    "Lovely, lovely cricket. {bat} leans into it and it's four all the way.",
  ],
  six: [
    "That is huge! {bat} has launched it into the stands. Six!",
    'Oh my word! {bat} has sent that into orbit. Maximum!',
    "Gone, gone, all the way! {bat} clears the rope with ease. That's six!",
    "Smashed! {bat} picks the length early and deposits it into the crowd. Six runs!",
    "What a hit! The crowd is on its feet. {bat} with a massive six, and {team} are {score}.",
  ],
  wicket: [
    "Gone! That's a big wicket. {dismissal}. {team} are {score}.",
    "Out! The bowler gets the breakthrough. {dismissal}.",
    "And that's the end of {bat}! {dismissal}. Huge moment in this game.",
    "Wicket! {bowler} strikes, and {bat} has to walk back. {team} now {score}.",
  ],
  overEnd: [
    'End of the over. {overRuns} from it, and {team} are {score} after {overs} overs.',
    'That completes the over. {overRuns} runs, {team} {score}.',
    "{overRuns} off that over. Let's take stock: {team} {score} after {overs}.",
  ],
  milestone50: ['Fifty up for {bat}! A terrific knock, raise the bat, take a bow.', 'And there it is, a half-century for {bat}! Quality innings.'],
  milestone100: [
    "Century! What an innings from {bat}! Absolutely magnificent, take a bow!",
    "A hundred for {bat}! The helmet comes off, the bat goes up, and this place erupts!",
  ],
  fiveFor: ["Five wickets! {bowler} has a five-for, and what a spell this has been!"],
  partnership: ['That brings up the {value} partnership. These two are building something special.', 'The {value} stand is up, and the bowlers need answers.'],
  hattrick: ["Two in two! {bowler} is on a hat-trick. Everyone's on the edge of their seats."],
  noball: ["No ball! And that means a free hit is coming up. Here's a chance for the batter."],
  inningsEnd: [
    "That's the end of the innings. Stay with us, the experts are about to break it all down.",
    "And the innings is complete. What a contest so far. Let's take a short break.",
  ],
  matchEnd: ["And that's the match! {summary}. What a game of cricket that was!", 'It is all over! {summary}. Thanks for watching with us.'],
};

const chatterTemplates: ((d: MatchDetail, extra: { matches: MatchListItem[]; poll: string }) => string | null)[] = [
  (d) => {
    if (!d.need) return null;
    const { runs, balls } = d.need;
    if (balls <= 0) return null;
    const team = d.teams.find((t) => t.id === d.battingTeamId)?.name ?? 'The chasing side';
    const rrr = d.rrr ? d.rrr.toFixed(1) : '';
    if (runs / Math.max(balls, 1) > 1.8) return `${team} need ${runs} from ${balls} balls. The required rate is ${rrr}, and it's getting really tough now.`;
    if (runs / Math.max(balls, 1) < 0.9) return `${team} are cruising. Just ${runs} needed from ${balls} balls. The bowling side needs wickets, and fast.`;
    return `Here's the equation: ${runs} runs from ${balls} balls. This one is going right down to the wire!`;
  },
  (d) => {
    const [a, b] = d.currentBatters;
    if (!a) return null;
    const p = d.partnership;
    return b
      ? `${a.name} is on ${a.runs} from ${a.balls}, ${b.name} has ${b.runs}. The partnership is worth ${p.runs} off ${p.balls} balls.`
      : `${a.name} is batting on ${a.runs} from ${a.balls} balls.`;
  },
  (d) => {
    const bw = d.currentBowler;
    if (!bw) return null;
    return `${bw.name} has figures of ${bw.wickets} for ${bw.conceded} from ${bw.overs} overs, going at ${bw.econ.toFixed(1)} an over.`;
  },
  (d) => {
    const inn = d.innings.find((i) => i.number === d.currentInnings);
    if (!inn || d.need) return null;
    const balls = Math.floor(inn.overs) * 6 + Math.round((inn.overs % 1) * 10);
    const limit = inn.ballLimit || 0;
    if (!limit || balls < 12) return null;
    const proj = Math.round((inn.runs / balls) * limit);
    return `At this rate, ${inn.teamName} are heading for around ${proj}. What would you call a par score on this pitch? Let us know in the comments!`;
  },
  (d) => {
    const top = d.innings.flatMap((i) => i.batting).sort((a, b) => b.runs - a.runs)[0];
    if (!top || top.runs < 20) return null;
    return `Top scorer so far, ${top.name}, with ${top.runs} off ${top.balls} balls, including ${top.sixes} sixes.`;
  },
  (_d, x) => {
    const live = x.matches.filter((m) => m.state === 'in' && !m.isDemo).slice(0, 3);
    if (live.length < 2) return null;
    const m = pick(live);
    return `Quick look around the grounds: ${m.teams.map((t) => `${t.name} ${t.score || ''}`.trim()).join(', versus ')}.`;
  },
  (_d, x) => (x.poll ? `Time for our fan poll: ${x.poll} Drop your answer in the chat!` : null),
  () =>
    pick([
      "If you're enjoying the coverage, hit that like button and subscribe. It really helps the channel.",
      'Welcome to everyone just joining us. Tell us where you are watching from in the comments!',
      "Who's your player of the match so far? Let us know in the chat.",
      'Lovely to have you with us for live, ball-by-ball cricket.',
    ]),
];

function scoreWords(d: MatchDetail | null) {
  const inn = d?.innings.find((i) => i.number === d.currentInnings);
  return inn ? `${inn.runs} for ${inn.wickets}` : '';
}

function fill(tpl: string, ev: CricketEvent | null, d: MatchDetail | null) {
  const b = ev?.ball;
  const inn = d?.innings.find((i) => i.number === d.currentInnings);
  const map: Record<string, string> = {
    bat: b?.batsman?.name ?? ev?.player ?? 'the batter',
    bowler: b?.bowler?.name ?? ev?.player ?? 'the bowler',
    team: inn?.teamName ?? b?.battingTeamAbbr ?? 'the batting side',
    score: scoreWords(d) || (b ? `${b.inningsRuns} for ${b.inningsWickets}` : ''),
    overs: String(inn?.overs ?? b?.over ?? ''),
    overRuns: String(b?.overRuns ?? 0),
    dismissal: (ev?.subtitle ?? '').replace(/\s\d+\s\(.*$/, ''),
    value: String(ev?.value ?? ''),
    summary: d?.summary || 'a fantastic finish',
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '');
}

export interface CommentatorHost {
  enabled(): boolean;
  voice(): string;
  chatterSeconds(): number;
  match(): MatchDetail | null;
  matches(): MatchListItem[];
  poll(): string;
  emit(line: CommentaryLine): void;
  /** optional AI writer (Gemini): rewrites the template line for this moment; must resolve to the fallback on failure */
  write?(event: CricketEvent | null, fallback: string, recent: string[]): Promise<{ text: string; ai: boolean; lang?: string }>;
}

export class Commentator {
  private recent: string[] = [];
  private lastSpoke = 0;
  private timer: NodeJS.Timeout;
  private seq = 0;

  constructor(private readonly host: CommentatorHost) {
    this.timer = setInterval(() => this.chatter(), 3000);
    this.timer.unref?.();
  }

  dispose() {
    clearInterval(this.timer);
  }

  private speak(text: string, priority: number, event: CricketEvent | null = null) {
    if (!text || this.recent.includes(text)) return;
    this.remember(text);
    this.lastSpoke = Date.now();
    const ts = Date.now();
    const out = (t: string, ai: boolean, lang?: string) => {
      if (ai) this.remember(t);
      this.host.emit({ id: `c${++this.seq}-${ts}`, text: t, voice: this.host.voice(), priority, ts, ai, lang });
    };
    if (!this.host.write) return out(text, false);
    void this.host
      .write(event, text, this.recent)
      .then((r) => (r.text ? out(r.text, r.ai, r.lang) : out(text, false)))
      .catch(() => out(text, false));
  }

  private remember(text: string) {
    this.recent.push(text);
    if (this.recent.length > 30) this.recent.shift();
  }

  onEvents(events: CricketEvent[]) {
    if (!this.host.enabled()) return;
    const d = this.host.match();
    // speak only the most important event of the batch
    const order: CricketEvent['type'][] = ['MATCH_END', 'INNINGS_END', 'WICKET', 'MILESTONE_BAT', 'MILESTONE_BOWL', 'HATTRICK_WATCH', 'SIX', 'FOUR', 'PARTNERSHIP', 'NOBALL', 'OVER_END'];
    const ev = order.map((t) => events.find((e) => e.type === t)).find(Boolean);
    if (!ev) return;
    let tpl: string[] | null = null;
    let prio = 1;
    switch (ev.type) {
      case 'FOUR':
        tpl = say.four;
        prio = 2;
        break;
      case 'SIX':
        tpl = say.six;
        prio = 3;
        break;
      case 'WICKET':
        tpl = say.wicket;
        prio = 5;
        break;
      case 'OVER_END':
        // don't talk over every single over
        if (Date.now() - this.lastSpoke < 12_000 || Math.random() < 0.35) return;
        tpl = say.overEnd;
        break;
      case 'MILESTONE_BAT':
        tpl = (ev.value ?? 0) >= 100 ? say.milestone100 : say.milestone50;
        prio = 4;
        break;
      case 'MILESTONE_BOWL':
        tpl = say.fiveFor;
        prio = 4;
        break;
      case 'PARTNERSHIP':
        tpl = say.partnership;
        prio = 2;
        break;
      case 'HATTRICK_WATCH':
        tpl = say.hattrick;
        prio = 4;
        break;
      case 'NOBALL':
        tpl = say.noball;
        break;
      case 'INNINGS_END':
        tpl = say.inningsEnd;
        prio = 5;
        break;
      case 'MATCH_END':
        tpl = say.matchEnd;
        prio = 6;
        break;
    }
    if (tpl) this.speak(fill(pick(tpl), ev, d), prio, ev);
  }

  /** unprompted, context-aware lines during quiet spells */
  private chatter() {
    if (!this.host.enabled()) return;
    const gap = this.host.chatterSeconds() * 1000 * (0.8 + Math.random() * 0.4);
    if (Date.now() - this.lastSpoke < gap) return;
    const d = this.host.match();
    if (!d) return;
    const tries = [...chatterTemplates].sort(() => Math.random() - 0.5);
    for (const t of tries) {
      const line = t(d, { matches: this.host.matches(), poll: this.host.poll() });
      if (line && !this.recent.includes(line)) return this.speak(line, 0);
    }
  }

  /** e.g. when autopilot starts or a new match is picked */
  intro(d: MatchDetail | null, title: string) {
    if (!this.host.enabled()) return;
    if (!d) return this.speak(`Hello and welcome to ${title}. Stay with us for live cricket.`, 3);
    this.speak(
      `Hello and welcome to ${title}! We're live with ${d.title}, ${d.description}${d.venue ? ` at ${d.venue.split(',')[0]}` : ''}. ${d.summary || ''}`.trim(),
      3,
    );
  }
}
