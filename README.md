# EHP之姐夫大作战 — Vite 版

由原来的单文件 HTML（CDN + 浏览器内 Babel）改造为标准 Vite + React 项目。

## 本地运行
```bash
npm install
npm run dev      # 开发，默认 http://localhost:5173
npm run build    # 打包到 dist/
npm run preview  # 预览打包结果
```

## 在 StackBlitz (vite.new) 上跑
1. 打开 https://vite.new/react （或直接 https://stackblitz.com/ 新建一个 Vite React 项目）
2. 把本项目里的文件**全部拖进去覆盖**：`index.html`、`package.json`、`vite.config.js`、`src/main.jsx`、`src/App.jsx`、`src/styles.css`
3. StackBlitz 会自动 `npm install` 并启动 dev server，右侧即可预览

## 改了哪些地方
- 删除了 React / ReactDOM / @babel/standalone / @supabase 这 4 个 CDN `<script>`，改用 npm 依赖
- `<style>` → `src/styles.css`
- `<script type="text/babel">` → `src/App.jsx`，顶部加了 `import React` 与 `import { createClient }`
- `window.supabase.createClient(...)` → `createClient(...)`
- `ReactDOM.createRoot(...).render(<App/>)` 移到 `src/main.jsx`
- 业务代码（所有 `React.useState` 等）原样保留，未改动

## 关于密钥（可选）
`src/App.jsx` 里内联了 Supabase URL 和 anon/publishable key。它们本就是**前端公开 key**（靠 RLS 保护），直接放着可正常运行。
若想用环境变量，改成：
```js
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
```
再在根目录建 `.env`（StackBlitz 里用左侧 “Environment variables” 面板）：
```
VITE_SUPABASE_URL=https://nojdevvfjivwepjwvyal.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```
