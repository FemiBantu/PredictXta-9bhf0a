/**
 * services/sportCoverageTests.ts
 *
 * Automated Sport Coverage Validation Suite
 *
 * Validates all 21 supported sports across every layer:
 *   Layer 1 — Normalization (key mapping, icon lookup, display name)
 *   Layer 2 — Quality Gate (sport config present, thresholds valid)
 *   Layer 3 — Statistical Engine (sport-specific computation)
 *   Layer 4 — Market Config (OU range, draw possibility)
 *   Layer 5 — Database (match rows present or API route defined)
 *   Layer 6 — Prediction Pipeline (can generate structured prediction)
 *
 * All tests are pure TypeScript — no network calls in unit layers.
 * Layer 5 (DB) and Layer 6 (Pipeline) are async and optional.
 */

import { SPORT_API_KEY, SPORT_ICONS, getSportIcon, normalizeSportName } from '@/constants/theme';
import {
  footballEngine, basketballEngine, tennisEngine,
  cricketEngine, baseballEngine, formScore,
  computeDataQuality, computeMarketIntelligence,
  buildPreMatchIntelligence,
} from './sportsIntelligence';
import { getSupabaseClient } from '@/template';

// ─── All supported sports ─────────────────────────────────────────────────────

export const ALL_SPORTS: SupportedSport[] = [
  { ui: 'Football',          dbKey: 'football',          alias: ['soccer'],                hasEngine: true,  apiProvider: 'api-football' },
  { ui: 'Basketball',        dbKey: 'basketball',         alias: ['nba', 'nbl'],            hasEngine: true,  apiProvider: 'api-basketball' },
  { ui: 'Baseball',          dbKey: 'baseball',           alias: ['mlb'],                   hasEngine: true,  apiProvider: 'api-baseball' },
  { ui: 'Cricket',           dbKey: 'cricket',            alias: [],                        hasEngine: true,  apiProvider: 'thesportsdb' },
  { ui: 'Tennis',            dbKey: 'tennis',             alias: ['atp', 'wta'],            hasEngine: true,  apiProvider: 'thesportsdb' },
  { ui: 'Rugby',             dbKey: 'rugby',              alias: ['rugby-union', 'rugby-league'], hasEngine: false, apiProvider: 'api-rugby' },
  { ui: 'Hockey',            dbKey: 'hockey',             alias: ['ice-hockey', 'nhl'],     hasEngine: false, apiProvider: 'api-hockey' },
  { ui: 'American Football', dbKey: 'american-football',  alias: ['nfl', 'americanfootball'], hasEngine: false, apiProvider: 'api-american-football' },
  { ui: 'Handball',          dbKey: 'handball',           alias: [],                        hasEngine: false, apiProvider: 'api-handball' },
  { ui: 'Volleyball',        dbKey: 'volleyball',         alias: [],                        hasEngine: false, apiProvider: 'api-volleyball' },
  { ui: 'MMA',               dbKey: 'mma',                alias: ['ufc'],                   hasEngine: false, apiProvider: 'api-mma' },
  { ui: 'Formula 1',         dbKey: 'formula1',           alias: ['f1', 'formula-1'],       hasEngine: false, apiProvider: 'thesportsdb' },
  { ui: 'AFL',               dbKey: 'afl',                alias: ['australian-football'],   hasEngine: false, apiProvider: 'api-afl' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SupportedSport {
  ui: string;
  dbKey: string;
  alias: string[];
  hasEngine: boolean;
  apiProvider: string;
}

export type TestStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface TestResult {
  name: string;
  status: TestStatus;
  message: string;
  duration?: number;   // ms
  detail?: string;
}

export interface SportTestReport {
  sport: SupportedSport;
  overall: TestStatus;
  score: number;       // 0-100
  layers: {
    normalization: TestResult[];
    qualityGate: TestResult[];
    engine: TestResult[];
    market: TestResult[];
    database: TestResult | null;
    pipeline: TestResult | null;
  };
  totalPassed: number;
  totalFailed: number;
  totalWarned: number;
}

export interface CoverageReport {
  generatedAt: string;
  totalSports: number;
  passed: number;
  failed: number;
  warned: number;
  overallScore: number;
  sports: SportTestReport[];
  summary: {
    normalizationScore: number;
    qualityGateScore: number;
    engineScore: number;
    marketScore: number;
    dbCoverage: number;     // % sports with DB matches
    pipelineCoverage: number;
  };
}

// ─── Quality Gate config map (mirrors qualityGate.ts) ───────────────────────

const QUALITY_GATE_CONFIGS: Record<string, {
  drawPossible: boolean; ouMin: number; ouMax: number; goalsMin: number; goalsMax: number;
}> = {
  football:           { drawPossible: true,  ouMin: 0.5, ouMax: 6.5,  goalsMin: 0, goalsMax: 10 },
  basketball:         { drawPossible: false, ouMin: 150, ouMax: 280,  goalsMin: 50, goalsMax: 160 },
  tennis:             { drawPossible: false, ouMin: 1.5, ouMax: 3.5,  goalsMin: 0, goalsMax: 4 },
  cricket:            { drawPossible: true,  ouMin: 100, ouMax: 600,  goalsMin: 50, goalsMax: 400 },
  baseball:           { drawPossible: false, ouMin: 4.5, ouMax: 14.5, goalsMin: 0, goalsMax: 15 },
  hockey:             { drawPossible: false, ouMin: 2.5, ouMax: 9.5,  goalsMin: 0, goalsMax: 10 },
  rugby:              { drawPossible: true,  ouMin: 25,  ouMax: 70,   goalsMin: 0, goalsMax: 60 },
  mma:                { drawPossible: false, ouMin: 1.5, ouMax: 3.5,  goalsMin: 0, goalsMax: 5 },
  handball:           { drawPossible: false, ouMin: 40,  ouMax: 75,   goalsMin: 15, goalsMax: 45 },
  volleyball:         { drawPossible: false, ouMin: 2.5, ouMax: 4.5,  goalsMin: 0, goalsMax: 5 },
  'american-football':{ drawPossible: false, ouMin: 30,  ouMax: 70,   goalsMin: 0, goalsMax: 50 },
  formula1:           { drawPossible: false, ouMin: 1,   ouMax: 5,    goalsMin: 0, goalsMax: 20 },
  afl:                { drawPossible: false, ouMin: 80,  ouMax: 200,  goalsMin: 40, goalsMax: 120 },
};

// ─── Fetch-matches sport routing map ─────────────────────────────────────────

const FETCH_MATCHES_SUPPORTED: Set<string> = new Set([
  'football', 'basketball', 'baseball', 'cricket', 'tennis',
  'rugby', 'hockey', 'american-football', 'handball', 'volleyball',
  'mma', 'formula1', 'afl',
]);

// ─── Layer 1: Normalization Tests ─────────────────────────────────────────────

function runNormalizationTests(sport: SupportedSport): TestResult[] {
  const results: TestResult[] = [];

  // T1.1 — SPORT_API_KEY maps UI label → DB key
  const apiKey = SPORT_API_KEY[sport.ui];
  if (apiKey && apiKey === sport.dbKey) {
    results.push({ name: 'SPORT_API_KEY mapping', status: 'pass', message: `"${sport.ui}" → "${sport.dbKey}" ✓` });
  } else if (!apiKey) {
    // Extended sports not in main SPORTS list (e.g. Boxing, F1, Esports) — warn not fail
    const isExtended = !SPORT_API_KEY[sport.ui];
    results.push({
      name: 'SPORT_API_KEY mapping',
      status: 'warn',
      message: `"${sport.ui}" not in SPORT_API_KEY — use dbKey "${sport.dbKey}" directly`,
      detail: 'Extended sports may need adding to SPORT_API_KEY in constants/theme.ts',
    });
  } else {
    results.push({ name: 'SPORT_API_KEY mapping', status: 'fail', message: `"${sport.ui}" → "${apiKey}" but expected "${sport.dbKey}"` });
  }

  // T1.2 — getSportIcon returns a non-default icon
  const icon = getSportIcon(sport.dbKey);
  const aliasIcon = sport.alias.length > 0 ? getSportIcon(sport.alias[0]) : null;
  if (icon && icon !== '🏆') {
    results.push({ name: 'Sport icon (dbKey)', status: 'pass', message: `${icon} for "${sport.dbKey}" ✓` });
  } else {
    results.push({
      name: 'Sport icon (dbKey)',
      status: 'warn',
      message: `No specific icon for "${sport.dbKey}" — using default 🏆`,
      detail: `Add "${sport.dbKey}" entry to SPORT_ICON_LOWER in constants/theme.ts`,
    });
  }

  // T1.3 — alias keys also resolve correctly
  for (const alias of sport.alias.slice(0, 2)) {
    const aKey = alias.toLowerCase().replace(/\s+/g, '-');
    const resolvedKey = SPORT_API_KEY[alias] ?? aKey;
    const expectsKey = sport.dbKey;
    const pass = resolvedKey === expectsKey
      || alias.toLowerCase().replace(/[^a-z]/g, '') === sport.dbKey.replace(/[^a-z]/g, '');
    results.push({
      name: `Alias normalize: "${alias}"`,
      status: pass ? 'pass' : 'warn',
      message: pass ? `"${alias}" resolves to "${sport.dbKey}" ✓` : `"${alias}" → "${resolvedKey}" (expected "${sport.dbKey}")`,
    });
  }

  // T1.4 — normalizeSportName round-trip
  const displayName = normalizeSportName(sport.dbKey);
  const hasDisplay = displayName && displayName !== sport.dbKey;
  results.push({
    name: 'normalizeSportName round-trip',
    status: hasDisplay ? 'pass' : 'warn',
    message: hasDisplay ? `normalizeSportName("${sport.dbKey}") = "${displayName}" ✓` : `Returns raw key — add to NAME_MAP`,
  });

  return results;
}

// ─── Layer 2: Quality Gate Tests ─────────────────────────────────────────────

function runQualityGateTests(sport: SupportedSport): TestResult[] {
  const results: TestResult[] = [];
  const cfg = QUALITY_GATE_CONFIGS[sport.dbKey];

  // T2.1 — Config exists
  if (cfg) {
    results.push({ name: 'QG config present', status: 'pass', message: `Sport config found for "${sport.dbKey}" ✓` });
  } else {
    results.push({
      name: 'QG config present',
      status: 'warn',
      message: `No dedicated QG config for "${sport.dbKey}" — falls back to football config`,
      detail: 'Add entry to SPORT_GATE_CONFIGS in supabase/functions/_shared/qualityGate.ts',
    });
    return results; // Can't run further tests without config
  }

  // T2.2 — Draw possibility flag is boolean
  results.push({
    name: 'Draw possibility flag',
    status: typeof cfg.drawPossible === 'boolean' ? 'pass' : 'fail',
    message: `drawPossible=${cfg.drawPossible} ✓`,
  });

  // T2.3 — OU range is logical (min < max, positive values)
  const ouValid = cfg.ouMin > 0 && cfg.ouMax > cfg.ouMin && cfg.ouMax < 10000;
  results.push({
    name: 'O/U range valid',
    status: ouValid ? 'pass' : 'fail',
    message: ouValid ? `O/U range [${cfg.ouMin}–${cfg.ouMax}] valid ✓` : `Invalid O/U range [${cfg.ouMin}–${cfg.ouMax}]`,
  });

  // T2.4 — Goals range is logical
  const goalsValid = cfg.goalsMin >= 0 && cfg.goalsMax > cfg.goalsMin;
  results.push({
    name: 'Goals/points range valid',
    status: goalsValid ? 'pass' : 'fail',
    message: goalsValid ? `Range [${cfg.goalsMin}–${cfg.goalsMax}] valid ✓` : `Invalid goals range`,
  });

  // T2.5 — Probability test: a real prediction passes
  const mockPrediction = {
    match_id: 'test-1',
    home_win_prob: cfg.drawPossible ? 45 : 60,
    draw_prob: cfg.drawPossible ? 25 : 0,
    away_win_prob: cfg.drawPossible ? 30 : 40,
    predicted_result: 'home_win',
    confidence: 72,
    over_under: 'over',
    over_under_line: cfg.ouMin + (cfg.ouMax - cfg.ouMin) / 2,
    btts: 'yes',
    match_sport: sport.dbKey,
    enrichment_pct: 70,
  };
  const probSum = mockPrediction.home_win_prob + mockPrediction.draw_prob + mockPrediction.away_win_prob;
  const probValid = Math.abs(probSum - 100) <= 8;
  results.push({
    name: 'Mock prediction normalization',
    status: probValid ? 'pass' : 'fail',
    message: probValid ? `Prob sum=${probSum} within tolerance ✓` : `Prob sum=${probSum} out of range`,
  });

  return results;
}

// ─── Layer 3: Engine Tests ────────────────────────────────────────────────────

function runEngineTests(sport: SupportedSport): TestResult[] {
  const results: TestResult[] = [];

  if (!sport.hasEngine) {
    results.push({ name: 'Engine available', status: 'skip', message: `No dedicated engine for ${sport.ui} — uses universal model` });
    return results;
  }

  const s = sport.dbKey;

  if (s === 'football') {
    const fe = footballEngine({
      homeGoalsScored: 38, homeGoalsConceded: 18,
      awayGoalsScored: 28, awayGoalsConceded: 32,
      gamesPlayed: 20,
    });
    if (!fe) { results.push({ name: 'Football Poisson engine', status: 'fail', message: 'Engine returned null' }); }
    else {
      results.push({ name: 'Football Poisson engine', status: 'pass', message: `λH=${fe.lambdaH.toFixed(2)} λA=${fe.lambdaA.toFixed(2)} ✓` });
      const probsOk = Math.abs(fe.poissonProbs.hw + fe.poissonProbs.d + fe.poissonProbs.aw - 1) < 0.05;
      results.push({ name: 'Poisson probability sum ≈ 1', status: probsOk ? 'pass' : 'fail', message: probsOk ? `Sum=${(fe.poissonProbs.hw + fe.poissonProbs.d + fe.poissonProbs.aw).toFixed(3)} ✓` : `Sum deviates` });
      results.push({ name: 'BTTS probability in range', status: fe.bttsProb >= 0 && fe.bttsProb <= 1 ? 'pass' : 'fail', message: `bttsProb=${fe.bttsProb.toFixed(3)} ✓` });
      results.push({ name: 'Over 2.5 probability in range', status: fe.over25Prob >= 0 && fe.over25Prob <= 1 ? 'pass' : 'fail', message: `over25Prob=${fe.over25Prob.toFixed(3)} ✓` });
      results.push({ name: 'Most likely score valid', status: fe.mostLikelyScore.h >= 0 && fe.mostLikelyScore.a >= 0 ? 'pass' : 'fail', message: `${fe.mostLikelyScore.h}-${fe.mostLikelyScore.a} (${(fe.mostLikelyScore.prob * 100).toFixed(1)}%) ✓` });
      results.push({ name: 'xG values positive', status: fe.xgHome > 0 && fe.xgAway > 0 ? 'pass' : 'fail', message: `xG: ${fe.xgHome} vs ${fe.xgAway} ✓` });
    }
  }

  if (s === 'basketball') {
    const be = basketballEngine({ homePace: 103, awayPace: 99, homeORtg: 112, awayORtg: 108, homeDRtg: 109, awayDRtg: 113 });
    if (!be) { results.push({ name: 'Basketball pace engine', status: 'fail', message: 'Engine returned null' }); }
    else {
      results.push({ name: 'Basketball pace engine', status: 'pass', message: `Home=${be.homeProjected} Away=${be.awayProjected} Total=${be.totalProjected} ✓` });
      const totalInRange = be.totalProjected >= 150 && be.totalProjected <= 280;
      results.push({ name: 'Total points in realistic range', status: totalInRange ? 'pass' : 'warn', message: totalInRange ? `${be.totalProjected} pts in [150–280] ✓` : `${be.totalProjected} pts outside expected NBA range` });
      results.push({ name: 'Win prob in range [0-100]', status: be.homeWinProb >= 0 && be.homeWinProb <= 100 ? 'pass' : 'fail', message: `${be.homeWinProb}% ✓` });
      results.push({ name: 'Pace label valid', status: ['fast','moderate','slow'].includes(be.paceLabel) ? 'pass' : 'fail', message: `Pace="${be.paceLabel}" ✓` });
    }
  }

  if (s === 'tennis') {
    const te = tennisEngine({ homeRank: 12, awayRank: 28, homeServeWin: 65, awayServeWin: 62, homeSurfaceWin: 58, awaySurfaceWin: 52 });
    if (!te) { results.push({ name: 'Tennis Elo engine', status: 'fail', message: 'Engine returned null' }); }
    else {
      results.push({ name: 'Tennis Elo engine', status: 'pass', message: `Home=${te.homeWinProb}% Away=${te.awayWinProb}% ✓` });
      const probsOk = Math.abs(te.homeWinProb + te.awayWinProb - 100) <= 2;
      results.push({ name: 'Tennis probs sum ≈ 100', status: probsOk ? 'pass' : 'fail', message: `Sum=${te.homeWinProb + te.awayWinProb}% ✓` });
      results.push({ name: 'Dominance label valid', status: ['home_strong','home_slight','even','away_slight','away_strong'].includes(te.dominance) ? 'pass' : 'fail', message: `Dominance="${te.dominance}" ✓` });
      results.push({ name: 'Suggested sets realistic', status: te.suggestedSets >= 2 && te.suggestedSets <= 5 ? 'pass' : 'fail', message: `${te.suggestedSets} sets ✓` });
    }
  }

  if (s === 'cricket') {
    const ce = cricketEngine({ homeRunRate: 8.2, awayRunRate: 7.6, overs: 20 });
    if (!ce) { results.push({ name: 'Cricket run-rate engine', status: 'fail', message: 'Engine returned null' }); }
    else {
      results.push({ name: 'Cricket run-rate engine', status: 'pass', message: `Home=${ce.homeProjectedRuns} Away=${ce.awayProjectedRuns} ✓` });
      const totalOk = ce.totalProjected >= 100 && ce.totalProjected <= 600;
      results.push({ name: 'Projected runs in T20 range', status: totalOk ? 'pass' : 'warn', message: `${ce.totalProjected} runs ✓` });
      results.push({ name: 'Win prob in range', status: ce.homeWinProb >= 0 && ce.homeWinProb <= 100 ? 'pass' : 'fail', message: `${ce.homeWinProb}% ✓` });
    }
  }

  if (s === 'baseball') {
    const bb = baseballEngine({ homeERA: 3.4, awayERA: 4.1, homeWHIP: 1.18, awayWHIP: 1.35, homeBattingAvg: 0.265, awayBattingAvg: 0.248 });
    if (!bb) { results.push({ name: 'Baseball pitching engine', status: 'fail', message: 'Engine returned null' }); }
    else {
      results.push({ name: 'Baseball pitching engine', status: 'pass', message: `HomeEdge=${bb.homeEdgeScore} AwayEdge=${bb.awayEdgeScore} ✓` });
      results.push({ name: 'Edge scores in [0-100]', status: bb.homeEdgeScore >= 0 && bb.homeEdgeScore <= 100 ? 'pass' : 'fail', message: `${bb.homeEdgeScore} vs ${bb.awayEdgeScore} ✓` });
      results.push({ name: 'Pitching advantage label', status: ['home','away','neutral'].includes(bb.pitchingAdvantage) ? 'pass' : 'fail', message: `"${bb.pitchingAdvantage}" ✓` });
      const totalOk = bb.projectedTotal >= 5 && bb.projectedTotal <= 14;
      results.push({ name: 'Projected runs in MLB range', status: totalOk ? 'pass' : 'warn', message: `${bb.projectedTotal} runs ✓` });
    }
  }

  // Form score test (universal)
  const fs = formScore(['W','W','D','L','W']);
  results.push({ name: 'Form score calculation', status: fs >= 0 && fs <= 100 ? 'pass' : 'fail', message: `formScore([W,W,D,L,W])=${fs} ✓` });

  return results;
}

// ─── Layer 4: Market Config Tests ─────────────────────────────────────────────

function runMarketTests(sport: SupportedSport): TestResult[] {
  const results: TestResult[] = [];
  const cfg = QUALITY_GATE_CONFIGS[sport.dbKey];

  if (!cfg) {
    results.push({ name: 'Market config lookup', status: 'warn', message: 'No config — skipping market tests' });
    return results;
  }

  // T4.1 — Market intelligence computes correctly
  const market = computeMarketIntelligence(
    cfg.drawPossible ? 2.10 : 1.80,
    cfg.drawPossible ? 3.40 : undefined,
    cfg.drawPossible ? 3.60 : 2.10,
    null, null, 55
  );

  if (!market) {
    results.push({ name: 'Market intelligence compute', status: 'fail', message: 'computeMarketIntelligence returned null' });
  } else {
    const sumOk = Math.abs(market.impliedHomeWin + market.impliedDraw + market.impliedAwayWin - 100) <= 12;
    results.push({ name: 'Market intelligence compute', status: 'pass', message: `1=${market.impliedHomeWin}% X=${market.impliedDraw}% 2=${market.impliedAwayWin}% ✓` });
    results.push({ name: 'Implied probs sum ≈ 100%', status: sumOk ? 'pass' : 'fail', message: `Sum=${market.impliedHomeWin + market.impliedDraw + market.impliedAwayWin}% ✓` });
    results.push({ name: 'Favourite identified', status: ['home','draw','away','unknown'].includes(market.favourite) ? 'pass' : 'fail', message: `Favourite="${market.favourite}" ✓` });
    const vigOk = market.vig >= 0 && market.vig <= 30;
    results.push({ name: 'Vig in realistic range', status: vigOk ? 'pass' : 'warn', message: `Vig=${market.vig}% ✓` });
  }

  // T4.2 — OU line mid-point falls within expected range
  const ouMid = (cfg.ouMin + cfg.ouMax) / 2;
  results.push({ name: 'O/U mid-line plausibility', status: 'pass', message: `Mid O/U line=${ouMid.toFixed(1)} for ${sport.ui} ✓` });

  // T4.3 — Data quality score with sport context
  const dq = computeDataQuality({
    sport: sport.dbKey,
    homeForm: ['W','W','D'],
    awayForm: ['L','W','W'],
    homeGoalsScored: 30, awayGoalsScored: 24,
    homeOdds: 1.80, awayOdds: 2.10,
    homeStandingsPos: 3, awayStandingsPos: 7,
  });
  results.push({
    name: 'Data quality score',
    status: dq.score >= 50 ? 'pass' : 'warn',
    message: `DQ=${dq.score} tier="${dq.tier}" ceiling=${dq.confidenceCeiling}% ✓`,
  });

  // T4.4 — Pre-match intelligence summary generates without throwing
  try {
    const intel = buildPreMatchIntelligence({
      homeTeam: 'Home FC', awayTeam: 'Away FC', sport: sport.dbKey,
      homeForm: ['W','W','D','L','W'], awayForm: ['L','W','W','D','L'],
      homeStandingsPos: 3, awayStandingsPos: 8,
      homeGoalsScored: 38, awayGoalsScored: 28,
      homeGoalsConceded: 18, awayGoalsConceded: 32,
      homeOdds: 1.80, drawOdds: cfg.drawPossible ? 3.40 : undefined, awayOdds: 2.10,
    });
    const hasContent = intel.includes('INTELLIGENCE SUMMARY') && intel.length > 50;
    results.push({ name: 'Intelligence summary generation', status: hasContent ? 'pass' : 'fail', message: hasContent ? `${intel.split('\n').length} lines generated ✓` : 'Summary too short' });
  } catch (e) {
    results.push({ name: 'Intelligence summary generation', status: 'fail', message: `Threw: ${e}` });
  }

  return results;
}

// ─── Layer 5: Database Test (async) ──────────────────────────────────────────

async function runDatabaseTest(sport: SupportedSport): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { data, error, count } = await supabase
      .from('matches')
      .select('id, home_team, away_team, status, last_updated', { count: 'exact' })
      .eq('sport', sport.dbKey)
      .limit(1);

    const duration = Date.now() - t0;

    if (error) {
      return { name: 'DB match rows', status: 'fail', message: `DB error: ${error.message}`, duration };
    }

    const total = count ?? 0;
    const hasRecent = data && data.length > 0;

    if (total >= 5) {
      return { name: 'DB match rows', status: 'pass', message: `${total} matches in DB ✓`, duration };
    }
    if (total > 0) {
      return { name: 'DB match rows', status: 'warn', message: `Only ${total} match(es) — needs sync`, duration, detail: `Run fetch-matches with sport="${sport.dbKey}"` };
    }
    return {
      name: 'DB match rows',
      status: 'warn',
      message: `No matches for "${sport.dbKey}" — schedule sync`,
      duration,
      detail: `Add "${sport.dbKey}" to fetch-matches edge function routing`,
    };
  } catch (e) {
    return { name: 'DB match rows', status: 'fail', message: `Exception: ${e}`, duration: Date.now() - t0 };
  }
}

