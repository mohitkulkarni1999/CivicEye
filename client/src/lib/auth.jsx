import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getToken, setToken, http } from './api.js';

const AuthContext = createContext(null);

export function dashboardPath(user) {
  if (!user) return '/';
  if (user.role === 'admin') return '/admin/dashboard';
  if (user.role === 'officer' || user.role === 'moderator') return '/officer/dashboard';
  return '/citizen/dashboard';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { user: u } = await http.get('/api/auth/me');
      setUser(u);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await http.post('/api/auth/login', { email, password });
    setToken(token);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (payload) => {
    const { token, user: u } = await http.post('/api/auth/register', payload);
    setToken(token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user: u } = await http.get('/api/auth/me');
      setUser(u);
    } catch {
      /* keep current */
    }
  }, []);

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    refreshUser,
    isAuthed: !!user,
    isCitizen: !!user && user.role === 'citizen',
    isOfficer: !!user && (user.role === 'officer' || user.role === 'moderator' || user.role === 'admin'),
    isAdmin: !!user && user.role === 'admin',
    isModerator: !!user && ['moderator', 'admin'].includes(user.role),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
