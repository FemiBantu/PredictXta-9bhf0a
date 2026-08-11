import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
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
  { number: '1', title: 'Eligibility', content: ['You must be at least eighteen (18) years old, or the legal age required in your jurisdiction, whichever is higher, to use PredictXta.', 'By using the Services, you confirm that:', '• You are legally permitted to access sports-related analytical content in your jurisdiction;', '• You are not prohibited by applicable laws from using the Services;', '• All information you provide is accurate and current.', 'PredictXta reserves the right to suspend or terminate accounts found to be operated by underage users or users violating applicable laws.'] },
  { number: '2', title: 'Nature of the Services', content: ['PredictXta provides:', '• AI-powered sports predictions;', '• Match analysis and statistics;', '• VIP prediction content;', '• Premium subscription plans;', '• Coin-based digital access systems;', '• Sports insights, probability models, and analytical tools.', 'All predictions, scores, tips, probabilities, and recommendations are estimates based on statistical analysis and historical data.', 'No prediction, VIP content, or analytical model is guaranteed to succeed or produce profit. Sports outcomes are inherently unpredictable.', 'PredictXta does not: accept bets or wagers; hold gambling funds; facilitate betting transactions; operate betting markets; guarantee winnings or financial returns.'] },
  { number: '3', title: 'Informational and Entertainment Purposes Only', content: ['All content provided through PredictXta is for informational, educational, and entertainment purposes only.', 'Nothing within the Services constitutes: financial advice; investment advice; gambling advice; legal advice; or professional consulting services.', 'You acknowledge that any decisions you make based on information provided by PredictXta are made solely at your own risk.'] },
  { number: '4', title: 'User Accounts', content: ['To access certain features, you may be required to create an account.', 'You agree to:', '• Provide accurate registration information;', '• Maintain the confidentiality of your login credentials;', '• Accept responsibility for activities occurring under your account;', '• Notify PredictXta immediately of unauthorized access or security breaches.', 'PredictXta may suspend, restrict, or terminate accounts that violate these Terms, engage in fraud or abuse, attempt unauthorized access, use bots or automation tools, or manipulate subscription or coin systems.'] },
  { number: '5', title: 'Subscription Plans', content: ['PredictXta may offer free and paid subscription plans, including VIP access plans.', 'By purchasing a subscription:', '• You authorize recurring billing where applicable;', '• You agree to the pricing displayed at the time of purchase;', '• You understand subscription features may change over time;', '• You acknowledge that access may begin immediately after payment confirmation.', 'Subscriptions automatically renew unless canceled before the renewal date. Users are responsible for managing subscription cancellations through the relevant app store, payment provider, or platform account.', 'PredictXta reserves the right to modify subscription pricing, duration, benefits, or availability at any time with reasonable notice.'] },
  { number: '6', title: 'Coin System and Virtual Items', content: ['PredictXta may offer virtual coins, credits, points, or digital tokens ("Coins") for accessing premium features or VIP content.', 'You acknowledge and agree that:', '• Coins are digital access tools only;', '• Coins have no cash value;', '• Coins are non-transferable and non-refundable except where required by law;', '• Coins cannot be exchanged for real money, cryptocurrency, securities, or tangible assets;', '• PredictXta may modify, remove, or expire Coins at its discretion.', 'Any attempt to sell, trade, exploit, duplicate, or manipulate Coins may result in immediate account termination.'] },
  { number: '7', title: 'Payment Terms', content: ['Payments may be processed through third-party payment providers including app stores, payment gateways, or financial service providers.', 'PredictXta does not store complete payment card details on its own servers unless explicitly stated in a separate privacy or payment policy.', 'You agree that:', '• All purchases are final once digital content is accessed;', '• Failed or reversed payments may result in suspension of access;', '• Taxes, currency conversion fees, and local charges may apply depending on your location.', 'Where required by law, refunds may be considered in accordance with applicable consumer protection regulations.'] },
  { number: '8', title: 'Refund Policy', content: ['Due to the instant-access nature of digital services and prediction content, the following are generally non-refundable:', '• Subscription fees;', '• VIP access purchases;', '• Coin purchases;', '• Digital content unlocks.', 'However, PredictXta may provide refunds in limited situations including: duplicate charges; technical billing errors; unauthorized transactions verified by investigation; mandatory consumer rights under applicable law.', "Refund decisions remain at PredictXta's reasonable discretion."] },
  { number: '9', title: 'Responsible Gambling Notice', content: ['PredictXta encourages responsible behavior regarding sports betting and gaming activities.', 'You acknowledge that:', '• Betting carries financial risk;', '• Predictions can fail;', '• Past performance does not guarantee future outcomes.', 'If you choose to engage with third-party betting platforms, you do so entirely at your own risk and responsibility.', 'PredictXta does not encourage excessive gambling or irresponsible financial behavior. Users experiencing gambling-related problems are encouraged to seek professional assistance.'] },
  { number: '10', title: 'Restricted Jurisdictions', content: ['Access to PredictXta may not be legal in all countries or territories. You are solely responsible for ensuring that your use of PredictXta complies with local laws and regulations.', 'PredictXta reserves the right to:', '• Restrict access in certain jurisdictions;', '• Block accounts based on regulatory requirements;', '• Refuse services where prohibited by law.'] },
  { number: '11', title: 'Intellectual Property', content: ['All trademarks, branding, graphics, algorithms, designs, interfaces, software, databases, prediction models, and content within PredictXta are owned by or licensed to PredictXta.', 'You may not:', '• Copy or reproduce content;', '• Reverse engineer systems;', '• Redistribute predictions commercially;', '• Resell subscription access;', '• Use PredictXta branding without written permission.', 'Unauthorized use may result in legal action.'] },
  { number: '12', title: 'Third-Party Services and Links', content: ['PredictXta may integrate or reference third-party sports data providers, payment processors, analytics tools, external websites, and advertising networks.', 'PredictXta is not responsible for third-party content, services, privacy practices, outages, or losses arising from third-party platforms.', 'Your use of third-party services is governed by their own terms and policies.'] },
  { number: '13', title: 'Data Accuracy and Availability', content: ['While PredictXta aims to provide reliable and timely information:', '• We do not guarantee uninterrupted availability;', '• We do not guarantee accuracy or completeness;', '• Match data, odds, statistics, and predictions may contain delays or errors.', 'Services may be temporarily unavailable due to maintenance, technical issues, force majeure events, or third-party outages.'] },
  { number: '14', title: 'Prohibited Conduct', content: ['You agree not to:', '• Use PredictXta for unlawful purposes;', '• Exploit vulnerabilities or security weaknesses;', '• Interfere with servers or infrastructure;', '• Share VIP content publicly;', '• Abuse referral systems or promotions;', '• Use automated bots or scraping software;', '• Impersonate others.', 'Violations may result in suspension, legal action, or permanent bans.'] },
  { number: '15', title: 'Limitation of Liability', content: ['To the maximum extent permitted by law, PredictXta and its owners, employees, partners, affiliates, and licensors shall not be liable for:', '• Financial losses;', '• Betting losses;', '• Lost profits;', '• Data loss;', '• Indirect or consequential damages;', '• Service interruptions;', '• Reliance on predictions or analytical content.', 'Your use of PredictXta is entirely at your own risk.'] },
  { number: '16', title: 'Indemnification', content: ['You agree to indemnify and hold harmless PredictXta from claims, liabilities, damages, losses, and expenses arising from:', '• Your misuse of the Services;', '• Your violation of these Terms;', '• Your breach of applicable laws;', '• Your infringement of third-party rights.'] },
  { number: '17', title: 'Termination', content: ['PredictXta reserves the right to suspend or terminate access to the Services at any time, with or without notice, for violations of these Terms or for operational, security, or legal reasons.', 'Termination does not waive outstanding obligations or liabilities.'] },
  { number: '18', title: 'Privacy', content: ['Your use of PredictXta is also governed by the PredictXta Privacy Policy.', 'By using the Services, you consent to the collection and processing of data in accordance with the Privacy Policy and applicable data protection laws.'] },
  { number: '19', title: 'Changes to These Terms', content: ['PredictXta may modify these Terms periodically.', 'Updated Terms become effective upon posting within the app or website. Continued use of the Services after updates constitutes acceptance of the revised Terms.'] },
  { number: '20', title: 'Governing Law', content: ['These Terms shall be governed by and interpreted in accordance with the laws of the jurisdiction in which PredictXta is legally registered, without regard to conflict of law principles.', 'Any disputes arising from these Terms shall be resolved through competent courts or legally recognized dispute resolution mechanisms in the applicable jurisdiction.'] },
  { number: '21', title: 'Contact Information', content: ['For questions, complaints, legal notices, or support inquiries, contact:', 'PredictXta Support Team', 'Email: support@predictxta.com', 'Website: predictxta.com'] },
];

