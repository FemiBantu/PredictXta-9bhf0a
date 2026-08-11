/**
 * Admin Tips — Create / edit winning tips
 * Accessible by main_admin, admin (with manage_tips permission), and experts.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ScrollView, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { getSupabaseClient, useAlert, useAuth } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

// ─── Constants ────────────────────────────────────────────────────────────────
const SPORTS = [
  { id: 'football', label: 'Football', emoji: '⚽' },
  { id: 'basketball', label: 'Basketball', emoji: '🏀' },
  { id: 'tennis', label: 'Tennis', emoji: '🎾' },
  { id: 'cricket', label: 'Cricket', emoji: '🏏' },
  { id: 'mma', label: 'MMA', emoji: '🥊' },
  { id: 'baseball', label: 'Baseball', emoji: '⚾' },
  { id: 'hockey', label: 'Hockey', emoji: '🏒' },
  { id: 'rugby', label: 'Rugby', emoji: '🏉' },
];

const TIP_TYPES = [
  { id: '1X2', label: '1X2', desc: 'Home / Draw / Away' },
  { id: 'BTTS', label: 'BTTS', desc: 'Both Teams to Score' },
  { id: 'Over/Under', label: 'Over/Under', desc: 'Total Goals Line' },
  { id: 'Correct Score', label: 'Correct Score', desc: 'Exact scoreline' },
  { id: 'Asian Handicap', label: 'Asian HCP', desc: 'Handicap betting' },
  { id: 'Double Chance', label: 'Double Chance', desc: '1X / X2 / 12' },
  { id: 'HT/FT', label: 'HT/FT', desc: 'Half-time / Full-time' },
  { id: 'Accumulator', label: 'Accumulator', desc: 'Multi-match combo' },
  { id: 'Player Props', label: 'Player Props', desc: 'Goals / assists etc.' },
];

const TIP_VALUES_BY_TYPE: Record<string, string[]> = {
  '1X2': ['Home Win', 'Draw', 'Away Win'],
  'BTTS': ['Yes', 'No'],
  'Over/Under': ['Over 0.5', 'Over 1.5', 'Over 2.5', 'Over 3.5', 'Over 4.5', 'Under 0.5', 'Under 1.5', 'Under 2.5', 'Under 3.5'],
  'Correct Score': ['1-0', '2-0', '2-1', '3-0', '3-1', '3-2', '0-0', '1-1', '2-2', '0-1', '0-2', '1-2'],
  'Asian Handicap': ['-0.5', '-1', '-1.5', '-2', '+0.5', '+1', '+1.5', '+2'],
  'Double Chance': ['1X (Home or Draw)', 'X2 (Away or Draw)', '12 (Home or Away)'],
  'HT/FT': ['Home/Home', 'Home/Draw', 'Draw/Home', 'Draw/Draw', 'Away/Away', 'Away/Draw'],
  'Accumulator': [],
  'Player Props': [],
};

const STATUS_OPTIONS = [
  { id: 'pending', label: 'Pending', color: '#F59E0B' },
  { id: 'won', label: 'Won', color: '#22C55E' },
  { id: 'lost', label: 'Lost', color: '#EF4444' },
  { id: 'void', label: 'Void', color: '#9CA3AF' },
];

// ─── Field Row ────────────────────────────────────────────────────────────────
function FieldRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  const { colors: C } = useTheme();
  return (
    <View style={fr.wrap}>
      <Text style={[fr.label, { color: C.textMuted }]}>
        {label}{required ? <Text style={{ color: '#EF4444' }}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

const fr = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 11, fontWeight: FONTS.bold, letterSpacing: 0.7, textTransform: 'uppercase' },
});

// ─── Chip Selector ────────────────────────────────────────────────────────────
function ChipSelector<T extends string>({ options, selected, onSelect, color }: {
  options: { id: T; label: string; emoji?: string; desc?: string }[];
  selected: T;
  onSelect: (v: T) => void;
  color?: string;
}) {
  const { colors: C } = useTheme();
  const accentColor = color ?? C.primary;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
      {options.map((o) => {
        const active = selected === o.id;
        return (
          <Pressable key={o.id}
            style={({ pressed }) => [cs.chip, active ? { backgroundColor: `${accentColor}18`, borderColor: accentColor } : { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.75 } : null]}
            onPress={() => onSelect(o.id)}>
            {o.emoji ? <Text style={{ fontSize: 14 }}>{o.emoji}</Text> : null}
            <View>
              <Text style={[cs.chipLabel, { color: active ? accentColor : C.textSecondary }, active ? { fontWeight: FONTS.bold } : null]}>{o.label}</Text>
              {o.desc ? <Text style={[cs.chipDesc, { color: C.textMuted }]}>{o.desc}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const cs = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, minWidth: 80 },
  chipLabel: { fontSize: 13, fontWeight: FONTS.medium },
  chipDesc: { fontSize: 10, marginTop: 1 },
});

// ─── Confidence Slider (manual numeric input) ─────────────────────────────────
function ConfidenceInput({ value, onChange, C }: { value: number; onChange: (n: number) => void; C: any }) {
  const tiers = [
    { label: 'Low', range: [50, 64], color: '#EF4444' },
    { label: 'Medium', range: [65, 79], color: '#F59E0B' },
    { label: 'High', range: [80, 100], color: '#22C55E' },
  ];
  const tier = tiers.find((t) => value >= t.range[0] && value <= t.range[1]) ?? { label: 'Low', color: '#EF4444' };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[60, 65, 70, 75, 80, 85, 90, 95].map((v) => (
          <Pressable key={v}
            style={({ pressed }) => [conf.btn, { borderColor: value === v ? '#22C55E' : C.border, backgroundColor: value === v ? '#22C55E18' : C.card }, pressed ? { opacity: 0.7 } : null]}
            onPress={() => onChange(v)}>
            <Text style={[conf.btnText, { color: value === v ? '#22C55E' : C.textMuted }]}>{v}%</Text>
          </Pressable>
        ))}
      </View>
      <View style={[conf.valuePill, { backgroundColor: `${(tier as any).color}14`, borderColor: `${(tier as any).color}44` }]}>
        <Ionicons name="shield-checkmark-outline" size={12} color={(tier as any).color} />
        <Text style={[conf.valueText, { color: (tier as any).color }]}>{value}% confidence · {(tier as any).label}</Text>
      </View>
    </View>
  );
}

const conf = StyleSheet.create({
  btn: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  btnText: { fontSize: 12, fontWeight: FONTS.semiBold },
  valuePill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start' },
  valueText: { fontSize: 12, fontWeight: FONTS.semiBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminTipsScreen() {
  const router = useRouter();
  const { showAlert } = useAlert();
  const { user } = useAuth();
  const { colors: C } = useTheme();

  // Form state
  const [sport, setSport] = useState<string>('football');
  const [matchLabel, setMatchLabel] = useState('');
  const [league, setLeague] = useState('');
  const [tipType, setTipType] = useState<string>('1X2');
  const [tipValue, setTipValue] = useState('');
  const [customTipValue, setCustomTipValue] = useState('');
  const [odds, setOdds] = useState('');
  const [confidence, setConfidence] = useState(75);
  const [analysis, setAnalysis] = useState('');
  const [status, setStatus] = useState<string>('pending');
  const [isPremium, setIsPremium] = useState(false);
  const [saving, setSaving] = useState(false);

  // Preset values for selected tip type
  const presetValues = TIP_VALUES_BY_TYPE[tipType] ?? [];
  const resolvedTipValue = tipValue === '__custom__' ? customTipValue : tipValue;

  const isValid = matchLabel.trim().length >= 3 && tipType && resolvedTipValue.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!isValid) { showAlert('Incomplete', 'Fill in Match, Tip Type and Tip Value.'); return; }
    setSaving(true);
    try {
      const sb = getSupabaseClient();
      const { error } = await sb.from('expert_tips').insert({
        expert_id: user?.id,
        expert_name: user?.username || user?.email || 'Admin',
        sport,
        match_label: matchLabel.trim(),
        league: league.trim() || null,
        tip_type: tipType,
        tip_value: resolvedTipValue.trim(),
        odds: odds.trim() ? parseFloat(odds.trim()) : null,
        confidence,
        analysis: analysis.trim() || null,
        status,
        is_premium: isPremium,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) { showAlert('Error', error.message); }
      else {
        showAlert('Tip Posted!', 'Your winning tip has been published.', [{ text: 'Back to Admin', onPress: () => router.back() }]);
      }
    } catch (e) { showAlert('Error', String(e)); }
    setSaving(false);
  }, [isValid, user, sport, matchLabel, league, tipType, resolvedTipValue, odds, confidence, analysis, status, isPremium, showAlert, router]);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={s.headerCenter}>
            <FontAwesome5 name="lightbulb" size={16} color="#F59E0B" />
            <Text style={[s.title, { color: C.textPrimary }]}>Post Winning Tip</Text>
          </View>
          <View style={[s.expertBadge, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}>
            <Ionicons name="star" size={10} color="#F59E0B" />
            <Text style={[s.expertBadgeText, { color: '#F59E0B' }]}>EXPERT</Text>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">

          {/* Sport */}
          <FieldRow label="Sport" required>
            <ChipSelector options={SPORTS} selected={sport} onSelect={setSport} color={C.primary} />
          </FieldRow>

          {/* Match */}
          <FieldRow label="Match" required>
            <View style={[s.inputWrap, { backgroundColor: C.card, borderColor: C.border }]}>
              <Ionicons name="football-outline" size={16} color={C.textMuted} />
              <TextInput
                style={[s.input, { color: C.textPrimary }]}
                value={matchLabel}
                onChangeText={setMatchLabel}
                placeholder="e.g. Arsenal vs Chelsea"
                placeholderTextColor={C.textMuted}
              />
            </View>
          </FieldRow>

          {/* League */}
          <FieldRow label="League / Competition">
            <View style={[s.inputWrap, { backgroundColor: C.card, borderColor: C.border }]}>
              <Ionicons name="trophy-outline" size={16} color={C.textMuted} />
              <TextInput
                style={[s.input, { color: C.textPrimary }]}
                value={league}
                onChangeText={setLeague}
                placeholder="e.g. Premier League"
                placeholderTextColor={C.textMuted}
              />
            </View>
          </FieldRow>

          {/* Tip Type */}
          <FieldRow label="Tip Type" required>
            <ChipSelector options={TIP_TYPES} selected={tipType} onSelect={(t) => { setTipType(t); setTipValue(''); setCustomTipValue(''); }} color={C.accent} />
          </FieldRow>

          {/* Tip Value */}
          <FieldRow label="Tip Value" required>
            {presetValues.length > 0 ? (
              <ChipSelector
                options={[...presetValues.map((v) => ({ id: v, label: v })), { id: '__custom__', label: 'Custom…' }]}
                selected={tipValue}
                onSelect={setTipValue}
                color="#22C55E"
              />
            ) : null}
            {(tipValue === '__custom__' || presetValues.length === 0) ? (
              <View style={[s.inputWrap, { backgroundColor: C.card, borderColor: C.border, marginTop: 8 }]}>
                <Ionicons name="create-outline" size={16} color={C.textMuted} />
                <TextInput
                  style={[s.input, { color: C.textPrimary }]}
                  value={customTipValue}
                  onChangeText={setCustomTipValue}
                  placeholder="Enter custom tip value…"
                  placeholderTextColor={C.textMuted}
                  autoFocus={tipValue === '__custom__'}
                />
              </View>
            ) : null}
          </FieldRow>

          {/* Odds */}
          <FieldRow label="Odds (optional)">
            <View style={[s.inputWrap, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[s.oddsSymbol, { color: C.textMuted }]}>@</Text>
              <TextInput
                style={[s.input, { color: C.textPrimary }]}
                value={odds}
                onChangeText={(t) => setOdds(t.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 1.85"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
          </FieldRow>

          {/* Confidence */}
          <FieldRow label="Confidence">
            <ConfidenceInput value={confidence} onChange={setConfidence} C={C} />
          </FieldRow>

          {/* Status */}
          <FieldRow label="Result Status">
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {STATUS_OPTIONS.map((st) => {
                const active = status === st.id;
                return (
                  <Pressable key={st.id}
                    style={({ pressed }) => [s.statusBtn, { borderColor: active ? st.color : C.border, backgroundColor: active ? `${st.color}18` : C.card }, pressed ? { opacity: 0.7 } : null]}
                    onPress={() => setStatus(st.id)}>
                    <Text style={[s.statusBtnText, { color: active ? st.color : C.textMuted }, active ? { fontWeight: FONTS.bold } : null]}>{st.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </FieldRow>

          {/* VIP only toggle */}
          <View style={[s.toggleRow, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.toggleLabel, { color: C.textPrimary }]}>VIP / Premium Tip</Text>
              <Text style={[s.toggleSub, { color: C.textMuted }]}>Only visible to VIP subscribers</Text>
            </View>
            <View style={[s.vipBadge, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}>
              <FontAwesome5 name="crown" size={10} color="#F59E0B" />
            </View>
            <Switch
              value={isPremium}
              onValueChange={setIsPremium}
              trackColor={{ false: C.border, true: `#F59E0B66` }}
              thumbColor={isPremium ? '#F59E0B' : C.textMuted}
            />
          </View>

          {/* Analysis */}
          <FieldRow label="Expert Analysis (optional)">
            <View style={[s.textAreaWrap, { backgroundColor: C.card, borderColor: C.border }]}>
              <TextInput
                style={[s.textArea, { color: C.textPrimary }]}
                value={analysis}
                onChangeText={setAnalysis}
                placeholder="Explain your reasoning, team news, stats, injuries…"
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                maxLength={1000}
              />
              <Text style={[s.charCount, { color: C.textMuted }]}>{analysis.length}/1000</Text>
            </View>
          </FieldRow>

          {/* Preview card */}
          {matchLabel.trim().length > 0 && resolvedTipValue.trim().length > 0 ? (
            <View style={[s.previewCard, { backgroundColor: C.card, borderColor: `${C.accent}44` }]}>
              <View style={[s.previewStripe, { backgroundColor: C.accent }]} />
              <View style={{ flex: 1, padding: 12, gap: 6 }}>
                <Text style={[s.previewLabel, { color: C.textMuted }]}>PREVIEW</Text>
                <Text style={[s.previewMatch, { color: C.textPrimary }]}>{matchLabel}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[s.previewTip, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
                    <Text style={[s.previewTipType, { color: C.textMuted }]}>{tipType}</Text>
                    <Text style={[s.previewTipValue, { color: C.primary }]}>{resolvedTipValue}</Text>
                  </View>
                  {odds.trim() ? <Text style={[s.previewOdds, { color: C.accent }]}>@ {parseFloat(odds).toFixed(2)}</Text> : null}
                  <View style={[s.previewConf, { backgroundColor: '#22C55E14', borderColor: '#22C55E33' }]}>
                    <Text style={[s.previewConfText, { color: '#22C55E' }]}>{confidence}%</Text>
                  </View>
                  {isPremium ? <FontAwesome5 name="crown" size={12} color="#F59E0B" /> : null}
                </View>
              </View>
            </View>
          ) : null}

          {/* Submit */}
          <Pressable
            style={({ pressed }) => [s.submitBtn, !isValid || saving ? { opacity: 0.45 } : null, pressed && isValid && !saving ? { opacity: 0.88, transform: [{ scale: 0.98 }] } : null]}
            onPress={handleSubmit}
            disabled={!isValid || saving}>
            {saving ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#000" />
                <Text style={s.submitBtnText}>Publish Tip</Text>
              </>
            )}
          </Pressable>

          <View style={{ height: 48 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: FONTS.bold },
  expertBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  expertBadgeText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  scrollContent: { padding: SPACING.md, gap: 20 },

  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12 },
  input: { flex: 1, fontSize: 14, fontWeight: FONTS.medium },
  oddsSymbol: { fontSize: 16, fontWeight: FONTS.bold },

  statusBtn: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 9 },
  statusBtnText: { fontSize: 13, fontWeight: FONTS.medium },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.xl, borderWidth: 1, padding: 14 },
  toggleLabel: { fontSize: 14, fontWeight: FONTS.semiBold },
  toggleSub: { fontSize: 11, marginTop: 2 },
  vipBadge: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  textAreaWrap: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 8 },
  textArea: { fontSize: 14, minHeight: 110, lineHeight: 22 },
  charCount: { fontSize: 10, textAlign: 'right' },

  previewCard: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  previewStripe: { width: 4 },
  previewLabel: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 1 },
  previewMatch: { fontSize: 15, fontWeight: FONTS.bold },
  previewTip: { flex: 1, borderRadius: RADIUS.md, borderWidth: 1, padding: 8, gap: 2 },
  previewTipType: { fontSize: 10 },
  previewTipValue: { fontSize: 14, fontWeight: FONTS.bold },
  previewOdds: { fontSize: 15, fontWeight: FONTS.extraBold },
  previewConf: { borderRadius: RADIUS.md, borderWidth: 1, padding: 8 },
  previewConfText: { fontSize: 12, fontWeight: FONTS.bold },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F59E0B', borderRadius: RADIUS.full, paddingVertical: 16,
    shadowColor: '#F59E0B', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  submitBtnText: { fontSize: 16, fontWeight: FONTS.extraBold, color: '#000' },
});
