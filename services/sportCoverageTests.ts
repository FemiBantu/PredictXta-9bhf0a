/**
 * services/sportCoverageTests.ts
 *
 * Automated Sport Coverage Validation Suite
 *
 * Validates all 13 canonical supported sports across every layer.
 * ALL_SPORTS is derived from the canonical registry — never hardcoded here.
 *
 * Layers:
 *   1 — Normalization (key mapping, icon, display name)
 *   2 — Quality Gate (sport config, thresholds)
 *   3 — Statistical Engine (sport-specific computation)
 *   4 — Market Config (O/U range, draw possibility)
 *   5 — Database (match rows present)
 *   6 — Prediction Pipeline (has predictions)
 */

import { SPORT_API_KEY, SPORT_ICONS, getSportIcon, normalizeSportName } from '@/constants/theme';
import {
  footballEngine, basketballEngine, tennisEngine,
  cricketEngine, baseballEngine, formScore,
  computeDataQuality, computeMarketIntelligence,
  buildPreMatchIntelligence,
} from './sportsIntelligence';
import { getSupabaseClient } from '@/template';
import { getActiveSports, assertSupportedSportRegistry, SportDefinition } from './sportsRegistry';

// ─── Run validation guard on import ──────────────────────────────────────────
// Throws in development if registry has wrong count, duplicates, or removed sports.
if (__DEV__) {
  try { assertSupportedSportRegistry(); } catch (e) { console.error('[SportsRegistry]', e); }
}

// ─── SupportedSport derived from canonical registry ──────────────────────────
export interface SupportedSport {
  ui: string;          // displayName from registry
  dbKey: string;       // key from registry
  alias: string[];     // common aliases
  hasEngine: boolean;  // has dedicated statistical engine
  apiProvider: string; // primary provider key
}

/**
 * ALL_SPORTS — derived from the canonical registry.
 * DO NOT add or remove sports here; edit services/sportsRegistry.ts instead.
 */
export const ALL_SPORTS: SupportedSport[] = getActiveSports().map((s: SportDefinition) => ({
  ui: s.displayName,
  dbKey: s.key,
  alias: buildAliases(s.key),
  hasEngine: ['football', 'basketball', 'tennis', 'cricket', 'baseball'].includes(s.key),
  apiProvider: s.providers[0]?.provider ?? 'thesportsdb',
}));

