// Auth context for the mobile rep app. Token lives in secure storage; user is
// hydrated from /auth/me on cold start so a stale token self-heals to logout.
import React, { createContext, useContext, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { apiGet, apiPost, TOKEN_KEY } from "@/src/lib/api";
import { registerForPush } from "@/src/lib/push";

export type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  must_change_pin?: boolean;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, pin: string) => Promise<User>;
  changePin: (newPin: string, currentPin?: string) => Promise<void>;
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
          if (!me.must_change_pin) registerForPush(me.id);
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
    if (!data.user.must_change_pin) registerForPush(data.user.id);
    return data.user;
  };

  const changePin = async (newPin: string, currentPin?: string) => {
    await apiPost("/auth/change-pin", { new_pin: newPin, current_pin: currentPin });
    const me = await apiGet<User>("/auth/me");
    setUser(me);
    registerForPush(me.id);
  };

  const logout = async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, changePin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