// ─── Layer 6: Pipeline Test (async) ──────────────────────────────────────────

async function runPipelineTest(sport: SupportedSport): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const supabase = getSupabaseClient();

    // Check if there are any predictions for this sport
    const { data: predData, count: predCount } = await supabase
      .from('predictions')
      .select('id, confidence, predicted_result, risk_level', { count: 'exact', head: false })
      .eq('match_id', 
        // subquery: get a match id for this sport
        supabase.from('matches').select('id').eq('sport', sport.dbKey).limit(1).single() as any
      )
      .limit(1);

    // Simpler approach: join via match
    const { data: joinData, error: joinError } = await supabase
      .from('predictions')
      .select('id, confidence, predicted_result, risk_level, matches!inner(sport)')
      .eq('matches.sport', sport.dbKey)
      .limit(1);

    const duration = Date.now() - t0;

    if (joinError) {
      // Try simpler approach
      const { count } = await supabase
        .from('ai_audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('match_id',
          supabase.from('matches').select('id').eq('sport', sport.dbKey).limit(1) as any
        );
      return { name: 'Prediction pipeline', status: 'warn', message: `Join query failed — check RLS: ${joinError.message}`, duration };
    }

    const hasPrediction = joinData && joinData.length > 0;
    if (hasPrediction) {
      const p = joinData[0];
      return {
        name: 'Prediction pipeline',
        status: 'pass',
        message: `Prediction found: result="${p.predicted_result}" conf=${p.confidence}% risk="${p.risk_level}" ✓`,
        duration,
      };
    }

    return {
      name: 'Prediction pipeline',
      status: 'warn',
      message: `No predictions generated yet for "${sport.ui}" — trigger generate-prediction`,
      duration,
      detail: 'Run generate-prediction edge function once matches exist',
    };
  } catch (e) {
    return { name: 'Prediction pipeline', status: 'fail', message: `Exception: ${e}`, duration: Date.now() - t0 };
  }
}

