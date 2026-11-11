import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 1000 },
});
