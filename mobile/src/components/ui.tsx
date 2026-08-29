import React from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, STATUS_COLORS } from "@/src/theme";

export function StatusPill({ status }: { status?: string }) {
  const c = STATUS_COLORS[status || "New"] || STATUS_COLORS.New;
  return (
    <View style={[pill.wrap, { backgroundColor: c.bg }]}>
      <Text style={[pill.text, { color: c.fg }]}>{status || "—"}</Text>
    </View>
  );
}

const pill = StyleSheet.create({
  wrap: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  text: { fontSize: 12, fontWeight: "700" },
});

export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={sh.row}>
      <Text style={sh.title}>{title}</Text>
      {count != null && <Text style={sh.count}>{count}</Text>}
    </View>
  );
}

const sh = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm },
  title: { fontSize: 13, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  count: { fontSize: 13, fontWeight: "700", color: colors.mutedLight },
});

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[card.base, style]}>{children}</View>;
}

const card = StyleSheet.create({
  base: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md,
  },
});

export function EmptyState({ icon, title, hint }: { icon: any; title: string; hint?: string }) {
  return (
    <View style={empty.wrap}>
      <Ionicons name={icon} size={40} color={colors.mutedLight} />
      <Text style={empty.title}>{title}</Text>
      {hint && <Text style={empty.hint}>{hint}</Text>}
    </View>
  );
}

const empty = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
  title: { fontSize: 15, fontWeight: "700", color: colors.onSurfaceSecondary },
  hint: { fontSize: 13, color: colors.mutedLight, textAlign: "center", paddingHorizontal: spacing.xl },
});

export function leadName(l: any): string {
  return (
    l?.org_name ||
    `${l?.contact_first || ""} ${l?.contact_last || ""}`.trim() ||
    l?.lead_number ||
    "Unknown"
  );
}
