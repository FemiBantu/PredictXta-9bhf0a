/**
 * services/sportConfig.ts
 *
 * Sport-specific configuration: terminology, markets, stat labels,
 * prediction chip visibility, and overview engine selectors.
 *
 * Supported sports (13): football, basketball, tennis, cricket, baseball,
 * hockey, rugby, handball, volleyball, american-football, mma, boxing, esports
 *
 * RULE: No football-specific metric (BTTS, xG, corners, possession,
 * formation, halftime-score) must ever render for non-football sports.
 */

// ─── Sport classifier helpers ─────────────────────────────────────────────────
export type SportFamily =
  | 'football'
  | 'basketball'
  | 'tennis'
  | 'cricket'
  | 'baseball'
  | 'hockey'
  | 'american_football'
  | 'rugby'
  | 'mma'
  | 'boxing'
  | 'volleyball'
  | 'handball'
  | 'esports'
  | 'generic';

export function getSportFamily(sport?: string | null): SportFamily {
  // Normalize: lowercase, strip ALL separators (hyphens, spaces, underscores)
  const s = (sport ?? '').toLowerCase().replace(/[-_\s]+/g, '');
  if (s === 'football' || s === 'soccer') return 'football';
  if (s === 'basketball') return 'basketball';
  if (s === 'tennis') return 'tennis';
  if (s === 'cricket') return 'cricket';
  if (s === 'baseball') return 'baseball';
  if (s === 'hockey' || s === 'icehockey') return 'hockey';
  if (s === 'americanfootball' || s === 'nfl') return 'american_football';
  if (s.includes('rugby')) return 'rugby';
  if (s === 'mma' || s === 'ufc') return 'mma';
  if (s === 'boxing') return 'boxing';
  if (s === 'volleyball') return 'volleyball';
  if (s === 'handball') return 'handball';
  if (s === 'esports' || s === 'esport') return 'esports';
  // Removed sports (formula1, afl, badminton, table-tennis, snooker, darts,
  // cycling, athletics, motorsports, squash) are no longer active.
  // They fall through to 'generic' which renders a minimal sport-agnostic UI.
  return 'generic';
}

// ─── Sport terminology (score labels, result labels) ─────────────────────────
export interface SportTerms {
  scoreUnit: string;         // "goals", "points", "runs", "sets"
  resultLabels: [string, string, string]; // [home, draw, away] or [home, -, away]
  hasDraw: boolean;
  scoreEmoji: string;
  sportEmoji: string;
  winLabel: string;          // "Win", "Victory", "Win"
  drawLabel: string;         // "Draw", "Tie", "Stalemate"
  predictionTitle: string;   // "Match Prediction", "Fight Prediction"
  scoringModelTitle: string; // "Goal Probability", "Points Projection"
  overUnderLabel: (line: number) => string; // "Over 2.5 Goals", "Over 215.5 Pts"
}

// Boxing and Esports terms
const BOXING_TERMS: SportTerms = {
  scoreUnit: 'rounds', resultLabels: ['1 Home Win', 'X Draw', '2 Away Win'],
  hasDraw: true, scoreEmoji: '🥊', sportEmoji: '🥊', winLabel: 'Win',
  drawLabel: 'Draw', predictionTitle: 'Fight Prediction',
  scoringModelTitle: 'Fight Outcome Model',
  overUnderLabel: (l) => `Over/Under ${l} Rounds`,
};
const ESPORTS_TERMS: SportTerms = {
  scoreUnit: 'maps', resultLabels: ['Home Win', '—', 'Away Win'],
  hasDraw: false, scoreEmoji: '🎮', sportEmoji: '🎮', winLabel: 'Win',
  drawLabel: '—', predictionTitle: 'Match Prediction',
  scoringModelTitle: 'Win Probability Model',
  overUnderLabel: (l) => `Over/Under ${l} Maps`,
};

