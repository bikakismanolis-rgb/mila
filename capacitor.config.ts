import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.milamessenger.app",
  appName: "Mila",
  // Το ίδιο build που πάει στο Vercel μπαίνει και μέσα στο native app.
  webDir: "apps/web/dist",

  android: {
    // Το Android WebView μπλοκάρει http:// από default· όλα μας είναι https.
    allowMixedContent: false,
  },

  ios: {
    contentInset: "always",
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#6557e8",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    Keyboard: {
      // Σε chat app θέλουμε το πεδίο γραψίματος να ανεβαίνει πάνω από το
      // πληκτρολόγιο, όχι να το σκεπάζει.
      resize: "native",
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#6557e8",
    },
  },
};

export default config;
