import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal, ScrollView,
  Animated, Keyboard, RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useChatRoom } from '@/hooks/useChat';
import { setPinned, fetchPinnedMessage } from '@/services/chatService';
import ChatBubble, { isEmojiOnly } from '@/components/feature/ChatBubble';
import { ToastStack } from '@/components/ui/Toast';
import type { ToastItem } from '@/components/ui/Toast';
import type { ReadStatus } from '@/components/feature/ChatBubble';
import { useAuth, getSupabaseClient, useAlert } from '@/template';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { useTranslatedContent } from '@/hooks/useTranslatedContent';
import { useLanguage } from '@/contexts/LanguageContext';

// Shared keys – must match constants in app/(tabs)/_layout.tsx and app/(tabs)/chat.tsx
const CHAT_ROOM_SEEN_MAP_KEY = '@predictxta/chat_room_seen_map';
const JOINED_ROOMS_KEY = '@predictxta/joined_rooms';

// ─── Translation cache key ────────────────────────────────────────────────────
const CHAT_TRANSLATION_CACHE_KEY = '@predictxta/chat_translation_cache_v1';

// ─── Message content moderation ──────────────────────────────────────────────
// Blocks URLs and phone numbers but allows sport score patterns like "2-1", "3:0"
const URL_REGEX = /https?:\/\/[^\s]+|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*/gi;
const PHONE_REGEX = /(?<!\d)(\+?[0-9][\s\-.]?){7,14}(?!\d)/g;
// Score patterns we want to preserve: "2-1", "3:0", "1 - 0", "FT 2-1"
const SCORE_PATTERN = /^(\d+\s*[-:]\s*\d+|FT|HT|\d+')$/;

function containsBlockedContent(text: string): { blocked: boolean; reason: string } {
  const withoutScores = text.replace(/\b\d+\s*[-:]\s*\d+\b|\b(FT|HT)\b|\b\d+'\b/gi, '');
  if (URL_REGEX.test(withoutScores)) {
    return { blocked: true, reason: 'Links are not allowed in chat.' };
  }
  URL_REGEX.lastIndex = 0;
  const phoneMatches = withoutScores.match(PHONE_REGEX);
  if (phoneMatches && phoneMatches.some((m) => m.replace(/[\s\-.()+]/g, '').length >= 7)) {
    return { blocked: true, reason: 'Phone numbers are not allowed in chat.' };
  }
  return { blocked: false, reason: '' };
}

// Emoji reaction options
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥'] as const;
const PIN_EMOJI = '📌';
const REPORT_EMOJI = '🚩';

// ─── Sticker panel categories ─────────────────────────────────────────────────
const STICKER_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: '⚽ Sport', emojis: ['⚽', '🏀', '🎾', '🏈', '🏒', '🥊', '🏐', '⛳', '🎯', '🏆', '🥇', '🏅'] },
  { label: '🔥 Hype',  emojis: ['🔥', '💯', '🎉', '🎊', '🥳', '🙌', '👏', '✨', '⭐', '💫', '🚀', '💥'] },
  { label: '👍 React', emojis: ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🤩', '😎', '💪', '🤔', '😏'] },
  { label: '😀 Faces', emojis: ['😀', '😭', '🥶', '😤', '🤯', '🫡', '🧠', '👀', '🥹', '😬', '🤡', '🤐'] },
];

// ─── Avatar color helper ──────────────────────────────────────────────────────
function getAvatarColor(seed: string, C: AppColors): string {
  const palette = [C.primary, C.accent, C.accentBlue, C.accentPurple, C.accentRed];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + hash * 31;
  return palette[Math.abs(hash) % palette.length];
}

// ─── Active member type ───────────────────────────────────────────────────────
interface ActiveMember {
  userId: string;
  username: string;
  lastSeen: string;
}

// ─── Reply target type ────────────────────────────────────────────────────────
interface ReplyTarget {
  userId: string;
  username: string;
}

// ─── Swipeable Reply Row ──────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 62;
const SWIPE_MAX = 90;

function SwipeableRow({
  children, onSwipeReply, isOwn, C,
}: {
  children: React.ReactNode;
  onSwipeReply: () => void;
  isOwn: boolean;
  C: AppColors;
}) {
  const translateX = useRef(new Animated.Value(0)).current;

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: translateX } }],
    { useNativeDriver: true },
  );

  const onHandlerStateChange = useCallback(
    ({ nativeEvent }: any) => {
      if (
        nativeEvent.state === State.END ||
        nativeEvent.state === State.CANCELLED ||
        nativeEvent.state === State.FAILED
      ) {
        const tx = nativeEvent.translationX;
        if (tx >= SWIPE_THRESHOLD) {
          onSwipeReply();
        }
        // Spring back to rest position
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 90,
          friction: 11,
        }).start();
      }
    },
    [onSwipeReply, translateX],
  );

  // Clamp translateX to [0, SWIPE_MAX] so only right-swipe moves the row
  const clampedX = translateX.interpolate({
    inputRange: [0, SWIPE_MAX, SWIPE_MAX + 60],
    outputRange: [0, SWIPE_MAX, SWIPE_MAX],
    extrapolate: 'clamp',
  });

  // Reply icon fades in as the row moves right
  const iconOpacity = translateX.interpolate({
    inputRange: [0, SWIPE_THRESHOLD * 0.4, SWIPE_THRESHOLD],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });
  const iconScale = translateX.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0.6, 1],
    extrapolate: 'clamp',
  });

  return (
    <PanGestureHandler
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
      // Activate only on horizontal movement ≥ 8px; fail if vertical > 14px
      activeOffsetX={[-9999, 8]}
      failOffsetY={[-14, 14]}
    >
      <Animated.View style={{ position: 'relative' }}>
        {/* Reply icon — revealed on left side while swiping right */}
        <Animated.View
          style={[
            swipeStyles.replyHint,
            {
              opacity: iconOpacity,
              transform: [{ scale: iconScale }],
              // For own messages the icon is on the left; for others also on left
              left: 14,
            },
          ]}
          pointerEvents="none"
        >
          <View style={[swipeStyles.replyCircle, { backgroundColor: `${C.accentBlue}18`, borderColor: `${C.accentBlue}40` }]}>
            <Ionicons name="return-down-forward-outline" size={17} color={C.accentBlue} />
          </View>
        </Animated.View>

        {/* The message row — slides right */}
        <Animated.View style={{ transform: [{ translateX: clampedX }] }}>
          {children}
        </Animated.View>
      </Animated.View>
    </PanGestureHandler>
  );
}

const swipeStyles = StyleSheet.create({
  replyHint: {
    position: 'absolute', top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 0,
  },
  replyCircle: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});

