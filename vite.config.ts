import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Iconen + head-links komen uit pwa-assets.config.ts (public/logo.svg -> alle formaten).
      pwaAssets: { config: true },
      manifest: {
        name: 'Spaans leren per zin',
        short_name: 'Spaans leren',
        description: 'Lees Spaans per zin — met vertaling, uitleg en oefeningen.',
        lang: 'nl',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        theme_color: '#2f6f4f',
        background_color: '#f7f6f2',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // SPA-fallback voor navigaties; /api mag nooit door de SW-fallback (dat is de backend).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // Material Icons (CSS + fontbestanden) offline-vriendelijk cachen.
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' ||
              url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // Geen service worker in dev: desktop-dev-gedrag blijft exact zoals nu; SW alleen in de build.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // De client praat uitsluitend met de eigen backend via /api/*. In dev draait die lokaal
    // op :3001 (npm run dev start Vite + backend samen). De keys zitten server-side; er wordt
    // niet meer rechtstreeks vanuit de browser naar Google gebeld. Zie docs/DEPLOY.md.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
