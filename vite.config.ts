import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
  server: {
    headers: {
      // CSP headers applied via HTTP headers (not meta tag) to avoid blocking Vite dev scripts
      // In production, configure these on your hosting platform (Netlify/Cloudflare)
    },
  },
})
