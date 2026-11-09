import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs separately (on :8765 unless DIVINE_PULSE_API names another address); in production
// FastAPI serves dist/. The backend only accepts requests whose Origin is its own address, so the proxy sends that.
const api = process.env.DIVINE_PULSE_API ?? "http://127.0.0.1:8765";
const backend: ProxyOptions = {
  target: api,
  changeOrigin: true,
  configure: (proxy) => proxy.on("proxyReq", (req) => {
    if (req.getHeader("origin")) req.setHeader("origin", api);
  }),
};

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": backend, "/game-assets": backend },
  },
});
