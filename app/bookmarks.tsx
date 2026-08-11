/**
 * Bookmarks — Saved Highlights & News Articles
 * Reads from video_bookmarks and news_bookmarks tables.
 * Swipe-to-remove gesture via react-native-gesture-handler.
 * Sport filter chips + lazy-loaded FlatList.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator,
  Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth, getSupabaseClient } from '@/template';
import { FONTS, RADIUS, SPACING, SPORT_ICONS } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface BookmarkedHighlight {
  id: string;
  bookmarkId: string;
  title: string;
  sport: string;
  thumbnailUrl: string | null;
  embedUrl: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  league: string | null;
  eventDate: string | null;
  createdAt: string;
}

interface BookmarkedArticle {
  id: string;
  bookmarkId: string;
  title: string;
  sport: string;
  summary: string | null;
  imageUrl: string | null;
  url: string | null;
  league: string | null;
  publishedAt: string;
  category: string;
}

type Tab = 'highlights' | 'news';

const SPORT_FILTER_LIST = ['All', 'Football', 'Basketball', 'Tennis', 'Cricket', 'MMA', 'Hockey'];

// ─── Sport filter chip ────────────────────────────────────────────────────────
function SportChip({ label, selected, onPress, C }: {
  label: string; selected: boolean; onPress: () => void; C: AppColors;
}) {
  const emoji = SPORT_ICONS[label] ?? '🏆';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        chip.wrap,
        selected ? { backgroundColor: C.primaryGlow, borderColor: C.primary } : { backgroundColor: C.card, borderColor: C.border },
        pressed ? { opacity: 0.75 } : null,
      ]}
    >
      {label !== 'All' ? <Text style={chip.emoji}>{emoji}</Text> : null}
      <Text style={[chip.label, { color: selected ? C.primary : C.textSecondary }, selected ? chip.labelActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}
const chip = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  emoji: { fontSize: 13 },
  label: { fontSize: 12, fontWeight: FONTS.medium },
  labelActive: { fontWeight: FONTS.bold },
});

// ─── Highlight card ───────────────────────────────────────────────────────────
function HighlightCard({ item, onRemove, C }: {
  item: BookmarkedHighlight; onRemove: (bookmarkId: string) => void; C: AppColors;
}) {
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = useCallback(() => (
    <Pressable
      style={[hc.deleteAction, { backgroundColor: '#EF4444' }]}
      onPress={() => { swipeRef.current?.close(); onRemove(item.bookmarkId); }}
    >
      <Ionicons name="trash-outline" size={22} color="#fff" />
      <Text style={hc.deleteText}>Remove</Text>
    </Pressable>
  ), [item.bookmarkId, onRemove]);

  return (
    <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false}>
      <View style={[hc.card, { backgroundColor: C.card, borderColor: C.border }]}>
        {item.thumbnailUrl ? (
          <Image source={{ uri: item.thumbnailUrl }} style={hc.thumb} contentFit="cover" />
        ) : (
          <View style={[hc.thumbPlaceholder, { backgroundColor: C.surface }]}>
            <Text style={{ fontSize: 28 }}>{SPORT_ICONS[item.sport] ?? '🎬'}</Text>
          </View>
        )}
        <View style={hc.info}>
          <Text style={[hc.title, { color: C.textPrimary }]} numberOfLines={2}>{item.title}</Text>
          {item.league ? <Text style={[hc.sub, { color: C.textMuted }]} numberOfLines={1}>{item.league}</Text> : null}
          {item.eventDate ? (
            <Text style={[hc.date, { color: C.textMuted }]}>
              {new Date(item.eventDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          ) : null}
        </View>
        {item.embedUrl ? (
          <View style={[hc.playBtn, { backgroundColor: `${C.primary}22`, borderColor: `${C.primary}44` }]}>
            <Ionicons name="play" size={16} color={C.primary} />
          </View>
        ) : null}
      </View>
    </Swipeable>
  );
}
const hc = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, padding: 10, marginBottom: 8, overflow: 'hidden' },
  thumb: { width: 72, height: 56, borderRadius: RADIUS.md, flexShrink: 0 },
  thumbPlaceholder: { width: 72, height: 56, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  info: { flex: 1 },
  title: { fontSize: 13, fontWeight: FONTS.semiBold, lineHeight: 18 },
  sub: { fontSize: 11, marginTop: 2 },
  date: { fontSize: 10, marginTop: 2 },
  playBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  deleteAction: { width: 80, borderRadius: RADIUS.lg, marginBottom: 8, alignItems: 'center', justifyContent: 'center', gap: 4 },
  deleteText: { color: '#fff', fontSize: 11, fontWeight: FONTS.semiBold },
});

// ─── Article card ─────────────────────────────────────────────────────────────
function ArticleCard({ item, onRemove, C }: {
  item: BookmarkedArticle; onRemove: (bookmarkId: string) => void; C: AppColors;
}) {
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = useCallback(() => (
    <Pressable
      style={[hc.deleteAction, { backgroundColor: '#EF4444' }]}
      onPress={() => { swipeRef.current?.close(); onRemove(item.bookmarkId); }}
    >
      <Ionicons name="trash-outline" size={22} color="#fff" />
      <Text style={hc.deleteText}>Remove</Text>
    </Pressable>
  ), [item.bookmarkId, onRemove]);

  const categoryColor = item.category === 'result' ? '#22C55E' : item.category === 'preview' ? C.primary : C.accentBlue;

  return (
    <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false}>
      <View style={[ac.card, { backgroundColor: C.card, borderColor: C.border }]}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={ac.thumb} contentFit="cover" />
        ) : (
          <View style={[ac.thumbPlaceholder, { backgroundColor: C.surface }]}>
            <Ionicons name="newspaper-outline" size={24} color={C.textMuted} />
          </View>
        )}
        <View style={ac.info}>
          <View style={ac.topRow}>
            <View style={[ac.catPill, { backgroundColor: `${categoryColor}18`, borderColor: `${categoryColor}44` }]}>
              <Text style={[ac.catText, { color: categoryColor }]}>{item.category.toUpperCase()}</Text>
            </View>
            {item.league ? <Text style={[ac.league, { color: C.textMuted }]} numberOfLines={1}>{item.league}</Text> : null}
          </View>
          <Text style={[ac.title, { color: C.textPrimary }]} numberOfLines={2}>{item.title}</Text>
          {item.summary ? <Text style={[ac.summary, { color: C.textMuted }]} numberOfLines={2}>{item.summary}</Text> : null}
          <Text style={[ac.date, { color: C.textMuted }]}>
            {new Date(item.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      </View>
    </Swipeable>
  );
}
const ac = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderRadius: RADIUS.lg, borderWidth: 1, padding: 10, marginBottom: 8, overflow: 'hidden' },
  thumb: { width: 72, height: 72, borderRadius: RADIUS.md, flexShrink: 0 },
  thumbPlaceholder: { width: 72, height: 72, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  info: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  catPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  catText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  league: { flex: 1, fontSize: 10 },
  title: { fontSize: 13, fontWeight: FONTS.semiBold, lineHeight: 18 },
  summary: { fontSize: 11, lineHeight: 16 },
  date: { fontSize: 10, marginTop: 2 },
});

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyBookmarks({ tab, C }: { tab: Tab; C: AppColors }) {
  return (
    <View style={eb.wrap}>
      <View style={[eb.iconWrap, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}22` }]}>
        <Text style={{ fontSize: 40 }}>{tab === 'highlights' ? '🎬' : '📰'}</Text>
      </View>
      <Text style={[eb.title, { color: C.textPrimary }]}>
        No bookmarked {tab === 'highlights' ? 'highlights' : 'articles'}
      </Text>
      <Text style={[eb.body, { color: C.textMuted }]}>
        {tab === 'highlights'
          ? 'Save match highlights from the Highlights tab to view them here.'
          : 'Bookmark news articles from the News tab to find them here.'}
      </Text>
    </View>
  );
}
const eb = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' },
  body: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function BookmarksScreen() {
  const { colors: C } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('highlights');
  const [sportFilter, setSportFilter] = useState('All');
  const [highlights, setHighlights] = useState<BookmarkedHighlight[]>([]);
  const [articles, setArticles] = useState<BookmarkedArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 15;

  const fetchHighlights = useCallback(async (reset = false) => {
    if (!user?.id) return;
    const currentPage = reset ? 0 : page;
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('video_bookmarks')
        .select(`
          id,
          created_at,
          highlights ( id, title, sport, embed_url, thumbnail, home_team, away_team, league, event_date )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      const mapped: BookmarkedHighlight[] = (data ?? [])
        .filter((r: any) => r.highlights)
        .map((r: any) => ({
          bookmarkId: r.id,
          id: r.highlights.id,
          title: r.highlights.title ?? '',
          sport: r.highlights.sport ?? 'football',
          thumbnailUrl: r.highlights.thumbnail ?? null,
          embedUrl: r.highlights.embed_url ?? null,
          homeTeam: r.highlights.home_team ?? null,
          awayTeam: r.highlights.away_team ?? null,
          league: r.highlights.league ?? null,
          eventDate: r.highlights.event_date ?? null,
          createdAt: r.created_at,
        }));
      setHighlights(reset ? mapped : (prev) => [...prev, ...mapped]);
      setHasMore(mapped.length === PAGE_SIZE);
      if (!reset) setPage(currentPage + 1);
    } catch { /* ignore */ }
  }, [user?.id, page]);

  const fetchArticles = useCallback(async (reset = false) => {
    if (!user?.id) return;
    const currentPage = reset ? 0 : page;
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('news_bookmarks')
        .select(`
          id,
          created_at,
          news_articles ( id, title, sport, summary, image_url, url, league, published_at, category )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      const mapped: BookmarkedArticle[] = (data ?? [])
        .filter((r: any) => r.news_articles)
        .map((r: any) => ({
          bookmarkId: r.id,
          id: r.news_articles.id,
          title: r.news_articles.title ?? '',
          sport: r.news_articles.sport ?? 'football',
          summary: r.news_articles.summary ?? null,
          imageUrl: r.news_articles.image_url ?? null,
          url: r.news_articles.url ?? null,
          league: r.news_articles.league ?? null,
          publishedAt: r.news_articles.published_at ?? r.created_at,
          category: r.news_articles.category ?? 'news',
        }));
      setArticles(reset ? mapped : (prev) => [...prev, ...mapped]);
      setHasMore(mapped.length === PAGE_SIZE);
      if (!reset) setPage(currentPage + 1);
    } catch { /* ignore */ }
  }, [user?.id, page]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    const load = activeTab === 'highlights' ? fetchHighlights(true) : fetchArticles(true);
    load.finally(() => setLoading(false));
  }, [activeTab]);

  // Switch tab resets pagination
  const handleTabSwitch = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setSportFilter('All');
    setPage(0);
    setHasMore(true);
  }, []);

  const removeHighlight = useCallback(async (bookmarkId: string) => {
    if (!user?.id) return;
    setHighlights((prev) => prev.filter((h) => h.bookmarkId !== bookmarkId));
    try {
      await getSupabaseClient().from('video_bookmarks').delete().eq('id', bookmarkId).eq('user_id', user.id);
    } catch { /* re-add if failed */
      fetchHighlights(true);
    }
  }, [user?.id, fetchHighlights]);

  const removeArticle = useCallback(async (bookmarkId: string) => {
    if (!user?.id) return;
    setArticles((prev) => prev.filter((a) => a.bookmarkId !== bookmarkId));
    try {
      await getSupabaseClient().from('news_bookmarks').delete().eq('id', bookmarkId).eq('user_id', user.id);
    } catch {
      fetchArticles(true);
    }
  }, [user?.id, fetchArticles]);

  const filteredHighlights = useMemo(() =>
    sportFilter === 'All'
      ? highlights
      : highlights.filter((h) => h.sport.toLowerCase() === sportFilter.toLowerCase()),
    [highlights, sportFilter]
  );

  const filteredArticles = useMemo(() =>
    sportFilter === 'All'
      ? articles
      : articles.filter((a) => a.sport.toLowerCase() === sportFilter.toLowerCase()),
    [articles, sportFilter]
  );

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    if (activeTab === 'highlights') fetchHighlights();
    else fetchArticles();
  }, [hasMore, activeTab, fetchHighlights, fetchArticles]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[s.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
          {/* Header */}
          <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
              <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
            </Pressable>
            <Text style={[s.headerTitle, { color: C.textPrimary }]}>Bookmarks</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Tabs */}
          <View style={[s.tabs, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
            {(['highlights', 'news'] as Tab[]).map((tab) => (
              <Pressable
                key={tab}
                onPress={() => handleTabSwitch(tab)}
                style={[s.tab, activeTab === tab ? { borderBottomColor: C.primary } : { borderBottomColor: 'transparent' }]}
              >
                <Ionicons
                  name={tab === 'highlights' ? 'videocam-outline' : 'newspaper-outline'}
                  size={16}
                  color={activeTab === tab ? C.primary : C.textMuted}
                />
                <Text style={[s.tabLabel, { color: activeTab === tab ? C.primary : C.textMuted }, activeTab === tab ? s.tabLabelActive : null]}>
                  {tab === 'highlights' ? 'Highlights' : 'News'}
                </Text>
                {activeTab === tab ? (
                  <View style={[s.tabBadge, { backgroundColor: C.primaryGlow }]}>
                    <Text style={[s.tabBadgeText, { color: C.primary }]}>
                      {tab === 'highlights' ? filteredHighlights.length : filteredArticles.length}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        </SafeAreaView>

        {/* Sport filter */}
        <View style={[s.filterWrap, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <FlatList
            horizontal
            data={SPORT_FILTER_LIST}
            keyExtractor={(x) => x}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.filterScroll}
            renderItem={({ item }) => (
              <SportChip
                label={item}
                selected={sportFilter === item}
                onPress={() => setSportFilter(item)}
                C={C}
              />
            )}
          />
        </View>

        {/* Content */}
        {loading ? (
          <View style={s.loaderWrap}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : activeTab === 'highlights' ? (
          <FlatList
            data={filteredHighlights}
            keyExtractor={(item) => item.bookmarkId}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={<EmptyBookmarks tab="highlights" C={C} />}
            renderItem={({ item }) => <HighlightCard item={item} onRemove={removeHighlight} C={C} />}
            ListFooterComponent={
              hasMore && filteredHighlights.length > 0
                ? <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />
                : <View style={{ height: 60 }} />
            }
          />
        ) : (
          <FlatList
            data={filteredArticles}
            keyExtractor={(item) => item.bookmarkId}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={<EmptyBookmarks tab="news" C={C} />}
            renderItem={({ item }) => <ArticleCard item={item} onRemove={removeArticle} C={C} />}
            ListFooterComponent={
              hasMore && filteredArticles.length > 0
                ? <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />
                : <View style={{ height: 60 }} />
            }
          />
        )}
      </View>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2 },
  tabLabel: { fontSize: 13, fontWeight: FONTS.semiBold },
  tabLabelActive: { fontWeight: FONTS.bold },
  tabBadge: { borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2 },
  tabBadgeText: { fontSize: 10, fontWeight: FONTS.bold },
  filterWrap: { borderBottomWidth: 1 },
  filterScroll: { paddingHorizontal: SPACING.md, paddingVertical: 8, gap: 8 },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: SPACING.md, paddingTop: 12, flexGrow: 1 },
});
