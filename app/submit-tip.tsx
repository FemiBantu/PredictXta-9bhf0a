/**
 * app/submit-tip.tsx
 *
 * Expert Tip Submission — available only to users with
 * admin_roles.permissions.manage_tips === true.
 *
 * Flow:
 *  1. Choose sport
 *  2. Search & select a match → match_label auto-filled from picker
 *     (or toggle to manual entry)
 *  3. Choose tip_type from sport-aware dropdown
 *  4. Enter tip_value (outcome), odds (decimal), confidence slider (0–100)
 *  5. Write analysis text
 *  6. Submit → inserts into expert_tips table
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, KeyboardAvoidingView,
  Platform, Animated, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { useAuth, getSupabaseClient } from '@/template';
import { useAdminRole } from '@/hooks/useAdminRole';

// ─── Sport config ─────────────────────────────────────────────────────────────

const SPORT_OPTIONS = [
  { id: 'football',          label: 'Football',          emoji: '⚽' },
  { id: 'basketball',        label: 'Basketball',        emoji: '🏀' },
  { id: 'tennis',            label: 'Tennis',            emoji: '🎾' },
  { id: 'cricket',           label: 'Cricket',           emoji: '🏏' },
  { id: 'mma',               label: 'MMA',               emoji: '🥊' },
  { id: 'baseball',          label: 'Baseball',          emoji: '⚾' },
  { id: 'hockey',            label: 'Hockey',            emoji: '🏒' },
  { id: 'rugby',             label: 'Rugby',             emoji: '🏉' },
  { id: 'volleyball',        label: 'Volleyball',        emoji: '🏐' },
  { id: 'handball',          label: 'Handball',          emoji: '🤾' },
  { id: 'afl',               label: 'AFL',               emoji: '🏉' },
  { id: 'american-football', label: 'American Football', emoji: '🏈' },
  { id: 'formula1',         label: 'Formula 1',         emoji: '🏎️' },
];

// tip_type options per sport family
type TipTypeDef = { value: string; label: string; emoji: string; valuePlaceholder: string };

const SPORT_TIP_TYPES: Record<string, TipTypeDef[]> = {
  football: [
    { value: '1x2',          label: 'Match Result (1X2)',   emoji: '⚽', valuePlaceholder: 'Home Win / Draw / Away Win' },
    { value: 'over_under',   label: 'Over / Under Goals',  emoji: '⬆️', valuePlaceholder: 'e.g. Over 2.5' },
    { value: 'btts',         label: 'Both Teams to Score', emoji: '🎯', valuePlaceholder: 'Yes / No' },
    { value: 'asian_handicap', label: 'Asian Handicap',    emoji: '🎱', valuePlaceholder: 'e.g. Home -1.5' },
    { value: 'correct_score', label: 'Correct Score',      emoji: '🔢', valuePlaceholder: 'e.g. 2-1' },
    { value: 'ht_result',    label: 'Half Time Result',    emoji: '⏱️', valuePlaceholder: 'Home / Draw / Away' },
    { value: 'double_chance', label: 'Double Chance',      emoji: '🛡️', valuePlaceholder: 'e.g. Home or Draw' },
    { value: 'clean_sheet',  label: 'Clean Sheet',         emoji: '🧤', valuePlaceholder: 'Home Yes / Away Yes' },
    { value: 'first_goal',   label: 'First Goal Team',     emoji: '🥇', valuePlaceholder: 'Home / Away' },
    { value: 'corners',      label: 'Total Corners O/U',   emoji: '🚩', valuePlaceholder: 'e.g. Over 9.5' },
    { value: 'cards',        label: 'Total Cards O/U',     emoji: '🟨', valuePlaceholder: 'e.g. Over 3.5' },
  ],
  basketball: [
    { value: '1x2',           label: 'Game Winner',         emoji: '🏀', valuePlaceholder: 'Home / Away' },
    { value: 'over_under',    label: 'Total Points O/U',    emoji: '⬆️', valuePlaceholder: 'e.g. Over 215.5' },
    { value: 'spread',        label: 'Point Spread',        emoji: '🎯', valuePlaceholder: 'e.g. Home -4.5' },
    { value: 'team_total',    label: 'Team Total',          emoji: '📈', valuePlaceholder: 'e.g. Lakers Over 110' },
    { value: 'ht_result',     label: '1st Half Winner',     emoji: '⏱️', valuePlaceholder: 'Home / Away' },
    { value: 'quarter_winner', label: 'Quarter Winner',     emoji: '🕐', valuePlaceholder: 'e.g. Q1: Home' },
  ],
  tennis: [
    { value: '1x2',           label: 'Match Winner',        emoji: '🎾', valuePlaceholder: 'Player A / Player B' },
    { value: 'over_under',    label: 'Total Sets O/U',      emoji: '⬆️', valuePlaceholder: 'e.g. Over 2.5' },
    { value: 'correct_score', label: 'Correct Set Score',   emoji: '🔢', valuePlaceholder: 'e.g. 2-0 / 2-1' },
    { value: 'first_set',     label: 'First Set Winner',    emoji: '🥇', valuePlaceholder: 'Player A / Player B' },
    { value: 'straight_sets', label: 'Straight Sets Win',   emoji: '🏆', valuePlaceholder: 'Player A / Player B' },
    { value: 'total_games',   label: 'Total Games O/U',     emoji: '📊', valuePlaceholder: 'e.g. Over 22.5' },
  ],
  cricket: [
    { value: '1x2',          label: 'Match Winner',         emoji: '🏏', valuePlaceholder: 'Team A / Draw / Team B' },
    { value: 'over_under',   label: 'Total Runs O/U',       emoji: '⬆️', valuePlaceholder: 'e.g. Over 280.5' },
    { value: 'wickets',      label: 'Total Wickets O/U',    emoji: '🎯', valuePlaceholder: 'e.g. Over 12.5' },
    { value: 'top_batter',   label: 'Top Batter',           emoji: '🏅', valuePlaceholder: 'Player name' },
    { value: 'powerplay',    label: 'Powerplay Runs O/U',   emoji: '⚡', valuePlaceholder: 'e.g. Over 52.5' },
  ],
  mma: [
    { value: '1x2',          label: 'Fight Winner',         emoji: '🥊', valuePlaceholder: 'Fighter A / Fighter B' },
    { value: 'over_under',   label: 'Total Rounds O/U',     emoji: '⬆️', valuePlaceholder: 'e.g. Over 1.5' },
    { value: 'method_of_victory', label: 'Method of Victory', emoji: '⚡', valuePlaceholder: 'KO/TKO / Sub / Decision' },
    { value: 'ko_tko',       label: 'KO / TKO',             emoji: '💥', valuePlaceholder: 'Yes / No' },
    { value: 'submission',   label: 'Submission Win',       emoji: '🤼', valuePlaceholder: 'Yes / No' },
    { value: 'decision',     label: 'Goes to Decision',     emoji: '⚖️', valuePlaceholder: 'Yes / No' },
  ],
  boxing: SPORT_TIP_TYPES['mma'], // boxing uses MMA tip types
  afl: [
    { value: '1x2',        label: 'Match Winner',        emoji: '🏉', valuePlaceholder: 'Home / Away' },
    { value: 'over_under', label: 'Total Points O/U',    emoji: '⬆️', valuePlaceholder: 'e.g. Over 124.5' },
    { value: 'spread',     label: 'Points Spread',       emoji: '🎯', valuePlaceholder: 'e.g. Home -12.5' },
    { value: 'margin',     label: 'Winning Margin',      emoji: '📏', valuePlaceholder: 'e.g. Home 1-24 pts' },
  ],
  'american-football': [
    { value: '1x2',          label: 'Moneyline Winner',   emoji: '🏈', valuePlaceholder: 'Home / Away' },
    { value: 'over_under',   label: 'Total Points O/U',   emoji: '⬆️', valuePlaceholder: 'e.g. Over 47.5' },
    { value: 'spread',       label: 'Point Spread',       emoji: '🎯', valuePlaceholder: 'e.g. Home -3.5' },
    { value: 'ht_result',    label: '1st Half Winner',    emoji: '⏱️', valuePlaceholder: 'Home / Away' },
  ],
  formula1: [
    { value: '1x2',          label: 'Race Winner',        emoji: '🏎️', valuePlaceholder: 'Driver name' },
    { value: 'top3',         label: 'Podium Finish',      emoji: '🏆', valuePlaceholder: 'Driver makes top 3' },
    { value: 'fastest_lap',  label: 'Fastest Lap',        emoji: '⚡', valuePlaceholder: 'Driver name' },
    { value: 'pole',         label: 'Pole Position',      emoji: '🏁', valuePlaceholder: 'Driver name' },
  ],
  baseball: [
    { value: '1x2',          label: 'Moneyline Winner',     emoji: '⚾', valuePlaceholder: 'Home / Away' },
    { value: 'over_under',   label: 'Total Runs O/U',       emoji: '⬆️', valuePlaceholder: 'e.g. Over 8.5' },
    { value: 'run_line',     label: 'Run Line',             emoji: '🎯', valuePlaceholder: 'e.g. Home -1.5' },
    { value: 'first_5',      label: 'First 5 Innings',      emoji: '⚾', valuePlaceholder: 'Home / Away / Draw' },
  ],
  hockey: [
    { value: '1x2',          label: 'Game Winner',          emoji: '🏒', valuePlaceholder: 'Home / Draw / Away' },
    { value: 'over_under',   label: 'Total Goals O/U',      emoji: '⬆️', valuePlaceholder: 'e.g. Over 5.5' },
    { value: 'puck_line',    label: 'Puck Line',            emoji: '🎯', valuePlaceholder: 'e.g. Home -1.5' },
    { value: 'period_winner', label: 'Period Winner',       emoji: '⏱️', valuePlaceholder: 'e.g. P1: Home' },
  ],
  rugby: [
    { value: '1x2',          label: 'Match Result',         emoji: '🏉', valuePlaceholder: 'Home / Draw / Away' },
    { value: 'over_under',   label: 'Total Points O/U',     emoji: '⬆️', valuePlaceholder: 'e.g. Over 42.5' },
    { value: 'asian_handicap', label: 'Handicap',           emoji: '🎱', valuePlaceholder: 'e.g. Home -7.5' },
    { value: 'tries_ou',     label: 'Total Tries O/U',      emoji: '🎯', valuePlaceholder: 'e.g. Over 7.5' },
    { value: 'margin',       label: 'Winning Margin',       emoji: '📏', valuePlaceholder: 'e.g. Home 1-12 pts' },
  ],
  volleyball: [
    { value: '1x2',          label: 'Match Winner',         emoji: '🏐', valuePlaceholder: 'Home / Away' },
    { value: 'over_under',   label: 'Total Sets O/U',       emoji: '⬆️', valuePlaceholder: 'e.g. Over 3.5' },
    { value: 'set_handicap', label: 'Set Handicap',         emoji: '🎯', valuePlaceholder: 'e.g. Home -1.5' },
    { value: 'correct_score', label: 'Correct Set Score',   emoji: '🔢', valuePlaceholder: 'e.g. 3-1' },
  ],
  handball: [
    { value: '1x2',          label: 'Match Result',         emoji: '🤾', valuePlaceholder: 'Home / Draw / Away' },
    { value: 'over_under',   label: 'Total Goals O/U',      emoji: '⬆️', valuePlaceholder: 'e.g. Over 52.5' },
    { value: 'asian_handicap', label: 'Handicap',           emoji: '🎱', valuePlaceholder: 'e.g. Home -3.5' },
    { value: 'btts_20',      label: 'Both Teams Score 20+', emoji: '🎯', valuePlaceholder: 'Yes / No' },
  ],
  esports: SPORT_TIP_TYPES['football'], // fallback (esports removed from supported sports)
};

function getTipTypes(sport: string): TipTypeDef[] {
  return SPORT_TIP_TYPES[sport] ?? SPORT_TIP_TYPES['football'];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMatchTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) +
      ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function confLabel(v: number) {
  if (v >= 85) return { label: 'Elite', color: '#22C55E' };
  if (v >= 70) return { label: 'High', color: '#3B82F6' };
  if (v >= 55) return { label: 'Good', color: '#F59E0B' };
  if (v >= 40) return { label: 'Moderate', color: '#F97316' };
  return { label: 'Speculative', color: '#EF4444' };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MatchOption {
  id: string;
  label: string;
  league: string;
  matchTime: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, icon, children, C }: { title: string; icon?: string; children: React.ReactNode; C: AppColors }) {
  return (
    <View style={[card.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 }}>
        {icon ? <Ionicons name={icon as any} size={14} color={C.primary} /> : null}
        <Text style={[card.title, { color: C.textMuted }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}
const card = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16 },
  title: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.9, flex: 1 },
});

// Confidence slider (uses a segmented row — no native slider needed)
function ConfSlider({ value, onChange, C }: { value: number; onChange: (n: number) => void; C: AppColors }) {
  const steps = [30, 40, 50, 60, 70, 80, 90, 95];
  const { label, color } = confLabel(value);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: FONTS.semiBold, color: C.textSecondary }}>Confidence Level</Text>
        <View style={[{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 }, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
          <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color }}>{value}% — {label}</Text>
        </View>
      </View>
      {/* Step buttons */}
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {steps.map((s) => {
          const active = value === s;
          const sColor = confLabel(s).color;
          return (
            <Pressable
              key={s}
              onPress={() => onChange(s)}
              style={({ pressed }) => [
                { flex: 1, alignItems: 'center', borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 8 },
                active
                  ? { backgroundColor: `${sColor}22`, borderColor: `${sColor}66` }
                  : { backgroundColor: C.surface, borderColor: C.border },
                pressed ? { opacity: 0.75 } : null,
              ]}
            >
              <Text style={{ fontSize: 10, fontWeight: active ? FONTS.extraBold : FONTS.regular, color: active ? sColor : C.textMuted }}>
                {s}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Progress bar */}
      <View style={{ height: 5, borderRadius: 3, backgroundColor: C.surface, overflow: 'hidden' }}>
        <View style={{ width: `${value}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

// Tip type dropdown modal
function TipTypeDropdown({
  tipTypes, selected, onSelect, C,
}: {
  tipTypes: TipTypeDef[];
  selected: TipTypeDef | null;
  onSelect: (t: TipTypeDef) => void;
  C: AppColors;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            flexDirection: 'row', alignItems: 'center', gap: 10,
            borderRadius: RADIUS.lg, borderWidth: 1,
            paddingHorizontal: 14, paddingVertical: 13,
            backgroundColor: C.surface,
            borderColor: selected ? `${C.primary}55` : C.border,
          },
          pressed ? { opacity: 0.8 } : null,
        ]}
      >
        {selected ? (
          <>
            <Text style={{ fontSize: 18 }}>{selected.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: FONTS.semiBold, color: C.textPrimary }}>{selected.label}</Text>
            </View>
          </>
        ) : (
          <Text style={{ flex: 1, fontSize: 14, color: C.textMuted }}>Select tip type...</Text>
        )}
        <Ionicons name="chevron-down" size={16} color={C.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: C.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderWidth: 1, borderColor: C.border, maxHeight: '70%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }}>
            <Text style={{ flex: 1, fontSize: 16, fontWeight: FONTS.bold, color: C.textPrimary }}>Select Tip Type</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}>
              <Ionicons name="close" size={22} color={C.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
            {tipTypes.map((t, idx) => {
              const isSelected = selected?.value === t.value;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => { onSelect(t); setOpen(false); }}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingHorizontal: 16, paddingVertical: 14,
                      borderBottomWidth: idx < tipTypes.length - 1 ? StyleSheet.hairlineWidth : 0,
                      borderBottomColor: C.border,
                    },
                    isSelected ? { backgroundColor: `${C.primary}14` } : pressed ? { backgroundColor: C.surface } : null,
                  ]}
                >
                  <Text style={{ fontSize: 22 }}>{t.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: isSelected ? FONTS.bold : FONTS.medium, color: isSelected ? C.primary : C.textPrimary }}>
                      {t.label}
                    </Text>
                    <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>e.g. {t.valuePlaceholder}</Text>
                  </View>
                  {isSelected ? <Ionicons name="checkmark-circle" size={20} color={C.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

// Match search picker
function MatchPicker({
  sport, selected, onSelect, C,
}: {
  sport: string;
  selected: MatchOption | null;
  onSelect: (m: MatchOption | null) => void;
  C: AppColors;
}) {
  const [query, setQuery] = useState(selected ? selected.label : '');
  const [options, setOptions] = useState<MatchOption[]>([]);
  const [searching, setSearching] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (selected) setQuery(selected.label);
  }, [selected?.id]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!query.trim() || query.length < 2) { setOptions([]); return; }
    // Don't re-search if query matches already selected label
    if (selected && query === selected.label) { setOptions([]); return; }

    setSearching(true);
    timeoutRef.current = setTimeout(async () => {
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase
          .from('matches')
          .select('id, home_team, away_team, league, match_time, sport')
          .or(`home_team.ilike.%${query}%,away_team.ilike.%${query}%,league.ilike.%${query}%`)
          .eq('sport', sport)
          .in('status', ['upcoming', 'live'])
          .order('match_time', { ascending: true })
          .limit(8);
        setOptions(
          (data ?? []).map((r: any) => ({
            id: r.id,
            label: `${r.home_team} vs ${r.away_team}`,
            league: r.league ?? '',
            matchTime: r.match_time,
            sport: r.sport ?? sport,
            homeTeam: r.home_team,
            awayTeam: r.away_team,
          }))
        );
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 350);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [query, sport]);

  const clear = () => { onSelect(null); setQuery(''); setOptions([]); };

  return (
    <View style={{ gap: 10 }}>
      {/* Search input */}
      <View style={[
        inp.row,
        { backgroundColor: C.surface, borderColor: selected ? `${C.primary}55` : C.border },
      ]}>
        <Ionicons name="search-outline" size={16} color={C.textMuted} />
        <TextInput
          ref={inputRef}
          style={[inp.field, { color: C.textPrimary }]}
          value={query}
          onChangeText={(t) => { setQuery(t); if (selected) onSelect(null); }}
          placeholder="Search team or league..."
          placeholderTextColor={C.textMuted}
          returnKeyType="search"
        />
        {searching ? (
          <ActivityIndicator size="small" color={C.primary} />
        ) : query.length > 0 ? (
          <Pressable onPress={clear} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Results dropdown */}
      {options.length > 0 ? (
        <View style={[{ borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' }, { borderColor: C.border }]}>
          {options.map((m, idx) => (
            <Pressable
              key={m.id}
              onPress={() => { onSelect(m); setQuery(m.label); setOptions([]); }}
              style={({ pressed }) => [
                {
                  paddingHorizontal: 14, paddingVertical: 12,
                  borderBottomWidth: idx < options.length - 1 ? StyleSheet.hairlineWidth : 0,
                  borderBottomColor: C.border,
                },
                pressed ? { backgroundColor: C.primaryGlow } : { backgroundColor: C.surface },
              ]}
            >
              <Text style={{ fontSize: 13, fontWeight: FONTS.semiBold, color: C.textPrimary }} numberOfLines={1}>
                {m.label}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <View style={{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }}>
                  <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.primary }}>
                    {m.sport.toUpperCase()}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: C.textMuted, flex: 1 }} numberOfLines={1}>
                  {m.league} · {fmtMatchTime(m.matchTime)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : query.length >= 2 && !searching && !selected ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 }}>
          <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
          <Text style={{ fontSize: 12, color: C.textMuted }}>No upcoming matches found — use manual entry below.</Text>
        </View>
      ) : null}

      {/* Selected match badge */}
      {selected ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }}>
          <Ionicons name="checkmark-circle" size={16} color={C.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: C.primary }} numberOfLines={1}>{selected.label}</Text>
            <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
              {selected.league} · {fmtMatchTime(selected.matchTime)}
            </Text>
          </View>
          <Pressable onPress={clear} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// Access denied state
function AccessDenied({ C, onBack }: { C: AppColors; onBack: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: `${C.accentRed}14`, borderWidth: 1, borderColor: `${C.accentRed}33`, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="lock-closed" size={30} color={C.accentRed} />
      </View>
      <Text style={{ fontSize: 20, fontWeight: FONTS.extraBold, color: C.textPrimary, textAlign: 'center' }}>Expert Access Only</Text>
      <Text style={{ fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 22 }}>
        Only verified expert tipsters with manage_tips permission can submit tips. Contact an admin to request access.
      </Text>
      <Pressable onPress={onBack} style={({ pressed }) => [
        { borderRadius: RADIUS.full, paddingVertical: 13, paddingHorizontal: 32, backgroundColor: C.primary },
        pressed ? { opacity: 0.85 } : null,
      ]}>
        <Text style={{ fontSize: 15, fontWeight: FONTS.bold, color: C.textInverse }}>Go Back</Text>
      </Pressable>
    </View>
  );
}

// Success screen
function SuccessScreen({ C, onAnother, onDone }: { C: AppColors; onAnother: () => void; onDone: () => void }) {
  const scaleAnim = useRef(new Animated.Value(0.4)).current;
  const opAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 7 }),
      Animated.timing(opAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 32, opacity: opAnim, transform: [{ scale: scaleAnim }] }}>
      <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: '#22C55E14', borderWidth: 1.5, borderColor: '#22C55E55', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="checkmark-circle" size={44} color="#22C55E" />
      </View>
      <Text style={{ fontSize: 24, fontWeight: FONTS.extraBold, color: C.textPrimary, textAlign: 'center' }}>Tip Submitted!</Text>
      <Text style={{ fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 22 }}>
        Your expert tip is now live in the VIP Tips Feed. It will also appear in the AI Report consensus data.
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
        <Pressable onPress={onAnother} style={({ pressed }) => [
          { flex: 1, alignItems: 'center', borderRadius: RADIUS.full, paddingVertical: 13, borderWidth: 1, borderColor: C.primary, backgroundColor: C.primaryGlow },
          pressed ? { opacity: 0.85 } : null,
        ]}>
          <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: C.primary }}>Submit Another</Text>
        </Pressable>
        <Pressable onPress={onDone} style={({ pressed }) => [
          { flex: 1, alignItems: 'center', borderRadius: RADIUS.full, paddingVertical: 13, backgroundColor: C.primary },
          pressed ? { opacity: 0.85 } : null,
        ]}>
          <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: C.textInverse }}>Done</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function SubmitTipScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();
  const { isAdmin, adminRole, loading: adminLoading } = useAdminRole(user?.id);

  const canManageTips = !adminLoading && !!adminRole && !!(adminRole as any)?.permissions?.manage_tips;

  // ── Form fields ─────────────────────────────────────────────────────────────
  const [sport, setSport] = useState('football');
  const [selectedMatch, setSelectedMatch] = useState<MatchOption | null>(null);

  // Manual match entry (fallback)
  const [useManual, setUseManual] = useState(false);
  const [manualLabel, setManualLabel] = useState('');
  const [manualLeague, setManualLeague] = useState('');
  const [manualKickoff, setManualKickoff] = useState('');

  // Tip fields
  const [tipType, setTipType] = useState<TipTypeDef | null>(null);
  const [tipValue, setTipValue] = useState('');
  const [odds, setOdds] = useState('');
  const [confidence, setConfidence] = useState(70);
  const [analysis, setAnalysis] = useState('');
  const [isPremium, setIsPremium] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset tip type when sport changes
  useEffect(() => { setTipType(null); setTipValue(''); }, [sport]);

  // ── Validation ──────────────────────────────────────────────────────────────
  const matchLabel = useManual ? manualLabel.trim() : selectedMatch?.label ?? '';
  const matchLeague = useManual ? manualLeague.trim() : selectedMatch?.league ?? '';
  const matchTime = useManual ? null : selectedMatch?.matchTime ?? null;
  const oddsNum = parseFloat(odds);

  const isValid =
    !!matchLabel &&
    !!tipType &&
    !!tipValue.trim() &&
    !!odds.trim() && !isNaN(oddsNum) && oddsNum > 1.0 &&
    analysis.trim().length >= 20;

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!matchLabel) { setError('Please select or enter a match.'); return; }
    if (!tipType) { setError('Please select a tip type.'); return; }
    if (!tipValue.trim()) { setError('Please enter the predicted outcome.'); return; }
    if (!odds.trim() || isNaN(oddsNum) || oddsNum <= 1.0) {
      setError('Please enter valid decimal odds greater than 1.00 (e.g. 1.85).');
      return;
    }
    if (analysis.trim().length < 20) { setError('Analysis must be at least 20 characters.'); return; }
    if (!user?.id) { setError('You must be signed in.'); return; }

    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('username, email')
        .eq('id', user.id)
        .maybeSingle();
      const expertName = (profile as any)?.username ?? (profile as any)?.email?.split('@')[0] ?? 'Expert';

      const payload = {
        expert_id:    user.id,
        expert_name:  expertName,
        sport,
        match_label:  matchLabel,
        tip_type:     tipType.value,
        tip_value:    tipValue.trim(),
        odds:         parseFloat(oddsNum.toFixed(2)),
        confidence,
        analysis:     analysis.trim(),
        status:       'pending',
        match_time:   matchTime,
        league:       matchLeague || null,
        is_premium:   isPremium,
      };

      const { error: insertError } = await supabase.from('expert_tips').insert(payload);
      if (insertError) throw insertError;

      setSuccess(true);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit tip. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [matchLabel, tipType, tipValue, odds, oddsNum, confidence, analysis, user?.id, sport, matchLeague, matchTime, isPremium]);

  const handleReset = useCallback(() => {
    setSuccess(false);
    setSelectedMatch(null);
    setUseManual(false);
    setManualLabel(''); setManualLeague(''); setManualKickoff('');
    setTipType(null); setTipValue(''); setOdds('');
    setConfidence(70); setAnalysis(''); setIsPremium(false);
    setError(null);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>

      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <Text style={[s.headerTitle, { color: C.textPrimary }]}>Submit Expert Tip</Text>
            {canManageTips ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#22C55E14', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: '#22C55E33' }}>
                <Ionicons name="shield-checkmark" size={10} color="#22C55E" />
                <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold, color: '#22C55E' }}>EXPERT VERIFIED</Text>
              </View>
            ) : null}
          </View>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {/* States */}
      {adminLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : !user?.id ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Ionicons name="person-circle-outline" size={48} color={C.textMuted} />
          <Text style={{ color: C.textMuted, fontSize: 15 }}>Sign in to submit expert tips.</Text>
          <Pressable onPress={() => router.push('/login' as any)} style={[{ borderRadius: RADIUS.full, paddingVertical: 12, paddingHorizontal: 28, backgroundColor: C.primary }]}>
            <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: C.textInverse }}>Sign In</Text>
          </Pressable>
        </View>
      ) : !canManageTips ? (
        <AccessDenied C={C} onBack={() => router.back()} />
      ) : success ? (
        <SuccessScreen C={C} onAnother={handleReset} onDone={() => router.back()} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >

            {/* ── Step 1: Sport ── */}
            <SectionCard title="STEP 1 — SPORT" icon="football-outline" C={C}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {SPORT_OPTIONS.map((sp) => {
                  const isSel = sport === sp.id;
                  return (
                    <Pressable
                      key={sp.id}
                      onPress={() => setSport(sp.id)}
                      style={({ pressed }) => [
                        chipS.base,
                        { borderColor: isSel ? C.primary : C.border, backgroundColor: isSel ? C.primaryGlow : C.surface },
                        pressed ? { opacity: 0.75 } : null,
                      ]}
                    >
                      <Text style={[chipS.text, { color: isSel ? C.primary : C.textSecondary, fontWeight: isSel ? FONTS.bold : FONTS.medium }]}>
                        {sp.emoji} {sp.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </SectionCard>

            {/* ── Step 2: Match ── */}
            <SectionCard title="STEP 2 — MATCH" icon="search-outline" C={C}>
              {/* Toggle search vs manual */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {[{ label: '🔍 Search Matches', val: false }, { label: '✏️ Manual Entry', val: true }].map((opt) => (
                  <Pressable
                    key={String(opt.val)}
                    onPress={() => { setUseManual(opt.val); setSelectedMatch(null); }}
                    style={[
                      chipS.base, { flex: 1, alignItems: 'center' },
                      useManual === opt.val
                        ? { borderColor: C.primary, backgroundColor: C.primaryGlow }
                        : { borderColor: C.border, backgroundColor: C.surface },
                    ]}
                  >
                    <Text style={[chipS.text, { color: useManual === opt.val ? C.primary : C.textMuted, fontWeight: useManual === opt.val ? FONTS.bold : FONTS.medium }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {!useManual ? (
                <MatchPicker
                  sport={sport}
                  selected={selectedMatch}
                  onSelect={setSelectedMatch}
                  C={C}
                />
              ) : (
                <View style={{ gap: 10 }}>
                  <TextInput
                    style={[inp.standalone, { backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }]}
                    value={manualLabel}
                    onChangeText={setManualLabel}
                    placeholder="Match label, e.g. Arsenal vs Chelsea"
                    placeholderTextColor={C.textMuted}
                  />
                  <TextInput
                    style={[inp.standalone, { backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }]}
                    value={manualLeague}
                    onChangeText={setManualLeague}
                    placeholder="League / Tournament"
                    placeholderTextColor={C.textMuted}
                  />
                  <TextInput
                    style={[inp.standalone, { backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }]}
                    value={manualKickoff}
                    onChangeText={setManualKickoff}
                    placeholder="Kickoff time (e.g. Today 20:00)"
                    placeholderTextColor={C.textMuted}
                  />
                </View>
              )}
            </SectionCard>

            {/* ── Step 3: Tip Type ── */}
            <SectionCard title="STEP 3 — TIP TYPE" icon="layers-outline" C={C}>
              <TipTypeDropdown
                tipTypes={getTipTypes(sport)}
                selected={tipType}
                onSelect={(t) => { setTipType(t); setTipValue(''); }}
                C={C}
              />
            </SectionCard>

            {/* ── Step 4: Predicted Outcome ── */}
            <SectionCard title="STEP 4 — PREDICTED OUTCOME" icon="checkmark-circle-outline" C={C}>
              <View style={{ gap: 6 }}>
                {tipType ? (
                  <Text style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>
                    e.g. {tipType.valuePlaceholder}
                  </Text>
                ) : null}
                <View style={[inp.row, { backgroundColor: C.surface, borderColor: tipValue.trim() ? `${C.primary}55` : C.border }]}>
                  <Ionicons name="create-outline" size={16} color={C.textMuted} />
                  <TextInput
                    style={[inp.field, { color: C.textPrimary }]}
                    value={tipValue}
                    onChangeText={setTipValue}
                    placeholder={tipType ? `e.g. ${tipType.valuePlaceholder}` : 'Select tip type first...'}
                    placeholderTextColor={C.textMuted}
                    editable={!!tipType}
                  />
                  {tipValue.trim() ? (
                    <Pressable onPress={() => setTipValue('')} hitSlop={8}>
                      <Ionicons name="close-circle" size={15} color={C.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </SectionCard>

            {/* ── Step 5: Odds ── */}
            <SectionCard title="STEP 5 — DECIMAL ODDS" icon="pricetag-outline" C={C}>
              <View style={{ gap: 10 }}>
                <View style={[inp.row, { backgroundColor: C.surface, borderColor: odds.trim() && !isNaN(oddsNum) && oddsNum > 1 ? `${C.primary}55` : C.border }]}>
                  <Ionicons name="pricetag-outline" size={16} color={C.textMuted} />
                  <TextInput
                    style={[inp.field, { color: C.textPrimary }]}
                    value={odds}
                    onChangeText={setOdds}
                    placeholder="e.g. 1.85"
                    placeholderTextColor={C.textMuted}
                    keyboardType="decimal-pad"
                  />
                  {odds.trim() && !isNaN(oddsNum) && oddsNum > 1 ? (
                    <View style={{ borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#22C55E33', backgroundColor: '#22C55E14', paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 10, color: '#22C55E', fontWeight: FONTS.bold }}>
                        {Math.round((1 / oddsNum) * 100)}% implied
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={{ fontSize: 11, color: C.textMuted, lineHeight: 17 }}>
                  Enter decimal odds (European format). Must be greater than 1.00.
                </Text>
              </View>
            </SectionCard>

            {/* ── Step 6: Confidence ── */}
            <SectionCard title="STEP 6 — CONFIDENCE" icon="analytics-outline" C={C}>
              <ConfSlider value={confidence} onChange={setConfidence} C={C} />
            </SectionCard>

            {/* ── Step 7: Analysis ── */}
            <SectionCard title="STEP 7 — EXPERT ANALYSIS" icon="document-text-outline" C={C}>
              <View style={{ gap: 8 }}>
                <TextInput
                  style={[inp.textarea, { backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }]}
                  value={analysis}
                  onChangeText={setAnalysis}
                  placeholder="Provide your expert reasoning, key stats, and factors behind this tip. Minimum 20 characters."
                  placeholderTextColor={C.textMuted}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  maxLength={800}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 10, color: analysis.length >= 20 ? '#22C55E' : C.textMuted }}>
                    {analysis.length >= 20 ? '✓ Minimum met' : `${20 - analysis.length} more chars needed`}
                  </Text>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>{analysis.length}/800</Text>
                </View>
              </View>
            </SectionCard>

            {/* ── Step 8: Options ── */}
            <SectionCard title="STEP 8 — OPTIONS" icon="options-outline" C={C}>
              <Pressable
                onPress={() => setIsPremium((p) => !p)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
              >
                <View style={[
                  { width: 44, height: 26, borderRadius: 13, borderWidth: 1, padding: 2, justifyContent: 'center' },
                  isPremium ? { backgroundColor: C.primary, borderColor: C.primary } : { backgroundColor: C.surface, borderColor: C.border },
                ]}>
                  <View style={[
                    { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
                    isPremium ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
                  ]} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <FontAwesome5 name="crown" size={11} color={isPremium ? C.primary : C.textMuted} solid={isPremium} />
                    <Text style={{ fontSize: 14, fontWeight: FONTS.semiBold, color: isPremium ? C.primary : C.textSecondary }}>VIP Only Tip</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    {isPremium ? 'Visible only to VIP subscribers' : 'Visible to all users as a preview'}
                  </Text>
                </View>
              </Pressable>
            </SectionCard>

            {/* ── Preview Summary ── */}
            {isValid ? (
              <View style={[card.wrap, { backgroundColor: `${C.primary}0A`, borderColor: `${C.primary}33` }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Ionicons name="eye-outline" size={14} color={C.primary} />
                  <Text style={{ fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.9, color: C.primary }}>TIP PREVIEW</Text>
                </View>
                {[
                  { label: 'Match', value: matchLabel },
                  { label: 'Sport', value: sport.charAt(0).toUpperCase() + sport.slice(1) },
                  { label: 'Tip Type', value: tipType?.label ?? '' },
                  { label: 'Prediction', value: tipValue },
                  { label: 'Odds', value: `${oddsNum.toFixed(2)} (${Math.round((1 / oddsNum) * 100)}% implied)` },
                  { label: 'Confidence', value: `${confidence}% — ${confLabel(confidence).label}` },
                  { label: 'Access', value: isPremium ? '👑 VIP Only' : '🌐 Public' },
                ].map((row) => (
                  <View key={row.label} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: `${C.primary}22` }}>
                    <Text style={{ width: 90, fontSize: 12, color: C.textMuted, fontWeight: FONTS.semiBold }}>{row.label}</Text>
                    <Text style={{ flex: 1, fontSize: 12, color: C.textPrimary, fontWeight: FONTS.medium }}>{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Error */}
            {error ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 12, backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}33` }}>
                <Ionicons name="warning-outline" size={15} color={C.accentRed} />
                <Text style={{ flex: 1, fontSize: 13, color: C.accentRed, lineHeight: 19 }}>{error}</Text>
                <Pressable onPress={() => setError(null)} hitSlop={8}>
                  <Ionicons name="close" size={15} color={C.accentRed} />
                </Pressable>
              </View>
            ) : null}

            {/* Checklist when not yet valid */}
            {!isValid ? (
              <View style={[card.wrap, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={{ fontSize: 10, fontWeight: FONTS.extraBold, color: C.textMuted, letterSpacing: 0.7, marginBottom: 8 }}>
                  SUBMISSION CHECKLIST
                </Text>
                {[
                  { label: 'Match selected or entered', done: !!matchLabel },
                  { label: 'Tip type chosen', done: !!tipType },
                  { label: 'Predicted outcome entered', done: !!tipValue.trim() },
                  { label: 'Decimal odds > 1.00', done: !!odds.trim() && !isNaN(oddsNum) && oddsNum > 1 },
                  { label: 'Analysis (20+ characters)', done: analysis.trim().length >= 20 },
                ].map((item) => (
                  <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 }}>
                    <Ionicons
                      name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={15}
                      color={item.done ? '#22C55E' : C.textMuted}
                    />
                    <Text style={{ fontSize: 12, color: item.done ? '#22C55E' : C.textMuted }}>{item.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Submit */}
            <Pressable
              onPress={handleSubmit}
              disabled={submitting || !isValid}
              style={({ pressed }) => [
                s.submitBtn,
                { backgroundColor: isValid ? C.primary : C.border },
                pressed && isValid ? { opacity: 0.88, transform: [{ scale: 0.98 }] } : null,
                submitting || !isValid ? { opacity: submitting ? 0.7 : 0.5 } : null,
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={C.textInverse} />
              ) : (
                <FontAwesome5 name="paper-plane" size={14} color={isValid ? C.textInverse : C.textMuted} />
              )}
              <Text style={[s.submitText, { color: isValid ? C.textInverse : C.textMuted }]}>
                {submitting ? 'Submitting...' : 'Post Expert Tip'}
              </Text>
            </Pressable>

            <View style={{ height: 32 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const chipS = StyleSheet.create({
  base: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  text: { fontSize: 13 },
});

const inp = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, height: 50,
  },
  field: { flex: 1, fontSize: 14, fontWeight: FONTS.medium },
  standalone: {
    borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, height: 50,
    fontSize: 14, fontWeight: FONTS.medium,
  },
  textarea: {
    borderRadius: RADIUS.lg, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, lineHeight: 22, minHeight: 130,
  },
});

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold },
  scroll: { padding: SPACING.md, gap: 16 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: RADIUS.full, paddingVertical: 15,
  },
  submitText: { fontSize: 16, fontWeight: FONTS.extraBold },
});
