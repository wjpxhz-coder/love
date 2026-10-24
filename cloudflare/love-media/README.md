# Cloudflare R2 媒体网关 Worker (`love-media`)

本 Worker 为《小蛇和小奚的故事》提供基于 Cloudflare R2 的对象存储代理，替代原 Supabase Storage 的私有媒体托管方案，具备**零出口流量费**、**全球边缘极速缓存**与**无缝鉴权适配**三大特性。

---

## 架构特性

1. **Supabase 兼容契约**：
   - 适配前端 `@supabase/storage-js` 契约，支持 `upload`、`createSignedUrl`、`createSignedUrls`、`remove`、`getPublicUrl`。
   - 透明接管 `photos` 存储桶的所有操作。
2. **边缘安全鉴权**：
   - 上传与批量签名请求直连 Supabase Auth 验证 JWT 令牌及用户 ID/空间空间归属（`ALLOWED_SPACE_ID` / `ALLOWED_USER_IDS`）。
   - 私有签名采用 HMAC-SHA256 签名，避免暴露持久访问密钥。
3. **分段与流媒体优化**：
   - 原生支持 HTTP `Range` 头（206 Partial Content），视频/音频流式播放丝滑秒开。
   - 支持浏览器端 CORS 头，自动适配 Cache-Control 与 Service Worker 本地离线缓存。

---

## 环境变量与绑定 (Bindings)

- **R2 Bucket**：`PHOTOS_BUCKET` -> `love-photos`
- **环境变量**：
  - `SUPABASE_URL`：Supabase 项目端点
  - `SUPABASE_ANON_KEY`：Supabase 匿名公共 API Key
  - `ALLOWED_SPACE_ID`：准入的专属恋爱空间 ID
  - `ALLOWED_USER_IDS`：准入的用户 UUID 列表（英文逗号分隔）
- **加密密钥 (Secrets)**：
  - `SIGNING_SECRET`：HMAC-SHA256 媒体访问签名密钥
  - `MIGRATION_TOKEN`：数据迁移与管理专用 Token

---

## 部署说明

通过 Cloudflare CLI 部署：

```bash
cd cloudflare/love-media
node build_bos.mjs
npx cf deploy --secrets-file .secrets.env
```
