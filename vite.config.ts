import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const api = 'http://127.0.0.1:8080'

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false, minify: 'esbuild' },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/ws': { target: api.replace('http', 'ws'), ws: true } },
  },
})
