/**
 * services/predictionVoteService.ts
 *
 * Handles community voting (like/dislike) on AI predictions per match,
 * expert predictions fetch, and consensus strength calculation.
 */

import { getSupabaseClient } from '@/template';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VoteType = 'like' | 'dislike';

export interface VoteCount {
  predictionId: string;
  likes: number;
  dislikes: number;
  userVote: VoteType | null;
}

export interface ExpertPrediction {
  id: string;
  fixtureId: string;
  predictionType: string;
  prediction: string;
  expertSource: string;
  expertCount: number;
  expertsSupporting: number;
  totalExperts: number;
  expertAccuracy: number;
  sport: string;
  odds: number | null;
  createdAt: string;
}

export interface ConsensusResult {
  aiPrediction: string;
  expertPrediction: string;
  agreementScore: number; // 0–100
  consensusRating: 'Very Strong' | 'Strong' | 'Moderate' | 'Weak';
  agreementLabel: 'YES' | 'PARTIAL' | 'NO';
  supportCount: number;
  opposeCount: number;
}

// ─── Vote CRUD ────────────────────────────────────────────────────────────────

/** Fetch vote counts for a list of predictionIds in a fixture. Returns a map of predictionId→VoteCount. */
export async function fetchVoteCounts(
  fixtureId: string,
  predictionIds: string[],
  userId?: string,
): Promise<Record<string, VoteCount>> {
  if (predictionIds.length === 0) return {};
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('prediction_votes')
    .select('prediction_id, vote_type, user_id')
    .eq('fixture_id', fixtureId)
    .in('prediction_id', predictionIds);

  if (error || !data) return {};

  const result: Record<string, VoteCount> = {};
  for (const pid of predictionIds) {
    const rows = data.filter((r: any) => r.prediction_id === pid);
    result[pid] = {
      predictionId: pid,
      likes: rows.filter((r: any) => r.vote_type === 'like').length,
      dislikes: rows.filter((r: any) => r.vote_type === 'dislike').length,
      userVote: userId
        ? (rows.find((r: any) => r.user_id === userId)?.vote_type as VoteType | null) ?? null
        : null,
    };
  }
  return result;
}

/** Cast or toggle a vote. Upserts on (user_id, fixture_id, prediction_id). */
export async function castVote(
  fixtureId: string,
  predictionId: string,
  voteType: VoteType,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();

  // Check if user already has a vote on this prediction
  const { data: existing } = await supabase
    .from('prediction_votes')
    .select('id, vote_type')
    .eq('user_id', userId)
    .eq('fixture_id', fixtureId)
    .eq('prediction_id', predictionId)
    .maybeSingle();

  if (existing) {
    if ((existing as any).vote_type === voteType) {
      // Same vote → remove (toggle off)
      const { error } = await supabase
        .from('prediction_votes')
        .delete()
        .eq('id', (existing as any).id);
      return error ? { success: false, error: error.message } : { success: true };
    } else {
      // Different vote → switch
      const { error } = await supabase
        .from('prediction_votes')
        .update({ vote_type: voteType })
        .eq('id', (existing as any).id);
      return error ? { success: false, error: error.message } : { success: true };
    }
  } else {
    // New vote
    const { error } = await supabase
      .from('prediction_votes')
      .insert({
        user_id: userId,
        fixture_id: fixtureId,
        prediction_id: predictionId,
        vote_type: voteType,
      });
    return error ? { success: false, error: error.message } : { success: true };
  }
}

// ─── Expert Predictions ───────────────────────────────────────────────────────

/**
 * Map an expert_tips tip_type to a human-readable prediction type label.
 * Falls back to uppercasing the raw type.
 */
function normaliseTipType(tipType: string, sport: string): string {
  const t = tipType.toLowerCase();
  const s = sport.toLowerCase();
  if (t === '1x2' || t === 'match_result' || t === 'match result') {
    if (s === 'mma' || s === 'boxing') return 'FIGHT WINNER';
    if (s === 'basketball') return 'GAME WINNER';
    if (s === 'tennis') return 'MATCH WINNER';
    return 'MATCH RESULT';
  }
  if (t === 'over_under' || t === 'over/under' || t === 'total') {
    if (s === 'basketball') return 'TOTAL POINTS O/U';
    if (s === 'tennis') return 'TOTAL SETS O/U';
    if (s === 'volleyball') return 'TOTAL SETS O/U';
    if (s === 'baseball' || s === 'cricket') return 'TOTAL RUNS O/U';
    if (s === 'handball') return 'TOTAL GOALS O/U';
    if (s === 'hockey') return 'TOTAL GOALS O/U';
    if (s === 'mma' || s === 'boxing') return 'TOTAL ROUNDS O/U';
    return 'OVER/UNDER';
  }
  if (t === 'btts' || t === 'both_teams_score') return 'BOTH TEAMS TO SCORE';
  if (t === 'asian_handicap' || t === 'handicap') return 'HANDICAP';
  if (t === 'correct_score') return 'CORRECT SCORE';
  if (t === 'ht_result' || t === 'half_time') return 'HALF TIME RESULT';
  if (t === 'first_goal' || t === 'first_scorer') return 'FIRST GOAL';
  if (t === 'clean_sheet') return 'CLEAN SHEET';
  if (t === 'method_of_victory' || t === 'mov') return 'METHOD OF VICTORY';
  if (t === 'spread') return 'SPREAD';
  if (t === 'run_line') return 'RUN LINE';
  return tipType.toUpperCase().replace(/_/g, ' ');
}

