import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { getSupabaseClient, useAuth } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface CoinTransaction {
  id: string;
  type: 'general' | 'referral' | 'challenge';
  title: string;
  body: string;
  amount: number;           // positive = earn, negative = spend
  balanceAfter: number;     // running balance after this tx
  createdAt: string;
}

// ─── Parse coin amount from notification body ─────────────────────────────────
function parseCoinAmount(title: string, body: string): number {
  // Explicit "+N coins" → earn
  const plusMatch = body.match(/\+(\d+)\s*coins?/i) ?? title.match(/\+(\d+)/i);
  if (plusMatch) return parseInt(plusMatch[1], 10);

  // "spent N coins" → spend
  const spentMatch = body.match(/spent\s+(\d+)\s*coins?/i);
  if (spentMatch) return -parseInt(spentMatch[1], 10);

  // Fallback: bare "N coins" → earn
  const bareMatch = body.match(/(\d+)\s*coins?/i);
  if (bareMatch) return parseInt(bareMatch[1], 10);

  return 0;
}

// ─── Type metadata ─────────────────────────────────────────────────────────────
interface TxMeta {
  emoji: string;
  label: string;
  earnColor: string;
  spendColor: string;
}

function getTxMeta(type: string, C: AppColors): TxMeta {
  switch (type) {
    case 'referral':
      return { emoji: '🎉', label: 'Referral', earnColor: C.accent, spendColor: C.accentRed };
    case 'challenge':
      return { emoji: '🏆', label: 'Challenge', earnColor: C.primary, spendColor: C.accentRed };
    default: // 'general' = unlock
      return { emoji: '🔓', label: 'Unlock', earnColor: C.accent, spendColor: C.accentRed };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── DB fetch ─────────────────────────────────────────────────────────────────
async function fetchCoinNotifications(userId: string): Promise<{
  rows: Array<{ id: string; type: string; title: string; body: string; created_at: string }>;
  balance: number;
}> {
  try {
    const supabase = getSupabaseClient();
    const [notifResult, balanceResult] = await Promise.all([
      supabase
        .from('notifications')
        .select('id, type, title, body, created_at')
        .eq('user_id', userId)
        .in('type', ['general', 'referral', 'challenge'])
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('user_coins')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    const rows = (notifResult.data ?? []) as Array<{
      id: string; type: string; title: string; body: string; created_at: string;
    }>;
    const balance = (balanceResult.data as { balance: number } | null)?.balance ?? 0;
    return { rows, balance };
  } catch {
    return { rows: [], balance: 0 };
  }
}

// ─── Transaction Row ──────────────────────────────────────────────────────────
function TxRow({ item, C }: { item: CoinTransaction; C: AppColors }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getTxMeta(item.type, C);
  const isEarn = item.amount >= 0;
  const amountColor = isEarn ? C.accent : C.accentRed;
  const amountLabel = isEarn ? `+${item.amount}` : `${item.amount}`;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.txRow,
        { backgroundColor: C.card, borderColor: C.border },
        pressed ? { opacity: 0.88, transform: [{ scale: 0.995 }] } : null,
      ]}
      onPress={() => setExpanded((v) => !v)}
    >
      {/* Left: icon bubble */}
      <View style={[
        styles.txIcon,
        {
          backgroundColor: isEarn ? `${C.accent}18` : `${C.accentRed}18`,
          borderColor: isEarn ? `${C.accent}33` : `${C.accentRed}33`,
        },
      ]}>
        <Text style={styles.txEmoji}>{meta.emoji}</Text>
      </View>

      {/* Center: title + body */}
      <View style={styles.txContent}>
        <Text style={[styles.txTitle, { color: C.textPrimary }]} numberOfLines={1}>
          {item.title}
        </Text>
        {expanded ? (
          <Text style={[styles.txBody, { color: C.textSecondary }]}>{item.body}</Text>
        ) : null}
        <View style={styles.txMeta}>
          <View style={[styles.txTypePill, { backgroundColor: isEarn ? `${C.accent}18` : `${C.accentRed}18` }]}>
            <Text style={[styles.txTypeText, { color: isEarn ? C.accent : C.accentRed }]}>
              {meta.label}
            </Text>
          </View>
          <Text style={[styles.txTime, { color: C.textMuted }]}>{timeAgo(item.createdAt)}</Text>
          {expanded ? (
            <Text style={[styles.txFullDate, { color: C.textMuted }]}>{fullDate(item.createdAt)}</Text>
          ) : null}
        </View>
      </View>

      {/* Right: amount + balance */}
      <View style={styles.txRight}>
        <Text style={[styles.txAmount, { color: amountColor }]}>{amountLabel}</Text>
        <View style={styles.txBalanceRow}>
          <FontAwesome5 name="coins" size={8} color={C.textMuted} solid />
          <Text style={[styles.txBalance, { color: C.textMuted }]}>{item.balanceAfter}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={12}
          color={C.textMuted}
          style={styles.txChevron}
        />
      </View>
    </Pressable>
  );
}

// ─── Date group header ─────────────────────────────────────────────────────────
function DateHeader({ label, C }: { label: string; C: AppColors }) {
  return (
    <View style={[styles.dateHeader, { borderBottomColor: C.border }]}>
      <Text style={[styles.dateHeaderText, { color: C.textMuted }]}>{label}</Text>
    </View>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ C }: { C: AppColors }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: C.card, borderColor: C.border }]}>
        <FontAwesome5 name="coins" size={34} color={C.textMuted} />
      </View>
      <Text style={[styles.emptyTitle, { color: C.textSecondary }]}>No Coin Activity Yet</Text>
      <Text style={[styles.emptyBody, { color: C.textMuted }]}>
        Earn coins by completing the Daily Challenge, referring friends, or purchasing coin packs.
      </Text>
    </View>
  );
}

