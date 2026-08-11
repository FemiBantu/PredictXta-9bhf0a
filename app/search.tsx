import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import MatchCard from '@/components/feature/MatchCard';
import { Match } from '@/services/types';
import { COLORS, FONTS, RADIUS, SPACING, SPORT_ICONS } from '@/constants/theme';

// ─── Recent Searches ──────────────────────────────────────────────────────────
const RECENT_KEY = '@predictxta/recent_searches_v1';
const MAX_RECENT = 8;

async function loadRecent(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function persistRecent(list: string[]): Promise<void> {
  try { await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* silent */ }
}

function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => { loadRecent().then(setRecent); }, []);

  const addRecent = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setRecent((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, MAX_RECENT);
      persistRecent(next);
      return next;
    });
  }, []);

  const removeRecent = useCallback((query: string) => {
    setRecent((prev) => {
      const next = prev.filter((q) => q !== query);
      persistRecent(next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    persistRecent([]);
  }, []);

  return { recent, addRecent, removeRecent, clearRecent };
}

// ─── Filter types ─────────────────────────────────────────────────────────────
type SportFilter = 'All' | 'Football' | 'Basketball' | 'Tennis';
type StatusFilter = 'All' | 'live' | 'upcoming' | 'finished';

const SPORT_OPTIONS: SportFilter[] = ['All', 'Football', 'Basketball', 'Tennis'];
const STATUS_OPTIONS: { key: StatusFilter; label: string; emoji: string }[] = [
  { key: 'All',      label: 'All',      emoji: '🏆' },
  { key: 'live',     label: 'Live',     emoji: '🔴' },
  { key: 'upcoming', label: 'Upcoming', emoji: '📅' },
  { key: 'finished', label: 'Finished', emoji: '✅' },
];

// ─── DB row → Match ───────────────────────────────────────────────────────────
function rowToMatch(row: Record<string, unknown>): Match {
  return {
    id: row.id as string,
    sport: (row.sport as string) ?? 'football',
    homeTeam: row.home_team as string,
    awayTeam: row.away_team as string,
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: (row.status as Match['status']) ?? 'upcoming',
    matchTime: row.match_time as string,
    league: (row.league as string) ?? '',
    venue: row.venue as string | undefined,
    minute: Number(row.minute ?? 0),
    stats: row.stats as Match['stats'],
  };
}

// ─── ilike search against DB ──────────────────────────────────────────────────
// ─── ilike search against DB (real data only — no mock fallback) ─────────────
async function searchMatches(query: string): Promise<{ matches: Match[]; error: string | null }> {
  if (!query.trim()) return { matches: [], error: null };
  try {
    const supabase = getSupabaseClient();
    const q = `%${query.trim()}%`;
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .or(`home_team.ilike.${q},away_team.ilike.${q},league.ilike.${q}`)
      .order('match_time', { ascending: false })
      .limit(30);

    if (error) return { matches: [], error: 'Search unavailable. Please check your connection.' };
    return { matches: (data ?? []).map(rowToMatch), error: null };
  } catch {
    return { matches: [], error: 'Search unavailable. Please check your connection and try again.' };
  }
}

// ─── Extract unique leagues from match list ───────────────────────────────────
function extractLeagues(matches: Match[]): string[] {
  const set = new Set<string>();
  matches.forEach((m) => { if (m.league) set.add(m.league); });
  return ['All', ...Array.from(set).sort()];
}

// ─── Normalise sport name to capitalised ─────────────────────────────────────
function normaliseSport(sport: string): string {
  return sport.charAt(0).toUpperCase() + sport.slice(1).toLowerCase();
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, minute }: { status: string; minute?: number }) {
  if (status === 'live') {
    return (
      <View style={badge.live}>
        <View style={badge.liveDot} />
        <Text style={badge.liveText}>{minute ? `${minute}'` : 'LIVE'}</Text>
      </View>
    );
  }
  if (status === 'finished') {
    return (
      <View style={badge.ft}>
        <Text style={badge.ftText}>FT</Text>
      </View>
    );
  }
  return (
    <View style={badge.upcoming}>
      <Text style={badge.upcomingText}>UPCOMING</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  live: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,255,135,0.15)', borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(0,255,135,0.35)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accent },
  liveText: { fontSize: 11, color: COLORS.accent, fontWeight: FONTS.bold },
  ft: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: COLORS.border,
  },
  ftText: { fontSize: 11, color: COLORS.textMuted, fontWeight: FONTS.semiBold },
  upcoming: {
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  upcomingText: { fontSize: 10, color: COLORS.primary, fontWeight: FONTS.bold, letterSpacing: 0.4 },
});

