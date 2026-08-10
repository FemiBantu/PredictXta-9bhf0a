/**
 * app/expert-slips.tsx
 *
 * Expert Slip Submission — verified experts submit prediction slips
 * of 10–30 matches with sport-specific tip types.
 * Enforces: max 3 slips/day, 10–30 picks/slip, no editing after lock.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient, useAuth, useAlert } from '@/template';

// ─── Sport tip types ───────────────────────────────────────────────────────────
const SPORT_TIP_TYPES: Record<string, string[]> = {
  football:          ['1x2', 'double_chance', 'over_under', 'btts', 'correct_score', 'asian_handicap', 'first_goalscorer', 'ht_result'],
  basketball:        ['moneyline', 'over_under', 'spread', 'first_quarter', 'ht_result'],
  tennis:            ['match_winner', 'set_winner', 'total_sets', 'first_set'],
  cricket:           ['match_winner', 'top_batsman', 'total_runs', 'toss_winner'],
  baseball:          ['moneyline', 'run_line', 'total_runs', 'first_5_innings'],
  hockey:            ['moneyline', 'puck_line', 'total_goals', 'first_period'],
  mma:               ['fight_winner', 'method_of_victory', 'total_rounds', 'goes_distance'],
  rugby:             ['match_winner', 'handicap', 'total_points', 'first_try_scorer'],
  'american-football': ['moneyline', 'spread', 'total_points', 'first_touchdown'],
  esports:           ['match_winner', 'map_winner', 'total_maps', 'first_blood'],
  default:           ['match_winner', 'handicap', 'total', 'other'],
};

const TIP_VALUE_OPTIONS: Record<string, string[]> = {
  '1x2':                 ['home_win', 'draw', 'away_win'],
  'double_chance':       ['home_or_draw', 'away_or_draw', 'home_or_away'],
  'over_under':          ['over', 'under'],
  'btts':                ['yes', 'no'],
  'correct_score':       ['1-0', '2-0', '2-1', '1-1', '0-0', '0-1', '0-2', '1-2', 'other'],
  'asian_handicap':      ['home', 'away'],
  'first_goalscorer':    ['home_team', 'away_team', 'no_goalscorer'],
  'ht_result':           ['home_win', 'draw', 'away_win'],
  'moneyline':           ['home', 'away'],
  'spread':              ['home', 'away'],
  'match_winner':        ['home', 'away'],
  'set_winner':          ['player_1', 'player_2'],
  'first_set':           ['player_1', 'player_2'],
  'map_winner':          ['team_1', 'team_2'],
  'fight_winner':        ['fighter_1', 'fighter_2'],
  'goes_distance':       ['yes', 'no'],
  'default':             ['home', 'away', 'yes', 'no', 'over', 'under'],
};

const SPORTS = ['football', 'basketball', 'tennis', 'cricket', 'baseball', 'hockey', 'mma', 'rugby', 'american-football', 'esports'];
const MIN_PICKS = 10;
const MAX_PICKS = 30;
const MAX_SLIPS_PER_DAY = 3;

interface Pick {
  id: string;
  match_id: string | null;
  match_label: string;
  home_team: string;
  away_team: string;
  league: string;
  sport: string;
  match_time: string | null;
  tip_type: string;
  tip_value: string;
  odds: string;
}

/** Canonical fingerprint for duplicate detection: match + tip type + tip value. */
function pickFingerprint(matchLabel: string, tipType: string, tipValue: string): string {
  return `${matchLabel.trim().toLowerCase()}|${tipType}|${tipValue}`;
}

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  league: string | null;
  sport: string;
  match_time: string;
  status: string;
}

