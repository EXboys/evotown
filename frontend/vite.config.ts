import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/agents": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/tasks": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/config": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/dispatcher": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/monitor": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/replay": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/chronicle": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/teams": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/snapshot": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8765", ws: true },
    },
  },
});
