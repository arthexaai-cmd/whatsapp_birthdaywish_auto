import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/ui",
  base: "./", // load as a file:// path from dist-ui in the packaged app
  plugins: [react()],
  build: {
    outDir: "../../dist-ui",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