// ─── Summary Card ──────────────────────────────────────────────────────────────
function SummaryCard({
  balance, totalEarned, totalSpent, txCount, C,
}: {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  txCount: number;
  C: AppColors;
}) {
  return (
    <View style={[styles.summaryCard, { borderColor: 'rgba(255,215,0,0.3)' }]}>
      {/* Balance */}
      <View style={styles.summaryBalance}>
        <View style={[styles.summaryIconWrap, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.35)' }]}>
          <FontAwesome5 name="coins" size={20} color={C.primary} solid />
        </View>
        <View>
          <Text style={[styles.summaryBalanceLabel, { color: C.textMuted }]}>Current Balance</Text>
          <View style={styles.summaryBalanceRow}>
            <Text style={[styles.summaryBalanceNum, { color: C.primary }]}>{balance.toLocaleString()}</Text>
            <Text style={[styles.summaryBalanceUnit, { color: C.textMuted }]}>coins</Text>
          </View>
        </View>
      </View>

      {/* Divider */}
      <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,215,0,0.12)' }]} />

      {/* Stats row */}
      <View style={styles.summaryStats}>
        <View style={styles.summaryStat}>
          <Text style={[styles.summaryStatNum, { color: C.accent }]}>+{totalEarned.toLocaleString()}</Text>
          <Text style={[styles.summaryStatLabel, { color: C.textMuted }]}>Earned</Text>
        </View>
        <View style={[styles.summaryStatDiv, { backgroundColor: C.border }]} />
        <View style={styles.summaryStat}>
          <Text style={[styles.summaryStatNum, { color: C.accentRed }]}>{totalSpent.toLocaleString()}</Text>
          <Text style={[styles.summaryStatLabel, { color: C.textMuted }]}>Spent</Text>
        </View>
        <View style={[styles.summaryStatDiv, { backgroundColor: C.border }]} />
        <View style={styles.summaryStat}>
          <Text style={[styles.summaryStatNum, { color: C.textSecondary }]}>{txCount}</Text>
          <Text style={[styles.summaryStatLabel, { color: C.textMuted }]}>Transactions</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CoinHistoryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors: C } = useTheme();

  const [rawBalance, setRawBalance] = useState(0);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Load data ────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!user?.id) { setLoading(false); return; }
    if (!silent) setLoading(true);

    const { rows, balance } = await fetchCoinNotifications(user.id);
    setRawBalance(balance);

    // Build transactions with running balance (newest → oldest)
    // balance is current — we walk backwards subtracting each amount
    let running = balance;
    const txs: CoinTransaction[] = rows.map((row) => {
      const amount = parseCoinAmount(row.title, row.body);
      const balanceAfter = running;
      running -= amount;
      return {
        id: row.id,
        type: row.type as CoinTransaction['type'],
        title: row.title,
        body: row.body,
        amount,
        balanceAfter,
        createdAt: row.created_at,
      };
    });

    setTransactions(txs);
    setLoading(false);
    setRefreshing(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  // ── Derived stats ────────────────────────────────────────────────────────
  const { totalEarned, totalSpent } = useMemo(() => {
    let earned = 0;
    let spent = 0;
    transactions.forEach((tx) => {
      if (tx.amount > 0) earned += tx.amount;
      else spent += tx.amount; // negative
    });
    return { totalEarned: earned, totalSpent: spent };
  }, [transactions]);

  // ── Build grouped list items ──────────────────────────────────────────────
  type ListItem =
    | { kind: 'header'; label: string }
    | { kind: 'tx'; tx: CoinTransaction };

  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];
    let lastDate = '';
    transactions.forEach((tx) => {
      const dateStr = new Date(tx.createdAt).toDateString();
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      const label =
        dateStr === today
          ? 'Today'
          : dateStr === yesterday
          ? 'Yesterday'
          : new Date(tx.createdAt).toLocaleDateString([], {
              weekday: 'short', month: 'short', day: 'numeric',
            });
      if (dateStr !== lastDate) {
        items.push({ kind: 'header', label });
        lastDate = dateStr;
      }
      items.push({ kind: 'tx', tx });
    });
    return items;
  }, [transactions]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[styles.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: C.textPrimary }]}>Coin History</Text>
          </View>
          {/* Earn more shortcut */}
          <Pressable
            style={({ pressed }) => [
              styles.earnBtn,
              { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.35)' },
              pressed ? { opacity: 0.78 } : null,
            ]}
            onPress={() => router.push('/vip' as any)}
            hitSlop={6}
          >
            <FontAwesome5 name="plus" size={10} color={C.primary} />
            <Text style={[styles.earnBtnText, { color: C.primary }]}>Earn</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[styles.loaderText, { color: C.textMuted }]}>Loading coin history...</Text>
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item, idx) =>
            item.kind === 'header' ? `hdr-${idx}` : item.tx.id
          }
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
            />
          }
          ListHeaderComponent={
            <>
              {/* Summary card */}
              <View style={styles.summaryWrap}>
                <SummaryCard
                  balance={rawBalance}
                  totalEarned={totalEarned}
                  totalSpent={Math.abs(totalSpent)}
                  txCount={transactions.length}
                  C={C}
                />
              </View>

              {/* Legend */}
              {transactions.length > 0 ? (
                <View style={[styles.legend, { borderColor: C.border }]}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: C.accent }]} />
                    <Text style={[styles.legendText, { color: C.textMuted }]}>Earned</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: C.accentRed }]} />
                    <Text style={[styles.legendText, { color: C.textMuted }]}>Spent</Text>
                  </View>
                  <Text style={[styles.legendTip, { color: C.textMuted }]}>
                    Tap a row to expand
                  </Text>
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={<EmptyState C={C} />}
          ListFooterComponent={
            transactions.length > 0 ? (
              <View style={[styles.footer, { borderTopColor: C.border }]}>
                <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
                <Text style={[styles.footerText, { color: C.textMuted }]}>
                  Showing last {transactions.length} coin transactions
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={[
            styles.list,
            listItems.length === 0 ? styles.listEmpty : null,
          ]}
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return <DateHeader label={item.label} C={C} />;
            }
            return <TxRow item={item.tx} C={C} />;
          }}
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: FONTS.bold },
  earnBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1,
  },
  earnBtnText: { fontSize: 12, fontWeight: FONTS.bold },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText: { fontSize: 13 },

  list: { paddingHorizontal: SPACING.md, paddingBottom: 40 },
  listEmpty: { flexGrow: 1 },

  // Summary card
  summaryWrap: { paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  summaryCard: {
    borderRadius: RADIUS.xl, overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: '#1A1400',
  },
  summaryBalance: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16,
  },
  summaryIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0,
  },
  summaryBalanceLabel: { fontSize: 11, fontWeight: FONTS.semiBold, letterSpacing: 0.5 },
  summaryBalanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 3 },
  summaryBalanceNum: { fontSize: 34, fontWeight: FONTS.extraBold, lineHeight: 38 },
  summaryBalanceUnit: { fontSize: 14 },
  summaryDivider: { height: 1 },
  summaryStats: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 16,
  },
  summaryStat: { flex: 1, alignItems: 'center', gap: 3 },
  summaryStatNum: { fontSize: 17, fontWeight: FONTS.extraBold },
  summaryStatLabel: { fontSize: 10, fontWeight: FONTS.medium },
  summaryStatDiv: { width: 1, height: 30 },

  // Legend
  legend: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 10, marginBottom: 4,
    borderTopWidth: 1, borderBottomWidth: 1,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: FONTS.medium },
  legendTip: { flex: 1, fontSize: 10, textAlign: 'right' },

  // Date header
  dateHeader: {
    paddingVertical: 8, paddingHorizontal: 2, marginTop: 6,
    borderBottomWidth: 1,
    marginBottom: 6,
  },
  dateHeaderText: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },

  // Transaction row
  txRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: RADIUS.lg, padding: 12,
    borderWidth: 1,
  },
  txIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, flexShrink: 0,
  },
  txEmoji: { fontSize: 20, lineHeight: 24, textAlign: 'center' },
  txContent: { flex: 1, gap: 4 },
  txTitle: { fontSize: 14, fontWeight: FONTS.semiBold },
  txBody: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  txMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  txTypePill: {
    borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2,
  },
  txTypeText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.7 },
  txTime: { fontSize: 11 },
  txFullDate: { fontSize: 10 },
  txRight: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  txAmount: { fontSize: 18, fontWeight: FONTS.extraBold },
  txBalanceRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  txBalance: { fontSize: 11, fontWeight: FONTS.medium },
  txChevron: { marginTop: 2 },

  // Footer
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingTop: 16, borderTopWidth: 1, marginTop: 10,
  },
  footerText: { fontSize: 11, flex: 1 },

  // Empty
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 14, paddingHorizontal: 40, paddingTop: 60,
  },
  emptyIcon: {
    width: 92, height: 92, borderRadius: 46,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 4,
  },
  emptyTitle: { fontSize: 20, fontWeight: FONTS.bold, textAlign: 'center' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
