import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    // 本地开发时把 /v1 代理到 API 服务
    proxy: { '/v1': 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022' },
});
