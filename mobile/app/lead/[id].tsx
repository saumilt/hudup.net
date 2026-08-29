import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet, apiPost, apiPatch, errText, money } from "@/src/lib/api";
import { colors, spacing, radius, PRIORITY_COLORS } from "@/src/theme";
import { StatusPill, leadName } from "@/src/components/ui";

const DISPOSITIONS = ["Connected", "Left Voicemail", "No Answer", "Interested", "Not Interested", "Meeting Scheduled", "Wrong Number"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [lead, setLead] = useState<any | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [sheet, setSheet] = useState<null | "text" | "call" | "note" | "edit">(null);
  const [text, setText] = useState("");
  const [dispo, setDispo] = useState("Connected");
  const [callNote, setCallNote] = useState("");
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState<any>({});

  const load = useCallback(async () => {
    try {
      const [l, meta] = await Promise.all([
        apiGet(`/crm/leads/${id}`),
        apiGet("/crm/meta").catch(() => ({ statuses: [] })),
      ]);
      setLead(l);
      setStatuses(meta.statuses || []);
    } catch (e) {
      Alert.alert("Error", errText(e));
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!lead) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const phone = lead.phone;
  const email = lead.email;

  const changeStatus = async (status: string) => {
    if (status === lead.status) return;
    setBusy(true);
    try {
      await apiPost(`/crm/leads/${id}/status`, { status });
      await load();
    } catch (e) { Alert.alert("Error", errText(e)); }
    finally { setBusy(false); }
  };

  const call = () => {
    if (!phone) return Alert.alert("No phone", "This lead has no phone number.");
    Linking.openURL(`tel:${phone}`);
  };

  const sendText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await apiPost(`/crm/leads/${id}/text`, { body: text.trim() });
      setSheet(null); setText("");
      await load();
      if (r?.note) Alert.alert("Message logged", r.note);
      else Alert.alert("Sent", "Your message was sent.");
    } catch (e) { Alert.alert("Error", errText(e)); }
    finally { setBusy(false); }
  };

  const logCall = async () => {
    setBusy(true);
    try {
      await apiPost(`/crm/leads/${id}/call`, { disposition: dispo, notes: callNote.trim() || null });
      setSheet(null); setCallNote("");
      await load();
    } catch (e) { Alert.alert("Error", errText(e)); }
    finally { setBusy(false); }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/crm/leads/${id}/notes`, { text: note.trim() });
      setSheet(null); setNote("");
      await load();
    } catch (e) { Alert.alert("Error", errText(e)); }
    finally { setBusy(false); }
  };

  const openEdit = () => {
    setEdit({
      org_name: lead.org_name || "",
      phone: lead.phone || "",
      email: lead.email || "",
      priority: lead.priority || "Medium",
      est_value: lead.est_value != null ? String(lead.est_value) : "",
    });
    setSheet("edit");
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await apiPatch(`/crm/leads/${id}`, {
        org_name: edit.org_name || null,
        phone: edit.phone || null,
        email: edit.email || null,
        priority: edit.priority,
        est_value: edit.est_value === "" ? null : Number(edit.est_value),
      });
      setSheet(null);
      await load();
    } catch (e) { Alert.alert("Error", errText(e)); }
    finally { setBusy(false); }
  };

  const activity = lead.activity || [];

  return (
    <View style={styles.flex}>
      {/* Header */}
      <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="lead-back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>{lead.lead_number}</Text>
        <Pressable testID="lead-edit" onPress={openEdit} hitSlop={10}>
          <Ionicons name="create-outline" size={24} color={colors.brand} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.name}>{leadName(lead)}</Text>
        <View style={styles.metaRow}>
          <StatusPill status={lead.status} />
          {!!lead.priority && (
            <View style={styles.prioChip}>
              <View style={[styles.dot, { backgroundColor: PRIORITY_COLORS[lead.priority] }]} />
              <Text style={styles.prioText}>{lead.priority}</Text>
            </View>
          )}
        </View>

        {/* Quick actions */}
        <View style={styles.actions}>
          <Action testID="action-call" icon="call" label="Call" onPress={call} disabled={!phone} />
          <Action testID="action-text" icon="chatbubble" label="Text" onPress={() => setSheet("text")} disabled={!phone} />
          <Action testID="action-log-call" icon="document-text" label="Log Call" onPress={() => setSheet("call")} />
          <Action testID="action-note" icon="create" label="Note" onPress={() => setSheet("note")} />
        </View>

        {/* Contact card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact</Text>
          <Info label="Email" value={email || "—"} />
          <Info label="Phone" value={phone || "—"} />
          <Info label="Specialty" value={lead.specialty || "—"} />
          <Info label="Location" value={[lead.city, lead.state].filter(Boolean).join(", ") || "—"} />
          <Info label="Source" value={lead.source || "—"} />
          {!!lead.campaign_name && <Info label="Campaign" value={lead.campaign_name} />}
          {lead.est_value != null && <Info label="Est. Value" value={money(lead.est_value)} />}
        </View>

        {/* Status changer */}
        <Text style={styles.sectionTitle}>Update Status</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {statuses.map((s) => {
            const active = s === lead.status;
            return (
              <Pressable
                key={s}
                testID={`status-chip-${s}`}
                disabled={busy}
                onPress={() => changeStatus(s)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Activity */}
        <Text style={styles.sectionTitle}>Activity</Text>
        {activity.length === 0 ? (
          <Text style={styles.emptyText}>No activity yet.</Text>
        ) : (
          activity.slice(0, 30).map((a: any, i: number) => (
            <View key={a.id || i} style={styles.activityRow}>
              <View style={styles.activityDot} />
              <View style={styles.flexShrink}>
                <Text style={styles.activitySummary}>{a.summary}</Text>
                <Text style={styles.activityMeta}>{a.by_name || "System"} · {fmt(a.at)}</Text>
              </View>
            </View>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ===== Bottom-sheet style modals ===== */}
      <ActionSheet visible={sheet === "text"} onClose={() => setSheet(null)} title="Send SMS">
        <TextInput
          testID="text-body-input"
          style={styles.textarea}
          value={text}
          onChangeText={setText}
          placeholder="Type your message…"
          placeholderTextColor={colors.mutedLight}
          multiline
        />
        <PrimaryBtn testID="send-text" label="Send Message" onPress={sendText} busy={busy} />
      </ActionSheet>

      <ActionSheet visible={sheet === "call"} onClose={() => setSheet(null)} title="Log a Call">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {DISPOSITIONS.map((d) => (
            <Pressable key={d} testID={`dispo-${d}`} onPress={() => setDispo(d)} style={[styles.chip, dispo === d && styles.chipActive]}>
              <Text style={[styles.chipText, dispo === d && styles.chipTextActive]}>{d}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextInput
          testID="call-notes-input"
          style={[styles.textarea, { marginTop: spacing.md }]}
          value={callNote}
          onChangeText={setCallNote}
          placeholder="Call notes (optional)…"
          placeholderTextColor={colors.mutedLight}
          multiline
        />
        <PrimaryBtn testID="save-call" label="Save Call" onPress={logCall} busy={busy} />
      </ActionSheet>

      <ActionSheet visible={sheet === "note"} onClose={() => setSheet(null)} title="Add Note">
        <TextInput
          testID="note-input"
          style={styles.textarea}
          value={note}
          onChangeText={setNote}
          placeholder="Write a note…"
          placeholderTextColor={colors.mutedLight}
          multiline
        />
        <PrimaryBtn testID="save-note" label="Save Note" onPress={addNote} busy={busy} />
      </ActionSheet>

      <ActionSheet visible={sheet === "edit"} onClose={() => setSheet(null)} title="Edit Lead">
        <EditField label="Practice / Org" value={edit.org_name} onChange={(v) => setEdit((e: any) => ({ ...e, org_name: v }))} testID="edit-org" />
        <EditField label="Email" value={edit.email} onChange={(v) => setEdit((e: any) => ({ ...e, email: v }))} testID="edit-email" keyboardType="email-address" />
        <EditField label="Phone" value={edit.phone} onChange={(v) => setEdit((e: any) => ({ ...e, phone: v }))} testID="edit-phone" keyboardType="phone-pad" />
        <EditField label="Est. Value ($)" value={edit.est_value} onChange={(v) => setEdit((e: any) => ({ ...e, est_value: v }))} testID="edit-value" keyboardType="number-pad" />
        <Text style={styles.fieldLabel}>Priority</Text>
        <View style={styles.chipRowWrap}>
          {PRIORITIES.map((p) => (
            <Pressable key={p} testID={`edit-priority-${p}`} onPress={() => setEdit((e: any) => ({ ...e, priority: p }))} style={[styles.chip, edit.priority === p && styles.chipActive]}>
              <Text style={[styles.chipText, edit.priority === p && styles.chipTextActive]}>{p}</Text>
            </Pressable>
          ))}
        </View>
        <PrimaryBtn testID="save-edit" label="Save Changes" onPress={saveEdit} busy={busy} />
      </ActionSheet>
    </View>
  );
}

function Action({ icon, label, onPress, disabled, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.action, pressed && !disabled && styles.actionPressed, disabled && styles.actionDisabled]}>
      <Ionicons name={icon} size={22} color={disabled ? colors.mutedLight : colors.brand} />
      <Text style={[styles.actionLabel, disabled && { color: colors.mutedLight }]}>{label}</Text>
    </Pressable>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function ActionSheet({ visible, onClose, title, children }: any) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PrimaryBtn({ label, onPress, busy, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={busy} style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}>
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>{label}</Text>}
    </Pressable>
  );
}

function EditField({ label, value, onChange, testID, keyboardType }: any) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput testID={testID} style={styles.input} value={value} onChangeText={onChange} keyboardType={keyboardType} autoCapitalize="none" placeholderTextColor={colors.mutedLight} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surfaceSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  topbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  topTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  content: { padding: spacing.lg },
  name: { fontSize: 24, fontWeight: "800", color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  prioChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  prioText: { fontSize: 13, fontWeight: "700", color: colors.onSurfaceSecondary },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  action: {
    flex: 1, alignItems: "center", gap: 5, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md,
  },
  actionPressed: { backgroundColor: colors.brandFaint, transform: [{ scale: 0.96 }] },
  actionDisabled: { opacity: 0.5 },
  actionLabel: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary },
  card: {
    marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  cardTitle: { fontSize: 13, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: spacing.sm },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, gap: spacing.md },
  infoLabel: { fontSize: 14, color: colors.muted },
  infoValue: { fontSize: 14, color: colors.onSurface, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", gap: spacing.sm, paddingRight: spacing.lg },
  chipRowWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, paddingVertical: 8, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.white },
  emptyText: { fontSize: 14, color: colors.mutedLight },
  activityRow: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm },
  activityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 6 },
  flexShrink: { flexShrink: 1 },
  activitySummary: { fontSize: 14, color: colors.onSurface, fontWeight: "600" },
  activityMeta: { fontSize: 12, color: colors.mutedLight, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md },
  textarea: { minHeight: 100, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, padding: spacing.md, fontSize: 15, color: colors.onSurface, textAlignVertical: "top" },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15, color: colors.onSurface },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  primaryBtn: { marginTop: spacing.lg, backgroundColor: colors.brand, borderRadius: radius.pill, height: 52, alignItems: "center", justifyContent: "center" },
  primaryBtnPressed: { transform: [{ scale: 0.97 }], backgroundColor: colors.brandSecondary },
  primaryBtnText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
