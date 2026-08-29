// Push registration for the mobile rep app (Emergent managed relay).
// Native only — no-ops on web. Registers the device's native FCM/APNs token
// with the backend, which relays to the Emergent push service.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

export async function registerForPush(userId: string): Promise<void> {
  if (Platform.OS === "web" || !userId) return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await fetch(`${BACKEND}/api/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        platform: Platform.OS,
        device_token: tokenResp.data,
      }),
    });
  } catch {
    // Non-blocking — push is best-effort and must never break the app.
  }
}