// ─── Search Result Item ───────────────────────────────────────────────────────
function SearchResultItem({ match }: { match: Match }) {
  return (
    <View style={styles.resultWrap}>
      <View style={styles.resultMeta}>
        <Text style={styles.resultSportEmoji}>{SPORT_ICONS[normaliseSport(match.sport)] ?? '🏆'}</Text>
        <Text style={styles.resultLeague} numberOfLines={1}>{match.league}</Text>
        <StatusBadge status={match.status} minute={match.minute} />
      </View>
      <MatchCard match={match} />
    </View>
  );
}

// ─── Filter Chip ─────────────────────────────────────────────────────────────
function FilterChip({
  label, emoji, active, onPress, color,
}: {
  label: string; emoji?: string; active: boolean;
  onPress: () => void; color?: string;
}) {
  const activeColor = color ?? COLORS.primary;
  return (
    <Pressable
      style={({ pressed }) => [
        chipStyles.chip,
        active ? { backgroundColor: `${activeColor}18`, borderColor: activeColor } : null,
        pressed ? { opacity: 0.78 } : null,
      ]}
      onPress={onPress}
    >
      {emoji ? <Text style={chipStyles.emoji}>{emoji}</Text> : null}
      <Text style={[chipStyles.label, active ? { color: activeColor, fontWeight: FONTS.bold } : null]}>
        {label}
      </Text>
      {active ? (
        <View style={[chipStyles.activeDot, { backgroundColor: activeColor }]} />
      ) : null}
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.border,
  },
  emoji: { fontSize: 12 },
  label: { fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  activeDot: { width: 5, height: 5, borderRadius: 3 },
});

