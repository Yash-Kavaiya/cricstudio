// Shared domain types for CricStudio (server <-> web contract).

export * from './scenes';
import type { BackgroundId, SceneId, TransitionId } from './scenes';

/* ------------------------------------------------------------------ */
/* Cricket data                                                        */
/* ------------------------------------------------------------------ */

export type MatchStateCode = 'pre' | 'in' | 'post';

export interface MatchListTeam {
  id: string;
  name: string;
  abbr: string;
  logo?: string;
  score: string;
  winner?: boolean;
}

export interface MatchListItem {
  id: string;
  leagueId: string;
  leagueName: string;
  name: string;
  description: string;
  state: MatchStateCode;
  statusText: string;
  startDate: string;
  teams: MatchListTeam[];
  isDemo?: boolean;
}

export type BallType = 'dot' | 'run' | 'four' | 'six' | 'wide' | 'noball' | 'legbye' | 'bye' | 'out';

export interface BallBatter {
  id: string;
  name: string;
  runs: number; // total runs after this ball
  balls: number;
  fours: number;
  sixes: number;
}

export interface BallBowler {
  id: string;
  name: string;
  overs: number;
  conceded: number;
  wickets: number;
  maidens: number;
}

export interface Ball {
  id: string;
  seq: number;
  innings: number;
  /** display over e.g. 4.2 */
  over: number;
  overNumber: number; // 1-based over number
  ballInOver: number;
  type: BallType;
  runs: number; // runs credited to total on this delivery
  batRuns: number; // runs off the bat
  isWicket: boolean;
  label: string; // chip label e.g. "4", "W", "1wd"
  short: string;
  text: string;
  battingTeamId: string;
  battingTeamAbbr: string;
  inningsRuns: number;
  inningsWickets: number;
  runRate: number;
  remainingBalls: number;
  ballLimit: number;
  target: number;
  overRuns: number;
  overComplete: boolean;
  batsman?: BallBatter;
  nonStriker?: BallBatter;
  bowler?: BallBowler;
  dismissalText?: string;
  dismissalType?: string;
  ts: number;
}

export interface BatterLine {
  id: string;
  name: string;
  headshot?: string;
  position: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  sr: number;
  dismissal: string;
  notOut: boolean;
  batted: boolean;
  /** runs per wagon-wheel zone (8 zones, clockwise from fine leg) */
  wagon?: number[];
  dotPct?: number;
  control?: number;
  preferredShot?: string;
}

export interface BowlerLine {
  id: string;
  name: string;
  headshot?: string;
  overs: number;
  maidens: number;
  conceded: number;
  wickets: number;
  econ: number;
  wides: number;
  noballs: number;
  dots: number;
}

export interface FallOfWicket {
  wicket: number;
  runs: number;
  over: number;
  batter: string;
}

export interface OverSummary {
  innings: number;
  over: number; // 1-based
  runs: number;
  wickets: number;
  cumulative: number;
  balls: string[]; // chip labels
}

export interface Innings {
  number: number;
  teamId: string;
  teamAbbr: string;
  teamName: string;
  runs: number;
  wickets: number;
  overs: number;
  target: number;
  ballLimit: number;
  isCurrent: boolean;
  description: string;
  batting: BatterLine[];
  bowling: BowlerLine[];
  extras: { wides: number; noballs: number; byes: number; legbyes: number; total: number };
  fow: FallOfWicket[];
  overSummaries: OverSummary[];
}

export interface SquadPlayer {
  id: string;
  name: string;
  role: string;
  captain: boolean;
  keeper: boolean;
  headshot?: string;
}

export interface TeamInfo {
  id: string;
  name: string;
  abbr: string;
  logo?: string;
  color: string;
  score: string;
  homeAway: 'home' | 'away';
  winner: boolean;
  squad: SquadPlayer[];
}

export interface MatchDetail {
  key: string; // `${leagueId}:${id}`
  id: string;
  leagueId: string;
  title: string; // "India v West Indies"
  series: string;
  description: string; // "4th T20I"
  venue: string;
  toss: string;
  state: MatchStateCode;
  statusText: string;
  summary: string; // "India require 151 runs"
  teams: TeamInfo[];
  innings: Innings[];
  currentInnings: number;
  battingTeamId?: string;
  recentBalls: Ball[];
  currentBatters: BatterLine[];
  currentBowler?: BowlerLine;
  partnership: { runs: number; balls: number };
  crr: number;
  rrr: number | null;
  need: { runs: number; balls: number } | null;
  notes: string[];
  lastUpdated: number;
  isDemo?: boolean;
}

