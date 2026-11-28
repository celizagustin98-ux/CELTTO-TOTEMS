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
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Librerías grandes en archivos aparte: se cachean una vez y no se vuelven a bajar al actualizar la app
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/react-dom|react-router|scheduler|[\/]react[\/]/.test(id)) return 'react'
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'motion'
          if (id.includes('i18next')) return 'i18n'
          if (id.includes('qrcode')) return 'qrcode'
          if (id.includes('lucide-react')) return 'icons'
          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/ws': { target: api.replace('http', 'ws'), ws: true } },
  },
})
