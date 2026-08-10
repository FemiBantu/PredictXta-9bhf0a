import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, Share } from 'react-native';
import { PRIVACY_POLICY_URL } from './privacy-web';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useTranslatedContent } from '@/hooks/useTranslatedContent';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLocale } from '@/hooks/useLocale';

interface Section { number: string; title: string; content: string[]; }

const SECTIONS: Section[] = [
  { number: '1', title: 'Data Controller', content: ['PredictXta is the Data Controller responsible for your personal data.', 'Contact Email: support@predictxta.com', 'If required, a formal Data Protection Officer (DPO) may be appointed as we scale into EU data processing.'] },
  { number: '2', title: 'Personal Data We Collect', content: ['a. Information You Provide:', '• Name or username', '• Email address', '• Password (encrypted)', '• Preferences (teams, leagues, settings)', '• Customer support communications', '', 'b. Automatically Collected Data:', '• Device information (model, OS, device ID)', '• IP address and approximate location', '• Usage data (app interactions, features used)', '• Log files and crash reports', '', 'c. Payment Data:', 'Processed via third parties (e.g., Google Play, Apple, payment gateways). We do not store sensitive financial data such as card numbers or CVV. We may receive transaction ID, subscription status, and payment confirmation.'] },
  { number: '3', title: 'Legal Basis for Processing (GDPR Article 6)', content: ['a. Contractual Necessity — To create and manage your account, deliver predictions and app features, provide subscriptions and coin services.', 'b. Legitimate Interests — To improve app performance and user experience, prevent fraud and abuse, and secure our platform.', 'c. Consent — For marketing communications and optional analytics tracking (where required). You may withdraw consent at any time.', 'd. Legal Obligation — To comply with regulatory requirements and law enforcement requests.'] },
  { number: '4', title: 'Purpose of Data Processing', content: ['We use your data to:', '• Operate and maintain the Services', '• Provide AI-driven sports predictions', '• Manage subscriptions and virtual coins', '• Personalize user experience', '• Communicate updates and support responses', '• Detect fraud or unauthorized use', '', 'We do not sell your personal data.'] },
  { number: '5', title: 'Data Sharing and Disclosure', content: ['a. Service Providers (Processors):', '• Cloud hosting providers', '• Analytics providers', '• Payment processors', '• Customer support tools', 'All processors are bound by data processing agreements.', '', 'b. Legal Authorities — Where required by law or to protect rights and safety.', '', 'c. Business Transfers — In case of merger, acquisition, or restructuring.'] },
  { number: '6', title: 'International Data Transfers', content: ['Your data may be transferred outside the European Economic Area (EEA) or Nigeria.', 'We ensure safeguards such as:', '• Standard Contractual Clauses (SCCs)', '• NDPR-compliant transfer mechanisms', '• Secure contractual agreements'] },
  { number: '7', title: 'Data Retention', content: ['We retain personal data only as long as necessary to:', '• Fulfill contractual obligations', '• Comply with legal requirements', '• Resolve disputes', '', 'When no longer needed, data is deleted securely or anonymized.'] },
  { number: '8', title: 'Your Data Protection Rights', content: ['Under GDPR and NDPR, you have the right to:', '• Access your personal data', '• Rectify inaccurate data', '• Erase your data ("right to be forgotten")', '• Restrict processing', '• Object to processing', '• Data portability', '• Withdraw consent at any time', '', 'To exercise your rights, email: support@predictxta.com', 'We will respond within 30 days (GDPR standard) or as required under NDPR.'] },
  { number: '9', title: 'Account and Data Deletion', content: ['You may request account deletion or removal of personal data via:', '• In-app request (Settings → Delete Account)', '• Email request to support@predictxta.com', '', 'We will delete or anonymize your data and retain only what is legally required.'] },
  { number: '10', title: 'Data Security', content: ['We implement appropriate technical and organizational measures:', '• Encryption (data in transit and at rest)', '• Secure servers and restricted access controls', '• Continuous monitoring and breach detection', '', 'In case of a data breach, we will notify relevant authorities within 72 hours (GDPR) and inform affected users if required.'] },
  { number: '11', title: 'Cookies and Tracking', content: ['We use app analytics tools and device-level identifiers for:', '• Performance monitoring', '• Feature improvement', '', 'Where required, we request user consent before tracking.'] },
  { number: '12', title: "Children's Data", content: ['PredictXta does not knowingly collect data from individuals under 18.', 'If such data is identified, it will be deleted immediately.', 'If you believe a child has provided us personal data, contact support@predictxta.com.'] },
  { number: '13', title: 'Complaints and Regulatory Rights', content: ['EU Users: You may lodge a complaint with your local Data Protection Authority (DPA).', '', 'Nigeria Users: You may contact the Nigeria Data Protection Commission (NDPC).', '', 'We encourage you to contact us first at support@predictxta.com so we can resolve any concerns directly.'] },
  { number: '14', title: 'Changes to This Policy', content: ['We may update this Privacy Policy periodically.', 'Updates will be posted within the app or website and become effective upon publication.', 'Continued use of the Services after updates constitutes acceptance of the revised Policy.'] },
  { number: '15', title: 'Contact Information', content: ['PredictXta Support Team', 'Email: support@predictxta.com', 'Website: predictxta.com'] },
];