/**
 * Build the display prediction value from tip_type + tip_value + teams.
 */
function buildPredictionValue(
  tipType: string,
  tipValue: string,
  homeTeam: string,
  awayTeam: string,
): string {
  const t = tipType.toLowerCase();
  const v = tipValue.toLowerCase();
  if (t === '1x2' || t === 'match_result' || t === 'match result') {
    if (v === '1' || v === 'home' || v === 'home_win') return homeTeam;
    if (v === '2' || v === 'away' || v === 'away_win') return awayTeam;
    if (v === 'x' || v === 'draw') return 'Draw';
    return tipValue;
  }
  if (t === 'btts' || t === 'both_teams_score') {
    return v === 'yes' || v === 'true' || v === '1' ? 'YES' : 'NO';
  }
  // For over/under and other markets, return the tip_value as-is, uppercased
  return tipValue.toUpperCase();
}

/**
 * Query expert_tips table for tips that match this fixture by team names.
 * Uses a 7-day window to surface recent tips before the match.
 */
async function fetchExpertTipsForFixture(
  sport: string,
  homeTeam: string,
  awayTeam: string,
): Promise<any[]> {
  const supabase = getSupabaseClient();

  // Build name fragments for fuzzy matching in match_label
  const homeFragment = homeTeam.split(' ').slice(-1)[0]; // last word e.g. "Lakers"
  const awayFragment = awayTeam.split(' ').slice(-1)[0];

  // Fetch recent tips for this sport within the last 7 days
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data, error } = await supabase
    .from('expert_tips')
    .select(
      'id, expert_id, expert_name, sport, match_label, tip_type, tip_value, odds, confidence, analysis, status, match_time, league, likes'
    )
    .eq('sport', sport)
    .gte('created_at', since.toISOString())
    .order('confidence', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  // Filter to tips whose match_label contains both team fragments (case-insensitive)
  const homeLower = homeFragment.toLowerCase();
  const awayLower = awayFragment.toLowerCase();
  const fullHomeLower = homeTeam.toLowerCase();
  const fullAwayLower = awayTeam.toLowerCase();

  return (data as any[]).filter((tip) => {
    const label = (tip.match_label ?? '').toLowerCase();
    // Match if label contains at least one team's last name fragment AND some part of the other
    const hasHome = label.includes(homeLower) || label.includes(fullHomeLower);
    const hasAway = label.includes(awayLower) || label.includes(fullAwayLower);
    return hasHome && hasAway;
  });
}

/**
 * Convert expert_tips rows into ExpertPrediction objects grouped by tip_type.
 * Multiple tips for the same tip_type are aggregated into a consensus row.
 */
