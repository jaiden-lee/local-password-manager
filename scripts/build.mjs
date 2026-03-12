import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const staticDir = path.join(rootDir, "src", "extension", "static");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await Promise.all([
  esbuild.build({
    entryPoints: {
      background: path.join(rootDir, "src", "extension", "background.ts")
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    outdir: distDir
  }),
  esbuild.build({
    entryPoints: {
      content: path.join(rootDir, "src", "extension", "content.ts"),
      popup: path.join(rootDir, "src", "extension", "popup.ts")
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    outdir: distDir
  })
]);

for (const entry of await readdir(staticDir)) {
  await cp(path.join(staticDir, entry), path.join(distDir, entry), {
    recursive: true
  });
}

