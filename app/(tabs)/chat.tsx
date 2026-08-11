/**
 * CHAT — AI Sports Intelligence Community Hub
 * Next-generation backend-driven UI
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator,
  RefreshControl, TextInput, Keyboard, ScrollView, Modal,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useChat } from '@/hooks/useChat';
import type { ChatRoom } from '@/services/types';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth, getSupabaseClient } from '@/template';
import type { AppColors } from '@/constants/theme';
import { FunctionsHttpError } from '@supabase/supabase-js';

const JOINED_KEY = '@predictxta/joined_rooms';
const SEEN_MAP_KEY = '@predictxta/chat_room_seen_map';

const SPORT_FILTERS = [
  { key: 'all', label: 'All', emoji: '🌟', kws: [] as string[] },
  { key: 'football', label: 'Football', emoji: '⚽', kws: ['football', 'soccer', 'ucl', 'premier', 'liga', 'bundesliga', 'champions', 'match', 'fifa'] },
  { key: 'basketball', label: 'Basketball', emoji: '🏀', kws: ['basketball', 'nba', 'hoops'] },
  { key: 'tennis', label: 'Tennis', emoji: '🎾', kws: ['tennis', 'atp', 'wta', 'grand', 'slam'] },
  { key: 'mma', label: 'MMA', emoji: '🥊', kws: ['mma', 'ufc', 'fight', 'boxing'] },
] as const;
type SportFilter = typeof SPORT_FILTERS[number]['key'];

const FALLBACK_ROOMS: ChatRoom[] = [
  { id: 'f1', name: 'General Sports', description: 'Talk about any sport, any time', type: 'public', emoji: '🏆', membersCount: 1842, createdAt: '' },
  { id: 'f2', name: 'Football Predictions', description: 'Share and discuss football tips', type: 'public', emoji: '⚽', membersCount: 3421, createdAt: '' },
  { id: 'f3', name: 'UCL Discussion', description: 'Champions League matchday chat', type: 'public', emoji: '🌟', membersCount: 2187, createdAt: '' },
  { id: 'f4', name: 'NBA Corner', description: 'Basketball talk and game previews', type: 'public', emoji: '🏀', membersCount: 967, createdAt: '' },
  { id: 'f5', name: 'Tennis Talk', description: 'Grand slams, ATP, WTA discussion', type: 'public', emoji: '🎾', membersCount: 612, createdAt: '' },
  { id: 'f6', name: 'VIP Lounge', description: 'Exclusive tips for VIP members', type: 'public', emoji: '👑', membersCount: 384, createdAt: '' },
];

// ─── AI Chat ──────────────────────────────────────────────────────────────────
interface AIChatMsg { id: string; role: 'user' | 'assistant'; content: string; timestamp: number; }

const AI_PROMPTS = [
  { label: 'Best picks today', prompt: 'What are the top 3 AI picks for today with confidence levels and reasoning?' },
  { label: 'Live betting tips', prompt: 'Any live betting opportunities right now? What looks like good value?' },
  { label: 'Build accumulator', prompt: 'Build me a 3-match accumulator for today with good value and reasoning.' },
  { label: 'Explain Over/Under', prompt: 'Explain Over/Under betting with examples. When is Over 2.5 goals a good bet?' },
  { label: 'Today\'s football', prompt: 'Analyze the main football fixtures today. Which has highest confidence prediction?' },
  { label: 'Asian Handicap', prompt: 'Explain Asian Handicap betting with examples. When should I use it vs 1X2?' },
];

function TypingDots({ C }: { C: AppColors }) {
  const [step, setStep] = useState(0);
  useEffect(() => { const id = setInterval(() => setStep(s => (s + 1) % 3), 450); return () => clearInterval(id); }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 4 }}>
      {[0, 1, 2].map(i => <View key={i} style={[ai.dot, { backgroundColor: i === step ? C.primary : C.border }]} />)}
    </View>
  );
}

function FormattedText({ text, isUser, C }: { text: string; isUser: boolean; C: AppColors }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={[ai.bubbleText, { color: isUser ? '#000' : C.textPrimary }]}>
      {parts.map((p, i) => p.startsWith('**') && p.endsWith('**')
        ? <Text key={i} style={{ fontWeight: '900' }}>{p.slice(2, -2)}</Text>
        : <Text key={i}>{p}</Text>
      )}
    </Text>
  );
}

function AIAssistant({ visible, onClose, C }: { visible: boolean; onClose: () => void; C: AppColors }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<AIChatMsg[]>([{
    id: 'welcome', role: 'assistant', timestamp: Date.now(),
    content: "👋 Hi! I'm **PX Analyst** — your AI Sports Intelligence Assistant.\n\nAsk me about match analysis, predictions, value bets, team comparisons, or betting strategies.",
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [liveCtx, setLiveCtx] = useState<any>(null);
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const sb = getSupabaseClient();
        const [liveR, upR, predR] = await Promise.allSettled([
          sb.from('matches').select('home_team,away_team,home_score,away_score,league,minute').eq('status', 'live').limit(5),
          sb.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'upcoming').gte('match_time', new Date().toISOString().slice(0, 10)),
          sb.from('predictions').select('match_id,confidence,predicted_result').order('confidence', { ascending: false }).limit(3),
        ]);
        const liveMatches = liveR.status === 'fulfilled' ? (liveR.value.data ?? []).map((r: any) => ({ homeTeam: r.home_team, awayTeam: r.away_team, homeScore: r.home_score, awayScore: r.away_score, league: r.league, minute: r.minute })) : [];
        const todayMatches = upR.status === 'fulfilled' ? (upR.value.count ?? 0) : 0;
        setLiveCtx({ liveMatches, todayMatches, topPredictions: [] });
      } catch { /* ignore */ }
    })();
  }, [visible]);

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput('');
    Keyboard.dismiss();
    const userMsg: AIChatMsg = { id: `u-${Date.now()}`, role: 'user', content, timestamp: Date.now() };
    setMsgs(p => [...p, userMsg]);
    setLoading(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const sb = getSupabaseClient();
      const apiMsgs = [...msgs.slice(-8), userMsg].filter(m => m.id !== 'welcome').map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await sb.functions.invoke('ai-sports-chat', { body: { messages: apiMsgs, context: liveCtx ?? undefined } });
      let reply = 'Sorry, I had trouble processing that. Please try again.';
      if (error) {
        if (error instanceof FunctionsHttpError) { try { const t = await error.context?.text(); if (t) reply = `Error: ${t}`; } catch { /* ignore */ } }
      } else if (data?.reply) { reply = data.reply; }
      setMsgs(p => [...p, { id: `a-${Date.now()}`, role: 'assistant', content: reply, timestamp: Date.now() }]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
    } catch {
      setMsgs(p => [...p, { id: `err-${Date.now()}`, role: 'assistant', content: 'Connection error. Check your network and try again.', timestamp: Date.now() }]);
    } finally { setLoading(false); }
  }, [input, loading, msgs, liveCtx]);

  const renderMsg = useCallback(({ item }: { item: AIChatMsg }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[ai.msgRow, isUser ? ai.msgRowUser : ai.msgRowAssistant]}>
        {!isUser ? (
          <View style={[ai.avatar, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
            <FontAwesome5 name="brain" size={10} color={C.primary} />
          </View>
        ) : null}
        <View style={[ai.bubble, isUser ? { backgroundColor: C.primary, borderBottomRightRadius: 4 } : { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderBottomLeftRadius: 4 }, { maxWidth: '82%' }]}>
          <FormattedText text={item.content} isUser={isUser} C={C} />
          <Text style={[ai.ts, { color: isUser ? 'rgba(0,0,0,0.4)' : C.textMuted }]}>
            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        {isUser ? (
          <View style={[ai.avatar, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Ionicons name="person" size={10} color={C.textMuted} />
          </View>
        ) : null}
      </View>
    );
  }, [C]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[ai.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
          <View style={[ai.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
            <View style={[ai.headerAvatar, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
              <FontAwesome5 name="brain" size={16} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ai.headerTitle, { color: C.textPrimary }]}>PX Analyst</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={[ai.dot, { backgroundColor: '#22C55E', width: 6, height: 6 }]} />
                <Text style={[ai.headerSub, { color: '#22C55E' }]}>AI Sports Intelligence · Online</Text>
              </View>
            </View>
            {liveCtx?.liveMatches?.length > 0 ? (
              <View style={[ai.livePill, { backgroundColor: 'rgba(255,71,87,0.12)', borderColor: 'rgba(255,71,87,0.3)' }]}>
                <View style={[ai.dot, { backgroundColor: '#FF4757' }]} />
                <Text style={[ai.liveCount, { color: '#FF4757' }]}>{liveCtx.liveMatches.length} Live</Text>
              </View>
            ) : null}
            <Pressable
              style={({ pressed }) => [ai.closeBtn, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
              onPress={onClose}
            >
              <Ionicons name="close" size={18} color={C.textMuted} />
            </Pressable>
          </View>
        </SafeAreaView>

        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={m => m.id}
          renderItem={renderMsg}
          contentContainerStyle={ai.msgList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={loading ? (
            <View style={ai.msgRowAssistant}>
              <View style={[ai.avatar, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}><FontAwesome5 name="brain" size={10} color={C.primary} /></View>
              <View style={[ai.typingBubble, { backgroundColor: C.card, borderColor: C.border }]}><TypingDots C={C} /></View>
            </View>
          ) : null}
        />

        {/* Suggestions */}
        {msgs.length <= 1 ? (
          <View style={[ai.suggestions, { borderTopColor: C.border }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ai.suggestionsContent}>
              {AI_PROMPTS.map(s => (
                <Pressable
                  key={s.label}
                  style={({ pressed }) => [ai.suggChip, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.75 } : null]}
                  onPress={() => send(s.prompt)}
                >
                  <Text style={[ai.suggText, { color: C.textSecondary }]}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Input */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[ai.inputWrap, { backgroundColor: C.surface, borderTopColor: C.border, paddingBottom: insets.bottom + 8 }]}>
            <View style={[ai.inputRow, { backgroundColor: C.card, borderColor: C.border }]}>
              <TextInput
                ref={inputRef}
                style={[ai.input, { color: C.textPrimary }]}
                value={input}
                onChangeText={setInput}
                placeholder="Ask about any match, team, or prediction..."
                placeholderTextColor={C.textMuted}
                multiline
                maxLength={500}
                returnKeyType="send"
                onSubmitEditing={() => send()}
              />
              <Pressable
                style={[ai.sendBtn, { backgroundColor: input.trim() && !loading ? C.primary : C.border }]}
                onPress={() => send()}
                disabled={!input.trim() || loading}
              >
                <Ionicons name="send" size={16} color={input.trim() && !loading ? '#000' : C.textMuted} />
              </Pressable>
            </View>
            <Text style={[ai.disclaimer, { color: C.textMuted }]}>PX Analyst · AI predictions are probabilistic, not guarantees.</Text>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const ai = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerTitle: { fontSize: 16, fontWeight: FONTS.bold },
  headerSub: { fontSize: 11, fontWeight: FONTS.semiBold },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  liveCount: { fontSize: 10, fontWeight: FONTS.bold },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  msgList: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: 12 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowAssistant: { justifyContent: 'flex-start', paddingHorizontal: SPACING.md, paddingVertical: 6 },
  avatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  bubble: { borderRadius: RADIUS.lg, padding: 12, gap: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  ts: { fontSize: 10, alignSelf: 'flex-end' },
  typingBubble: { borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  suggestions: { borderTopWidth: 1, paddingVertical: 10 },
  suggestionsContent: { paddingHorizontal: SPACING.md, gap: 8 },
  suggChip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  suggText: { fontSize: 13, fontWeight: FONTS.semiBold },
  inputWrap: { borderTopWidth: 1, paddingHorizontal: SPACING.md, paddingTop: 10, gap: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  input: { flex: 1, fontSize: 14, maxHeight: 100, lineHeight: 20 },
  sendBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  disclaimer: { fontSize: 10, textAlign: 'center' },
});

// ─── Room Card ────────────────────────────────────────────────────────────────
function getOnline(membersCount: number, roomId: string) {
  const h = new Date().getHours();
  const d = new Date().getDay();
  const hm = h >= 18 && h <= 22 ? 1 : h >= 15 && h < 18 ? 0.65 : h >= 23 || h < 6 ? 0.1 : 0.38;
  const dm = (d === 0 || d === 6) ? 1.35 : 1;
  const seed = roomId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 97 / 97;
  const base = (membersCount || 1000) * 0.07 * hm * dm;
  return Math.max(5, Math.floor(base + seed * base * 0.28));
}

function RoomCard({ room, C, onPress, isJoined, onLeave, unread }: {
  room: ChatRoom; C: AppColors; onPress: () => void; isJoined: boolean; onLeave: () => void; unread: number;
}) {
  const online = getOnline(room.membersCount ?? 1000, room.id);
  const isVip = room.name.toLowerCase().includes('vip') || room.emoji === '👑';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [rc.card, {
        backgroundColor: C.card,
        borderColor: unread > 0 ? `${C.accentBlue}55` : isVip ? '#F59E0B33' : isJoined ? `${C.accentBlue}33` : C.border,
      }, pressed ? rc.pressed : null]}
    >
      {/* Emoji + unread */}
      <View style={rc.emojiWrap}>
        <View style={[rc.emojiCircle, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Text style={rc.emoji}>{room.emoji || '💬'}</Text>
          <View style={[rc.onlineDot, { backgroundColor: '#22C55E', borderColor: C.card }]} />
        </View>
        {unread > 0 ? (
          <View style={[rc.unreadBadge, { backgroundColor: C.accentBlue, borderColor: C.card }]}>
            <Text style={rc.unreadText}>{unread > 99 ? '99+' : String(unread)}</Text>
          </View>
        ) : null}
      </View>

      <View style={rc.info}>
        <View style={rc.titleRow}>
          <Text style={[rc.name, { color: C.textPrimary }]} numberOfLines={1}>{room.name}</Text>
          {isVip ? (
            <View style={[rc.badge, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}>
              <FontAwesome5 name="crown" size={8} color="#F59E0B" />
              <Text style={[rc.badgeText, { color: '#F59E0B' }]}>VIP</Text>
            </View>
          ) : null}
          {isJoined ? (
            <View style={[rc.badge, { backgroundColor: `${C.accentBlue}18`, borderColor: `${C.accentBlue}44` }]}>
              <View style={[rc.dot, { backgroundColor: C.accentBlue }]} />
              <Text style={[rc.badgeText, { color: C.accentBlue }]}>Joined</Text>
            </View>
          ) : null}
        </View>
        <Text style={[rc.desc, { color: unread > 0 ? C.textPrimary : C.textMuted }, unread > 0 ? { fontWeight: FONTS.semiBold } : null]} numberOfLines={1}>
          {unread > 0 ? `${unread} new message${unread > 1 ? 's' : ''}` : (room.description || 'Join the discussion')}
        </Text>
        <View style={rc.meta}>
          <View style={[rc.dot, { backgroundColor: '#22C55E' }]} />
          <Text style={[rc.onlineText, { color: '#22C55E' }]}>{online} online</Text>
          <Text style={[rc.sep, { color: C.textMuted }]}>·</Text>
          <Ionicons name="people-outline" size={11} color={C.textMuted} />
          <Text style={[rc.membersText, { color: C.textMuted }]}>{(room.membersCount ?? 0).toLocaleString()}</Text>
        </View>
      </View>

      <View style={rc.right}>
        {isJoined ? (
          <Pressable
            onPress={(e) => { (e as any).stopPropagation?.(); onLeave(); }}
            hitSlop={8}
            style={({ pressed }) => [rc.leaveBtn, { borderColor: '#EF444433', backgroundColor: '#EF444410' }, pressed ? { opacity: 0.7 } : null]}
          >
            <Text style={[rc.leaveBtnText, { color: '#EF4444' }]}>Leave</Text>
          </Pressable>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
      </View>
    </Pressable>
  );
}
const rc = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.xl, borderWidth: 1, padding: 14 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  emojiWrap: { position: 'relative', flexShrink: 0 },
  emojiCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emoji: { fontSize: 24 },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  unreadBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5 },
  unreadText: { fontSize: 9, color: '#fff', fontWeight: '800', lineHeight: 13 },
  info: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: FONTS.bold, flex: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  desc: { fontSize: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineText: { fontSize: 11, fontWeight: FONTS.semiBold },
  sep: { fontSize: 11 },
  membersText: { fontSize: 11 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leaveBtn: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  leaveBtnText: { fontSize: 10, fontWeight: FONTS.bold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();
  const { rooms, loadingRooms } = useChat();
  const [refreshing, setRefreshing] = useState(false);
  const [joined, setJoined] = useState<Set<string>>(new Set());
  const [unreads, setUnreads] = useState<Record<string, number>>({});
  const [sport, setSport] = useState<SportFilter>('all');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const aiPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(aiPulse, { toValue: 1.1, duration: 1200, useNativeDriver: true }),
      Animated.timing(aiPulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
    ]));
    a.start(); return () => a.stop();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(JOINED_KEY).then(raw => { if (raw) setJoined(new Set(JSON.parse(raw))); }).catch(() => {});
  }, []);

  const fetchUnreads = useCallback(async () => {
    try {
      const rawSeen = await AsyncStorage.getItem(SEEN_MAP_KEY);
      const seenMap: Record<string, string> = rawSeen ? JSON.parse(rawSeen) : {};
      const globalFallback = seenMap['__global__'] ?? new Date(0).toISOString();
      const since = new Date(); since.setDate(since.getDate() - 7);
      const sb = getSupabaseClient();
      const q = sb.from('chat_messages').select('room_id,created_at,user_id').gt('created_at', since.toISOString());
      const { data: msgs } = user?.id ? await q.neq('user_id', user.id) : await q;
      if (!msgs) return;
      const counts: Record<string, number> = {};
      for (const m of msgs) {
        const seen = seenMap[m.room_id] ?? globalFallback;
        if (m.created_at > seen) counts[m.room_id] = (counts[m.room_id] ?? 0) + 1;
      }
      setUnreads(counts);
    } catch { /* ignore */ }
  }, [user?.id]);

  useEffect(() => {
    fetchUnreads();
    const id = setInterval(fetchUnreads, 30_000);
    return () => clearInterval(id);
  }, [fetchUnreads]);

  const handleLeave = useCallback(async (roomId: string) => {
    const next = new Set(joined); next.delete(roomId); setJoined(next);
    await AsyncStorage.setItem(JOINED_KEY, JSON.stringify([...next]));
  }, [joined]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      const now = new Date().toISOString();
      const raw = await AsyncStorage.getItem(SEEN_MAP_KEY);
      const map: Record<string, string> = raw ? JSON.parse(raw) : {};
      allRooms.forEach(r => { map[r.id] = now; });
      map['__global__'] = now;
      await AsyncStorage.setItem(SEEN_MAP_KEY, JSON.stringify(map));
      setUnreads({});
    } catch { /* ignore */ }
  }, []);

  const allRooms = useMemo(() => rooms.length > 0 ? rooms : FALLBACK_ROOMS, [rooms]);

  const displayRooms = useMemo(() => {
    let f = allRooms;
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter(r => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q));
    }
    if (sport !== 'all') {
      const kws = SPORT_FILTERS.find(sf => sf.key === sport)?.kws ?? [];
      if (kws.length > 0) f = f.filter(r => { const text = `${r.name} ${r.description ?? ''}`.toLowerCase(); return kws.some(kw => text.includes(kw)); });
    }
    return f;
  }, [allRooms, search, sport]);

  const totalUnread = useMemo(() => Object.values(unreads).reduce((s, n) => s + n, 0), [unreads]);

  const handleRoomPress = (room: ChatRoom) => {
    if (search.trim()) { Keyboard.dismiss(); setSearching(false); setSearch(''); }
    if (room.name.toLowerCase().includes('vip') || room.emoji === '👑') { router.push('/chat/vip' as any); return; }
    router.push(`/chat/${room.id}?name=${encodeURIComponent(room.name)}&emoji=${encodeURIComponent(room.emoji || '💬')}` as any);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    AsyncStorage.getItem(JOINED_KEY).then(raw => { if (raw) setJoined(new Set(JSON.parse(raw))); }).catch(() => {});
    await fetchUnreads();
    await new Promise(r => setTimeout(r, 600));
    setRefreshing(false);
  }, [fetchUnreads]);

  return (
    <View style={[cs.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        {/* Header */}
        <View style={[cs.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <View>
            <Text style={[cs.title, { color: C.textPrimary }]}>PX Community</Text>
            <Text style={[cs.subtitle, { color: C.textSecondary }]}>Live sports discussions</Text>
          </View>
          <View style={cs.headerRight}>
            {totalUnread > 0 ? (
              <Pressable
                style={({ pressed }) => [cs.iconBtn, { backgroundColor: `${C.accentBlue}15`, borderColor: `${C.accentBlue}44` }, pressed ? { opacity: 0.7 } : null]}
                onPress={handleMarkAllRead}
              >
                <Ionicons name="checkmark-done-outline" size={20} color={C.accentBlue} />
              </Pressable>
            ) : null}
            <Animated.View style={{ transform: [{ scale: aiPulse }] }}>
              <Pressable
                style={({ pressed }) => [cs.iconBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}55` }, pressed ? { opacity: 0.8 } : null]}
                onPress={() => setShowAI(true)}
              >
                <FontAwesome5 name="brain" size={18} color={C.primary} />
              </Pressable>
            </Animated.View>
            <Pressable
              style={({ pressed }) => [cs.iconBtn, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
              onPress={() => { setSearching(true); setTimeout(() => searchRef.current?.focus(), 80); }}
            >
              <Ionicons name="search-outline" size={21} color={C.textPrimary} />
            </Pressable>
          </View>
        </View>

        {/* Search bar */}
        {searching ? (
          <View style={[cs.searchBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
            <View style={[cs.searchInput, { backgroundColor: C.card, borderColor: C.border }]}>
              <Ionicons name="search-outline" size={16} color={C.textMuted} />
              <TextInput
                ref={searchRef}
                style={[cs.searchText, { color: C.textPrimary }]}
                value={search}
                onChangeText={setSearch}
                placeholder="Search rooms…"
                placeholderTextColor={C.textMuted}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search.length > 0 ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={C.textMuted} /></Pressable> : null}
            </View>
            <Pressable
              onPress={() => { Keyboard.dismiss(); setSearching(false); setSearch(''); }}
              style={({ pressed }) => [pressed ? { opacity: 0.7 } : null]}
              hitSlop={4}
            >
              <Text style={[cs.cancelText, { color: C.primary }]}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Sport filter */}
        <View style={[cs.filterBar, { borderBottomColor: C.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cs.filterContent}>
            {SPORT_FILTERS.map(f => {
              const sel = sport === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setSport(f.key)}
                  style={({ pressed }) => [cs.chip, sel ? { backgroundColor: C.primary, borderColor: C.primary } : { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.75 } : null]}
                >
                  <Text style={cs.chipEmoji}>{f.emoji}</Text>
                  <Text style={[cs.chipLabel, { color: sel ? '#fff' : C.textSecondary }]}>{f.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setShowAI(true)}
              style={({ pressed }) => [cs.chip, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}55` }, pressed ? { opacity: 0.75 } : null]}
            >
              <FontAwesome5 name="brain" size={12} color={C.primary} />
              <Text style={[cs.chipLabel, { color: C.primary, fontWeight: FONTS.bold }]}>AI Analyst</Text>
            </Pressable>
          </ScrollView>
        </View>
      </SafeAreaView>

      {loadingRooms ? (
        <View style={cs.loader}><ActivityIndicator size="large" color={C.primary} /></View>
      ) : (
        <FlatList
          data={displayRooms}
          keyExtractor={r => r.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={cs.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={searching ? null : (
            <View style={{ gap: 12, marginBottom: 8 }}>
              {/* Live users banner */}
              <LinearGradient
                colors={['rgba(110,220,31,0.12)', 'rgba(110,220,31,0.04)'] as [string, string]}
                style={[cs.liveBanner, { borderColor: 'rgba(110,220,31,0.25)' }]}
              >
                <View style={[cs.liveDot, { backgroundColor: '#6EDC1F' }]} />
                <Text style={[cs.liveBannerText, { color: '#6EDC1F' }]}>4,217+ users online across all rooms</Text>
                <View style={[cs.liveBadge, { backgroundColor: '#6EDC1F' }]}><Text style={cs.liveBadgeText}>LIVE</Text></View>
              </LinearGradient>

              {/* AI Assistant card */}
              <Pressable
                onPress={() => setShowAI(true)}
                style={({ pressed }) => [cs.aiCard, { backgroundColor: C.card, borderColor: `${C.primary}33` }, pressed ? { opacity: 0.9 } : null]}
              >
                <LinearGradient colors={[`${C.primary}14`, `${C.primary}04`] as [string, string]} style={cs.aiCardGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                  <View style={[cs.aiCardIcon, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
                    <FontAwesome5 name="brain" size={22} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <Text style={[cs.aiCardTitle, { color: C.primary }]}>PX Analyst</Text>
                      <View style={[cs.aiCardBadge, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
                        <Text style={[cs.aiCardBadgeText, { color: C.primary }]}>AI ASSISTANT</Text>
                      </View>
                    </View>
                    <Text style={[cs.aiCardSub, { color: C.textMuted }]}>Match analysis · Predictions · Betting insights</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={C.primary} />
                </LinearGradient>
              </Pressable>

              {/* VIP card */}
              <Pressable
                onPress={() => router.push('/chat/vip' as any)}
                style={({ pressed }) => [cs.vipCard, { borderColor: '#F59E0B33' }, pressed ? { opacity: 0.9 } : null]}
              >
                <LinearGradient colors={['rgba(245,158,11,0.15)', 'rgba(245,158,11,0.06)'] as [string, string]} style={cs.vipGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                  <View style={[cs.vipIcon, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#F59E0B33' }]}>
                    <FontAwesome5 name="crown" size={22} color="#F59E0B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[cs.vipTitle, { color: '#F59E0B' }]}>VIP Lounge</Text>
                      <View style={[cs.vipBadge, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#F59E0B33' }]}>
                        <Text style={[cs.vipBadgeText, { color: '#F59E0B' }]}>EXCLUSIVE</Text>
                      </View>
                    </View>
                    <Text style={[cs.vipSub, { color: C.textMuted }]}>Expert tips · Premium picks · Analyst insights</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#F59E0B" />
                </LinearGradient>
              </Pressable>

              <Text style={[cs.sectionLabel, { color: C.textMuted }]}>Public Rooms</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <RoomCard
              room={item}
              C={C}
              onPress={() => handleRoomPress(item)}
              isJoined={joined.has(item.id)}
              onLeave={() => handleLeave(item.id)}
              unread={unreads[item.id] ?? 0}
            />
          )}
          ListFooterComponent={
            <>
              {displayRooms.length === 0 ? (
                <View style={cs.empty}>
                  <Ionicons name="search-outline" size={36} color={C.textMuted} />
                  <Text style={[cs.emptyTitle, { color: C.textSecondary }]}>No rooms found</Text>
                  <Text style={[cs.emptySub, { color: C.textMuted }]}>
                    {search ? `No rooms match "${search}"` : 'No rooms available for this filter'}
                  </Text>
                </View>
              ) : null}
              <View style={{ height: 100 }} />
            </>
          }
        />
      )}

      <AIAssistant visible={showAI} onClose={() => setShowAI(false)} C={C} />

      {/* FAB */}
      {!searching ? (
        <View style={cs.fab}>
          <Pressable
            style={({ pressed }) => [cs.fabBtn, { backgroundColor: C.primary, shadowColor: C.primary }, pressed ? { transform: [{ scale: 0.93 }] } : null]}
            onPress={() => setShowAI(true)}
          >
            <FontAwesome5 name="brain" size={18} color="#000" />
            <Text style={cs.fabLabel}>Ask AI</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const cs = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1 },
  title: { fontSize: 22, fontWeight: FONTS.bold },
  subtitle: { fontSize: 13, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 10, gap: 10, borderBottomWidth: 1 },
  searchInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, height: 40 },
  searchText: { flex: 1, fontSize: 14 },
  cancelText: { fontSize: 14, fontWeight: FONTS.semiBold },
  filterBar: { borderBottomWidth: StyleSheet.hairlineWidth },
  filterContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 10, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 13, height: 36 },
  chipEmoji: { fontSize: 14 },
  chipLabel: { fontSize: 13, fontWeight: FONTS.semiBold },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  liveBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveBannerText: { flex: 1, fontSize: 13, fontWeight: FONTS.medium },
  liveBadge: { borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  liveBadgeText: { fontSize: 9, fontWeight: '800', color: '#000', letterSpacing: 1 },
  aiCard: { borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1 },
  aiCardGradient: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  aiCardIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  aiCardTitle: { fontSize: 16, fontWeight: FONTS.bold },
  aiCardBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  aiCardBadgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  aiCardSub: { fontSize: 12 },
  vipCard: { borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1 },
  vipGradient: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  vipIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  vipTitle: { fontSize: 16, fontWeight: FONTS.bold },
  vipBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  vipBadgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  vipSub: { fontSize: 12 },
  sectionLabel: { fontSize: 12, fontWeight: FONTS.bold, letterSpacing: 0.8 },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: FONTS.bold },
  emptySub: { fontSize: 13, textAlign: 'center' },
  fab: { position: 'absolute', right: 20, bottom: 90 },
  fabBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.full, paddingHorizontal: 18, paddingVertical: 13, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  fabLabel: { fontSize: 14, fontWeight: FONTS.bold, color: '#000' },
});
