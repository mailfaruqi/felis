import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so assets need that
  // prefix. The deploy workflow sets VITE_BASE; local dev stays at the root.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 3250,
  },
})
