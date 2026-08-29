import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/contexts/auth";
import { colors, spacing, radius } from "@/src/theme";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  lead_manager: "Lead Manager",
  account_manager: "Account Manager",
  staff: "Booth Staff",
};

export default function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const doLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const initials = (user?.name || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}>
      <Text style={styles.title}>Profile</Text>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.rolePill}>
          <Text style={styles.roleText}>{ROLE_LABEL[user?.role || ""] || user?.role}</Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Row icon="pulse" label="App" value="BoothIQ Rep Companion" />
        <View style={styles.divider} />
        <Row icon="server" label="Environment" value="Preview" />
      </View>

      <Pressable
        testID="logout-button"
        style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}
        onPress={doLogout}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surfaceSecondary },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  card: {
    marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.xl, alignItems: "center",
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 26, fontWeight: "800", color: colors.onBrandTertiary },
  name: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: spacing.md },
  email: { fontSize: 14, color: colors.muted, marginTop: 2 },
  rolePill: {
    marginTop: spacing.md, backgroundColor: colors.brandFaint, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 5,
  },
  roleText: { fontSize: 13, fontWeight: "700", color: colors.brand },
  infoCard: {
    marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  rowLabel: { fontSize: 14, color: colors.muted, fontWeight: "600" },
  rowValue: { fontSize: 14, color: colors.onSurface, fontWeight: "700", marginLeft: "auto" },
  divider: { height: 1, backgroundColor: colors.divider },
  logout: {
    marginTop: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, height: 52,
  },
  logoutPressed: { backgroundColor: "#FEF2F2" },
  logoutText: { fontSize: 16, fontWeight: "700", color: colors.error },
});
