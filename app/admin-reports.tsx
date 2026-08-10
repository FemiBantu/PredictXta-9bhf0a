import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, ScrollView, Modal, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getSupabaseClient, useAlert } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReportedMessage {
  reportId: string;
  messageId: string;
  roomId: string | null;
  reporterUsername: string;
  reporterId: string;
  reason: string;
  createdAt: string;
  messageContent: string;
  messageUsername: string;
  messageUserId: string;
  roomName?: string;
}

interface SelectedUser {
  userId: string;
  username: string;
}

// ─── DB fetcher ───────────────────────────────────────────────────────────────
async function fetchReports(): Promise<ReportedMessage[]> {
  try {
    const sb = getSupabaseClient();
    const { data: reports, error } = await sb
      .from('reported_messages')
      .select('id, message_id, reporter_id, room_id, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !reports || reports.length === 0) return [];

    const msgIds = [...new Set(reports.map((r: any) => r.message_id as string))];
    const { data: messages } = await sb
      .from('chat_messages')
      .select('id, content, username, user_id, room_id')
      .in('id', msgIds);

    const msgMap: Record<string, { content: string; username: string; userId: string; roomId: string | null }> = {};
    if (messages) {
      (messages as any[]).forEach((m) => {
        msgMap[m.id] = { content: m.content ?? '', username: m.username ?? 'Unknown', userId: m.user_id ?? '', roomId: m.room_id ?? null };
      });
    }

    const reporterIds = [...new Set(reports.map((r: any) => r.reporter_id as string))];
    const { data: profiles } = await sb.from('user_profiles').select('id, username, email').in('id', reporterIds);
    const profileMap: Record<string, string> = {};
    if (profiles) {
      (profiles as any[]).forEach((p) => { profileMap[p.id] = p.username || p.email || 'Unknown'; });
    }

    const roomIds = [...new Set(reports.map((r: any) => r.room_id as string | null).filter(Boolean) as string[])];
    const roomNameMap: Record<string, string> = {};
    if (roomIds.length > 0) {
      const { data: rooms } = await sb.from('chat_rooms').select('id, name, emoji').in('id', roomIds);
      if (rooms) {
        (rooms as any[]).forEach((r) => { roomNameMap[r.id] = `${r.emoji ?? ''} ${r.name}`.trim(); });
      }
    }

    return (reports as any[]).map((r) => {
      const msg = msgMap[r.message_id] ?? { content: '[Message not found]', username: 'Unknown', userId: '', roomId: null };
      return {
        reportId: r.id, messageId: r.message_id, roomId: r.room_id ?? msg.roomId,
        reporterUsername: profileMap[r.reporter_id] ?? 'Unknown', reporterId: r.reporter_id,
        reason: r.reason ?? 'inappropriate', createdAt: r.created_at,
        messageContent: msg.content, messageUsername: msg.username, messageUserId: msg.userId,
        roomName: r.room_id ? roomNameMap[r.room_id] : undefined,
      };
    });
  } catch { return []; }
}

async function dismissReport(reportId: string): Promise<string | null> {
  try {
    const { error } = await getSupabaseClient().from('reported_messages').delete().eq('id', reportId);
    return error ? error.message : null;
  } catch (e) { return String(e); }
}

async function deleteMessage(messageId: string): Promise<string | null> {
  try {
    const { error } = await getSupabaseClient().from('chat_messages').delete().eq('id', messageId);
    return error ? error.message : null;
  } catch (e) { return String(e); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const d = Math.floor(diff / 86400);
  return d === 1 ? 'Yesterday' : `${d}d ago`;
}

function reasonColor(reason: string, C: AppColors): string {
  switch (reason) {
    case 'spam': return C.accentBlue;
    case 'hate': return C.accentRed;
    case 'harassment': return C.accentPurple;
    default: return C.accent;
  }
}

function reasonIcon(reason: string): string {
  switch (reason) {
    case 'spam': return '🔁';
    case 'hate': return '🚫';
    case 'harassment': return '😤';
    default: return '⚠️';
  }
}

function getAvatarColor(seed: string, C: AppColors): string {
  const palette = [C.primary, C.accent, C.accentBlue, C.accentPurple, C.accentRed];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + hash * 31;
  return palette[Math.abs(hash) % palette.length];
}

// ─── User Profile Bottom Sheet ────────────────────────────────────────────────
function UserProfileSheet({
  user, allReports, C, onClose, onDeleteAllMessages,
}: {
  user: SelectedUser;
  allReports: ReportedMessage[];
  C: AppColors;
  onClose: () => void;
  onDeleteAllMessages: (userId: string, username: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(500)).current;
  const bgAnim = useRef(new Animated.Value(0)).current;
  const { showAlert } = useAlert();

  // Filter all reports attributed to this message author
  const userReports = allReports.filter((r) => r.messageUserId === user.userId);

  // Stats
  const totalReports = userReports.length;
  const reasonCounts = userReports.reduce<Record<string, number>>((acc, r) => {
    acc[r.reason] = (acc[r.reason] ?? 0) + 1;
    return acc;
  }, {});
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];
  const uniqueMessages = new Set(userReports.map((r) => r.messageId)).size;
  const avatarColor = getAvatarColor(user.userId, C);
  const initial = (user.username[0] ?? '?').toUpperCase();

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
      Animated.timing(bgAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 500, duration: 220, useNativeDriver: true }),
      Animated.timing(bgAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const handleBanUser = () => {
    showAlert(
      'Ban User (Coming Soon)',
      `Banning @${user.username} will be available in a future update. For now, delete their reported messages to remove harmful content.`,
      [{ text: 'OK' }],
    );
  };

  const bgOpacity = bgAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] });

  return (
    <Modal transparent animationType="none" visible onRequestClose={handleClose}>
      {/* Backdrop */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000', opacity: bgOpacity }]}
        pointerEvents="auto"
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          profileSheetStyles.sheet,
          {
            backgroundColor: C.surface,
            borderTopColor: C.border,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Handle */}
        <View style={[profileSheetStyles.handle, { backgroundColor: C.border }]} />

        {/* User hero section */}
        <View style={[profileSheetStyles.hero, { borderBottomColor: C.border }]}>
          <View style={[profileSheetStyles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={profileSheetStyles.avatarText}>{initial}</Text>
          </View>
          <View style={profileSheetStyles.heroInfo}>
            <Text style={[profileSheetStyles.username, { color: C.textPrimary }]}>@{user.username}</Text>
            <View style={[profileSheetStyles.riskBadge, {
              backgroundColor: totalReports >= 5 ? `${C.accentRed}18` : `${C.accent}18`,
              borderColor: totalReports >= 5 ? `${C.accentRed}44` : `${C.accent}44`,
            }]}>
              <Ionicons
                name={totalReports >= 5 ? 'warning-outline' : 'shield-checkmark-outline'}
                size={11}
                color={totalReports >= 5 ? C.accentRed : C.accent}
              />
              <Text style={[profileSheetStyles.riskText, { color: totalReports >= 5 ? C.accentRed : C.accent }]}>
                {totalReports >= 5 ? 'High Risk' : totalReports >= 2 ? 'Moderate' : 'Low Risk'}
              </Text>
            </View>
          </View>
          <Pressable onPress={handleClose} hitSlop={8} style={profileSheetStyles.closeBtn}>
            <Ionicons name="close" size={20} color={C.textMuted} />
          </Pressable>
        </View>

        {/* Stats row */}
        <View style={[profileSheetStyles.statsRow, { borderBottomColor: C.border }]}>
          <View style={profileSheetStyles.statItem}>
            <Text style={[profileSheetStyles.statValue, { color: C.accentRed }]}>{totalReports}</Text>
            <Text style={[profileSheetStyles.statLabel, { color: C.textMuted }]}>Reports</Text>
          </View>
          <View style={[profileSheetStyles.statDivider, { backgroundColor: C.border }]} />
          <View style={profileSheetStyles.statItem}>
            <Text style={[profileSheetStyles.statValue, { color: C.primary }]}>{uniqueMessages}</Text>
            <Text style={[profileSheetStyles.statLabel, { color: C.textMuted }]}>Messages</Text>
          </View>
          <View style={[profileSheetStyles.statDivider, { backgroundColor: C.border }]} />
          <View style={profileSheetStyles.statItem}>
            <Text style={[profileSheetStyles.statValue, { color: reasonColor(topReason?.[0] ?? '', C) }]}>
              {topReason ? topReason[0] : '—'}
            </Text>
            <Text style={[profileSheetStyles.statLabel, { color: C.textMuted }]}>Top Reason</Text>
          </View>
        </View>

        {/* Reason breakdown chips */}
        {Object.keys(reasonCounts).length > 0 ? (
          <View style={profileSheetStyles.reasonBreakdown}>
            <Text style={[profileSheetStyles.sectionTitle, { color: C.textMuted }]}>REASON BREAKDOWN</Text>
            <View style={profileSheetStyles.reasonChips}>
              {Object.entries(reasonCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([r, count]) => {
                  const color = reasonColor(r, C);
                  return (
                    <View
                      key={r}
                      style={[profileSheetStyles.reasonChip, { backgroundColor: `${color}14`, borderColor: `${color}44` }]}
                    >
                      <Text style={profileSheetStyles.reasonChipIcon}>{reasonIcon(r)}</Text>
                      <Text style={[profileSheetStyles.reasonChipLabel, { color }]}>{r}</Text>
                      <View style={[profileSheetStyles.reasonChipCount, { backgroundColor: color }]}>
                        <Text style={profileSheetStyles.reasonChipCountText}>{count}</Text>
                      </View>
                    </View>
                  );
                })}
            </View>
          </View>
        ) : null}

        {/* Reported messages list */}
        <Text style={[profileSheetStyles.sectionTitle, { color: C.textMuted, paddingHorizontal: SPACING.md, paddingTop: 12 }]}>
          REPORTED MESSAGES
        </Text>
        <ScrollView
          style={profileSheetStyles.messageList}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: 8, gap: 8 }}
        >
          {userReports.length === 0 ? (
            <Text style={[profileSheetStyles.noMessages, { color: C.textMuted }]}>No reported messages found.</Text>
          ) : (
            userReports.map((r) => {
              const rColor = reasonColor(r.reason, C);
              const preview = r.messageContent.length > 100
                ? r.messageContent.slice(0, 97) + '…'
                : r.messageContent;
              return (
                <View
                  key={r.reportId}
                  style={[profileSheetStyles.msgCard, { backgroundColor: C.card, borderColor: C.border }]}
                >
                  <View style={[profileSheetStyles.msgStripe, { backgroundColor: rColor }]} />
                  <View style={profileSheetStyles.msgBody}>
                    <View style={profileSheetStyles.msgHeader}>
                      <View style={[profileSheetStyles.msgReasonBadge, { backgroundColor: `${rColor}18`, borderColor: `${rColor}44` }]}>
                        <Text style={profileSheetStyles.msgReasonIcon}>{reasonIcon(r.reason)}</Text>
                        <Text style={[profileSheetStyles.msgReasonText, { color: rColor }]}>{r.reason}</Text>
                      </View>
                      <Text style={[profileSheetStyles.msgTime, { color: C.textMuted }]}>{timeAgo(r.createdAt)}</Text>
                    </View>
                    <Text style={[profileSheetStyles.msgContent, { color: C.textPrimary }]}>{preview}</Text>
                    {r.roomName ? (
                      <Text style={[profileSheetStyles.msgRoom, { color: C.textMuted }]}>
                        <Ionicons name="chatbubble-outline" size={10} color={C.textMuted} /> {r.roomName}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Action footer */}
        <View style={[profileSheetStyles.footer, { borderTopColor: C.border, paddingBottom: 4 }]}>
          {/* Delete All Messages */}
          <Pressable
            onPress={() => onDeleteAllMessages(user.userId, user.username)}
            style={({ pressed }) => [
              profileSheetStyles.deleteAllBtn,
              { backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}44` },
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Ionicons name="trash-outline" size={15} color={C.accentRed} />
            <Text style={[profileSheetStyles.deleteAllBtnText, { color: C.accentRed }]}>Delete All Messages</Text>
            {userReports.length > 0 ? (
              <View style={[profileSheetStyles.deleteAllCount, { backgroundColor: C.accentRed }]}>
                <Text style={profileSheetStyles.deleteAllCountText}>{uniqueMessages}</Text>
              </View>
            ) : null}
          </Pressable>

          {/* Ban User (placeholder) */}
          <Pressable
            onPress={handleBanUser}
            style={({ pressed }) => [
              profileSheetStyles.banBtn,
              { backgroundColor: `${C.accentRed}08`, borderColor: C.border },
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Ionicons name="ban-outline" size={16} color={C.textMuted} />
            <Text style={[profileSheetStyles.banBtnText, { color: C.textMuted }]}>Ban User</Text>
            <View style={[profileSheetStyles.comingSoonBadge, { backgroundColor: C.border }]}>
              <Text style={[profileSheetStyles.comingSoonText, { color: C.textMuted }]}>Soon</Text>
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const profileSheetStyles = StyleSheet.create({
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    maxHeight: '82%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    alignSelf: 'center', marginTop: 10, marginBottom: 2,
  },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { fontSize: 20, fontWeight: FONTS.bold, color: '#fff' },
  heroInfo: { flex: 1, gap: 6 },
  username: { fontSize: 17, fontWeight: FONTS.bold },
  riskBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  riskText: { fontSize: 10, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  closeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  statsRow: {
    flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 14,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: { fontSize: 20, fontWeight: FONTS.extraBold },
  statLabel: { fontSize: 10, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, marginVertical: 4 },

  reasonBreakdown: { paddingHorizontal: SPACING.md, paddingTop: 12, gap: 8 },
  sectionTitle: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.8, textTransform: 'uppercase' },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reasonChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  reasonChipIcon: { fontSize: 12 },
  reasonChipLabel: { fontSize: 12, fontWeight: FONTS.semiBold, textTransform: 'capitalize' },
  reasonChipCount: {
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  reasonChipCountText: { fontSize: 10, fontWeight: FONTS.extraBold, color: '#fff' },

  messageList: { flex: 1, marginTop: 8 },
  noMessages: { textAlign: 'center', fontSize: 13, paddingVertical: 20 },

  msgCard: {
    flexDirection: 'row', borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden',
  },
  msgStripe: { width: 3 },
  msgBody: { flex: 1, padding: 10, gap: 6 },
  msgHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  msgReasonBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  msgReasonIcon: { fontSize: 10 },
  msgReasonText: { fontSize: 9, fontWeight: FONTS.bold, textTransform: 'capitalize', letterSpacing: 0.3 },
  msgTime: { fontSize: 10, marginLeft: 8 },
  msgContent: { fontSize: 12, lineHeight: 17 },
  msgRoom: { fontSize: 10 },

  footer: {
    paddingHorizontal: SPACING.md, paddingTop: 12, borderTopWidth: 1,
  },
  deleteAllBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 13, marginBottom: 8,
  },
  deleteAllBtnText: { fontSize: 14, fontWeight: FONTS.bold },
  deleteAllCount: {
    minWidth: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  deleteAllCountText: { fontSize: 10, fontWeight: FONTS.extraBold, color: '#fff' },
  banBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 11,
  },
  banBtnText: { fontSize: 13, fontWeight: FONTS.semiBold },
  comingSoonBadge: {
    borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 4,
  },
  comingSoonText: { fontSize: 9, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
});

// ─── Report Card ──────────────────────────────────────────────────────────────
function ReportCard({
  report, C, onDismiss, onDeleteMessage, selectMode, isSelected, onToggleSelect, onUserPress,
}: {
  report: ReportedMessage;
  C: AppColors;
  onDismiss: (reportId: string) => void;
  onDeleteMessage: (messageId: string, reportId: string) => void;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (reportId: string) => void;
  onUserPress?: (user: SelectedUser) => void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const rColor = reasonColor(report.reason, C);
  const preview = report.messageContent.length > 120
    ? report.messageContent.slice(0, 117) + '…'
    : report.messageContent;

  const handleDismiss = async () => { setDismissing(true); await onDismiss(report.reportId); setDismissing(false); };
  const handleDelete = async () => { setDeleting(true); await onDeleteMessage(report.messageId, report.reportId); setDeleting(false); };

  const handleAuthorPress = () => {
    if (onUserPress && report.messageUserId) {
      onUserPress({ userId: report.messageUserId, username: report.messageUsername });
    }
  };

  return (
    <Pressable
      onPress={() => selectMode && onToggleSelect ? onToggleSelect(report.reportId) : undefined}
      style={({ pressed }) => [
        cardStyles.card,
        { backgroundColor: C.card, borderColor: isSelected ? C.primary : C.border },
        isSelected ? { borderWidth: 2 } : null,
        pressed && selectMode ? { opacity: 0.8 } : null,
      ]}
    >
      {/* Accent stripe */}
      <View style={[cardStyles.stripe, { backgroundColor: rColor }]} />

      {/* Checkbox — only in select mode */}
      {selectMode ? (
        <View style={cardStyles.checkboxWrap}>
          <View
            style={[
              cardStyles.checkbox,
              isSelected
                ? { backgroundColor: C.primary, borderColor: C.primary }
                : { backgroundColor: 'transparent', borderColor: C.border },
            ]}
          >
            {isSelected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
          </View>
        </View>
      ) : null}

      <View style={cardStyles.body}>
        {/* Header row */}
        <View style={cardStyles.headerRow}>
          <View style={[cardStyles.reasonBadge, { backgroundColor: `${rColor}18`, borderColor: `${rColor}44` }]}>
            <Text style={[cardStyles.reasonText, { color: rColor }]}>🚩 {report.reason.toUpperCase()}</Text>
          </View>
          <Text style={[cardStyles.timeText, { color: C.textMuted }]}>{timeAgo(report.createdAt)}</Text>
        </View>

        {/* Message preview */}
        <View style={[cardStyles.messageBox, { backgroundColor: C.surface, borderColor: C.border }]}>
          <View style={cardStyles.messageAuthorRow}>
            <View style={[cardStyles.avatarDot, { backgroundColor: getAvatarColor(report.messageUserId || report.messageUsername, C) }]}>
              <Text style={cardStyles.avatarInitial}>{(report.messageUsername[0] ?? '?').toUpperCase()}</Text>
            </View>
            {/* Tappable author name */}
            <Pressable
              onPress={handleAuthorPress}
              hitSlop={6}
              style={({ pressed }) => [
                cardStyles.authorBtn,
                pressed ? { opacity: 0.65 } : null,
              ]}
            >
              <Text style={[cardStyles.authorName, { color: C.primary }]}>@{report.messageUsername}</Text>
              <Ionicons name="chevron-forward" size={10} color={C.primary} />
            </Pressable>
            {report.roomName ? (
              <Text style={[cardStyles.roomTag, { color: C.textMuted }]} numberOfLines={1}>· {report.roomName}</Text>
            ) : null}
          </View>
          <Text style={[cardStyles.messageText, { color: C.textPrimary }]}>{preview}</Text>
        </View>

        {/* Reporter row */}
        <View style={cardStyles.reporterRow}>
          <Ionicons name="person-circle-outline" size={13} color={C.textMuted} />
          <Text style={[cardStyles.reporterText, { color: C.textMuted }]}>
            Reported by <Text style={{ color: C.textSecondary, fontWeight: FONTS.semiBold }}>@{report.reporterUsername}</Text>
          </Text>
        </View>

        {/* Action buttons — hidden in select mode */}
        {!selectMode ? (
          <View style={cardStyles.actionsRow}>
            <Pressable
              style={({ pressed }) => [
                cardStyles.dismissBtn,
                { borderColor: C.border, backgroundColor: C.surface },
                pressed ? { opacity: 0.7 } : null,
              ]}
              onPress={handleDismiss}
              disabled={dismissing || deleting}
            >
              {dismissing ? (
                <ActivityIndicator size="small" color={C.textMuted} />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={14} color={C.textMuted} />
                  <Text style={[cardStyles.dismissText, { color: C.textMuted }]}>Dismiss</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                cardStyles.deleteBtn,
                { backgroundColor: `${C.accentRed}12`, borderColor: `${C.accentRed}44` },
                pressed ? { opacity: 0.7 } : null,
              ]}
              onPress={handleDelete}
              disabled={dismissing || deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={C.accentRed} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={14} color={C.accentRed} />
                  <Text style={[cardStyles.deleteText, { color: C.accentRed }]}>Delete Message</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  stripe: { width: 4 },
  checkboxWrap: { width: 46, alignItems: 'center', justifyContent: 'center' },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, padding: 12, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reasonBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  reasonText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  timeText: { fontSize: 11, flex: 1, textAlign: 'right' },
  messageBox: { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, gap: 6 },
  messageAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  avatarDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 10, fontWeight: FONTS.bold, color: '#fff' },
  authorBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  authorName: { fontSize: 12, fontWeight: FONTS.bold },
  roomTag: { fontSize: 11, flex: 1 },
  messageText: { fontSize: 13, lineHeight: 18 },
  reporterRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reporterText: { fontSize: 11 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  dismissBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: RADIUS.full, borderWidth: 1,
  },
  dismissText: { fontSize: 12, fontWeight: FONTS.semiBold },
  deleteBtn: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: RADIUS.full, borderWidth: 1,
  },
  deleteText: { fontSize: 12, fontWeight: FONTS.semiBold },
});

// ─── Filter Chip Bar ─────────────────────────────────────────────────────────
const REASON_FILTERS: { key: string | null; label: string; icon: string }[] = [
  { key: null,            label: 'All',          icon: '🚩' },
  { key: 'spam',          label: 'Spam',         icon: '🔁' },
  { key: 'hate',          label: 'Hate Speech',  icon: '🚫' },
  { key: 'harassment',    label: 'Harassment',   icon: '😤' },
  { key: 'inappropriate', label: 'Inappropriate',icon: '⚠️' },
];

function FilterBar({
  active, counts, C, onChange, onDismissAll, dismissingAll,
}: {
  active: string | null;
  counts: Record<string, number>;
  C: AppColors;
  onChange: (key: string | null) => void;
  onDismissAll: () => void;
  dismissingAll: boolean;
}) {
  const activeColor = active ? reasonColor(active, C) : C.primary;
  const activeCount = active ? (counts[active] ?? 0) : 0;

  return (
    <View style={[filterStyles.wrap, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={filterStyles.scroll}>
        {REASON_FILTERS.map((f) => {
          const isActive = active === f.key;
          const count = f.key === null ? Object.values(counts).reduce((s, n) => s + n, 0) : (counts[f.key] ?? 0);
          const color = f.key === null ? C.primary : reasonColor(f.key, C);
          return (
            <Pressable
              key={String(f.key)}
              onPress={() => onChange(f.key)}
              style={({ pressed }) => [
                filterStyles.chip,
                { borderColor: isActive ? color : C.border, backgroundColor: isActive ? `${color}14` : C.card },
                pressed ? { opacity: 0.75 } : null,
              ]}
            >
              <Text style={filterStyles.chipIcon}>{f.icon}</Text>
              <Text style={[filterStyles.chipLabel, { color: isActive ? color : C.textSecondary, fontWeight: isActive ? FONTS.bold : FONTS.medium }]}>
                {f.label}
              </Text>
              {count > 0 ? (
                <View style={[filterStyles.chipBadge, { backgroundColor: isActive ? color : C.border }]}>
                  <Text style={[filterStyles.chipBadgeText, { color: isActive ? '#fff' : C.textMuted }]}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
        {active !== null && activeCount > 0 ? (
          <Pressable
            onPress={onDismissAll}
            disabled={dismissingAll}
            style={({ pressed }) => [
              filterStyles.dismissAllChip,
              { backgroundColor: `${activeColor}12`, borderColor: `${activeColor}44` },
              pressed ? { opacity: 0.65 } : null,
              dismissingAll ? { opacity: 0.45 } : null,
            ]}
          >
            {dismissingAll ? (
              <ActivityIndicator size="small" color={activeColor} style={{ width: 14, height: 14 }} />
            ) : (
              <Ionicons name="checkmark-done-outline" size={13} color={activeColor} />
            )}
            <Text style={[filterStyles.dismissAllLabel, { color: activeColor }]}>Dismiss All ({activeCount})</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const filterStyles = StyleSheet.create({
  wrap: { borderBottomWidth: 1 },
  scroll: { flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.md, paddingVertical: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 7, borderRadius: RADIUS.full, borderWidth: 1,
  },
  chipIcon: { fontSize: 12 },
  chipLabel: { fontSize: 12 },
  chipBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  chipBadgeText: { fontSize: 9, fontWeight: FONTS.extraBold },
  dismissAllChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 7, borderRadius: RADIUS.full, borderWidth: 1, marginLeft: 4,
  },
  dismissAllLabel: { fontSize: 12, fontWeight: FONTS.bold },
});

// ─── Stats Bar ────────────────────────────────────────────────────────────────
function StatsBar({ reports, C }: { reports: ReportedMessage[]; C: AppColors }) {
  const total = reports.length;
  const reasons = reports.reduce<Record<string, number>>((acc, r) => { acc[r.reason] = (acc[r.reason] ?? 0) + 1; return acc; }, {});
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
  return (
    <View style={[statsStyles.bar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
      <View style={statsStyles.stat}>
        <Text style={[statsStyles.statValue, { color: C.accentRed }]}>{total}</Text>
        <Text style={[statsStyles.statLabel, { color: C.textMuted }]}>Pending</Text>
      </View>
      <View style={[statsStyles.divider, { backgroundColor: C.border }]} />
      <View style={statsStyles.stat}>
        <Text style={[statsStyles.statValue, { color: C.primary }]}>{topReason ? topReason[0] : '—'}</Text>
        <Text style={[statsStyles.statLabel, { color: C.textMuted }]}>Top Reason</Text>
      </View>
      <View style={[statsStyles.divider, { backgroundColor: C.border }]} />
      <View style={statsStyles.stat}>
        <Text style={[statsStyles.statValue, { color: C.accentBlue }]}>{new Set(reports.map((r) => r.messageId)).size}</Text>
        <Text style={[statsStyles.statLabel, { color: C.textMuted }]}>Messages</Text>
      </View>
    </View>
  );
}

const statsStyles = StyleSheet.create({
  bar: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 18, fontWeight: FONTS.extraBold },
  statLabel: { fontSize: 10, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  divider: { width: 1, marginVertical: 4 },
});

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyReports({ C }: { C: AppColors }) {
  return (
    <View style={emptyStyles.wrap}>
      <View style={[emptyStyles.iconCircle, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={emptyStyles.icon}>✅</Text>
      </View>
      <Text style={[emptyStyles.title, { color: C.textSecondary }]}>No pending reports</Text>
      <Text style={[emptyStyles.sub, { color: C.textMuted }]}>Your community is clean! Reported messages will appear here for review.</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  icon: { fontSize: 36 },
  title: { fontSize: 17, fontWeight: FONTS.bold },
  sub: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminReportsScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { showAlert } = useAlert();

  const [reports, setReports] = useState<ReportedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterReason, setFilterReason] = useState<string | null>(null);
  const [dismissingAll, setDismissingAll] = useState(false);

  // ── Multi-select state ────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dismissingSelected, setDismissingSelected] = useState(false);

  // ── User profile sheet state ──────────────────────────────────────────────
  const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchReports();
    setReports(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const reasonCounts = reports.reduce<Record<string, number>>((acc, r) => {
    acc[r.reason] = (acc[r.reason] ?? 0) + 1;
    return acc;
  }, {});
  const filteredReports = filterReason ? reports.filter((r) => r.reason === filterReason) : reports;
  const allSelected = filteredReports.length > 0 && selectedIds.size === filteredReports.length;

  // ── Select mode handlers ──────────────────────────────────────────────────
  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const handleToggleSelect = useCallback((reportId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredReports.map((r) => r.reportId)));
    }
  }, [allSelected, filteredReports]);

  // ── Dismiss selected ──────────────────────────────────────────────────────
  const handleDismissSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    showAlert(
      `Dismiss ${selectedIds.size} Report${selectedIds.size !== 1 ? 's' : ''}`,
      `Remove the ${selectedIds.size} selected report${selectedIds.size !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: async () => {
            setDismissingSelected(true);
            const ids = [...selectedIds];
            const { error } = await getSupabaseClient()
              .from('reported_messages')
              .delete()
              .in('id', ids);
            setDismissingSelected(false);
            if (error) {
              showAlert('Error', error.message);
            } else {
              setReports((prev) => prev.filter((r) => !ids.includes(r.reportId)));
              setSelectedIds(new Set());
              setSelectMode(false);
            }
          },
        },
      ],
    );
  }, [selectedIds, showAlert]);

  // ── Dismiss single report ──────────────────────────────────────────────────
  const handleDismiss = useCallback(async (reportId: string) => {
    const err = await dismissReport(reportId);
    if (err) { showAlert('Error', `Could not dismiss report: ${err}`); }
    else { setReports((prev) => prev.filter((r) => r.reportId !== reportId)); }
  }, [showAlert]);

  // ── Delete message ────────────────────────────────────────────────────────
  const handleDeleteMessage = useCallback(async (messageId: string, _reportId: string) => {
    showAlert(
      'Delete Message',
      'This will permanently delete the message and remove all reports for it. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const err = await deleteMessage(messageId);
            if (err) { showAlert('Error', `Could not delete message: ${err}`); }
            else { setReports((prev) => prev.filter((r) => r.messageId !== messageId)); }
          },
        },
      ],
    );
  }, [showAlert]);

  // ── Dismiss all by reason ─────────────────────────────────────────────────
  const handleDismissAllByReason = useCallback(async () => {
    if (!filterReason) return;
    const matching = reports.filter((r) => r.reason === filterReason);
    if (matching.length === 0) return;
    const label = filterReason.charAt(0).toUpperCase() + filterReason.slice(1);
    showAlert(
      `Dismiss All ${label}`,
      `Remove all ${matching.length} "${filterReason}" report${matching.length !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss All', style: 'destructive',
          onPress: async () => {
            setDismissingAll(true);
            const ids = matching.map((r) => r.reportId);
            const { error } = await getSupabaseClient().from('reported_messages').delete().in('id', ids);
            setDismissingAll(false);
            if (error) { showAlert('Error', error.message); }
            else { setReports((prev) => prev.filter((r) => r.reason !== filterReason)); }
          },
        },
      ],
    );
  }, [filterReason, reports, showAlert]);

  // ── Delete all messages for a user ──────────────────────────────────────
  const handleDeleteAllMessages = useCallback(async (userId: string, username: string) => {
    const userReports = reports.filter((r) => r.messageUserId === userId);
    const messageCount = new Set(userReports.map((r) => r.messageId)).size;
    showAlert(
      `Delete @${username}'s Messages`,
      `Permanently delete all ${messageCount} message${messageCount !== 1 ? 's' : ''} from @${username}? This will also remove all ${userReports.length} report${userReports.length !== 1 ? 's' : ''} for those messages.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All', style: 'destructive',
          onPress: async () => {
            setDeletingUser(true);
            const uniqueMessageIds = [...new Set(userReports.map((r) => r.messageId))];
            const { error } = await getSupabaseClient()
              .from('chat_messages')
              .delete()
              .in('id', uniqueMessageIds);
            setDeletingUser(false);
            if (error) {
              showAlert('Error', error.message);
            } else {
              // Remove all reports for this user from local state
              setReports((prev) => prev.filter((r) => r.messageUserId !== userId));
              setSelectedUser(null);
            }
          },
        },
      ],
    );
  }, [reports, showAlert]);

  // ── Dismiss all ───────────────────────────────────────────────────────────
  const handleDismissAll = useCallback(() => {
    if (reports.length === 0) return;
    showAlert(
      'Dismiss All',
      `Mark all ${reports.length} report${reports.length !== 1 ? 's' : ''} as reviewed and remove them?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss All', style: 'destructive',
          onPress: async () => {
            const ids = reports.map((r) => r.reportId);
            const { error } = await getSupabaseClient().from('reported_messages').delete().in('id', ids);
            if (error) { showAlert('Error', error.message); }
            else { setReports([]); }
          },
        },
      ],
    );
  }, [reports, showAlert]);

  return (
    <View style={[screenStyles.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[screenStyles.header, { borderBottomColor: C.border, backgroundColor: C.surface }]}>
          <Pressable onPress={() => router.back()} style={screenStyles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={screenStyles.headerCenter}>
            <Ionicons name="flag" size={18} color={C.accentRed} />
            <Text style={[screenStyles.title, { color: C.textPrimary }]}>Reported Messages</Text>
            {reports.length > 0 ? (
              <View style={[screenStyles.countBadge, { backgroundColor: C.accentRed }]}>
                <Text style={screenStyles.countBadgeText}>{reports.length > 99 ? '99+' : reports.length}</Text>
              </View>
            ) : null}
          </View>

          {/* Right-side action buttons */}
          <View style={screenStyles.headerActions}>
            {reports.length > 0 ? (
              <Pressable
                onPress={handleToggleSelectMode}
                hitSlop={8}
                style={({ pressed }) => [
                  screenStyles.selectBtn,
                  selectMode
                    ? { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}55` }
                    : { borderColor: C.border, backgroundColor: C.card },
                  pressed ? { opacity: 0.7 } : null,
                ]}
              >
                <Ionicons
                  name={selectMode ? 'close-outline' : 'checkmark-circle-outline'}
                  size={14}
                  color={selectMode ? C.primary : C.textMuted}
                />
                <Text style={[screenStyles.selectBtnText, { color: selectMode ? C.primary : C.textMuted }]}>
                  {selectMode ? 'Cancel' : 'Select'}
                </Text>
              </Pressable>
            ) : null}

            {reports.length > 0 && !selectMode ? (
              <Pressable
                onPress={handleDismissAll}
                hitSlop={8}
                style={({ pressed }) => [
                  screenStyles.dismissAllBtn,
                  { borderColor: C.border, backgroundColor: C.card },
                  pressed ? { opacity: 0.7 } : null,
                ]}
              >
                <Ionicons name="checkmark-done-outline" size={16} color={C.textMuted} />
                <Text style={[screenStyles.dismissAllText, { color: C.textMuted }]}>All</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {!loading && reports.length > 0 ? <StatsBar reports={reports} C={C} /> : null}

        {selectMode && !loading && filteredReports.length > 0 ? (
          <View style={[screenStyles.selectBar, { backgroundColor: `${C.primary}0C`, borderBottomColor: `${C.primary}30` }]}>
            <Pressable
              onPress={handleSelectAll}
              hitSlop={8}
              style={({ pressed }) => [screenStyles.selectAllBtn, pressed ? { opacity: 0.7 } : null]}
            >
              <View
                style={[
                  screenStyles.selectAllCheck,
                  allSelected
                    ? { backgroundColor: C.primary, borderColor: C.primary }
                    : { borderColor: C.border, backgroundColor: 'transparent' },
                ]}
              >
                {allSelected ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
              </View>
              <Text style={[screenStyles.selectAllText, { color: C.textSecondary }]}>
                {allSelected ? 'Deselect all' : `Select all (${filteredReports.length})`}
              </Text>
            </Pressable>
            <Text style={[screenStyles.selectedCount, { color: C.primary }]}>
              {selectedIds.size} selected
            </Text>
          </View>
        ) : null}

        {!loading && reports.length > 0 ? (
          <FilterBar
            active={filterReason}
            counts={reasonCounts}
            C={C}
            onChange={setFilterReason}
            onDismissAll={handleDismissAllByReason}
            dismissingAll={dismissingAll}
          />
        ) : null}
      </SafeAreaView>

      {/* Content */}
      {loading ? (
        <View style={screenStyles.loader}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={[screenStyles.loaderText, { color: C.textMuted }]}>Loading reports…</Text>
        </View>
      ) : reports.length === 0 ? (
        <EmptyReports C={C} />
      ) : (
        <FlatList
          data={filteredReports}
          keyExtractor={(item) => item.reportId}
          renderItem={({ item }) => (
            <ReportCard
              report={item}
              C={C}
              onDismiss={handleDismiss}
              onDeleteMessage={handleDeleteMessage}
              selectMode={selectMode}
              isSelected={selectedIds.has(item.reportId)}
              onToggleSelect={handleToggleSelect}
              onUserPress={setSelectedUser}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={screenStyles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={emptyStyles.wrap}>
              <Text style={[emptyStyles.icon, { fontSize: 32 }]}>🔍</Text>
              <Text style={[emptyStyles.title, { color: C.textSecondary }]}>No matching reports</Text>
              <Text style={[emptyStyles.sub, { color: C.textMuted }]}>No reports with this reason category.</Text>
            </View>
          }
          ListFooterComponent={<View style={{ height: selectMode ? 110 : 40 }} />}
        />
      )}

      {/* Floating dismiss-selected bar */}
      {selectMode && selectedIds.size > 0 ? (
        <View
          style={[
            screenStyles.dismissSelectedBar,
            { backgroundColor: C.surface, borderTopColor: C.border },
          ]}
        >
          <View style={screenStyles.dismissSelectedInner}>
            <View style={[screenStyles.selectedPill, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}>
              <Text style={[screenStyles.selectedPillText, { color: C.primary }]}>
                {selectedIds.size} selected
              </Text>
            </View>
            <Pressable
              onPress={handleDismissSelected}
              disabled={dismissingSelected}
              style={({ pressed }) => [
                screenStyles.dismissSelectedBtn,
                { backgroundColor: C.primary },
                dismissingSelected ? { opacity: 0.5 } : null,
                pressed && !dismissingSelected ? { opacity: 0.85 } : null,
              ]}
            >
              {dismissingSelected ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={15} color="#fff" />
                  <Text style={screenStyles.dismissSelectedText}>
                    Dismiss Selected ({selectedIds.size})
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* User Profile Bottom Sheet */}
      {selectedUser ? (
        <UserProfileSheet
          user={selectedUser}
          allReports={reports}
          C={C}
          onClose={() => setSelectedUser(null)}
          onDeleteAllMessages={handleDeleteAllMessages}
        />
      ) : null}
    </View>
  );
}

const screenStyles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: FONTS.bold },
  countBadge: {
    borderRadius: RADIUS.full, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  countBadgeText: { fontSize: 10, fontWeight: FONTS.extraBold, color: '#fff' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6,
  },
  selectBtnText: { fontSize: 12, fontWeight: FONTS.semiBold },
  dismissAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6,
  },
  dismissAllText: { fontSize: 12, fontWeight: FONTS.semiBold },

  selectBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 9, borderBottomWidth: 1,
  },
  selectAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectAllCheck: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  selectAllText: { fontSize: 12, fontWeight: FONTS.semiBold },
  selectedCount: { fontSize: 12, fontWeight: FONTS.bold },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText: { fontSize: 13 },
  list: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md },

  dismissSelectedBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },
  dismissSelectedInner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 12, paddingBottom: 24,
  },
  selectedPill: {
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6,
  },
  selectedPillText: { fontSize: 12, fontWeight: FONTS.bold },
  dismissSelectedBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: RADIUS.full, paddingVertical: 11,
  },
  dismissSelectedText: { fontSize: 13, fontWeight: FONTS.bold, color: '#fff' },
});
