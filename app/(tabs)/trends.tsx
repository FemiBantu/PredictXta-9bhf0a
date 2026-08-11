/**
 * Trends — Highlights & News Hub
 * Full-featured tab with sport/category filters, like & share actions, and in-app video player.
 * DB-backed likes/bookmarks via video_likes and news_bookmarks tables.
 */

import React, {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  RefreshControl, ActivityIndicator, Share, Linking,
  Animated, Modal, TouchableWithoutFeedback,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { getSupabaseClient, useAuth } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';

// ─── Constants ───────────────────────────────────────────────────────────────
const LIKES_KEY = '@predictxta/trends_likes_v1';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Highlight {
  id: string;
  externalId: string;
  sport: string;
  title: string;
  embedUrl: string | null;
  videoUrl: string | null;
  thumbnail: string | null;
  league: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  eventDate: string | null;
}

interface NewsArticle {
  id: string;
  source: string;
  sport: string;
  title: string;
  summary: string | null;
  url: string | null;
  imageUrl: string | null;
  category: string;
  homeTeam: string | null;
  awayTeam: string | null;
  league: string | null;
  publishedAt: string | null;
}

// ─── Sport chips for highlights ───────────────────────────────────────────────
const HIGHLIGHT_SPORTS = [
  { id: 'all',        label: 'All',        emoji: '🌐' },
  { id: 'football',   label: 'Football',   emoji: '⚽' },
  { id: 'basketball', label: 'Basketball', emoji: '🏀' },
  { id: 'tennis',     label: 'Tennis',     emoji: '🎾' },
  { id: 'cricket',    label: 'Cricket',    emoji: '🏏' },
  { id: 'mma',        label: 'MMA',        emoji: '🥊' },
  { id: 'baseball',   label: 'Baseball',   emoji: '⚾' },
  { id: 'hockey',     label: 'Hockey',     emoji: '🏒' },
  { id: 'rugby',      label: 'Rugby',      emoji: '🏉' },
] as const;

type HighlightSportId = typeof HIGHLIGHT_SPORTS[number]['id'];

const NEWS_CATEGORIES = [
  { id: 'all',        label: 'All',        color: '#6B7280' },
  { id: 'highlights', label: 'Highlights', color: '#EF4444' },
  { id: 'preview',    label: 'Preview',    color: '#3B82F6' },
  { id: 'analysis',   label: 'Analysis',   color: '#8B5CF6' },
  { id: 'news',       label: 'News',       color: '#22C55E' },
  { id: 'editorial',  label: 'Editorial',  color: '#F59E0B' },
] as const;

type NewsCategoryId = typeof NEWS_CATEGORIES[number]['id'];

const SPORT_EMOJI: Record<string, string> = {
  football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏',
  mma: '🥊', baseball: '⚾', hockey: '🏒', rugby: '🏉',
  volleyball: '🏐', handball: '🤾', formula1: '🏎️', esports: '🎮',
};
const SOURCE_LABELS: Record<string, string> = {
  thesportsdb: 'TheSportsDB', 'api-football': 'API-Football',
};
const CATEGORY_COLORS: Record<string, string> = {
  highlights: '#EF4444', preview: '#3B82F6', analysis: '#8B5CF6',
  news: '#22C55E', editorial: '#F59E0B',
};

// ─── Data fetchers ────────────────────────────────────────────────────────────
async function fetchHighlights(sport: HighlightSportId, limit = 30): Promise<Highlight[]> {
  try {
    const sb = getSupabaseClient();
    let query = sb
      .from('highlights')
      .select('id, external_id, sport, title, embed_url, video_url, thumbnail, league, home_team, away_team, event_date')
      .order('event_date', { ascending: false })
      .limit(limit);
    if (sport !== 'all') query = query.eq('sport', sport);
    const { data } = await query;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      externalId: r.external_id,
      sport: r.sport,
      title: r.title,
      embedUrl: r.embed_url ?? null,
      videoUrl: r.video_url ?? null,
      thumbnail: r.thumbnail ?? null,
      league: r.league ?? null,
      homeTeam: r.home_team ?? null,
      awayTeam: r.away_team ?? null,
      eventDate: r.event_date ?? null,
    }));
  } catch { return []; }
}

