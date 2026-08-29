import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/api";
import { colors, spacing, radius, PRIORITY_COLORS } from "@/src/theme";
import { StatusPill, EmptyState, leadName } from "@/src/components/ui";

export default function Leads() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [leads, setLeads] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (search: string) => {
    try {
      const path = search.trim() ? `/crm/leads?q=${encodeURIComponent(search.trim())}` : "/crm/leads";
      const data = await apiGet<any[]>(path);
      setLeads(data);
    } catch {
      setLeads([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(q); }, [load, q]));

  React.useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(q);
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: any }) => (
    <Pressable
      testID={`lead-row-${item.id}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/lead/${item.id}`)}
    >
      <View style={styles.cardTop}>
        <Text style={styles.leadName} numberOfLines={1}>{leadName(item)}</Text>
        <StatusPill status={item.status} />
      </View>
      <Text style={styles.leadSub} numberOfLines={1}>
        {item.lead_number}
        {item.email ? `  ·  ${item.email}` : item.phone ? `  ·  ${item.phone}` : ""}
      </Text>
      <View style={styles.cardBottom}>
        {!!item.priority && (
          <View style={styles.metaChip}>
            <View style={[styles.dot, { backgroundColor: PRIORITY_COLORS[item.priority] || colors.muted }]} />
            <Text style={styles.metaText}>{item.priority}</Text>
          </View>
        )}
        {!!item.source && <Text style={styles.source}>{item.source}</Text>}
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.flex, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Leads</Text>
      </View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.mutedLight} />
        <TextInput
          testID="leads-search"
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search name, practice, email, NPI…"
          placeholderTextColor={colors.mutedLight}
          autoCapitalize="none"
        />
        {q.length > 0 && (
          <Pressable onPress={() => setQ("")} testID="leads-search-clear">
            <Ionicons name="close-circle" size={18} color={colors.mutedLight} />
          </Pressable>
        )}
      </View>

      {leads === null ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
      ) : (
        <FlatList
          data={leads}
          keyExtractor={(l) => l.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListEmptyComponent={
            <EmptyState icon="people-outline" title="No leads found" hint={q ? "Try a different search." : "New captured and assigned leads will show here."} />
          }
        />
      )}

      <Pressable
        testID="new-lead-fab"
        style={({ pressed }) => [styles.fab, { bottom: insets.bottom + 100 }, pressed && styles.fabPressed]}
        onPress={() => router.push("/lead/new")}
      >
        <Ionicons name="add" size={30} color={colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surfaceSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: spacing.lg },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg,
    marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, height: 46,
  },
  search: { flex: 1, fontSize: 15, color: colors.onSurface },
  list: { padding: spacing.lg, paddingBottom: 140 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md,
  },
  cardPressed: { backgroundColor: colors.slate50, transform: [{ scale: 0.99 }] },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  leadName: { fontSize: 16, fontWeight: "700", color: colors.onSurface, flexShrink: 1 },
  leadSub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metaText: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary },
  source: { fontSize: 12, color: colors.mutedLight, fontWeight: "600" },
  fab: {
    position: "absolute", right: spacing.xl, width: 58, height: 58, borderRadius: 29,
    backgroundColor: colors.brand, alignItems: "center", justifyContent: "center",
    shadowColor: colors.brand, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabPressed: { transform: [{ scale: 0.94 }], backgroundColor: colors.brandSecondary },
});
