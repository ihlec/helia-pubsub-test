import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [
    basicSsl() // 🟢 Force HTTPS
  ],
  server: {
    host: true, // 🟢 Allow access from network IP
    port: 5173
  }
})