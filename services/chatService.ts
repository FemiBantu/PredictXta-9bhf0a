import { getSupabaseClient } from '@/template';
import { ChatRoom, ChatMessage } from './types';

// Find or create a chat room linked to a specific match
export async function fetchOrCreateMatchRoom(matchId: string, matchTitle: string): Promise<ChatRoom | null> {
  try {
    const supabase = getSupabaseClient();

    // Try to find an existing room for this match
    const { data: existing, error: findErr } = await supabase
      .from('chat_rooms')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle();

    if (!findErr && existing) {
      return {
        id: existing.id,
        name: existing.name,
        description: existing.description,
        type: existing.type,
        emoji: existing.emoji || '⚽',
        membersCount: existing.members_count || 0,
        matchId: existing.match_id ?? null,
        createdAt: existing.created_at,
      };
    }

    // Create a new match room
    const { data: created, error: createErr } = await supabase
      .from('chat_rooms')
      .insert({
        name: matchTitle,
        description: 'Live match discussion',
        type: 'match',
        match_id: matchId,
        emoji: '⚽',
        members_count: 0,
      })
      .select()
      .single();

    if (createErr || !created) return null;

    return {
      id: created.id,
      name: created.name,
      description: created.description,
      type: created.type,
      emoji: created.emoji || '⚽',
      membersCount: created.members_count || 0,
      matchId: created.match_id ?? null,
      createdAt: created.created_at,
    };
  } catch {
    return null;
  }
}

export async function fetchChatRooms(): Promise<ChatRoom[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('chat_rooms')
      .select('*')
      .order('created_at', { ascending: true });
    if (error || !data || data.length === 0) return [];
    return data.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      emoji: r.emoji || '💬',
      membersCount: r.members_count || 0,
      matchId: r.match_id ?? null,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function fetchMessages(roomId: string, limit = 50): Promise<ChatMessage[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    // Return in ascending order (oldest first) for display
    return data.reverse().map((m: any) => ({
      id: m.id,
      roomId: m.room_id,
      userId: m.user_id,
      username: m.username || 'Anonymous',
      content: m.content,
      createdAt: m.created_at,
      reactions: (m.reactions && typeof m.reactions === 'object') ? m.reactions : {},
      isPinned: m.is_pinned === true,
    }));
  } catch {
    return [];
  }
}

export async function setPinned(
  messageId: string,
  isPinned: boolean,
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('chat_messages')
      .update({ is_pinned: isPinned })
      .eq('id', messageId);
    return !error;
  } catch {
    return false;
  }
}

export async function fetchPinnedMessage(roomId: string): Promise<import('./types').ChatMessage | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .eq('is_pinned', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      roomId: data.room_id,
      userId: data.user_id,
      username: data.username || 'Anonymous',
      content: data.content,
      createdAt: data.created_at,
      reactions: (data.reactions && typeof data.reactions === 'object') ? data.reactions : {},
      isPinned: true,
    };
  } catch {
    return null;
  }
}

export async function sendMessage(
  roomId: string,
  userId: string,
  username: string,
  content: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('chat_messages').insert({
      room_id: roomId,
      user_id: userId,
      username,
      content,
    });
    return !error;
  } catch {
    return false;
  }
}
