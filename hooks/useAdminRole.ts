/**
 * useAdminRole
 *
 * Checks the `admin_roles` table to determine whether the current user
 * has an admin-level role (main_admin | admin). Experts are excluded —
 * they only have tip-posting access, not the admin panel.
 *
 * Returns:
 *   isAdmin       — true if user has main_admin or admin role and is active
 *   isSuperAdmin  — true only for main_admin (unrestricted super-admin)
 *   isExpert      — true if user has the expert role
 *   role          — exact role string, or null if none
 *   permissions   — full permissions object for the role
 *   loading       — true while the initial DB check is in flight
 *
 * main_admin is treated as super-admin:
 *   - All permissions are always true regardless of DB permissions field
 *   - Cannot be revoked via the UI
 *   - Sees all admin tabs and actions with no restrictions
 */

import { useState, useEffect, useRef } from 'react';
import { getSupabaseClient } from '@/template';

export type AdminRoleType = 'main_admin' | 'admin' | 'expert' | null;

export interface AdminPermissions {
  manage_users: boolean;
  manage_matches: boolean;
  manage_tips: boolean;
  broadcast: boolean;
}

const SUPER_ADMIN_PERMISSIONS: AdminPermissions = {
  manage_users: true,
  manage_matches: true,
  manage_tips: true,
  broadcast: true,
};

interface AdminRoleResult {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isExpert: boolean;
  role: AdminRoleType;
  permissions: AdminPermissions;
  loading: boolean;
}

// ─── Module-level cache ───────────────────────────────────────────────────────
const roleCache = new Map<string, Omit<AdminRoleResult, 'loading'>>();

export function useAdminRole(userId: string | undefined): AdminRoleResult {
  const [state, setState] = useState<AdminRoleResult>({
    isAdmin: false,
    isSuperAdmin: false,
    isExpert: false,
    role: null,
    permissions: { manage_users: false, manage_matches: false, manage_tips: false, broadcast: false },
    loading: true,
  });

  const lastFetchedUser = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setState({
        isAdmin: false, isSuperAdmin: false, isExpert: false,
        role: null, permissions: { manage_users: false, manage_matches: false, manage_tips: false, broadcast: false },
        loading: false,
      });
      return;
    }

    const cached = roleCache.get(userId);
    if (cached) {
      setState({ ...cached, loading: false });
      return;
    }

    let cancelled = false;
    lastFetchedUser.current = userId;
    setState((prev) => ({ ...prev, loading: true }));

    (async () => {
      try {
        const sb = getSupabaseClient();
        const { data, error } = await sb
          .from('admin_roles')
          .select('role, is_active, permissions')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();

        if (cancelled) return;

        const roleStr = (!error && data?.role) ? (data.role as AdminRoleType) : null;
        const isSuperAdmin = roleStr === 'main_admin';
        const isAdmin = roleStr === 'main_admin' || roleStr === 'admin';
        const isExpert = roleStr === 'expert';

        // main_admin always gets full permissions regardless of DB field
        const permissions: AdminPermissions = isSuperAdmin
          ? SUPER_ADMIN_PERMISSIONS
          : {
              manage_users: data?.permissions?.manage_users ?? false,
              manage_matches: data?.permissions?.manage_matches ?? true,
              manage_tips: data?.permissions?.manage_tips ?? true,
              broadcast: data?.permissions?.broadcast ?? false,
            };

        const result = { isAdmin, isSuperAdmin, isExpert, role: roleStr, permissions };
        roleCache.set(userId, result);
        setState({ ...result, loading: false });
      } catch {
        if (!cancelled) {
          setState({
            isAdmin: false, isSuperAdmin: false, isExpert: false,
            role: null, permissions: { manage_users: false, manage_matches: false, manage_tips: false, broadcast: false },
            loading: false,
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  return state;
}

export function clearAdminRoleCache(userId?: string) {
  if (userId) roleCache.delete(userId);
  else roleCache.clear();
}
