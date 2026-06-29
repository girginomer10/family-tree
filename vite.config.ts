import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // forward /api to the local SQLite backend (npm run server)
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
