import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../src/shared", import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      injectManifest: {
        rollupFormat: "iife",
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      manifest: {
        name: "Kin",
        short_name: "Kin",
        description: "Your personal agent.",
        display: "standalone",
        start_url: "/",
        scope: "/",
        background_color: "#F7F5F0",
        theme_color: "#F7F5F0",
        orientation: "portrait",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3015", ws: true, changeOrigin: true },
    },
  },
  // One app chunk is fine: the service worker precaches it, and the mock lives in its own chunk.
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 800 },
});
