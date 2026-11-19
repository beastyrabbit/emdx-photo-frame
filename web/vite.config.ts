import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The dev and preview servers listen on this machine only.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { host: "127.0.0.1", port: 5183, strictPort: false },
  preview: { host: "127.0.0.1", port: 5184 },
})