const SPORT_TERMS: Record<SportFamily, SportTerms> = {
  football: {
    scoreUnit: 'goals', resultLabels: ['1 Home Win', 'X Draw', '2 Away Win'],
    hasDraw: true, scoreEmoji: '⚽', sportEmoji: '⚽', winLabel: 'Win',
    drawLabel: 'Draw', predictionTitle: 'Match Prediction',
    scoringModelTitle: 'Goal Probability Model',
    overUnderLabel: (l) => `Over/Under ${l} Goals`,
  },
  basketball: {
    scoreUnit: 'points', resultLabels: ['Home Win', '—', 'Away Win'],
    hasDraw: false, scoreEmoji: '🏀', sportEmoji: '🏀', winLabel: 'Win',
    drawLabel: 'Tie', predictionTitle: 'Game Prediction',
    scoringModelTitle: 'Points Projection Model',
    overUnderLabel: (l) => `Over/Under ${l} Pts`,
  },
  tennis: {
    scoreUnit: 'sets', resultLabels: ['Home Win', '—', 'Away Win'],
    hasDraw: false, scoreEmoji: '🎾', sportEmoji: '🎾', winLabel: 'Victory',
    drawLabel: '—', predictionTitle: 'Match Winner Prediction',
    scoringModelTitle: 'Win Probability Model',
    overUnderLabel: (l) => `Over/Under ${l} Sets`,
  },
  cricket: {
    scoreUnit: 'runs', resultLabels: ['Home Win', '—', 'Away Win'],
    hasDraw: false, scoreEmoji: '🏏', sportEmoji: '🏏', winLabel: 'Win',
    drawLabel: 'Tie', predictionTitle: 'Match Prediction',
    scoringModelTitle: 'Runs Projection Model',
    overUnderLabel: (l) => `Over/Under ${l} Runs`,
  },
  baseball: {
    scoreUnit: 'runs', resultLabels: ['Home Win', '—', 'Away Win'],
    hasDraw: false, scoreEmoji: '⚾', sportEmoji: '⚾', winLabel: 'Win',
    drawLabel: '—', predictionTitle: 'Game Prediction',
    scoringModelTitle: 'Run Line Projection',
    overUnderLabel: (l) => `Over/Under ${l} Runs`,
  },
  hockey: {
    scoreUnit: 'goals', resultLabels: ['Home Win', '—', 'Away Win'],
    hasDraw: false, scoreEmoji: '🏒', sportEmoji: '🏒', winLabel: 'Win',
    drawLabel: 'OT/SO', predictionTitle: 'Game Prediction',
    scoringModelTitle: 'Goals Projection Model',
    overUnderLabel: (l) => `Over/Under ${l} Goals`,
  },
  american_football: {
    scoreUnit: 'points', resultLabels: ['Home Win', '—', 'Away Win'],
    hasDraw: false, scoreEmoji: '🏈', sportEmoji: '🏈', winLabel: 'Win',
    drawLabel: 'Tie', predictionTitle: 'Game Prediction',
    scoringModelTitle: 'Points Total Projection',
    overUnderLabel: (l) => `Over/Under ${l} Pts`,
  },
  rugby: {
    scoreUnit: 'points', resultLabels: ['1 Home Win', 'X Draw', '2 Away Win'],
    hasDraw: true, scoreEmoji: '🏉', sportEmoji: '🏉', winLabel: 'Win',
    drawLabel: 'Draw', predictionTitle: 'Match Prediction',
    scoringModelTitle: 'Points Projection Model',
    overUnderLabel: (l) => `Over/Under ${l} Pts`,
  },
  mma: {
    scoreUnit: 'rounds', resultLabels: ['Home Win', '—', 'Away Win'],
    hasDraw: false, scoreEmoji: '🥊', sportEmoji: '🥊', winLabel: 'Win',
    drawLabel: 'Draw', predictionTitle: 'Fight Prediction',
    scoringModelTitle: 'Fight Outcome Model',
    overUnderLabel: (l) => `Over/Under ${l} Rounds`,
  },
  volleyball: {
    scoreUnit: 'sets', resultLabels: ['Home Win', '—', 'Away Win'],
    hasDraw: false, scoreEmoji: '🏐', sportEmoji: '🏐', winLabel: 'Win',
    drawLabel: '—', predictionTitle: 'Match Prediction',
    scoringModelTitle: 'Set Projection Model',
    overUnderLabel: (l) => `Over/Under ${l} Sets`,
  },
  handball: {
    scoreUnit: 'goals', resultLabels: ['1 Home Win', 'X Draw', '2 Away Win'],
    hasDraw: true, scoreEmoji: '🤾', sportEmoji: '🤾', winLabel: 'Win',
    drawLabel: 'Draw', predictionTitle: 'Match Prediction',
    scoringModelTitle: 'Goals Projection Model',
    overUnderLabel: (l) => `Over/Under ${l} Goals`,
  },
  boxing: BOXING_TERMS,
  esports: ESPORTS_TERMS,
  generic: {
    scoreUnit: 'points', resultLabels: ['Home Win', 'Draw', 'Away Win'],
    hasDraw: false, scoreEmoji: '🏆', sportEmoji: '🏆', winLabel: 'Win',
    drawLabel: 'Draw', predictionTitle: 'Match Prediction',
    scoringModelTitle: 'Probability Model',
    overUnderLabel: (l) => `Over/Under ${l}`,
  },
};

