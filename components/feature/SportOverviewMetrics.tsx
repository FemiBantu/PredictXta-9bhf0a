/**
 * SportOverviewMetrics — Sport-specific key metric labels for the Overview tab.
 * Renders the relevant stat categories for each sport family so non-football
 * sports never show football-centric metrics (xG, corners, BTTS etc).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, RADIUS } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { getSportOverviewSections, getSportFamily } from '@/services/sportConfig';

interface Props {
  sport: string;
  C: AppColors;
}

const SECTION_COLORS = ['#38BDF8', '#A78BFA', '#34D399', '#F59E0B'];

export default function SportOverviewMetrics({ sport, C }: Props) {
  const sections = getSportOverviewSections(sport);
  const family = getSportFamily(sport);

  return (
    <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={[s.iconWrap, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}>
          <Ionicons name="stats-chart-outline" size={12} color={C.primary} />
        </View>
        <Text style={[s.title, { color: C.textPrimary }]}>
          {family.toUpperCase().replace(/_/g, ' ')} INTELLIGENCE
        </Text>
        <View style={[s.badge, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }]}>
          <Text style={[s.badgeText, { color: C.primary }]}>{sections.length} AREAS</Text>
        </View>
      </View>

      {/* First 2 sections */}
      {sections.slice(0, 2).map((section, si) => {
        const color = SECTION_COLORS[si % SECTION_COLORS.length];
        return (
          <View key={section.title} style={si < 1 ? s.sectionGap : null}>
            <View style={s.sectionHeader}>
              <View style={[s.sectionBar, { backgroundColor: color }]} />
              <Text style={[s.sectionTitle, { color }]}>{section.title}</Text>
            </View>
            <View style={s.metricsRow}>
              {section.metrics.slice(0, 4).map((metric) => (
                <View
                  key={metric.label}
                  style={[s.metricPill, { backgroundColor: C.surface, borderColor: C.border }]}
                >
                  <Text style={[s.metricLabel, { color: C.textMuted }]}>{metric.label}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}

      {/* "More in Stats tab" hint */}
      {sections.length > 2 ? (
        <View style={[s.footer, { borderTopColor: C.border }]}>
          <Ionicons name="chevron-forward" size={11} color={C.textMuted} />
          <Text style={[s.footerText, { color: C.textMuted }]} numberOfLines={1}>
            {sections.slice(2).map((s2) => s2.title).join(' · ')} — see Stats tab
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  iconWrap: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.9, flex: 1 },
  badge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: FONTS.bold },
  sectionGap: { marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  sectionBar: { width: 3, height: 12, borderRadius: 2 },
  sectionTitle: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  metricPill: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 },
  metricLabel: { fontSize: 10, fontWeight: FONTS.semiBold },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  footerText: { fontSize: 10, flex: 1 },
});
