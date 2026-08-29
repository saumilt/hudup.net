// Auth context for the mobile rep app. Token lives in secure storage; user is
// hydrated from /auth/me on cold start so a stale token self-heals to logout.
import React, { createContext, useContext, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { apiGet, apiPost, TOKEN_KEY } from "@/src/lib/api";

export type User = { id: string; email: string; name: string; role: string };

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({} as AuthState);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet(TOKEN_KEY, null);
      if (token) {
        try {
          const me = await apiGet<User>("/auth/me");
          setUser(me);
        } catch {
          await storage.secureRemove(TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, pin: string) => {
    const data = await apiPost<{ token: string; user: User }>(
      "/auth/login",
      { email: email.trim().toLowerCase(), pin },
    );
    await storage.secureSet(TOKEN_KEY, data.token);
    setUser(data.user);
  };

  const logout = async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