// ─── Pick Row ─────────────────────────────────────────────────────────────────
function PickRow({ pick, idx, isDuplicate, onUpdate, onRemove, tipTypes, C }: {
  pick: Pick; idx: number;
  isDuplicate: boolean;
  onUpdate: (field: keyof Pick, value: string) => void;
  onRemove: () => void;
  tipTypes: string[];
  C: any;
}) {
  return (
    <View style={[pr.wrap, { backgroundColor: C.surface, borderColor: isDuplicate ? '#EF4444' : C.border }]}>
      {/* Duplicate warning banner */}
      {isDuplicate ? (
        <View style={[pr.dupBanner, { backgroundColor: '#EF444412', borderColor: '#EF444430' }]}>
          <Ionicons name="copy-outline" size={12} color="#EF4444" />
          <Text style={{ fontSize: 10, color: '#EF4444', fontWeight: FONTS.semiBold, flex: 1 }}>
            Duplicate pick — this match + tip already exists in today's slips
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[pr.num, { backgroundColor: isDuplicate ? '#EF444414' : `${C.primary}14` }]}>
          <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: isDuplicate ? '#EF4444' : C.primary }}>{idx + 1}</Text>
        </View>
        <Text style={[pr.matchLabel, { color: C.textPrimary }]} numberOfLines={1}>{pick.match_label || 'Select match'}</Text>
        {isDuplicate ? <Ionicons name="alert-circle" size={16} color="#EF4444" /> : null}
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={isDuplicate ? '#EF4444' : C.textMuted} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {/* Tip type selector */}
        <View style={[pr.select, { borderColor: C.border, flex: 1 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, flexDirection: 'row' }}>
            {tipTypes.map(tt => (
              <Pressable
                key={tt}
                onPress={() => onUpdate('tip_type', tt)}
                style={[pr.typeChip, { backgroundColor: pick.tip_type === tt ? C.primary : `${C.primary}12`, borderColor: pick.tip_type === tt ? C.primary : 'transparent' }]}
              >
                <Text style={{ fontSize: 9, color: pick.tip_type === tt ? '#fff' : C.textSecondary, fontWeight: FONTS.semiBold }}>
                  {tt.replace(/_/g, ' ').toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {/* Tip value */}
        <View style={[pr.select, { borderColor: C.border, flex: 2 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, flexDirection: 'row' }}>
            {(TIP_VALUE_OPTIONS[pick.tip_type] ?? TIP_VALUE_OPTIONS['default']).map(tv => (
              <Pressable
                key={tv}
                onPress={() => onUpdate('tip_value', tv)}
                style={[pr.typeChip, { backgroundColor: pick.tip_value === tv ? '#22C55E' : `#22C55E12`, borderColor: pick.tip_value === tv ? '#22C55E' : 'transparent' }]}
              >
                <Text style={{ fontSize: 9, color: pick.tip_value === tv ? '#fff' : '#22C55E', fontWeight: FONTS.semiBold }}>
                  {tv.replace(/_/g, ' ').toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Odds */}
        <TextInput
          value={pick.odds}
          onChangeText={v => onUpdate('odds', v)}
          placeholder="Odds"
          keyboardType="decimal-pad"
          style={[pr.oddsInput, { color: C.textPrimary, borderColor: C.border, backgroundColor: C.surface }]}
          placeholderTextColor={C.textMuted}
        />
      </View>
    </View>
  );
}
const pr = StyleSheet.create({
  wrap: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 10, marginBottom: 8, borderWidth: 1.5 },
  dupBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 8 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  matchLabel: { fontSize: 12, fontWeight: FONTS.semiBold, flex: 1 },
  select: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  typeChip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  oddsInput: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, minWidth: 70, textAlign: 'center' },
});

// ─── Match Picker Modal ───────────────────────────────────────────────────────
function MatchPickerModal({ visible, sport, onSelect, onClose, C }: {
  visible: boolean; sport: string;
  onSelect: (match: Match) => void;
  onClose: () => void;
  C: any;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    const supabase = getSupabaseClient();
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    supabase.from('matches')
      .select('id, home_team, away_team, league, sport, match_time, status')
      .eq('sport', sport)
      .in('status', ['upcoming', 'live'])
      .gte('match_time', new Date().toISOString())
      .lte('match_time', tomorrow)
      .order('match_time', { ascending: true })
      .limit(50)
      .then(({ data }) => { setMatches(data ?? []); setLoading(false); });
  }, [visible, sport]);

  const filtered = useMemo(() =>
    matches.filter(m =>
      !search || m.home_team.toLowerCase().includes(search.toLowerCase()) ||
      m.away_team.toLowerCase().includes(search.toLowerCase()) ||
      (m.league ?? '').toLowerCase().includes(search.toLowerCase())
    ), [matches, search]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={[mp.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Text style={[mp.title, { color: C.textPrimary }]}>Select Match</Text>
          <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={C.textPrimary} /></Pressable>
        </View>
        <View style={[mp.searchWrap, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Ionicons name="search" size={16} color={C.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search teams or league..."
            style={[mp.searchInput, { color: C.textPrimary }]}
            placeholderTextColor={C.textMuted}
          />
        </View>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={m => m.id}
            renderItem={({ item: m }) => (
              <Pressable
                onPress={() => { onSelect(m); onClose(); }}
                style={({ pressed }) => [mp.matchRow, { borderBottomColor: C.border }, pressed ? { opacity: 0.75 } : null]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: C.textPrimary }}>
                    {m.home_team} vs {m.away_team}
                  </Text>
                  <Text style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                    {m.league} · {new Date(m.match_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </Pressable>
            )}
            ListEmptyComponent={<View style={{ padding: 24, alignItems: 'center' }}><Text style={{ color: C.textMuted }}>No upcoming matches found. Enter match manually.</Text></View>}
          />
        )}

        {/* Manual entry option */}
        <Pressable
          onPress={() => onSelect({ id: '', home_team: '', away_team: '', league: '', sport, match_time: '', status: 'upcoming' })}
          style={[mp.manualBtn, { borderTopColor: C.border }]}
        >
          <Ionicons name="create-outline" size={16} color={C.primary} />
          <Text style={{ color: C.primary, fontSize: 13, fontWeight: FONTS.semiBold }}>Enter match manually</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
const mp = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md, borderBottomWidth: 1 },
  title: { fontSize: 16, fontWeight: FONTS.bold },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 13 },
  matchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  manualBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderTopWidth: 1 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ExpertSlipsScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();
  const { showAlert } = useAlert();

  const [expertProfile, setExpertProfile] = useState<{ id: string; status: string } | null>(null);
  const [slipsToday, setSlipsToday] = useState(0);
  const [sport, setSport] = useState('football');
  const [title, setTitle] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [addingPickIdx, setAddingPickIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recentSlips, setRecentSlips] = useState<any[]>([]);
  /**
   * Fingerprints of picks already submitted in today's open slips.
   * Format: "match_label_lower|tip_type|tip_value"
   * Used to detect cross-slip duplicates.
   */
  const [existingPickFingerprints, setExistingPickFingerprints] = useState<Set<string>>(new Set());

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!user?.id) return;
    const supabase = getSupabaseClient();
    supabase.from('expert_profiles').select('id, status').eq('user_id', user.id).maybeSingle()
      .then(async ({ data: profile }) => {
        setExpertProfile(profile);
        if (profile?.id) {
          // Load recent slips for the sidebar display
          const { data: slips } = await supabase
            .from('expert_slips')
            .select('id, slip_date, total_picks, accuracy_pct, status, sport, title, coins_awarded')
            .eq('expert_id', profile.id)
            .order('submitted_at', { ascending: false })
            .limit(10);
          setRecentSlips(slips ?? []);
          const todaySlips = (slips ?? []).filter(s => s.slip_date === today);
          setSlipsToday(todaySlips.length);

          // ── Fetch existing picks from today's open slips for duplicate detection ──
          if (todaySlips.length > 0) {
            const todaySlipIds = todaySlips.map(sl => sl.id);
            const { data: existingPicks } = await supabase
              .from('expert_slip_picks')
              .select('match_label, tip_type, tip_value')
              .in('slip_id', todaySlipIds);
            const fingerprints = new Set<string>();
            for (const p of existingPicks ?? []) {
              fingerprints.add(pickFingerprint(p.match_label ?? '', p.tip_type ?? '', p.tip_value ?? ''));
            }
            setExistingPickFingerprints(fingerprints);
          }
        }
        setLoading(false);
      });
  }, [user?.id]);

  const tipTypes = SPORT_TIP_TYPES[sport] ?? SPORT_TIP_TYPES['default'];

  /**
   * For each pick in the current builder, compute whether it is a duplicate.
   * A duplicate exists if:
   *   (a) The same fingerprint already appears in a previously submitted today's slip, OR
   *   (b) The same fingerprint appears more than once inside the current slip being built.
   */
  const duplicateFlags = useMemo<boolean[]>(() => {
    // Map fingerprint → count within current slip (for intra-slip detection)
    const intraSlipCounts = new Map<string, number>();
    for (const p of picks) {
      if (!p.match_label || !p.tip_type || !p.tip_value) continue;
      const fp = pickFingerprint(p.match_label, p.tip_type, p.tip_value);
      intraSlipCounts.set(fp, (intraSlipCounts.get(fp) ?? 0) + 1);
    }
    return picks.map(p => {
      if (!p.match_label || !p.tip_type || !p.tip_value) return false;
      const fp = pickFingerprint(p.match_label, p.tip_type, p.tip_value);
      // Cross-slip: same pick already submitted today
      if (existingPickFingerprints.has(fp)) return true;
      // Intra-slip: same pick appears more than once in current builder
      if ((intraSlipCounts.get(fp) ?? 0) > 1) return true;
      return false;
    });
  }, [picks, existingPickFingerprints]);

  const duplicateCount = useMemo(() => duplicateFlags.filter(Boolean).length, [duplicateFlags]);

  const addPick = useCallback(() => {
    if (picks.length >= MAX_PICKS) {
      showAlert('Limit Reached', `Maximum ${MAX_PICKS} picks per slip`); return;
    }
    const newPick: Pick = {
      id: `pick-${Date.now()}`,
      match_id: null,
      match_label: '',
      home_team: '',
      away_team: '',
      league: '',
      sport,
      match_time: null,
      tip_type: tipTypes[0] ?? 'match_winner',
      tip_value: '',
      odds: '1.80',
    };
    setPicks(prev => [...prev, newPick]);
    setAddingPickIdx(picks.length);
    setShowMatchPicker(true);
  }, [picks.length, sport, tipTypes]);

  const updatePick = useCallback((idx: number, field: keyof Pick, value: string) => {
    setPicks(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }, []);

  const removePick = useCallback((idx: number) => {
    setPicks(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleMatchSelect = useCallback((match: Match) => {
    if (addingPickIdx === null) return;
    const label = match.home_team && match.away_team
      ? `${match.home_team} vs ${match.away_team}`
      : '';
    setPicks(prev => prev.map((p, i) => i === addingPickIdx ? {
      ...p,
      match_id: match.id || null,
      match_label: label,
      home_team: match.home_team,
      away_team: match.away_team,
      league: match.league ?? '',
      match_time: match.match_time || null,
    } : p));
    setAddingPickIdx(null);
  }, [addingPickIdx]);

  const totalOdds = useMemo(() =>
    picks.reduce((acc, p) => acc * (parseFloat(p.odds) || 1), 1), [picks]);

  const canSubmit = picks.length >= MIN_PICKS && picks.length <= MAX_PICKS &&
    picks.every(p => p.match_label && p.tip_type && p.tip_value && parseFloat(p.odds) >= 1.01) &&
    slipsToday < MAX_SLIPS_PER_DAY &&
    duplicateCount === 0;

  const submit = async () => {
    if (!canSubmit || !user?.id || !expertProfile?.id) return;
    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const { data: slip, error } = await supabase.from('expert_slips').insert({
        expert_id: expertProfile.id,
        user_id: user.id,
        slip_date: today,
        sport,
        title: title.trim() || null,
        total_picks: picks.length,
        correct_picks: 0,
        pending_picks: picks.length,
        status: 'open',
        submitted_at: new Date().toISOString(),
      }).select().maybeSingle();

      if (error || !slip) throw new Error(error?.message ?? 'Failed to create slip');

      const pickInserts = picks.map(p => ({
        slip_id: slip.id,
        expert_id: expertProfile.id,
        match_id: p.match_id || null,
        match_label: p.match_label,
        sport: p.sport || sport,
        match_time: p.match_time ? new Date(p.match_time).toISOString() : null,
        league: p.league || null,
        home_team: p.home_team,
        away_team: p.away_team,
        tip_type: p.tip_type,
        tip_value: p.tip_value,
        odds: parseFloat(p.odds) || 1.0,
        result: 'pending',
      }));

      await supabase.from('expert_slip_picks').insert(pickInserts);

      showAlert('Slip Submitted!', `${picks.length} picks submitted. You have ${MAX_SLIPS_PER_DAY - slipsToday - 1} slip(s) remaining today.`);
      // Add newly submitted picks to the fingerprint set so subsequent slips
      // built in this session are also protected against self-duplication.
      setExistingPickFingerprints(prev => {
        const next = new Set(prev);
        for (const p of picks) {
          if (p.match_label && p.tip_type && p.tip_value) {
            next.add(pickFingerprint(p.match_label, p.tip_type, p.tip_value));
          }
        }
        return next;
      });
      setPicks([]);
      setTitle('');
      setSlipsToday(prev => prev + 1);
      setRecentSlips(prev => [{ id: slip.id, slip_date: today, total_picks: picks.length, status: 'open', sport, title: title || null }, ...prev]);
    } catch (e: any) {
      showAlert('Error', e?.message ?? 'Failed to submit slip');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!expertProfile || expertProfile.status !== 'active') {
    return (
      <View style={[s.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']}><View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Ionicons name="arrow-back" size={22} color={C.textPrimary} /></Pressable>
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>Expert Slips</Text>
          <View style={{ width: 32 }} />
        </View></SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
          <Text style={{ fontSize: 40 }}>🏆</Text>
          <Text style={[s.headerTitle, { color: C.textPrimary, textAlign: 'center' }]}>Expert Access Required</Text>
          <Text style={{ color: C.textMuted, textAlign: 'center', fontSize: 13, lineHeight: 20 }}>
            Achieve 100% accuracy for 3 consecutive days in Daily Challenge to unlock Expert Tipster status.
          </Text>
          <Pressable onPress={() => router.push('/challenge' as any)} style={[s.bigBtn, { backgroundColor: C.primary }]}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: FONTS.bold }}>Go to Daily Challenge</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>Submit Slip</Text>
          <View style={[s.slipCounter, { backgroundColor: slipsToday >= MAX_SLIPS_PER_DAY ? '#EF444414' : `${C.primary}14`, borderColor: slipsToday >= MAX_SLIPS_PER_DAY ? '#EF444433' : `${C.primary}33` }]}>
            <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: slipsToday >= MAX_SLIPS_PER_DAY ? '#EF4444' : C.primary }}>
              {slipsToday}/{MAX_SLIPS_PER_DAY}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SPACING.md }}>
        {/* Daily limit warning */}
        {slipsToday >= MAX_SLIPS_PER_DAY ? (
          <View style={[s.warningBanner, { backgroundColor: '#EF444414', borderColor: '#EF444433' }]}>
            <Ionicons name="warning-outline" size={14} color="#EF4444" />
            <Text style={{ color: '#EF4444', fontSize: 12 }}>Daily slip limit reached ({MAX_SLIPS_PER_DAY}/day). Come back tomorrow.</Text>
          </View>
        ) : null}

        {/* Sport selector */}
        <Text style={[s.label, { color: C.textSecondary }]}>Sport</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', marginBottom: 14 }}>
          {SPORTS.map(sp => (
            <Pressable
              key={sp}
              onPress={() => setSport(sp)}
              style={[s.sportChip, { backgroundColor: sport === sp ? C.primary : C.surface, borderColor: sport === sp ? C.primary : C.border }]}
            >
              <Text style={{ fontSize: 12, color: sport === sp ? '#fff' : C.textSecondary, fontWeight: FONTS.semiBold }}>
                {sp.charAt(0).toUpperCase() + sp.slice(1)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Slip title */}
        <Text style={[s.label, { color: C.textSecondary }]}>Slip Title (optional)</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Saturday Winners Combo"
          style={[s.input, { color: C.textPrimary, borderColor: C.border, backgroundColor: C.surface }]}
          placeholderTextColor={C.textMuted}
          maxLength={80}
        />

        {/* Picks header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={[s.label, { color: C.textSecondary, marginBottom: 0 }]}>
            Picks ({picks.length}/{MAX_PICKS})
          </Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <View style={[s.limitPill, { backgroundColor: picks.length < MIN_PICKS ? '#EF444414' : '#22C55E14', borderColor: picks.length < MIN_PICKS ? '#EF444433' : '#22C55E33' }]}>
              <Text style={{ fontSize: 9, color: picks.length < MIN_PICKS ? '#EF4444' : '#22C55E', fontWeight: FONTS.bold }}>
                Min {MIN_PICKS} · Max {MAX_PICKS}
              </Text>
            </View>
          </View>
        </View>

        {/* Duplicate picks warning banner */}
        {duplicateCount > 0 ? (
          <View style={[s.warningBanner, { backgroundColor: '#EF444412', borderColor: '#EF444430', marginBottom: 10 }]}>
            <Ionicons name="copy-outline" size={14} color="#EF4444" />
            <Text style={{ color: '#EF4444', fontSize: 12, flex: 1 }}>
              {duplicateCount} duplicate pick{duplicateCount !== 1 ? 's' : ''} detected — remove or change them before submitting
            </Text>
          </View>
        ) : null}

        {/* Picks list */}
        {picks.map((pick, idx) => (
          <PickRow
            key={pick.id}
            pick={pick}
            idx={idx}
            isDuplicate={duplicateFlags[idx] ?? false}
            tipTypes={tipTypes}
            onUpdate={(field, value) => updatePick(idx, field, value)}
            onRemove={() => removePick(idx)}
            C={C}
          />
        ))}

        {/* Add pick button */}
        {picks.length < MAX_PICKS ? (
          <Pressable
            onPress={addPick}
            style={({ pressed }) => [s.addPickBtn, { borderColor: C.primary }, pressed ? { opacity: 0.75 } : null]}
          >
            <Ionicons name="add-circle-outline" size={18} color={C.primary} />
            <Text style={{ color: C.primary, fontSize: 13, fontWeight: FONTS.semiBold }}>Add Pick</Text>
          </Pressable>
        ) : null}

        {/* Summary */}
        {picks.length > 0 ? (
          <View style={[s.summaryCard, { backgroundColor: C.card, borderColor: duplicateCount > 0 ? '#EF444433' : C.border }]}>
            <Text style={[s.summaryTitle, { color: C.textPrimary }]}>Slip Summary</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                { label: 'Picks', value: picks.length.toString(), color: C.primary },
                { label: 'Total Odds', value: totalOdds.toFixed(2), color: '#F59E0B' },
                { label: 'Duplicates', value: `${duplicateCount}`, color: duplicateCount > 0 ? '#EF4444' : '#22C55E' },
              ].map(m => (
                <View key={m.label} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: FONTS.extraBold, color: m.color }}>{m.value}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>{m.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Reward info */}
        <View style={[s.rewardInfo, { backgroundColor: `${C.primary}08`, borderColor: `${C.primary}22` }]}>
          <Text style={[s.rewardTitle, { color: C.textPrimary }]}>Reward Structure</Text>
          {[
            { range: '70–79%', coins: 50, color: '#CD7F32' },
            { range: '80–89%', coins: 120, color: '#94A3B8' },
            { range: '90–99%', coins: 250, color: '#F59E0B' },
            { range: '100%', coins: 500, color: '#A855F7' },
          ].map(r => (
            <View key={r.range} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ fontSize: 12, color: C.textSecondary }}>{r.range} accuracy</Text>
              <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: r.color }}>🪙 {r.coins} coins</Text>
            </View>
          ))}
        </View>

        {/* Recent slips */}
        {recentSlips.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <Text style={[s.label, { color: C.textSecondary }]}>Recent Slips</Text>
            {recentSlips.slice(0, 5).map(slip => {
              const statusColor = slip.status === 'settled'
                ? (slip.accuracy_pct ?? 0) >= 70 ? '#22C55E' : '#EF4444'
                : '#F59E0B';
              return (
                <View key={slip.id} style={[s.recentRow, { backgroundColor: C.card, borderColor: C.border }]}>
                  <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: C.textPrimary, fontWeight: FONTS.semiBold }}>
                      {slip.title ?? `${slip.sport} slip`}
                    </Text>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>{slip.slip_date} · {slip.total_picks} picks</Text>
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: statusColor }}>
                    {slip.status === 'settled' ? `${(slip.accuracy_pct ?? 0).toFixed(0)}%` : 'Open'}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Submit button */}
      <View style={[s.footer, { backgroundColor: C.surface, borderTopColor: C.border }]}>
        <SafeAreaView edges={['bottom']}>
          <Pressable
            onPress={submit}
            disabled={!canSubmit || submitting}
            style={({ pressed }) => [
              s.submitBtn,
              { backgroundColor: canSubmit ? C.primary : C.border },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <FontAwesome5 name="paper-plane" size={14} color="#fff" />
                  <Text style={s.submitText}>
                    Submit Slip ({picks.length}/{MAX_PICKS} picks)
                  </Text>
                </>}
          </Pressable>
          {!canSubmit && picks.length > 0 && duplicateCount > 0 ? (
            <Text style={{ fontSize: 10, color: '#EF4444', textAlign: 'center', marginTop: 4 }}>
              Remove {duplicateCount} duplicate pick{duplicateCount !== 1 ? 's' : ''} to enable submission
            </Text>
          ) : !canSubmit && picks.length > 0 && picks.length < MIN_PICKS ? (
            <Text style={{ fontSize: 10, color: C.accentRed, textAlign: 'center', marginTop: 4 }}>
              Add {MIN_PICKS - picks.length} more pick{MIN_PICKS - picks.length !== 1 ? 's' : ''} to submit
            </Text>
          ) : null}
        </SafeAreaView>
      </View>

      <MatchPickerModal
        visible={showMatchPicker}
        sport={sport}
        onSelect={handleMatchSelect}
        onClose={() => { setShowMatchPicker(false); setAddingPickIdx(null); }}
        C={C}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold, flex: 1 },
  slipCounter: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: FONTS.semiBold, marginBottom: 8 },
  sportChip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  input: { borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, marginBottom: 14 },
  limitPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  addPickBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.lg, borderWidth: 1.5, borderStyle: 'dashed', paddingVertical: 14, marginBottom: 14 },
  summaryCard: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 12 },
  summaryTitle: { fontSize: 13, fontWeight: FONTS.bold, marginBottom: 10 },
  rewardInfo: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 12 },
  rewardTitle: { fontSize: 13, fontWeight: FONTS.bold, marginBottom: 8 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.lg, borderWidth: 1, padding: 10, marginBottom: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  footer: { borderTopWidth: 1, padding: SPACING.md, paddingBottom: 0 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: RADIUS.full, paddingVertical: 15 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: FONTS.bold },
  bigBtn: { borderRadius: RADIUS.full, paddingVertical: 14, paddingHorizontal: 28 },
});