/* ------------------------------------------------------------------ */
/* Events produced by the detector                                    */
/* ------------------------------------------------------------------ */

export type CricketEventType =
  | 'BALL'
  | 'FOUR'
  | 'SIX'
  | 'WICKET'
  | 'WIDE'
  | 'NOBALL'
  | 'OVER_END'
  | 'INNINGS_END'
  | 'MATCH_END'
  | 'MILESTONE_BAT'
  | 'MILESTONE_BOWL'
  | 'PARTNERSHIP'
  | 'HATTRICK_WATCH';

export interface CricketEvent {
  type: CricketEventType;
  matchKey: string;
  ball?: Ball;
  /** e.g. milestone value (50/100), partnership runs, over number */
  value?: number;
  player?: string;
  title: string;
  subtitle?: string;
  ts: number;
}

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */

export type Role = 'host' | 'guest' | 'program';
export const MAX_GUESTS = 4;

export interface Participant {
  id: string; // socket id
  name: string;
  role: Role;
  onStage: boolean;
  muted: boolean;
  camOff: boolean;
  screenSharing: boolean;
  joinedAt: number;
}

export type AutomationMode = 'auto' | 'assist' | 'manual';

export type Platform = 'youtube' | 'facebook' | 'x' | 'twitch' | 'custom';

export interface DestinationPublic {
  id: string;
  platform: Platform;
  name: string;
  url: string;
  keyMasked: string;
  enabled: boolean;
}

export interface DestinationStatus {
  id: string;
  platform: Platform;
  name: string;
  state: 'idle' | 'connecting' | 'live' | 'retrying' | 'error';
  error?: string;
  retries?: number;
}

export interface LiveStatus {
  state: 'idle' | 'starting' | 'live' | 'reconnecting' | 'stopping' | 'error';
  startedAt?: number;
  mode: 'mesh' | 'livekit';
  /** who composites the program: the host's browser or the cloud worker (24/7 autopilot) */
  broadcaster?: 'host' | 'cloud';
  reconnects?: number;
  fps?: number;
  bitrateKbps?: number;
  speed?: number;
  error?: string;
  destinations: DestinationStatus[];
}

export type AmbienceMood = 'calm' | 'buzzing' | 'packed';

export interface AmbienceState {
  on: boolean;
  volume: number; // 0..1
  mood: AmbienceMood;
}

export interface MusicState {
  track: string | null; // generated track id or upload url
  playing: boolean;
  volume: number; // 0..1
  duck: boolean;
  /** synthesised stadium crowd bed under the show */
  ambience?: AmbienceState;
}

export interface Branding {
  title: string;
  ticker: string;
  accent: string;
  showScorebug: boolean;
  showTicker: boolean;
  captions: boolean;
  sfx: boolean;
  sfxVolume: number;
  background: BackgroundId;
  /** transition used for manual cuts ('mixed' = vary automatically) */
  transition: TransitionId | 'mixed';
  /** use WebGL 3D celebrations (falls back to 2D automatically) */
  fx3d: boolean;
  pollQuestion: string;
}

export interface AutopilotSettings {
  /** run the show without a host: rotate scenes, music, AI commentary */
  enabled: boolean;
  sceneSeconds: number; // 3..30
  includeCameras: boolean;
  commentator: boolean;
  voice: string;
  /** seconds between unprompted commentary ("chatter") lines */
  chatterSeconds: number;
  autoMusic: boolean;
  /** pick a live match automatically and move on when it ends (24/7) */
  autoMatch: boolean;
  /** headless cloud worker renders + streams (no browser needed) */
  cloud: boolean;
}

export interface CommentaryLine {
  id: string;
  text: string;
  voice: string;
  priority: number;
  ts: number;
}