export function getSportTerms(sport?: string | null): SportTerms {
  return SPORT_TERMS[getSportFamily(sport)] ?? SPORT_TERMS.generic;
}

// ─── Prediction chip visibility config ───────────────────────────────────────
// Determines which prediction chips render in the InlineMatchCard
export interface PredictionChipConfig {
  showResult: boolean;      // "1 HOME / X / 2 AWAY" or "Win"
  showOverUnder: boolean;   // O/U Goals / Points / Sets
  showBTTS: boolean;        // Both Teams to Score (FOOTBALL ONLY)
  showSpread: boolean;      // Points spread (basketball, NFL)
  showSets: boolean;        // Set score / set handicap (tennis, volleyball)
  showRounds: boolean;      // Round O/U (MMA, boxing)
  showRuns: boolean;        // Run line (baseball, cricket)
  showMethod: boolean;      // Method of victory (MMA)
  overUnderUnit: string;    // "Goals", "Points", "Sets", "Runs"
  resultChipLabel: (result: string, home: string, away: string) => string;
}

const BOXING_CHIP: PredictionChipConfig = {
  showResult: true, showOverUnder: false, showBTTS: false,
  showSpread: false, showSets: false, showRounds: true,
  showRuns: false, showMethod: true, overUnderUnit: 'Rounds',
  resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : r === 'away_win' ? `${a.split(' ').slice(-1)[0]} WIN` : 'DRAW',
};
const ESPORTS_CHIP: PredictionChipConfig = {
  showResult: true, showOverUnder: true, showBTTS: false,
  showSpread: false, showSets: false, showRounds: false,
  showRuns: false, showMethod: false, overUnderUnit: 'Maps',
  resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
};

const CHIP_CONFIGS: Record<SportFamily, PredictionChipConfig> = {
  football: {
    showResult: true, showOverUnder: true, showBTTS: true,
    showSpread: false, showSets: false, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: 'Goals',
    resultChipLabel: (r, h, a) => r === 'home_win' ? '1 HOME' : r === 'away_win' ? '2 AWAY' : 'X DRAW',
  },
  basketball: {
    showResult: true, showOverUnder: true, showBTTS: false,
    showSpread: true, showSets: false, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: 'Pts',
    resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
  },
  tennis: {
    showResult: true, showOverUnder: false, showBTTS: false,
    showSpread: false, showSets: true, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: 'Sets',
    resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
  },
  cricket: {
    showResult: true, showOverUnder: true, showBTTS: false,
    showSpread: false, showSets: false, showRounds: false,
    showRuns: true, showMethod: false, overUnderUnit: 'Runs',
    resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
  },
  baseball: {
    showResult: true, showOverUnder: true, showBTTS: false,
    showSpread: false, showSets: false, showRounds: false,
    showRuns: true, showMethod: false, overUnderUnit: 'Runs',
    resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
  },
  hockey: {
    showResult: true, showOverUnder: true, showBTTS: false,
    showSpread: false, showSets: false, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: 'Goals',
    resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
  },
  american_football: {
    showResult: true, showOverUnder: true, showBTTS: false,
    showSpread: true, showSets: false, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: 'Pts',
    resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
  },
  rugby: {
    showResult: true, showOverUnder: true, showBTTS: false,
    showSpread: false, showSets: false, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: 'Pts',
    resultChipLabel: (r, h, a) => r === 'home_win' ? '1 HOME' : r === 'away_win' ? '2 AWAY' : 'X DRAW',
  },
  mma: {
    showResult: true, showOverUnder: false, showBTTS: false,
    showSpread: false, showSets: false, showRounds: true,
    showRuns: false, showMethod: true, overUnderUnit: 'Rounds',
    resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
  },
  volleyball: {
    showResult: true, showOverUnder: true, showBTTS: false,
    showSpread: false, showSets: true, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: 'Sets',
    resultChipLabel: (r, h, a) => r === 'home_win' ? `${h.split(' ').slice(-1)[0]} WIN` : `${a.split(' ').slice(-1)[0]} WIN`,
  },
  handball: {
    showResult: true, showOverUnder: true, showBTTS: false,
    showSpread: false, showSets: false, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: 'Goals',
    resultChipLabel: (r, h, a) => r === 'home_win' ? '1 HOME' : r === 'away_win' ? '2 AWAY' : 'X DRAW',
  },
  boxing: BOXING_CHIP,
  esports: ESPORTS_CHIP,
  generic: {
    showResult: true, showOverUnder: false, showBTTS: false,
    showSpread: false, showSets: false, showRounds: false,
    showRuns: false, showMethod: false, overUnderUnit: '',
    resultChipLabel: (r, h, a) => r === 'home_win' ? 'HOME WIN' : r === 'away_win' ? 'AWAY WIN' : 'DRAW',
  },
};

