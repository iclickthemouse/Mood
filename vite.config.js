import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  // Keep Vite output readable when launched by the Tauri CLI.
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/lmstudio": {
        target: "http://127.0.0.1:1234/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/lmstudio/, ""),
      },
    },
  }
});
