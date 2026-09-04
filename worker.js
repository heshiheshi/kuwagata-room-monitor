/**
 * Cloudflare Workers Entrypoint (Unified Workers + Static Assets)
 * 
 * 静的ファイル (index.html, app.js, style.css) は [assets] により自動配信され、
 * /api/switchbot へのリクエストを本スクリプトが受け取って処理・中継します。
 */

import { onRequestGet, onRequestPost, onRequestOptions } from './functions/api/switchbot.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // SwitchBot API プロキシルートの中継
    if (url.pathname === "/api/switchbot" || url.pathname.startsWith("/api/switchbot")) {
      const context = {
        request,
        env,
        params: {},
        waitUntil: ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : () => {}
      };

      if (request.method === "GET") {
        return onRequestGet(context);
      } else if (request.method === "POST") {
        return onRequestPost(context);
      } else if (request.method === "OPTIONS") {
        return onRequestOptions();
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // 静的アセットにヒットしなかった場合は 404
    return new Response("Not Found", { status: 404 });
  }
};
