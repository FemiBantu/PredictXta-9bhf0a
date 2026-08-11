import { Tabs, usePathname } from 'expo-router';
import { Platform, View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { useEffect, useState, useRef } from 'react';
import { useAuth, getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocale } from '@/hooks/useLocale';

// Per-room seen map key – must match the constant in app/chat/[id].tsx
const CHAT_ROOM_SEEN_MAP_KEY = '@predictxta/chat_room_seen_map';
// Legacy single-timestamp key (kept for backward-compat read on first launch)
const CHAT_LAST_SEEN_KEY = '@predictxta/chat_last_seen';
// Joined rooms set – only these rooms contribute to the unread badge
const JOINED_ROOMS_KEY = '@predictxta/joined_rooms';

// ─── Notification Badge Icon ─────────────────────────────────────────────────
function ProfileTabIcon({ color, size, count, C }: { color: string; size: number; count: number; C: AppColors }) {
  return (
    <View style={{ width: size + 8, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="person" size={size} color={color} />
      {count > 0 ? (
        <View
          style={{
            position: 'absolute', top: -5, right: -2,
            backgroundColor: C.accentRed,
            borderRadius: 999, minWidth: 16, height: 16,
            alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 3,
            borderWidth: 1.5, borderColor: C.surface,
          }}
        >
          <Text style={{ fontSize: 9, color: '#fff', fontWeight: '800', lineHeight: 13 }}>
            {count > 99 ? '99+' : String(count)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Chat Unread Badge Icon ──────────────────────────────────────────────────
function ChatTabIcon({ color, size, count, C }: { color: string; size: number; count: number; C: AppColors }) {
  return (
    <View style={{ width: size + 8, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="chatbubbles" size={size} color={color} />
      {count > 0 ? (
        <View
          style={{
            position: 'absolute', top: -5, right: -2,
            backgroundColor: C.accentBlue,
            borderRadius: 999, minWidth: 16, height: 16,
            alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 3,
            borderWidth: 1.5, borderColor: C.surface,
          }}
        >
          <Text style={{ fontSize: 9, color: '#fff', fontWeight: '800', lineHeight: 13 }}>
            {count > 99 ? '99+' : String(count)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const pathname = usePathname();
  const { colors: C } = useTheme();
  const { t } = useLocale();
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPathnameRef = useRef<string>(pathname);
  // Tracks when the user entered /notifications to detect long visits
  const notifEntryTimeRef = useRef<number | null>(null);

  // ─── Chat unread state ────────────────────────────────────────────────────
  const [chatUnread, setChatUnread] = useState(0);
  const chatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-room seen map: { [roomId]: isoTimestamp }. null = not yet loaded.
  const roomSeenMapRef = useRef<Record<string, string> | null>(null);

  // Fetch unread notification count from DB
  const fetchUnread = async () => {
    if (!user?.id) return;
    try {
      const supabase = getSupabaseClient();
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);
      setUnreadCount(count ?? 0);
    } catch { /* non-blocking */ }
  };

  useEffect(() => {
    fetchUnread();
    intervalRef.current = setInterval(fetchUnread, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [user?.id]);

  // ─── Chat unread polling ──────────────────────────────────────────────────
  const fetchChatUnread = async () => {
    try {
      // Load the joined-rooms set; if empty, no badge to show
      const rawJoined = await AsyncStorage.getItem(JOINED_ROOMS_KEY);
      const joinedRooms: string[] = rawJoined ? JSON.parse(rawJoined) : [];
      if (joinedRooms.length === 0) { setChatUnread(0); return; }

      // Lazily load the per-room seen map from AsyncStorage
      if (roomSeenMapRef.current === null) {
        const raw = await AsyncStorage.getItem(CHAT_ROOM_SEEN_MAP_KEY);
        if (raw) {
          roomSeenMapRef.current = JSON.parse(raw);
        } else {
          // Migrate from legacy single-key, or default to epoch
          const legacy = await AsyncStorage.getItem(CHAT_LAST_SEEN_KEY);
          roomSeenMapRef.current = legacy ? { __global__: legacy } : {};
        }
      }

      const seenMap = roomSeenMapRef.current ?? {};
      const supabase = getSupabaseClient();

      // Fetch recent messages (last 7 days) only from joined rooms
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const baseQuery = supabase
        .from('chat_messages')
        .select('id, room_id, created_at')
        .gt('created_at', since.toISOString())
        .in('room_id', joinedRooms);

      // Exclude own messages
      const { data: msgs } = user?.id
        ? await baseQuery.neq('user_id', user.id)
        : await baseQuery;

      if (!msgs) return;

      // Fallback global timestamp for rooms never individually visited
      const globalFallback = seenMap['__global__'] ?? new Date(0).toISOString();

      let unread = 0;
      for (const msg of msgs) {
        const roomSeen = seenMap[msg.room_id] ?? globalFallback;
        if (msg.created_at > roomSeen) unread++;
      }
      setChatUnread(unread);
    } catch { /* non-blocking */ }
  };

  useEffect(() => {
    fetchChatUnread();
    chatIntervalRef.current = setInterval(fetchChatUnread, 30_000);
    return () => { if (chatIntervalRef.current) clearInterval(chatIntervalRef.current); };
  }, [user?.id]);

  // Mark all notifications read in DB (silent — UI already zeroed)
  const markAllReadSilent = async () => {
    if (!user?.id) return;
    try {
      const supabase = getSupabaseClient();
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false);
    } catch { /* non-blocking */ }
  };

  // Clear badges when visiting their respective screens
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    if (pathname === '/notifications') {
      setUnreadCount(0);
      // Record entry time to detect long visits
      notifEntryTimeRef.current = Date.now();
    }

    // Re-fetch immediately when leaving notifications so badge reflects
    // any per-row reads the user made without waiting for the 60s poll.
    // If the user spent ≥3 seconds on the screen, treat it as "all seen"
    // and mark everything read in the DB (like messaging app read receipts).
    if (prev === '/notifications' && pathname !== '/notifications') {
      const entryTime = notifEntryTimeRef.current;
      const timeSpent = entryTime !== null ? Date.now() - entryTime : 0;
      notifEntryTimeRef.current = null;

      if (timeSpent >= 3000) {
        // Long visit — mark all read server-side; badge is already 0
        markAllReadSilent();
      } else {
        // Short visit — re-fetch to reflect individual row reads
        fetchUnread();
      }
    }
    // When the user lands on the Chat tab list, mark all rooms globally seen
    // (individual rooms update their own key via app/chat/[id].tsx on open)
    if (pathname === '/(tabs)/chat' || pathname === '/chat') {
      const now = new Date().toISOString();
      // Update in-memory map
      if (roomSeenMapRef.current === null) roomSeenMapRef.current = {};
      roomSeenMapRef.current['__global__'] = now;
      AsyncStorage.getItem(CHAT_ROOM_SEEN_MAP_KEY)
        .then((raw) => {
          const map: Record<string, string> = raw ? JSON.parse(raw) : {};
          map['__global__'] = now;
          return AsyncStorage.setItem(CHAT_ROOM_SEEN_MAP_KEY, JSON.stringify(map));
        })
        .catch(() => {});
      setChatUnread(0);
    }
    // When opening a specific room, its key is written by app/chat/[id].tsx;
    // just refresh in-memory map and clear badge after a short delay
    if (pathname.startsWith('/chat/')) {
      setTimeout(async () => {
        try {
          const raw = await AsyncStorage.getItem(CHAT_ROOM_SEEN_MAP_KEY);
          if (raw) roomSeenMapRef.current = JSON.parse(raw);
        } catch { /* ignore */ }
        // Re-compute unread so badge reflects the newly-seen room
        fetchChatUnread();
      }, 500);
    }
  }, [pathname]);

  const tabBarStyle = {
    height: Platform.select({ ios: insets.bottom + 60, android: insets.bottom + 60, default: 70 }),
    paddingTop: 8,
    paddingBottom: Platform.select({ ios: insets.bottom + 8, android: insets.bottom + 8, default: 8 }),
    paddingHorizontal: 4,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.home'),
          tabBarIcon: ({ color, size }) => <MaterialIcons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: t('nav.live'),
          tabBarIcon: ({ color, size }) => <MaterialIcons name="sports" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="predictions"
        options={{
          title: t('nav.picks'),
          tabBarIcon: ({ color, size }) => <FontAwesome5 name="brain" size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: 'Trends',
          tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? 'flame' : 'flame-outline'} size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('nav.chat'),
          tabBarIcon: ({ color, size }) => (
            <ChatTabIcon color={color} size={size} count={chatUnread} C={C} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarIcon: ({ color, size }) => (
            <ProfileTabIcon color={color} size={size} count={unreadCount} C={C} />
          ),
        }}
      />
    </Tabs>
  );
}