export function getPredChipConfig(sport?: string | null): PredictionChipConfig {
  return CHIP_CONFIGS[getSportFamily(sport)] ?? CHIP_CONFIGS.generic;
}

// ─── Overview stat sections ────────────────────────────────────────────────────
export interface SportOverviewSection {
  title: string;
  metrics: Array<{ label: string; homeKey?: string; awayKey?: string; description?: string }>;
}

export function getSportOverviewSections(sport?: string | null): SportOverviewSection[] {
  const family = getSportFamily(sport);
  switch (family) {
    case 'football':
      return [
        { title: 'ATTACKING', metrics: [
          { label: 'Goals Scored' }, { label: 'xG' }, { label: 'Shots on Target' },
          { label: 'xG per Game' }, { label: 'Scoring Form' },
        ]},
        { title: 'DEFENSIVE', metrics: [
          { label: 'Goals Conceded' }, { label: 'xGA' }, { label: 'Clean Sheets' },
          { label: 'BTTS Rate' }, { label: 'Defensive Form' },
        ]},
        { title: 'KEY STATS', metrics: [
          { label: 'Possession Avg' }, { label: 'Over 2.5 Rate' }, { label: 'BTTS %' },
          { label: 'Home/Away Form' }, { label: 'Head-to-Head' },
        ]},
      ];
    case 'basketball':
      return [
        { title: 'OFFENSE', metrics: [
          { label: 'Points Per Game' }, { label: 'Offensive Rating' },
          { label: 'Field Goal %' }, { label: '3-Point %' }, { label: 'Fast Break Pts' },
        ]},
        { title: 'DEFENSE', metrics: [
          { label: 'Points Allowed' }, { label: 'Defensive Rating' },
          { label: 'Rebounds/Game' }, { label: 'Blocks' }, { label: 'Steals' },
        ]},
        { title: 'EFFICIENCY', metrics: [
          { label: 'Assists/Game' }, { label: 'Turnovers/Game' },
          { label: 'Pace' }, { label: 'Win %' }, { label: 'Home/Away Record' },
        ]},
      ];
    case 'tennis':
      return [
        { title: 'SERVE', metrics: [
          { label: 'Serve Win %' }, { label: '1st Serve In %' },
          { label: 'Aces/Match' }, { label: 'Double Faults' }, { label: 'Service Games Won' },
        ]},
        { title: 'RETURN', metrics: [
          { label: 'Break Point Conv. %' }, { label: 'Return Win %' },
          { label: 'Winners/Match' }, { label: 'Unforced Errors' },
        ]},
        { title: 'RANKING & FORM', metrics: [
          { label: 'ATP/WTA Ranking' }, { label: 'Surface Win Rate' },
          { label: 'Head-to-Head' }, { label: 'Last 10 Matches' },
        ]},
      ];
    case 'cricket':
      return [
        { title: 'BATTING', metrics: [
          { label: 'Batting Average' }, { label: 'Strike Rate' },
          { label: 'Run Rate (recent)' }, { label: 'Powerplay Score' },
        ]},
        { title: 'BOWLING', metrics: [
          { label: 'Bowling Average' }, { label: 'Economy Rate' },
          { label: 'Wickets/Match' }, { label: 'Death Overs Economy' },
        ]},
        { title: 'CONDITIONS', metrics: [
          { label: 'Venue Stats' }, { label: 'ICC Ranking' },
          { label: 'Form (last 5)' }, { label: 'Head-to-Head' },
        ]},
      ];
    case 'baseball':
      return [
        { title: 'PITCHING', metrics: [
          { label: 'ERA' }, { label: 'WHIP' },
          { label: 'Strikeouts/9' }, { label: 'Walks/9' },
        ]},
        { title: 'BATTING', metrics: [
          { label: 'Batting Average' }, { label: 'OPS' },
          { label: 'Runs Per Game' }, { label: 'Home Runs' }, { label: 'RBI' },
        ]},
        { title: 'TEAM RECORD', metrics: [
          { label: 'Win %' }, { label: 'Home/Away Splits' },
          { label: 'Run Differential' }, { label: 'Bullpen ERA' },
        ]},
      ];
    case 'hockey':
      return [
        { title: 'SCORING', metrics: [
          { label: 'Goals/Game' }, { label: 'Shots/Game' },
          { label: 'Power Play %' }, { label: 'PP Goals' },
        ]},
        { title: 'DEFENSE', metrics: [
          { label: 'Goals Against/Game' }, { label: 'Save Percentage' },
          { label: 'Penalty Kill %' }, { label: 'Shots Allowed' },
        ]},
        { title: 'RECORD', metrics: [
          { label: 'Win % (incl. OT/SO)' }, { label: 'Home/Away Form' },
          { label: 'Head-to-Head' },
        ]},
      ];
    case 'american_football':
      return [
        { title: 'OFFENSE', metrics: [
          { label: 'Points/Game' }, { label: 'Passing Yards/Game' },
          { label: 'Rushing Yards/Game' }, { label: 'Red Zone Efficiency' },
        ]},
        { title: 'DEFENSE', metrics: [
          { label: 'Points Allowed' }, { label: 'Yards Allowed' },
          { label: 'Turnover Differential' }, { label: 'Sacks' },
        ]},
        { title: 'RECORD', metrics: [
          { label: 'Win %' }, { label: 'ATS Record' },
          { label: 'Over/Under Record' }, { label: 'Home/Away' },
        ]},
      ];
    case 'rugby':
      return [
        { title: 'ATTACK', metrics: [
          { label: 'Points/Match' }, { label: 'Tries Scored' },
          { label: 'Conversion Rate' }, { label: 'Penalty Goals' },
        ]},
        { title: 'DEFENSE', metrics: [
          { label: 'Points Conceded' }, { label: 'Tries Against' },
          { label: 'Tackles' }, { label: 'Turnovers Won' },
        ]},
        { title: 'SET PIECE', metrics: [
          { label: 'Scrum Win %' }, { label: 'Lineout Success %' },
          { label: 'Possession %' }, { label: 'Territory %' },
        ]},
      ];
    case 'mma':
      return [
        { title: 'STRIKING', metrics: [
          { label: 'Sig. Strikes/Min' }, { label: 'Striking Accuracy' },
          { label: 'Striking Defense' }, { label: 'Knockdowns' },
        ]},
        { title: 'GRAPPLING', metrics: [
          { label: 'Takedown Accuracy' }, { label: 'Takedown Defense' },
          { label: 'Submission Attempts' }, { label: 'Ground Control' },
        ]},
        { title: 'RECORD', metrics: [
          { label: 'Win/Loss/Draw' }, { label: 'KO/TKO Rate' },
          { label: 'Submission Rate' }, { label: 'Decision Rate' },
        ]},
      ];
    case 'volleyball':
      return [
        { title: 'ATTACK', metrics: [
          { label: 'Attack Efficiency' }, { label: 'Points/Set' },
          { label: 'Aces' }, { label: 'Block Points' },
        ]},
        { title: 'DEFENSE', metrics: [
          { label: 'Digs' }, { label: 'Errors' },
          { label: 'Reception Quality' },
        ]},
        { title: 'RECORD', metrics: [
          { label: 'Win %' }, { label: 'Sets Won/Lost' },
          { label: 'Head-to-Head' },
        ]},
      ];
    case 'handball':
      return [
        { title: 'ATTACK', metrics: [
          { label: 'Goals/Game' }, { label: 'Shot Efficiency' },
          { label: 'Fast Break Goals' }, { label: '7m Conversion' },
        ]},
        { title: 'DEFENSE', metrics: [
          { label: 'Goals Conceded' }, { label: 'Save Rate' },
          { label: 'Blocks' }, { label: 'Turnovers Forced' },
        ]},
        { title: 'RECORD', metrics: [
          { label: 'Win %' }, { label: 'Home/Away' }, { label: 'Head-to-Head' },
        ]},
      ];
    default:
      return [
        { title: 'PERFORMANCE', metrics: [
          { label: 'Win Rate' }, { label: 'Recent Form' }, { label: 'Head-to-Head' },
        ]},
      ];
  }
}

