// Builds the `florin` CLI (src/cli.ts) into .output/cli.mjs, with every
// dependency bundled in, next to the server build.
import { defineConfig } from "vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  publicDir: false,
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: "src/cli.ts",
    outDir: ".output",
    emptyOutDir: false,
    target: "node24",
    rollupOptions: {
      output: { entryFileNames: "cli.mjs", banner: "#!/usr/bin/env node" },
    },
  },
})
