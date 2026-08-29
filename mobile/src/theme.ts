// Shared brand tokens for the BoothIQ mobile rep app (mirrors design_guidelines.json).
export const colors = {
  surface: "#FFFFFF",
  onSurface: "#0F172A",
  surfaceSecondary: "#F8FAFC",
  onSurfaceSecondary: "#334155",
  surfaceTertiary: "#E2E8F0",
  muted: "#64748B",
  mutedLight: "#94A3B8",
  brand: "#047857",
  brandSecondary: "#059669",
  brandTertiary: "#D1FAE5",
  onBrandTertiary: "#065F46",
  brandFaint: "#ECFDF5",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#3B82F6",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  divider: "#F1F5F9",
  white: "#FFFFFF",
  slate50: "#F8FAFC",
  slate100: "#F1F5F9",
  slate200: "#E2E8F0",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  New: { bg: "#F1F5F9", fg: "#475569" },
  "Attempting Contact": { bg: "#E0F2FE", fg: "#0369A1" },
  Contacted: { bg: "#DBEAFE", fg: "#1D4ED8" },
  Qualified: { bg: "#E0E7FF", fg: "#4338CA" },
  "Meeting Scheduled": { bg: "#EDE9FE", fg: "#6D28D9" },
  Opportunity: { bg: "#D1FAE5", fg: "#065F46" },
  Nurture: { bg: "#FEF3C7", fg: "#B45309" },
  Won: { bg: "#16A34A", fg: "#FFFFFF" },
  Lost: { bg: "#FEE2E2", fg: "#B91C1C" },
  Disqualified: { bg: "#FEE2E2", fg: "#B91C1C" },
};

export const PRIORITY_COLORS: Record<string, string> = {
  Urgent: "#DC2626",
  High: "#D97706",
  Medium: "#64748B",
  Low: "#94A3B8",
};
