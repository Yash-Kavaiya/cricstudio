export type SceneId =
  | 'startingSoon'
  | 'hostSolo'
  | 'panel'
  | 'scoreHero'
  | 'ballByBall'
  | 'battingCard'
  | 'bowlingCard'
  | 'batters'
  | 'bowlerSpotlight'
  | 'manhattan'
  | 'worm'
  | 'fallOfWickets'
  | 'playingXI'
  | 'aroundGrounds'
  | 'commentaryDesk'
  | 'screenShare'
  | 'break'
  | 'result'
  // insights pack
  | 'winPredictor'
  | 'projectedScore'
  | 'phaseAnalysis'
  | 'boundaryTracker'
  | 'matchup'
  | 'wagonWheel'
  | 'starPerformer'
  | 'keyMoments'
  | 'upcomingMatches'
  | 'fanPoll'
  // analysis pack
  | 'runRateGraph'
  | 'overHeatmap'
  | 'scoringBreakdown'
  | 'partnerships'
  | 'battingImpact'
  | 'bowlingAnalysis'
  | 'dismissalAnalysis'
  | 'extrasDiscipline'
  | 'momentum'
  | 'inningsComparison'
  | 'chaseCalculator'
  | 'matchReport';

export interface SceneMeta {
  id: SceneId;
  name: string;
  short: string;
  group: 'Show' | 'Cameras' | 'Score' | 'Stats' | 'Insights' | 'Analysis' | 'Match';
  icon: string; // Material Symbols name
  usesCameras: boolean;
  hotkey?: string;
  /** included in the autopilot rotation */
  autopilot: boolean;
}

export const SCENES: SceneMeta[] = [
  { id: 'startingSoon', name: 'Starting Soon', short: 'Starting', group: 'Show', icon: 'schedule', usesCameras: false, hotkey: '1', autopilot: false },
  { id: 'hostSolo', name: 'Host Solo', short: 'Solo', group: 'Cameras', icon: 'person', usesCameras: true, hotkey: '2', autopilot: true },
  { id: 'panel', name: 'Expert Panel', short: 'Panel', group: 'Cameras', icon: 'groups', usesCameras: true, hotkey: '3', autopilot: true },
  { id: 'commentaryDesk', name: 'Commentary Desk', short: 'Desk', group: 'Cameras', icon: 'mic_external_on', usesCameras: true, hotkey: '4', autopilot: true },
  { id: 'scoreHero', name: 'Live Score', short: 'Score', group: 'Score', icon: 'scoreboard', usesCameras: false, hotkey: '5', autopilot: true },
  { id: 'ballByBall', name: 'Ball by Ball', short: 'Balls', group: 'Score', icon: 'sports_cricket', usesCameras: false, hotkey: '6', autopilot: true },
  { id: 'battingCard', name: 'Batting Scorecard', short: 'Batting', group: 'Score', icon: 'table_rows', usesCameras: false, hotkey: '7', autopilot: true },
  { id: 'bowlingCard', name: 'Bowling Figures', short: 'Bowling', group: 'Score', icon: 'sports_baseball', usesCameras: false, hotkey: '8', autopilot: true },
  { id: 'batters', name: 'At the Crease', short: 'Crease', group: 'Stats', icon: 'handshake', usesCameras: false, hotkey: '9', autopilot: true },
  { id: 'bowlerSpotlight', name: 'Bowler Spotlight', short: 'Bowler', group: 'Stats', icon: 'flare', usesCameras: false, autopilot: true },
  { id: 'manhattan', name: 'Manhattan', short: 'Manhattan', group: 'Stats', icon: 'bar_chart', usesCameras: false, autopilot: true },
  { id: 'worm', name: 'Worm', short: 'Worm', group: 'Stats', icon: 'show_chart', usesCameras: false, autopilot: true },
  { id: 'fallOfWickets', name: 'Fall of Wickets', short: 'FoW', group: 'Stats', icon: 'trending_down', usesCameras: false, autopilot: true },
  { id: 'winPredictor', name: 'Win Predictor', short: 'Win %', group: 'Insights', icon: 'percent', usesCameras: false, autopilot: true },
  { id: 'projectedScore', name: 'Projected Score', short: 'Projected', group: 'Insights', icon: 'query_stats', usesCameras: false, autopilot: true },
  { id: 'phaseAnalysis', name: 'Phase Analysis', short: 'Phases', group: 'Insights', icon: 'view_timeline', usesCameras: false, autopilot: true },
  { id: 'boundaryTracker', name: 'Boundary Tracker', short: 'Boundaries', group: 'Insights', icon: 'crisis_alert', usesCameras: false, autopilot: true },
  { id: 'matchup', name: 'Batter vs Bowler', short: 'Matchup', group: 'Insights', icon: 'swords', usesCameras: false, autopilot: true },
  { id: 'wagonWheel', name: 'Wagon Wheel', short: 'Wagon', group: 'Insights', icon: 'radar', usesCameras: false, autopilot: true },
  { id: 'starPerformer', name: 'Star Performer', short: 'Star', group: 'Insights', icon: 'military_tech', usesCameras: false, autopilot: true },
  { id: 'keyMoments', name: 'Key Moments', short: 'Moments', group: 'Insights', icon: 'timeline', usesCameras: false, autopilot: true },
  { id: 'runRateGraph', name: 'Run Rate Graph', short: 'Run rate', group: 'Analysis', icon: 'monitoring', usesCameras: false, autopilot: true },
  { id: 'overHeatmap', name: 'Over-by-Over Heatmap', short: 'Heatmap', group: 'Analysis', icon: 'grid_view', usesCameras: false, autopilot: true },
  { id: 'scoringBreakdown', name: 'Scoring Breakdown', short: 'Scoring', group: 'Analysis', icon: 'donut_large', usesCameras: false, autopilot: true },
  { id: 'partnerships', name: 'Partnerships', short: 'Partners', group: 'Analysis', icon: 'group_work', usesCameras: false, autopilot: true },
  { id: 'battingImpact', name: 'Batting Impact', short: 'Impact', group: 'Analysis', icon: 'bubble_chart', usesCameras: false, autopilot: true },
  { id: 'bowlingAnalysis', name: 'Bowling Analysis', short: 'Bowl stats', group: 'Analysis', icon: 'speed', usesCameras: false, autopilot: true },
  { id: 'dismissalAnalysis', name: 'How Wickets Fell', short: 'Dismissals', group: 'Analysis', icon: 'pie_chart', usesCameras: false, autopilot: true },
  { id: 'extrasDiscipline', name: 'Extras & Discipline', short: 'Extras', group: 'Analysis', icon: 'gavel', usesCameras: false, autopilot: true },
  { id: 'momentum', name: 'Momentum Swing', short: 'Momentum', group: 'Analysis', icon: 'swap_vert', usesCameras: false, autopilot: true },
  { id: 'inningsComparison', name: 'At This Stage', short: 'Compare', group: 'Analysis', icon: 'compare_arrows', usesCameras: false, autopilot: true },
  { id: 'chaseCalculator', name: 'Chase Calculator', short: 'Chase', group: 'Analysis', icon: 'calculate', usesCameras: false, autopilot: true },
  { id: 'matchReport', name: 'Match Report', short: 'Report', group: 'Analysis', icon: 'summarize', usesCameras: false, autopilot: true },
  { id: 'playingXI', name: 'Playing XIs & Toss', short: 'XIs', group: 'Match', icon: 'badge', usesCameras: false, autopilot: true },
  { id: 'aroundGrounds', name: 'Around the Grounds', short: 'Grounds', group: 'Match', icon: 'public', usesCameras: false, autopilot: true },
  { id: 'upcomingMatches', name: 'Upcoming Matches', short: 'Upcoming', group: 'Match', icon: 'event_upcoming', usesCameras: false, autopilot: true },
  { id: 'fanPoll', name: 'Fan Poll', short: 'Poll', group: 'Match', icon: 'how_to_vote', usesCameras: false, autopilot: true },
  { id: 'screenShare', name: 'Screen Share + PiP', short: 'Screen', group: 'Cameras', icon: 'present_to_all', usesCameras: true, hotkey: '0', autopilot: false },
  { id: 'break', name: 'Innings Break / BRB', short: 'Break', group: 'Show', icon: 'coffee', usesCameras: false, autopilot: false },
  { id: 'result', name: 'Result & Thanks', short: 'Result', group: 'Show', icon: 'emoji_events', usesCameras: false, autopilot: false },
];