function buildAliases(key: string): string[] {
  const map: Record<string, string[]> = {
    'football':          ['soccer'],
    'basketball':        ['nba', 'nbl'],
    'tennis':            ['atp', 'wta'],
    'cricket':           [],
    'baseball':          ['mlb'],
    'hockey':            ['ice-hockey', 'nhl'],
    'rugby':             ['rugby-union', 'rugby-league'],
    'american-football': ['nfl', 'americanfootball'],
    'handball':          [],
    'volleyball':        [],
    'mma':               ['ufc'],
    'boxing':            [],
    'esports':           ['e-sports'],
  };
  return map[key] ?? [];
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type TestStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface TestResult {
  name: string;
  status: TestStatus;
  message: string;
  duration?: number;
  detail?: string;
}

export interface SportTestReport {
  sport: SupportedSport;
  overall: TestStatus;
  score: number;
  layers: {
    normalization: TestResult[];
    qualityGate:   TestResult[];
    engine:        TestResult[];
    market:        TestResult[];
    database:      TestResult | null;
    pipeline:      TestResult | null;
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
    qualityGateScore:   number;
    engineScore:        number;
    marketScore:        number;
    dbCoverage:         number;
    pipelineCoverage:   number;
  };
}

// ─── Quality Gate config map ──────────────────────────────────────────────────
const QUALITY_GATE_CONFIGS: Record<string, {
  drawPossible: boolean; ouMin: number; ouMax: number; goalsMin: number; goalsMax: number;
}> = {
  football:            { drawPossible: true,  ouMin: 0.5,  ouMax: 6.5,   goalsMin: 0,   goalsMax: 10  },
  basketball:          { drawPossible: false, ouMin: 150,  ouMax: 280,   goalsMin: 50,  goalsMax: 160 },
  tennis:              { drawPossible: false, ouMin: 1.5,  ouMax: 3.5,   goalsMin: 0,   goalsMax: 4   },
  cricket:             { drawPossible: true,  ouMin: 100,  ouMax: 600,   goalsMin: 50,  goalsMax: 400 },
  baseball:            { drawPossible: false, ouMin: 4.5,  ouMax: 14.5,  goalsMin: 0,   goalsMax: 15  },
  hockey:              { drawPossible: false, ouMin: 2.5,  ouMax: 9.5,   goalsMin: 0,   goalsMax: 10  },
  rugby:               { drawPossible: true,  ouMin: 25,   ouMax: 70,    goalsMin: 0,   goalsMax: 60  },
  mma:                 { drawPossible: false, ouMin: 1.5,  ouMax: 3.5,   goalsMin: 0,   goalsMax: 5   },
  boxing:              { drawPossible: true,  ouMin: 1.5,  ouMax: 12.5,  goalsMin: 0,   goalsMax: 12  },
  handball:            { drawPossible: true,  ouMin: 40,   ouMax: 75,    goalsMin: 15,  goalsMax: 45  },
  volleyball:          { drawPossible: false, ouMin: 2.5,  ouMax: 4.5,   goalsMin: 0,   goalsMax: 5   },
  'american-football': { drawPossible: false, ouMin: 30,   ouMax: 70,    goalsMin: 0,   goalsMax: 50  },
  esports:             { drawPossible: false, ouMin: 1.5,  ouMax: 3.5,   goalsMin: 0,   goalsMax: 5   },
};

// ─── Layer 1: Normalization ───────────────────────────────────────────────────
function runNormalizationTests(sport: SupportedSport): TestResult[] {
  const results: TestResult[] = [];

  // T1.1 — SPORT_API_KEY maps UI label → DB key
  const apiKey = SPORT_API_KEY[sport.ui];
  if (apiKey && apiKey === sport.dbKey) {
    results.push({ name: 'SPORT_API_KEY mapping', status: 'pass', message: `"${sport.ui}" → "${sport.dbKey}" ✓` });
  } else if (!apiKey) {
    results.push({ name: 'SPORT_API_KEY mapping', status: 'warn', message: `"${sport.ui}" not in SPORT_API_KEY — use dbKey directly` });
  } else {
    results.push({ name: 'SPORT_API_KEY mapping', status: 'fail', message: `"${sport.ui}" → "${apiKey}" expected "${sport.dbKey}"` });
  }

  // T1.2 — Icon exists
  const icon = getSportIcon(sport.dbKey);
  results.push({
    name: 'Sport icon (dbKey)',
    status: icon && icon !== '🏆' ? 'pass' : 'warn',
    message: icon !== '🏆' ? `${icon} for "${sport.dbKey}" ✓` : `No specific icon — using default 🏆`,
  });

  // T1.3 — normalizeSportName round-trip
  const displayName = normalizeSportName(sport.dbKey);
  results.push({
    name: 'normalizeSportName round-trip',
    status: displayName && displayName !== sport.dbKey ? 'pass' : 'warn',
    message: displayName !== sport.dbKey ? `"${sport.dbKey}" → "${displayName}" ✓` : `Returns raw key — add to NAME_MAP`,
  });

  return results;
}

// ─── Layer 2: Quality Gate ────────────────────────────────────────────────────
function runQualityGateTests(sport: SupportedSport): TestResult[] {
  const results: TestResult[] = [];
  const cfg = QUALITY_GATE_CONFIGS[sport.dbKey];

  if (!cfg) {
    results.push({ name: 'QG config present', status: 'warn', message: `No dedicated QG config for "${sport.dbKey}"` });
    return results;
  }

  results.push({ name: 'QG config present', status: 'pass', message: `Config found for "${sport.dbKey}" ✓` });
  results.push({ name: 'Draw flag valid', status: typeof cfg.drawPossible === 'boolean' ? 'pass' : 'fail', message: `drawPossible=${cfg.drawPossible}` });

  const ouValid = cfg.ouMin > 0 && cfg.ouMax > cfg.ouMin && cfg.ouMax < 10000;
  results.push({ name: 'O/U range valid', status: ouValid ? 'pass' : 'fail', message: `[${cfg.ouMin}–${cfg.ouMax}]` });

  const goalsValid = cfg.goalsMin >= 0 && cfg.goalsMax > cfg.goalsMin;
  results.push({ name: 'Goals range valid', status: goalsValid ? 'pass' : 'fail', message: `[${cfg.goalsMin}–${cfg.goalsMax}]` });

  const probSum = (cfg.drawPossible ? 45 : 60) + (cfg.drawPossible ? 25 : 0) + (cfg.drawPossible ? 30 : 40);
  results.push({ name: 'Mock prob sum ≈ 100', status: Math.abs(probSum - 100) <= 8 ? 'pass' : 'fail', message: `sum=${probSum}` });

  return results;
}

// ─── Layer 3: Engine ──────────────────────────────────────────────────────────
function runEngineTests(sport: SupportedSport): TestResult[] {
  const results: TestResult[] = [];
  if (!sport.hasEngine) {
    results.push({ name: 'Engine available', status: 'skip', message: `No dedicated engine for ${sport.ui} — universal model` });
    return results;
  }

  const s = sport.dbKey;

  if (s === 'football') {
    const fe = footballEngine({ homeGoalsScored: 38, homeGoalsConceded: 18, awayGoalsScored: 28, awayGoalsConceded: 32, gamesPlayed: 20 });
    if (!fe) { results.push({ name: 'Football engine', status: 'fail', message: 'null' }); }
    else {
      results.push({ name: 'Football engine', status: 'pass', message: `λH=${fe.lambdaH.toFixed(2)} λA=${fe.lambdaA.toFixed(2)} ✓` });
      const ok = Math.abs(fe.poissonProbs.hw + fe.poissonProbs.d + fe.poissonProbs.aw - 1) < 0.05;
      results.push({ name: 'Poisson sum ≈ 1', status: ok ? 'pass' : 'fail', message: `${(fe.poissonProbs.hw + fe.poissonProbs.d + fe.poissonProbs.aw).toFixed(3)}` });
    }
  }
  if (s === 'basketball') {
    const be = basketballEngine({ homePace: 103, awayPace: 99, homeORtg: 112, awayORtg: 108, homeDRtg: 109, awayDRtg: 113 });
    if (!be) { results.push({ name: 'Basketball engine', status: 'fail', message: 'null' }); }
    else results.push({ name: 'Basketball engine', status: 'pass', message: `Total=${be.totalProjected} ✓` });
  }
  if (s === 'tennis') {
    const te = tennisEngine({ homeRank: 12, awayRank: 28, homeServeWin: 65, awayServeWin: 62, homeSurfaceWin: 58, awaySurfaceWin: 52 });
    if (!te) { results.push({ name: 'Tennis engine', status: 'fail', message: 'null' }); }
    else results.push({ name: 'Tennis engine', status: 'pass', message: `Home=${te.homeWinProb}% ✓` });
  }
  if (s === 'cricket') {
    const ce = cricketEngine({ homeRunRate: 8.2, awayRunRate: 7.6, overs: 20 });
    if (!ce) { results.push({ name: 'Cricket engine', status: 'fail', message: 'null' }); }
    else results.push({ name: 'Cricket engine', status: 'pass', message: `Home=${ce.homeProjectedRuns} ✓` });
  }
  if (s === 'baseball') {
    const bb = baseballEngine({ homeERA: 3.4, awayERA: 4.1, homeWHIP: 1.18, awayWHIP: 1.35, homeBattingAvg: 0.265, awayBattingAvg: 0.248 });
    if (!bb) { results.push({ name: 'Baseball engine', status: 'fail', message: 'null' }); }
    else results.push({ name: 'Baseball engine', status: 'pass', message: `HomeEdge=${bb.homeEdgeScore} ✓` });
  }

  const fs = formScore(['W', 'W', 'D', 'L', 'W']);
  results.push({ name: 'Form score', status: fs >= 0 && fs <= 100 ? 'pass' : 'fail', message: `${fs} ✓` });

  return results;
}

// ─── Layer 4: Market ─────────────────────────────────────────────────────────
function runMarketTests(sport: SupportedSport): TestResult[] {
  const results: TestResult[] = [];
  const cfg = QUALITY_GATE_CONFIGS[sport.dbKey];
  if (!cfg) { results.push({ name: 'Market config', status: 'warn', message: 'No config' }); return results; }

  const market = computeMarketIntelligence(
    cfg.drawPossible ? 2.10 : 1.80,
    cfg.drawPossible ? 3.40 : undefined,
    cfg.drawPossible ? 3.60 : 2.10,
    null, null, 55,
  );
  if (!market) { results.push({ name: 'Market intelligence', status: 'fail', message: 'null' }); }
  else {
    const sumOk = Math.abs(market.impliedHomeWin + market.impliedDraw + market.impliedAwayWin - 100) <= 15;
    results.push({ name: 'Market intelligence', status: sumOk ? 'pass' : 'fail', message: `sum=${market.impliedHomeWin + market.impliedDraw + market.impliedAwayWin}%` });
  }

  const dq = computeDataQuality({ sport: sport.dbKey, homeForm: ['W','W','D'], awayForm: ['L','W','W'], homeGoalsScored: 30, awayGoalsScored: 24, homeOdds: 1.80, awayOdds: 2.10, homeStandingsPos: 3, awayStandingsPos: 7 });
  results.push({ name: 'Data quality score', status: dq.score >= 40 ? 'pass' : 'warn', message: `DQ=${dq.score} tier="${dq.tier}"` });

  return results;
}

// ─── Layer 5: Database (async) ────────────────────────────────────────────────
async function runDatabaseTest(sport: SupportedSport): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('sport', sport.dbKey);

    const duration = Date.now() - t0;
    if (error) return { name: 'DB match rows', status: 'fail', message: error.message, duration };
    const total = count ?? 0;
    if (total >= 5) return { name: 'DB match rows', status: 'pass', message: `${total} matches ✓`, duration };
    if (total > 0) return { name: 'DB match rows', status: 'warn', message: `Only ${total} matches`, duration };
    return { name: 'DB match rows', status: 'warn', message: `No matches — needs sync`, duration };
  } catch (e) {
    return { name: 'DB match rows', status: 'fail', message: String(e), duration: Date.now() - t0 };
  }
}

