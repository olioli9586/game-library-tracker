import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/game-library-tracker/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.svg"],
      manifest: {
        name: "Game Vault — Library Tracker",
        short_name: "Game Vault",
        description: "Personal multi-platform game library tracker",
        theme_color: "#5a3a20",
        background_color: "#f5ecd6",
        display: "standalone",
        orientation: "any",
        start_url: "/game-library-tracker/",
        scope: "/game-library-tracker/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "/game-library-tracker/index.html",
      },
    }),
  ],
});