// ─── AI Markets available by sport family ────────────────────────────────────
export interface SportMarketGroup {
  id: string;
  label: string;
  emoji: string;
  markets: string[];
}

export function getSportMarketGroups(sport?: string | null): SportMarketGroup[] {
  const family = getSportFamily(sport);
  switch (family) {
    case 'football':
      return [
        { id: 'result', label: 'Match Result', emoji: '🏆', markets: ['1X2', 'Double Chance', 'Draw No Bet'] },
        { id: 'goals', label: 'Goals Markets', emoji: '⚽', markets: ['Over/Under 2.5', 'Both Teams to Score', 'Correct Score', 'xG Projection'] },
        { id: 'halftime', label: 'Half Time', emoji: '⏱️', markets: ['Half Time Result', 'HT/FT', 'Both Score HT'] },
        { id: 'asian', label: 'Asian Markets', emoji: '🎯', markets: ['Asian Handicap', 'Over/Under 1.5', 'Over/Under 3.5'] },
        { id: 'special', label: 'Specials', emoji: '⭐', markets: ['First Goal Scorer', 'Clean Sheet', 'Corners O/U', 'Cards O/U'] },
      ];
    case 'basketball':
      return [
        { id: 'result', label: 'Game Result', emoji: '🏀', markets: ['Moneyline', 'To Win (incl. OT)'] },
        { id: 'spread', label: 'Spread', emoji: '📊', markets: ['Points Spread', 'Alternative Spread'] },
        { id: 'totals', label: 'Totals', emoji: '📈', markets: ['Game Total', 'Team Totals', 'Half Totals'] },
        { id: 'quarter', label: 'Quarter Markets', emoji: '🔔', markets: ['1st Quarter Winner', 'Quarter Totals'] },
        { id: 'special', label: 'Specials', emoji: '⭐', markets: ['Team to Score 100+', 'Double Double', 'Triple Double'] },
      ];
    case 'tennis':
      return [
        { id: 'winner', label: 'Match Winner', emoji: '🎾', markets: ['Match Winner', 'Straight Sets'] },
        { id: 'sets', label: 'Sets', emoji: '📊', markets: ['Total Sets O/U', 'Set Handicap', 'Set Score'] },
        { id: 'games', label: 'Games', emoji: '🔢', markets: ['Total Games O/U', 'Games Handicap'] },
        { id: 'serve', label: 'Serve Markets', emoji: '⚡', markets: ['Aces O/U', 'Double Faults O/U', 'First Set Winner'] },
      ];
    case 'cricket':
      return [
        { id: 'result', label: 'Match Result', emoji: '🏏', markets: ['Match Winner', 'Toss Winner'] },
        { id: 'runs', label: 'Runs', emoji: '📊', markets: ['Team Total Runs', 'Match Runs O/U'] },
        { id: 'wickets', label: 'Wickets', emoji: '🎯', markets: ['Wickets O/U', 'Method of 1st Dismissal'] },
        { id: 'player', label: 'Player Props', emoji: '⭐', markets: ['Top Batsman', 'Top Bowler', 'Player to Score 50+'] },
      ];
    case 'baseball':
      return [
        { id: 'result', label: 'Game Result', emoji: '⚾', markets: ['Moneyline', 'Run Line (-1.5)'] },
        { id: 'totals', label: 'Run Totals', emoji: '📊', markets: ['Game Total Runs', 'Team Total Runs', 'Innings Totals'] },
        { id: 'pitcher', label: 'Pitching Props', emoji: '⚡', markets: ['Strikeouts O/U', 'Pitcher Win'] },
        { id: 'player', label: 'Batting Props', emoji: '⭐', markets: ['Home Runs', 'RBI O/U', 'Hits O/U'] },
      ];
    case 'hockey':
      return [
        { id: 'result', label: 'Game Result', emoji: '🏒', markets: ['Moneyline', 'Puck Line (-1.5)', 'Draw No Bet'] },
        { id: 'goals', label: 'Goal Totals', emoji: '🎯', markets: ['Total Goals O/U', 'Team Goals O/U', 'Period Goals'] },
        { id: 'special', label: 'Specials', emoji: '⭐', markets: ['First Goal Scorer', 'Power Play Goals', 'Shots O/U'] },
      ];
    case 'american_football':
      return [
        { id: 'result', label: 'Game Result', emoji: '🏈', markets: ['Moneyline', 'Spread'] },
        { id: 'totals', label: 'Point Totals', emoji: '📊', markets: ['Game Total', 'Team Totals', 'Half Totals'] },
        { id: 'quarter', label: 'Quarter Markets', emoji: '🔔', markets: ['1st Quarter Winner', 'Quarter Totals'] },
        { id: 'player', label: 'Player Props', emoji: '⭐', markets: ['Passing Yards', 'Rushing Yards', 'TDs'] },
      ];
    case 'rugby':
      return [
        { id: 'result', label: 'Match Result', emoji: '🏉', markets: ['1X2', 'Draw No Bet', 'Handicap'] },
        { id: 'points', label: 'Points', emoji: '📊', markets: ['Total Points O/U', 'Winning Margin'] },
        { id: 'tries', label: 'Tries', emoji: '🎯', markets: ['Total Tries O/U', 'Both Teams to Score a Try', 'First Try Scorer'] },
        { id: 'half', label: 'Half Time', emoji: '⏱️', markets: ['Half Time Result', 'Half Time/Full Time'] },
      ];
    case 'mma':
      return [
        { id: 'winner', label: 'Fight Winner', emoji: '🥊', markets: ['Winner', 'Win by Method'] },
        { id: 'rounds', label: 'Rounds', emoji: '🔔', markets: ['Total Rounds O/U', 'Specific Round Stoppage'] },
        { id: 'method', label: 'Method of Victory', emoji: '⚡', markets: ['KO/TKO', 'Submission', 'Decision'] },
        { id: 'distance', label: 'Fight Distance', emoji: '📊', markets: ['Fight to Go to Decision', 'Round Betting'] },
      ];
    case 'volleyball':
      return [
        { id: 'result', label: 'Match Result', emoji: '🏐', markets: ['Match Winner', 'Set Handicap'] },
        { id: 'sets', label: 'Sets', emoji: '📊', markets: ['Total Sets O/U', 'Set Score'] },
        { id: 'special', label: 'Specials', emoji: '⭐', markets: ['Points O/U', 'Aces O/U'] },
      ];
    case 'handball':
      return [
        { id: 'result', label: 'Match Result', emoji: '🤾', markets: ['1X2', 'Double Chance'] },
        { id: 'goals', label: 'Goals', emoji: '🎯', markets: ['Total Goals O/U', 'Both Teams Score 20+'] },
        { id: 'special', label: 'Specials', emoji: '⭐', markets: ['Winning Margin', '7m Penalty'] },
      ];
    default:
      return [
        { id: 'result', label: 'Match Result', emoji: '🏆', markets: ['Winner'] },
      ];
  }
}

