export type SportType =
  | 'football' | 'basketball' | 'tennis' | 'baseball' | 'hockey'
  | 'rugby' | 'cricket' | 'mma' | 'handball' | 'volleyball'
  | 'american-football' | 'formula1' | 'motorsports' | 'esports'
  | 'boxing' | 'table-tennis' | 'badminton' | 'snooker' | 'darts'
  | 'cycling' | 'athletics' | 'afl' | string;

/** Sport-specific stat blobs stored in the `stats` JSONB column */
export interface FootballStats {
  sport: 'football';
}

export interface BasketballStats {
  sport?: 'basketball';
  home_q1?: number | null;
  home_q2?: number | null;
  home_q3?: number | null;
  home_q4?: number | null;
  home_ot?: number | null;
  away_q1?: number | null;
  away_q2?: number | null;
  away_q3?: number | null;
  away_q4?: number | null;
  away_ot?: number | null;
}

export interface TennisStats {
  sport?: 'tennis';
  home_sets?: number;
  away_sets?: number;
  thumb?: string | null;
}

export type MatchStats = BasketballStats | TennisStats | FootballStats | null;

export interface Match {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'live' | 'upcoming' | 'finished';
  matchTime: string;
  league: string;
  country?: string;
  venue?: string;
  minute?: number;
  round?: string;
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  /** Team/club logo URLs from the API feed */
  homeLogo?: string | null;
  awayLogo?: string | null;
  /** League logo URL (football: API-Football league logo) */
  leagueLogo?: string | null;
  /** Sport-specific stats (basketball quarters, tennis sets, etc.) */
  stats?: MatchStats;
  externalId?: string;
  /** Data quality score 0-100, computed from available enrichment data */
  dataQualityScore?: number;
}

/** Unified output schema v3 — covers all sports */
export interface Prediction {
  id: string;
  matchId: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  predictedResult: 'home_win' | 'draw' | 'away_win';
  confidence: number;
  overUnder: 'over' | 'under';
  overUnderLine: number;
  btts: 'yes' | 'no';
  aiAnalysis: string;
  keyFactors: string[];
  vipTip?: string;
  createdAt?: string;
  predictionVersion?: number;
  // Extended fields from full prediction model
  predictedHomeGoals?: number;
  predictedAwayGoals?: number;
  correctScore?: string;
  cornersOverUnder?: 'over' | 'under';
  cornersLine?: number;
  cardsTotal?: number;
  cardsOverUnder?: 'over' | 'under';
  asianHandicapLine?: number;
  asianHandicapPick?: 'home' | 'away';
  htResult?: 'home_win' | 'draw' | 'away_win';
  htHomeProb?: number;
  htDrawProb?: number;
  htAwayProb?: number;
  cleanSheetHome?: 'yes' | 'no';
  cleanSheetAway?: 'yes' | 'no';
  firstGoal?: 'home' | 'away' | 'no_goal';
  bothScoreHt?: 'yes' | 'no';
  anytimeScorecast?: string;
  // VIP Intelligence Module (now persisted in DB)
  riskLevel?: 'Low' | 'Medium' | 'High';
  valueScore?: number;
  marketEdgePct?: number;
  sharpSignal?: 'bullish' | 'neutral' | 'bearish';
  suggestedStake?: 'low' | 'medium' | 'high';
  predictionSummary?: string;
  keyAlphaMetric?: string;
  warningFlags?: string[];
}

export interface ChatRoom {
  id: string;
  name: string;
  description?: string;
  type: string;
  emoji?: string;
  membersCount?: number;
  lastMessage?: string;
  matchId?: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
  /** Emoji reactions: { '👍': ['userId1', 'userId2'], ... } */
  reactions?: Record<string, string[]>;
  /** Whether this message is pinned in the room */
  isPinned?: boolean;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: 'live' | 'prediction' | 'vip' | 'reminder' | 'result' | 'general' | 'goal' | 'system' | 'challenge' | 'referral';
  read: boolean;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  isVip?: boolean;
  predictions?: number;
  winRate?: number;
  streak?: number;
}
