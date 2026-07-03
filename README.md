# 海克斯大乱斗推荐助手

这是一个只读本地部署的网站，支持校园网内网访问。

## 一键本地运行
```bash
cd /path/to/hextech-aram-recommender
npm ci
npm run dev -- --host 0.0.0.0
```

## 打包
```bash
npm run build
```

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库（或使用现有仓库）。
2. 先推送源码（不要上传 `node_modules`、`dist`、`.cache`）。
3. 仓库 `Settings -> Pages` 里把 `Source` 设为 `GitHub Actions`。
4. 推送 `main` 分支后，Actions 会自动构建并部署。

说明：仓库为 project pages 时，页面会自动使用仓库名作为 base path。

## 手工上传步骤
```bash
cd /path/to/hextech-aram-recommender

git init

git add .
git commit -m "feat: init hextech aram recommender"

git branch -M main
# 把 <REPO_URL> 替换为你的仓库地址
# 例如: https://github.com/yourname/hextech-aram-recommender.git
# 或者: git@github.com:yourname/hextech-aram-recommender.git
git remote add origin <REPO_URL>
git push -u origin main
```

## 已包含的部署文件
- `.github/workflows/github-pages.yml`
- `vite.config.ts`（支持 `VITE_BASE_PATH`）
