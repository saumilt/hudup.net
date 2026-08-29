import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/contexts/auth";
import { errText } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/theme";

export default function ChangePin() {
  const { user, changePin } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const forced = !!user?.must_change_pin;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next !== confirm) return Alert.alert("Mismatch", "New PINs do not match.");
    if (!/^\d{4,8}$/.test(next)) return Alert.alert("Invalid", "PIN must be 4-8 digits.");
    setBusy(true);
    try {
      await changePin(next, forced ? undefined : current);
      router.replace("/(tabs)");
    } catch (e) {
      Alert.alert("Error", errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 60 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.logoRow}>
          <Ionicons name="key" size={26} color={colors.brand} />
          <Text style={styles.logo}>BoothIQ</Text>
        </View>
        <Text style={styles.title}>{forced ? "Set your new PIN" : "Change PIN"}</Text>
        <Text style={styles.subtitle}>
          {forced ? "For security, replace your temporary PIN with one only you know." : "Enter your current PIN and choose a new one."}
        </Text>

        <View style={styles.card}>
          {!forced && (
            <>
              <Text style={styles.label}>Current PIN</Text>
              <TextInput testID="current-pin" style={styles.input} value={current} onChangeText={setCurrent} secureTextEntry keyboardType="number-pad" placeholder="••••••" placeholderTextColor={colors.mutedLight} />
            </>
          )}
          <Text style={[styles.label, !forced && { marginTop: spacing.md }]}>New PIN</Text>
          <TextInput testID="new-pin" style={styles.input} value={next} onChangeText={setNext} secureTextEntry keyboardType="number-pad" placeholder="4-8 digits" placeholderTextColor={colors.mutedLight} />
          <Text style={[styles.label, { marginTop: spacing.md }]}>Confirm New PIN</Text>
          <TextInput testID="confirm-pin" style={styles.input} value={confirm} onChangeText={setConfirm} secureTextEntry keyboardType="number-pad" placeholder="••••••" placeholderTextColor={colors.mutedLight} />
          <Pressable testID="change-pin-submit" style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save PIN</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surfaceSecondary },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { fontSize: 24, fontWeight: "800", color: colors.onSurface },
  title: { fontSize: 26, fontWeight: "800", color: colors.onSurface, marginTop: spacing.xl },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: spacing.xs, lineHeight: 22 },
  card: { marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border },
  label: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 16, color: colors.onSurface },
  button: { marginTop: spacing.xl, backgroundColor: colors.brand, borderRadius: radius.pill, height: 54, alignItems: "center", justifyContent: "center" },
  buttonPressed: { transform: [{ scale: 0.97 }], backgroundColor: colors.brandSecondary },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: "700" },
});
