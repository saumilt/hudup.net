import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/contexts/auth";
import { apiGet } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/theme";
import { SectionHeader, Card, EmptyState, StatusPill, leadName } from "@/src/components/ui";

type MyDay = { tasks: any[]; meetings: any[]; new_leads: any[]; followups: any[] };
type Attention = {
  needs_first_contact: number; overdue_tasks: number; meetings_today: number;
  stale_high_value: number; unassigned: number;
};

const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";

export default function MyDay() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MyDay | null>(null);
  const [att, setAtt] = useState<Attention | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([
        apiGet<MyDay>("/crm/home/my-day"),
        apiGet<Attention>("/crm/home/attention"),
      ]);
      setData(d);
      setAtt(a);
    } catch {
      setData({ tasks: [], meetings: [], new_leads: [], followups: [] });
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const firstName = (user?.name || "there").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const stats = [
    { key: "needs_first_contact", label: "New to contact", value: att?.needs_first_contact ?? 0, icon: "person-add", color: colors.info },
    { key: "overdue_tasks", label: "Overdue tasks", value: att?.overdue_tasks ?? 0, icon: "alert-circle", color: colors.error },
    { key: "meetings_today", label: "Meetings today", value: att?.meetings_today ?? 0, icon: "calendar", color: colors.brand },
    { key: "stale_high_value", label: "Stale high-value", value: att?.stale_high_value ?? 0, icon: "flame", color: colors.warning },
  ];

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const openLead = (id: string) => router.push(`/lead/${id}`);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
    >
      <Text style={styles.greeting}>{greeting},</Text>
      <Text style={styles.name}>{firstName} 👋</Text>

      <View style={styles.statGrid}>
        {stats.map((s) => (
          <View key={s.key} testID={`stat-${s.key}`} style={styles.statCard}>
            <Ionicons name={s.icon as any} size={20} color={s.color} />
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <SectionHeader title="Today's Meetings" count={data.meetings.length} />
      {data.meetings.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No meetings today" />
      ) : (
        data.meetings.map((m) => (
          <Card key={m.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle}>{m.title || m.subject || "Meeting"}</Text>
              <Text style={styles.time}>{fmtTime(m.start_at)}</Text>
            </View>
            {!!m.location && <Text style={styles.itemSub}>{m.location}</Text>}
          </Card>
        ))
      )}

      <SectionHeader title="Tasks Due" count={data.tasks.length} />
      {data.tasks.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" title="You're all caught up" />
      ) : (
        data.tasks.map((t) => (
          <Card key={t.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle}>{t.title}</Text>
              {!!t.priority && <Text style={styles.time}>{t.priority}</Text>}
            </View>
            {!!t.description && <Text style={styles.itemSub}>{t.description}</Text>}
          </Card>
        ))
      )}

      <SectionHeader title="New Leads" count={data.new_leads.length} />
      {data.new_leads.length === 0 ? (
        <EmptyState icon="sparkles-outline" title="No new leads assigned" />
      ) : (
        data.new_leads.map((l) => (
          <Pressable key={l.id} testID={`myday-lead-${l.id}`} onPress={() => openLead(l.id)}>
            <Card>
              <View style={styles.rowBetween}>
                <Text style={styles.itemTitle}>{leadName(l)}</Text>
                <StatusPill status={l.status} />
              </View>
              <Text style={styles.itemSub}>{l.email || l.phone || l.specialty || "—"}</Text>
            </Card>
          </Pressable>
        ))
      )}

      <SectionHeader title="Follow-ups" count={data.followups.length} />
      {data.followups.length === 0 ? (
        <EmptyState icon="time-outline" title="Nothing scheduled" />
      ) : (
        data.followups.map((l) => (
          <Pressable key={l.id} testID={`myday-followup-${l.id}`} onPress={() => openLead(l.id)}>
            <Card>
              <View style={styles.rowBetween}>
                <Text style={styles.itemTitle}>{leadName(l)}</Text>
                <StatusPill status={l.status} />
              </View>
              <Text style={styles.itemSub}>{l.email || l.phone || "—"}</Text>
            </Card>
          </Pressable>
        ))
      )}
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surfaceSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  greeting: { fontSize: 16, color: colors.muted, fontWeight: "600" },
  name: { fontSize: 28, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  statCard: {
    flexGrow: 1, flexBasis: "47%", backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2,
  },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  statLabel: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  itemTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface, flexShrink: 1 },
  itemSub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  time: { fontSize: 13, fontWeight: "700", color: colors.brand },
});
