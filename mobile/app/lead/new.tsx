import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiPost, errText } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/theme";

const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

export default function NewLead() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<any>({
    contact_first: "", contact_last: "", org_name: "", email: "", phone: "",
    specialty: "", city: "", state: "", priority: "Medium",
  });
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.contact_first && !form.contact_last && !form.org_name) {
      return Alert.alert("Required", "Enter a contact name or practice.");
    }
    setBusy(true);
    try {
      const lead = await apiPost("/crm/leads", {
        ...form,
        state: form.state ? form.state.toUpperCase() : null,
        source: "Manual Entry",
      });
      router.back();
      router.push(`/lead/${lead.id}`);
    } catch (e) {
      Alert.alert("Error", errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="new-lead-cancel" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>New Lead</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Row>
          <Field label="First Name" value={form.contact_first} onChange={set("contact_first")} testID="new-first" flex />
          <Field label="Last Name" value={form.contact_last} onChange={set("contact_last")} testID="new-last" flex />
        </Row>
        <Field label="Practice / Organization" value={form.org_name} onChange={set("org_name")} testID="new-org" />
        <Field label="Email" value={form.email} onChange={set("email")} testID="new-email" keyboardType="email-address" />
        <Field label="Phone" value={form.phone} onChange={set("phone")} testID="new-phone" keyboardType="phone-pad" />
        <Field label="Specialty" value={form.specialty} onChange={set("specialty")} testID="new-specialty" />
        <Row>
          <Field label="City" value={form.city} onChange={set("city")} testID="new-city" flex />
          <Field label="State" value={form.state} onChange={set("state")} testID="new-state" flex />
        </Row>

        <Text style={styles.fieldLabel}>Priority</Text>
        <View style={styles.chipRow}>
          {PRIORITIES.map((p) => (
            <Pressable key={p} testID={`new-priority-${p}`} onPress={() => set("priority")(p)} style={[styles.chip, form.priority === p && styles.chipActive]}>
              <Text style={[styles.chipText, form.priority === p && styles.chipTextActive]}>{p}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable testID="create-lead-submit" onPress={submit} disabled={busy} style={({ pressed }) => [styles.submit, pressed && styles.submitPressed]}>
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.submitText}>Create Lead</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Field({ label, value, onChange, testID, keyboardType, flex }: any) {
  return (
    <View style={[{ marginBottom: spacing.md }, flex && { flex: 1 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput testID={testID} style={styles.input} value={value} onChangeText={onChange} keyboardType={keyboardType} autoCapitalize={keyboardType === "email-address" ? "none" : "words"} placeholderTextColor={colors.mutedLight} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surfaceSecondary },
  topbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  topTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", gap: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surface },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.lg, paddingVertical: 10, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 14, fontWeight: "700", color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.white },
  submit: { marginTop: spacing.md, backgroundColor: colors.brand, borderRadius: radius.pill, height: 54, alignItems: "center", justifyContent: "center" },
  submitPressed: { transform: [{ scale: 0.97 }], backgroundColor: colors.brandSecondary },
  submitText: { color: colors.white, fontSize: 17, fontWeight: "700" },
});