function aggregateTipsToExpertPredictions(
  fixtureId: string,
  tips: any[],
  sport: string,
  homeTeam: string,
  awayTeam: string,
): ExpertPrediction[] {
  if (tips.length === 0) return [];

  // Group by normalised tip_type
  const grouped: Record<string, any[]> = {};
  for (const tip of tips) {
    const key = (tip.tip_type ?? 'match_result').toLowerCase();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(tip);
  }

  const results: ExpertPrediction[] = [];

  for (const [tipType, group] of Object.entries(grouped)) {
    // Find the majority tip_value within this group
    const valueCounts: Record<string, number> = {};
    for (const tip of group) {
      const v = (tip.tip_value ?? '').toLowerCase();
      valueCounts[v] = (valueCounts[v] ?? 0) + 1;
    }
    const majoritytipValue = Object.entries(valueCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const majorityGroup = group.filter((t) => (t.tip_value ?? '').toLowerCase() === majoritytipValue);

    // Aggregate confidence (average of supporting experts)
    const avgConf = Math.round(
      majorityGroup.reduce((s, t) => s + (t.confidence ?? 70), 0) / Math.max(1, majorityGroup.length)
    );

    // Pick the tip_value from the highest-confidence tip in majority group
    const topTip = majorityGroup.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    const displayValue = buildPredictionValue(tipType, topTip?.tip_value ?? majoritytipValue, homeTeam, awayTeam);
    const predType = normaliseTipType(tipType, sport);

    // Gather source names
    const expertNames = [...new Set(group.map((t) => t.expert_name ?? 'Expert').filter(Boolean))];
    const expertSource = expertNames.length === 1
      ? expertNames[0]
      : expertNames.length <= 3
        ? expertNames.join(', ')
        : `${expertNames.slice(0, 2).join(', ')} +${expertNames.length - 2} more`;

    results.push({
      id: `tips-${tipType}-${fixtureId}`,
      fixtureId,
      predictionType: predType,
      prediction: displayValue,
      expertSource,
      expertCount: majorityGroup.length,
      expertsSupporting: majorityGroup.length,
      totalExperts: group.length,
      expertAccuracy: avgConf, // use avg confidence as accuracy proxy
      sport,
      odds: topTip?.odds ? parseFloat(topTip.odds) : null,
      createdAt: topTip?.created_at ?? new Date().toISOString(),
    });
  }

  // Sort: result markets first, then by supporting count descending
  const ORDER = ['match result', '1x2', 'game winner', 'fight winner', 'match winner', 'over_under', 'over/under'];
  results.sort((a, b) => {
    const ai = ORDER.findIndex((o) => a.predictionType.toLowerCase().includes(o));
    const bi = ORDER.findIndex((o) => b.predictionType.toLowerCase().includes(o));
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return b.expertsSupporting - a.expertsSupporting;
  });

  return results;
}

/**
 * Fetch expert predictions for a fixture.
 *
 * Priority order:
 *   1. expert_predictions table (fixture-specific, pre-stored rows)
 *   2. expert_tips table (real tips matched by team names + sport + recent window)
 *   3. Seeded mock data (fallback when neither source has data)
 */
export async function fetchExpertPredictions(
  fixtureId: string,
  sport: string,
  homeTeam: string,
  awayTeam: string,
  predictedResult?: string | null,
  homeWinProb?: number | null,
  awayWinProb?: number | null,
): Promise<ExpertPrediction[]> {
  const supabase = getSupabaseClient();

  // ── 1. Check expert_predictions table (fixture-specific) ──────────────────
  const { data: stored } = await supabase
    .from('expert_predictions')
    .select('*')
    .eq('fixture_id', fixtureId)
    .order('created_at', { ascending: false });

  if (stored && stored.length > 0) {
    return (stored as any[]).map((d) => ({
      id: d.id,
      fixtureId: d.fixture_id,
      predictionType: d.prediction_type,
      prediction: d.prediction,
      expertSource: d.expert_source,
      expertCount: d.expert_count,
      expertsSupporting: d.experts_supporting,
      totalExperts: d.total_experts,
      expertAccuracy: parseFloat(d.expert_accuracy ?? '74'),
      sport: d.sport,
      odds: d.odds ? parseFloat(d.odds) : null,
      createdAt: d.created_at,
    }));
  }

  // ── 2. Query expert_tips by team name match ────────────────────────────────
  try {
    const tips = await fetchExpertTipsForFixture(sport, homeTeam, awayTeam);
    if (tips.length > 0) {
      const aggregated = aggregateTipsToExpertPredictions(fixtureId, tips, sport, homeTeam, awayTeam);
      if (aggregated.length > 0) return aggregated;
    }
  } catch { /* non-blocking — fall through to mock */ }

  // ── 3. Seeded mock data (final fallback) ──────────────────────────────────
  return generateMockExpertPredictions(
    fixtureId, sport, homeTeam, awayTeam, predictedResult, homeWinProb, awayWinProb
  );
}

function generateMockExpertPredictions(
  fixtureId: string,
  sport: string,
  homeTeam: string,
  awayTeam: string,
  predictedResult?: string | null,
  homeWinProb?: number | null,
  awayWinProb?: number | null,
): ExpertPrediction[] {
  const seed = homeTeam.charCodeAt(0) * 17 + awayTeam.charCodeAt(0) * 11;
  const si = (min: number, max: number, off = 0) =>
    min + (Math.abs(seed + off) % (max - min + 1));

  const totalExperts = si(12, 22);
  const hwp = homeWinProb ?? 48;
  const awp = awayWinProb ?? 35;

  // Expert match result leaning
  const expertFavour = hwp >= awp ? 'home' : 'away';
  const expertTeam = expertFavour === 'home' ? homeTeam : awayTeam;
  const expertsForResult = Math.round(totalExperts * (expertFavour === 'home' ? (hwp / 100 + 0.15) : (awp / 100 + 0.15)));
  const clampedExperts = Math.min(totalExperts, Math.max(Math.round(totalExperts * 0.45), expertsForResult));

  const results: ExpertPrediction[] = [
    {
      id: `mock-result-${fixtureId}`,
      fixtureId,
      predictionType: sport.toLowerCase() === 'mma' || sport.toLowerCase() === 'boxing'
        ? 'FIGHT WINNER'
        : sport.toLowerCase() === 'basketball' ? 'GAME WINNER'
        : sport.toLowerCase() === 'tennis' ? 'MATCH WINNER'
        : 'MATCH RESULT',
      prediction: expertFavour === 'home' ? homeTeam : awayTeam,
      expertSource: 'Expert Panel',
      expertCount: clampedExperts,
      expertsSupporting: clampedExperts,
      totalExperts,
      expertAccuracy: si(68, 80) + si(0, 6, 7),
      sport,
      odds: null,
      createdAt: new Date().toISOString(),
    },
  ];

  // Add Over/Under expert pick for relevant sports
  const addOU = !['mma', 'boxing'].includes(sport.toLowerCase());
  if (addOU) {
    const ouLabel = sport.toLowerCase() === 'basketball' ? 'TOTAL POINTS O/U'
      : sport.toLowerCase() === 'tennis' ? 'TOTAL SETS O/U'
      : 'OVER/UNDER';
    const ouLine = sport.toLowerCase() === 'basketball' ? '215.5'
      : sport.toLowerCase() === 'tennis' ? '2.5'
      : '2.5';
    const ouSide = si(0, 1, 13) === 0 ? 'OVER' : 'UNDER';
    const ouExperts = Math.round(totalExperts * (si(50, 68, 19) / 100));
    results.push({
      id: `mock-ou-${fixtureId}`,
      fixtureId,
      predictionType: ouLabel,
      prediction: `${ouSide} ${ouLine}`,
      expertSource: 'Tipsters Network',
      expertCount: ouExperts,
      expertsSupporting: ouExperts,
      totalExperts,
      expertAccuracy: si(62, 74) + si(0, 5, 23),
      sport,
      odds: null,
      createdAt: new Date().toISOString(),
    });
  }

  return results;
}

// ─── Consensus Engine ─────────────────────────────────────────────────────────

/** Compare AI vs Expert prediction and return consensus metrics. */
export function computeConsensus(
  aiPrediction: string,
  expertPrediction: string,
  homeTeam: string,
  awayTeam: string,
): ConsensusResult {
  const aiLower = aiPrediction.toLowerCase();
  const exLower = expertPrediction.toLowerCase();

  // Normalise to detect agreement
  const normalise = (s: string) => {
    if (s.includes(homeTeam.split(' ').slice(-1)[0].toLowerCase())) return 'home';
    if (s.includes(awayTeam.split(' ').slice(-1)[0].toLowerCase())) return 'away';
    if (s.includes('draw') || s.includes('tie') || s.includes('x ')) return 'draw';
    if (s.includes('over')) return 'over';
    if (s.includes('under')) return 'under';
    return s.trim().slice(0, 12);
  };

  const aiNorm = normalise(aiLower);
  const exNorm = normalise(exLower);

  let agreementScore: number;
  let agreementLabel: 'YES' | 'PARTIAL' | 'NO';
  let consensusRating: 'Very Strong' | 'Strong' | 'Moderate' | 'Weak';

  if (aiNorm === exNorm) {
    agreementScore = 85 + Math.floor(Math.random() * 12);
    agreementLabel = 'YES';
    consensusRating = agreementScore >= 92 ? 'Very Strong' : 'Strong';
  } else if (
    (aiNorm === 'home' && exNorm !== 'away') ||
    (aiNorm === 'away' && exNorm !== 'home') ||
    (aiNorm === 'over' && exNorm === 'over') ||
    (aiNorm === 'under' && exNorm === 'under')
  ) {
    agreementScore = 55 + Math.floor(Math.random() * 20);
    agreementLabel = 'PARTIAL';
    consensusRating = 'Moderate';
  } else {
    agreementScore = 15 + Math.floor(Math.random() * 30);
    agreementLabel = 'NO';
    consensusRating = 'Weak';
  }

  return {
    aiPrediction,
    expertPrediction,
    agreementScore,
    consensusRating,
    agreementLabel,
    supportCount: 0,
    opposeCount: 0,
  };
}
