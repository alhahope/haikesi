# 海克斯大乱斗推荐助手

这是一个只读本地部署的网站，支持校园网内网访问。

## 一键本地运行
```bash
cd /path/to/hextech-aram-recommender
npm ci
npm run dev -- --host 0.0.0.0
```

## 手动更新数据
```bash
npm run build:data
npm run build
```

## 自动更新

仓库包含 `.github/workflows/update-data.yml`。GitHub Actions 会在每天北京时间 08:30 自动抓取最新数据：

- 海克斯推荐与强度：aramgg
- 海克斯定义与图标：CommunityDragon
- 海克斯大乱斗出装：OP.GG ARAM: Mayhem
- 英雄与装备说明：Riot Data Dragon

如果生成数据有变化，工作流会提交 `src/data/generated/app-data.json` 到 `main`，并部署到 `gh-pages`。

也可以在 GitHub 的 `Actions -> Update Data and Deploy -> Run workflow` 手动触发。
