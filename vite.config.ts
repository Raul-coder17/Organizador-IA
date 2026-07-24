import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest: usamos un service worker propio (src/sw.ts) para poder
      // manejar los eventos 'push' y 'notificationclick', además del precache.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt': el SW nuevo se instala y espera; UpdateBanner.tsx es quien
      // decide cuándo avisar y disparar el update (nunca en silencio).
      registerType: 'prompt',
      manifest: false,
      includeAssets: [
        'icon.svg',
        'favicon.ico',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
      ],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
      // Registrar el SW también en `npm run dev`: sin esto, en dev no hay SW
      // activo y `navigator.serviceWorker.ready` cuelga para siempre (dejaba
      // Settings › Notificaciones pegado en "Cargando…").
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
})
