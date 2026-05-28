import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves under /<repo-name>/
  base: '/my-timetable/',
  plugins: [react()],
})