async function fetchHighlightSportCounts(): Promise<Partial<Record<HighlightSportId, number>>> {
  try {
    const sb = getSupabaseClient();
    const counts: Partial<Record<HighlightSportId, number>> = {};
    const results = await Promise.allSettled(
      HIGHLIGHT_SPORTS.filter((s) => s.id !== 'all').map(async (sp) => {
        const { count } = await sb.from('highlights').select('id', { count: 'exact', head: true }).eq('sport', sp.id);
        return { sport: sp.id, count: count ?? 0 };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') counts[r.value.sport as HighlightSportId] = r.value.count;
    }
    return counts;
  } catch { return {}; }
}

async function fetchNews(category: NewsCategoryId, limit = 40): Promise<NewsArticle[]> {
  try {
    const sb = getSupabaseClient();
    let query = sb
      .from('news_articles')
      .select('id, source, sport, title, summary, url, image_url, category, home_team, away_team, league, published_at')
      .order('published_at', { ascending: false })
      .limit(limit);
    if (category !== 'all') query = query.eq('category', category);
    const { data } = await query;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      source: r.source,
      sport: r.sport,
      title: r.title,
      summary: r.summary ?? null,
      url: r.url ?? null,
      imageUrl: r.image_url ?? null,
      category: r.category ?? 'news',
      homeTeam: r.home_team ?? null,
      awayTeam: r.away_team ?? null,
      league: r.league ?? null,
      publishedAt: r.published_at ?? null,
    }));
  } catch { return []; }
}

// ─── Likes persistence ────────────────────────────────────────────────────────
async function loadLikes(): Promise<{ highlights: Set<string>; news: Set<string> }> {
  try {
    const raw = await AsyncStorage.getItem(LIKES_KEY);
    if (!raw) return { highlights: new Set(), news: new Set() };
    const parsed = JSON.parse(raw);
    return {
      highlights: new Set(parsed.highlights ?? []),
      news: new Set(parsed.news ?? []),
    };
  } catch { return { highlights: new Set(), news: new Set() }; }
}

async function saveLikes(likes: { highlights: Set<string>; news: Set<string> }) {
  try {
    await AsyncStorage.setItem(LIKES_KEY, JSON.stringify({
      highlights: [...likes.highlights],
      news: [...likes.news],
    }));
  } catch { /* non-blocking */ }
}

