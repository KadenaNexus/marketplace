import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env so VITE_PROFILE_API (and any other VITE_*) is visible to the proxy config below.
  // Vite only injects VITE_* into import.meta.env in client code; for vite.config.ts (Node) you must call loadEnv.
  const env = loadEnv(mode, process.cwd(), "");
  return {
  server: {
    host: "::",
    port: 8081,
    allowedHosts: ["marketplace.kadena.ws", "localhost", "127.0.0.1"],
    proxy: (() => {
      // Use 127.0.0.1 to avoid IPv6/localhost EACCES on Windows when dev:server isn't running.
      // "ws proxy error: ECONNREFUSED 127.0.0.1:3001" is normal when the profile API isn't running — run "npm run dev:server" in another terminal.
      const profileTarget = env.VITE_PROFILE_API || process.env.VITE_PROFILE_API || "http://127.0.0.1:3001";
      const proxyError = (err: NodeJS.ErrnoException & { message?: string }, _req: unknown, _res: unknown) => {
        const code = err.code ?? (err as { cause?: { code?: string } }).cause?.code;
        const msg = err.message ?? "";
        if (
          code === "ECONNRESET" ||
          code === "ECONNREFUSED" ||
          code === "EACCES" ||
          msg.includes("ECONNREFUSED") ||
          msg.includes("ECONNRESET") ||
          msg.includes("EACCES")
        )
          return;
        console.error("[vite] proxy error:", err.message);
      };
      return {
        "/api": {
          target: profileTarget,
          changeOrigin: true,
          configure: (proxy: { on: (ev: string, fn: (...a: unknown[]) => void) => void }) => {
            proxy.on("error", proxyError);
          },
        },
        "/socket.io": {
          target: profileTarget,
          changeOrigin: true,
          ws: true,
          configure: (proxy: { on: (ev: string, fn: (...a: unknown[]) => void) => void }) => {
            proxy.on("error", proxyError);
          },
        },
        "/uploads": {
          target: profileTarget,
          changeOrigin: true,
          configure: (proxy: { on: (ev: string, fn: (...a: unknown[]) => void) => void }) => {
            proxy.on("error", proxyError);
          },
        },
      };
    })(),
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
