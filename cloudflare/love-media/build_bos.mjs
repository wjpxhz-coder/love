import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const cfNodeModules = "C:/Users/Administrator/.codex/runtimes/node-v24.18.0-win-x64/node_modules/cf/node_modules";
const {
  cleanBuildOutputDir,
  writeRootConfig,
  writeWorkerConfig,
  getWorkerBundleDir
} = await import(`file://${cfNodeModules}/@cloudflare/build-output-utils/dist/index.mjs`);
const { bindings } = await import(`file://${cfNodeModules}/@cloudflare/config/dist/public.mjs`);

const root = process.cwd();
await cleanBuildOutputDir(root);
await writeRootConfig(root, { accountId: "7d967f06b498d9d6d247cc3fd0c0ecf7" }, { isPreview: false, mode: undefined });

const workerConfig = {
  name: "love-media",
  compatibilityDate: "2026-10-19",
  entrypoint: "./src/index.mjs",
  domains: ["media.xiaoxi666.kdns.fr"],
  workersDev: true,
  env: {
    PHOTOS_BUCKET: bindings.r2({ name: "love-photos" }),
    SUPABASE_URL: bindings.text("https://tveiegolbotlqpjpwpes.supabase.co"),
    SUPABASE_ANON_KEY: bindings.text("sb_publishable_AhdN1U9vSR1efN_5zDYMLQ_D_fyt3gN"),
    ALLOWED_SPACE_ID: bindings.text("6bf004de-2b52-42cf-a9a3-3b8298a8bef5"),
    ALLOWED_USER_IDS: bindings.text("4580efe4-cffa-49a4-a9ba-2b70db239e5e,323ed5d3-cef6-4743-acc8-fa7f6f2bfa4e"),
    SIGNING_SECRET: bindings.secret(),
    MIGRATION_TOKEN: bindings.secret()
  }
};

const bundleDir = getWorkerBundleDir(root);
fs.mkdirSync(bundleDir, { recursive: true });
fs.copyFileSync(path.join(root, "src/index.mjs"), path.join(bundleDir, "index.mjs"));

await writeWorkerConfig({
  root,
  config: workerConfig,
  manifest: {
    type: "complete",
    mainModule: "index.mjs",
    modules: {
      "index.mjs": { type: "esm" }
    }
  }
});

console.log("Build Output Specification generated successfully!");
