import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
