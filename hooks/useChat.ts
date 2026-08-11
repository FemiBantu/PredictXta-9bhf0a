import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { fetchChatRooms, fetchMessages, sendMessage, fetchOrCreateMatchRoom } from '@/services/chatService';
import { ChatRoom, ChatMessage } from '@/services/types';
import { useAuth } from '@/template';

export function useChat() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    fetchChatRooms().then((data) => {
      setRooms(data);
      setLoadingRooms(false);
    });
  }, []);

  return { rooms, loadingRooms };
}

// Hook for match-specific chat: resolves/creates the room then polls messages every 15s
export function useMatchChat(matchId: string, matchTitle: string) {
  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const { user } = useAuth();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomIdRef = useRef<string | null>(null);

  // Resolve or create the room for this match
  useEffect(() => {
    if (!matchId) return;
    fetchOrCreateMatchRoom(matchId, matchTitle).then((r) => {
      setRoom(r);
      roomIdRef.current = r?.id ?? null;
    });
  }, [matchId, matchTitle]);

  // Load messages whenever room is resolved
  const loadMessages = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid) return;
    const data = await fetchMessages(rid, 20);
    setMessages(data.length > 0 ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!room) return;
    setLoading(true);
    loadMessages();
    pollRef.current = setInterval(loadMessages, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [room, loadMessages]);

  // Re-fetch immediately when app returns from background
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') loadMessages();
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [loadMessages]);

  const send = useCallback(async (content: string): Promise<boolean> => {
    if (!user || !content.trim() || !room) return false;
    setSending(true);
    const username = user.username || user.email.split('@')[0];
    // Optimistic update
    const optimistic: ChatMessage = {
      id: `temp-${Date.now()}`,
      roomId: room.id,
      userId: user.id,
      username,
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    const ok = await sendMessage(room.id, user.id, username, content.trim());
    setSending(false);
    if (ok) loadMessages(); // sync real message from DB
    return ok;
  }, [user, room, loadMessages]);

  return { room, messages, loading, sending, send };
}

export function useChatRoom(roomId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const { user } = useAuth();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMessages = useCallback(async () => {
    const data = await fetchMessages(roomId);
    if (data.length > 0) {
      setMessages(data);
    } else {
      // No messages yet — show empty state, NOT mock data
      setMessages([]);
    }
    setLoading(false);
  }, [roomId]);

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadMessages]);

  // Re-fetch immediately when app returns from background
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') loadMessages();
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [loadMessages]);

  const send = useCallback(async (content: string) => {
    if (!user || !content.trim()) return false;
    setSending(true);
    const username = user.username || user.email.split('@')[0];
    const optimisticMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      roomId,
      userId: user.id,
      username,
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    const ok = await sendMessage(roomId, user.id, username, content.trim());
    setSending(false);
    return ok;
  }, [user, roomId]);

  return { messages, loading, sending, send, reload: loadMessages };
}
