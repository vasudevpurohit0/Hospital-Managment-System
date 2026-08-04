/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../../',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Proxy API requests to the NestJS backend during development
    proxy: {
      '/api': {
        // `localhost` works when Vite and Nest run on the host.  In Docker,
        // Vite runs in the web container, where it must address the API by
        // its Compose service name instead.
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  statusCode: 503,
                  message: 'Backend API server is offline or unreachable.',
                }),
              );
            }
          });
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    css: true,
  },
});
