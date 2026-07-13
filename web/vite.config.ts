import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:3001",
      "/api": "http://localhost:3001",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