// ─── Prediction filter compatibility ─────────────────────────────────────────
// Returns which PredFilter IDs are meaningful for each sport
export function getAvailablePredFilters(sport?: string | null): string[] {
  const family = getSportFamily(sport);
  const universal = ['All', 'home_win', 'away_win', 'high_conf'];
  switch (family) {
    case 'football':
      return [...universal, 'draw', 'over', 'under', 'btts_yes', 'btts_no'];
    case 'basketball':
    case 'hockey':
    case 'american_football':
      return [...universal, 'over', 'under'];
    case 'tennis':
    case 'volleyball':
    case 'cricket':
    case 'baseball':
      return [...universal, 'over', 'under'];
    case 'rugby':
    case 'handball':
      return [...universal, 'draw', 'over', 'under'];
    case 'mma':
      return universal;
    default:
      return universal;
  }
}

// ─── Accuracy market pills — sport-specific labels for AI accuracy banners ───────
export interface AccuracyMarketPill {
  label: string;
  pct: number;
  icon: string;
}

export function getSportAccuracyMarkets(
  sport: string | null | undefined,
  basePct: number,
): AccuracyMarketPill[] {
  const family = getSportFamily(sport);
  switch (family) {
    case 'basketball':
      return [
        { label: 'Game Winner',  pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Points', pct: Math.min(74, basePct + 14), icon: 'trending-up-outline' },
        { label: 'Spread',       pct: Math.min(66, basePct + 6),  icon: 'analytics-outline' },
      ];
    case 'tennis':
      return [
        { label: 'Match Winner', pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Sets',   pct: Math.min(73, basePct + 13), icon: 'trending-up-outline' },
        { label: 'First Set',    pct: Math.min(67, basePct + 7),  icon: 'flash-outline' },
      ];
    case 'cricket':
      return [
        { label: 'Match Winner', pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Runs',   pct: Math.min(70, basePct + 10), icon: 'trending-up-outline' },
        { label: 'Top Batsman',  pct: Math.min(62, basePct + 2),  icon: 'stats-chart-outline' },
      ];
    case 'mma':
      return [
        { label: 'Fight Winner', pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Method',       pct: Math.min(65, basePct + 5),  icon: 'flash-outline' },
        { label: 'Round O/U',    pct: Math.min(70, basePct + 10), icon: 'trending-up-outline' },
      ];
    case 'rugby':
      return [
        { label: 'Match Winner', pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Points', pct: Math.min(72, basePct + 12), icon: 'trending-up-outline' },
        { label: 'Try Scorer',   pct: Math.min(60, basePct),      icon: 'analytics-outline' },
      ];
    case 'volleyball':
      return [
        { label: 'Match Winner', pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Sets',   pct: Math.min(74, basePct + 14), icon: 'trending-up-outline' },
        { label: 'Set Winner',   pct: Math.min(68, basePct + 8),  icon: 'flash-outline' },
      ];
    case 'handball':
      return [
        { label: 'Match Result', pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Goals',  pct: Math.min(73, basePct + 13), icon: 'trending-up-outline' },
        { label: 'Both 20+',     pct: Math.min(67, basePct + 7),  icon: 'swap-horizontal-outline' },
      ];
    case 'baseball':
      return [
        { label: 'Game Winner',  pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Runs',   pct: Math.min(72, basePct + 12), icon: 'trending-up-outline' },
        { label: 'Run Line',     pct: Math.min(64, basePct + 4),  icon: 'analytics-outline' },
      ];
    case 'hockey':
      return [
        { label: 'Game Winner',  pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Goals',  pct: Math.min(74, basePct + 14), icon: 'trending-up-outline' },
        { label: 'Powerplay',    pct: Math.min(63, basePct + 3),  icon: 'flash-outline' },
      ];
    case 'american_football':
      return [
        { label: 'Game Winner',  pct: basePct,                    icon: 'trophy-outline' },
        { label: 'Total Points', pct: Math.min(73, basePct + 13), icon: 'trending-up-outline' },
        { label: 'Spread',       pct: Math.min(65, basePct + 5),  icon: 'analytics-outline' },
      ];
    default: // football / soccer + all others
      return [
        { label: 'Match Result', pct: basePct,                    icon: 'football-outline' },
        { label: 'Over/Under',   pct: Math.min(72, basePct + 12), icon: 'trending-up-outline' },
        { label: 'BTTS',         pct: Math.min(68, basePct + 8),  icon: 'swap-horizontal-outline' },
      ];
  }
}
