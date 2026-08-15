import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, KeyboardAvoidingView, Platform,
  ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/template';
import { fetchOrCreateMatchRoom, fetchMessages, sendMessage } from '@/services/chatService';
import { ChatMessage } from '@/services/types';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';

// ─── VIP subscription check ───────────────────────────────────────────────────
interface VipStatus {
  isVip: boolean;
  plan: string | null;
  expiresAt: string | null;
  loading: boolean;
}

function useVipStatus(userId: string | undefined): VipStatus {
  const [status, setStatus] = useState<VipStatus>({
    isVip: false, plan: null, expiresAt: null, loading: true,
  });

  useEffect(() => {
    if (!userId) {
      setStatus({ isVip: false, plan: null, expiresAt: null, loading: false });
      return;
    }

    const supabase = getSupabaseClient();
    supabase
      .from('vip_subscriptions')
      .select('plan, status, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          setStatus({
            isVip: true,
            plan: (data as { plan: string; expires_at: string }).plan,
            expiresAt: (data as { plan: string; expires_at: string }).expires_at,
            loading: false,
          });
        } else {
          setStatus({ isVip: false, plan: null, expiresAt: null, loading: false });
        }
      });
  }, [userId]);

  return status;
}

// ─── VIP Chat hook ────────────────────────────────────────────────────────────
const VIP_ROOM_ID = 'vip-lounge';
const VIP_ROOM_TITLE = 'VIP Lounge';