// ─── Translatable Section Card ─────────────────────────────────────────────────
function SectionCard({ section, colors: C }: { section: Section; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();
  const [displayTitle, setDisplayTitle] = useState(section.title);
  const [displayContent, setDisplayContent] = useState(section.content);
  const [translating, setTranslating] = useState(false);
  const translatedKeyRef = useRef('');

  useEffect(() => {
    const key = `privacy-${section.number}::${language}`;
    if (!needsTranslation || translatedKeyRef.current === key) return;
    translatedKeyRef.current = key;
    setTranslating(true);
    Promise.all([
      translate(section.title, 'general'),
      ...section.content.filter((l) => l.trim()).map((l) => translate(l, 'general')),
    ]).then((results) => {
      setDisplayTitle(results[0]);
      const contentResults = results.slice(1);
      let resultIdx = 0;
      setDisplayContent(section.content.map((l) => l.trim() ? contentResults[resultIdx++] ?? l : l));
    }).catch(() => {}).finally(() => setTranslating(false));
  }, [section.number, language, needsTranslation]);

  useEffect(() => {
    if (!needsTranslation) {
      setDisplayTitle(section.title);
      setDisplayContent(section.content);
    }
  }, [needsTranslation, section.title, section.content]);

  return (
    <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable
        style={({ pressed }) => [s.sectionHeader, pressed ? { backgroundColor: C.cardHighlight } : null]}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={[s.sectionNum, { backgroundColor: `${C.accentBlue}18`, borderColor: `${C.accentBlue}44` }]}>
          <Text style={[s.sectionNumText, { color: C.accentBlue }]}>{section.number}</Text>
        </View>
        <Text style={[s.sectionTitle, { color: C.textPrimary }]}>{displayTitle}</Text>
        {translating && expanded ? <ActivityIndicator size="small" color={C.accentBlue} style={{ marginRight: 4 }} /> : null}
        <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={C.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={[s.sectionBody, { borderTopColor: C.border }]}>
          {displayContent.map((line, idx) =>
            line === '' ? (
              <View key={idx} style={{ height: 6 }} />
            ) : (
              <Text key={idx} style={[s.sectionBodyText, { color: C.textSecondary }, line.startsWith('•') ? s.bulletText : null, (line.endsWith(':') || /^[a-d]\./.test(line)) ? { color: C.textPrimary, fontWeight: FONTS.semiBold } : null]}>
                {line}
              </Text>
            )
          )}
        </View>
      ) : null}
    </View>
  );
}

function ComplianceBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[s.compBadge, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
      <Ionicons name="shield-checkmark" size={10} color={color} />
      <Text style={[s.compBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

export default function PrivacyScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { t } = useLocale();
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();

  const ORIGINAL_INTRO = [
    'PredictXta is committed to protecting your personal data in compliance with the General Data Protection Regulation (GDPR) and the Nigeria Data Protection Regulation (NDPR).',
    'This Privacy Policy explains how we collect, use, disclose, and protect your personal data when you use the PredictXta mobile application and related services.',
    'By using PredictXta, you consent to the practices described in this Policy.',
  ];
  const ORIGINAL_DISCLAIMER = 'PredictXta provides sports predictions and analytics for informational and entertainment purposes only. We do not operate gambling services, process bets, or guarantee outcomes or profits.';

  const [introLines, setIntroLines] = useState(ORIGINAL_INTRO);
  const [disclaimerText, setDisclaimerText] = useState(ORIGINAL_DISCLAIMER);
  const translatedKeyRef = useRef('');

  useEffect(() => {
    const key = `privacy-intro::${language}`;
    if (!needsTranslation) {
      setIntroLines(ORIGINAL_INTRO);
      setDisclaimerText(ORIGINAL_DISCLAIMER);
      return;
    }
    if (translatedKeyRef.current === key) return;
    translatedKeyRef.current = key;
    Promise.all([
      ...ORIGINAL_INTRO.map((l) => translate(l, 'general')),
      translate(ORIGINAL_DISCLAIMER, 'general'),
    ]).then((results) => {
      setIntroLines(results.slice(0, 3));
      setDisclaimerText(results[3]);
    }).catch(() => {});
  }, [language, needsTranslation]);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { borderBottomColor: C.border, backgroundColor: C.surface }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>{t('settings.privacy')}</Text>
          <Pressable
            onPress={() => router.push('/privacy-web' as any)}
            style={[s.viewOnlineBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}
            hitSlop={6}
          >
            <Ionicons name="open-outline" size={14} color={C.primary} />
            <Text style={[s.viewOnlineText, { color: C.primary }]}>Online</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Play Store compliance banner */}
        <Pressable
          style={[s.playStoreBanner, { backgroundColor: `${C.accentBlue}0E`, borderColor: `${C.accentBlue}33` }]}
          onPress={() => router.push('/privacy-web' as any)}
        >
          <View style={s.playStoreBannerLeft}>
            <Ionicons name="logo-google-playstore" size={16} color={C.accentBlue} />
            <View style={{ flex: 1 }}>
              <Text style={[s.playStoreBannerTitle, { color: C.textPrimary }]}>Play Store Data Safety</Text>
              <Text style={[s.playStoreBannerSub, { color: C.textMuted }]} numberOfLines={1}>{PRIVACY_POLICY_URL}</Text>
            </View>
          </View>
          <View style={s.playStoreBannerActions}>
            <Pressable
              style={[s.playStorePill, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}
              onPress={() => router.push('/privacy-web' as any)}
              hitSlop={8}
            >
              <Ionicons name="eye-outline" size={11} color={C.primary} />
              <Text style={[s.playStorePillText, { color: C.primary }]}>View Online</Text>
            </Pressable>
            <Pressable
              style={[s.playStorePill, { backgroundColor: C.card, borderColor: C.border }]}
              onPress={() => Share.share({ message: `PredictXta Privacy Policy — ${PRIVACY_POLICY_URL}`, url: PRIVACY_POLICY_URL }).catch(() => {})}
              hitSlop={8}
            >
              <Ionicons name="share-outline" size={11} color={C.textMuted} />
              <Text style={[s.playStorePillText, { color: C.textMuted }]}>Share</Text>
            </Pressable>
            <Pressable
              style={[s.playStorePill, { backgroundColor: C.card, borderColor: C.border }]}
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})}
              hitSlop={8}
            >
              <Ionicons name="open-outline" size={11} color={C.textMuted} />
              <Text style={[s.playStorePillText, { color: C.textMuted }]}>Browser</Text>
            </Pressable>
          </View>
        </Pressable>

        <LinearGradient colors={[`${C.accentBlue}18`, C.card] as [string, string]} style={[s.heroBanner, { borderColor: `${C.accentBlue}33` }]}>
          <View style={[s.heroIconWrap, { backgroundColor: `${C.accentBlue}18`, borderColor: `${C.accentBlue}44` }]}>
            <Ionicons name="shield-checkmark" size={28} color={C.accentBlue} />
          </View>
          <Text style={[s.heroTitle, { color: C.textPrimary }]}>PredictXta</Text>
          <Text style={[s.heroSubtitle, { color: C.accentBlue }]}>{t('settings.privacy')}</Text>
          <Text style={[s.heroDate, { color: C.textMuted }]}>{t('legalScreen.effectiveMay2026')}</Text>
          <View style={s.badgeRow}>
            <ComplianceBadge label="GDPR Compliant" color={C.accentBlue} />
            <ComplianceBadge label="NDPR Compliant" color={C.accent} />
          </View>
        </LinearGradient>

        <View style={[s.introCard, { backgroundColor: C.card, borderColor: C.border }]}>
          {introLines.map((line, i) => (
            <Text key={i} style={[s.introText, { color: C.textSecondary, marginTop: i > 0 ? 10 : 0 }]}>{line}</Text>
          ))}
        </View>

        <View style={s.sectionList}>
          {SECTIONS.map((sec) => <SectionCard key={sec.number} section={sec} colors={C} />)}
        </View>

        <View style={[s.disclaimerCard, { backgroundColor: `${C.accentBlue}0A`, borderColor: `${C.accentBlue}33` }]}>
          <View style={s.disclaimerHeader}>
            <Ionicons name="information-circle" size={18} color={C.accentBlue} />
            <Text style={[s.disclaimerTitle, { color: C.accentBlue }]}>{t('legalScreen.importantDisclaimer')}</Text>
          </View>
          <Text style={[s.disclaimerText, { color: C.textSecondary }]}>{disclaimerText}</Text>
        </View>

        <View style={[s.contactCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Ionicons name="mail-outline" size={18} color={C.accentBlue} />
          <View style={{ flex: 1 }}>
            <Text style={[s.contactLabel, { color: C.textMuted }]}>{t('legalScreen.privacyInquiries')}</Text>
            <Text style={[s.contactEmail, { color: C.accentBlue }]}>support@predictxta.com</Text>
          </View>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: FONTS.bold },
  scroll: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  heroBanner: { borderRadius: RADIUS.xl, borderWidth: 1, alignItems: 'center', paddingVertical: 28, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md, gap: 6 },
  heroIconWrap: { width: 60, height: 60, borderRadius: 30, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  heroTitle: { fontSize: 22, fontWeight: FONTS.extraBold },
  heroSubtitle: { fontSize: 14, fontWeight: FONTS.semiBold },
  heroDate: { fontSize: 12, marginTop: 4 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  compBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1 },
  compBadgeText: { fontSize: 11, fontWeight: FONTS.semiBold },
  introCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.md, marginBottom: SPACING.md },
  introText: { fontSize: 14, lineHeight: 22 },
  sectionList: { gap: 8, marginBottom: SPACING.md },
  sectionCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  sectionNum: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sectionNumText: { fontSize: 13, fontWeight: FONTS.extraBold },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: FONTS.semiBold },
  sectionBody: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 12, borderTopWidth: 1, gap: 6 },
  sectionBodyText: { fontSize: 14, lineHeight: 22 },
  bulletText: { paddingLeft: 4 },
  disclaimerCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.md, marginBottom: SPACING.md, gap: 10 },
  disclaimerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  disclaimerTitle: { fontSize: 15, fontWeight: FONTS.bold },
  disclaimerText: { fontSize: 14, lineHeight: 22 },
  contactCard: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.md, gap: 12, marginBottom: SPACING.md },
  contactLabel: { fontSize: 12, marginBottom: 2 },
  contactEmail: { fontSize: 14, fontWeight: FONTS.semiBold },
  viewOnlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  viewOnlineText: { fontSize: 11, fontWeight: FONTS.bold },
  playStoreBanner: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, marginBottom: SPACING.md, gap: 10 },
  playStoreBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playStoreBannerTitle: { fontSize: 13, fontWeight: FONTS.bold },
  playStoreBannerSub: { fontSize: 10, marginTop: 1 },
  playStoreBannerActions: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  playStorePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  playStorePillText: { fontSize: 11, fontWeight: FONTS.semiBold },
});
