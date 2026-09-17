import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Genereert alle PWA-iconen (incl. maskable + apple-touch-icon) uit één bron: public/logo.svg.
// Draaien met: npx pwa-assets-generator
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: minimal2023Preset,
  images: ['public/logo.svg'],
})
