import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getSupabaseClient, useAuth } from '@/template';
import { Notification } from '@/services/types';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useLocale } from '@/hooks/useLocale';
import { useTranslatedContent } from '@/hooks/useTranslatedContent';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Type config ──────────────────────────────────────────────────────────────
interface TypeConfig {
  icon: keyof typeof Ionicons.glyphMap;
  emoji?: string;
  color: string;
  bg: string;
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  general:    { icon: 'lock-open-outline',       emoji: '🔓', color: COLORS.accentBlue,   bg: 'rgba(88,166,255,0.14)' },
  referral:   { icon: 'people-outline',          emoji: '🎉', color: COLORS.accent,       bg: 'rgba(0,255,135,0.14)' },
  challenge:  { icon: 'trophy-outline',          emoji: '🏆', color: COLORS.primary,      bg: 'rgba(255,215,0,0.14)' },
  goal:       { icon: 'football-outline',              color: COLORS.accent,       bg: 'rgba(0,255,135,0.12)' },
  prediction: { icon: 'analytics-outline',             color: COLORS.accentBlue,   bg: 'rgba(88,166,255,0.12)' },
  system:     { icon: 'settings-outline',              color: COLORS.textSecondary,bg: 'rgba(255,255,255,0.08)' },
  live:       { icon: 'radio-outline',                 color: COLORS.accent,       bg: 'rgba(0,255,135,0.12)' },
  vip:        { icon: 'star-outline',                  color: COLORS.primary,      bg: 'rgba(255,215,0,0.12)' },
  result:     { icon: 'trophy-outline',                color: COLORS.primary,      bg: 'rgba(255,215,0,0.12)' },
};
const FALLBACK_CONFIG: TypeConfig = { icon: 'notifications-outline', emoji: '🔔', color: COLORS.textSecondary, bg: 'rgba(255,255,255,0.08)' };
function getTypeConfig(type: string): TypeConfig { return TYPE_CONFIG[type] ?? FALLBACK_CONFIG; }

// ─── No mock data — show real empty state when DB has no notifications ────────

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rowToNotif(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    body: row.body as string,
    type: (row.type as string) ?? 'general',
    read: (row.read as boolean) ?? false,
    createdAt: row.created_at as string,
  };
}

async function fetchNotifications(userId: string): Promise<Notification[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('notifications').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(50);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(rowToNotif);
  } catch { return []; }
}

async function markOneRead(id: string) {
  try { await getSupabaseClient().from('notifications').update({ read: true }).eq('id', id); } catch { /* ignore */ }
}
async function markAllReadDb(userId: string) {
  try { await getSupabaseClient().from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false); } catch { /* ignore */ }
}