// ─── Translatable Section Card ────────────────────────────────────────────────
function SectionCard({ section, colors: C }: { section: Section; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();
  const [displayTitle, setDisplayTitle] = useState(section.title);
  const [displayContent, setDisplayContent] = useState(section.content);
  const [translating, setTranslating] = useState(false);
  const translatedKeyRef = useRef('');

  useEffect(() => {
    const key = `terms-${section.number}::${language}`;
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
        <View style={[s.sectionNum, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.3)' }]}>
          <Text style={[s.sectionNumText, { color: C.primary }]}>{section.number}</Text>
        </View>
        <Text style={[s.sectionTitle, { color: C.textPrimary }]}>{displayTitle}</Text>
        {translating && expanded ? <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 4 }} /> : null}
        <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={C.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={[s.sectionBody, { borderTopColor: C.border }]}>
          {displayContent.map((line, idx) => (
            <Text key={idx} style={[s.sectionBodyText, { color: C.textSecondary }, line.startsWith('•') ? s.bulletText : null]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function TermsScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { t } = useLocale();
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();

  const [introLines, setIntroLines] = useState([
    'Welcome to PredictXta. These Terms and Conditions govern your access to and use of the PredictXta mobile application, website, APIs, content, subscriptions, virtual coin services, and related features (collectively, the "Services").',
    'By creating an account, accessing, downloading, subscribing to, or using PredictXta, you agree to be legally bound by these Terms. If you do not agree, you must discontinue use of the Services immediately.',
    'PredictXta is a sports analytics and prediction platform designed for informational and entertainment purposes only. PredictXta is not a sportsbook, bookmaker, casino, gambling operator, financial advisor, or betting intermediary.',
  ]);
  const [disclaimerText, setDisclaimerText] = useState('PredictXta provides sports analytics and prediction content only. We do not operate gambling services or guarantee outcomes, winnings, or profits. Users are solely responsible for any decisions made using information provided through the Services.');
  const translatedKeyRef = useRef('');

  const ORIGINAL_INTRO = [
    'Welcome to PredictXta. These Terms and Conditions govern your access to and use of the PredictXta mobile application, website, APIs, content, subscriptions, virtual coin services, and related features (collectively, the "Services").',
    'By creating an account, accessing, downloading, subscribing to, or using PredictXta, you agree to be legally bound by these Terms. If you do not agree, you must discontinue use of the Services immediately.',
    'PredictXta is a sports analytics and prediction platform designed for informational and entertainment purposes only. PredictXta is not a sportsbook, bookmaker, casino, gambling operator, financial advisor, or betting intermediary.',
  ];
  const ORIGINAL_DISCLAIMER = 'PredictXta provides sports analytics and prediction content only. We do not operate gambling services or guarantee outcomes, winnings, or profits. Users are solely responsible for any decisions made using information provided through the Services.';

  useEffect(() => {
    const key = `terms-intro::${language}`;
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
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>{t('settings.terms')}</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        <LinearGradient colors={[C.cardHighlight, C.card] as [string, string]} style={[s.heroBanner, { borderColor: C.border }]}>
          <View style={[s.heroIconWrap, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.3)' }]}>
            <Ionicons name="document-text" size={28} color={C.primary} />
          </View>
          <Text style={[s.heroTitle, { color: C.textPrimary }]}>PredictXta</Text>
          <Text style={[s.heroSubtitle, { color: C.primary }]}>{t('settings.terms')}</Text>
          <Text style={[s.heroDate, { color: C.textMuted }]}>{t('legalScreen.effectiveMay2025')}</Text>
        </LinearGradient>

        <View style={[s.introCard, { backgroundColor: C.card, borderColor: C.border }]}>
          {introLines.map((line, i) => (
            <Text key={i} style={[s.introText, { color: C.textSecondary, marginTop: i > 0 ? 10 : 0 }]}>{line}</Text>
          ))}
        </View>

        <View style={s.sectionList}>
          {SECTIONS.map((sec) => <SectionCard key={sec.number} section={sec} colors={C} />)}
        </View>

        <View style={[s.disclaimerCard, { backgroundColor: 'rgba(255,215,0,0.06)', borderColor: 'rgba(255,215,0,0.25)' }]}>
          <View style={s.disclaimerHeader}>
            <Ionicons name="warning-outline" size={18} color={C.primary} />
            <Text style={[s.disclaimerTitle, { color: C.primary }]}>{t('legalScreen.importantDisclaimer')}</Text>
          </View>
          <Text style={[s.disclaimerText, { color: C.textSecondary }]}>{disclaimerText}</Text>
        </View>

        <View style={[s.contactCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Ionicons name="mail-outline" size={18} color={C.accentBlue} />
          <View style={{ flex: 1 }}>
            <Text style={[s.contactLabel, { color: C.textMuted }]}>{t('legalScreen.questionsInquiries')}</Text>
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
  introCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.md, marginBottom: SPACING.md },
  introText: { fontSize: 14, lineHeight: 22 },
  sectionList: { gap: 8, marginBottom: SPACING.md },
  sectionCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  sectionNum: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sectionNumText: { fontSize: 13, fontWeight: FONTS.extraBold },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: FONTS.semiBold },
  sectionBody: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 12, borderTopWidth: 1, gap: 8 },
  sectionBodyText: { fontSize: 14, lineHeight: 22 },
  bulletText: { paddingLeft: 4 },
  disclaimerCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.md, marginBottom: SPACING.md, gap: 10 },
  disclaimerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  disclaimerTitle: { fontSize: 15, fontWeight: FONTS.bold },
  disclaimerText: { fontSize: 14, lineHeight: 22 },
  contactCard: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.md, gap: 12, marginBottom: SPACING.md },
  contactLabel: { fontSize: 12, marginBottom: 2 },
  contactEmail: { fontSize: 14, fontWeight: FONTS.semiBold },
});
