import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the same `dist/` output works whether it's deployed
  // under a subpath (public_html/dev, for review) or promoted straight to
  // the public_html root (production) -- no rebuild or per-environment
  // config needed between the two, just copy the same folder to either
  // location.
  base: './',
})
