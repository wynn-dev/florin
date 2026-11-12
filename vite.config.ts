import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { nitro } from "nitro/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    // The jobs plugin starts the background jobs when the server boots.
    nitro({ preset: "node-server", plugins: ["./src/server/plugins/jobs.ts"] }),
    viteReact(),
  ],
})
