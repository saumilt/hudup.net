// Fetch-based API client for the BoothIQ backend. Reads the Bearer token from
// secure storage on every authenticated request. Backend URL comes from
// EXPO_PUBLIC_BACKEND_URL; all routes are prefixed with /api.
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API = `${BASE}/api`;

export const TOKEN_KEY = "boothiq_token";

export type ApiError = { status: number; detail: any };

async function request<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await storage.secureGet(TOKEN_KEY, null);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw { status: res.status, detail: data?.detail ?? data } as ApiError;
  }
  return data as T;
}

export const apiGet = <T = any>(path: string) => request<T>(path, { method: "GET" });
export const apiPost = <T = any>(path: string, body?: any) => request<T>(path, { method: "POST", body });
export const apiPatch = <T = any>(path: string, body?: any) => request<T>(path, { method: "PATCH", body });

export function errText(e: any): string {
  const d = e?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(" ");
  if (d?.msg) return d.msg;
  return "Something went wrong. Please try again.";
}

export function money(v?: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
  return `$${Number(v).toFixed(0)}`;
}
