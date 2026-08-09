import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({ plugins: [react()], resolve: { alias: { "@root-config": resolve(__dirname, "../config.json") } }, server: { fs: { allow: [".."] } } });
