/**
 * Cloudflare Pages Functions - SwitchBot Open API v1.1 プロキシ
 * 
 * 目的:
 * ブラウザから直接SwitchBot APIを叩く際に生じるCORS制約を回避し、
 * HMAC-SHA256認証署名を安全に生成して中継する。
 */

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const action = url.searchParams.get("action");
    const deviceId = url.searchParams.get("deviceId");

    // トークンとシークレットの取得（クエリ/ヘッダー優先、なければ環境変数）
    const token = context.request.headers.get("x-switchbot-token") || (context.env && context.env.SWITCHBOT_TOKEN);
    const secret = context.request.headers.get("x-switchbot-secret") || (context.env && context.env.SWITCHBOT_SECRET);

    if (!token || !secret) {
      return jsonResponse({
        success: false,
        error: "SwitchBotのTokenとSecretが設定されていません。ヘッダーまたは環境変数を設定してください。"
      }, 400);
    }

    if (action === "devices") {
      // 登録デバイス一覧を取得
      const res = await callSwitchBotApi("/v1.1/devices", "GET", token, secret);
      return jsonResponse(res);
    } else if (action === "status") {
      if (!deviceId) {
        return jsonResponse({ success: false, error: "deviceIdが指定されていません" }, 400);
      }
      // 特定デバイス（温度計など）のステータスを取得
      const res = await callSwitchBotApi(`/v1.1/devices/${deviceId}/status`, "GET", token, secret);
      return jsonResponse(res);
    } else {
      return jsonResponse({
        success: false,
        error: `不明なアクションです: ${action}`
      }, 400);
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { deviceId, command, parameter, commandType } = body;

    const token = context.request.headers.get("x-switchbot-token") || (context.env && context.env.SWITCHBOT_TOKEN);
    const secret = context.request.headers.get("x-switchbot-secret") || (context.env && context.env.SWITCHBOT_SECRET);

    if (!token || !secret) {
      return jsonResponse({
        success: false,
        error: "SwitchBotのTokenとSecretが設定されていません。"
      }, 400);
    }

    if (!deviceId) {
      return jsonResponse({ success: false, error: "deviceIdが指定されていません" }, 400);
    }

    // コマンド送信ペイロードの構築
    const payload = {
      command: command || "turnOn",
      parameter: parameter || "default",
      commandType: commandType || "command"
    };

    const res = await callSwitchBotApi(`/v1.1/devices/${deviceId}/commands`, "POST", token, secret, payload);
    return jsonResponse(res);
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

/**
 * SwitchBot API v1.1 呼び出しヘルパー
 */
export async function callSwitchBotApi(path, method, token, secret, body = null) {
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const sign = await generateSignature(token, secret, t, nonce);

  const headers = {
    "Authorization": token,
    "sign": sign,
    "nonce": nonce,
    "t": t,
    "Content-Type": "application/json; charset=utf8"
  };

  const options = {
    method,
    headers
  };

  if (body && method === "POST") {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`https://api.switch-bot.com${path}`, options);
  const data = await response.json();
  return data;
}

/**
 * SwitchBot Open API v1.1 HMAC-SHA256 署名生成
 */
export async function generateSignature(token, secret, t, nonce) {
  const data = token + t + nonce;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}