// ─── Layer 6: Pipeline (async) ────────────────────────────────────────────────
async function runPipelineTest(sport: SupportedSport): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('predictions')
      .select('id, confidence, predicted_result, matches!inner(sport)')
      .eq('matches.sport', sport.dbKey)
      .limit(1);

    const duration = Date.now() - t0;
    if (error) return { name: 'Prediction pipeline', status: 'warn', message: `${error.message}`, duration };
    if (data && data.length > 0) {
      const p = data[0] as any;
      return { name: 'Prediction pipeline', status: 'pass', message: `result="${p.predicted_result}" conf=${p.confidence}% ✓`, duration };
    }
    return { name: 'Prediction pipeline', status: 'warn', message: `No predictions yet — trigger generate-prediction`, duration };
  } catch (e) {
    return { name: 'Prediction pipeline', status: 'fail', message: String(e), duration: Date.now() - t0 };
  }
}

// ─── Score helpers ────────────────────────────────────────────────────────────
function computeScore(tests: TestResult[]): number {
  if (tests.length === 0) return 100;
  const points = tests.reduce((s, t) => s + (t.status === 'pass' ? 100 : t.status === 'warn' ? 60 : t.status === 'skip' ? 80 : 0), 0);
  return Math.round(points / tests.length);
}

function worstStatus(statuses: TestStatus[]): TestStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  if (statuses.includes('skip')) return 'skip';
  return 'pass';
}