// ─── Filter Panel ────────────────────────────────────────────────────────────
function FilterPanel({
  sportFilter, statusFilter, leagueFilter,
  onSport, onStatus, onLeague,
  availableLeagues, activeCount,
  expanded, onToggle,
}: {
  sportFilter: SportFilter;
  statusFilter: StatusFilter;
  leagueFilter: string;
  onSport: (s: SportFilter) => void;
  onStatus: (s: StatusFilter) => void;
  onLeague: (l: string) => void;
  availableLeagues: string[];
  activeCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sportColors: Record<SportFilter, string> = {
    All: COLORS.primary,
    Football: COLORS.accent,
    Basketball: COLORS.accentBlue,
    Tennis: COLORS.accentRed,
  };
  const statusColors: Record<StatusFilter, string> = {
    All: COLORS.primary,
    live: COLORS.accent,
    upcoming: COLORS.primary,
    finished: COLORS.textMuted,
  };

  return (
    <View style={filterPanel.wrap}>
      {/* Toggle bar */}
      <Pressable
        style={({ pressed }) => [filterPanel.toggleRow, pressed ? { opacity: 0.8 } : null]}
        onPress={onToggle}
      >
        <View style={filterPanel.toggleLeft}>
          <Ionicons name="options-outline" size={15} color={activeCount > 0 ? COLORS.primary : COLORS.textMuted} />
          <Text style={[filterPanel.toggleLabel, activeCount > 0 ? { color: COLORS.primary } : null]}>
            Filters
          </Text>
          {activeCount > 0 ? (
            <View style={filterPanel.activeBadge}>
              <Text style={filterPanel.activeBadgeText}>{activeCount}</Text>
            </View>
          ) : null}
        </View>
        <MaterialIcons
          name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
          size={18}
          color={activeCount > 0 ? COLORS.primary : COLORS.textMuted}
        />
      </Pressable>

      {expanded ? (
        <View style={filterPanel.body}>
          {/* Sport */}
          <View style={filterPanel.section}>
            <Text style={filterPanel.sectionLabel}>SPORT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={filterPanel.row}>
              {SPORT_OPTIONS.map((s) => (
                <FilterChip
                  key={s}
                  label={s}
                  emoji={s === 'All' ? undefined : SPORT_ICONS[s]}
                  active={sportFilter === s}
                  onPress={() => onSport(s)}
                  color={sportColors[s]}
                />
              ))}
            </ScrollView>
          </View>

          {/* Status */}
          <View style={filterPanel.section}>
            <Text style={filterPanel.sectionLabel}>STATUS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={filterPanel.row}>
              {STATUS_OPTIONS.map((opt) => (
                <FilterChip
                  key={opt.key}
                  label={opt.label}
                  emoji={opt.emoji}
                  active={statusFilter === opt.key}
                  onPress={() => onStatus(opt.key)}
                  color={statusColors[opt.key]}
                />
              ))}
            </ScrollView>
          </View>

          {/* League */}
          {availableLeagues.length > 1 ? (
            <View style={filterPanel.section}>
              <Text style={filterPanel.sectionLabel}>LEAGUE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={filterPanel.row}>
                {availableLeagues.map((l) => (
                  <FilterChip
                    key={l}
                    label={l === 'All' ? 'All Leagues' : l}
                    active={leagueFilter === l}
                    onPress={() => onLeague(l)}
                    color={COLORS.accentBlue}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Reset */}
          {activeCount > 0 ? (
            <Pressable
              style={({ pressed }) => [filterPanel.resetBtn, pressed ? { opacity: 0.7 } : null]}
              onPress={() => { onSport('All'); onStatus('All'); onLeague('All'); }}
            >
              <Ionicons name="refresh-outline" size={13} color={COLORS.accentRed} />
              <Text style={filterPanel.resetText}>Reset all filters</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const filterPanel = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 10,
  },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  toggleLabel: { fontSize: 13, fontWeight: FONTS.semiBold, color: COLORS.textMuted },
  activeBadge: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingHorizontal: 7, paddingVertical: 1,
    minWidth: 18, alignItems: 'center',
  },
  activeBadgeText: { fontSize: 10, fontWeight: FONTS.extraBold, color: COLORS.textInverse },
  body: { paddingBottom: 12, gap: 10 },
  section: { gap: 6, paddingHorizontal: SPACING.md },
  sectionLabel: {
    fontSize: 10, fontWeight: FONTS.bold, color: COLORS.textMuted, letterSpacing: 0.8,
  },
  row: { gap: 7, flexDirection: 'row' },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginHorizontal: SPACING.md,
    backgroundColor: 'rgba(255,71,87,0.08)',
    borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,71,87,0.25)',
    alignSelf: 'flex-start',
  },
  resetText: { fontSize: 11, color: COLORS.accentRed, fontWeight: FONTS.semiBold },
});

// ─── Browse Pool — empty (show prompt, not mock data) ─────────────────────────
const BROWSE_POOL: Match[] = [];

// ─── Recent Searches Panel ────────────────────────────────────────────────────
function RecentSearchesPanel({
  recent, onSelect, onRemove, onClear,
}: {
  recent: string[];
  onSelect: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}) {
  if (recent.length === 0) return null;
  return (
    <View style={styles.recentWrap}>
      <View style={styles.recentHeader}>
        <View style={styles.recentHeaderLeft}>
          <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.recentTitle}>Recent Searches</Text>
        </View>
        <Pressable
          onPress={onClear}
          hitSlop={8}
          style={({ pressed }) => [styles.clearAllBtn, pressed ? { opacity: 0.7 } : null]}
        >
          <Ionicons name="trash-outline" size={12} color={COLORS.accentRed} />
          <Text style={styles.clearAllText}>Clear all</Text>
        </Pressable>
      </View>
      <View style={styles.recentChips}>
        {recent.map((q) => (
          <View key={q} style={styles.recentChipWrap}>
            <Pressable
              style={({ pressed }) => [styles.recentChip, pressed ? styles.recentChipPressed : null]}
              onPress={() => onSelect(q)}
            >
              <Ionicons name="search-outline" size={12} color={COLORS.textMuted} />
              <Text style={styles.recentChipText} numberOfLines={1}>{q}</Text>
            </Pressable>
            <Pressable
              onPress={() => onRemove(q)}
              hitSlop={6}
              style={({ pressed }) => [styles.recentDismiss, pressed ? { opacity: 0.6 } : null]}
            >
              <Ionicons name="close" size={12} color={COLORS.textMuted} />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Empty / Placeholder States ───────────────────────────────────────────────
function EmptyPrompt({ onSuggestion }: { onSuggestion: (q: string) => void }) {
  const suggestions = ['Premier League', 'Champions League', 'NBA', 'La Liga', 'ATP'];
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name="search-outline" size={36} color={COLORS.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>Search or Browse</Text>
      <Text style={styles.emptySubtitle}>
        Type a team name or league, or use filters to browse matches.
      </Text>
      <View style={styles.suggestions}>
        {suggestions.map((s) => (
          <Pressable
            key={s}
            style={({ pressed }) => [styles.suggestionChip, pressed ? { opacity: 0.75 } : null]}
            onPress={() => onSuggestion(s)}
          >
            <Text style={styles.suggestionText}>{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NoResults({ query, hasFilters }: { query: string; hasFilters: boolean }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name="sad-outline" size={36} color={COLORS.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>No matches found</Text>
      <Text style={styles.emptySubtitle}>
        {query
          ? `No results for "${query}"${hasFilters ? ' with the current filters' : ''}. Try a different search or adjust filters.`
          : 'No matches match the selected filters. Try relaxing your criteria.'}
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [rawResults, setRawResults] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { recent, addRecent, removeRecent, clearRecent } = useRecentSearches();

  // Session-persistent filters
  const [sportFilter, setSportFilter] = useState<SportFilter>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [leagueFilter, setLeagueFilter] = useState<string>('All');
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  // Active filter count (excludes 'All')
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (sportFilter !== 'All') n++;
    if (statusFilter !== 'All') n++;
    if (leagueFilter !== 'All') n++;
    return n;
  }, [sportFilter, statusFilter, leagueFilter]);

  // Pool to filter: search results when query exists, else full mock pool
  const basePool = useMemo<Match[]>(() => {
    if (query.trim()) return rawResults;
    return BROWSE_POOL;
  }, [query, rawResults]);

  // Client-side filter application
  const filteredResults = useMemo<Match[]>(() => {
    let pool = basePool;
    if (sportFilter !== 'All') {
      pool = pool.filter((m) => normaliseSport(m.sport) === sportFilter);
    }
    if (statusFilter !== 'All') {
      pool = pool.filter((m) => m.status === statusFilter);
    }
    if (leagueFilter !== 'All') {
      pool = pool.filter((m) => m.league === leagueFilter);
    }
    return pool;
  }, [basePool, sportFilter, statusFilter, leagueFilter]);

  // Leagues extracted from the current pool (before sport/status filters to keep league list broad)
  const availableLeagues = useMemo<string[]>(() => {
    let pool = basePool;
    if (sportFilter !== 'All') {
      pool = pool.filter((m) => normaliseSport(m.sport) === sportFilter);
    }
    return extractLeagues(pool);
  }, [basePool, sportFilter]);

  // Reset league filter if the league is no longer available
  useEffect(() => {
    if (leagueFilter !== 'All' && !availableLeagues.includes(leagueFilter)) {
      setLeagueFilter('All');
    }
  }, [availableLeagues, leagueFilter]);

  // Debounced DB search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setRawResults([]);
      setHasSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const { matches, error } = await searchMatches(query);
      setRawResults(matches);
      setSearchError(error);
      setHasSearched(true);
      setSearching(false);
      if (!error) {
        const trimmed = query.trim();
        if (trimmed && trimmed !== lastSavedRef.current) {
          lastSavedRef.current = trimmed;
          addRecent(trimmed);
        }
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Auto-focus on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setRawResults([]);
    setHasSearched(false);
    lastSavedRef.current = '';
    inputRef.current?.focus();
  }, []);

  const handleSuggestion = useCallback((s: string) => {
    setQuery(s);
  }, []);

  const handleRecentSelect = useCallback((q: string) => {
    setQuery(q);
  }, []);

  // Visibility logic
  const browseMode = !query.trim();
  const showRecent = browseMode && activeFilterCount === 0 && recent.length > 0;
  // When browsing without query and no filters, show prompt instead of raw full list
  const showPrompt = browseMode && activeFilterCount === 0;
  const showNoResults = filteredResults.length === 0 && !searching && !searchError && hasSearched;
  const showError = !!searchError && !searching;
  const showResults = filteredResults.length > 0;
  const totalShown = filteredResults.length;

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: COLORS.surface }}>
        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>
          <View style={styles.inputWrap}>
            <Ionicons name="search-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search team, league, or sport..."
              placeholderTextColor={COLORS.textMuted}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="never"
            />
            {query.length > 0 ? (
              <Pressable onPress={handleClear} hitSlop={8} style={styles.clearBtn}>
                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
              </Pressable>
            ) : null}
          </View>
          {searching ? (
            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginLeft: 4 }} />
          ) : null}
        </View>

        {/* Filter Panel */}
        <FilterPanel
          sportFilter={sportFilter}
          statusFilter={statusFilter}
          leagueFilter={leagueFilter}
          onSport={setSportFilter}
          onStatus={setStatusFilter}
          onLeague={setLeagueFilter}
          availableLeagues={availableLeagues}
          activeCount={activeFilterCount}
          expanded={filtersExpanded}
          onToggle={() => setFiltersExpanded((v) => !v)}
        />

        {/* Result count bar */}
        {(showResults || (browseMode && activeFilterCount > 0)) ? (
          <View style={styles.resultCountBar}>
            <Text style={styles.resultCountText}>
              {totalShown} {totalShown === 1 ? 'match' : 'matches'}
              {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active` : ''}
            </Text>
            {activeFilterCount > 0 ? (
              <Pressable
                onPress={() => { setSportFilter('All'); setStatusFilter('All'); setLeagueFilter('All'); }}
                hitSlop={8}
              >
                <Text style={styles.clearFiltersText}>Clear filters</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {showPrompt ? (
          <>
            {showRecent ? (
              <RecentSearchesPanel
                recent={recent}
                onSelect={handleRecentSelect}
                onRemove={removeRecent}
                onClear={clearRecent}
              />
            ) : null}
            <EmptyPrompt onSuggestion={handleSuggestion} />
          </>
        ) : showError ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="cloud-offline-outline" size={36} color="#EF4444" />
            </View>
            <Text style={[styles.emptyTitle, { color: '#EF4444' }]}>Search Unavailable</Text>
            <Text style={styles.emptySubtitle}>{searchError}</Text>
          </View>
        ) : showNoResults ? (
          <NoResults query={query} hasFilters={activeFilterCount > 0} />
        ) : (
          <FlatList
            data={filteredResults}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <SearchResultItem match={item} />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
            ListFooterComponent={<View style={{ height: 32 }} />}
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },

  // Search bar
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.card, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, height: 44,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: COLORS.textPrimary, height: '100%' },
  clearBtn: { marginLeft: 6 },

  // Result count bar
  resultCountBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  resultCountText: { fontSize: 12, color: COLORS.textMuted, fontWeight: FONTS.medium },
  clearFiltersText: { fontSize: 12, color: COLORS.accentRed, fontWeight: FONTS.semiBold },

  // List
  listContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },

  // Result item wrapper
  resultWrap: { marginBottom: 4 },
  resultMeta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 6,
  },
  resultSportEmoji: { fontSize: 16 },
  resultLeague: { flex: 1, fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium },

  // Recent searches
  recentWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  recentHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  recentHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recentTitle: {
    fontSize: 12, fontWeight: FONTS.bold, color: COLORS.textMuted, letterSpacing: 0.5,
  },
  clearAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,71,87,0.08)', borderRadius: RADIUS.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,71,87,0.2)',
  },
  clearAllText: { fontSize: 11, color: COLORS.accentRed, fontWeight: FONTS.semiBold },
  recentChips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingBottom: SPACING.sm,
  },
  recentChipWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.card, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
  },
  recentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: 10, paddingRight: 6, paddingVertical: 7,
  },
  recentChipPressed: { backgroundColor: COLORS.cardHighlight },
  recentChipText: {
    fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium, maxWidth: 140,
  },
  recentDismiss: {
    paddingHorizontal: 8, paddingVertical: 7,
    borderLeftWidth: 1, borderLeftColor: COLORS.border,
  },

  // Empty / no-results
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, gap: 12,
  },
  emptyIconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold, color: COLORS.textSecondary },
  emptySubtitle: {
    fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20,
  },

  // Quick suggestions
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
  suggestionChip: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.full,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: COLORS.border,
  },
  suggestionText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium },
});
