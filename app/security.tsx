/**
 * Security Dashboard — app/security.tsx
 *
 * Displays:
 *  - Active device sessions (revoke individually / revoke all)
 *  - Security audit log (last 20 events)
 *  - Security settings (login alerts)
 *  - Account security score
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth, getSupabaseClient } from '@/template';
import { useAlert } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import {
  fetchUserSessions,
  fetchAuditLog,
  revokeSession,
  revokeAllOtherSessions,
  logSecurityEvent,
  formatRelativeTime,
  getEventIcon,
  getEventLabel,
  clearSessionToken,
} from '@/services/authSecurityService';
import type { DeviceSession, AuditLogEntry } from '@/services/authSecurityService';

// ─── Security Score ───────────────────────────────────────────────────────────
interface SecurityFactor {
  label: string;
  met: boolean;
  points: number;
}

function computeSecurityScore(factors: SecurityFactor[]): number {
  const total = factors.reduce((s, f) => s + f.points, 0);
  const earned = factors.filter((f) => f.met).reduce((s, f) => s + f.points, 0);
  return Math.round((earned / total) * 100);
}

function ScoreRing({ score, C }: { score: number; C: AppColors }) {
  const color = score >= 80 ? '#22C55E' : score >= 50 ? '#F59E0B' : '#EF4444';
  const label = score >= 80 ? 'Strong' : score >= 50 ? 'Fair' : 'Weak';
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={[sr.ring, { borderColor: color, backgroundColor: `${color}12` }]}>
        <Text style={[sr.score, { color }]}>{score}</Text>
        <Text style={[sr.pct, { color }]}>/ 100</Text>
      </View>
      <View style={[sr.badge, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
        <Text style={[sr.badgeText, { color }]}>{label} Security</Text>
      </View>
    </View>
  );
}

const sr = StyleSheet.create({
  ring: { width: 96, height: 96, borderRadius: 48, borderWidth: 4, alignItems: 'center', justifyContent: 'center', gap: 0 },
  score: { fontSize: 28, fontWeight: FONTS.extraBold, lineHeight: 32 },
  pct: { fontSize: 10, fontWeight: FONTS.semiBold },
  badge: { borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: FONTS.bold },
});

// ─── Session Card ─────────────────────────────────────────────────────────────
function SessionCard({
  session, onRevoke, revoking, C,
}: { session: DeviceSession; onRevoke: (id: string) => void; revoking: boolean; C: AppColors }) {
  const icon = session.platform?.toLowerCase().includes('ios')
    ? 'phone-portrait-outline'
    : session.platform?.toLowerCase().includes('android')
    ? 'phone-landscape-outline'
    : session.deviceType === 'web'
    ? 'globe-outline'
    : 'phone-portrait-outline';

  return (
    <View style={[sc2.wrap, { backgroundColor: session.isCurrent ? `${C.primary}0A` : C.surface, borderColor: session.isCurrent ? `${C.primary}33` : C.border }]}>
      <View style={sc2.iconCol}>
        <View style={[sc2.iconWrap, { backgroundColor: session.isCurrent ? `${C.primary}18` : C.card, borderColor: session.isCurrent ? `${C.primary}44` : C.border }]}>
          <Ionicons name={icon as any} size={18} color={session.isCurrent ? C.primary : C.textMuted} />
        </View>
        {session.isCurrent ? (
          <View style={[sc2.currentDot, { backgroundColor: '#22C55E' }]} />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: C.textPrimary }}>
            {session.deviceName ?? 'Unknown Device'}
          </Text>
          {session.isCurrent ? (
            <View style={[sc2.currentPill, { backgroundColor: '#22C55E18', borderColor: '#22C55E44' }]}>
              <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold, color: '#22C55E' }}>THIS DEVICE</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontSize: 11, color: C.textMuted }}>
          {session.platform ?? 'Unknown'}{session.appVersion ? ` · v${session.appVersion}` : ''}
        </Text>
        <Text style={{ fontSize: 11, color: C.textMuted }}>
          Active {formatRelativeTime(session.lastActiveAt)}
        </Text>
      </View>
      {!session.isCurrent ? (
        <Pressable
          style={({ pressed }) => [sc2.revokeBtn, { borderColor: '#EF444444', backgroundColor: '#EF444408' }, revoking ? { opacity: 0.5 } : pressed ? { opacity: 0.7 } : null]}
          onPress={() => onRevoke(session.id)}
          disabled={revoking}
          hitSlop={8}
        >
          {revoking ? (
            <ActivityIndicator size={12} color="#EF4444" />
          ) : (
            <Ionicons name="close-circle-outline" size={14} color="#EF4444" />
          )}
          <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: '#EF4444' }}>Revoke</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const sc2 = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  iconCol: { alignItems: 'center', gap: 4 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  currentDot: { width: 8, height: 8, borderRadius: 4 },
  currentPill: { borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  revokeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
});

// ─── Audit Row ────────────────────────────────────────────────────────────────
function AuditRow({ entry, C, isLast }: { entry: AuditLogEntry; C: AppColors; isLast: boolean }) {
  const cfg = getEventIcon(entry.eventType);
  const label = getEventLabel(entry.eventType);
  return (
    <View style={[ar.row, { borderBottomColor: C.border }, isLast ? { borderBottomWidth: 0 } : null]}>
      <View style={[ar.iconWrap, { backgroundColor: `${cfg.color}14`, borderColor: `${cfg.color}33` }]}>
        <Ionicons name={cfg.icon as any} size={14} color={cfg.color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 13, fontWeight: FONTS.semiBold, color: C.textPrimary }}>{label}</Text>
        {entry.deviceInfo ? <Text style={{ fontSize: 11, color: C.textMuted }} numberOfLines={1}>{entry.deviceInfo}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={{ fontSize: 10, color: C.textMuted }}>{formatRelativeTime(entry.createdAt)}</Text>
        {entry.eventStatus === 'failed' || entry.eventStatus === 'blocked' ? (
          <View style={[ar.statusPill, { backgroundColor: '#EF444414', borderColor: '#EF444433' }]}>
            <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: '#EF4444' }}>
              {entry.eventStatus.toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const ar = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  iconWrap: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statusPill: { borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
});

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, icon, action, C }: {
  title: string; icon: string; C: AppColors;
  action?: { label: string; onPress: () => void; color?: string };
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
        <Ionicons name={icon as any} size={14} color={C.primary} />
        <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold, color: C.textPrimary, letterSpacing: 0.5 }}>{title}</Text>
      </View>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: action.color ?? C.accentRed }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SecurityScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { showAlert } = useAlert();
  const { colors: C } = useTheme();

  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    const [s, a] = await Promise.all([
      fetchUserSessions(user.id),
      fetchAuditLog(user.id, 20),
    ]);
    setSessions(s);
    setAuditLog(a);
  }, [user?.id]);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Security score factors
  const hasSession = sessions.length > 0;
  const recentFailures = auditLog.filter((e) => e.eventType === 'login_failed').length;
  const securityFactors = [
    { label: 'Email verified', met: !!user?.email, points: 30 },
    { label: 'Active session tracked', met: hasSession, points: 20 },
    { label: 'No recent failed logins', met: recentFailures === 0, points: 25 },
    { label: 'Account created', met: !!user?.id, points: 25 },
  ];
  const securityScore = computeSecurityScore(securityFactors);

  const handleRevokeSession = useCallback(async (sessionId: string) => {
    if (!user?.id) return;
    showAlert(
      'Revoke Session',
      'This will sign out that device immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setRevokingId(sessionId);
            const ok = await revokeSession(sessionId, user.id);
            if (ok) {
              logSecurityEvent(user.id, { eventType: 'session_revoked', status: 'success' });
              setSessions((prev) => prev.filter((s) => s.id !== sessionId));
            } else {
              showAlert('Error', 'Could not revoke session. Please try again.');
            }
            setRevokingId(null);
          },
        },
      ],
    );
  }, [user?.id, showAlert]);

  const handleRevokeAll = useCallback(async () => {
    if (!user?.id) return;
    showAlert(
      'Revoke All Other Sessions',
      'This will sign out all devices except this one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke All',
          style: 'destructive',
          onPress: async () => {
            setRevokingAll(true);
            const ok = await revokeAllOtherSessions(user.id);
            if (ok) {
              logSecurityEvent(user.id, { eventType: 'all_sessions_revoked', status: 'success' });
              await loadData();
            } else {
              showAlert('Error', 'Could not revoke sessions. Please try again.');
            }
            setRevokingAll(false);
          },
        },
      ],
    );
  }, [user?.id, showAlert, loadData]);

  const handleSignOutAll = useCallback(async () => {
    if (!user?.id) return;
    showAlert(
      'Sign Out Everywhere',
      'You will be signed out of all devices including this one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out All',
          style: 'destructive',
          onPress: async () => {
            await revokeAllOtherSessions(user.id);
            logSecurityEvent(user.id, { eventType: 'logout', status: 'success', metadata: { scope: 'all_devices' } });
            await clearSessionToken();
            await logout();
            router.replace('/login' as any);
          },
        },
      ],
    );
  }, [user?.id, showAlert, logout, router]);

  if (!user) {
    return (
      <View style={[st.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']}>
          <Pressable onPress={() => router.back()} style={st.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.textMuted, fontSize: 15 }}>Sign in to view security settings.</Text>
        </View>
      </View>
    );
  }

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <View style={[st.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[st.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={st.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[st.title, { color: C.textPrimary }]}>Security</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: SPACING.md, gap: 16, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={{ color: C.textMuted, fontSize: 13, marginTop: 12 }}>Loading security data...</Text>
          </View>
        ) : (
          <>
            {/* ── Security Score Card ─────────────────────────── */}
            <LinearGradient
              colors={[`${C.primary}14`, `${C.surface}CC`] as [string, string]}
              style={[st.card, { borderColor: `${C.primary}33` }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <ScoreRing score={securityScore} C={C} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: FONTS.bold, color: C.textPrimary }}>Account Security</Text>
                  <View style={{ gap: 5 }}>
                    {securityFactors.map((f) => (
                      <View key={f.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons
                          name={f.met ? 'checkmark-circle' : 'ellipse-outline'}
                          size={13}
                          color={f.met ? '#22C55E' : C.textMuted}
                        />
                        <Text style={{ fontSize: 11, color: f.met ? C.textSecondary : C.textMuted }}>{f.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </LinearGradient>

            {/* ── Active Sessions ──────────────────────────────── */}
            <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
              <SectionHeader
                title="Active Sessions"
                icon="phone-portrait-outline"
                C={C}
                action={otherSessions.length > 0 ? {
                  label: revokingAll ? 'Revoking...' : 'Revoke Others',
                  onPress: handleRevokeAll,
                  color: '#EF4444',
                } : undefined}
              />
              {sessions.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
                  <Ionicons name="phone-portrait-outline" size={28} color={C.textMuted} />
                  <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>
                    No active sessions recorded yet.{'\n'}Sessions are registered on login.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      onRevoke={handleRevokeSession}
                      revoking={revokingId === session.id}
                      C={C}
                    />
                  ))}
                </View>
              )}

              {/* Sign out everywhere */}
              <Pressable
                style={({ pressed }) => [st.signOutAllBtn, { borderColor: '#EF444433', backgroundColor: '#EF444408' }, pressed ? { opacity: 0.8 } : null]}
                onPress={handleSignOutAll}
              >
                <Ionicons name="log-out-outline" size={15} color="#EF4444" />
                <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: '#EF4444' }}>Sign Out of All Devices</Text>
              </Pressable>
            </View>

            {/* ── Quick Security Actions ───────────────────────── */}
            <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
              <SectionHeader title="Account Protection" icon="shield-checkmark-outline" C={C} />
              <View style={{ gap: 8 }}>
                {[
                  {
                    icon: 'key-outline', color: C.primary, label: 'Change Password',
                    sub: 'Update your password for better security',
                    onPress: () => {
                      showAlert(
                        'Change Password',
                        'A password reset link will be sent to your email.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Send Link',
                            onPress: async () => {
                              const { getSupabaseClient: gc } = require('@/template');
                              await gc().auth.resetPasswordForEmail(user.email, {
                                redirectTo: 'onspaceapp://reset-password',
                              });
                              showAlert('Email Sent', 'Check your inbox for the reset link.');
                              logSecurityEvent(user.id, { eventType: 'password_reset_request', status: 'success' });
                            },
                          },
                        ],
                      );
                    },
                  },
                  {
                    icon: 'notifications-outline', color: C.accentBlue, label: 'Notification Preferences',
                    sub: 'Manage alerts and push notification settings',
                    onPress: () => router.push('/notification-preferences' as any),
                  },
                  {
                    icon: 'document-text-outline', color: '#6B7280', label: 'Privacy Policy',
                    sub: 'How we handle your data',
                    onPress: () => router.push('/privacy' as any),
                  },
                ].map((item) => (
                  <Pressable
                    key={item.label}
                    style={({ pressed }) => [st.actionRow, { backgroundColor: C.surface, borderColor: C.border }, pressed ? { opacity: 0.8 } : null]}
                    onPress={item.onPress}
                  >
                    <View style={[st.actionIcon, { backgroundColor: `${item.color}18`, borderColor: `${item.color}33` }]}>
                      <Ionicons name={item.icon as any} size={16} color={item.color} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: FONTS.semiBold, color: C.textPrimary }}>{item.label}</Text>
                      <Text style={{ fontSize: 11, color: C.textMuted }}>{item.sub}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                  </Pressable>
                ))}
              </View>
            </View>

            {/* ── Security Audit Log ───────────────────────────── */}
            <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
              <SectionHeader title="Recent Activity" icon="list-outline" C={C} />
              {auditLog.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
                  <Ionicons name="document-text-outline" size={28} color={C.textMuted} />
                  <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>
                    No security events recorded yet.
                  </Text>
                </View>
              ) : (
                <View>
                  {auditLog.map((entry, idx) => (
                    <AuditRow
                      key={entry.id}
                      entry={entry}
                      C={C}
                      isLast={idx === auditLog.length - 1}
                    />
                  ))}
                </View>
              )}
            </View>

            {/* ── Data & Compliance ────────────────────────────── */}
            <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
              <SectionHeader title="Data & Compliance" icon="lock-closed-outline" C={C} />
              <View style={{ gap: 6 }}>
                {[
                  { icon: 'shield-outline', color: '#22C55E', label: 'End-to-End Encrypted', sub: 'All data encrypted in transit (TLS 1.3)' },
                  { icon: 'server-outline', color: C.accentBlue, label: 'Secure Cloud Storage', sub: 'Data stored in SOC 2 compliant infrastructure' },
                  { icon: 'eye-off-outline', color: C.primary, label: 'Privacy First', sub: 'We never sell your personal data' },
                ].map((item) => (
                  <View key={item.label} style={[st.infoRow, { backgroundColor: C.surface, borderColor: C.border }]}>
                    <View style={[st.actionIcon, { backgroundColor: `${item.color}18`, borderColor: `${item.color}33` }]}>
                      <Ionicons name={item.icon as any} size={14} color={item.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: C.textPrimary }}>{item.label}</Text>
                      <Text style={{ fontSize: 11, color: C.textMuted }}>{item.sub}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: FONTS.bold },
  card: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16 },
  signOutAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 12, marginTop: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  actionIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
});
