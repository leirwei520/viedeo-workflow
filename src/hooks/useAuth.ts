import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { API_URL, AUTH_EXPIRED_EVENT, AUTH_TOKENS_REFRESHED_EVENT, authFetch, tryRefreshToken } from '../config/api';

const AUTH_API = API_URL ? `${API_URL}/auth` : '/api/auth';

interface User {
  id: number;
  username: string;
  nickname: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  token_balance: number;
  created_at: string;
}

interface LoginParams {
  username: string;
  password: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (params: LoginParams) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateTokens: (accessToken: string, refreshToken: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = AuthContext.Provider;

export function useAuthState(): AuthContextValue {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('access_token'));
  const [loading, setLoading] = useState(true);

  const saveTokens = useCallback((accessToken: string, refreshTk: string) => {
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshTk);
    setToken(accessToken);
  }, []);

  const clearTokens = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    sessionStorage.clear();
    setToken(null);
    setUser(null);
  }, []);

  const fetchUser = useCallback(async (_accessToken?: string) => {
    try {
      const res = await authFetch(`${AUTH_API}/me`);
      if (!res.ok) throw new Error('Unauthorized');
      const data = await res.json();
      setUser(data.user);
    } catch {
      clearTokens();
    }
  }, [clearTokens]);

  const login = useCallback(async (params: LoginParams) => {
    const res = await fetch(`${AUTH_API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      let msg = '登录失败';
      try { const d = await res.json(); msg = d.error || msg; } catch { /* non-JSON error body */ }
      throw new Error(msg);
    }
    const data = await res.json();
    saveTokens(data.access_token, data.refresh_token);
    setUser(data.user);
  }, [saveTokens]);

  const logout = useCallback(() => {
    clearTokens();
  }, [clearTokens]);

  const refreshToken = useCallback(async () => {
    const success = await tryRefreshToken();
    if (!success) {
      clearTokens();
    }
    // Token state will be synced via the AUTH_TOKENS_REFRESHED_EVENT listener
  }, [clearTokens]);

  useEffect(() => {
    if (token) {
      fetchUser(token).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onExpired = () => clearTokens();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [clearTokens]);

  // Sync React state when authFetch refreshes tokens in the background
  useEffect(() => {
    const onRefreshed = (e: Event) => {
      const { accessToken, refreshToken: rt } = (e as CustomEvent).detail;
      if (accessToken && rt) {
        saveTokens(accessToken, rt);
      }
    };
    window.addEventListener(AUTH_TOKENS_REFRESHED_EVENT, onRefreshed);
    return () => window.removeEventListener(AUTH_TOKENS_REFRESHED_EVENT, onRefreshed);
  }, [saveTokens]);

  const refreshUser = useCallback(async () => {
    const t = localStorage.getItem('access_token');
    if (t) await fetchUser(t);
  }, [fetchUser]);

  const updateTokens = useCallback((accessToken: string, refreshTk: string) => {
    saveTokens(accessToken, refreshTk);
  }, [saveTokens]);

  return { user, token, loading, login, logout, refreshToken, refreshUser, updateTokens };
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
