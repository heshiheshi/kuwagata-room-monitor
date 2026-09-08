/**
 * Kuwagata Room Monitor - Cloudflare Workers Entrypoint v3.2.0
 * 
 * 機能:
 * 1. SwitchBot Open API プロキシ (/api/switchbot)
 * 2. クラウド設定共有 API (/api/sync/config) - カード並び順・色・外気温設定をKVで全端末同期
 * 3. 温度履歴クラウド蓄積 API (/api/sync/history) - 24時間データ共有・CSV出力対応
 * 4. 無人定期実行 Cron Triggers (scheduled) - 10分おきに自動で温度計データを記録
 */

import { onRequestGet, onRequestPost, onRequestOptions, callSwitchBotApi, jsonResponse } from './functions/api/switchbot.js';

export default {
  /**
   * HTTPリクエストハンドラー
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // OPTIONS プリフライト共通処理
    if (request.method === "OPTIONS") {
      return onRequestOptions();
    }

    // 1. SwitchBot API プロキシルート
    if (pathname === "/api/switchbot" || pathname.startsWith("/api/switchbot")) {
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
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // 2. クラウド設定共有 API (/api/sync/config)
    if (pathname === "/api/sync/config") {
      if (!env.KUWAGATA_KV) {
        return jsonResponse({ success: false, error: "KUWAGATA_KV がバインドされていません" }, 500);
      }

      if (request.method === "GET") {
        try {
          const sharedRaw = await env.KUWAGATA_KV.get("config:shared");
          const sharedConfig = sharedRaw ? JSON.parse(sharedRaw) : null;
          return jsonResponse({ success: true, config: sharedConfig });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      } else if (request.method === "POST") {
        try {
          const body = await request.json();
          const { config, credentials, devices } = body;

          // 共有設定（並び順・色・外気設定・目盛り等）の保存
          if (config) {
            config.updatedAt = Date.now();
            await env.KUWAGATA_KV.put("config:shared", JSON.stringify(config));
          }

          // Cronバックグラウンド記録用（APIキーおよびデバイス情報）の保持
          if (credentials && credentials.token && credentials.secret) {
            const botConfig = {
              token: credentials.token,
              secret: credentials.secret,
              devices: devices || [],
              updatedAt: Date.now()
            };
            await env.KUWAGATA_KV.put("config:switchbot", JSON.stringify(botConfig));
          }

          return jsonResponse({ success: true, message: "設定をクラウドに保存しました" });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // 3. 温度履歴クラウド蓄積 API (/api/sync/history)
    if (pathname === "/api/sync/history") {
      if (!env.KUWAGATA_KV) {
        return jsonResponse({ success: false, error: "KUWAGATA_KV がバインドされていません" }, 500);
      }

      if (request.method === "GET") {
        try {
          const historyRaw = await env.KUWAGATA_KV.get("history:temp_log");
          const history = historyRaw ? JSON.parse(historyRaw) : [];
          return jsonResponse({ success: true, history: history });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      } else if (request.method === "POST") {
        try {
          const body = await request.json();
          const newEntry = body.entry;
          if (!newEntry || !newEntry.readings) {
            return jsonResponse({ success: false, error: "不正なデータ形式です" }, 400);
          }

          const historyRaw = await env.KUWAGATA_KV.get("history:temp_log");
          let history = historyRaw ? JSON.parse(historyRaw) : [];

          // 重複記録の防止（最新のエントリと時刻が近すぎる場合は上書き/スキップ）
          const lastEntry = history[history.length - 1];
          if (!lastEntry || (newEntry.time - lastEntry.time) >= 180000) { // 3分以上間隔
            history.push(newEntry);
            if (history.length > 1008) { // 直近7日分（10分おき = 1日144件 x 7日 = 1008件）
              history = history.slice(-1008);
            }
            await env.KUWAGATA_KV.put("history:temp_log", JSON.stringify(history));
          }

          return jsonResponse({ success: true, count: history.length });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // 静的アセットにヒットしなかった場合は 404
    return new Response("Not Found", { status: 404 });
  },

  /**
   * ⏱️ 定期実行（Cron Triggers）ハンドラー (10分おき)
   */
  async scheduled(event, env, ctx) {
    if (!env.KUWAGATA_KV) return;

    try {
      // 1. 保存されているSwitchBot認証情報 & デバイス一覧を取得
      const botConfigRaw = await env.KUWAGATA_KV.get("config:switchbot");
      if (!botConfigRaw) return;
      const botConfig = JSON.parse(botConfigRaw);
      const { token, secret, devices } = botConfig;
      if (!token || !secret || !devices || devices.length === 0) return;

      // 温湿度計デバイスのみを抽出
      const meters = devices.filter(d => {
        const type = (d.deviceType || "").toLowerCase();
        return type.includes("meter") || type.includes("sensor") || type.includes("woiosensor");
      });

      if (meters.length === 0) return;

      // 2. 各温度計のリアルタイムステータスを並列取得
      const results = await Promise.allSettled(
        meters.map(m => callSwitchBotApi(`/v1.1/devices/${m.deviceId}/status`, "GET", token, secret))
      );

      // 3. JST日時ラベルの生成
      const now = new Date();
      const jst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(jst.getUTCDate()).padStart(2, "0");
      const hh = String(jst.getUTCHours()).padStart(2, "0");
      const min = String(jst.getUTCMinutes()).padStart(2, "0");
      const label = `${mm}/${dd} ${hh}:${min}`;

      const readings = {};
      let validCount = 0;

      results.forEach((res, idx) => {
        if (res.status === "fulfilled" && res.value && res.value.body) {
          const body = res.value.body;
          if (body.temperature !== undefined) {
            readings[meters[idx].deviceId] = {
              temp: parseFloat(body.temperature),
              humidity: body.humidity !== undefined ? parseInt(body.humidity, 10) : null
            };
            validCount++;
          }
        }
      });

      if (validCount === 0) return;

      const newEntry = {
        ts: now.getTime(),
        time: now.getTime(),
        label: label,
        readings: readings
      };

      // 4. 履歴に追加保存
      const historyRaw = await env.KUWAGATA_KV.get("history:temp_log");
      let history = historyRaw ? JSON.parse(historyRaw) : [];
      history.push(newEntry);
      if (history.length > 1008) {
        history = history.slice(-1008);
      }
      await env.KUWAGATA_KV.put("history:temp_log", JSON.stringify(history));

    } catch (err) {
      console.error("Scheduled cron error:", err);
    }
  }
};
