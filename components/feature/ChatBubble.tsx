import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, RADIUS } from '@/constants/theme';
import { ChatMessage } from '@/services/types';
import type { AppColors } from '@/constants/theme';

export type ReadStatus = 'sending' | 'delivered' | 'read';

interface ChatBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  C: AppColors;
  currentUserId?: string;
  onReact?: (emoji: string) => void;
  onMentionPress?: (username: string) => void;
  readStatus?: ReadStatus;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getAvatarColor(name: string, C: AppColors): string {
  const palette = [C.primary, C.accent, C.accentBlue, C.accentPurple, C.accentRed];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + hash;
  return palette[Math.abs(hash) % palette.length];
}

// ─── @mention parser ──────────────────────────────────────────────────────────
// Splits content into plain-text and @mention segments for rich rendering.
interface TextSegment {
  type: 'text' | 'mention';
  value: string;
}

// ─── Emoji-only detector ─────────────────────────────────────────────────────
// Returns true when the entire trimmed string consists only of emoji characters.
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 12) return false;
  // Strip emoji & variation selectors; if nothing remains → emoji-only
  const stripped = trimmed
    .replace(/[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\uFE0F\u200D]/gu, '')
    .trim();
  return stripped.length === 0;
}

function parseContent(content: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /@(\w+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'mention', value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: 'text', value: content }];
}

// ─── Reaction pill row ────────────────────────────────────────────────────────
function ReactionRow({
  reactions, currentUserId, onReact, C,
}: {
  reactions: Record<string, string[]>;
  currentUserId?: string;
  onReact?: (emoji: string) => void;
  C: AppColors;
}) {
  const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);
  if (entries.length === 0) return null;

  return (
    <View style={reactionStyles.row}>
      {entries.map(([emoji, users]) => {
        const isMine = currentUserId ? users.includes(currentUserId) : false;
        return (
          <Pressable
            key={emoji}
            onPress={() => onReact?.(emoji)}
            style={({ pressed }) => [
              reactionStyles.pill,
              {
                backgroundColor: isMine ? `${C.primary}20` : `${C.card}`,
                borderColor: isMine ? C.primary : C.border,
              },
              pressed ? { opacity: 0.7, transform: [{ scale: 0.95 }] } : null,
            ]}
            hitSlop={4}
          >
            <Text style={reactionStyles.pillEmoji}>{emoji}</Text>
            <Text style={[reactionStyles.pillCount, { color: isMine ? C.primary : C.textMuted }]}>
              {users.length}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const reactionStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  pillEmoji: { fontSize: 13, lineHeight: 17 },
  pillCount: { fontSize: 11, fontWeight: FONTS.bold, lineHeight: 17 },
});

// ─── Main component ───────────────────────────────────────────────────────────
// ─── Read receipt tick ───────────────────────────────────────────────────────
function ReadTick({ status, C }: { status: ReadStatus; C: AppColors }) {
  if (status === 'sending') {
    return <Ionicons name="time-outline" size={10} color={C.textMuted} style={tickStyles.icon} />;
  }
  if (status === 'delivered') {
    return <Ionicons name="checkmark" size={11} color={C.textMuted} style={tickStyles.icon} />;
  }
  // read — double blue tick
  return <Ionicons name="checkmark-done" size={11} color={C.accentBlue} style={tickStyles.icon} />;
}

const tickStyles = StyleSheet.create({
  icon: { alignSelf: 'flex-end' },
});

export default function ChatBubble({ message, isOwn, C, currentUserId, onReact, onMentionPress, readStatus }: ChatBubbleProps) {
  const avatarColor = getAvatarColor(message.username, C);
  const initial = message.username[0]?.toUpperCase() || '?';
  const segments = parseContent(message.content);
  const reactions = message.reactions ?? {};
  const emojiOnly = isEmojiOnly(message.content);

  return (
    <View style={[styles.container, isOwn ? styles.ownContainer : null]}>
      {!isOwn ? (
        <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
          <Text style={[styles.avatarText, { color: C.textInverse }]}>{initial}</Text>
        </View>
      ) : null}
      <View style={[styles.bubbleCol, isOwn ? styles.ownBubbleCol : null]}>
        <View style={[
          styles.bubble,
          isOwn
            ? [styles.ownBubble, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.25)' }]
            : [styles.otherBubble, { backgroundColor: C.card, borderColor: C.border }],
        ]}>
          {!isOwn ? (
            <Text style={[styles.username, { color: avatarColor }]}>{message.username}</Text>
          ) : null}

          {/* Content with @mention highlighting — oversized for emoji-only */}
          {emojiOnly ? (
            <Text style={styles.emojiLarge}>{message.content.trim()}</Text>
          ) : (
            <Text style={[styles.content, { color: C.textPrimary }]}>
              {segments.map((seg, i) =>
                seg.type === 'mention' ? (
                  <Text
                    key={i}
                    style={[
                      styles.mention,
                      { color: C.accentBlue },
                      onMentionPress ? styles.mentionTappable : null,
                    ]}
                    onPress={
                      onMentionPress
                        ? () => onMentionPress(seg.value.slice(1))
                        : undefined
                    }
                    suppressHighlighting
                  >
                    {seg.value}
                  </Text>
                ) : (
                  <Text key={i}>{seg.value}</Text>
                )
              )}
            </Text>
          )}

          <View style={styles.timeRow}>
            <Text style={[styles.time, { color: C.textMuted }]}>{timeAgo(message.createdAt)}</Text>
            {isOwn && readStatus ? <ReadTick status={readStatus} C={C} /> : null}
          </View>
        </View>

        {/* Reaction pills rendered outside/below the bubble */}
        <ReactionRow
          reactions={reactions}
          currentUserId={currentUserId}
          onReact={onReact}
          C={C}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', marginVertical: 4, paddingHorizontal: 16, gap: 8 },
  ownContainer: { justifyContent: 'flex-end' },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4, flexShrink: 0,
  },
  avatarText: { fontSize: 13, fontWeight: FONTS.bold },
  bubbleCol: { maxWidth: '75%', gap: 0 },
  ownBubbleCol: { alignItems: 'flex-end' },
  bubble: {
    borderRadius: RADIUS.lg,
    padding: 10, gap: 3,
  },
  otherBubble: { borderWidth: 1, borderTopLeftRadius: 4 },
  ownBubble: { borderWidth: 1, borderTopRightRadius: 4 },
  username: { fontSize: 11, fontWeight: FONTS.bold, marginBottom: 1 },
  content: { fontSize: 14, lineHeight: 20 },
  mention: { fontWeight: FONTS.bold },
  mentionTappable: { textDecorationLine: 'underline' },
  emojiLarge: { fontSize: 44, lineHeight: 52, letterSpacing: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4 },
  time: { fontSize: 10 },
});