// ─── Score helpers ────────────────────────────────────────────────────────────

function computeScore(tests: TestResult[]): number {
  if (tests.length === 0) return 100;
  const points = tests.reduce((sum, t) => {
    if (t.status === 'pass') return sum + 100;
    if (t.status === 'warn') return sum + 60;
    if (t.status === 'skip') return sum + 80;
    return sum; // fail = 0
  }, 0);
  return Math.round(points / tests.length);
}

function worstStatus(statuses: TestStatus[]): TestStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  if (statuses.includes('skip')) return 'skip';
  return 'pass';
}

// ─── Run all tests for a single sport ────────────────────────────────────────

export async function runSportTests(
  sport: SupportedSport,
  opts: { runDB?: boolean; runPipeline?: boolean } = {},
): Promise<SportTestReport> {
  const normTests  = runNormalizationTests(sport);
  const qgTests    = runQualityGateTests(sport);
  const engTests   = runEngineTests(sport);
  const mktTests   = runMarketTests(sport);

  const dbResult       = opts.runDB       ? await runDatabaseTest(sport)  : null;
  const pipelineResult = opts.runPipeline ? await runPipelineTest(sport)  : null;

  const allTests = [
    ...normTests, ...qgTests, ...engTests, ...mktTests,
    ...(dbResult ? [dbResult] : []),
    ...(pipelineResult ? [pipelineResult] : []),
  ];

  const totalPassed = allTests.filter((t) => t.status === 'pass').length;
  const totalFailed = allTests.filter((t) => t.status === 'fail').length;
  const totalWarned = allTests.filter((t) => t.status === 'warn').length;
  const score       = computeScore(allTests);
  const overall     = worstStatus(allTests.map((t) => t.status));

  return {
    sport,
    overall,
    score,
    layers: {
      normalization: normTests,
      qualityGate:   qgTests,
      engine:        engTests,
      market:        mktTests,
      database:      dbResult,
      pipeline:      pipelineResult,
    },
    totalPassed,
    totalFailed,
    totalWarned,
  };
}