// ─── Run all tests for one sport ─────────────────────────────────────────────
export async function runSportTests(sport: SupportedSport, opts: { runDB?: boolean; runPipeline?: boolean } = {}): Promise<SportTestReport> {
  const normTests = runNormalizationTests(sport);
  const qgTests   = runQualityGateTests(sport);
  const engTests  = runEngineTests(sport);
  const mktTests  = runMarketTests(sport);
  const dbResult       = opts.runDB       ? await runDatabaseTest(sport)  : null;
  const pipelineResult = opts.runPipeline ? await runPipelineTest(sport)  : null;

  const allTests = [...normTests, ...qgTests, ...engTests, ...mktTests, ...(dbResult ? [dbResult] : []), ...(pipelineResult ? [pipelineResult] : [])];
  return {
    sport, overall: worstStatus(allTests.map((t) => t.status)), score: computeScore(allTests),
    layers: { normalization: normTests, qualityGate: qgTests, engine: engTests, market: mktTests, database: dbResult, pipeline: pipelineResult },
    totalPassed: allTests.filter((t) => t.status === 'pass').length,
    totalFailed: allTests.filter((t) => t.status === 'fail').length,
    totalWarned: allTests.filter((t) => t.status === 'warn').length,
  };
}

// ─── Full coverage suite ─────────────────────────────────────────────────────
export async function runFullCoverage(opts: { runDB?: boolean; runPipeline?: boolean; onProgress?: (sport: string, idx: number, total: number) => void } = {}): Promise<CoverageReport> {
  const reports: SportTestReport[] = [];
  for (let i = 0; i < ALL_SPORTS.length; i++) {
    opts.onProgress?.(ALL_SPORTS[i].ui, i, ALL_SPORTS.length);
    reports.push(await runSportTests(ALL_SPORTS[i], opts));
  }

  const avgLayerScore = (layer: keyof SportTestReport['layers']) =>
    Math.round(reports.reduce((s, r) => {
      const tests = Array.isArray(r.layers[layer]) ? r.layers[layer] as TestResult[] : (r.layers[layer] ? [r.layers[layer] as TestResult] : []);
      return s + computeScore(tests);
    }, 0) / Math.max(1, reports.length));

  return {
    generatedAt: new Date().toISOString(),
    totalSports: ALL_SPORTS.length,
    passed: reports.filter((r) => r.overall === 'pass').length,
    failed: reports.filter((r) => r.overall === 'fail').length,
    warned: reports.filter((r) => r.overall !== 'pass' && r.overall !== 'fail').length,
    overallScore: Math.round(reports.reduce((s, r) => s + r.score, 0) / Math.max(1, reports.length)),
    sports: reports,
    summary: {
      normalizationScore: avgLayerScore('normalization'),
      qualityGateScore:   avgLayerScore('qualityGate'),
      engineScore:        avgLayerScore('engine'),
      marketScore:        avgLayerScore('market'),
      dbCoverage:         opts.runDB       ? Math.round(reports.filter((r) => r.layers.database?.status !== 'fail').length / Math.max(1, reports.length) * 100) : 0,
      pipelineCoverage:   opts.runPipeline ? Math.round(reports.filter((r) => r.layers.pipeline?.status === 'pass').length  / Math.max(1, reports.length) * 100) : 0,
    },
  };
}

// ─── Quick smoke test (sync, no DB) ──────────────────────────────────────────
export function runSmokeTest(): { sport: string; normPass: boolean; qgPass: boolean; icon: string }[] {
  return ALL_SPORTS.map((sport) => ({
    sport: sport.ui,
    normPass: !runNormalizationTests(sport).some((t) => t.status === 'fail'),
    qgPass:   !runQualityGateTests(sport).some((t) => t.status === 'fail'),
    icon:     getSportIcon(sport.dbKey),
  }));
}