// ─── Highlight wrapper — animated border that fades out over 1.5 s ─────────────
function HighlightWrapper({
  active, color, children,
}: {
  active: boolean;
  color: string;
  children: React.ReactNode;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      anim.setValue(1);
      Animated.timing(anim, {
        toValue: 0,
        duration: 1500,
        useNativeDriver: false,
      }).start();
    } else {
      anim.setValue(0);
    }
  }, [active]);

  const borderColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', color],
  });
  const bgColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', `${color}18`],
  });

  return (
    <Animated.View
      style={[
        highlightStyles.wrap,
        { borderColor, backgroundColor: bgColor },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const highlightStyles = StyleSheet.create({
  wrap: { borderWidth: 1.5, borderRadius: 12, marginHorizontal: 4, marginVertical: 1 },
});

// ─── Emoji Reaction Picker ────────────────────────────────────────────────────
function EmojiPicker({
  visible, isOwn, C, onSelect, onPin, onDismiss, isPinned, onReport,
}: {
  visible: boolean;
  isOwn: boolean;
  C: AppColors;
  onSelect: (emoji: string) => void;
  onPin: () => void;
  onDismiss: () => void;
  isPinned?: boolean;
  onReport: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 140, friction: 10 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onDismiss} />
      <Animated.View
        style={[
          pickerStyles.container,
          isOwn ? pickerStyles.ownSide : pickerStyles.otherSide,
          {
            backgroundColor: C.surface,
            borderColor: C.border,
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      >
        {REACTION_EMOJIS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => onSelect(emoji)}
            style={({ pressed }) => [
              pickerStyles.emojiBtn,
              pressed ? { transform: [{ scale: 1.35 }], backgroundColor: `${C.primary}18` } : null,
            ]}
            hitSlop={4}
          >
            <Text style={pickerStyles.emoji}>{emoji}</Text>
          </Pressable>
        ))}

        {/* Divider */}
        <View style={[pickerStyles.divider, { backgroundColor: C.border }]} />

        {/* Pin / Unpin button */}
        <Pressable
          onPress={onPin}
          style={({ pressed }) => [
            pickerStyles.emojiBtn,
            { backgroundColor: isPinned ? `${C.primary}18` : 'transparent' },
            pressed ? { transform: [{ scale: 1.25 }], opacity: 0.7 } : null,
          ]}
          hitSlop={4}
        >
          <Text style={pickerStyles.emoji}>{PIN_EMOJI}</Text>
        </Pressable>

        {/* Divider before report */}
        <View style={[pickerStyles.divider, { backgroundColor: C.border }]} />

        {/* Report button — hidden for own messages */}
        {!isOwn ? (
          <Pressable
            onPress={onReport}
            style={({ pressed }) => [
              pickerStyles.emojiBtn,
              pressed ? { transform: [{ scale: 1.25 }], opacity: 0.7 } : null,
            ]}
            hitSlop={4}
          >
            <Text style={pickerStyles.emoji}>{REPORT_EMOJI}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </>
  );
}

const pickerStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 100,
  },
  ownSide: { right: 20 },
  otherSide: { left: 20 },
  emojiBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  divider: { width: 1, height: 28, marginHorizontal: 2 },
});

// ─── Sticker Panel ────────────────────────────────────────────────────────────
function StickerPanel({
  visible, C, onSend, onClose,
}: {
  visible: boolean;
  C: AppColors;
  onSend: (emoji: string) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const slideAnim = useRef(new Animated.Value(220)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 220, duration: 200, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const category = STICKER_CATEGORIES[activeTab];

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        stickerStyles.panel,
        {
          backgroundColor: C.surface,
          borderTopColor: C.border,
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      {/* Category tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[stickerStyles.tabBar, { borderBottomColor: C.border }]}
        contentContainerStyle={stickerStyles.tabBarContent}
      >
        {STICKER_CATEGORIES.map((cat, i) => (
          <Pressable
            key={cat.label}
            onPress={() => setActiveTab(i)}
            style={[
              stickerStyles.tab,
              {
                borderBottomColor: i === activeTab ? C.primary : 'transparent',
                borderBottomWidth: 2,
              },
            ]}
          >
            <Text
              style={[
                stickerStyles.tabLabel,
                { color: i === activeTab ? C.primary : C.textMuted },
              ]}
            >
              {cat.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Sticker grid */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={stickerStyles.grid}
      >
        {category.emojis.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => onSend(emoji)}
            style={({ pressed }) => [
              stickerStyles.stickerBtn,
              { backgroundColor: C.card, borderColor: C.border },
              pressed ? { opacity: 0.65, transform: [{ scale: 0.88 }] } : null,
            ]}
            hitSlop={4}
          >
            <Text style={stickerStyles.stickerEmoji}>{emoji}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const stickerStyles = StyleSheet.create({
  panel: { height: 220, borderTopWidth: 1 },
  tabBar: { flexGrow: 0, borderBottomWidth: 1 },
  tabBarContent: { paddingHorizontal: 8, gap: 4 },
  tab: { paddingHorizontal: 12, paddingVertical: 10 },
  tabLabel: { fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 6 },
  stickerBtn: {
    width: 52, height: 52, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  stickerEmoji: { fontSize: 28 },
});

// ─── Typing Indicator Bubble ──────────────────────────────────────────────────
function TypingBubble({ C }: { C: AppColors }) {
  const dots = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(dot, { toValue: -6, duration: 280, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.delay((dots.length - 1 - i) * 140 + 120),
        ]),
      ),
    );
    const parallel = Animated.parallel(animations);
    parallel.start();
    return () => parallel.stop();
  }, []);

  return (
    <View style={typingStyles.wrapper}>
      <View style={[typingStyles.avatar, { backgroundColor: C.border }]}>
        <Ionicons name="ellipsis-horizontal" size={13} color={C.textMuted} />
      </View>
      <View style={[typingStyles.bubble, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={[typingStyles.label, { color: C.textMuted }]}>typing</Text>
        <View style={typingStyles.dotsRow}>
          {dots.map((dot, i) => (
            <Animated.View
              key={i}
              style={[
                typingStyles.dot,
                { backgroundColor: C.textMuted, transform: [{ translateY: dot }] },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const typingStyles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  bubble: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: RADIUS.lg, borderTopLeftRadius: 4, borderWidth: 1,
  },
  label: { fontSize: 11, fontStyle: 'italic' },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

// ─── Members Bottom Sheet ─────────────────────────────────────────────────────
function MembersSheet({
  visible, onClose, roomId, C, onSelectMember,
}: {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  C: AppColors;
  onSelectMember: (userId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<ActiveMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const slideAnim = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0, useNativeDriver: true, tension: 80, friction: 12,
      }).start();
      fetchActiveMembers();
    } else {
      Animated.timing(slideAnim, { toValue: 400, duration: 220, useNativeDriver: true }).start();
    }
  }, [visible]);

  const fetchActiveMembers = async () => {
    setLoadingMembers(true);
    try {
      const since = new Date();
      since.setHours(since.getHours() - 24);
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('chat_messages')
        .select('user_id, username, created_at')
        .eq('room_id', roomId)
        .gt('created_at', since.toISOString())
        .order('created_at', { ascending: false });

      if (!data) { setLoadingMembers(false); return; }

      const seen = new Map<string, ActiveMember>();
      for (const msg of data) {
        if (!seen.has(msg.user_id)) {
          seen.set(msg.user_id, {
            userId: msg.user_id,
            username: msg.username || 'Anonymous',
            lastSeen: msg.created_at,
          });
        }
      }
      setMembers([...seen.values()].slice(0, 10));
    } catch { /* non-blocking */ }
    setLoadingMembers(false);
  };

  const getInitials = (name: string) =>
    name.trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || '?';

  const getAvatarBg = (seed: string): string => {
    const palette = [C.primary, C.accent, C.accentBlue, C.accentPurple, C.accentRed];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + hash * 31;
    return palette[Math.abs(hash) % palette.length];
  };

  const formatLastSeen = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    const h = Math.floor(diff / 60);
    return h < 24 ? `${h}h ago` : 'today';
  };

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <Pressable style={sheetStyles.backdrop} onPress={onClose} />
      <Animated.View
        style={[
          sheetStyles.sheet,
          {
            backgroundColor: C.surface,
            borderColor: C.border,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <View style={[sheetStyles.handle, { backgroundColor: C.border }]} />
        <View style={sheetStyles.sheetHeader}>
          <Ionicons name="people" size={18} color={C.primary} />
          <Text style={[sheetStyles.sheetTitle, { color: C.textPrimary }]}>Active Members</Text>
          <Text style={[sheetStyles.sheetSub, { color: C.textMuted }]}>Last 24 hours</Text>
          <Pressable onPress={onClose} hitSlop={8} style={sheetStyles.closeBtn}>
            <Ionicons name="close" size={20} color={C.textMuted} />
          </Pressable>
        </View>
        <View style={[sheetStyles.divider, { backgroundColor: C.border }]} />

        {loadingMembers ? (
          <View style={sheetStyles.loader}>
            <ActivityIndicator color={C.primary} />
            <Text style={[sheetStyles.loaderText, { color: C.textMuted }]}>Loading members…</Text>
          </View>
        ) : members.length === 0 ? (
          <View style={sheetStyles.emptyWrap}>
            <Ionicons name="people-outline" size={40} color={C.textMuted} />
            <Text style={[sheetStyles.emptyTitle, { color: C.textSecondary }]}>No recent activity</Text>
            <Text style={[sheetStyles.emptyText, { color: C.textMuted }]}>
              No messages sent in the last 24 hours
            </Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={sheetStyles.memberList}>
            {members.map((m, idx) => (
              <Pressable
                key={m.userId}
                onPress={() => onSelectMember(m.userId)}
                style={({ pressed }) => [
                  sheetStyles.memberRow,
                  { borderBottomColor: C.border },
                  idx === members.length - 1 ? { borderBottomWidth: 0 } : null,
                  pressed ? { opacity: 0.72, backgroundColor: `${C.primary}10` } : null,
                ]}
              >
                <View style={[sheetStyles.avatar, { backgroundColor: getAvatarBg(m.userId) }]}>
                  <Text style={sheetStyles.avatarText}>{getInitials(m.username)}</Text>
                  <View style={[sheetStyles.onlineDot, { borderColor: C.surface }]} />
                </View>
                <View style={sheetStyles.memberInfo}>
                  <Text style={[sheetStyles.memberName, { color: C.textPrimary }]} numberOfLines={1}>
                    {m.username}
                  </Text>
                  <Text style={[sheetStyles.memberSeen, { color: C.textMuted }]}>
                    Active {formatLastSeen(m.lastSeen)}
                  </Text>
                </View>
                <View style={sheetStyles.activeBadge}>
                  <View style={sheetStyles.activeDot} />
                  <Text style={sheetStyles.activeText}>Online</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    maxHeight: '65%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SPACING.md, paddingVertical: 14,
  },
  sheetTitle: { fontSize: 16, fontWeight: FONTS.bold },
  sheetSub: { fontSize: 12, flex: 1 },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: SPACING.md },
  loader: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loaderText: { fontSize: 13 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: FONTS.bold },
  emptyText: { fontSize: 13, textAlign: 'center' },
  memberList: { paddingHorizontal: SPACING.md, paddingTop: 4, paddingBottom: 8 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative', flexShrink: 0,
  },
  avatarText: { fontSize: 16, fontWeight: FONTS.bold, color: '#fff' },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#22c55e', borderWidth: 2,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: FONTS.semiBold },
  memberSeen: { fontSize: 11, marginTop: 2 },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.3)',
  },
  activeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#22c55e' },
  activeText: { fontSize: 10, fontWeight: FONTS.bold, color: '#22c55e' },
});

// ─── Header ───────────────────────────────────────────────────────────────────
function RoomHeader({
  name, emoji, onlineCount, onBack, onMembersPress, onSearchPress, C,
}: {
  name: string;
  emoji: string;
  onlineCount: number;
  onBack: () => void;
  onMembersPress: () => void;
  onSearchPress: () => void;
  C: AppColors;
}) {
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
      <View style={[styles.header, { borderBottomColor: C.border, backgroundColor: C.surface }]}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={[styles.emojiCircle, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={styles.emojiText}>{emoji}</Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={[styles.roomName, { color: C.textPrimary }]} numberOfLines={1}>{name}</Text>
            <View style={styles.headerMeta}>
              <View style={[styles.onlineDot, { backgroundColor: C.accent }]} />
              <Text style={[styles.onlineText, { color: C.accent }]}>{onlineCount} online</Text>
            </View>
          </View>
        </View>
        {/* Action buttons */}
        <View style={styles.headerActions}>
          <Pressable
            onPress={onSearchPress}
            hitSlop={4}
            style={({ pressed }) => [
              styles.headerBtn,
              { backgroundColor: C.card, borderColor: C.border },
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Ionicons name="search-outline" size={18} color={C.textPrimary} />
          </Pressable>
          <Pressable
            onPress={onMembersPress}
            hitSlop={4}
            style={({ pressed }) => [
              styles.headerBtn,
              { backgroundColor: C.card, borderColor: C.border },
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Ionicons name="people-outline" size={19} color={C.textPrimary} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Inline Search Bar ────────────────────────────────────────────────────────
function InlineSearchBar({
  query, matchCount, currentIndex, hasQuery, C, inputRef,
  onChangeText, onClear, onClose, onPrev, onNext,
}: {
  query: string;
  matchCount: number;
  currentIndex: number;
  hasQuery: boolean;
  C: AppColors;
  inputRef: React.RefObject<TextInput>;
  onChangeText: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const hasResults = matchCount > 0;
  const canNav = matchCount > 1;

  return (
    <View style={[searchStyles.bar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
      <View style={[searchStyles.inputWrap, { backgroundColor: C.card, borderColor: C.accentBlue }]}>
        <Ionicons name="search" size={15} color={C.accentBlue} style={searchStyles.icon} />
        <TextInput
          ref={inputRef}
          style={[searchStyles.input, { color: C.textPrimary }]}
          value={query}
          onChangeText={onChangeText}
          placeholder="Search messages…"
          placeholderTextColor={C.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 ? (
          <Pressable onPress={onClear} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Navigation controls + X / Y counter */}
      {hasQuery ? (
        <View style={searchStyles.navGroup}>
          <Pressable
            onPress={onPrev}
            hitSlop={8}
            disabled={!canNav}
            style={({ pressed }) => [
              searchStyles.navBtn,
              { backgroundColor: C.card, borderColor: C.border },
              !canNav ? { opacity: 0.35 } : null,
              pressed && canNav ? { opacity: 0.6 } : null,
            ]}
          >
            <Ionicons
              name="chevron-up"
              size={15}
              color={hasResults ? C.accentBlue : C.textMuted}
            />
          </Pressable>

          <Text
            style={[
              searchStyles.count,
              { color: hasResults ? C.accentBlue : C.accentRed },
            ]}
          >
            {hasResults ? `${currentIndex + 1} / ${matchCount}` : '0'}
          </Text>

          <Pressable
            onPress={onNext}
            hitSlop={8}
            disabled={!canNav}
            style={({ pressed }) => [
              searchStyles.navBtn,
              { backgroundColor: C.card, borderColor: C.border },
              !canNav ? { opacity: 0.35 } : null,
              pressed && canNav ? { opacity: 0.6 } : null,
            ]}
          >
            <Ionicons
              name="chevron-down"
              size={15}
              color={hasResults ? C.accentBlue : C.textMuted}
            />
          </Pressable>
        </View>
      ) : null}

      <Pressable onPress={onClose} hitSlop={8}>
        <Text style={[searchStyles.doneBtn, { color: C.primary }]}>Done</Text>
      </Pressable>
    </View>
  );
}

const searchStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: SPACING.md, paddingVertical: 8,
    borderBottomWidth: 1,
  },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderRadius: RADIUS.full, borderWidth: 1.5,
    paddingHorizontal: 12, height: 38, gap: 6,
  },
  icon: { flexShrink: 0 },
  input: { flex: 1, fontSize: 14, height: 38 },
  navGroup: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  navBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  count: { fontSize: 11, fontWeight: FONTS.bold, minWidth: 32, textAlign: 'center' },
  doneBtn: { fontSize: 14, fontWeight: FONTS.semiBold, paddingLeft: 2 },
});

// ─── Pinned Message Banner ────────────────────────────────────────────────────
function PinnedBanner({
  message, C, onDismiss, onScrollTo, onUnpin,
}: {
  message: { id: string; username: string; content: string };
  C: AppColors;
  onDismiss: () => void;
  onScrollTo: () => void;
  onUnpin: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(-48)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0, useNativeDriver: true, tension: 100, friction: 12,
    }).start();
  }, [message.id]);

  const preview = message.content.length > 60
    ? message.content.slice(0, 57) + '…'
    : message.content;

  return (
    <Animated.View
      style={[
        pinnedStyles.banner,
        {
          backgroundColor: `${C.primary}12`,
          borderBottomColor: `${C.primary}30`,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={[pinnedStyles.accentBar, { backgroundColor: C.primary }]} />
      <Text style={pinnedStyles.pinIcon}>📌</Text>
      <Pressable style={pinnedStyles.textArea} onPress={onScrollTo} hitSlop={4}>
        <Text style={[pinnedStyles.label, { color: C.primary }]} numberOfLines={1}>
          Pinned · @{message.username}
        </Text>
        <Text style={[pinnedStyles.preview, { color: C.textSecondary }]} numberOfLines={1}>
          {preview}
        </Text>
      </Pressable>
      <Pressable
        onPress={onScrollTo}
        hitSlop={8}
        style={({ pressed }) => [
          pinnedStyles.scrollBtn,
          { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}30` },
          pressed ? { opacity: 0.65 } : null,
        ]}
      >
        <Ionicons name="arrow-down-circle-outline" size={18} color={C.primary} />
      </Pressable>
      <Pressable
        onPress={onUnpin}
        hitSlop={8}
        style={({ pressed }) => [
          pinnedStyles.unpinBtn,
          { backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}30` },
          pressed ? { opacity: 0.6 } : null,
        ]}
      >
        <Ionicons name="pin-outline" size={13} color={C.accentRed} />
        <Text style={[pinnedStyles.unpinLabel, { color: C.accentRed }]}>Unpin</Text>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={10} style={pinnedStyles.dismissBtn}>
        <Ionicons name="close" size={15} color={C.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

const pinnedStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingRight: 10,
    borderBottomWidth: 1, overflow: 'hidden',
  },
  accentBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginLeft: 4 },
  pinIcon: { fontSize: 14 },
  textArea: { flex: 1, gap: 1 },
  label: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.3 },
  preview: { fontSize: 12, lineHeight: 16 },
  scrollBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  unpinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  unpinLabel: { fontSize: 10, fontWeight: FONTS.bold },
  dismissBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
});

// ─── Report Reason Modal ─────────────────────────────────────────────────────
const REPORT_REASONS: { key: string; label: string; desc: string; icon: string }[] = [
  { key: 'spam',          label: 'Spam',          desc: 'Unsolicited or repetitive content',     icon: '🔁' },
  { key: 'hate',          label: 'Hate Speech',   desc: 'Offensive or discriminatory language',  icon: '🚫' },
  { key: 'harassment',    label: 'Harassment',    desc: 'Bullying or targeted abuse',             icon: '😤' },
  { key: 'inappropriate', label: 'Inappropriate', desc: 'Violates community guidelines',         icon: '⚠️' },
];

function ReportModal({
  visible, C, onSubmit, onCancel,
}: {
  visible: boolean;
  C: AppColors;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(0.88)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSelected(null);
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 130, friction: 10 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 0.88, duration: 140, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onCancel}>
      <Pressable style={reportModalStyles.backdrop} onPress={onCancel} />
      <View style={reportModalStyles.centeredWrap} pointerEvents="box-none">
        <Animated.View
          style={[
            reportModalStyles.card,
            {
              backgroundColor: C.surface,
              borderColor: C.border,
              transform: [{ scale: scaleAnim }],
              opacity: opacityAnim,
            },
          ]}
        >
          <View style={reportModalStyles.header}>
            <Text style={reportModalStyles.flagIcon}>🚩</Text>
            <View style={reportModalStyles.headerText}>
              <Text style={[reportModalStyles.title, { color: C.textPrimary }]}>Report Message</Text>
              <Text style={[reportModalStyles.subtitle, { color: C.textMuted }]}>Why are you reporting this?</Text>
            </View>
          </View>

          <View style={[reportModalStyles.divider, { backgroundColor: C.border }]} />

          <View style={reportModalStyles.reasonList}>
            {REPORT_REASONS.map((r) => {
              const isActive = selected === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setSelected(r.key)}
                  style={({ pressed }) => [
                    reportModalStyles.reasonRow,
                    { backgroundColor: isActive ? `${C.accentRed}12` : C.card, borderColor: isActive ? C.accentRed : C.border },
                    pressed ? { opacity: 0.78 } : null,
                  ]}
                >
                  <Text style={reportModalStyles.reasonIcon}>{r.icon}</Text>
                  <View style={reportModalStyles.reasonText}>
                    <Text style={[reportModalStyles.reasonLabel, { color: C.textPrimary }]}>{r.label}</Text>
                    <Text style={[reportModalStyles.reasonDesc, { color: C.textMuted }]}>{r.desc}</Text>
                  </View>
                  <View style={[reportModalStyles.radio, { borderColor: isActive ? C.accentRed : C.border }]}>
                    {isActive ? <View style={[reportModalStyles.radioFill, { backgroundColor: C.accentRed }]} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={[reportModalStyles.divider, { backgroundColor: C.border }]} />

          <View style={reportModalStyles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                reportModalStyles.cancelBtn,
                { borderColor: C.border, backgroundColor: C.card },
                pressed ? { opacity: 0.7 } : null,
              ]}
            >
              <Text style={[reportModalStyles.cancelText, { color: C.textMuted }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => { if (selected) onSubmit(selected); }}
              disabled={!selected}
              style={({ pressed }) => [
                reportModalStyles.submitBtn,
                { backgroundColor: selected ? C.accentRed : C.border },
                pressed && selected ? { opacity: 0.82 } : null,
              ]}
            >
              <Ionicons name="flag" size={14} color="#fff" />
              <Text style={reportModalStyles.submitText}>Submit Report</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const reportModalStyles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  centeredWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  card: {
    width: '100%', borderRadius: RADIUS.xl, borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 }, elevation: 14, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14,
  },
  flagIcon: { fontSize: 26 },
  headerText: { flex: 1 },
  title: { fontSize: 16, fontWeight: FONTS.bold },
  subtitle: { fontSize: 12, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth },
  reasonList: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11,
  },
  reasonIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  reasonText: { flex: 1 },
  reasonLabel: { fontSize: 13, fontWeight: FONTS.semiBold },
  reasonDesc: { fontSize: 11, marginTop: 1 },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  radioFill: { width: 10, height: 10, borderRadius: 5 },
  actions: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 16,
  },
  cancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 11,
  },
  cancelText: { fontSize: 13, fontWeight: FONTS.semiBold },
  submitBtn: {
    flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: RADIUS.full, paddingVertical: 11,
  },
  submitText: { fontSize: 13, fontWeight: FONTS.bold, color: '#fff' },
});

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyMessages({ C }: { C: AppColors }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconCircle, { backgroundColor: C.card, borderColor: C.border }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={36} color={C.textMuted} />
      </View>
      <Text style={[styles.emptyTitle, { color: C.textSecondary }]}>No messages yet</Text>
      <Text style={[styles.emptySubtitle, { color: C.textMuted }]}>
        Be the first to start the conversation. Share your prediction!
      </Text>
    </View>
  );
}

// ─── Date separator ───────────────────────────────────────────────────────────
function shouldShowDateFor(createdAt: string, prevCreatedAt?: string): boolean {
  if (!prevCreatedAt) return true;
  return new Date(createdAt).toDateString() !== new Date(prevCreatedAt).toDateString();
}

function DateSeparator({ iso, C }: { iso: string; C: AppColors }) {
  const label = new Date(iso).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return (
    <View style={styles.dateSep}>
      <View style={[styles.dateLine, { backgroundColor: C.border }]} />
      <Text style={[styles.dateLabel, { color: C.textMuted }]}>{label}</Text>
      <View style={[styles.dateLine, { backgroundColor: C.border }]} />
    </View>
  );
}

// ─── Per-message translate button ───────────────────────────────────────────
interface TranslateButtonProps {
  msgId: string;
  content: string;
  isOwn: boolean;
  C: AppColors;
  translationCacheRef: React.MutableRefObject<Record<string, string>>;
}

function TranslateButton({ msgId, content, isOwn, C, translationCacheRef }: TranslateButtonProps) {
  const { translate, needsTranslation, currentLanguage } = useTranslatedContent();
  const cacheKey = `${msgId}::${currentLanguage}`;
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState<string | null>(
    translationCacheRef.current[cacheKey] ?? null
  );
  const [showTranslated, setShowTranslated] = useState(
    translationCacheRef.current[cacheKey] !== undefined
  );

  if (!needsTranslation || !content.trim()) return null;

  const handleTranslate = async () => {
    if (translated) {
      // Toggle between original and translated
      setShowTranslated((v) => !v);
      return;
    }
    setTranslating(true);
    try {
      const result = await translate(content, 'chat_message');
      setTranslated(result);
      setShowTranslated(true);
      // Cache in memory and AsyncStorage
      translationCacheRef.current[cacheKey] = result;
      AsyncStorage.getItem(CHAT_TRANSLATION_CACHE_KEY)
        .then((raw) => {
          const cache: Record<string, string> = raw ? JSON.parse(raw) : {};
          cache[cacheKey] = result;
          // Keep cache size manageable — max 200 entries
          const keys = Object.keys(cache);
          if (keys.length > 200) {
            const toDelete = keys.slice(0, keys.length - 200);
            toDelete.forEach((k) => delete cache[k]);
          }
          return AsyncStorage.setItem(CHAT_TRANSLATION_CACHE_KEY, JSON.stringify(cache));
        })
        .catch(() => {});
    } catch { /* non-blocking */ } finally {
      setTranslating(false);
    }
  };

  return (
    <Pressable
      onPress={handleTranslate}
      disabled={translating}
      style={({ pressed }) => [
        tb.btn,
        isOwn ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
        { backgroundColor: showTranslated ? `${C.accentBlue}14` : C.surface, borderColor: C.border },
        pressed ? { opacity: 0.7 } : null,
      ]}
      hitSlop={6}
    >
      {translating ? (
        <ActivityIndicator size={10} color={C.accentBlue} />
      ) : (
        <Ionicons name="language-outline" size={11} color={showTranslated ? C.accentBlue : C.textMuted} />
      )}
      <Text style={[tb.label, { color: showTranslated ? C.accentBlue : C.textMuted }]}>
        {translating ? 'Translating…' : showTranslated ? 'Show original' : 'Translate 🌐'}
      </Text>
      {showTranslated && translated ? (
        <View style={[tb.badge, { backgroundColor: `${C.accentBlue}20`, borderColor: `${C.accentBlue}44` }]}>
          <Text style={[tb.badgeText, { color: C.accentBlue }]}>Translated</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const tb = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
    marginHorizontal: 12, marginTop: 2, marginBottom: 4,
    alignSelf: 'flex-start',
  },
  label: { fontSize: 10, fontWeight: FONTS.semiBold },
  badge: {
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  badgeText: { fontSize: 8, fontWeight: FONTS.bold, letterSpacing: 0.3 },
});

// ─── Translation-aware message content ───────────────────────────────────────
function TranslatableContent({
  msgId, content, isOwn, C, translationCacheRef,
}: {
  msgId: string;
  content: string;
  isOwn: boolean;
  C: AppColors;
  translationCacheRef: React.MutableRefObject<Record<string, string>>;
}) {
  const { currentLanguage, needsTranslation } = useTranslatedContent();
  const cacheKey = `${msgId}::${currentLanguage}`;
  const [displayText, setDisplayText] = useState<string>(
    translationCacheRef.current[cacheKey] ?? content
  );
  const [isTranslated, setIsTranslated] = useState(
    translationCacheRef.current[cacheKey] !== undefined
  );

  // Re-sync when cache gets populated by TranslateButton
  const prevKeyRef = useRef<string>('');
  useEffect(() => {
    if (!needsTranslation) {
      setDisplayText(content);
      setIsTranslated(false);
      return;
    }
    const cached = translationCacheRef.current[cacheKey];
    if (cached && cacheKey !== prevKeyRef.current) {
      prevKeyRef.current = cacheKey;
      setDisplayText(cached);
      setIsTranslated(true);
    } else if (!cached) {
      setDisplayText(content);
      setIsTranslated(false);
    }
  }, [cacheKey, content, needsTranslation]);

  // Listen to TranslateButton's updates via a polling effect
  useEffect(() => {
    if (!needsTranslation) return;
    const check = setInterval(() => {
      const cached = translationCacheRef.current[cacheKey];
      if (cached && cached !== displayText) {
        setDisplayText(cached);
        setIsTranslated(true);
        clearInterval(check);
      }
    }, 300);
    return () => clearInterval(check);
  }, [cacheKey, displayText, needsTranslation]);

  // This component doesn't render anything directly — just updates state
  // The actual render is handled by ChatBubble; we expose via a ref instead.
  // For simplicity we render a tiny overlay badge when translated.
  if (!isTranslated) return null;
  return (
    <View
      style={[
        tc2.badge,
        isOwn ? { alignSelf: 'flex-end', marginRight: 12 } : { alignSelf: 'flex-start', marginLeft: 12 },
      ]}
    >
      <Ionicons name="language-outline" size={9} color={C.accentBlue} />
      <Text style={[tc2.text, { color: C.accentBlue }]}>Translated</Text>
    </View>
  );
}

const tc2 = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    marginTop: -2, marginBottom: 2,
    backgroundColor: 'transparent',
  },
  text: { fontSize: 9, fontWeight: FONTS.semiBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ChatRoomScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string; emoji?: string }>();
  const roomId = params.id;
  const roomName = params.name ? decodeURIComponent(params.name) : 'Chat Room';
  const roomEmoji = params.emoji ? decodeURIComponent(params.emoji) : '💬';

  const { user } = useAuth();
  const { messages, loading, sending, send, reload } = useChatRoom(roomId);

  // ─── Live username resolution from user_profiles ──────────────────────────
  // Maps userId → latest username fetched from user_profiles.
  // Populated lazily; refreshed on every reload and on a 60s poll.
  const usernameMapRef = useRef<Record<string, string>>({});
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});

  const resolveUsernames = useCallback(async (msgs: typeof messages) => {
    if (!msgs || msgs.length === 0) return;
    // Collect unique user IDs we haven't resolved yet (or want to refresh)
    const ids = [...new Set(msgs.map((m) => m.userId).filter(Boolean))];
    if (ids.length === 0) return;
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('user_profiles')
        .select('id, username')
        .in('id', ids);
      if (!data) return;
      const updated = { ...usernameMapRef.current };
      let changed = false;
      for (const row of data as { id: string; username: string | null }[]) {
        const name = row.username?.trim() || undefined;
        if (name && updated[row.id] !== name) {
          updated[row.id] = name;
          changed = true;
        }
      }
      if (changed) {
        usernameMapRef.current = updated;
        setUsernameMap({ ...updated });
      }
    } catch { /* non-blocking */ }
  }, []);

  // Resolve usernames whenever the message list changes
  useEffect(() => {
    resolveUsernames(messages);
  }, [messages, resolveUsernames]);

  // Refresh username map every 60s (picks up renames while user has chat open)
  useEffect(() => {
    const id = setInterval(() => resolveUsernames(messages), 60_000);
    return () => clearInterval(id);
  }, [messages, resolveUsernames]);

  // ─── Translation cache (in-memory, backed by AsyncStorage) ────────────────
  const translationCacheRef = useRef<Record<string, string>>({});

  // Load translation cache from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(CHAT_TRANSLATION_CACHE_KEY)
      .then((raw) => {
        if (raw) translationCacheRef.current = JSON.parse(raw);
      })
      .catch(() => {});
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollOffsetRef = useRef(0);
  const listHeightRef = useRef(0);
  const contentHeightRef = useRef(0);

  const handleScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollOffsetRef.current = contentOffset.y;
    contentHeightRef.current = contentSize.height;
    listHeightRef.current = layoutMeasurement.height;
    const distFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    setShowScrollDown(distFromBottom > 200);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const [text, setText] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [showStickerPanel, setShowStickerPanel] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Pinned message state ─────────────────────────────────────────────────
  const [pinnedMessage, setPinnedMessage] = useState<{
    id: string; username: string; content: string; isPinned?: boolean;
  } | null>(null);
  const [dismissedPinId, setDismissedPinId] = useState<string | null>(null);
  const [pinnedOverride, setPinnedOverride] = useState<Record<string, boolean>>({});

  const [reportingMsgId, setReportingMsgId] = useState<string | null>(null);

  const [mentionToasts, setMentionToasts] = useState<ToastItem[]>([]);
  const dismissMentionToast = useCallback((id: string) => {
    setMentionToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ─── Fetch & poll pinned message ──────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    const loadPinned = async () => {
      const msg = await fetchPinnedMessage(roomId);
      setPinnedMessage(msg as any);
    };
    loadPinned();
    const interval = setInterval(loadPinned, 30_000);
    return () => clearInterval(interval);
  }, [roomId]);

  // ─── Reaction state ───────────────────────────────────────────────────────
  const [pickerMsgId, setPickerMsgId] = useState<string | null>(null);
  const [reactionsOverride, setReactionsOverride] = useState<Record<string, Record<string, string[]>>>({});

  // ─── Search state ─────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<TextInput>(null);

  const flatRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onlineCount = useRef(Math.floor(Math.random() * 120 + 40)).current;

  const displayMessages = useMemo(() =>
    messages.map((msg) => ({
      ...msg,
      // Prefer live-resolved username from user_profiles over the stored value
      username: usernameMap[msg.userId] ?? msg.username,
      reactions: reactionsOverride[msg.id] ?? msg.reactions ?? {},
      isPinned: pinnedOverride[msg.id] !== undefined ? pinnedOverride[msg.id] : (msg.isPinned ?? false),
    })),
    [messages, usernameMap, reactionsOverride, pinnedOverride],
  );

  // ─── Latest activity from other users — drives read receipts ───────────────────
  // Derived from the already-polled displayMessages (polled every 15s via useChatRoom),
  // so no extra network request is needed.
  const latestOtherActivity = useMemo(() => {
    if (!user?.id) return null;
    let latest: string | null = null;
    for (const m of displayMessages) {
      if (m.userId !== user.id && !m.id.startsWith('temp-')) {
        if (!latest || m.createdAt > latest) latest = m.createdAt;
      }
    }
    return latest;
  }, [displayMessages, user?.id]);

  // ─── Search filtering ─────────────────────────────────────────────────────
  const visibleMessages = useMemo(() => {
    if (!searchQuery.trim()) return displayMessages;
    const q = searchQuery.toLowerCase();
    return displayMessages.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.username.toLowerCase().includes(q),
    );
  }, [displayMessages, searchQuery]);

  // Reset index to 0 whenever the query changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  // Scroll to current match and highlight it
  useEffect(() => {
    if (!searchQuery.trim()) {
      setHighlightedMsgId(null);
      return;
    }
    if (visibleMessages.length === 0) {
      setHighlightedMsgId(null);
      return;
    }
    const idx = Math.min(currentMatchIndex, visibleMessages.length - 1);
    const msg = visibleMessages[idx];
    setHighlightedMsgId(msg.id);
    const scrollTimer = setTimeout(() => {
      try {
        flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
      } catch { /* list may not be ready */ }
    }, 120);
    const clearTimer = setTimeout(() => setHighlightedMsgId(null), 1800);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [currentMatchIndex, searchQuery, visibleMessages.length]);

  // ─── Report message (called after reason selected in modal) ─────────────────
  const handleReport = useCallback(async (messageId: string, reason: string) => {
    if (!user?.id) return;
    setReportingMsgId(null);
    try {
      const supabase = getSupabaseClient();
      await supabase.from('reported_messages').insert({
        message_id: messageId,
        reporter_id: user.id,
        room_id: roomId,
        reason,
      });
    } catch { /* duplicate report — silently ignore */ }
    const toast: ToastItem = {
      id: `report-${messageId}-${Date.now()}`,
      matchLabel: '🚩 Report Sent',
      message: 'Thanks — our moderators will review this message.',
    };
    setMentionToasts((prev) => [toast, ...prev].slice(0, 2));
  }, [user?.id, roomId]);

  // ─── Toggle pin ────────────────────────────────────────────────────────────
  const handleTogglePin = useCallback(async (messageId: string) => {
    if (!user?.id) return;
    setPickerMsgId(null);

    const targetMsg = displayMessages.find((m) => m.id === messageId);
    if (!targetMsg) return;

    const currentlyPinned = pinnedOverride[messageId] !== undefined
      ? pinnedOverride[messageId]
      : (targetMsg.isPinned ?? false);
    const newPinned = !currentlyPinned;

    // Optimistic update
    setPinnedOverride((prev) => ({ ...prev, [messageId]: newPinned }));

    if (newPinned) {
      // Unpin all others optimistically
      const overrides: Record<string, boolean> = { [messageId]: true };
      for (const m of displayMessages) {
        if (m.id !== messageId && (pinnedOverride[m.id] ?? m.isPinned)) {
          overrides[m.id] = false;
        }
      }
      setPinnedOverride((prev) => ({ ...prev, ...overrides }));
      setPinnedMessage({ ...targetMsg, isPinned: true });
      setDismissedPinId(null);
    } else {
      setPinnedMessage(null);
    }

    // If pinning a new message, unpin all others in DB first
    if (newPinned) {
      const supabase = getSupabaseClient();
      await supabase
        .from('chat_messages')
        .update({ is_pinned: false })
        .eq('room_id', roomId)
        .eq('is_pinned', true);
    }

    await setPinned(messageId, newPinned);
  }, [user?.id, displayMessages, pinnedOverride, roomId]);

  // ─── Toggle reaction ──────────────────────────────────────────────────────
  const handleReact = useCallback(async (messageId: string, emoji: string) => {
    if (!user?.id) return;
    setPickerMsgId(null);

    const currentMsg = displayMessages.find((m) => m.id === messageId);
    const currentReactions = { ...(currentMsg?.reactions ?? {}) };
    const users: string[] = [...(currentReactions[emoji] ?? [])];
    const idx = users.indexOf(user.id);
    if (idx >= 0) users.splice(idx, 1);
    else users.push(user.id);
    currentReactions[emoji] = users;
    setReactionsOverride((prev) => ({ ...prev, [messageId]: currentReactions }));

    try {
      const supabase = getSupabaseClient();
      const { data: row } = await supabase
        .from('chat_messages').select('reactions').eq('id', messageId).single();

      const dbReactions: Record<string, string[]> = (row?.reactions && typeof row.reactions === 'object')
        ? { ...row.reactions } : {};
      const dbUsers: string[] = [...(dbReactions[emoji] ?? [])];
      const dbIdx = dbUsers.indexOf(user.id);
      if (dbIdx >= 0) dbUsers.splice(dbIdx, 1); else dbUsers.push(user.id);
      dbReactions[emoji] = dbUsers;

      await supabase.from('chat_messages').update({ reactions: dbReactions }).eq('id', messageId);
      setReactionsOverride((prev) => ({ ...prev, [messageId]: dbReactions }));
    } catch { /* optimistic stays */ }
  }, [user?.id, displayMessages]);

  // ─── Long-press a bubble → show emoji picker ──────────────────────────────
  const handleBubbleLongPress = useCallback((msgId: string) => {
    setPickerMsgId((prev) => (prev === msgId ? null : msgId));
    setShowStickerPanel(false);
  }, []);

  // ─── Tap @mention → scroll & highlight that user's last message ────────────
  const handleMentionPress = useCallback((username: string) => {
    // If search is open, close it first so visibleMessages === displayMessages
    if (showSearch) {
      setShowSearch(false);
      setSearchQuery('');
      setCurrentMatchIndex(0);
    }
    const lastIdx = displayMessages.reduce<number>(
      (found, msg, idx) => (msg.username === username ? idx : found),
      -1,
    );
    if (lastIdx === -1) {
      // Show a brief toast instead of silently doing nothing
      const toast: ToastItem = {
        id: `mention-${username}-${Date.now()}`,
        matchLabel: `@${username}`,
        message: `No messages from @${username} yet`,
      };
      setMentionToasts((prev) => [toast, ...prev].slice(0, 2));
      return;
    }
    const msgId = displayMessages[lastIdx].id;
    setTimeout(() => {
      try {
        flatRef.current?.scrollToIndex({ index: lastIdx, animated: true, viewPosition: 0.4 });
      } catch { /* ignore if list not ready */ }
      setHighlightedMsgId(msgId);
      setTimeout(() => setHighlightedMsgId(null), 1700);
    }, showSearch ? 180 : 80);
  }, [displayMessages, showSearch]);

  // ─── Select member ────────────────────────────────────────────────────────
  const handleSelectMember = useCallback((userId: string) => {
    setShowMembers(false);
    const lastIdx = displayMessages.reduce<number>(
      (found, msg, idx) => (msg.userId === userId ? idx : found),
      -1,
    );
    if (lastIdx === -1) return;
    const msgId = displayMessages[lastIdx].id;
    setTimeout(() => {
      try {
        flatRef.current?.scrollToIndex({ index: lastIdx, animated: true, viewPosition: 0.5 });
      } catch { /* ignore */ }
      setHighlightedMsgId(msgId);
      setTimeout(() => setHighlightedMsgId(null), 1700);
    }, 280);
  }, [displayMessages]);

  // ─── Tap a bubble → @reply prefix ────────────────────────────────────────
  const handleBubblePress = useCallback((msg: (typeof displayMessages)[0]) => {
    if (msg.userId === user?.id) return;
    const prefix = `@${msg.username} `;
    setReplyTarget({ userId: msg.userId, username: msg.username });
    setText((prev) => {
      if (prev.startsWith('@') && prev.includes(' ')) {
        return `${prefix}${prev.slice(prev.indexOf(' ') + 1)}`;
      }
      return prev.startsWith(prefix) ? prev : `${prefix}${prev}`;
    });
    setShowStickerPanel(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [displayMessages, user?.id]);

  // ─── Dismiss reply banner ─────────────────────────────────────────────────
  const handleDismissReply = useCallback(() => {
    if (replyTarget) {
      const prefix = `@${replyTarget.username} `;
      setText((prev) => (prev.startsWith(prefix) ? prev.slice(prefix.length) : prev));
    }
    setReplyTarget(null);
  }, [replyTarget]);

  // ─── Send sticker ─────────────────────────────────────────────────────────
  const handleSendSticker = useCallback(async (emoji: string) => {
    setShowStickerPanel(false);
    await send(emoji);
  }, [send]);

  // ─── Toggle sticker panel ─────────────────────────────────────────────────
  const handleToggleStickerPanel = useCallback(() => {
    setShowStickerPanel((prev) => {
      if (!prev) Keyboard.dismiss();
      return !prev;
    });
    setPickerMsgId(null);
  }, []);

  // ─── Search open / close / navigation ───────────────────────────────────────
  const handleOpenSearch = useCallback(() => {
    setShowSearch(true);
    setShowStickerPanel(false);
    setPickerMsgId(null);
    setTimeout(() => searchInputRef.current?.focus(), 80);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery('');
    setCurrentMatchIndex(0);
    setHighlightedMsgId(null);
    Keyboard.dismiss();
  }, []);

  const handlePrevMatch = useCallback(() => {
    if (visibleMessages.length === 0) return;
    setCurrentMatchIndex((prev) =>
      (prev - 1 + visibleMessages.length) % visibleMessages.length
    );
  }, [visibleMessages.length]);

  const handleNextMatch = useCallback(() => {
    if (visibleMessages.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % visibleMessages.length);
  }, [visibleMessages.length]);

  // Mark room seen + joined
  useEffect(() => {
    if (!roomId) return;
    (async () => {
      try {
        const now = new Date().toISOString();
        const rawSeen = await AsyncStorage.getItem(CHAT_ROOM_SEEN_MAP_KEY);
        const seenMap: Record<string, string> = rawSeen ? JSON.parse(rawSeen) : {};
        seenMap[roomId] = now;
        await AsyncStorage.setItem(CHAT_ROOM_SEEN_MAP_KEY, JSON.stringify(seenMap));

        const rawJoined = await AsyncStorage.getItem(JOINED_ROOMS_KEY);
        const joinedSet: string[] = rawJoined ? JSON.parse(rawJoined) : [];
        if (!joinedSet.includes(roomId)) {
          joinedSet.push(roomId);
          await AsyncStorage.setItem(JOINED_ROOMS_KEY, JSON.stringify(joinedSet));
        }
      } catch { /* non-blocking */ }
    })();
  }, [roomId]);

  // Auto-scroll on new messages (only when search is inactive)
  useEffect(() => {
    if (messages.length > 0 && !searchQuery.trim()) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleSend = useCallback(async () => {
    const val = text.trim();
    if (!val || sending) return;

    // Block URLs and phone numbers (scores like "2-1" are exempt)
    const { blocked, reason } = containsBlockedContent(val);
    if (blocked) {
      // Use inline inline alert via showAlert hook
      const toast: ToastItem = {
        id: `blocked-${Date.now()}`,
        matchLabel: '🚫 Not Allowed',
        message: reason,
      };
      setMentionToasts((prev) => [toast, ...prev].slice(0, 3));
      return;
    }

    setText('');
    setReplyTarget(null);
    setIsTyping(false);
    setShowStickerPanel(false);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    await send(val);
  }, [text, sending, send]);

  // ─── Render item ──────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: (typeof visibleMessages)[0]; index: number }) => {
      const prev = index > 0 ? visibleMessages[index - 1] : undefined;
      const showDate = shouldShowDateFor(item.createdAt, prev?.createdAt);
      const isHighlighted = item.id === highlightedMsgId;
      const isOwn = item.userId === user?.id;
      const isPickerOpen = pickerMsgId === item.id;

      // ─ Read receipt status for own messages ─────────────────────────
      let readStatus: ReadStatus | undefined;
      if (isOwn) {
        if (item.id.startsWith('temp-')) {
          readStatus = 'sending';
        } else if (latestOtherActivity && item.createdAt <= latestOtherActivity) {
          readStatus = 'read';
        } else {
          readStatus = 'delivered';
        }
      }

      return (
        <SwipeableRow
          isOwn={isOwn}
          C={C}
          onSwipeReply={() => {
            // Same flow as tapping a bubble — but available for own messages too
            const prefix = `@${item.username} `;
            setReplyTarget({ userId: item.userId, username: item.username });
            setText((prev) => {
              if (prev.startsWith('@') && prev.includes(' ')) {
                return `${prefix}${prev.slice(prev.indexOf(' ') + 1)}`;
              }
              return prev.startsWith(prefix) ? prev : `${prefix}${prev}`;
            });
            setShowStickerPanel(false);
            setTimeout(() => inputRef.current?.focus(), 80);
          }}
        >
        <View>
          {showDate ? <DateSeparator iso={item.createdAt} C={C} /> : null}
          <HighlightWrapper active={isHighlighted} color={C.accentBlue}>
            <Pressable
              onPress={() => {
                if (pickerMsgId) { setPickerMsgId(null); return; }
                handleBubblePress(item);
              }}
              onLongPress={() => handleBubbleLongPress(item.id)}
              delayLongPress={320}
              accessible={false}
            >
              <ChatBubble
                message={item}
                isOwn={isOwn}
                C={C}
                currentUserId={user?.id}
                onReact={(emoji) => handleReact(item.id, emoji)}
                onMentionPress={handleMentionPress}
                readStatus={readStatus}
              />
            </Pressable>
            {/* Per-message translate button — only for non-emoji-only messages */}
            {!isEmojiOnly(item.content) ? (
              <TranslateButton
                msgId={item.id}
                content={item.content}
                isOwn={isOwn}
                C={C}
                translationCacheRef={translationCacheRef}
              />
            ) : null}
          </HighlightWrapper>

          {isPickerOpen ? (
            <EmojiPicker
              visible={true}
              isOwn={isOwn}
              C={C}
              onSelect={(emoji) => handleReact(item.id, emoji)}
              onPin={() => handleTogglePin(item.id)}
              onReport={() => { setPickerMsgId(null); setReportingMsgId(item.id); }}
              onDismiss={() => setPickerMsgId(null)}
              isPinned={pinnedOverride[item.id] !== undefined ? pinnedOverride[item.id] : (item.isPinned ?? false)}
            />
          ) : null}
        </View>
        </SwipeableRow>
      );
    },
    [visibleMessages, user?.id, C, highlightedMsgId, pickerMsgId,
      handleBubblePress, handleBubbleLongPress, handleReact, handleMentionPress, handleTogglePin, pinnedOverride, latestOtherActivity],
  );

  // ─── Search empty state ───────────────────────────────────────────────────
  const renderSearchEmpty = () => (
    <View style={styles.searchEmpty}>
      <Ionicons name="search-outline" size={44} color={C.textMuted} />
      <Text style={[styles.emptyTitle, { color: C.textSecondary }]}>No matches</Text>
      <Text style={[styles.emptySubtitle, { color: C.textMuted }]}>
        No messages found for "{searchQuery}"
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      {/* Mention-not-found toasts — float at the top of this screen */}
      <ReportModal
        visible={reportingMsgId !== null}
        C={C}
        onSubmit={(reason) => { if (reportingMsgId) handleReport(reportingMsgId, reason); }}
        onCancel={() => setReportingMsgId(null)}
      />

      {mentionToasts.length > 0 ? (
        <View
          style={{
            position: 'absolute', top: 80, left: 0, right: 0, zIndex: 9999,
          }}
          pointerEvents="box-none"
        >
          <ToastStack toasts={mentionToasts} onDismiss={dismissMentionToast} />
        </View>
      ) : null}

      <RoomHeader
        name={roomName}
        emoji={roomEmoji}
        onlineCount={onlineCount}
        onBack={() => router.back()}
        onMembersPress={() => setShowMembers(true)}
        onSearchPress={handleOpenSearch}
        C={C}
      />

      {/* Pinned message banner — shown below header when a message is pinned */}
      {pinnedMessage && dismissedPinId !== pinnedMessage.id ? (
        <PinnedBanner
          message={pinnedMessage}
          C={C}
          onUnpin={() => handleTogglePin(pinnedMessage.id)}
          onDismiss={() => setDismissedPinId(pinnedMessage.id)}
          onScrollTo={() => {
            const idx = displayMessages.findIndex((m) => m.id === pinnedMessage.id);
            if (idx === -1) return;
            try {
              flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
            } catch { /* ignore */ }
            setHighlightedMsgId(pinnedMessage.id);
            setTimeout(() => setHighlightedMsgId(null), 1700);
          }}
        />
      ) : null}

      {/* Inline search bar — shown below header when search is active */}
      {showSearch ? (
        <InlineSearchBar
          query={searchQuery}
          matchCount={visibleMessages.length}
          currentIndex={currentMatchIndex}
          hasQuery={searchQuery.trim().length > 0}
          C={C}
          inputRef={searchInputRef}
          onChangeText={setSearchQuery}
          onClear={() => { setSearchQuery(''); setCurrentMatchIndex(0); }}
          onClose={handleCloseSearch}
          onPrev={handlePrevMatch}
          onNext={handleNextMatch}
        />
      ) : null}

      <MembersSheet
        visible={showMembers}
        onClose={() => setShowMembers(false)}
        roomId={roomId}
        C={C}
        onSelectMember={handleSelectMember}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={C.primary} size="large" />
            <Text style={[styles.loadingText, { color: C.textMuted }]}>Loading messages...</Text>
          </View>
        ) : messages.length === 0 ? (
          <EmptyMessages C={C} />
        ) : searchQuery.trim().length > 0 && visibleMessages.length === 0 ? (
          renderSearchEmpty()
        ) : (
          <FlatList
            ref={flatRef}
            data={visibleMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={(_, h) => {
              contentHeightRef.current = h;
              if (!searchQuery.trim()) flatRef.current?.scrollToEnd({ animated: false });
            }}
            onLayout={(e) => { listHeightRef.current = e.nativeEvent.layout.height; }}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            onScrollBeginDrag={() => { setPickerMsgId(null); setShowStickerPanel(false); }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={C.primary}
                colors={[C.primary]}
              />
            }
          />
        )}

        {/* Typing indicator */}
        {isTyping ? <TypingBubble C={C} /> : null}

        {/* Polling indicator */}
        <View style={styles.syncRow}>
          <View style={[styles.syncDot, { backgroundColor: C.accentBlue }]} />
          <Text style={[styles.syncText, { color: C.textMuted }]}>Refreshing every 15s</Text>
        </View>

        {/* Input area */}
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.surface }}>
          {replyTarget ? (
            <View
              style={[
                styles.replyBanner,
                {
                  backgroundColor: `${C.accentBlue}10`,
                  borderTopColor: C.border,
                  borderBottomColor: `${C.accentBlue}30`,
                },
              ]}
            >
              <Ionicons name="return-down-forward-outline" size={13} color={C.accentBlue} />
              <Text style={[styles.replyBannerText, { color: C.accentBlue }]} numberOfLines={1}>
                Replying to{' '}
                <Text style={styles.replyBannerUser}>@{replyTarget.username}</Text>
              </Text>
              <Pressable onPress={handleDismissReply} hitSlop={12}>
                <Ionicons name="close" size={15} color={C.textMuted} />
              </Pressable>
            </View>
          ) : null}

          {/* Sticker panel — sits directly above the input bar */}
          <StickerPanel
            visible={showStickerPanel}
            C={C}
            onSend={handleSendSticker}
            onClose={() => setShowStickerPanel(false)}
          />

          {user ? (
            <View style={[styles.inputBar, { borderTopColor: C.border, backgroundColor: C.surface }]}>
              {/* Avatar */}
              <View style={[styles.inputAvatar, { backgroundColor: getAvatarColor(user.email, C) }]}>
                <Text style={[styles.inputAvatarText, { color: C.textInverse }]}>
                  {(user.username || user.email)[0].toUpperCase()}
                </Text>
              </View>

              <TextInput
                ref={inputRef}
                style={[
                  styles.input,
                  {
                    backgroundColor: C.card,
                    borderColor: replyTarget ? C.accentBlue : C.border,
                    color: C.textPrimary,
                  },
                ]}
                value={text}
                onChangeText={(val) => {
                  setText(val);
                  if (replyTarget && !val.startsWith(`@${replyTarget.username}`)) {
                    setReplyTarget(null);
                  }
                  if (val.trim().length > 0) {
                    setIsTyping(true);
                    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                    typingTimerRef.current = setTimeout(() => setIsTyping(false), 1500);
                  } else {
                    setIsTyping(false);
                    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                  }
                }}
                placeholder={
                  replyTarget
                    ? `Reply to @${replyTarget.username}…`
                    : 'Share your thoughts...'
                }
                placeholderTextColor={C.textMuted}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                maxLength={300}
                blurOnSubmit={false}
                onFocus={() => {
                  setPickerMsgId(null);
                  setShowStickerPanel(false);
                }}
              />

              {/* Sticker toggle */}
              <Pressable
                onPress={handleToggleStickerPanel}
                style={({ pressed }) => [
                  styles.stickerToggleBtn,
                  {
                    backgroundColor: showStickerPanel ? `${C.primary}18` : C.card,
                    borderColor: showStickerPanel ? C.primary : C.border,
                  },
                  pressed ? { opacity: 0.7 } : null,
                ]}
                hitSlop={4}
              >
                <Text style={styles.stickerToggleEmoji}>
                  {showStickerPanel ? '⌨️' : '😊'}
                </Text>
              </Pressable>

              {/* Send */}
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  { backgroundColor: C.primary },
                  !text.trim() || sending ? { backgroundColor: C.border } : null,
                  pressed && text.trim() ? styles.sendBtnPressed : null,
                ]}
                onPress={handleSend}
                disabled={!text.trim() || sending}
                hitSlop={4}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={C.textInverse} />
                ) : (
                  <Ionicons name="send" size={17} color={C.textInverse} />
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.signInBar, { borderTopColor: C.border, backgroundColor: C.surface }]}
              onPress={() => router.push('/login' as any)}
            >
              <Ionicons name="lock-closed-outline" size={15} color={C.textMuted} />
              <Text style={[styles.signInText, { color: C.textMuted }]}>Sign in to join the discussion</Text>
              <Text style={[styles.signInCta, { color: C.primary }]}>Sign In</Text>
            </Pressable>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>

      {/* Scroll-to-bottom FAB — absolutely positioned within root View, above input bar */}
      {showScrollDown ? (
        <View style={styles.scrollDownFab} pointerEvents="box-none">
          <Pressable
            style={({ pressed }) => [
              styles.scrollDownBtn,
              { backgroundColor: C.primary, shadowColor: C.primary },
              pressed ? { opacity: 0.8, transform: [{ scale: 0.93 }] } : null,
            ]}
            onPress={() => flatRef.current?.scrollToEnd({ animated: true })}
            hitSlop={8}
          >
            <Ionicons name="arrow-down" size={18} color={C.textInverse} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 10, gap: 10,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emojiCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  emojiText: { fontSize: 20 },
  headerInfo: { flex: 1 },
  roomName: { fontSize: 15, fontWeight: FONTS.bold },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },
  onlineText: { fontSize: 11, fontWeight: FONTS.semiBold },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },

  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 13 },

  searchEmpty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 12, paddingHorizontal: 40,
  },

  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 12, paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 20 },

  messageList: { paddingTop: SPACING.sm, paddingBottom: SPACING.sm },

  dateSep: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.md, marginVertical: 10,
  },
  dateLine: { flex: 1, height: 1 },
  dateLabel: { fontSize: 11, fontWeight: FONTS.medium },

  syncRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 4,
  },
  syncDot: { width: 5, height: 5, borderRadius: 3 },
  syncText: { fontSize: 10 },

  replyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: SPACING.md, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: 1,
  },
  replyBannerText: { flex: 1, fontSize: 12 },
  replyBannerUser: { fontWeight: FONTS.bold },

  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SPACING.md, paddingVertical: 10, borderTopWidth: 1,
  },
  inputAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  inputAvatarText: { fontSize: 14, fontWeight: FONTS.bold },
  input: {
    flex: 1, height: 44,
    borderRadius: RADIUS.full, paddingHorizontal: 16,
    fontSize: 14, borderWidth: 1,
  },
  stickerToggleBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, flexShrink: 0,
  },
  stickerToggleEmoji: { fontSize: 20 },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnPressed: { opacity: 0.85, transform: [{ scale: 0.93 }] },

  signInBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 14, borderTopWidth: 1,
  },
  signInText: { flex: 1, fontSize: 13 },
  signInCta: { fontSize: 13, fontWeight: FONTS.bold },

  scrollDownFab: {
    position: 'absolute',
    // 110px clears the sync row (~20px) + input bar (~70px) + safe area padding
    bottom: 110,
    right: SPACING.md,
    zIndex: 50,
  },
  scrollDownBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
    shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
});