export const SCENE_IDS = SCENES.map((s) => s.id);

/* ---------------- looks ---------------- */

export type BackgroundId =
  | 'stadiumNight'
  | 'pitchGreen'
  | 'aurora'
  | 'neonGrid'
  | 'constellation'
  | 'hexTech'
  | 'liquidWaves'
  | 'prism'
  | 'teamClash'
  | 'seamLines'
  | 'classic';

export const BACKGROUNDS: { id: BackgroundId; name: string; colors: [string, string] }[] = [
  { id: 'stadiumNight', name: 'Stadium Night', colors: ['#050a1a', '#1b2a52'] },
  { id: 'pitchGreen', name: 'Pitch Green', colors: ['#06210f', '#1f5d2c'] },
  { id: 'aurora', name: 'Aurora', colors: ['#071226', '#3b1d6e'] },
  { id: 'neonGrid', name: 'Neon Grid 3D', colors: ['#0d0221', '#ff2ea6'] },
  { id: 'constellation', name: 'Constellation', colors: ['#020617', '#1e3a8a'] },
  { id: 'hexTech', name: 'Hex Tech', colors: ['#03121c', '#0e7490'] },
  { id: 'liquidWaves', name: 'Liquid Waves', colors: ['#06132b', '#1a73e8'] },
  { id: 'prism', name: 'Prism Glass', colors: ['#120c24', '#ea4335'] },
  { id: 'teamClash', name: 'Team Clash', colors: ['#111827', '#f59e0b'] },
  { id: 'seamLines', name: 'Ball Seam', colors: ['#2a0606', '#b91c1c'] },
  { id: 'classic', name: 'Classic Glow', colors: ['#0b1020', '#111a33'] },
];

export type TransitionId = 'fadeZoom' | 'slideLeft' | 'wipeDiagonal' | 'circleReveal' | 'blinds' | 'flip3d' | 'pushUp' | 'stingerBall' | 'glitch' | 'zoomBlur';

export const TRANSITIONS: { id: TransitionId; name: string }[] = [
  { id: 'fadeZoom', name: 'Fade + zoom' },
  { id: 'slideLeft', name: 'Slide' },
  { id: 'wipeDiagonal', name: 'Diagonal wipe' },
  { id: 'circleReveal', name: 'Circle reveal' },
  { id: 'blinds', name: 'Blinds' },
  { id: 'flip3d', name: '3D flip' },
  { id: 'pushUp', name: 'Push up' },
  { id: 'stingerBall', name: 'Cricket-ball stinger' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'zoomBlur', name: 'Zoom blur' },
];
