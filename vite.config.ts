import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '::',
    port: 8080,
    proxy: {
      '/api/reef-rpc': {
        target: 'http://localhost:8545',
        changeOrigin: true,
      },
    },
  },
});