// ─── Translatable Notification Item ──────────────────────────────────────────
function NotifItem({ item, onPress }: { item: Notification; onPress: (id: string) => void }) {
  const cfg = getTypeConfig(item.type);
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();
  const [displayTitle, setDisplayTitle] = useState(item.title);
  const [displayBody, setDisplayBody] = useState(item.body);
  const translatedKeyRef = useRef('');

  useEffect(() => {
    const key = `${item.id}::${language}`;
    if (!needsTranslation || translatedKeyRef.current === key) return;
    translatedKeyRef.current = key;
    Promise.all([
      translate(item.title, 'notification'),
      translate(item.body, 'notification'),
    ]).then(([t, b]) => {
      setDisplayTitle(t);
      setDisplayBody(b);
    }).catch(() => {});
  }, [item.id, language, needsTranslation]);

  // Reset when language switches back to english
  useEffect(() => {
    if (!needsTranslation) {
      setDisplayTitle(item.title);
      setDisplayBody(item.body);
    }
  }, [needsTranslation, item.title, item.body]);

  const { t } = useLocale();
  const timeLabel = React.useMemo(() => {
    const diff = Date.now() - new Date(item.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('notifScreen.justNow');
    if (mins < 60) return t('notifScreen.minAgo').replace('{{count}}', String(mins));
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('notifScreen.hourAgo').replace('{{count}}', String(hrs));
    return t('notifScreen.dayAgo').replace('{{count}}', String(Math.floor(hrs / 24)));
  }, [item.createdAt, t]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        !item.read ? styles.cardUnread : null,
        pressed ? styles.cardPressed : null,
      ]}
      onPress={() => onPress(item.id)}
    >
      <View style={[styles.iconCircle, { backgroundColor: cfg.bg }]}>
        {cfg.emoji ? (
          <Text style={styles.iconEmoji}>{cfg.emoji}</Text>
        ) : (
          <Ionicons name={cfg.icon} size={20} color={cfg.color} />
        )}
      </View>
      <View style={styles.content}>
        <View style={styles.contentTop}>
          <Text style={[styles.notifTitle, !item.read ? styles.notifTitleUnread : null]} numberOfLines={1}>
            {displayTitle}
          </Text>
          {!item.read ? <View style={styles.unreadDot} /> : null}
        </View>
        <Text style={styles.body} numberOfLines={2}>{displayBody}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.typePill, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.typeText, { color: cfg.color }]}>{item.type.toUpperCase()}</Text>
          </View>
          <Text style={styles.time}>{timeLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ t }: { t: (k: string) => string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name="notifications-off-outline" size={40} color={COLORS.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{t('notifScreen.allCaughtUp')}</Text>
      <Text style={styles.emptyBody}>{t('notifScreen.emptyDesc')}</Text>
    </View>
  );
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────
type FilterTab = 'all' | 'unread' | 'coins' | 'referral' | 'challenge';

function filterNotifications(items: Notification[], tab: FilterTab): Notification[] {
  if (tab === 'unread') return items.filter((n) => !n.read);
  if (tab === 'coins') return items.filter((n) => n.type === 'general');
  if (tab === 'referral') return items.filter((n) => n.type === 'referral');
  if (tab === 'challenge') return items.filter((n) => n.type === 'challenge');
  return items;
}

function FilterTabBar({ active, onSelect, counts, t }: { active: FilterTab; onSelect: (tab: FilterTab) => void; counts: Record<FilterTab, number>; t: (k: string) => string }) {
  const tabs: { key: FilterTab; labelKey: string }[] = [
    { key: 'all',       labelKey: 'notifScreen.filterAll' },
    { key: 'unread',    labelKey: 'notifScreen.filterUnread' },
    { key: 'coins',     labelKey: 'notifScreen.filterCoins' },
    { key: 'referral',  labelKey: 'notifScreen.filterReferral' },
    { key: 'challenge', labelKey: 'notifScreen.filterChallenge' },
  ];
  return (
    <View style={tbStyles.wrapper}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tbStyles.scroll}>
        {tabs.map((tab) => {
          const isActive = active === tab.key;
          const count = counts[tab.key];
          return (
            <Pressable
              key={tab.key}
              style={({ pressed }) => [tbStyles.chip, isActive ? tbStyles.chipActive : null, pressed && !isActive ? { opacity: 0.7 } : null]}
              onPress={() => onSelect(tab.key)}
            >
              <Text style={[tbStyles.label, isActive ? tbStyles.labelActive : null]}>{t(tab.labelKey)}</Text>
              {count > 0 ? (
                <View style={[tbStyles.badge, isActive ? tbStyles.badgeActive : null]}>
                  <Text style={[tbStyles.badgeText, isActive ? tbStyles.badgeTextActive : null]}>{count > 99 ? '99+' : String(count)}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const tbStyles = StyleSheet.create({
  wrapper: { backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  scroll: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 10, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  label: { fontSize: 13, fontWeight: FONTS.semiBold, color: COLORS.textMuted },
  labelActive: { color: COLORS.textInverse, fontWeight: FONTS.bold },
  badge: { borderRadius: RADIUS.full, backgroundColor: COLORS.border, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeActive: { backgroundColor: 'rgba(0,0,0,0.25)' },
  badgeText: { fontSize: 10, fontWeight: FONTS.extraBold, color: COLORS.textSecondary, lineHeight: 13 },
  badgeTextActive: { color: COLORS.textInverse },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLocale();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const unreadCount = notifications.filter((n) => !n.read).length;
  const isMock = false;

  const tabCounts: Record<FilterTab, number> = React.useMemo(() => ({
    all:       notifications.length,
    unread:    notifications.filter((n) => !n.read).length,
    coins:     notifications.filter((n) => n.type === 'general').length,
    referral:  notifications.filter((n) => n.type === 'referral').length,
    challenge: notifications.filter((n) => n.type === 'challenge').length,
  }), [notifications]);

  const filteredNotifications = React.useMemo(
    () => filterNotifications(notifications, activeFilter),
    [notifications, activeFilter],
  );

  // Poll notifications every 30s for real-time badge updates
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!user) { setNotifications([]); setLoading(false); return; }
    const data = await fetchNotifications(user.id);
    setNotifications(data);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    pollRef.current = setInterval(() => { if (user) load(); }, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, load]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const handleMarkRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    if (!isMock && user) await markOneRead(id);
  }, [isMock, user]);

  const handleMarkAll = useCallback(async () => {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (!isMock && user) await markAllReadDb(user.id);
    setMarkingAll(false);
  }, [markingAll, unreadCount, isMock, user]);

  // Group by date
  type ListItem = { type: 'header'; label: string } | { type: 'notif'; notif: Notification };
  const listItems: ListItem[] = React.useMemo(() => {
    const items: ListItem[] = [];
    let lastDate = '';
    filteredNotifications.forEach((n: Notification) => {
      const dateStr = new Date(n.createdAt).toDateString();
      const isToday = dateStr === new Date().toDateString();
      const isYesterday = dateStr === new Date(Date.now() - 86400000).toDateString();
      const label = isToday ? t('common.today') : isYesterday ? t('common.yesterday') : new Date(n.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
      if (dateStr !== lastDate) { items.push({ type: 'header', label }); lastDate = dateStr; }
      items.push({ type: 'notif', notif: n });
    });
    return items;
  }, [filteredNotifications, t]);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: COLORS.surface }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>{t('profile.notifications')}</Text>
            {unreadCount > 0 ? (
              <View style={styles.countBadge}><Text style={styles.countText}>{unreadCount}</Text></View>
            ) : null}
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/notification-preferences' as any)} style={styles.gearBtn} hitSlop={8}>
              <Ionicons name="settings-outline" size={20} color={COLORS.textSecondary} />
            </Pressable>
            <Pressable
              style={[styles.markAllBtn, unreadCount === 0 ? styles.markAllDisabled : null]}
              onPress={handleMarkAll}
              disabled={unreadCount === 0 || markingAll}
              hitSlop={6}
            >
              {markingAll ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Text style={[styles.markAllText, unreadCount === 0 ? styles.markAllTextDisabled : null]}>
                  {t('notifScreen.markAllRead')}
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* Removed mock data banner — all notifications are real */}

        <FilterTabBar active={activeFilter} onSelect={setActiveFilter} counts={tabCounts} t={t} />
      </SafeAreaView>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item, index) => item.type === 'header' ? `header-${index}` : item.notif.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, listItems.length === 0 ? styles.listEmpty : null]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          renderItem={({ item }) => {
            if (item.type === 'header') return <Text style={styles.dateHeader}>{item.label}</Text>;
            return <NotifItem item={item.notif} onPress={handleMarkRead} />;
          }}
          ListEmptyComponent={<EmptyState t={t} />}
          ListFooterComponent={<View style={{ height: 32 }} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: FONTS.bold, color: COLORS.textPrimary },
  countBadge: { backgroundColor: COLORS.accentRed, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, minWidth: 22, alignItems: 'center' },
  countText: { fontSize: 11, fontWeight: FONTS.extraBold, color: '#fff' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gearBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  markAllBtn: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 80, alignItems: 'flex-end' },
  markAllDisabled: { opacity: 0.4 },
  markAllText: { fontSize: 12, color: COLORS.primary, fontWeight: FONTS.semiBold },
  markAllTextDisabled: { color: COLORS.textMuted },
  mockBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, paddingVertical: 7, backgroundColor: COLORS.card, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  mockText: { fontSize: 11, color: COLORS.textMuted },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  listEmpty: { flexGrow: 1 },
  dateHeader: { fontSize: 12, fontWeight: FONTS.bold, color: COLORS.textMuted, letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },
  card: { flexDirection: 'row', gap: 12, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  cardUnread: { borderColor: 'rgba(88,166,255,0.35)', backgroundColor: 'rgba(88,166,255,0.06)' },
  cardPressed: { opacity: 0.82, transform: [{ scale: 0.988 }] },
  iconCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconEmoji: { fontSize: 22, lineHeight: 26, textAlign: 'center', includeFontPadding: false } as any,
  content: { flex: 1, gap: 4 },
  contentTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notifTitle: { flex: 1, fontSize: 14, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  notifTitleUnread: { color: COLORS.textPrimary, fontWeight: FONTS.bold },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accentBlue, flexShrink: 0 },
  body: { fontSize: 13, color: COLORS.textMuted, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  typePill: { borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  typeText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  time: { fontSize: 11, color: COLORS.textMuted, flex: 1, textAlign: 'right' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, paddingTop: 60 },
  emptyIconCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, marginBottom: 4 },
  emptyTitle: { fontSize: 20, fontWeight: FONTS.bold, color: COLORS.textSecondary },
  emptyBody: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 22 },
});