// ─── In-App Highlight Player Modal ────────────────────────────────────────────
function HighlightPlayerModal({
  highlight, onClose, C,
}: { highlight: Highlight | null; onClose: () => void; C: AppColors }) {
  const insets = useSafeAreaInsets();
  const [webLoading, setWebLoading] = useState(true);
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (highlight) {
      setWebLoading(true);
      Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 12 }).start();
    } else {
      slideAnim.setValue(0);
    }
  }, [highlight]);

  if (!highlight) return null;

  const embedSrc = highlight.embedUrl ?? highlight.videoUrl;
  const sportMeta = HIGHLIGHT_SPORTS.find((s) => s.id === highlight.sport);
  const emoji = sportMeta?.emoji ?? '🏆';
  const matchLabel = highlight.homeTeam && highlight.awayTeam
    ? `${highlight.homeTeam} vs ${highlight.awayTeam}`
    : highlight.title;

  const htmlContent = embedSrc ? `
    <!DOCTYPE html><html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <style>* { margin:0; padding:0; box-sizing:border-box; } body { background:#000; width:100vw; height:100vh; display:flex; align-items:center; justify-content:center; } iframe,video { width:100%; height:100%; border:none; object-fit:contain; }</style></head>
    <body>${
      embedSrc.includes('<iframe') || embedSrc.includes('<video') ? embedSrc
      : embedSrc.match(/\.(mp4|webm|ogg)/i)
        ? `<video src="${embedSrc}" controls autoplay playsinline></video>`
        : `<iframe src="${embedSrc}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe>`
    }</body></html>
  ` : '';

  const sheetTranslate = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [700, 0] });

  const handleShare = async () => {
    try {
      await Share.share({
        title: matchLabel,
        message: `Watch: ${matchLabel}${highlight.league ? ` — ${highlight.league}` : ''}${highlight.videoUrl ? `\n${highlight.videoUrl}` : ''}`,
        url: highlight.videoUrl ?? undefined,
      });
    } catch { /* user cancelled */ }
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={hpm.backdrop} />
      </TouchableWithoutFeedback>
      <Animated.View style={[hpm.sheet, { backgroundColor: '#000', borderTopColor: '#222', paddingBottom: insets.bottom + 8 }, { transform: [{ translateY: sheetTranslate }] }]}>
        <View style={[hpm.header, { backgroundColor: '#111', borderBottomColor: '#222' }]}>
          <View style={hpm.headerLeft}>
            <Text style={hpm.headerEmoji}>{emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={hpm.headerTitle} numberOfLines={1}>{matchLabel}</Text>
              {highlight.league ? <Text style={hpm.headerLeague} numberOfLines={1}>{highlight.league}</Text> : null}
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => [hpm.closeBtn, pressed ? { opacity: 0.6 } : null]}>
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
        </View>
        <View style={hpm.videoWrap}>
          {embedSrc && htmlContent ? (
            <>
              {webLoading ? (
                <View style={hpm.loadingOverlay}>
                  <ActivityIndicator size="large" color={C.accentRed} />
                  <Text style={hpm.loadingText}>Loading highlight...</Text>
                </View>
              ) : null}
              <WebView source={{ html: htmlContent }} style={hpm.webview} allowsFullscreenVideo allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled domStorageEnabled onLoadEnd={() => setWebLoading(false)} onError={() => setWebLoading(false)} />
            </>
          ) : (
            <View style={hpm.noVideoWrap}>
              <Text style={{ fontSize: 48 }}>{emoji}</Text>
              <Text style={hpm.noVideoTitle}>No video available</Text>
            </View>
          )}
        </View>
        <View style={[hpm.footer, { borderTopColor: '#222' }]}>
          <View style={[hpm.sportBadge, { backgroundColor: `${C.accentRed}20`, borderColor: `${C.accentRed}44` }]}>
            <Text style={hpm.sportBadgeEmoji}>{emoji}</Text>
            <Text style={[hpm.sportBadgeText, { color: C.accentRed }]}>{highlight.sport.toUpperCase()}</Text>
          </View>
          {highlight.eventDate ? (
            <Text style={hpm.dateText}>{new Date(highlight.eventDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
          ) : null}
          <Pressable onPress={handleShare} style={({ pressed }) => [hpm.shareBtn, { backgroundColor: `${C.accentBlue}20`, borderColor: `${C.accentBlue}44` }, pressed ? { opacity: 0.7 } : null]}>
            <Ionicons name="share-outline" size={14} color={C.accentBlue} />
            <Text style={[hpm.shareBtnText, { color: C.accentBlue }]}>Share</Text>
          </Pressable>
          {highlight.videoUrl ? (
            <Pressable onPress={() => Linking.openURL(highlight.videoUrl!).catch(() => {})} style={({ pressed }) => [hpm.externalBtn, pressed ? { opacity: 0.7 } : null]}>
              <Ionicons name="open-outline" size={13} color="#888" />
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </Modal>
  );
}

const hpm = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerEmoji: { fontSize: 20 },
  headerTitle: { fontSize: 14, fontWeight: FONTS.bold, color: '#fff', lineHeight: 18 },
  headerLeague: { fontSize: 11, color: '#aaa', marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  videoWrap: { width: '100%', height: 230, backgroundColor: '#000', position: 'relative' },
  webview: { flex: 1, backgroundColor: '#000' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', gap: 10 },
  loadingText: { fontSize: 13, color: '#aaa' },
  noVideoWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  noVideoTitle: { fontSize: 15, fontWeight: FONTS.bold, color: '#fff' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  sportBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  sportBadgeEmoji: { fontSize: 12 },
  sportBadgeText: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.5 },
  dateText: { flex: 1, fontSize: 11, color: '#888', textAlign: 'center' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  shareBtnText: { fontSize: 12, fontWeight: FONTS.semiBold },
  externalBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
});

// ─── Highlight Card ───────────────────────────────────────────────────────────
function HighlightCard({
  highlight, liked, onPlay, onLike, onShare, C,
}: {
  highlight: Highlight;
  liked: boolean;
  onPlay: () => void;
  onLike: () => void;
  onShare: () => void;
  C: AppColors;
}) {
  const sportMeta = HIGHLIGHT_SPORTS.find((s) => s.id === highlight.sport);
  const emoji = sportMeta?.emoji ?? '🏆';
  const matchLabel = highlight.homeTeam && highlight.awayTeam
    ? `${highlight.homeTeam} vs ${highlight.awayTeam}`
    : null;
  const formattedDate = highlight.eventDate
    ? new Date(highlight.eventDate).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : null;

  return (
    <View style={[hlc.card, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Thumbnail */}
      <Pressable onPress={onPlay} style={({ pressed }) => [hlc.thumbWrap, { backgroundColor: C.surface }, pressed ? { opacity: 0.9 } : null]}>
        {highlight.thumbnail ? (
          <Image source={{ uri: highlight.thumbnail }} style={hlc.thumb} contentFit="cover" transition={200} />
        ) : (
          <View style={[hlc.thumbFallback, { backgroundColor: C.surface }]}>
            <Text style={{ fontSize: 42 }}>{emoji}</Text>
          </View>
        )}
        {/* Play overlay */}
        <View style={hlc.playOverlay}>
          <View style={[hlc.playCircle, { backgroundColor: 'rgba(255,255,255,0.92)' }]}>
            <Ionicons name="play" size={18} color="#111" style={{ marginLeft: 3 }} />
          </View>
        </View>
        {/* Sport badge */}
        <View style={[hlc.sportBadge, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <Text style={{ fontSize: 12 }}>{emoji}</Text>
        </View>
        {/* Date badge */}
        {formattedDate ? (
          <View style={[hlc.dateBadge, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
            <Text style={hlc.dateBadgeText}>{formattedDate}</Text>
          </View>
        ) : null}
      </Pressable>

      {/* Info + actions */}
      <View style={hlc.infoRow}>
        <View style={{ flex: 1, gap: 2 }}>
          {matchLabel ? (
            <Text style={[hlc.matchTitle, { color: C.textPrimary }]} numberOfLines={1}>{matchLabel}</Text>
          ) : (
            <Text style={[hlc.matchTitle, { color: C.textPrimary }]} numberOfLines={2}>{highlight.title}</Text>
          )}
          {highlight.league ? (
            <Text style={[hlc.leagueText, { color: C.textMuted }]} numberOfLines={1}>{highlight.league}</Text>
          ) : null}
        </View>
        {/* Actions */}
        <View style={hlc.actions}>
          <Pressable
            onPress={onLike}
            hitSlop={8}
            style={({ pressed }) => [hlc.actionBtn, { backgroundColor: liked ? `${C.accentRed}18` : C.surface, borderColor: liked ? `${C.accentRed}44` : C.border }, pressed ? { opacity: 0.7, transform: [{ scale: 0.93 }] } : null]}
          >
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={16} color={liked ? C.accentRed : C.textMuted} />
          </Pressable>
          <Pressable
            onPress={onShare}
            hitSlop={8}
            style={({ pressed }) => [hlc.actionBtn, { backgroundColor: C.surface, borderColor: C.border }, pressed ? { opacity: 0.7, transform: [{ scale: 0.93 }] } : null]}
          >
            <Ionicons name="share-social-outline" size={16} color={C.textMuted} />
          </Pressable>
          <Pressable
            onPress={onPlay}
            style={({ pressed }) => [hlc.playBtn, { backgroundColor: C.accentRed }, pressed ? { opacity: 0.85 } : null]}
          >
            <Ionicons name="play" size={12} color="#fff" style={{ marginLeft: 1 }} />
            <Text style={hlc.playBtnText}>Play</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const hlc = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  thumbWrap: { width: '100%', height: 190, position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  playCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 6 },
  sportBadge: { position: 'absolute', top: 10, left: 10, borderRadius: RADIUS.md, paddingHorizontal: 8, paddingVertical: 4 },
  dateBadge: { position: 'absolute', bottom: 10, right: 10, borderRadius: RADIUS.md, paddingHorizontal: 7, paddingVertical: 3 },
  dateBadgeText: { fontSize: 10, color: '#fff', fontWeight: FONTS.semiBold },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  matchTitle: { fontSize: 13, fontWeight: FONTS.bold, lineHeight: 18 },
  leagueText: { fontSize: 11 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  actionBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  playBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 7, minHeight: 34 },
  playBtnText: { fontSize: 12, fontWeight: FONTS.bold, color: '#fff' },
});

// ─── News Card ────────────────────────────────────────────────────────────────
function NewsCard({
  article, liked, bookmarked, onLike, onBookmark, onShare, C,
}: {
  article: NewsArticle;
  liked: boolean;
  bookmarked?: boolean;
  onLike: () => void;
  onBookmark?: () => void;
  onShare: () => void;
  C: AppColors;
}) {
  const catColor = CATEGORY_COLORS[article.category] ?? C.textMuted;
  const emoji = SPORT_EMOJI[article.sport?.toLowerCase()] ?? '🏆';
  const sourceLabel = SOURCE_LABELS[article.source] ?? article.source;
  const hasImage = Boolean(article.imageUrl);
  const formattedDate = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : '';

  const handlePress = useCallback(() => {
    if (article.url) Linking.openURL(article.url).catch(() => {});
  }, [article.url]);

  return (
    <Pressable
      onPress={article.url ? handlePress : undefined}
      style={({ pressed }) => [nwc.card, { backgroundColor: C.card, borderColor: C.border }, pressed && article.url ? { opacity: 0.9, transform: [{ scale: 0.985 }] } : null]}
    >
      {hasImage ? (
        <View style={[nwc.imageWrap, { backgroundColor: C.surface }]}>
          <Image source={{ uri: article.imageUrl! }} style={nwc.image} contentFit="cover" transition={200} />
          <View style={[nwc.imageCatPill, { backgroundColor: `${catColor}EE` }]}>
            <Text style={nwc.imageCatText}>{article.category.toUpperCase()}</Text>
          </View>
          <View style={[nwc.imageSportBadge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
            <Text style={{ fontSize: 15 }}>{emoji}</Text>
          </View>
        </View>
      ) : (
        <View style={[nwc.catStripe, { backgroundColor: catColor }]}>
          <Text style={{ fontSize: 22 }}>{emoji}</Text>
          <View style={[nwc.catStripePill, { backgroundColor: 'rgba(0,0,0,0.25)' }]}>
            <Text style={nwc.catStripeText}>{article.category.toUpperCase()}</Text>
          </View>
        </View>
      )}

      <View style={nwc.body}>
        {/* Meta row */}
        <View style={nwc.metaRow}>
          <View style={[nwc.sourcePill, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Text style={[nwc.sourceText, { color: C.textMuted }]}>{sourceLabel}</Text>
          </View>
          <Text style={[nwc.dateText, { color: C.textMuted }]}>{formattedDate}</Text>
          {article.url ? <Ionicons name="open-outline" size={11} color={C.textMuted} /> : null}
        </View>

        {/* Headline */}
        {article.homeTeam && article.awayTeam ? (
          <Text style={[nwc.headline, { color: C.textPrimary }]} numberOfLines={2}>
            {article.homeTeam} <Text style={{ fontWeight: FONTS.regular, color: C.textMuted }}>vs</Text> {article.awayTeam}
          </Text>
        ) : (
          <Text style={[nwc.headline, { color: C.textPrimary }]} numberOfLines={2}>{article.title}</Text>
        )}

        {article.summary ? (
          <Text style={[nwc.summary, { color: C.textSecondary }]} numberOfLines={3}>{article.summary}</Text>
        ) : null}

        {/* Footer: league + action buttons */}
        <View style={nwc.footerRow}>
          {article.league ? (
            <View style={nwc.leagueRow}>
              <Ionicons name="trophy-outline" size={10} color={C.textMuted} />
              <Text style={[nwc.leagueText, { color: C.textMuted }]} numberOfLines={1}>{article.league}</Text>
            </View>
          ) : <View style={{ flex: 1 }} />}

          {/* Like, Bookmark & Share */}
          <Pressable
            onPress={(e) => { (e as any).stopPropagation?.(); onLike(); }}
            hitSlop={8}
            style={({ pressed }) => [nwc.actionBtn, liked ? { backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}44` } : { backgroundColor: C.surface, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
          >
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={14} color={liked ? C.accentRed : C.textMuted} />
          </Pressable>
          {onBookmark ? (
            <Pressable
              onPress={(e) => { (e as any).stopPropagation?.(); onBookmark(); }}
              hitSlop={8}
              style={({ pressed }) => [nwc.actionBtn, bookmarked ? { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}44` } : { backgroundColor: C.surface, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
            >
              <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={14} color={bookmarked ? C.primary : C.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={(e) => { (e as any).stopPropagation?.(); onShare(); }}
            hitSlop={8}
            style={({ pressed }) => [nwc.actionBtn, { backgroundColor: C.surface, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
          >
            <Ionicons name="share-social-outline" size={14} color={C.textMuted} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const nwc = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  imageWrap: { width: '100%', height: 165, position: 'relative' },
  image: { width: '100%', height: '100%' },
  imageCatPill: { position: 'absolute', top: 10, left: 10, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  imageCatText: { fontSize: 9, fontWeight: FONTS.extraBold, color: '#fff', letterSpacing: 0.6 },
  imageSportBadge: { position: 'absolute', top: 10, right: 10, borderRadius: RADIUS.md, paddingHorizontal: 7, paddingVertical: 4 },
  catStripe: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  catStripePill: { borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  catStripeText: { fontSize: 9, fontWeight: FONTS.extraBold, color: '#fff', letterSpacing: 0.6 },
  body: { padding: 14, gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourcePill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  sourceText: { fontSize: 10, fontWeight: FONTS.semiBold },
  dateText: { flex: 1, fontSize: 10, textAlign: 'right' },
  headline: { fontSize: 15, fontWeight: FONTS.bold, lineHeight: 21 },
  summary: { fontSize: 13, lineHeight: 19 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leagueRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  leagueText: { flex: 1, fontSize: 11, fontWeight: FONTS.medium },
  actionBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

// ─── DB-backed likes helpers ─────────────────────────────────────────────────
async function fetchDbLikes(userId: string, table: string, idCol: string): Promise<Set<string>> {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb.from(table).select(idCol).eq('user_id', userId);
    return new Set((data ?? []).map((r: any) => r[idCol] as string));
  } catch { return new Set(); }
}

async function toggleDbLike(
  userId: string | undefined,
  table: string,
  idCol: string,
  contentId: string,
  liked: boolean,
): Promise<void> {
  if (!userId) return;
  const sb = getSupabaseClient();
  if (liked) {
    await sb.from(table).delete().eq(idCol, contentId).eq('user_id', userId).catch(() => {});
  } else {
    await sb.from(table).insert({ [idCol]: contentId, user_id: userId }).catch(() => {});
  }
}

// ─── Highlights Tab ───────────────────────────────────────────────────────────
function HighlightsTab({ C }: { C: AppColors }) {
  const { user } = useAuth();
  const [selectedSport, setSelectedSport] = useState<HighlightSportId>('all');
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [sportCounts, setSportCounts] = useState<Partial<Record<HighlightSportId, number>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeHighlight, setActiveHighlight] = useState<Highlight | null>(null);
  const [likes, setLikes] = useState<Set<string>>(new Set());

  // Load likes — prefer DB for authenticated users
  useEffect(() => {
    if (user?.id) {
      fetchDbLikes(user.id, 'video_likes', 'highlight_id').then(setLikes);
    } else {
      loadLikes().then((l) => setLikes(l.highlights));
    }
  }, [user?.id]);

  // Load sport counts once
  useEffect(() => {
    fetchHighlightSportCounts().then(setSportCounts).catch(() => {});
  }, []);

  // Load highlights on sport change
  useEffect(() => {
    setLoading(true);
    fetchHighlights(selectedSport)
      .then(setHighlights)
      .catch(() => setHighlights([]))
      .finally(() => setLoading(false));
  }, [selectedSport]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      fetchHighlights(selectedSport).then(setHighlights),
      fetchHighlightSportCounts().then(setSportCounts),
    ]);
    setRefreshing(false);
  }, [selectedSport]);

  const handleLike = useCallback(async (id: string) => {
    const wasLiked = likes.has(id);
    setLikes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (!user?.id) loadLikes().then((l) => { l.highlights = next; saveLikes(l); });
      return next;
    });
    // Persist to DB
    await toggleDbLike(user?.id, 'video_likes', 'highlight_id', id, wasLiked);
  }, [likes, user?.id]);

  const handleShare = useCallback(async (h: Highlight) => {
    const title = h.homeTeam && h.awayTeam ? `${h.homeTeam} vs ${h.awayTeam}` : h.title;
    try {
      await Share.share({
        title,
        message: `Watch ${title}${h.league ? ` — ${h.league}` : ''}${h.videoUrl ? `\n${h.videoUrl}` : ''}`,
        url: h.videoUrl ?? undefined,
      });
    } catch { /* user cancelled */ }
  }, []);

  const totalCount = Object.values(sportCounts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <View style={{ flex: 1 }}>
      {/* Sport filter chips */}
      <View style={[ft.filterWrap, { borderBottomColor: C.border, backgroundColor: C.surface }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ft.filterContent}>
          {HIGHLIGHT_SPORTS.map((sp) => {
            const isSel = sp.id === selectedSport;
            const count = sp.id === 'all' ? totalCount : (sportCounts[sp.id as HighlightSportId] ?? 0);
            const hasData = sp.id === 'all' ? totalCount > 0 : count > 0;
            return (
              <Pressable
                key={sp.id}
                style={({ pressed }) => [
                  ft.chip,
                  isSel ? { backgroundColor: `${C.accentRed}18`, borderColor: C.accentRed }
                    : hasData ? { backgroundColor: C.card, borderColor: C.border }
                    : { backgroundColor: C.card, borderColor: C.border, opacity: 0.38 },
                  pressed && !isSel && hasData ? { opacity: 0.7 } : null,
                ]}
                onPress={() => hasData || sp.id === 'all' ? setSelectedSport(sp.id) : null}
              >
                <Text style={ft.chipEmoji}>{sp.emoji}</Text>
                <Text style={[ft.chipLabel, { color: isSel ? C.accentRed : hasData ? C.textSecondary : C.textMuted }, isSel ? { fontWeight: FONTS.bold } : null]}>{sp.label}</Text>
                {count > 0 ? (
                  <View style={[ft.countBadge, { backgroundColor: isSel ? C.accentRed : C.surface, borderColor: isSel ? C.accentRed : C.border }]}>
                    <Text style={[ft.countText, { color: isSel ? '#fff' : C.textMuted }]}>{count > 99 ? '99+' : count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={ft.centered}><ActivityIndicator size="large" color={C.accentRed} /></View>
      ) : highlights.length === 0 ? (
        <View style={ft.emptyWrap}>
          <Text style={{ fontSize: 52 }}>{HIGHLIGHT_SPORTS.find((s) => s.id === selectedSport)?.emoji ?? '🎬'}</Text>
          <Text style={[ft.emptyTitle, { color: C.textPrimary }]}>No highlights yet</Text>
          <Text style={[ft.emptySub, { color: C.textMuted }]}>Run a Highlights sync from Admin to populate {selectedSport === 'all' ? 'clips' : selectedSport + ' clips'}.</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accentRed} />}
        >
          {highlights.map((h) => (
            <HighlightCard
              key={h.id}
              highlight={h}
              liked={likes.has(h.id)}
              onPlay={() => setActiveHighlight(h)}
              onLike={() => handleLike(h.id)}
              onShare={() => handleShare(h)}
              C={C}
            />
          ))}
        </ScrollView>
      )}

      <HighlightPlayerModal highlight={activeHighlight} onClose={() => setActiveHighlight(null)} C={C} />
    </View>
  );
}

// ─── News Tab ─────────────────────────────────────────────────────────────────
function NewsTab({ C }: { C: AppColors }) {
  const { user } = useAuth();
  const [category, setCategory] = useState<NewsCategoryId>('all');
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Partial<Record<NewsCategoryId, number>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [likes, setLikes] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());

  // Load likes
  useEffect(() => {
    if (user?.id) {
      fetchDbLikes(user.id, 'news_bookmarks', 'article_id').then(setBookmarks);
    }
    loadLikes().then((l) => setLikes(l.news));
  }, [user?.id]);

  // Load category counts
  useEffect(() => {
    (async () => {
      try {
        const sb = getSupabaseClient();
        const results = await Promise.allSettled(
          NEWS_CATEGORIES.filter((c) => c.id !== 'all').map(async (cat) => {
            const { count } = await sb.from('news_articles').select('id', { count: 'exact', head: true }).eq('category', cat.id);
            return { id: cat.id, count: count ?? 0 };
          })
        );
        const counts: Partial<Record<NewsCategoryId, number>> = {};
        for (const r of results) {
          if (r.status === 'fulfilled') counts[r.value.id as NewsCategoryId] = r.value.count;
        }
        setCategoryCounts(counts);
      } catch { /* ignore */ }
    })();
  }, []);

  // Load news on category change
  useEffect(() => {
    setLoading(true);
    fetchNews(category)
      .then(setNews)
      .catch(() => setNews([]))
      .finally(() => setLoading(false));
  }, [category]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchNews(category).then(setNews).catch(() => {});
    setRefreshing(false);
  }, [category]);

  const handleLike = useCallback(async (id: string) => {
    setLikes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      loadLikes().then((l) => { l.news = next; saveLikes(l); });
      return next;
    });
  }, []);

  const handleBookmark = useCallback(async (id: string) => {
    const wasBookmarked = bookmarks.has(id);
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    await toggleDbLike(user?.id, 'news_bookmarks', 'article_id', id, wasBookmarked);
  }, [bookmarks, user?.id]);

  const handleShare = useCallback(async (a: NewsArticle) => {
    const headline = a.homeTeam && a.awayTeam ? `${a.homeTeam} vs ${a.awayTeam}` : a.title;
    try {
      await Share.share({
        title: headline,
        message: `${headline}${a.league ? ` — ${a.league}` : ''}${a.url ? `\n${a.url}` : ''}`,
        url: a.url ?? undefined,
      });
    } catch { /* user cancelled */ }
  }, []);

  const totalCount = news.length;

  return (
    <View style={{ flex: 1 }}>
      {/* Category filter */}
      <View style={[ft.filterWrap, { borderBottomColor: C.border, backgroundColor: C.surface }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ft.filterContent}>
          {NEWS_CATEGORIES.map((cat) => {
            const isSel = cat.id === category;
            const count = cat.id === 'all' ? totalCount : (categoryCounts[cat.id] ?? 0);
            return (
              <Pressable
                key={cat.id}
                style={({ pressed }) => [
                  ft.chip,
                  isSel ? { backgroundColor: `${cat.color}18`, borderColor: cat.color } : { backgroundColor: C.card, borderColor: C.border },
                  pressed && !isSel ? { opacity: 0.7 } : null,
                ]}
                onPress={() => setCategory(cat.id)}
              >
                <Text style={[ft.chipLabel, { color: isSel ? cat.color : C.textSecondary }, isSel ? { fontWeight: FONTS.bold } : null]}>{cat.label}</Text>
                {count > 0 ? (
                  <View style={[ft.countBadge, { backgroundColor: isSel ? cat.color : C.surface, borderColor: isSel ? cat.color : C.border }]}>
                    <Text style={[ft.countText, { color: isSel ? '#fff' : C.textMuted }]}>{count > 99 ? '99+' : count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={ft.centered}><ActivityIndicator size="large" color={C.primary} /></View>
      ) : news.length === 0 ? (
        <View style={ft.emptyWrap}>
          <Text style={{ fontSize: 52 }}>📰</Text>
          <Text style={[ft.emptyTitle, { color: C.textPrimary }]}>No articles yet</Text>
          <Text style={[ft.emptySub, { color: C.textMuted }]}>Run a News sync from Admin to populate articles.</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        >
          {news.map((a) => (
            <NewsCard
              key={a.id}
              article={a}
              liked={likes.has(a.id)}
              bookmarked={bookmarks.has(a.id)}
              onLike={() => handleLike(a.id)}
              onBookmark={() => handleBookmark(a.id)}
              onShare={() => handleShare(a)}
              C={C}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const ft = StyleSheet.create({
  filterWrap: { borderBottomWidth: 1 },
  filterContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 9, gap: 7 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, height: 34 },
  chipEmoji: { fontSize: 13 },
  chipLabel: { fontSize: 12, fontWeight: FONTS.semiBold },
  countBadge: { minWidth: 18, height: 18, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countText: { fontSize: 9, fontWeight: FONTS.bold, lineHeight: 13 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16, fontWeight: FONTS.bold, textAlign: 'center' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});

// ─── Main Trends Screen ───────────────────────────────────────────────────────
type TrendsTab = 'highlights' | 'news';

export default function TrendsScreen() {
  const { colors: C } = useTheme();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TrendsTab>('highlights');

  return (
    <SafeAreaView style={[ts.root, { backgroundColor: C.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[ts.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <View>
          <Text style={[ts.title, { color: C.textPrimary }]}>
            Trends <Text style={{ color: C.primary }}>🔥</Text>
          </Text>
          <Text style={[ts.subtitle, { color: C.textSecondary }]}>Highlights & breaking news</Text>
        </View>
      </View>

      {/* Segment control */}
      <View style={[ts.segmentWrap, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        {([
          { id: 'highlights' as TrendsTab, label: '🎬 Highlights' },
          { id: 'news' as TrendsTab,       label: '📰 News' },
        ]).map((tab) => {
          const isSel = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              style={[ts.segmentBtn, isSel ? [ts.segmentBtnActive, { borderBottomColor: C.primary }] : null]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={[ts.segmentLabel, { color: isSel ? C.primary : C.textMuted }, isSel ? { fontWeight: FONTS.bold } : null]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tab content */}
      <View style={{ flex: 1 }}>
        {activeTab === 'highlights' ? <HighlightsTab C={C} /> : <NewsTab C={C} />}
      </View>

    </SafeAreaView>
  );
}

const ts = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1 },
  title: { fontSize: 20, fontWeight: FONTS.extraBold, letterSpacing: -0.3 },
  subtitle: { fontSize: 11, marginTop: 1 },
  segmentWrap: { flexDirection: 'row', borderBottomWidth: 1 },
  segmentBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentBtnActive: {},
  segmentLabel: { fontSize: 14, fontWeight: FONTS.semiBold },
});
