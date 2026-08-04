import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Ώστε να μπορείς να ανοίξεις το dev build από το κινητό σου στο ίδιο δίκτυο.
    host: true,
    port: 5173,
  },
  build: {
    // Τα source maps δεν φεύγουν στο production bundle· απλά τα ανεβάζουμε
    // ώστε τα stack traces από πραγματικούς χρήστες να είναι διαβάσιμα.
    sourcemap: true,
    target: "es2020",
  },
});
