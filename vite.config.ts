import { defineConfig } from 'vite';

// Project root is the repo root. The game server (task 05) listens on 8080;
// DS_SERVER_PORT points the dev proxy at another one (a second server for testing).
const serverPort = process.env.DS_SERVER_PORT ?? '8080';

export default defineConfig({
  server: {
    host: true, // all interfaces, so phones on the LAN can reach it
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
});
