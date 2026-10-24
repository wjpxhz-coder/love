import { defineConfig, bindings } from "cf/config";

export default defineConfig({
  accountId: "7d967f06b498d9d6d247cc3fd0c0ecf7",
  worker: {
    name: "love-media",
    compatibilityDate: "2026-10-19",
    entrypoint: "./src/index.ts",
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
  }
});
