# GitHub 部署流程

本文档整理了本地开发完毕后，向 GitHub 推送代码并自动部署的规范化流程。请严格遵守以下步骤：

## 1. 本地校验
在本地完成代码修改后，先验证：
> **提示**：如果是纯静态页面（如本项目没有 `package.json`），可跳过此步，但仍需手动确认页面语法无错。

## 2. 敏感信息检查
仔细检查改动范围，确认没有误提交 `.env`、密钥等文件。

## 3. 分支隔离
禁止直接向 `main` 分支推送。必须从最新的 `main` 创建功能分支，例如：
```bash
codex/warm-ink-ui
```

## 4. 暂存并提交本地改动
```bash
git add -A
git commit -m "feat: 你的修改描述"
```

## 5. 推送分支到 GitHub
```bash
git push -u origin <your-branch-name>
```
例如：
```bash
git push -u origin codex/warm-ink-ui
```

## 6. 创建合并请求 (PR)
在 GitHub 上创建一个指向主分支 `main` 的 PR。
> **注意**：仅推送分支或创建草稿（Draft）PR 不会更新网页。

## 7. 合并到 main 分支
确认 PR 可合并后，合并进 `main`。

## 8. GitHub Actions 自动部署
GitHub Actions 监听到 `main` 更新，自动执行：
安装依赖 → 类型检查 → 测试 → 构建 → 上传 Pages 产物 → 发布 GitHub Pages

## 9. 验证部署
等待部署工作流显示成功后，访问：
👉 [https://wjpxhz-coder.github.io/love/](https://wjpxhz-coder.github.io/love/)

## 10. 清除缓存
若仍看到旧页面，浏览器使用 `Ctrl + F5` 强制刷新，避开缓存。

---

> [!IMPORTANT]
> **核心规则**：GitHub Pages 当前只会在 `main` 分支更新后自动部署。