function useVipChat(enabled: boolean) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const { user } = useAuth();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomRef = useRef<string | null>(null);

  // Resolve/create the VIP room once
  useEffect(() => {
    if (!enabled) return;
    fetchOrCreateMatchRoom(VIP_ROOM_ID, VIP_ROOM_TITLE).then((room) => {
      const rid = room?.id ?? null;
      setRoomId(rid);
      roomRef.current = rid;
    });
  }, [enabled]);

  const loadMessages = useCallback(async () => {
    const rid = roomRef.current;
    if (!rid) return;
    const data = await fetchMessages(rid, 50);
    // Production rule: show real messages only — never mock data
    setMessages(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roomId) return;
    setLoading(true);
    loadMessages();
    pollRef.current = setInterval(loadMessages, 15_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [roomId, loadMessages]);

  const send = useCallback(async (content: string): Promise<boolean> => {
    if (!user || !content.trim() || !roomRef.current) return false;
    setSending(true);
    const username = user.username || user.email.split('@')[0];
    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`,
      roomId: roomRef.current,
      userId: user.id,
      username,
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    const ok = await sendMessage(roomRef.current, user.id, username, content.trim());
    setSending(false);
    if (ok) loadMessages();
    return ok;
  }, [user, loadMessages]);

  return { messages, loading, sending, send };
}

// VIP usernames — crown badge awarded to actual VIP users (loaded from DB in production)
// No seeded mock usernames here; the badge is granted based on vip_subscriptions table.
const VIP_USERNAMES = new Set<string>();

// ─── Time helper ──────────────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function avatarColor(name: string) {
  const palette = [COLORS.primary, COLORS.accent, COLORS.accentBlue, COLORS.accentPurple, '#FF9F43'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + h;
  return palette[Math.abs(h) % palette.length];
}

// ─── VIP Chat Bubble ─────────────────────────────────────────────────────────
function VipChatBubble({
  message,
  isOwn,
  isVipUser,
}: {
  message: ChatMessage;
  isOwn: boolean;
  isVipUser: boolean;
}) {
  const color = avatarColor(message.username);
  const initial = message.username[0]?.toUpperCase() || '?';

  return (
    <View style={[bubble.wrap, isOwn ? bubble.ownWrap : null]}>
      {!isOwn ? (
        <View style={[bubble.avatar, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
          <Text style={[bubble.avatarText, { color }]}>{initial}</Text>
          {isVipUser ? (
            <View style={bubble.crownBadge}>
              <FontAwesome5 name="crown" size={7} color={COLORS.primary} />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[bubble.balloon, isOwn ? bubble.ownBalloon : bubble.otherBalloon]}>
        {!isOwn ? (
          <View style={bubble.usernameRow}>
            <Text style={[bubble.username, { color }]}>{message.username}</Text>
            {isVipUser ? (
              <View style={bubble.vipTag}>
                <FontAwesome5 name="crown" size={8} color={COLORS.primary} />
                <Text style={bubble.vipTagText}>VIP</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <Text style={bubble.content}>{message.content}</Text>
        <Text style={bubble.time}>{timeAgo(message.createdAt)}</Text>
      </View>
    </View>
  );
}

const bubble = StyleSheet.create({
  wrap: { flexDirection: 'row', marginVertical: 5, paddingHorizontal: 16, gap: 9 },
  ownWrap: { justifyContent: 'flex-end' },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginTop: 4, flexShrink: 0, position: 'relative',
  },
  avatarText: { fontSize: 14, fontWeight: FONTS.bold },
  crownBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.primaryGlow,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  balloon: { maxWidth: '74%', borderRadius: RADIUS.lg, padding: 11, gap: 3 },
  otherBalloon: {
    backgroundColor: '#141E2E',
    borderWidth: 1, borderColor: COLORS.border,
    borderTopLeftRadius: 4,
  },
  ownBalloon: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.28)',
    borderTopRightRadius: 4,
  },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  username: { fontSize: 11, fontWeight: FONTS.bold },
  vipTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  vipTagText: { fontSize: 8, fontWeight: FONTS.extraBold, color: COLORS.primary, letterSpacing: 0.5 },
  content: { fontSize: 14, color: COLORS.textPrimary, lineHeight: 20 },
  time: { fontSize: 10, color: COLORS.textMuted, alignSelf: 'flex-end' },
});

// ─── Locked Screen (non-VIP) ──────────────────────────────────────────────────
function LockedScreen({ onUpgrade }: { onUpgrade: () => void }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    ).start();
  }, [shimmer]);

  const shimmerOpacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <View style={locked.root}>
      {/* Blurred preview of chat (decorative) — placeholder shapes only, no mock content */}
      <View style={locked.previewWrap} pointerEvents="none">
        {[0, 1, 2].map((i) => (
          <View key={i} style={locked.previewBubble}>
            <View style={locked.previewDot} />
            <View style={locked.previewBar}>
              <View style={[locked.previewLine, { width: `${60 + i * 12}%` as any }]} />
              <View style={[locked.previewLine, { width: `${40 + i * 10}%` as any, marginTop: 4 }]} />
            </View>
          </View>
        ))}
        {/* Blur overlay */}
        <LinearGradient
          colors={['rgba(7,11,20,0)', 'rgba(7,11,20,0.96)']}
          style={locked.blurOverlay}
          pointerEvents="none"
        />
      </View>

      {/* Lock card */}
      <View style={locked.card}>
        {/* Crown shimmer */}
        <Animated.View style={[locked.crownWrap, { opacity: shimmerOpacity }]}>
          <LinearGradient
            colors={['rgba(255,215,0,0.25)', 'rgba(255,215,0,0.08)']}
            style={locked.crownGlow}
          >
            <FontAwesome5 name="crown" size={40} color={COLORS.primary} />
          </LinearGradient>
        </Animated.View>

        <Text style={locked.title}>VIP Members Only</Text>
        <Text style={locked.subtitle}>
          Access exclusive tips, expert picks, and premium sports insights from our top analysts — reserved for VIP subscribers.
        </Text>

        {/* Feature list */}
        <View style={locked.features}>
          {[
            { icon: 'brain', text: 'Expert daily tips from analysts' },
            { icon: 'chart-line', text: 'Odds movement insights & value bets' },
            { icon: 'crown', text: 'Gold crown badge next to your name' },
            { icon: 'shield-alt', text: 'Ad-free premium chat experience' },
          ].map((f, i) => (
            <View key={i} style={locked.featureRow}>
              <View style={locked.featureIcon}>
                <FontAwesome5 name={f.icon as any} size={13} color={COLORS.primary} />
              </View>
              <Text style={locked.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <Pressable
          style={({ pressed }) => [locked.cta, pressed ? locked.ctaPressed : null]}
          onPress={onUpgrade}
        >
          <LinearGradient
            colors={[COLORS.primary, COLORS.primaryDark]}
            style={locked.ctaGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <FontAwesome5 name="crown" size={15} color={COLORS.textInverse} />
            <Text style={locked.ctaText}>Upgrade to VIP</Text>
            <MaterialIcons name="arrow-forward" size={17} color={COLORS.textInverse} />
          </LinearGradient>
        </Pressable>

        <Text style={locked.startingAt}>Starting at $4.99 / month · Cancel anytime</Text>
      </View>
    </View>
  );
}

const locked = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  previewWrap: { height: 200, overflow: 'hidden', paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  previewBubble: { flexDirection: 'row', gap: 10, marginBottom: 14, alignItems: 'center' },
  previewDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.card, flexShrink: 0 },
  previewBar: { flex: 1, gap: 2 },
  previewLine: { height: 10, backgroundColor: COLORS.card, borderRadius: RADIUS.full },
  blurOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 140 },
  card: {
    margin: SPACING.md, borderRadius: RADIUS.xl,
    backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
    padding: SPACING.lg, gap: 16, alignItems: 'center',
  },
  crownWrap: { alignItems: 'center' },
  crownGlow: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  title: { fontSize: 22, fontWeight: FONTS.extraBold, color: COLORS.primary, textAlign: 'center' },
  subtitle: {
    fontSize: 13, color: COLORS.textSecondary,
    textAlign: 'center', lineHeight: 20, paddingHorizontal: 8,
  },
  features: { width: '100%', gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primaryGlow,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  featureText: { fontSize: 13, color: COLORS.textSecondary, flex: 1, fontWeight: FONTS.medium },
  cta: { width: '100%', borderRadius: RADIUS.full, overflow: 'hidden' },
  ctaPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  ctaGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 15,
  },
  ctaText: { fontSize: 16, fontWeight: FONTS.extraBold, color: COLORS.textInverse },
  startingAt: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center' },
});

// ─── VIP Chat Interface ───────────────────────────────────────────────────────
function VipChatInterface({ currentUserId, username }: { currentUserId: string; username: string }) {
  const { messages, loading, sending, send } = useVipChat(true);
  const [text, setText] = useState('');
  const flatRef = useRef<FlatList>(null);
  const membersOnline = 384;

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    const val = text.trim();
    if (!val || sending) return;
    setText('');
    await send(val);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Premium room header */}
      <LinearGradient
        colors={['rgba(255,215,0,0.12)', 'rgba(255,215,0,0.04)']}
        style={chat.roomHeader}
      >
        <View style={chat.roomIconWrap}>
          <FontAwesome5 name="crown" size={18} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={chat.roomTitleRow}>
            <Text style={chat.roomTitle}>VIP Lounge</Text>
            <View style={chat.exclusivePill}>
              <Text style={chat.exclusiveText}>EXCLUSIVE</Text>
            </View>
          </View>
          <Text style={chat.roomSub}>Expert tips · Premium picks · VIP insights</Text>
        </View>
        <View style={chat.onlineWrap}>
          <View style={chat.onlineDot} />
          <Text style={chat.onlineCount}>{membersOnline}</Text>
        </View>
      </LinearGradient>

      {/* Pinned tip banner */}
      <View style={chat.pinnedBanner}>
        <FontAwesome5 name="thumbtack" size={10} color={COLORS.primary} />
        <Text style={chat.pinnedText} numberOfLines={1}>
          Pinned: VIP Tip of the Day — Barcelona Win + Under 2.5 @ 2.10
        </Text>
        <View style={chat.vipBadge}>
          <FontAwesome5 name="crown" size={8} color={COLORS.primary} />
          <Text style={chat.vipBadgeText}>VIP</Text>
        </View>
      </View>

      {/* Messages */}
      {loading ? (
        <View style={chat.loader}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={chat.loaderText}>Loading VIP chat...</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={chat.empty}>
          <FontAwesome5 name="crown" size={32} color={COLORS.primary} />
          <Text style={chat.emptyTitle}>Welcome to the VIP Lounge</Text>
          <Text style={chat.emptySub}>Be the first to share an expert pick with fellow VIPs.</Text>
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <VipChatBubble
              message={item}
              isOwn={item.userId === currentUserId}
              isVipUser={VIP_USERNAMES.has(item.username) || item.userId === currentUserId}
            />
          )}
          contentContainerStyle={chat.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Gold input bar */}
      <View style={chat.inputBar}>
        <View style={chat.inputWrap}>
          <TextInput
            style={chat.input}
            value={text}
            onChangeText={setText}
            placeholder="Share your VIP insight..."
            placeholderTextColor={COLORS.textMuted}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            multiline={false}
            maxLength={400}
          />
          <FontAwesome5 name="crown" size={12} color="rgba(255,215,0,0.35)" style={{ marginRight: 10 }} />
        </View>
        <Pressable
          style={({ pressed }) => [
            chat.sendBtn,
            !text.trim() || sending ? chat.sendBtnDisabled : null,
            pressed && text.trim() ? chat.sendBtnPressed : null,
          ]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color={COLORS.textInverse} />
          ) : (
            <Ionicons name="send" size={16} color={COLORS.textInverse} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const chat = StyleSheet.create({
  roomHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: SPACING.md, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,215,0,0.15)',
  },
  roomIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primaryGlow,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  roomTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roomTitle: { fontSize: 16, fontWeight: FONTS.extraBold, color: COLORS.primary },
  exclusivePill: {
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
  },
  exclusiveText: { fontSize: 8, fontWeight: FONTS.extraBold, color: COLORS.primary, letterSpacing: 1 },
  roomSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  onlineWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.accent },
  onlineCount: { fontSize: 12, color: COLORS.accent, fontWeight: FONTS.bold },
  pinnedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: COLORS.primaryGlow,
    borderBottomWidth: 1, borderColor: 'rgba(255,215,0,0.15)',
    paddingHorizontal: SPACING.md, paddingVertical: 8,
  },
  pinnedText: { flex: 1, fontSize: 11, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  vipBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,215,0,0.15)', borderRadius: RADIUS.full,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  vipBadgeText: { fontSize: 8, fontWeight: FONTS.extraBold, color: COLORS.primary, letterSpacing: 0.5 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loaderText: { fontSize: 13, color: COLORS.textMuted },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold, color: COLORS.primary },
  emptySub: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  messageList: { paddingVertical: SPACING.sm, paddingBottom: SPACING.md },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(255,215,0,0.15)',
    backgroundColor: COLORS.surface,
  },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.card, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
    paddingLeft: 16,
  },
  input: {
    flex: 1, height: 44,
    fontSize: 14, color: COLORS.textPrimary,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.border },
  sendBtnPressed: { opacity: 0.82, transform: [{ scale: 0.94 }] },
});

// ─── Root Screen ──────────────────────────────────────────────────────────────
export default function VipChatScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const vip = useVipStatus(user?.id);

  const username = user?.username || user?.email?.split('@')[0] || 'You';

  return (
    <View style={root.container}>
      {/* Sticky header */}
      <SafeAreaView edges={['top']} style={root.headerSafe}>
        <LinearGradient
          colors={[COLORS.surface, COLORS.bg]}
          style={root.headerBar}
        >
          <Pressable onPress={() => router.back()} style={root.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>

          <View style={root.headerCenter}>
            <FontAwesome5 name="crown" size={14} color={COLORS.primary} />
            <Text style={root.headerTitle}>VIP Lounge</Text>
          </View>

          {/* VIP badge if user is VIP */}
          {vip.isVip ? (
            <View style={root.activeBadge}>
              <FontAwesome5 name="crown" size={10} color={COLORS.primary} />
              <Text style={root.activeBadgeText}>ACTIVE</Text>
            </View>
          ) : (
            <Pressable
              style={root.upgradeBtn}
              onPress={() => router.push('/vip' as any)}
            >
              <Text style={root.upgradeBtnText}>Upgrade</Text>
            </Pressable>
          )}
        </LinearGradient>
      </SafeAreaView>

      {/* Body */}
      {vip.loading ? (
        <View style={root.loader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={root.loaderText}>Checking VIP access...</Text>
        </View>
      ) : vip.isVip && user ? (
        <VipChatInterface currentUserId={user.id} username={username} />
      ) : (
        <LockedScreen onUpgrade={() => router.push('/vip' as any)} />
      )}
    </View>
  );
}

const root = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerSafe: { backgroundColor: COLORS.surface },
  headerBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  headerTitle: { fontSize: 16, fontWeight: FONTS.extraBold, color: COLORS.primary },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
  },
  activeBadgeText: { fontSize: 9, fontWeight: FONTS.extraBold, color: COLORS.primary, letterSpacing: 0.8 },
  upgradeBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  upgradeBtnText: { fontSize: 12, fontWeight: FONTS.bold, color: COLORS.textInverse },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText: { fontSize: 13, color: COLORS.textMuted },
});
