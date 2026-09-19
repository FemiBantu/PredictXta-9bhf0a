/**
 * app/subscription-management.tsx
 * Subscription Management screen — shows current VIP plan, expiry, days-remaining
 * progress bar, auto-renewal status, manage/cancel links, restore button,
 * and the last 10 purchase_audit_log entries with status badges.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth, getSupabaseClient, useAlert } from '@/template';
import { useIAP } from '@/hooks/useIAP';
import { useTheme } from '@/contexts/ThemeContext';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PurchaseRecord {
  id: string;
  product_id: string;
  platform: string;
  status: string;
  product_type: string;
  plan: string;
  is_restore: boolean;
  granted_at: string | null;
  created_at: string;
  error_message: string | null;
}

// ─── Status badge config ──────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  granted:              { label: 'Granted',     color: COLORS.accent,       icon: 'checkmark-circle' },
  verified:             { label: 'Verified',    color: COLORS.accent,       icon: 'checkmark-circle' },
  pending_verification: { label: 'Pending',     color: COLORS.accentAmber,  icon: 'time' },
  rejected:             { label: 'Rejected',    color: COLORS.accentRed,    icon: 'close-circle' },
  grant_failed:         { label: 'Failed',      color: COLORS.accentRed,    icon: 'alert-circle' },
  cancelled:            { label: 'Cancelled',   color: COLORS.textMuted,    icon: 'close-circle' },
  refunded:             { label: 'Refunded',    color: COLORS.accentOrange, icon: 'refresh-circle' },
  expired:              { label: 'Expired',     color: COLORS.textMuted,    icon: 'time-outline' },
};

const PLAN_DISPLAY: Record<string, string> = {
  monthly:     'Monthly VIP',
  biannual:    '6-Month VIP',
  yearly:      'Annual VIP',
  coins_500:   '500 Coins',
  coins_2500:  '2500 Coins',
  coins_5000:  '5000 Coins',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function daysRemaining(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function planTotalDays(plan: string | null): number {
  if (!plan) return 31;
  if (plan === 'yearly')   return 365;
  if (plan === 'biannual') return 183;
  return 31;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: COLORS.textMuted, icon: 'ellipse' };
  return (
    <View style={[badgeStyles.root, { backgroundColor: `${cfg.color}18`, borderColor: `${cfg.color}44` }]}>
      <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
      <Text style={[badgeStyles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  root: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  text: { fontSize: 11, fontWeight: FONTS.bold },
});

// ─── Purchase History Row ─────────────────────────────────────────────────────
function PurchaseRow({ record }: { record: PurchaseRecord }) {
  const platformIcon = record.platform === 'ios' ? 'logo-apple' : 'logo-google-playstore';
  const isConsumable = record.product_type === 'consumable';

  return (
    <View style={rowStyles.root}>
      <View style={[
        rowStyles.iconWrap,
        { backgroundColor: isConsumable ? 'rgba(255,215,0,0.12)' : 'rgba(110,220,31,0.12)' },
      ]}>
        <FontAwesome5
          name={isConsumable ? 'coins' : 'crown'}
          size={15}
          color={isConsumable ? COLORS.vip : COLORS.primary}
          solid
        />
      </View>

      <View style={rowStyles.info}>
        <Text style={rowStyles.planName} numberOfLines={1}>
          {PLAN_DISPLAY[record.plan] ?? record.product_id}
        </Text>
        <View style={rowStyles.metaRow}>
          <Ionicons name={platformIcon as any} size={11} color={COLORS.textMuted} />
          <Text style={rowStyles.date}>{formatDateTime(record.created_at)}</Text>
          {record.is_restore ? (
            <View style={rowStyles.restoreTag}>
              <Text style={rowStyles.restoreText}>RESTORE</Text>
            </View>
          ) : null}
        </View>
      </View>

      <StatusBadge status={record.status} />
    </View>
  );
}

const rowStyles = StyleSheet.create({
  root: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  info: { flex: 1, gap: 4 },
  planName: { fontSize: 13, fontWeight: FONTS.semiBold, color: COLORS.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  date: { fontSize: 11, color: COLORS.textMuted },
  restoreTag: {
    backgroundColor: 'rgba(78,205,196,0.15)', borderRadius: RADIUS.full,
    paddingHorizontal: 6, paddingVertical: 1,
    borderWidth: 1, borderColor: 'rgba(78,205,196,0.3)',
  },
  restoreText: { fontSize: 9, fontWeight: FONTS.extraBold, color: COLORS.accentBlue, letterSpacing: 0.8 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SubscriptionManagementScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const { colors: C } = useTheme();

  const {
    isVip,
    activePlan,
    vipExpiresAt,
    checkingVip,
    restorePurchases,
    refreshVipStatus,
    iapAvailable,
  } = useIAP();

  const [history, setHistory] = useState<PurchaseRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ─── Fetch purchase history ──────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    if (!user?.id) return;
    setLoadingHistory(true);
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('purchase_audit_log')
        .select('id, product_id, platform, status, product_type, plan, is_restore, granted_at, created_at, error_message')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      setHistory((data as PurchaseRecord[]) ?? []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshVipStatus(), fetchHistory()]);
    setRefreshing(false);
  }, [refreshVipStatus, fetchHistory]);

  // ─── Manage subscription links ────────────────────────────────────────────
  const openManageSubscription = useCallback(() => {
    if (Platform.OS === 'ios') {
      // Deep-links to the App Store subscriptions page
      Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => {
        Linking.openURL('itms-apps://apps.apple.com/account/subscriptions');
      });
    } else {
      // Deep-links to Google Play subscriptions for this app
      Linking.openURL(
        'https://play.google.com/store/account/subscriptions?sku=predictxta_vip_monthly&package=com.predictxta.sports',
      ).catch(() => {
        Linking.openURL('https://play.google.com/store/account/subscriptions');
      });
    }
  }, []);

  // ─── Restore ─────────────────────────────────────────────────────────────
  const handleRestore = useCallback(async () => {
    if (!iapAvailable) {
      showAlert(
        'Not Available',
        'Restore Purchases requires a release build from the App Store or Google Play.',
        [{ text: 'OK' }],
      );
      return;
    }
    setRestoring(true);
    try {
      await restorePurchases();
      await fetchHistory();
      showAlert('Restore Complete', 'Your purchases have been restored.', [{ text: 'OK' }]);
    } catch {
      showAlert('Restore Failed', 'Could not restore purchases. Please try again.', [{ text: 'OK' }]);
    } finally {
      setRestoring(false);
    }
  }, [restorePurchases, fetchHistory, iapAvailable, showAlert]);

  // ─── Derived values ───────────────────────────────────────────────────────
  const days     = daysRemaining(vipExpiresAt);
  const total    = planTotalDays(activePlan);
  const progress = isVip ? Math.min(1, Math.max(0, days / total)) : 0;

  const planDisplayName = activePlan ? (PLAN_DISPLAY[activePlan] ?? activePlan) : null;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: C.textPrimary }]}>Subscription</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          }
        >
          {/* ── VIP Status Card ────────────────────────────────────── */}
          {checkingVip ? (
            <View style={[styles.statusCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : isVip ? (
            <View style={[styles.statusCard, { backgroundColor: C.card, borderColor: 'rgba(255,215,0,0.35)' }]}>
              <LinearGradient
                colors={['rgba(255,215,0,0.08)', 'transparent']}
                style={StyleSheet.absoluteFill}
              />

              {/* Plan row */}
              <View style={styles.planRow}>
                <View style={styles.crownWrap}>
                  <FontAwesome5 name="crown" size={18} color={COLORS.vip} solid />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planLabel}>Active Plan</Text>
                  <Text style={styles.planName}>{planDisplayName ?? 'VIP'}</Text>
                </View>
                <View style={styles.activePill}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activeText}>ACTIVE</Text>
                </View>
              </View>

              {/* Expiry row */}
              <View style={[styles.infoRow, { borderColor: 'rgba(255,215,0,0.15)' }]}>
                <Ionicons name="calendar-outline" size={14} color={COLORS.vip} />
                <Text style={styles.infoLabel}>Expires</Text>
                <Text style={styles.infoValue}>{formatDate(vipExpiresAt)}</Text>
              </View>

              {/* Days remaining progress */}
              <View style={styles.progressSection}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressLabel}>{days} days remaining</Text>
                  <Text style={styles.progressPct}>{Math.round(progress * 100)}%</Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: C.border }]}>
                  <LinearGradient
                    colors={progress > 0.3 ? [COLORS.primary, COLORS.accent] : [COLORS.accentOrange, COLORS.accentRed]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.progressFill, { width: `${Math.max(2, progress * 100)}%` }]}
                  />
                </View>
                {days <= 7 ? (
                  <View style={styles.expiryWarning}>
                    <Ionicons name="warning-outline" size={12} color={COLORS.accentOrange} />
                    <Text style={styles.expiryWarningText}>
                      Expiring soon — renew to keep your benefits
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Auto-renewal row */}
              <View style={[styles.infoRow, { borderColor: 'rgba(255,215,0,0.15)' }]}>
                <MaterialIcons name="autorenew" size={14} color={COLORS.accentBlue} />
                <Text style={styles.infoLabel}>Auto-renewal</Text>
                <Text style={[styles.infoValue, { color: COLORS.accentBlue }]}>
                  Managed by {Platform.OS === 'ios' ? 'App Store' : 'Google Play'}
                </Text>
              </View>
            </View>
          ) : (
            /* ── No active plan ──────────────────────────────────── */
            <View style={[styles.statusCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={styles.noPlanRow}>
                <View style={[styles.crownWrap, { backgroundColor: `${C.border}88` }]}>
                  <FontAwesome5 name="crown" size={18} color={C.textMuted} solid />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: C.textSecondary }]}>No Active VIP Plan</Text>
                  <Text style={[styles.planLabel, { color: C.textMuted }]}>
                    Subscribe to unlock AI picks, expert tips, and more
                  </Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.upgradeBtn,
                  { backgroundColor: C.primary },
                  pressed ? { opacity: 0.85 } : null,
                ]}
                onPress={() => router.push('/vip' as any)}
              >
                <FontAwesome5 name="crown" size={13} color={COLORS.textInverse} solid />
                <Text style={styles.upgradeBtnText}>View VIP Plans</Text>
              </Pressable>
            </View>
          )}

          {/* ── Manage / Cancel Actions ────────────────────────────── */}
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>Manage Subscription</Text>

            {/* Manage on store */}
            <Pressable
              style={({ pressed }) => [
                styles.actionRow,
                { borderColor: C.border },
                pressed ? { opacity: 0.75 } : null,
              ]}
              onPress={openManageSubscription}
            >
              <View style={[styles.actionIcon, { backgroundColor: `${C.accentBlue}18` }]}>
                {Platform.OS === 'ios'
                  ? <Ionicons name="logo-apple" size={16} color={C.accentBlue} />
                  : <Ionicons name="logo-google-playstore" size={16} color={C.accentBlue} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionLabel, { color: C.textPrimary }]}>
                  {Platform.OS === 'ios' ? 'Manage in App Store' : 'Manage in Google Play'}
                </Text>
                <Text style={[styles.actionSub, { color: C.textMuted }]}>
                  Change or cancel your subscription
                </Text>
              </View>
              <Ionicons name="open-outline" size={16} color={C.textMuted} />
            </Pressable>

            {/* Cancel note */}
            <View style={[styles.cancelNote, { backgroundColor: `${C.accentRed}10`, borderColor: `${C.accentRed}22` }]}>
              <Ionicons name="information-circle-outline" size={14} color={C.accentRed} />
              <Text style={[styles.cancelNoteText, { color: C.textSecondary }]}>
                To cancel, tap the button above to open{' '}
                {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} subscription settings.
                Cancellations take effect at the end of the billing period.
              </Text>
            </View>
          </View>

          {/* ── Restore Purchases ─────────────────────────────────── */}
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>Restore Purchases</Text>

            <Pressable
              style={({ pressed }) => [
                styles.actionRow,
                { borderColor: C.border },
                (!iapAvailable || restoring) ? { opacity: 0.55 } : null,
                pressed && iapAvailable && !restoring ? { opacity: 0.75 } : null,
              ]}
              onPress={handleRestore}
              disabled={restoring}
            >
              <View style={[styles.actionIcon, { backgroundColor: `${C.primary}18` }]}>
                {restoring
                  ? <ActivityIndicator size="small" color={C.primary} />
                  : <Ionicons name="refresh" size={16} color={C.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionLabel, { color: C.textPrimary }]}>
                  {restoring ? 'Restoring…' : 'Restore Purchases'}
                </Text>
                <Text style={[styles.actionSub, { color: C.textMuted }]}>
                  {iapAvailable
                    ? 'Re-verify and restore your previous purchases'
                    : 'Available in App Store / Google Play release builds'}
                </Text>
              </View>
              {!restoring ? (
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              ) : null}
            </Pressable>
          </View>

          {/* ── Purchase History ──────────────────────────────────── */}
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>Purchase History</Text>
              {loadingHistory ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <Text style={[styles.sectionCount, { color: C.textMuted }]}>
                  {history.length} records
                </Text>
              )}
            </View>

            {!loadingHistory && history.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Ionicons name="receipt-outline" size={32} color={C.border} />
                <Text style={[styles.emptyText, { color: C.textMuted }]}>No purchase records yet</Text>
              </View>
            ) : (
              <View style={styles.historyList}>
                {history.map((record) => (
                  <PurchaseRow key={record.id} record={record} />
                ))}
              </View>
            )}

            {/* Legal note */}
            <Text style={[styles.legalNote, { color: C.textMuted }]}>
              All purchases are processed by{' '}
              {Platform.OS === 'ios' ? 'Apple' : 'Google'}. For billing questions, contact{' '}
              {Platform.OS === 'ios' ? 'Apple Support' : 'Google Play Support'}.
            </Text>
          </View>

          {/* ── Upgrade prompt for free users ─────────────────────── */}
          {!isVip && !checkingVip ? (
            <Pressable
              style={({ pressed }) => [
                styles.upgradeCard,
                { borderColor: 'rgba(110,220,31,0.35)', backgroundColor: `${C.primary}08` },
                pressed ? { opacity: 0.85 } : null,
              ]}
              onPress={() => router.push('/vip' as any)}
            >
              <LinearGradient
                colors={[`${C.primary}10`, 'transparent']}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.upgradeCardLeft}>
                <View style={[styles.crownWrap, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}>
                  <FontAwesome5 name="crown" size={18} color={C.primary} solid />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.upgradeCardTitle, { color: C.textPrimary }]}>
                    Unlock VIP Benefits
                  </Text>
                  <Text style={[styles.upgradeCardSub, { color: C.textMuted }]}>
                    Unlimited AI picks, expert tips, no ads
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.primary} />
            </Pressable>
          ) : null}

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold },

  scroll: { padding: SPACING.md, gap: 14 },

  // VIP status card
  statusCard: {
    borderRadius: RADIUS.xl, borderWidth: 1,
    padding: SPACING.md, gap: 14, overflow: 'hidden',
  },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  crownWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(255,215,0,0.15)',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  planLabel: { fontSize: 11, color: 'rgba(255,215,0,0.6)', fontWeight: FONTS.medium, marginBottom: 2 },
  planName: { fontSize: 18, fontWeight: FONTS.extraBold, color: COLORS.vip },
  activePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,255,135,0.12)', borderRadius: RADIUS.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(0,255,135,0.3)',
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accent },
  activeText: { fontSize: 9, fontWeight: FONTS.extraBold, color: COLORS.accent, letterSpacing: 1 },

  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderTopWidth: 1,
  },
  infoLabel: { flex: 1, fontSize: 13, color: COLORS.textSecondary },
  infoValue: { fontSize: 13, fontWeight: FONTS.semiBold, color: COLORS.textPrimary },

  // Progress bar
  progressSection: { gap: 7 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressLabel: { fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  progressPct: { fontSize: 12, color: COLORS.textMuted },
  progressTrack: {
    height: 7, borderRadius: RADIUS.full, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', borderRadius: RADIUS.full,
  },
  expiryWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2,
  },
  expiryWarningText: {
    fontSize: 11, color: COLORS.accentOrange, fontWeight: FONTS.medium,
  },

  // No plan state
  noPlanRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, paddingVertical: 13,
    marginTop: 4,
  },
  upgradeBtnText: { fontSize: 15, fontWeight: FONTS.bold, color: COLORS.textInverse },

  // Sections
  section: {
    borderRadius: RADIUS.xl, borderWidth: 1,
    padding: SPACING.md, gap: 12,
  },
  sectionTitle: { fontSize: 13, fontWeight: FONTS.semiBold, letterSpacing: 0.3 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionCount: { fontSize: 12 },

  // Action rows
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 4,
  },
  actionIcon: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  actionLabel: { fontSize: 14, fontWeight: FONTS.semiBold },
  actionSub: { fontSize: 11, marginTop: 2, lineHeight: 16 },

  // Cancel note
  cancelNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: RADIUS.md, borderWidth: 1, padding: 11,
  },
  cancelNoteText: { flex: 1, fontSize: 12, lineHeight: 18 },

  // Purchase history
  historyList: { gap: 0 },
  emptyHistory: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { fontSize: 13 },
  legalNote: { fontSize: 11, lineHeight: 17, marginTop: 4 },

  // Upgrade card
  upgradeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RADIUS.xl, borderWidth: 1,
    padding: SPACING.md, overflow: 'hidden',
  },
  upgradeCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  upgradeCardTitle: { fontSize: 15, fontWeight: FONTS.bold },
  upgradeCardSub: { fontSize: 12, marginTop: 2 },
});
