import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const backendHost = process.env.EVOTOWN_BACKEND_HOST || "127.0.0.1";
const backendPort = process.env.EVOTOWN_BACKEND_PORT || "8765";
const backendTarget = `http://${backendHost}:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
  server: {
    port: 5174,
    proxy: {
      "/agents": { target: backendTarget, changeOrigin: true },
      "/tasks": { target: backendTarget, changeOrigin: true },
      "/config": { target: backendTarget, changeOrigin: true },
      "/dispatcher": { target: backendTarget, changeOrigin: true },
      "/monitor": { target: backendTarget, changeOrigin: true },
      "/replay": { target: backendTarget, changeOrigin: true },
      "/api/v1": { target: backendTarget, changeOrigin: true },
      "/api/gateway": { target: backendTarget, changeOrigin: true },
      "/api/chronicle": {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/teams": { target: backendTarget, changeOrigin: true },
      "/snapshot": { target: backendTarget, changeOrigin: true },
      "/ws": { target: backendTarget, ws: true },
    },
  },
});