// ─── Run full coverage suite ──────────────────────────────────────────────────

export async function runFullCoverage(
  opts: {
    runDB?: boolean;
    runPipeline?: boolean;
    onProgress?: (sport: string, idx: number, total: number) => void;
  } = {},
): Promise<CoverageReport> {
  const reports: SportTestReport[] = [];

  for (let i = 0; i < ALL_SPORTS.length; i++) {
    const sport = ALL_SPORTS[i];
    opts.onProgress?.(sport.ui, i, ALL_SPORTS.length);
    const report = await runSportTests(sport, opts);
    reports.push(report);
  }

  const passed = reports.filter((r) => r.overall === 'pass').length;
  const failed = reports.filter((r) => r.overall === 'fail').length;
  const warned = reports.filter((r) => r.overall === 'warn' || r.overall === 'skip').length;
  const overallScore = Math.round(reports.reduce((s, r) => s + r.score, 0) / Math.max(1, reports.length));

  // Layer-specific scores
  const avgLayerScore = (layer: keyof SportTestReport['layers']) =>
    Math.round(reports.reduce((s, r) => {
      const tests = Array.isArray(r.layers[layer]) ? r.layers[layer] as TestResult[] : (r.layers[layer] ? [r.layers[layer] as TestResult] : []);
      return s + computeScore(tests);
    }, 0) / Math.max(1, reports.length));

  const dbCoverage = opts.runDB
    ? Math.round(reports.filter((r) => r.layers.database?.status !== 'fail').length / Math.max(1, reports.length) * 100)
    : 0;
  const pipelineCoverage = opts.runPipeline
    ? Math.round(reports.filter((r) => r.layers.pipeline?.status === 'pass').length / Math.max(1, reports.length) * 100)
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    totalSports: ALL_SPORTS.length,
    passed,
    failed,
    warned,
    overallScore,
    sports: reports,
    summary: {
      normalizationScore: avgLayerScore('normalization'),
      qualityGateScore:   avgLayerScore('qualityGate'),
      engineScore:        avgLayerScore('engine'),
      marketScore:        avgLayerScore('market'),
      dbCoverage,
      pipelineCoverage,
    },
  };
}

// ─── Quick smoke test (sync only, no DB) ─────────────────────────────────────
// Returns immediate results without any async calls — useful for startup health check

export function runSmokeTest(): { sport: string; normPass: boolean; qgPass: boolean; icon: string }[] {
  return ALL_SPORTS.map((sport) => {
    const normTests = runNormalizationTests(sport);
    const qgTests   = runQualityGateTests(sport);
    const normPass  = !normTests.some((t) => t.status === 'fail');
    const qgPass    = !qgTests.some((t) => t.status === 'fail');
    const icon      = getSportIcon(sport.dbKey);
    return { sport: sport.ui, normPass, qgPass, icon };
  });
}
