import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { User } from '../types.js';
import * as api from '../services/api.js';
import { fetchCurrentUser, logoutSession } from '../services/account.js';
import { subscribeLibraryChanges } from '../shared/libraryEvents.js';

interface AuthContextType {
  currentUser: User | null;
  /** 初始会话恢复是否已完成（/auth/me 已返回或失败）。工作台依赖它避免登录弹窗误开。 */
  authReady: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (payload: api.RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  syncUser: (user: User) => void;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const generationRef = useRef(0);
  const initControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    initControllerRef.current = controller;
    const generation = generationRef.current;
    localStorage.removeItem('slidecraft_user_id');
    localStorage.removeItem('celano_user_id');
    fetchCurrentUser(controller.signal).then(user => { if (!controller.signal.aborted && generationRef.current === generation) setCurrentUser(user); })
      .catch(err => { if (!controller.signal.aborted && generationRef.current === generation) console.warn('恢复登录状态失败', err); })
      .finally(() => { if (!controller.signal.aborted && generationRef.current === generation) setAuthReady(true); });
    return () => controller.abort();
  }, []);
  const syncUser = useCallback((user: User) => { setCurrentUser(prev => prev?.id === user.id ? user : prev); }, []);
  useEffect(() => {
    if (!currentUser) return;
    const controller = new AbortController();
    let latest = 0;
    const generation = generationRef.current;
    const refresh = async () => {
      if (document.hidden) return;
      const request = ++latest;
      try {
        const user = await fetchCurrentUser(controller.signal);
        if (!controller.signal.aborted && request === latest && generation === generationRef.current) {
          setCurrentUser(previous => !user ? null : previous?.id === user.id ? user : previous);
        }
      } catch { /* 网络暂不可用时保留当前会话，恢复后再同步。 */ }
    };
    const stop = subscribeLibraryChanges(() => { void refresh(); });
    const onRefresh = () => { void refresh(); };
    window.addEventListener('focus', onRefresh);
    window.addEventListener('hashchange', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    const timer = window.setInterval(onRefresh, 60_000);
    return () => { controller.abort(); stop(); clearInterval(timer); window.removeEventListener('focus', onRefresh); window.removeEventListener('hashchange', onRefresh); document.removeEventListener('visibilitychange', onRefresh); };
  }, [currentUser?.id]);
  const login = async (identifier: string, password: string) => {
    const generation = ++generationRef.current; initControllerRef.current?.abort();
    const user = await api.loginUser(identifier, password);
    if (generationRef.current !== generation) return;
    setCurrentUser(user);
    setAuthReady(true);
  };
  const register = async (payload: api.RegisterPayload) => {
    const generation = ++generationRef.current; initControllerRef.current?.abort();
    const user = await api.registerUser(payload);
    if (generationRef.current !== generation) return;
    setCurrentUser(user);
    setAuthReady(true);
  };
  const logout = async () => {
    const generation = ++generationRef.current; initControllerRef.current?.abort();
    await logoutSession();
    if (generationRef.current !== generation) return;
    setCurrentUser(null);
    setAuthReady(true);
  };
  return <AuthContext.Provider value={{ currentUser, authReady, login, register, logout, syncUser }}>{children}</AuthContext.Provider>;
};
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内部使用');
  return ctx;
};
