import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** Serve the repo-root `data/` directory (gitignored pipeline output) at `/data/*`. */
function serveData(): Plugin {
  const root = resolve(import.meta.dirname, "..", "data");
  return {
    name: "triage-serve-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/data/")) return next();
        const rel = decodeURIComponent(url.slice("/data/".length).split("?")[0] ?? "");
        const file = resolve(root, rel);
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [serveData()],
  server: {
    port: 5173,
    // The local triage server (src/server). Override to rehearse offline: TRIAGE_API=http://127.0.0.1:1
    proxy: { "/api": process.env.TRIAGE_API ?? "http://127.0.0.1:8787" },
  },
  build: { outDir: "dist", target: "es2022" },
});
