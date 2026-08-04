// Ρυθμίσεις που έχουν νόημα μόνο όταν τρέχουμε ως native app (Capacitor).
// Στον browser όλα εδώ είναι no-op — γι' αυτό το bootstrap βγαίνει νωρίς.

import { App } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { Style, StatusBar } from "@capacitor/status-bar";
import { isNative, nativePlatform } from "./platform";

export async function bootstrapNative(): Promise<void> {
  if (!isNative) return;

  try {
    await StatusBar.setStyle({ style: Style.Light });
    if (nativePlatform === "android") {
      await StatusBar.setBackgroundColor({ color: "#6557e8" });
    }
  } catch (error) {
    console.error("StatusBar setup failed:", error);
  }

  // Το Android κλείνει το app στο back button από default. Σε messenger αυτό
  // είναι εκνευριστικό: αν είσαι μέσα σε συνομιλία περιμένεις να γυρίσεις
  // πίσω στη λίστα. Το window.history το χειρίζεται ήδη η εφαρμογή.
  App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });

  // Όταν ανοίγει το πληκτρολόγιο, κύλισε στο τελευταίο μήνυμα.
  Keyboard.addListener("keyboardDidShow", () => {
    window.dispatchEvent(new CustomEvent("mila:keyboard-open"));
  });

  await SplashScreen.hide();
}
