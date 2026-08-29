import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/contexts/auth";
import { errText } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/theme";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !pin.trim()) {
      setError("Enter your email and PIN.");
      return;
    }
    setBusy(true);
    try {
      const u = await login(email, pin);
      router.replace(u.must_change_pin ? "/change-pin" : "/(tabs)");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 60 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoRow}>
          <Ionicons name="pulse" size={30} color={colors.brand} />
          <Text style={styles.logo}>BoothIQ</Text>
        </View>
        <Text style={styles.title}>Rep Companion</Text>
        <Text style={styles.subtitle}>Work your leads, calls, and My Day from anywhere.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="login-email-input"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@boothiq.com"
            placeholderTextColor={colors.mutedLight}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />
          <Text style={[styles.label, { marginTop: spacing.md }]}>PIN or Password</Text>
          <TextInput
            testID="login-password-input"
            style={styles.input}
            value={pin}
            onChangeText={setPin}
            placeholder="Enter your PIN or password"
            placeholderTextColor={colors.mutedLight}
            secureTextEntry
            autoCapitalize="none"
          />
          <Pressable testID="forgot-pin-link" onPress={() => router.push("/forgot-pin")} style={{ marginTop: spacing.sm }}>
            <Text style={styles.forgot}>Forgot PIN or password?</Text>
          </Pressable>
          {error && <Text testID="login-error" style={styles.error}>{error}</Text>}
          <Pressable
            testID="login-submit-button"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surfaceSecondary },
  container: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { fontSize: 24, fontWeight: "800", color: colors.onSurface },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, marginTop: spacing.xl },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: spacing.xs, lineHeight: 22 },
  card: {
    marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  label: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 16, color: colors.onSurface,
    backgroundColor: colors.surface,
  },
  error: { color: colors.error, fontSize: 14, fontWeight: "600", marginTop: spacing.md },
  forgot: { color: colors.brand, fontSize: 14, fontWeight: "700", textAlign: "center" },
  button: {
    marginTop: spacing.xl, backgroundColor: colors.brand, borderRadius: radius.pill,
    height: 54, alignItems: "center", justifyContent: "center",
  },
  buttonPressed: { transform: [{ scale: 0.97 }], backgroundColor: colors.brandSecondary },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: "700" },
});
