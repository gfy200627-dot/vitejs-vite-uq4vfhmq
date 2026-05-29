import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// ============================================================
// 注册 PWA Service Worker
// 仅在生产构建注册（开发时 SW 缓存会干扰 Vite 热更新）。
// 发版更新流程：新 SW install→skipWaiting→activate→claim 触发 controllerchange，
// 这里 reload 一次让页面用上最新资源；首次安装（之前没有 controller）不刷新。
// ============================================================
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let hadController = !!navigator.serviceWorker.controller; // 首次访问为 false
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; } // 首次安装不刷新
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register('/sw.js')
      .catch((e) => console.warn('[SW] 注册失败:', e));
  });
}

