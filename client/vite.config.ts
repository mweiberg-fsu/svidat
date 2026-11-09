import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// URL prefix the app is served under, e.g. "/svidat/" for
// https://host/svidat/. Default "/". Always has leading + trailing slash.
const basePath = `/${(process.env.VITE_BASE_PATH || '').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')

// <base>api/* is forwarded to the backend so a build with
// VITE_API_URL=<base>api is same-origin: no CORS, and one port to expose
// from a container or SSH host.
const apiPrefix = `${basePath}api`
const apiProxy = {
  [apiPrefix]: {
    target: process.env.SVIDAT_API_TARGET || `http://127.0.0.1:${process.env.BACKEND_PORT || 8000}`,
    changeOrigin: true,
    rewrite: (path: string) => path.slice(apiPrefix.length),
  },
}

// Vite rejects Host headers other than localhost by default. Set
// VITE_ALLOWED_HOSTS="svidat.example.edu,other.host" (or "all") when the app
// is reached by hostname instead of through an SSH tunnel to localhost.
const allowedHostsEnv = process.env.VITE_ALLOWED_HOSTS
const allowedHosts =
  allowedHostsEnv === 'all' ? true : allowedHostsEnv ? allowedHostsEnv.split(',').map((h) => h.trim()) : undefined

// https://vite.dev/config/
export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: { proxy: apiProxy, allowedHosts },
  preview: { proxy: apiProxy, allowedHosts },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