export const VOICES: { id: string; label: string }[] = [
  { id: 'en-IN-PrabhatNeural', label: 'Prabhat (India, male)' },
  { id: 'en-IN-NeerjaExpressiveNeural', label: 'Neerja (India, female, expressive)' },
  { id: 'en-GB-RyanNeural', label: 'Ryan (UK, male)' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia (UK, female)' },
  { id: 'en-AU-WilliamNeural', label: 'William (Australia, male)' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha (Australia, female)' },
  { id: 'en-US-AndrewNeural', label: 'Andrew (US, male)' },
  { id: 'en-ZA-LukeNeural', label: 'Luke (South Africa, male)' },
];

export interface AutomationRules {
  wicket: boolean;
  boundary: boolean;
  overEnd: boolean;
  milestones: boolean;
  inningsBreak: boolean;
  idleRotation: boolean;
  idleSeconds: number;
}

export interface StudioState {
  id: string;
  name: string;
  matchKey: string | null; // `${leagueId}:${eventId}` or 'demo:replay'
  participants: Participant[];
  scene: SceneId;
  /** scene to return to after a temporary automated scene */
  baseScene: SceneId;
  sceneUntil: number | null;
  overlay: ActiveOverlay | null;
  automation: AutomationMode;
  rules: AutomationRules;
  pinnedUntil: number;
  live: LiveStatus;
  music: MusicState;
  brand: Branding;
  countdownTo: number | null;
  spotlightId: string | null;
  autopilot: AutopilotSettings;
  /** transition for the current cut, chosen by the server so every renderer matches */
  transition: TransitionId;
  /** non-null when live is desired (survives restarts for 24/7 resume) */
  wantLive: boolean;
}

export interface ActiveOverlay {
  id: OverlayId;
  title: string;
  subtitle?: string;
  value?: number;
  sfx?: SfxId;
  startedAt: number;
  until: number;
  seq: number;
  priority?: number;
}

export interface Suggestion {
  id: string;
  scene?: SceneId;
  overlay?: OverlayId;
  reason: string;
  event: CricketEvent;
}

export interface ChatMessage {
  id: string;
  from: string;
  role: Role;
  text: string;
  ts: number;
}

export interface CaptionLine {
  from: string;
  text: string;
  final: boolean;
  ts: number;
}

export type SfxId =
  | 'batCrack'
  | 'crowdRoar'
  | 'boundaryHorn'
  | 'sixFanfare'
  | 'stumps'
  | 'wicketSting'
  | 'whoosh'
  | 'overChime'
  | 'applause'
  | 'milestone'
  | 'drumroll';

export type OverlayId =
  | 'four'
  | 'six'
  | 'wicket'
  | 'milestone'
  | 'fiveWickets'
  | 'partnership'
  | 'overSummary'
  | 'hattrick'
  | 'inningsEnd'
  | 'matchEnd'
  | 'custom';

/* Socket payloads ---------------------------------------------------- */

export interface JoinRequest {
  studioId: string;
  token: string;
  name: string;
  role: Role;
}

export interface JoinResponse {
  ok: boolean;
  error?: string;
  selfId?: string;
  state?: StudioState;
  iceServers?: RTCIceServerLike[];
  mediaMode?: 'mesh' | 'livekit';
}

export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RtcSignal {
  from?: string;
  to: string;
  data: unknown;
}

export interface StudioCreateResponse {
  id: string;
  name: string;
  hostToken: string;
  guestToken: string;
  programToken: string;
}

export const PLATFORM_PRESETS: Record<Platform, { label: string; url: string; color: string; help: string }> = {
  youtube: {
    label: 'YouTube',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    color: '#FF0000',
    help: 'YouTube Studio → Go live → Stream → copy "Stream key".',
  },
  facebook: {
    label: 'Facebook',
    url: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    color: '#1877F2',
    help: 'Facebook → Live Producer → Streaming software → copy "Stream key".',
  },
  x: {
    label: 'X (Twitter)',
    url: 'rtmps://va.pscp.tv:443/x',
    color: '#000000',
    help: 'X Media Studio → Producer → Sources → create source → copy RTMP URL + key.',
  },
  twitch: {
    label: 'Twitch',
    url: 'rtmp://live.twitch.tv/app',
    color: '#9146FF',
    help: 'Twitch Creator Dashboard → Settings → Stream → copy "Primary Stream key".',
  },
  custom: {
    label: 'Custom RTMP',
    url: 'rtmp://',
    color: '#5f6368',
    help: 'Any RTMP/RTMPS ingest (Kick, LinkedIn, Restream, your own server…).',
  },
};
