import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the same `dist/` output works whether it's deployed
  // under a subpath (/dev/, for review) or promoted straight to
  // the site root (production) -- no rebuild or per-environment
  // config needed between the two, just copy the same folder to either
  // location.
  base: './',
  // Only this app's own tests (not anything in a nested checkout, e.g. a
  // local copy of the soupcon fork kept here for reference).
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
