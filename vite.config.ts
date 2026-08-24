import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy naar Google Translate om CORS in dev te omzeilen.
    // De client roept "/gtranslate/..." aan; hier wordt dat doorgezet naar Google.
    // (In een gepubliceerde app bestaat deze dev-proxy niet -> zie docs/SPEC.md §6.)
    proxy: {
      '/gtranslate': {
        target: 'https://translation.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gtranslate/, ''),
      },
      '/gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gemini/, ''),
      },
      '/gtts': {
        target: 'https://texttospeech.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gtts/, ''),
      },
    },
  },
})
