/**
 * Kuwagata Room Monitor - Cloudflare Workers Entrypoint v3.3.0
 * 
 * 機能:
 * 1. SwitchBot Open API プロキシ (/api/switchbot)
 * 2. クラウド設定共有 API (/api/sync/config) - カード並び順・色・外気温設定をKVで全端末同期
 * 3. 温度履歴クラウド蓄積 API (/api/sync/history) - 30分間隔データ蓄積・CSV出力対応
 * 4. 無人定期実行ステータス API (/api/sync/status) - 24時間稼働確認
 * 5. LINE Messaging API 連携 (/api/line/config, /api/line/test, /api/line/webhook)
 * 6. 無人定期実行 Cron Triggers (scheduled) - 30分おき無人記録・定時サマリー＆緊急温度異常アラート
 */

import { onRequestGet, onRequestPost, onRequestOptions, callSwitchBotApi, jsonResponse } from './functions/api/switchbot.js';

/**
 * LINE Messaging API プッシュ送信ヘルパー
 */
async function sendLinePushMessage(token, to, text) {
  if (!token || !to || !text) return { success: false, error: "Missing token, to, or text" };
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        to: to,
        messages: [{ type: "text", text: text }]
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { success: false, status: res.status, error: errBody };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

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

          // 30分間隔ポリシー（前回記録から25分以上経過している場合のみ記録）
          const lastEntry = history[history.length - 1];
          const lastTime = lastEntry ? (lastEntry.ts || lastEntry.time || 0) : 0;
          const entryTime = newEntry.ts || newEntry.time || Date.now();

          if (!lastEntry || (entryTime - lastTime) >= 1500000) { // 25分以上経過
            history.push(newEntry);
            if (history.length > 1008) { // 30分おき = 1日48件 x 21日分 = 1008件
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

    // 4. 無人自動記録ステータス確認 API (/api/sync/status)
    if (pathname === "/api/sync/status") {
      if (!env.KUWAGATA_KV) {
        return jsonResponse({ success: false, error: "KUWAGATA_KV がバインドされていません" }, 500);
      }

      try {
        const botConfigRaw = await env.KUWAGATA_KV.get("config:switchbot");
        const botConfig = botConfigRaw ? JSON.parse(botConfigRaw) : null;

        const historyRaw = await env.KUWAGATA_KV.get("history:temp_log");
        const history = historyRaw ? JSON.parse(historyRaw) : [];
        const lastEntry = history.length > 0 ? history[history.length - 1] : null;

        const lastCronRunRaw = await env.KUWAGATA_KV.get("status:last_cron_run");
        const lastCronRun = lastCronRunRaw ? parseInt(lastCronRunRaw, 10) : null;

        return jsonResponse({
          success: true,
          intervalMinutes: 30,
          cronSchedule: "30分おき (*/30 * * * *)",
          hasCredentials: !!(botConfig && botConfig.token && botConfig.secret),
          deviceCount: (botConfig && botConfig.devices) ? botConfig.devices.length : 0,
          totalRecords: history.length,
          lastRecordedAt: lastEntry ? (lastEntry.ts || lastEntry.time) : null,
          lastRecordedLabel: lastEntry ? lastEntry.label : null,
          lastCronRunAt: lastCronRun
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // 5. LINE通知設定 API (/api/line/config)
    if (pathname === "/api/line/config") {
      if (!env.KUWAGATA_KV) {
        return jsonResponse({ success: false, error: "KUWAGATA_KV がバインドされていません" }, 500);
      }

      if (request.method === "GET") {
        try {
          const raw = await env.KUWAGATA_KV.get("config:line");
          const config = raw ? JSON.parse(raw) : null;
          const detectedDestRaw = await env.KUWAGATA_KV.get("status:line_detected_destination");
          const detectedDest = detectedDestRaw ? JSON.parse(detectedDestRaw) : null;

          return jsonResponse({
            success: true,
            config: config,
            detectedDestination: detectedDest
          });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      } else if (request.method === "POST") {
        try {
          const body = await request.json();
          const { token, to, summaryEnabled, summaryHours, alertMaxTemp, alertMinTemp, alertCooldownMinutes } = body;

          const lineConfig = {
            token: (token || "").trim(),
            to: (to || "").trim(),
            summaryEnabled: summaryEnabled !== false,
            summaryHours: Array.isArray(summaryHours) ? summaryHours : [8, 20],
            alertMaxTemp: typeof alertMaxTemp === "number" ? alertMaxTemp : 18.5,
            alertMinTemp: typeof alertMinTemp === "number" ? alertMinTemp : 14.5,
            alertCooldownMinutes: typeof alertCooldownMinutes === "number" ? alertCooldownMinutes : 60,
            updatedAt: Date.now()
          };

          await env.KUWAGATA_KV.put("config:line", JSON.stringify(lineConfig));
          return jsonResponse({ success: true, message: "LINE通知設定を保存しました", config: lineConfig });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // 6. LINEテスト送信 API (/api/line/test)
    if (pathname === "/api/line/test") {
      if (!env.KUWAGATA_KV) {
        return jsonResponse({ success: false, error: "KUWAGATA_KV がバインドされていません" }, 500);
      }
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      try {
        const body = await request.json().catch(() => ({}));
        let token = body.token;
        let to = body.to;

        if (!token || !to) {
          const lineConfigRaw = await env.KUWAGATA_KV.get("config:line");
          if (lineConfigRaw) {
            const cfg = JSON.parse(lineConfigRaw);
            token = token || cfg.token;
            to = to || cfg.to;
          }
        }

        if (!token || !to) {
          return jsonResponse({ success: false, error: "アクセストークンまたは送信先IDが設定されていません" }, 400);
        }

        const testMsg = `🪲 クワガタ飼育室 LINE通知連携テスト\n───────────────\nLINE通知の疎通が正常に確認できました！\nこのグループへ定時サマリー（朝08:00/夜20:00）および緊急温度異常アラートが自動配信されます。`;
        const result = await sendLinePushMessage(token, to, testMsg);
        if (!result.success) {
          return jsonResponse({ success: false, error: result.error || "LINE APIへの送信に失敗しました" }, 502);
        }
        return jsonResponse({ success: true, message: "LINEにテスト通知を送信しました" });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // 7. LINE Webhook 受付 API (/api/line/webhook) - グループID自動検出用
    if (pathname === "/api/line/webhook") {
      if (request.method === "GET") {
        return new Response("LINE Webhook Endpoint Ready", { status: 200 });
      }
      if (request.method === "POST") {
        try {
          const body = await request.json().catch(() => ({}));
          const events = body.events || [];

          for (const ev of events) {
            const source = ev.source || {};
            const groupId = source.groupId || source.roomId || source.userId;

            if (groupId && env.KUWAGATA_KV) {
              const detectedInfo = {
                destinationId: groupId,
                type: source.type || "unknown",
                userId: source.userId || null,
                timestamp: Date.now()
              };
              await env.KUWAGATA_KV.put("status:line_detected_destination", JSON.stringify(detectedInfo));

              // もしconfig:lineのtoが空なら自動でセット
              const lineConfigRaw = await env.KUWAGATA_KV.get("config:line");
              if (lineConfigRaw) {
                const lineConfig = JSON.parse(lineConfigRaw);
                if (!lineConfig.to) {
                  lineConfig.to = groupId;
                  await env.KUWAGATA_KV.put("config:line", JSON.stringify(lineConfig));
                }
              }

              // 参加時(join)または「ID」発言時に返信
              if (ev.type === "join" || (ev.type === "message" && ev.message?.text && (ev.message.text.includes("ID") || ev.message.text.includes("設定")))) {
                const lineConfigRaw2 = await env.KUWAGATA_KV.get("config:line");
                const lineCfg2 = lineConfigRaw2 ? JSON.parse(lineConfigRaw2) : null;
                if (lineCfg2 && lineCfg2.token && ev.replyToken) {
                  await fetch("https://api.line.me/v2/bot/message/reply", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${lineCfg2.token}`
                    },
                    body: JSON.stringify({
                      replyToken: ev.replyToken,
                      messages: [{
                        type: "text",
                        text: `🪲 クワガタ飼育室Botが認識しました！\n送信先ID: ${groupId}\nアプリの設定画面（⚙️）に自動反映されます。`
                      }]
                    })
                  }).catch(() => {});
                }
              }
            }
          }
          return new Response("OK", { status: 200 });
        } catch (err) {
          console.error("Webhook error:", err);
          return new Response("OK", { status: 200 });
        }
      }
    }

    // 静的アセットにヒットしなかった場合は 404
    return new Response("Not Found", { status: 404 });
  },

  /**
   * ⏱️ 定期実行（Cron Triggers）ハンドラー (30分おき無人自動記録)
   */
  async scheduled(event, env, ctx) {
    if (!env.KUWAGATA_KV) return;

    try {
      // 1. 保存されているSwitchBot認証情報 & デバイス一覧を取得
      const botConfigRaw = await env.KUWAGATA_KV.get("config:switchbot");
      if (!botConfigRaw) {
        console.warn("Scheduled cron: config:switchbot not configured in KV yet");
        return;
      }
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
        readings: readings,
        source: "cron_30m"
      };

      // 4. 履歴に追加保存（最大1008件 = 30分おきで約3週間分）
      const historyRaw = await env.KUWAGATA_KV.get("history:temp_log");
      let history = historyRaw ? JSON.parse(historyRaw) : [];
      history.push(newEntry);
      if (history.length > 1008) {
        history = history.slice(-1008);
      }
      await env.KUWAGATA_KV.put("history:temp_log", JSON.stringify(history));
      await env.KUWAGATA_KV.put("status:last_cron_run", now.getTime().toString());

      // 5. 💬 LINE公式アカウント通知連携 (緊急アラート & 定時サマリー)
      try {
        const lineConfigRaw = await env.KUWAGATA_KV.get("config:line");
        if (lineConfigRaw) {
          const lineConfig = JSON.parse(lineConfigRaw);
          const lineToken = lineConfig.token;
          const lineTo = lineConfig.to;

          if (lineToken && lineTo) {
            const sharedRaw = await env.KUWAGATA_KV.get("config:shared");
            const sharedConfig = sharedRaw ? JSON.parse(sharedRaw) : {};
            const outdoorId = sharedConfig.outdoorMeterId || "";

            // A. 緊急温度異常アラート判定
            const alertMaxTemp = typeof lineConfig.alertMaxTemp === "number" ? lineConfig.alertMaxTemp : 18.5;
            const alertMinTemp = typeof lineConfig.alertMinTemp === "number" ? lineConfig.alertMinTemp : 14.5;
            const cooldownMs = (typeof lineConfig.alertCooldownMinutes === "number" ? lineConfig.alertCooldownMinutes : 60) * 60 * 1000;

            let abnormalMeter = null;
            let abnormalType = "";
            let abnormalVal = 0;

            let outdoorCurrentTemp = null;
            if (outdoorId && readings[outdoorId] && typeof readings[outdoorId].temp === "number") {
              outdoorCurrentTemp = readings[outdoorId].temp;
            }

            for (const [mId, r] of Object.entries(readings)) {
              if (mId === outdoorId) continue;
              if (typeof r.temp !== "number") continue;
              if (r.temp > alertMaxTemp) {
                const dObj = meters.find(m => m.deviceId === mId);
                abnormalMeter = dObj ? dObj.deviceName : "室内棚";
                abnormalType = "上限超過";
                abnormalVal = r.temp;
                break;
              } else if (r.temp < alertMinTemp) {
                const dObj = meters.find(m => m.deviceId === mId);
                abnormalMeter = dObj ? dObj.deviceName : "室内棚";
                abnormalType = "下限未満";
                abnormalVal = r.temp;
                break;
              }
            }

            if (abnormalMeter) {
              const lastAlertTsRaw = await env.KUWAGATA_KV.get("status:line_alert_last_sent");
              const lastAlertTs = lastAlertTsRaw ? parseInt(lastAlertTsRaw, 10) : 0;
              if (!lastAlertTs || (now.getTime() - lastAlertTs) >= cooldownMs) {
                const outStr = outdoorCurrentTemp !== null ? `${outdoorCurrentTemp.toFixed(1)}℃` : "--";
                const limitVal = abnormalType === "上限超過" ? alertMaxTemp : alertMinTemp;
                const alertMsg = `🚨【室温異常】${abnormalMeter} ${abnormalVal.toFixed(1)}℃\n（設定${limitVal}℃ 超過 / 外気温 ${outStr}）\nhttps://kuwagata-room-monitor2.heshikoumai.workers.dev/`;
                await sendLinePushMessage(lineToken, lineTo, alertMsg);
                await env.KUWAGATA_KV.put("status:line_alert_last_sent", now.getTime().toString());
              }
            }

            // B. 超シンプル定時サマリー判定（朝 08:00 / 夜 20:00）
            const summaryEnabled = lineConfig.summaryEnabled !== false;
            const summaryHours = Array.isArray(lineConfig.summaryHours) ? lineConfig.summaryHours : [8, 20];
            const currentJstHour = jst.getUTCHours();
            const currentJstMin = jst.getUTCMinutes();

            // 設定時刻の最初の実行枠（0〜29分）で実行
            if (summaryEnabled && summaryHours.includes(currentJstHour) && currentJstMin < 30) {
              const todayHourKey = `status:line_summary_${jst.getUTCFullYear()}${mm}${dd}_${hh}`;
              const alreadySent = await env.KUWAGATA_KV.get(todayHourKey);
              if (!alreadySent) {
                // 直近12時間（12時間前以降）の履歴を抽出
                const twelveHoursAgo = now.getTime() - (12 * 60 * 60 * 1000);
                const recentRecords = history.filter(h => (h.ts || h.time || 0) >= twelveHoursAgo);

                if (recentRecords.length > 0) {
                  let indoorTemps = [];
                  let outdoorTemps = [];

                  recentRecords.forEach(rec => {
                    const recEpoch = rec.ts || rec.time || 0;
                    const recDate = new Date(recEpoch + (9 * 60 * 60 * 1000));
                    const recTimeStr = `${String(recDate.getUTCHours()).padStart(2, '0')}:${String(recDate.getUTCMinutes()).padStart(2, '0')}`;

                    if (rec.readings) {
                      let recIndoorSum = 0;
                      let recIndoorCount = 0;
                      for (const [devId, val] of Object.entries(rec.readings)) {
                        if (devId === outdoorId) {
                          if (typeof val.temp === "number") {
                            outdoorTemps.push({ temp: val.temp, time: recTimeStr });
                          }
                        } else {
                          if (typeof val.temp === "number") {
                            recIndoorSum += val.temp;
                            recIndoorCount++;
                          }
                        }
                      }
                      if (recIndoorCount > 0) {
                        indoorTemps.push({ temp: recIndoorSum / recIndoorCount, time: recTimeStr });
                      }
                    }
                  });

                  if (indoorTemps.length > 0) {
                    const indoorAvg = (indoorTemps.reduce((acc, t) => acc + t.temp, 0) / indoorTemps.length).toFixed(1);
                    let indoorMin = indoorTemps[0];
                    let indoorMax = indoorTemps[0];
                    indoorTemps.forEach(t => {
                      if (t.temp < indoorMin.temp) indoorMin = t;
                      if (t.temp > indoorMax.temp) indoorMax = t;
                    });

                    let outdoorStr = "【外気温平均】--\n（最低 -- / 最高 --）";
                    if (outdoorTemps.length > 0) {
                      const outAvg = (outdoorTemps.reduce((acc, t) => acc + t.temp, 0) / outdoorTemps.length).toFixed(1);
                      let outMin = outdoorTemps[0];
                      let outMax = outdoorTemps[0];
                      outdoorTemps.forEach(t => {
                        if (t.temp < outMin.temp) outMin = t;
                        if (t.temp > outMax.temp) outMax = t;
                      });
                      outdoorStr = `【外気温平均】${outAvg}℃\n（最低 ${outMin.temp.toFixed(1)}℃ ${outMin.time} / 最高 ${outMax.temp.toFixed(1)}℃ ${outMax.time}）`;
                    }

                    const reportMsg = `🪲 飼育室 定時 (${hh}:00)\n【室内平均】${indoorAvg}℃\n（最低 ${indoorMin.temp.toFixed(1)}℃ ${indoorMin.time} / 最高 ${indoorMax.temp.toFixed(1)}℃ ${indoorMax.time}）\n${outdoorStr}`;
                    await sendLinePushMessage(lineToken, lineTo, reportMsg);
                    await env.KUWAGATA_KV.put(todayHourKey, "sent", { expirationTtl: 86400 });
                  }
                }
              }
            }
          }
        }
      } catch (lineErr) {
        console.error("Scheduled cron LINE error:", lineErr);
      }
    } catch (err) {
      console.error("Scheduled cron error:", err);
    }
  }
};
