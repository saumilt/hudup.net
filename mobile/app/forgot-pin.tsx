import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiPost } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/theme";

export default function ForgotPin() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const data = await apiPost("/auth/forgot-pin", { email });
      setMsg(data?.message || "If an account exists for that email, a temporary PIN has been sent.");
    } catch {
      setMsg("If an account exists for that email, a temporary PIN has been sent.");
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
        <Text style={styles.title}>Reset your access</Text>
        <Text style={styles.subtitle}>Enter your email and we'll send a temporary PIN. You'll set a new PIN or password after signing in.</Text>

        <View style={styles.card}>
          {msg ? (
            <View style={{ alignItems: "center" }}>
              <Ionicons name="mail-unread" size={40} color={colors.brand} />
              <Text testID="forgot-result" style={styles.result}>{msg}</Text>
              <Pressable testID="forgot-done" style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={() => router.replace("/login")}>
                <Text style={styles.buttonText}>Back to sign in</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput testID="forgot-email-input" style={styles.input} value={email} onChangeText={setEmail}
                placeholder="you@healthandmore.net" placeholderTextColor={colors.mutedLight}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              <Pressable testID="forgot-submit" style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={submit} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Send temporary PIN</Text>}
              </Pressable>
              <Pressable onPress={() => router.replace("/login")} style={{ marginTop: spacing.md }}>
                <Text style={styles.back}>Back to sign in</Text>
              </Pressable>
            </>
          )}
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
  result: { fontSize: 15, color: colors.onSurfaceSecondary, textAlign: "center", marginTop: spacing.md, lineHeight: 22 },
  button: { marginTop: spacing.xl, backgroundColor: colors.brand, borderRadius: radius.pill, height: 54, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  buttonPressed: { transform: [{ scale: 0.97 }], backgroundColor: colors.brandSecondary },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: "700" },
  back: { color: colors.muted, fontSize: 14, fontWeight: "600", textAlign: "center" },
});
