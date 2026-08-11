/**
 * app/admin-chat.tsx
 * Admin Chat Room Management — Full CRUD for all chat rooms
 * Accessible only to users with admin_roles entry.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput,
  ActivityIndicator, RefreshControl, Alert, Modal,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient, useAuth } from '@/template';
import { useAdminRole } from '@/hooks/useAdminRole';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatRoom {
  id: string;
  name: string;
  description: string | null;
  type: string;
  matchId: string | null;
  emoji: string;
  membersCount: number;
  createdAt: string;
}

interface RoomForm {
  name: string;
  description: string;
  type: string;
  emoji: string;
  membersCount: string;
}

const ROOM_TYPES = [
  { key: 'public', label: 'Public', icon: 'globe-outline', desc: 'Visible to all users' },
  { key: 'private', label: 'Private', icon: 'lock-closed-outline', desc: 'Invite-only access' },
  { key: 'vip', label: 'VIP', icon: 'diamond-outline', desc: 'VIP subscribers only' },
  { key: 'expert', label: 'Expert', icon: 'school-outline', desc: 'Verified experts only' },
  { key: 'match', label: 'Match', icon: 'football-outline', desc: 'Auto match discussion' },
];

const ROOM_EMOJIS = ['⚽', '🏀', '🎾', '🏏', '⚾', '🏒', '🏉', '🏈', '🏐', '🥊', '🎮', '🏆', '👑', '🧠', '🌟', '🔥', '💬', '🎯', '🏅', '💎'];

function typeColor(type: string): string {
  switch (type) {
    case 'vip': return '#F59E0B';
    case 'expert': return '#8B5CF6';
    case 'private': return '#EF4444';
    case 'match': return '#3B82F6';
    default: return '#22C55E';
  }
}

// ─── Room Form Modal ──────────────────────────────────────────────────────────
function RoomModal({
  visible, initial, onClose, onSave, C,
}: {
  visible: boolean;
  initial: RoomForm | null;
  onClose: () => void;
  onSave: (form: RoomForm) => Promise<void>;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const isEdit = initial !== null;
  const [form, setForm] = useState<RoomForm>(initial ?? { name: '', description: '', type: 'public', emoji: '💬', membersCount: '0' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setForm(initial ?? { name: '', description: '', type: 'public', emoji: '💬', membersCount: '0' });
  }, [visible, initial]);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch { /* error shown via alert */ }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[rm.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
          <View style={[rm.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={C.textMuted} /></Pressable>
            <Text style={[rm.title, { color: C.textPrimary }]}>{isEdit ? 'Edit Room' : 'Create Room'}</Text>
            <Pressable
              onPress={handleSave}
              disabled={saving || !form.name.trim()}
              style={[rm.saveBtn, { backgroundColor: form.name.trim() ? C.primary : C.border }]}>
              {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={rm.saveBtnText}>Save</Text>}
            </Pressable>
          </View>
        </SafeAreaView>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={rm.content} showsVerticalScrollIndicator={false}>
            {/* Emoji picker */}
            <Text style={[rm.label, { color: C.textSecondary }]}>Room Icon</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rm.emojiRow}>
              {ROOM_EMOJIS.map(e => (
                <Pressable
                  key={e}
                  style={[rm.emojiBtn, form.emoji === e ? { backgroundColor: C.primaryGlow, borderColor: C.primary } : { backgroundColor: C.card, borderColor: C.border }]}
                  onPress={() => setForm(f => ({ ...f, emoji: e }))}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Name */}
            <Text style={[rm.label, { color: C.textSecondary }]}>Room Name *</Text>
            <TextInput
              style={[rm.input, { backgroundColor: C.card, borderColor: C.border, color: C.textPrimary }]}
              value={form.name}
              onChangeText={v => setForm(f => ({ ...f, name: v }))}
              placeholder="e.g. Premier League Chat"
              placeholderTextColor={C.textMuted}
              maxLength={60}
            />

            {/* Description */}
            <Text style={[rm.label, { color: C.textSecondary }]}>Description</Text>
            <TextInput
              style={[rm.input, rm.textarea, { backgroundColor: C.card, borderColor: C.border, color: C.textPrimary }]}
              value={form.description}
              onChangeText={v => setForm(f => ({ ...f, description: v }))}
              placeholder="What's this room about?"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={3}
              maxLength={200}
            />

            {/* Room type */}
            <Text style={[rm.label, { color: C.textSecondary }]}>Room Type</Text>
            <View style={rm.typeGrid}>
              {ROOM_TYPES.map(t => {
                const sel = form.type === t.key;
                const tc = typeColor(t.key);
                return (
                  <Pressable
                    key={t.key}
                    style={[rm.typeBtn, sel ? { backgroundColor: `${tc}18`, borderColor: `${tc}55` } : { backgroundColor: C.card, borderColor: C.border }]}
                    onPress={() => setForm(f => ({ ...f, type: t.key }))}>
                    <Ionicons name={t.icon as any} size={18} color={sel ? tc : C.textMuted} />
                    <Text style={[rm.typeName, { color: sel ? tc : C.textSecondary }]}>{t.label}</Text>
                    <Text style={[rm.typeDesc, { color: C.textMuted }]}>{t.desc}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
const rm = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1 },
  title: { fontSize: 17, fontWeight: FONTS.bold },
  saveBtn: { borderRadius: RADIUS.full, paddingHorizontal: 18, paddingVertical: 8 },
  saveBtnText: { fontSize: 14, fontWeight: FONTS.bold, color: '#000' },
  content: { paddingHorizontal: SPACING.md, paddingVertical: 16, gap: 6 },
  label: { fontSize: 12, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  emojiRow: { flexDirection: 'row', gap: 8, paddingBottom: 8 },
  emojiBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  input: { borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  textarea: { height: 80, textAlignVertical: 'top' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeBtn: { width: '47%', borderRadius: RADIUS.lg, borderWidth: 1.5, padding: 12, gap: 4, alignItems: 'flex-start' },
  typeName: { fontSize: 13, fontWeight: FONTS.bold },
  typeDesc: { fontSize: 10, lineHeight: 14 },
});

// ─── Room Row ─────────────────────────────────────────────────────────────────
function RoomRow({ room, C, onEdit, onDelete, onLock, onPin }: {
  room: ChatRoom;
  C: ReturnType<typeof useTheme>['colors'];
  onEdit: () => void;
  onDelete: () => void;
  onLock: () => void;
  onPin: () => void;
}) {
  const tc = typeColor(room.type);
  return (
    <View style={[rr.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={rr.left}>
        <View style={[rr.emojiWrap, { backgroundColor: `${tc}14`, borderColor: `${tc}33` }]}>
          <Text style={{ fontSize: 22 }}>{room.emoji}</Text>
        </View>
        <View style={rr.info}>
          <View style={rr.titleRow}>
            <Text style={[rr.name, { color: C.textPrimary }]} numberOfLines={1}>{room.name}</Text>
            <View style={[rr.typeBadge, { backgroundColor: `${tc}18`, borderColor: `${tc}33` }]}>
              <Text style={[rr.typeText, { color: tc }]}>{room.type.toUpperCase()}</Text>
            </View>
          </View>
          {room.description ? (
            <Text style={[rr.desc, { color: C.textMuted }]} numberOfLines={1}>{room.description}</Text>
          ) : null}
          <View style={rr.meta}>
            <Ionicons name="people-outline" size={11} color={C.textMuted} />
            <Text style={[rr.metaText, { color: C.textMuted }]}>{room.membersCount.toLocaleString()} members</Text>
          </View>
        </View>
      </View>
      <View style={rr.actions}>
        <Pressable onPress={onPin} hitSlop={8} style={[rr.actionBtn, { backgroundColor: `${C.primary}14` }]}>
          <Ionicons name="pin-outline" size={14} color={C.primary} />
        </Pressable>
        <Pressable onPress={onLock} hitSlop={8} style={[rr.actionBtn, { backgroundColor: '#F59E0B14' }]}>
          <Ionicons name="lock-closed-outline" size={14} color="#F59E0B" />
        </Pressable>
        <Pressable onPress={onEdit} hitSlop={8} style={[rr.actionBtn, { backgroundColor: '#3B82F614' }]}>
          <Ionicons name="pencil-outline" size={14} color="#3B82F6" />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={8} style={[rr.actionBtn, { backgroundColor: '#EF444414' }]}>
          <Ionicons name="trash-outline" size={14} color="#EF4444" />
        </Pressable>
      </View>
    </View>
  );
}
const rr = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 12, gap: 10 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emojiWrap: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  info: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: FONTS.semiBold, flex: 1 },
  typeBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  typeText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  desc: { fontSize: 11 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 10 },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  actionBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminChatScreen() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { isAdmin } = useAdminRole();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editRoom, setEditRoom] = useState<(ChatRoom & RoomForm) | null>(null);

  const fetchRooms = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('chat_rooms')
        .select('*')
        .order('created_at', { ascending: true });
      setRooms((data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        type: r.type ?? 'public',
        matchId: r.match_id ?? null,
        emoji: r.emoji ?? '💬',
        membersCount: r.members_count ?? 0,
        createdAt: r.created_at,
      })));
    } catch { /* non-blocking */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const filteredRooms = useMemo(() => {
    let f = rooms;
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter(r => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q));
    }
    if (filter !== 'all') f = f.filter(r => r.type === filter);
    return f;
  }, [rooms, search, filter]);

  const handleCreate = useCallback(async (form: RoomForm) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('chat_rooms').insert({
      name: form.name.trim(),
      description: form.description.trim() || null,
      type: form.type,
      emoji: form.emoji,
      members_count: parseInt(form.membersCount, 10) || 0,
    });
    if (error) throw error;
    await fetchRooms();
  }, [fetchRooms]);

  const handleEdit = useCallback(async (form: RoomForm) => {
    if (!editRoom) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('chat_rooms').update({
      name: form.name.trim(),
      description: form.description.trim() || null,
      type: form.type,
      emoji: form.emoji,
      members_count: parseInt(form.membersCount, 10) || 0,
    }).eq('id', editRoom.id);
    if (error) throw error;
    setEditRoom(null);
    await fetchRooms();
  }, [editRoom, fetchRooms]);

  const handleDelete = useCallback((room: ChatRoom) => {
    Alert.alert(
      'Delete Room',
      `Delete "${room.name}"? All messages will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const supabase = getSupabaseClient();
            await supabase.from('chat_messages').delete().eq('room_id', room.id);
            await supabase.from('chat_rooms').delete().eq('id', room.id);
            fetchRooms();
          },
        },
      ],
    );
  }, [fetchRooms]);

  const handleLock = useCallback(async (room: ChatRoom) => {
    // Archive / lock: change type to 'archived'
    const supabase = getSupabaseClient();
    const newType = room.type === 'archived' ? 'public' : 'archived';
    await supabase.from('chat_rooms').update({ type: newType }).eq('id', room.id);
    fetchRooms();
  }, [fetchRooms]);

  const handlePinMessage = useCallback(async (room: ChatRoom) => {
    Alert.alert('Pin Message', `To pin a message in "${room.name}", open the room and long-press any message.`);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rooms.length };
    for (const r of rooms) c[r.type] = (c[r.type] ?? 0) + 1;
    return c;
  }, [rooms]);

  if (!isAdmin) {
    return (
      <View style={[s.root, s.centered, { backgroundColor: C.bg }]}>
        <Text style={{ fontSize: 48 }}>🔒</Text>
        <Text style={[s.emptyTitle, { color: C.textPrimary }]}>Admin Access Required</Text>
        <Pressable style={[s.backBtn2, { backgroundColor: C.primary }]} onPress={() => router.back()}>
          <Text style={{ color: '#000', fontWeight: FONTS.bold, fontSize: 14 }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        {/* Header */}
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={s.headerCenter}>
            <MaterialIcons name="chat" size={20} color={C.primary} />
            <Text style={[s.title, { color: C.textPrimary }]}>Chat Management</Text>
          </View>
          <Pressable
            onPress={() => { setEditRoom(null); setShowModal(true); }}
            style={[s.createBtn, { backgroundColor: C.primary }]}
            hitSlop={8}>
            <Ionicons name="add" size={20} color="#000" />
          </Pressable>
        </View>

        {/* Search */}
        <View style={[s.searchWrap, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <View style={[s.searchBar, { backgroundColor: C.card, borderColor: C.border }]}>
            <Ionicons name="search-outline" size={16} color={C.textMuted} />
            <TextInput
              style={[s.searchInput, { color: C.textPrimary }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search rooms..."
              placeholderTextColor={C.textMuted}
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={15} color={C.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Type filter */}
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={[s.filterBar, { borderBottomColor: C.border }]}
          contentContainerStyle={s.filterContent}>
          {['all', 'public', 'private', 'vip', 'expert', 'match'].map(t => {
            const sel = filter === t;
            const tc = t === 'all' ? C.primary : typeColor(t);
            return (
              <Pressable
                key={t}
                style={[s.filterChip, sel ? { backgroundColor: `${tc}18`, borderColor: `${tc}55` } : { backgroundColor: C.card, borderColor: C.border }]}
                onPress={() => setFilter(t)}>
                <Text style={[s.filterText, { color: sel ? tc : C.textMuted }]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                  {counts[t] !== undefined ? ` (${counts[t]})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      {/* Stats strip */}
      <View style={[s.statsStrip, { backgroundColor: C.card, borderColor: C.border }]}>
        {[
          { val: rooms.length, label: 'Total', color: C.primary },
          { val: rooms.filter(r => r.type === 'public').length, label: 'Public', color: '#22C55E' },
          { val: rooms.filter(r => r.type === 'vip').length, label: 'VIP', color: '#F59E0B' },
          { val: rooms.filter(r => r.type === 'expert').length, label: 'Expert', color: '#8B5CF6' },
        ].map((item, i) => (
          <React.Fragment key={item.label}>
            {i > 0 ? <View style={[s.statsDivider, { backgroundColor: C.border }]} /> : null}
            <View style={s.statItem}>
              <Text style={[s.statVal, { color: item.color }]}>{item.val}</Text>
              <Text style={[s.statLabel, { color: C.textMuted }]}>{item.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredRooms}
          keyExtractor={r => r.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRooms(); }} tintColor={C.primary} />}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={{ fontSize: 40 }}>💬</Text>
              <Text style={[s.emptyTitle, { color: C.textPrimary }]}>No rooms found</Text>
              <Pressable
                style={[s.backBtn2, { backgroundColor: C.primary }]}
                onPress={() => { setEditRoom(null); setShowModal(true); }}>
                <Ionicons name="add" size={16} color="#000" />
                <Text style={{ color: '#000', fontWeight: FONTS.bold, fontSize: 14 }}>Create Room</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <RoomRow
              room={item}
              C={C}
              onEdit={() => {
                setEditRoom({
                  ...item,
                  description: item.description ?? '',
                  membersCount: String(item.membersCount),
                });
                setShowModal(true);
              }}
              onDelete={() => handleDelete(item)}
              onLock={() => handleLock(item)}
              onPin={() => handlePinMessage(item)}
            />
          )}
        />
      )}

      {/* Create / Edit Modal */}
      <RoomModal
        visible={showModal}
        initial={editRoom ? { name: editRoom.name, description: editRoom.description ?? '', type: editRoom.type, emoji: editRoom.emoji, membersCount: String(editRoom.membersCount) } : null}
        onClose={() => { setShowModal(false); setEditRoom(null); }}
        onSave={editRoom ? handleEdit : handleCreate}
        C={C}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backBtn2: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, paddingHorizontal: 20, paddingVertical: 11, marginTop: 8 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: FONTS.bold },
  createBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { paddingHorizontal: SPACING.md, paddingVertical: 10, borderBottomWidth: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, fontSize: 14 },
  filterBar: { borderBottomWidth: 1 },
  filterContent: { flexDirection: 'row', paddingHorizontal: SPACING.md, paddingVertical: 10, gap: 8 },
  filterChip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  filterText: { fontSize: 12, fontWeight: FONTS.semiBold },
  statsStrip: { flexDirection: 'row', paddingVertical: 14, marginHorizontal: SPACING.md, marginTop: 12, borderRadius: RADIUS.lg, borderWidth: 1 },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { fontSize: 20, fontWeight: FONTS.extraBold },
  statLabel: { fontSize: 10, fontWeight: FONTS.medium },
  statsDivider: { width: 1, marginVertical: 6 },
  listContent: { paddingHorizontal: SPACING.md, paddingTop: 12, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold },
});
