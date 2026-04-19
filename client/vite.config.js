import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const LOCAL_IP = '192.168.20.56'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: `http://${LOCAL_IP}:5000`,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'build'
  }
})
