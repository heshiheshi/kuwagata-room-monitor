/**
 * Kuwagata Room Monitor - ゼロ依存ローカル開発サーバー v3.2.0
 * 外部npmパッケージ不要（Node.js標準機能のみで動作）
 * 
 * 機能:
 * - 静的ファイル配信 (index.html, app.js, style.css)
 * - SwitchBot Open API プロキシ (/api/switchbot)
 * - クラウド設定共有エミュレーション (/api/sync/config)
 * - 温度履歴蓄積エミュレーション (/api/sync/history)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8788;
const PUBLIC_DIR = __dirname;
const DEV_KV_FILE = path.join(__dirname, ".dev-kv.json");

// ローカルKVストアの読み書き
function readDevKv() {
  try {
    if (fs.existsSync(DEV_KV_FILE)) {
      return JSON.parse(fs.readFileSync(DEV_KV_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to read .dev-kv.json:", e);
  }
  return { sharedConfig: null, tempHistory: [], botConfig: null };
}

function writeDevKv(data) {
  try {
    fs.writeFileSync(DEV_KV_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write .dev-kv.json:", e);
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

// SwitchBot HMAC-SHA256署名生成
function generateSignature(token, secret, t, nonce) {
  const data = token + t + nonce;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(data);
  return hmac.digest("base64");
}

// SwitchBot API リクエストヘルパー
function callSwitchBotApi(apiPath, method, token, secret, payload) {
  return new Promise((resolve, reject) => {
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const sign = generateSignature(token, secret, t, nonce);

    const headers = {
      "Authorization": token,
      "sign": sign,
      "nonce": nonce,
      "t": t,
      "Content-Type": "application/json; charset=utf8"
    };

    const options = {
      hostname: "api.switch-bot.com",
      path: apiPath,
      method: method,
      headers: headers
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ statusCode: res.statusCode, message: body });
        }
      });
    });

    req.on("error", (err) => reject(err));

    if (payload && method === "POST") {
      req.write(JSON.stringify(payload));
    }
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // CORSヘッダー設定
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- 1. SwitchBot API Routes ---
  if (pathname === "/api/switchbot") {
    const token = req.headers["x-switchbot-token"];
    const secret = req.headers["x-switchbot-secret"];

    if (!token || !secret) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "SwitchBotのTokenとSecretが指定されていません" }));
      return;
    }

    try {
      if (req.method === "GET") {
        const action = parsedUrl.searchParams.get("action");
        const deviceId = parsedUrl.searchParams.get("deviceId");

        if (action === "devices") {
          const data = await callSwitchBotApi("/v1.1/devices", "GET", token, secret);
          console.log("=== [SwitchBot API devices response] ===");
          if (data && data.body && data.body.deviceList) {
            console.log(`Total devices: ${data.body.deviceList.length}`);
            data.body.deviceList.forEach(d => console.log(` - [${d.deviceType}] ${d.deviceName} (ID: ${d.deviceId})`));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        } else if (action === "status") {
          const data = await callSwitchBotApi(`/v1.1/devices/${deviceId}/status`, "GET", token, secret);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: "不明なアクション" }));
        }
      } else if (req.method === "POST") {
        let bodyStr = "";
        req.on("data", chunk => bodyStr += chunk);
        req.on("end", async () => {
          try {
            const body = JSON.parse(bodyStr);
            const { deviceId, command, parameter, commandType } = body;
            const payload = {
              command: command || "turnOn",
              parameter: parameter || "default",
              commandType: commandType || "command"
            };
            const data = await callSwitchBotApi(`/v1.1/devices/${deviceId}/commands`, "POST", token, secret, payload);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(data));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // --- 2. クラウド設定共有 API エミュレーション (/api/sync/config) ---
  if (pathname === "/api/sync/config") {
    const kv = readDevKv();

    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, config: kv.sharedConfig }));
      return;
    } else if (req.method === "POST") {
      let bodyStr = "";
      req.on("data", chunk => bodyStr += chunk);
      req.on("end", () => {
        try {
          const body = JSON.parse(bodyStr);
          if (body.config) {
            body.config.updatedAt = Date.now();
            kv.sharedConfig = body.config;
          }
          if (body.credentials) {
            kv.botConfig = {
              token: body.credentials.token,
              secret: body.credentials.secret,
              devices: body.devices || [],
              updatedAt: Date.now()
            };
          }
          writeDevKv(kv);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "ローカルKVに保存しました" }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }
  }

  // --- 3. 温度履歴蓄積 API エミュレーション (/api/sync/history) ---
  if (pathname === "/api/sync/history") {
    const kv = readDevKv();

    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, history: kv.tempHistory || [] }));
      return;
    } else if (req.method === "POST") {
      let bodyStr = "";
      req.on("data", chunk => bodyStr += chunk);
      req.on("end", () => {
        try {
          const body = JSON.parse(bodyStr);
          if (body.entry && body.entry.readings) {
            kv.tempHistory = kv.tempHistory || [];
            const last = kv.tempHistory[kv.tempHistory.length - 1];
            if (!last || (body.entry.time - last.time) >= 180000) {
              kv.tempHistory.push(body.entry);
              if (kv.tempHistory.length > 1008) {
                kv.tempHistory = kv.tempHistory.slice(-1008);
              }
              writeDevKv(kv);
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, count: (kv.tempHistory || []).length }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }
  }

  // --- 静的ファイル配信 ---
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`500 Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache"
      });
      res.end(content);
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`🚀 Kuwagata Room Monitor Dev Server v3.2.0 running at http://localhost:${PORT}`);
});
