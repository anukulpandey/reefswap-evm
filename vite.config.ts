import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '::',
    port: 8080,
    proxy: {
      '/api/reef-rpc': {
        target: 'http://localhost:8545',
        changeOrigin: true,
      },
      '/api/gateio': {
        target: 'https://api.gateio.ws',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/gateio/, ''),
      },
    },
  },
});
