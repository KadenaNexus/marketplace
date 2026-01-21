import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      // Bypass CORS: browser calls same-origin /chainweb-proxy, Vite forwards to Chainweb.
      // Chaddex returns 500 on /send. Default: us-e1 (Kadena). If ENOTFOUND or 404, add to .env:
      // VITE_CHAINWEB_PROXY_TARGET=https://chainweb.chaddex.com
      "/chainweb-proxy": {
        target: process.env.VITE_CHAINWEB_PROXY_TARGET || "https://chainweb.chaddex.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/chainweb-proxy/, "/chainweb/0.0/mainnet01/chain/1/pact"),
      },
      // Profile API: run "npm run dev:server" and proxy /api to it
      "/api": {
        target: process.env.VITE_PROFILE_API || "http://localhost:3001",
        changeOrigin: true,
      },
      // Uploaded profile images
      "/uploads": {
        target: process.env.VITE_PROFILE_API || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
