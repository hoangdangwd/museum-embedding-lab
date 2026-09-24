import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
    if (command === "serve") process.env.CLOUDFLARE_ENV = "dev";
    return { plugins: [react(), cloudflare()] };
});
