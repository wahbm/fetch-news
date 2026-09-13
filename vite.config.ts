import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.APP_BASE_PATH || '/';
  return {
    plugins: [react()],
    root: 'client',
    base,
    build: { outDir: '../dist/client', emptyOutDir: true },
    server: {
      proxy: { [`${base.replace(/\/$/, '')}/api`]: `http://127.0.0.1:${env.PORT || 3000}` },
    },
  };
});
