/**
 * home-feed — Unified Home Feed API (v2)
 *
 * Returns all data the home screen needs in a single request,
 * always reading from the DB first (never calling external APIs directly).
 * External API sync is handled by separate scheduled edge functions.
 *
 * Architecture:
 * - Supabase is the source of truth for all sports data
 * - API-Football, TheSportsDB, Highlightly are synced into DB by edge functions
 * - Mobile app NEVER calls external APIs directly
 * - Graceful fallback: if recent data is empty, return historical data
 * - "Last Updated" timestamps included in every section's metadata
 *
 * Response shape:
 * {
 *   featuredMatches, liveMatches, upcomingMatches, recentMatches,
 *   predictions, vipPredictions, expertTips, highlights,
 *   trendingLeagues, highConfidenceTips, personalisation, feedMeta
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface FeedRequest {
  sport?: string;
  isVip?: boolean;
  userId?: string;
  limit?: number;
}

interface TrendingLeague {
  leagueName: string;
  sport: string;
  matchCount: number;
  liveCount: number;
  leagueLogo: string | null;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startMs = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Parse request ─────────────────────────────────────────────────────────
    let body: FeedRequest = {};
    try { body = await req.json(); } catch { /* GET or empty body */ }

    const url = new URL(req.url);
    const sport  = body.sport  ?? url.searchParams.get('sport')  ?? 'all';
    const isVip  = body.isVip  ?? url.searchParams.get('isVip')  === 'true';
    const userId = body.userId ?? url.searchParams.get('userId') ?? null;
    const limit  = body.limit  ?? Number(url.searchParams.get('limit') ?? '12');
    const sportNorm = (sport !== 'all' && sport !== 'All') ? sport.toLowerCase() : null;

    console.log(`[home-feed] start | sport=${sport} isVip=${isVip} userId=${userId ? 'auth' : 'anon'}`);

    // ── Time windows ──────────────────────────────────────────────────────────
    const now     = new Date().toISOString();
    const plus7d  = new Date(Date.now() + 7  * 24 * 60 * 60 * 1000).toISOString();
    const minus48h= new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const minus12h= new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const minus7d = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
    const plus48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // ── Fire all queries in parallel ──────────────────────────────────────────
    const [
      liveResult,
      upcomingResult,
      recentResult,
      predictionsResult,
      expertTipsResult,
      allTodayResult,
      highlightsResult,
      newsResult,
    ] = await Promise.allSettled([
      // 1. Live matches
      withRetry(() => {
        let q = supabase.from('matches').select('*').eq('status', 'live');
        if (sportNorm) q = q.eq('sport', sportNorm);
        return q.order('minute', { ascending: false }).limit(30);
      }),

      // 2. Upcoming matches — next 7 days
      withRetry(() => {
        let q = supabase.from('matches').select('*').eq('status', 'upcoming');
        if (sportNorm) q = q.eq('sport', sportNorm);
        return q.gte('match_time', now).lte('match_time', plus7d)
          .order('match_time', { ascending: true }).limit(Math.max(limit, 30));
      }),

      // 3. Recently finished — last 48h
      withRetry(() => {
        let q = supabase.from('matches').select('*').eq('status', 'finished');
        if (sportNorm) q = q.eq('sport', sportNorm);
        return q.gte('match_time', minus48h).order('match_time', { ascending: false }).limit(12);
      }),

      // 4. AI Predictions
      withRetry(() =>
        supabase.from('predictions')
          .select('*, matches(home_team, away_team, status, home_score, away_score, league, sport, match_time, home_logo, away_logo, league_logo)')
          .gte('confidence', 55).order('confidence', { ascending: false }).limit(20)
      ),

      // 5. Expert tips
      withRetry(() => {
        let q = supabase.from('expert_tips')
          .select('id, expert_name, sport, match_label, tip_type, tip_value, odds, confidence, status, league, is_premium, created_at')
          .order('created_at', { ascending: false }).limit(15);
        if (!isVip) q = q.eq('is_premium', false);
        return q;
      }),

      // 6. Trending leagues
      withRetry(() =>
        supabase.from('matches').select('league, sport, status, league_logo')
          .gte('match_time', minus12h).lte('match_time', plus48h).limit(300)
      ),

      // 7. Highlights
      withRetry(() =>
        supabase.from('highlights')
          .select('id, title, sport, embed_url, thumbnail, home_team, away_team, league, event_date, created_at')
          .order('created_at', { ascending: false }).limit(8)
      ),

    // 8. News articles — fallback removes sport filter if empty
      withRetry(async () => {
        let q = supabase.from('news_articles')
          .select('id, external_id, source, sport, title, summary, author, url, image_url, tags, category, home_team, away_team, league, published_at, created_at')
          .order('published_at', { ascending: false }).limit(15);
        if (sportNorm) q = q.eq('sport', sportNorm);
        const res = await q;
        // If sport-filtered result is empty, retry without sport filter
        if (sportNorm && (!res.data || res.data.length === 0)) {
          return supabase.from('news_articles')
            .select('id, external_id, source, sport, title, summary, author, url, image_url, tags, category, home_team, away_team, league, published_at, created_at')
            .order('published_at', { ascending: false }).limit(15);
        }
        return res;
      }),
    ]);

    // ── Extract results ────────────────────────────────────────────────────────
    const liveMatches  = liveResult.status         === 'fulfilled' ? (liveResult.value.data ?? [])         : [];
    const upcoming     = upcomingResult.status      === 'fulfilled' ? (upcomingResult.value.data ?? [])     : [];
    let   recent       = recentResult.status        === 'fulfilled' ? (recentResult.value.data ?? [])       : [];
    const predictions  = predictionsResult.status   === 'fulfilled' ? (predictionsResult.value.data ?? [])  : [];
    const expertTips   = expertTipsResult.status    === 'fulfilled' ? (expertTipsResult.value.data ?? [])   : [];
    const allToday     = allTodayResult.status      === 'fulfilled' ? (allTodayResult.value.data ?? [])     : [];
    const highlights   = highlightsResult.status    === 'fulfilled' ? (highlightsResult.value.data ?? [])   : [];
    const newsArticles = newsResult.status          === 'fulfilled' ? (newsResult.value?.data ?? [])        : [];

    console.log(`[home-feed] news count: ${newsArticles.length} (sportNorm=${sportNorm ?? 'all'})`);

    // Historical fallback: if no recent finished matches, expand window to 7 days
    let recentSource = 'live';
    if (recent.length === 0) {
      try {
        let hq = supabase.from('matches').select('*').eq('status', 'finished')
          .gte('match_time', minus7d).order('match_time', { ascending: false }).limit(12);
        if (sportNorm) hq = hq.eq('sport', sportNorm);
        const { data: hist } = await hq;
        if (hist && hist.length > 0) {
          recent = hist;
          recentSource = 'historical';
        }
      } catch { /* non-blocking */ }
    }

    // Log query status without sensitive data
    const queryResults = [liveResult, upcomingResult, recentResult, predictionsResult, expertTipsResult, allTodayResult, highlightsResult, newsResult];
    const queryCounts = queryResults.map((r) => r.status === 'fulfilled' ? ((r.value as any)?.data?.length ?? 0) : -1);
    console.log(`[home-feed] queries | live=${queryCounts[0]} upcoming=${queryCounts[1]} recent=${queryCounts[2]} preds=${queryCounts[3]} tips=${queryCounts[4]} highlights=${queryCounts[6]} news=${queryCounts[7]}`);

    // ── Featured match ────────────────────────────────────────────────────────
    const featuredMatches = [
      ...(liveMatches.slice(0, 1)),
      ...(liveMatches.length === 0 ? upcoming.slice(0, 1) : []),
    ];

    // ── VIP predictions split ─────────────────────────────────────────────────
    const vipPredictions     = predictions.filter((p: any) => (p.confidence ?? 0) >= 80);
    const normalPredictions  = predictions.filter((p: any) => (p.confidence ?? 0) >= 55);
    const highConfidenceTips = expertTips.filter((t: any) => (t.confidence ?? 0) >= 85).slice(0, 5);

    // ── Trending leagues ──────────────────────────────────────────────────────
    const leagueMap = new Map<string, TrendingLeague>();
    for (const m of allToday) {
      if (!m.league) continue;
      if (!leagueMap.has(m.league)) {
        leagueMap.set(m.league, { leagueName: m.league, sport: m.sport ?? 'football', matchCount: 0, liveCount: 0, leagueLogo: m.league_logo ?? null });
      }
      const entry = leagueMap.get(m.league)!;
      entry.matchCount++;
      if (m.status === 'live') entry.liveCount++;
    }
    const trendingLeagues = [...leagueMap.values()]
      .sort((a, b) => b.liveCount - a.liveCount || b.matchCount - a.matchCount).slice(0, 8);

    // ── Personalisation ───────────────────────────────────────────────────────
    let followedLeagues: string[] = [];
    if (userId) {
      try {
        const { data: userPreds } = await supabase.from('predictions').select('matches(league)').eq('user_id', userId).limit(20);
        const leagueCounts: Record<string, number> = {};
        for (const p of (userPreds ?? [])) {
          const league = (p.matches as any)?.league;
          if (league) leagueCounts[league] = (leagueCounts[league] ?? 0) + 1;
        }
        followedLeagues = Object.entries(leagueCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l);
      } catch { /* non-blocking */ }
    }

    const elapsed = Date.now() - startMs;
    const dataSource = liveMatches.length > 0 ? 'live'
      : upcoming.length > 0 ? 'upcoming'
      : recent.length > 0 ? recentSource
      : 'empty';

    console.log(`[home-feed] done | ${elapsed}ms | live=${liveMatches.length} upcoming=${upcoming.length} preds=${predictions.length} src=${dataSource}`);

    return new Response(
      JSON.stringify({
        featuredMatches,
        liveMatches,
        upcomingMatches: upcoming,
        recentMatches: recent,
        predictions: normalPredictions,
        vipPredictions,
        expertTips,
        highlights,
        news: newsArticles,
        trendingLeagues,
        highConfidenceTips,
        personalisation: { followedLeagues, hasPersonalisation: followedLeagues.length > 0 },
        feedMeta: {
          generatedAt: new Date().toISOString(),
          liveCount: liveMatches.length,
          upcomingCount: upcoming.length,
          recentCount: recent.length,
          predictionsCount: predictions.length,
          highlightsCount: highlights.length,
          newsCount: newsArticles.length,
          elapsed_ms: elapsed,
          sport,
          isVip,
          dataSource,
          recentSource,
        },
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          // Cloudflare edge cache: 30s for live data, 60s stale-while-revalidate
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
          // Cloudflare cache tags for targeted purging (requires CF Enterprise or use prefix purge)
          'Cache-Tag': `home-feed,sport-${sport.toLowerCase()},${isVip ? 'vip' : 'free'}`,
          // Vary by sport param so cache entries are sport-specific
          'Vary': 'Accept-Encoding',
          'X-PX-Data-Source': dataSource,
          'X-PX-Generated-At': new Date().toISOString(),
        },
      },
    );
  } catch (err) {
    console.error('[home-feed] fatal error:', err);
    return new Response(
      JSON.stringify({
        error: 'Feed temporarily unavailable',
        details: err instanceof Error ? err.message : String(err),
        featuredMatches: [], liveMatches: [], upcomingMatches: [], recentMatches: [],
        predictions: [], vipPredictions: [], expertTips: [], highlights: [],
        trendingLeagues: [], highConfidenceTips: [],
        personalisation: { followedLeagues: [], hasPersonalisation: false },
        feedMeta: {
          generatedAt: new Date().toISOString(),
          liveCount: 0, upcomingCount: 0, predictionsCount: 0,
          elapsed_ms: Date.now() - startMs, error: true, dataSource: 'empty',
        },
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
