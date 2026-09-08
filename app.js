/**
 * Kuwagata Room Monitor - Main Application Logic v3.2.1
 * 外気温グラフ折れ線＆右目盛り赤色同期、BLE MACアドレスのワンクリック・クリップボードコピー機能
 */

const APP_VERSION = "v3.2.1";
const APP_NAME = "Kuwagata Room Monitor";

// 🔒 クワガタアプリ共通の有効な合言葉（パスコード）
const VALID_PASSCODES = ['lojing2026', 'kuwagata2026', '7777'];

/**
 * SwitchBotの12桁deviceId（例: E9D8AF0D85F9）をBLE MAC形式（E9:D8:AF:0D:85:F9）に整形
 */
function formatMacAddress(id) {
  if (!id) return "--";
  const clean = String(id).replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (clean.length === 12) {
    return clean.match(/.{1,2}/g).join(":");
  }
  return id;
}

/**
 * 📋 クリップボードへのテキストコピー
 */
function copyToClipboard(text, label = "") {
  if (!text) return;
  const cleanText = text.trim();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(cleanText).then(() => {
      showToast(`📋 MACアドレスをコピーしました:\n${cleanText}`);
      logger.add("info", `BLE MACアドレスをコピーしました: [${cleanText}]`, { mac: cleanText, target: label });
    }).catch(() => fallbackCopy(cleanText, label));
  } else {
    fallbackCopy(cleanText, label);
  }
}

function fallbackCopy(text, label = "") {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    showToast(`📋 MACアドレスをコピーしました:\n${text}`);
    logger.add("info", `BLE MACアドレスをコピーしました (fallback): [${text}]`, { mac: text, target: label });
  } catch (err) {
    alert("コピーに失敗しました: " + text);
  }
  document.body.removeChild(textarea);
}

/**
 * 🍞 画面下部にトースト通知をふわっと表示
 */
function showToast(message) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast-message";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-show");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("toast-show");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, 2400);
}

// 定数 & ストレージキー
const STORAGE_KEYS = {
  AUTH_PASSED: "kuwagata_room_auth_passed",
  TOKEN: "kuwagata_sb_token",
  SECRET: "kuwagata_sb_secret",
  DEVICES: "kuwagata_sb_devices",
  EXCLUDED_DEVICES: "kuwagata_sb_excluded_devices",
  LAST_METER_DATA: "kuwagata_last_meter_data",
  LAST_METER_TIME: "kuwagata_last_meter_time",
  TEMP_HISTORY: "kuwagata_temp_history", // 温度時系列データ
  AIRCON_EVENTS: "kuwagata_aircon_events", // エアコン送信イベント履歴
  KEEP_ALIVE: "kuwagata_keep_alive_enabled",
  AIRCON_ID: "kuwagata_aircon_id",
  AIRCON_CONFIG: "kuwagata_aircon_config",
  ORIENTATION_MODE: "kuwagata_orientation_mode",
  CHART_MIN: "kuwagata_chart_min_temp",
  CHART_MAX: "kuwagata_chart_max_temp",
  OUTDOOR_METER_ID: "kuwagata_outdoor_meter_id", // 外気温センサーdeviceId
  METER_ORDER: "kuwagata_meter_order",           // 温度計カードの並び順 (deviceId配列)
  METER_COLORS: "kuwagata_meter_colors",         // 各温度計のカスタム色マッピング { [deviceId]: "#hex" }
  LAST_CLOUD_SYNC: "kuwagata_last_cloud_sync"    // 最終クラウド同期時刻
};

const MODE_NAMES = { "1": "自動", "2": "冷房", "3": "除湿", "4": "送風", "5": "暖房" };
const FAN_NAMES = { "1": "自動", "2": "弱", "3": "中", "4": "強" };

// 🎨 視認性の高いプリセットカラーパレット (8色・赤色先頭)
const PRESET_COLORS = [
  "#ef4444", // レッド (外気温推奨・赤)
  "#38bdf8", // 水色 (シアン)
  "#fb923c", // オレンジ
  "#34d399", // エメラルド (緑)
  "#c084fc", // パープル (紫)
  "#f43f5e", // ローズ (赤ピンク)
  "#eab308", // アンバー (黄)
  "#06b6d4"  // ティール (青緑)
];

// グラフ描画デフォルトカラーパレット (視認性の高い基本5色)
const SENSOR_COLORS = [
  { 
    border: "#38bdf8", // 水色
    bg: "rgba(56, 189, 248, 0.15)",
    cardBg: "linear-gradient(145deg, rgba(56, 189, 248, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)",
    cardBorder: "rgba(56, 189, 248, 0.4)",
    badgeBg: "rgba(56, 189, 248, 0.2)",
    badgeText: "#38bdf8"
  },
  { 
    border: "#fb923c", // オレンジ
    bg: "rgba(251, 146, 60, 0.15)",
    cardBg: "linear-gradient(145deg, rgba(251, 146, 60, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)",
    cardBorder: "rgba(251, 146, 60, 0.4)",
    badgeBg: "rgba(251, 146, 60, 0.2)",
    badgeText: "#fb923c"
  },
  { 
    border: "#34d399", // エメラルド
    bg: "rgba(52, 211, 153, 0.15)",
    cardBg: "linear-gradient(145deg, rgba(52, 211, 153, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)",
    cardBorder: "rgba(52, 211, 153, 0.4)",
    badgeBg: "rgba(52, 211, 153, 0.2)",
    badgeText: "#34d399"
  },
  { 
    border: "#c084fc", // パープル
    bg: "rgba(192, 132, 252, 0.15)",
    cardBg: "linear-gradient(145deg, rgba(192, 132, 252, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)",
    cardBorder: "rgba(192, 132, 252, 0.4)",
    badgeBg: "rgba(192, 132, 252, 0.2)",
    badgeText: "#c084fc"
  },
  { 
    border: "#f43f5e", // ローズ
    bg: "rgba(244, 63, 94, 0.15)",
    cardBg: "linear-gradient(145deg, rgba(244, 63, 94, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)",
    cardBorder: "rgba(244, 63, 94, 0.4)",
    badgeBg: "rgba(244, 63, 94, 0.2)",
    badgeText: "#f43f5e"
  }
];

/**
 * HEX色コードをRGBA文字列に変換
 */
function hexToRgba(hex, alpha = 1) {
  let c = String(hex || "#38bdf8").replace("#", "");
  if (c.length === 3) {
    c = c.split("").map(x => x + x).join("");
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(56, 189, 248, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * デバイス固有のカスタム色（またはデフォルト色）設定を取得
 */
function getMeterColorConfig(deviceId, defaultIndex = 0) {
  const customHex = (appState && appState.meterColors && appState.meterColors[deviceId]);
  if (customHex) {
    return {
      border: customHex,
      bg: hexToRgba(customHex, 0.15),
      cardBg: `linear-gradient(145deg, ${hexToRgba(customHex, 0.12)} 0%, rgba(15, 23, 42, 0.85) 100%)`,
      cardBorder: hexToRgba(customHex, 0.45),
      badgeBg: hexToRgba(customHex, 0.2),
      badgeText: customHex
    };
  }
  // ☀️ 外気温度計ならデフォルトは鮮やかな赤 (#ef4444)
  if (deviceId && appState && deviceId === appState.outdoorMeterId) {
    const redHex = "#ef4444";
    return {
      border: redHex,
      bg: hexToRgba(redHex, 0.15),
      cardBg: `linear-gradient(145deg, ${hexToRgba(redHex, 0.12)} 0%, rgba(15, 23, 42, 0.85) 100%)`,
      cardBorder: hexToRgba(redHex, 0.45),
      badgeBg: hexToRgba(redHex, 0.2),
      badgeText: redHex
    };
  }
  return SENSOR_COLORS[defaultIndex % SENSOR_COLORS.length];
}

// 📋 システムログ管理（リッチ構造化ログ）
const logger = {
  container: null,
  entries: [],
  init(containerEl) {
    this.container = containerEl;
  },
  add(type, title, data = null) {
    const time = new Date().toLocaleTimeString("ja-JP");
    const entry = { time, type, title, data };
    this.entries.push(entry);

    if (this.container) {
      const el = document.createElement("div");
      el.className = `log-entry ${type}`;
      
      const titleLine = document.createElement("div");
      titleLine.className = "log-title-line";
      titleLine.textContent = `[${time}] [${type.toUpperCase()}] ${title}`;
      el.appendChild(titleLine);

      if (data) {
        const pre = document.createElement("pre");
        pre.className = "log-json-block";
        try {
          pre.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        } catch (e) {
          pre.textContent = String(data);
        }
        el.appendChild(pre);
      }

      this.container.appendChild(el);
      this.container.scrollTop = this.container.scrollHeight;
    }
    console.log(`[${type.toUpperCase()}] ${title}`, data || "");
  },
  clear() {
    this.entries = [];
    if (this.container) {
      this.container.innerHTML = '<div class="log-entry info"><div class="log-title-line">[システム起動] ログクリア完了</div></div>';
    }
  },
  getAllText() {
    return this.entries.map(e => {
      const dataStr = e.data ? "\n" + (typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2)) : "";
      return `[${e.time}] [${e.type.toUpperCase()}] ${e.title}${dataStr}`;
    }).join("\n\n");
  }
};

// 状態管理
let defaultAirconConfig = { temp: 16, mode: "2", fan: "1", dir: "1" };
let savedAirconConfig = null;
try { savedAirconConfig = JSON.parse(localStorage.getItem(STORAGE_KEYS.AIRCON_CONFIG)); } catch (e) {}

let cachedMeterData = [];
try { cachedMeterData = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_METER_DATA) || "[]"); } catch (e) {}

let tempHistory = [];
try { tempHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.TEMP_HISTORY) || "[]"); } catch (e) {}

let savedChartMin = parseFloat(localStorage.getItem(STORAGE_KEYS.CHART_MIN));
if (isNaN(savedChartMin)) savedChartMin = 15.0;

let savedChartMax = parseFloat(localStorage.getItem(STORAGE_KEYS.CHART_MAX));
if (isNaN(savedChartMax)) savedChartMax = 18.0;

let airconEvents = [];
try { airconEvents = JSON.parse(localStorage.getItem(STORAGE_KEYS.AIRCON_EVENTS) || "[]"); } catch (e) {}

let savedOutdoorMeterId = localStorage.getItem(STORAGE_KEYS.OUTDOOR_METER_ID);
if (savedOutdoorMeterId === null) {
  // デフォルトで作業場温湿時計（E9D8AF0D85F9）を外気温として初期設定
  savedOutdoorMeterId = "E9D8AF0D85F9";
}

let appState = {
  isAuth: false,
  token: localStorage.getItem(STORAGE_KEYS.TOKEN) || "",
  secret: localStorage.getItem(STORAGE_KEYS.SECRET) || "",
  devices: JSON.parse(localStorage.getItem(STORAGE_KEYS.DEVICES) || "[]"),
  excludedDeviceIds: JSON.parse(localStorage.getItem(STORAGE_KEYS.EXCLUDED_DEVICES) || "[]"),
  infraredDevices: [],
  thermometers: [],
  cameras: [],
  meterDataCache: cachedMeterData,
  tempHistory: tempHistory,
  airconEvents: airconEvents,
  lastUpdatedText: localStorage.getItem(STORAGE_KEYS.LAST_METER_TIME) || "--:--:--",
  airconConfig: savedAirconConfig || defaultAirconConfig,
  chartInstance: null,
  selectedGraphHours: 1, // 1時間 | 6時間 | 24時間 | 0(すべて)
  chartMinTemp: savedChartMin,
  chartMaxTemp: savedChartMax,
  outdoorMeterId: savedOutdoorMeterId, // 外気温として扱うdeviceId
  meterOrder: JSON.parse(localStorage.getItem(STORAGE_KEYS.METER_ORDER) || "[]"), // 並び順 [deviceId, ...]
  meterColors: JSON.parse(localStorage.getItem(STORAGE_KEYS.METER_COLORS) || "{}"), // カスタム色 { [deviceId]: "#hex" }
  hiddenMeterIds: [], // グラフで非表示になっているdeviceIdの配列
  soloMeterId: null,   // 単独表示中のdeviceId (nullなら通常表示)
  keepAliveTimer: null,
  autoRefreshTimer: null,
  deviceSyncTimer: null,
  orientationMode: localStorage.getItem(STORAGE_KEYS.ORIENTATION_MODE) || "auto",
  renderedAirconPins: [] // グラフ上に描画されたピンの座標とイベント情報（クリック判定用）
};

// DOM要素
const elements = {
  authModal: document.getElementById("authModal"),
  authForm: document.getElementById("authForm"),
  authPassInput: document.getElementById("authPassInput"),
  authSubmitBtn: document.getElementById("authSubmitBtn"),
  authErrorMsg: document.getElementById("authErrorMsg"),
  appWrapper: document.getElementById("appWrapper"),
  logoutBtn: document.getElementById("logoutBtn"),
  connectionStatus: document.getElementById("connectionStatus"),
  statusText: document.getElementById("statusText"),
  refreshBtn: document.getElementById("refreshBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  sbTokenInput: document.getElementById("sbTokenInput"),
  sbSecretInput: document.getElementById("sbSecretInput"),
  btnSaveApiKeys: document.getElementById("btnSaveApiKeys"),
  btnFetchDevices: document.getElementById("btnFetchDevices"),
  deviceListContainer: document.getElementById("deviceListContainer"),
  thermometerGrid: document.getElementById("thermometerGrid"),
  lastUpdated: document.getElementById("lastUpdated"),

  // グラフ要素
  tempChartCanvas: document.getElementById("tempChartCanvas"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  chartMinTempInput: document.getElementById("chartMinTempInput"),
  chartMaxTempInput: document.getElementById("chartMaxTempInput"),
  btnSaveChartScale: document.getElementById("btnSaveChartScale"),

  // ☀️ 外気温設定要素
  outdoorMeterSelect: document.getElementById("outdoorMeterSelect"),
  outdoorMeterCurrentName: document.getElementById("outdoorMeterCurrentName"),
  outdoorMeterMacBadge: document.getElementById("outdoorMeterMacBadge"),

  // 🎨 カラー設定 & 並び順要素
  meterColorSettingsList: document.getElementById("meterColorSettingsList"),
  btnResetMeterOrder: document.getElementById("btnResetMeterOrder"),

  // ☁️ クラウド同期 & 履歴CSV出力要素
  cloudSyncBadge: document.getElementById("cloudSyncBadge"),
  cloudSyncText: document.getElementById("cloudSyncText"),
  btnExportCsv: document.getElementById("btnExportCsv"),
  btnModalExportCsv: document.getElementById("btnModalExportCsv"),
  btnSyncPush: document.getElementById("btnSyncPush"),
  btnSyncPull: document.getElementById("btnSyncPull"),

  // 💬 エアコン送信イベント詳細ツールチップ & 履歴チップ
  airconEventTooltip: document.getElementById("airconEventTooltip"),
  closeAirconTooltipBtn: document.getElementById("closeAirconTooltipBtn"),
  ttBadge: document.getElementById("ttBadge"),
  ttTime: document.getElementById("ttTime"),
  ttType: document.getElementById("ttType"),
  ttTemp: document.getElementById("ttTemp"),
  ttDesc: document.getElementById("ttDesc"),
  airconEventChips: document.getElementById("airconEventChips"),

  // エアコンUI要素
  airconCurrentBadge: document.getElementById("airconCurrentBadge"),
  airconTempInput: document.getElementById("airconTempInput"),
  tempDownBtn: document.getElementById("tempDownBtn"),
  tempUpBtn: document.getElementById("tempUpBtn"),
  airconModeSelect: document.getElementById("airconModeSelect"),
  airconFanSelect: document.getElementById("airconFanSelect"),
  airconDirSelect: document.getElementById("airconDirSelect"),
  btnSendCustomAircon: document.getElementById("btnSendCustomAircon"),
  sendAirconBtnLabel: document.getElementById("sendAirconBtnLabel"),
  btnAirconOff: document.getElementById("btnAirconOff"),
  airconStatus: document.getElementById("airconStatus"),

  // キープアライブ
  keepAliveToggle: document.getElementById("keepAliveToggle"),
  keepAliveInfo: document.getElementById("keepAliveInfo"),
  keepAliveBadge: document.getElementById("keepAliveBadge"),

  btnShutterOpen: document.getElementById("btnShutterOpen"),
  btnShutterClose: document.getElementById("btnShutterClose"),
  shutterStatus: document.getElementById("shutterStatus"),

  orientationBtn: document.getElementById("orientationBtn"),
  orientationIcon: document.getElementById("orientationIcon"),
  orientationLabel: document.getElementById("orientationLabel"),
  debugLogFab: document.getElementById("debugLogFab"),
  debugLogModal: document.getElementById("debugLogModal"),
  closeDebugLogBtn: document.getElementById("closeDebugLogBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  copyLogBtn: document.getElementById("copyLogBtn"),
  debugLogContainer: document.getElementById("debugLogContainer")
};

// 初期化
window.addEventListener("DOMContentLoaded", () => {
  logger.init(elements.debugLogContainer);

  initLocalhostDebugMode();

  logger.add("info", "アプリケーション起動");

  logger.add("info", `アプリケーションを読み込みました (${APP_VERSION})`, {
    appName: APP_NAME,
    version: APP_VERSION,
    url: window.location.href,
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    port: window.location.port || (window.location.protocol === "https:" ? "443" : "80"),
    userAgent: navigator.userAgent,
    screenResolution: `${window.innerWidth}x${window.innerHeight} (dpr: ${window.devicePixelRatio || 1})`,
    screenOrientation: window.screen && window.screen.orientation ? window.screen.orientation.type : "unknown",
    savedDevicesCount: appState.devices.length,
    cachedMetersCount: appState.meterDataCache.length,
    outdoorMeterId: appState.outdoorMeterId,
    outdoorMeterMac: formatMacAddress(appState.outdoorMeterId)
  });

  checkAuthentication();
  setupEventListeners();
  applyOrientationMode(appState.orientationMode);
  initAirconUI();
  initTempChart();

  // ☁️ クラウド共有設定 & 24時間温度履歴の自動取得
  fetchSharedConfig();
  fetchCloudTempHistory();
});

function initLocalhostDebugMode() {
  const isProduction = window.location.hostname.includes("pages.dev") ||
                       window.location.hostname.includes("workers.dev");

  if (!isProduction) {
    if (elements.debugLogFab) {
      elements.debugLogFab.classList.remove("hidden");
      elements.debugLogFab.style.display = "flex";
    }

    logger.add("success", "開発環境（localhost）を検出しました。右下にLocalhostログボタンを表示中。", {
      host: window.location.host,
      protocol: window.location.protocol,
      mode: "Development / Localhost",
      buttonStatus: "Always Visible"
    });
  } else {
    if (elements.debugLogFab) {
      elements.debugLogFab.classList.add("hidden");
      elements.debugLogFab.style.display = "none";
    }
  }
}

function checkAuthentication() {
  const isPassed = localStorage.getItem(STORAGE_KEYS.AUTH_PASSED) === "true" ||
                   sessionStorage.getItem("kuwagata_auth_passed") === "true";

  if (isPassed) {
    unlockApp();
  } else {
    lockApp();
  }
}

function unlockApp() {
  appState.isAuth = true;
  if (elements.authModal) elements.authModal.classList.add("hidden");
  if (elements.appWrapper) elements.appWrapper.classList.remove("hidden");

  try {
    // 前回キャッシュがあれば即描画
    if (appState.meterDataCache && appState.meterDataCache.length > 0) {
      renderThermometerCards(appState.meterDataCache, false);
      if (elements.lastUpdated) {
        elements.lastUpdated.innerHTML = `前回: <strong>${appState.lastUpdatedText}</strong> <span style="color: var(--accent-blue); font-size: 0.75rem;">(最新取得中...)</span>`;
      }
      updateTempChart();
    }

    initUI();

    if (appState.token && appState.secret) {
      elements.sbTokenInput.value = appState.token;
      elements.sbSecretInput.value = appState.secret;
      fetchDevicesAndStatus();
    } else {
      updateStatus("設定が必要", true);
    }
  } catch (err) {
    console.error("Unlock initialization error:", err);
    logger.add("error", "アプリ起動時描画エラー: " + err.message, { stack: err.stack });
  }

  // 自動更新タイマー（2分おき）
  if (!appState.autoRefreshTimer) {
    appState.autoRefreshTimer = setInterval(() => {
      if (appState.token && appState.secret && appState.isAuth) {
        refreshThermometers();
      }
    }, 120000);
  }

  // 1時間ごとのデバイス同期タイマー
  if (!appState.deviceSyncTimer) {
    appState.deviceSyncTimer = setInterval(() => {
      if (appState.token && appState.secret && appState.isAuth) {
        fetchDevicesAndStatus();
      }
    }, 3600000);
  }
}

function lockApp() {
  appState.isAuth = false;
  if (elements.authModal) elements.authModal.classList.remove("hidden");
  if (elements.appWrapper) elements.appWrapper.classList.add("hidden");
  if (elements.authPassInput) {
    elements.authPassInput.value = "";
    setTimeout(() => elements.authPassInput.focus(), 100);
  }
  if (elements.authErrorMsg) elements.authErrorMsg.classList.add("hidden");
}

let isSubmittingAuth = false;

function handleAuthSubmit(customPass = null) {
  if (isSubmittingAuth) return;
  isSubmittingAuth = true;
  setTimeout(() => { isSubmittingAuth = false; }, 800);

  try {
    const raw = customPass !== null ? customPass : (elements.authPassInput?.value || "");
    // NFKC正規化（全角英数・記号を半角に自動変換）＋あらゆる空白・改行・不可視文字（ゼロ幅スペース等）を完全除去＋小文字化
    const pass = String(raw).normalize("NFKC").replace(/[\s\u200B-\u200D\uFEFF]/g, "").toLowerCase();
    
    if (VALID_PASSCODES.includes(pass)) {
      localStorage.setItem(STORAGE_KEYS.AUTH_PASSED, "true");
      sessionStorage.setItem("kuwagata_auth_passed", "true");
      if (elements.authErrorMsg) elements.authErrorMsg.classList.add("hidden");
      
      logger.add("success", "セキュリティ合言葉の認証に成功しました", {
        authPassed: true,
        authMethod: "passcode_input",
        passcodeMasked: pass.length > 2 ? `${pass[0]}${"*".repeat(pass.length - 2)}${pass.slice(-1)}` : "**",
        host: window.location.host,
        timestamp: new Date().toISOString()
      });
      
      unlockApp();
    } else {
      if (elements.authErrorMsg) elements.authErrorMsg.classList.remove("hidden");
      if (elements.authPassInput) {
        elements.authPassInput.value = "";
        elements.authPassInput.focus();
      }
      
      logger.add("warn", "セキュリティ合言葉の認証に失敗しました", {
        authPassed: false,
        inputLength: pass.length,
        host: window.location.host,
        timestamp: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error("Auth submit error:", err);
    alert("認証処理中にエラーが発生しました: " + err.message);
  } finally {
    isSubmittingAuth = false;
  }
}

function handleLocalhostBypass() {
  localStorage.setItem(STORAGE_KEYS.AUTH_PASSED, "true");
  sessionStorage.setItem("kuwagata_auth_passed", "true");
  if (elements.authErrorMsg) elements.authErrorMsg.classList.add("hidden");

  logger.add("success", "Localhost開発環境ワンクリック解除により入場しました", {
    authPassed: true,
    authMethod: "localhost_dev_unlock",
    host: window.location.host,
    timestamp: new Date().toISOString()
  });

  unlockApp();
}

function handleLogout() {
  if (confirm("ログアウトして画面をロックしますか？")) {
    localStorage.removeItem(STORAGE_KEYS.AUTH_PASSED);
    sessionStorage.removeItem("kuwagata_auth_passed");
    lockApp();
  }
}

function initUI() {
  localStorage.setItem(STORAGE_KEYS.KEEP_ALIVE, "false");
  elements.keepAliveToggle.checked = false;
  updateKeepAliveUI(false);

  // グラフ目盛り設定の反映
  if (elements.chartMinTempInput && elements.chartMaxTempInput) {
    elements.chartMinTempInput.value = appState.chartMinTemp;
    elements.chartMaxTempInput.value = appState.chartMaxTemp;
  }
}

function initAirconUI() {
  const cfg = appState.airconConfig;
  elements.airconTempInput.value = cfg.temp;
  elements.airconModeSelect.value = cfg.mode;
  elements.airconFanSelect.value = cfg.fan;
  elements.airconDirSelect.value = cfg.dir;
  updateAirconLabels();

  elements.tempDownBtn.addEventListener("click", () => {
    let t = parseInt(elements.airconTempInput.value, 10) || 16;
    if (t > 16) {
      elements.airconTempInput.value = t - 1;
      saveAirconConfig();
    }
  });

  elements.tempUpBtn.addEventListener("click", () => {
    let t = parseInt(elements.airconTempInput.value, 10) || 16;
    if (t < 30) {
      elements.airconTempInput.value = t + 1;
      saveAirconConfig();
    }
  });

  elements.airconTempInput.addEventListener("change", saveAirconConfig);
  elements.airconModeSelect.addEventListener("change", saveAirconConfig);
  elements.airconFanSelect.addEventListener("change", saveAirconConfig);
  elements.airconDirSelect.addEventListener("change", saveAirconConfig);
}

function saveAirconConfig() {
  let temp = parseInt(elements.airconTempInput.value, 10);
  if (isNaN(temp) || temp < 16) temp = 16;
  if (temp > 30) temp = 30;
  elements.airconTempInput.value = temp;

  appState.airconConfig = {
    temp: temp,
    mode: elements.airconModeSelect.value,
    fan: elements.airconFanSelect.value,
    dir: elements.airconDirSelect.value
  };

  localStorage.setItem(STORAGE_KEYS.AIRCON_CONFIG, JSON.stringify(appState.airconConfig));
  updateAirconLabels();
}

function updateAirconLabels() {
  const cfg = appState.airconConfig;
  const modeName = MODE_NAMES[cfg.mode] || "冷房";
  const fanName = FAN_NAMES[cfg.fan] || "自動";

  elements.airconCurrentBadge.textContent = `設定: ${modeName} ${cfg.temp}℃ (${fanName})`;
  elements.sendAirconBtnLabel.textContent = `${modeName} ${cfg.temp}℃ (${fanName}) を送信`;
}

function setupEventListeners() {
  // 🔒 認証関連イベントバインド（form submit で一元化し二重送信を防止）
  if (elements.authForm) {
    elements.authForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleAuthSubmit();
    });
  }

  if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener("click", handleLogout);
  }

  // グラフ期間切り替えボタン
  const periodBtns = document.querySelectorAll(".btn-period");
  periodBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      periodBtns.forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      const hours = parseInt(e.target.dataset.hours, 10);
      appState.selectedGraphHours = hours;
      updateTempChart();
      logger.add("info", `グラフ表示期間を「${e.target.textContent.trim()}」に切り替えました`, {
        filterHours: hours === 0 ? "全期間" : `${hours}時間`,
        historyDataPoints: appState.tempHistory.length
      });
    });
  });

  // グラフ履歴クリアボタン
      elements.clearHistoryBtn.addEventListener("click", () => {
    if (confirm("これまでの温度推移・エアコン送信履歴データをクリアしますか？")) {
      const prevPoints = appState.tempHistory.length;
      const prevEvents = appState.airconEvents.length;
      appState.tempHistory = [];
      appState.airconEvents = [];
      localStorage.removeItem(STORAGE_KEYS.TEMP_HISTORY);
      localStorage.removeItem(STORAGE_KEYS.AIRCON_EVENTS);
      hideAirconEventTooltip();
      updateTempChart();
      logger.add("info", "温度推移およびエアコン送信履歴データをクリアしました", {
        deletedPointsCount: prevPoints,
        deletedEventsCount: prevEvents
      });
    }
  });

  // 💬 グラフキャンバスマウス・タップ操作（エアコンピンのホバー＆クリックでツールチップ表示）
  if (elements.tempChartCanvas) {
    elements.tempChartCanvas.addEventListener("mousemove", (e) => {
      const rect = elements.tempChartCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // ピンの上にカーソルがあるかヒットテスト
      const hitPin = (appState.renderedAirconPins || []).find(p => 
        mouseX >= p.x - 4 && mouseX <= p.x + p.w + 4 &&
        mouseY >= p.y - 4 && mouseY <= p.y + p.h + 4
      );

      elements.tempChartCanvas.style.cursor = hitPin ? "pointer" : "default";
    });

    elements.tempChartCanvas.addEventListener("click", (e) => {
      const rect = elements.tempChartCanvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // ピンのクリック判定（当たり判定を少し広めに設定）
      const hitPin = (appState.renderedAirconPins || []).find(p => 
        clickX >= p.x - 6 && clickX <= p.x + p.w + 6 &&
        clickY >= p.y - 6 && clickY <= p.y + p.h + 6
      );

      if (hitPin) {
        showAirconEventTooltip(hitPin.event, hitPin.centerX, hitPin.bottomY);
      } else {
        // ピン以外をクリックしたら閉じる
        hideAirconEventTooltip();
      }
    });
  }

  // ツールチップを閉じるボタン
  if (elements.closeAirconTooltipBtn) {
    elements.closeAirconTooltipBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hideAirconEventTooltip();
    });
  }

  elements.debugLogFab.addEventListener("click", () => {
    elements.debugLogModal.classList.remove("hidden");
    logger.add("info", "Localhostモード システム通信ログを開きました", {
      totalLogEntries: logger.entries.length
    });
  });
  elements.closeDebugLogBtn.addEventListener("click", () => {
    elements.debugLogModal.classList.add("hidden");
  });
  elements.clearLogBtn.addEventListener("click", () => {
    logger.clear();
  });
  elements.copyLogBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(logger.getAllText())
      .then(() => alert("ログをクリップボードにコピーしました"))
      .catch(() => alert("コピーに失敗しました"));
  });

  elements.orientationBtn.addEventListener("click", () => {
    let nextMode = "auto";
    if (appState.orientationMode === "auto") nextMode = "portrait";
    else if (appState.orientationMode === "portrait") nextMode = "landscape";
    else nextMode = "auto";

    appState.orientationMode = nextMode;
    localStorage.setItem(STORAGE_KEYS.ORIENTATION_MODE, nextMode);
    applyOrientationMode(nextMode);

    logger.add("info", `画面向きモードを「${nextMode}」に切り替えました`, {
      mode: nextMode,
      windowSize: `${window.innerWidth}x${window.innerHeight}`
    });
  });

  elements.settingsBtn.addEventListener("click", () => {
    updateOutdoorMeterSettingsUI();
    updateColorSettingsInModal();
    elements.settingsModal.classList.remove("hidden");
    logger.add("info", "設定モーダルを開きました");
  });
  elements.closeSettingsBtn.addEventListener("click", () => {
    elements.settingsModal.classList.add("hidden");
  });

  if (elements.btnResetMeterOrder) {
    elements.btnResetMeterOrder.addEventListener("click", () => {
      if (!confirm("温度計カードの並び順を初期状態にリセットしますか？")) return;
      appState.meterOrder = [];
      localStorage.removeItem(STORAGE_KEYS.METER_ORDER);
      renderThermometerCards(appState.meterDataCache, false);
      updateTempChart();
      updateColorSettingsInModal();
      logger.add("info", "温度計カード並び順を初期状態にリセットしました");
      debouncedSyncConfigToCloud();
      alert("並び順を初期状態に戻しました。");
    });
  }

  // ☁️ クラウド同期手動実行 & CSVエクスポート
  if (elements.btnSyncPush) {
    elements.btnSyncPush.addEventListener("click", () => syncConfigToCloud(true));
  }
  if (elements.btnSyncPull) {
    elements.btnSyncPull.addEventListener("click", () => fetchSharedConfig(true));
  }
  if (elements.btnExportCsv) {
    elements.btnExportCsv.addEventListener("click", exportTempHistoryCsv);
  }
  if (elements.btnModalExportCsv) {
    elements.btnModalExportCsv.addEventListener("click", exportTempHistoryCsv);
  }

  // 📋 クリップボードへのMACアドレスコピー操作（全体委任）
  document.addEventListener("click", (e) => {
    const copyBtn = e.target.closest(".btn-copy-mac");
    if (copyBtn) {
      e.stopPropagation();
      const mac = copyBtn.dataset.mac;
      const name = copyBtn.dataset.name || "";
      if (mac) {
        copyToClipboard(mac, name);
      }
    }
  });

  elements.btnSaveApiKeys.addEventListener("click", () => {
    const token = elements.sbTokenInput.value.trim();
    const secret = elements.sbSecretInput.value.trim();
    if (!token || !secret) {
      alert("TokenとSecretの両方を入力してください。");
      return;
    }
    appState.token = token;
    appState.secret = secret;
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.SECRET, secret);
    logger.add("success", "SwitchBot APIキー（Token/Secret）をブラウザに保存しました", {
      tokenLength: token.length,
      secretLength: secret.length,
      storageKey: STORAGE_KEYS.TOKEN
    });

    // クラウド側(KV)にも保存し、Cron定期記録を有効化
    syncConfigToCloud(false);
    alert("APIキーを保存しました（クラウド定期記録用にも同期されました）。");
  });

  // グラフ目盛り設定の保存
  if (elements.btnSaveChartScale) {
    elements.btnSaveChartScale.addEventListener("click", () => {
      let minVal = parseFloat(elements.chartMinTempInput.value);
      let maxVal = parseFloat(elements.chartMaxTempInput.value);

      if (isNaN(minVal) || isNaN(maxVal)) {
        alert("下限温度と上限温度を正しい数値で入力してください。");
        return;
      }
      if (minVal >= maxVal) {
        alert("下限温度は上限温度より低い数値を設定してください。");
        return;
      }

      appState.chartMinTemp = minVal;
      appState.chartMaxTemp = maxVal;
      localStorage.setItem(STORAGE_KEYS.CHART_MIN, minVal.toString());
      localStorage.setItem(STORAGE_KEYS.CHART_MAX, maxVal.toString());

      if (appState.chartInstance) {
        appState.chartInstance.options.scales.y.suggestedMin = minVal;
        appState.chartInstance.options.scales.y.suggestedMax = maxVal;
        appState.chartInstance.update();
      }

      logger.add("success", `グラフ目盛り（Y軸）範囲を更新しました [${minVal}℃ 〜 ${maxVal}℃]`, {
        suggestedMin: minVal,
        suggestedMax: maxVal
      });

      debouncedSyncConfigToCloud();
      alert(`グラフ目盛りを「${minVal}℃ 〜 ${maxVal}℃」に設定しました。`);
    });
  }

  // ☀️ 外気温センサー設定セレクトボックスの変更イベントリスナー
  if (elements.outdoorMeterSelect) {
    elements.outdoorMeterSelect.addEventListener("change", (e) => {
      const newMeterId = e.target.value;
      appState.outdoorMeterId = newMeterId;
      if (newMeterId) {
        localStorage.setItem(STORAGE_KEYS.OUTDOOR_METER_ID, newMeterId);
      } else {
        localStorage.removeItem(STORAGE_KEYS.OUTDOOR_METER_ID);
      }

      updateOutdoorMeterSettingsUI();

      // UIカードとグラフを即座に同期再描画
      renderThermometerCards(appState.meterDataCache, false);
      updateTempChart();

      logger.add("success", `☀️ 外気温センサー設定を変更しました`, {
        outdoorMeterId: newMeterId || "なし",
        outdoorMeterMac: formatMacAddress(newMeterId)
      });

      debouncedSyncConfigToCloud();
    });
  }

  elements.btnFetchDevices.addEventListener("click", () => {
    const token = elements.sbTokenInput.value.trim();
    const secret = elements.sbSecretInput.value.trim();
    if (!token || !secret) {
      alert("TokenとSecretを入力してください。");
      return;
    }
    appState.token = token;
    appState.secret = secret;
    fetchDevicesAndStatus();
  });

  elements.refreshBtn.addEventListener("click", () => {
    logger.add("info", "手動リフレッシュ要求を受け付けました");
    fetchDevicesAndStatus();
  });

  elements.btnSendCustomAircon.addEventListener("click", () => {
    const cfg = appState.airconConfig;
    const modeName = MODE_NAMES[cfg.mode] || "冷房";
    const fanName = FAN_NAMES[cfg.fan] || "自動";

    if (!confirm(`以下の設定でエアコンに赤外線信号を送信します。よろしいですか？\n\n・設定温度: ${cfg.temp}℃\n・運転モード: ${modeName}\n・風量: ${fanName}`)) {
      return;
    }

    const parameter = `${cfg.temp},${cfg.mode},${cfg.fan},on`;
    sendAirconCommand("setAll", parameter, `${modeName} ${cfg.temp}℃`);
  });

  elements.btnAirconOff.addEventListener("click", () => {
    if (!confirm("エアコンを停止 (OFF) します。よろしいですか？")) return;
    sendAirconCommand("turnOff", "default", "停止 (OFF)");
  });

  elements.keepAliveToggle.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    if (enabled) {
      if (!confirm(`【確認】1時間おきに「${MODE_NAMES[appState.airconConfig.mode]} ${appState.airconConfig.temp}℃」の信号を自動送信します。\n稼働させてよろしいですか？`)) {
        e.target.checked = false;
        return;
      }
    }
    localStorage.setItem(STORAGE_KEYS.KEEP_ALIVE, enabled ? "true" : "false");
    updateKeepAliveUI(enabled);
    logger.add("warn", `キープアライブ設定変更: [${enabled ? "稼働開始" : "安全停止"}]`, {
      enabled: enabled,
      interval: "1 hour (3600000ms)",
      targetConfig: appState.airconConfig
    });
  });

  elements.btnShutterOpen.addEventListener("click", () => controlShutter("open"));
  elements.btnShutterClose.addEventListener("click", () => controlShutter("close"));
}

/**
 * 保存された並び順（meterOrder）に従って温度計リストをソート
 */
function sortMetersByOrder(meters) {
  if (!meters || !Array.isArray(meters) || meters.length <= 1) return meters;
  if (!appState.meterOrder || appState.meterOrder.length === 0) return meters;

  return [...meters].sort((a, b) => {
    const idA = a.deviceId || (a.device && a.device.deviceId) || "";
    const idB = b.deviceId || (b.device && b.device.deviceId) || "";
    let idxA = appState.meterOrder.indexOf(idA);
    let idxB = appState.meterOrder.indexOf(idB);
    if (idxA === -1) idxA = 999;
    if (idxB === -1) idxB = 999;
    return idxA - idxB;
  });
}

/**
 * ☁️ クラウド同期ステータスUIの更新
 */
function updateCloudSyncStatus(status, text) {
  if (!elements.cloudSyncBadge || !elements.cloudSyncText) return;
  elements.cloudSyncBadge.classList.remove("sync-active", "sync-error");

  if (status === "syncing") {
    elements.cloudSyncBadge.classList.add("sync-active");
    elements.cloudSyncText.textContent = text || "同期中...";
  } else if (status === "error") {
    elements.cloudSyncBadge.classList.add("sync-error");
    elements.cloudSyncText.textContent = text || "同期エラー";
  } else if (status === "success") {
    elements.cloudSyncText.textContent = text || "同期完了";
  } else {
    elements.cloudSyncText.textContent = text || "クラウド同期";
  }
}

let syncDebounceTimer = null;
function debouncedSyncConfigToCloud() {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncConfigToCloud(false);
  }, 1200);
}

/**
 * ☁️ 現在のローカル設定（並び順・色・外気温設定・目盛り）および認証キーをCloudflare KVに保存
 */
async function syncConfigToCloud(isManual = false) {
  updateCloudSyncStatus("syncing", "クラウド保存中...");

  const payload = {
    config: {
      meterOrder: appState.meterOrder || [],
      meterColors: appState.meterColors || {},
      outdoorMeterId: appState.outdoorMeterId || "",
      chartMinTemp: appState.chartMinTemp,
      chartMaxTemp: appState.chartMaxTemp
    },
    credentials: {
      token: appState.token || "",
      secret: appState.secret || ""
    },
    devices: appState.devices || []
  };

  try {
    const res = await fetch("/api/sync/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-switchbot-token": appState.token || "",
        "x-switchbot-secret": appState.secret || ""
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data && data.success) {
      updateCloudSyncStatus("success", "同期完了");
      localStorage.setItem(STORAGE_KEYS.LAST_CLOUD_SYNC, Date.now().toString());
      logger.add("success", "設定をクラウド(KV)へ保存しました", {
        meterOrderCount: (payload.config.meterOrder || []).length,
        colorsCount: Object.keys(payload.config.meterColors || {}).length,
        outdoorMeterId: payload.config.outdoorMeterId || "none"
      });
      if (isManual) {
        alert("現在の設定（並び順・色・外気温指定など）をクラウドに保存しました。\nパートナー様の端末でも自動共有されます。");
      }
    } else {
      updateCloudSyncStatus("error", "保存失敗");
      logger.add("warn", "クラウドへの設定保存に応答エラーがありました", data);
      if (isManual) alert("クラウド保存に失敗しました: " + (data && data.error ? data.error : "不明なエラー"));
    }
  } catch (err) {
    updateCloudSyncStatus("error", "通信エラー");
    logger.add("error", "クラウド同期通信に失敗しました: " + err.message);
    if (isManual) alert("通信エラーが発生しました: " + err.message);
  }
}

/**
 * ☁️ Cloudflare KVから共有設定（並び順・色・外気温設定・目盛り）を取得してUIに反映
 */
async function fetchSharedConfig(isManual = false) {
  updateCloudSyncStatus("syncing", "設定読込中...");

  try {
    const res = await fetch("/api/sync/config", {
      headers: {
        "x-switchbot-token": appState.token || "",
        "x-switchbot-secret": appState.secret || ""
      }
    });

    const data = await res.json();
    if (data && data.success && data.config) {
      const cfg = data.config;
      let changed = false;

      if (Array.isArray(cfg.meterOrder) && cfg.meterOrder.length > 0) {
        appState.meterOrder = cfg.meterOrder;
        localStorage.setItem(STORAGE_KEYS.METER_ORDER, JSON.stringify(cfg.meterOrder));
        changed = true;
      }

      if (cfg.meterColors && typeof cfg.meterColors === "object") {
        appState.meterColors = cfg.meterColors;
        localStorage.setItem(STORAGE_KEYS.METER_COLORS, JSON.stringify(cfg.meterColors));
        changed = true;
      }

      if (cfg.outdoorMeterId !== undefined) {
        appState.outdoorMeterId = cfg.outdoorMeterId;
        if (cfg.outdoorMeterId) {
          localStorage.setItem(STORAGE_KEYS.OUTDOOR_METER_ID, cfg.outdoorMeterId);
        } else {
          localStorage.removeItem(STORAGE_KEYS.OUTDOOR_METER_ID);
        }
        changed = true;
      }

      if (typeof cfg.chartMinTemp === "number" && typeof cfg.chartMaxTemp === "number") {
        appState.chartMinTemp = cfg.chartMinTemp;
        appState.chartMaxTemp = cfg.chartMaxTemp;
        localStorage.setItem(STORAGE_KEYS.CHART_MIN, cfg.chartMinTemp.toString());
        localStorage.setItem(STORAGE_KEYS.CHART_MAX, cfg.chartMaxTemp.toString());
        if (elements.chartMinTempInput) elements.chartMinTempInput.value = cfg.chartMinTemp;
        if (elements.chartMaxTempInput) elements.chartMaxTempInput.value = cfg.chartMaxTemp;
        if (appState.chartInstance && appState.chartInstance.options.scales.y) {
          appState.chartInstance.options.scales.y.suggestedMin = cfg.chartMinTemp;
          appState.chartInstance.options.scales.y.suggestedMax = cfg.chartMaxTemp;
        }
        changed = true;
      }

      if (changed) {
        updateOutdoorMeterSettingsUI();
        updateColorSettingsInModal();
        if (appState.meterDataCache && appState.meterDataCache.length > 0) {
          renderThermometerCards(appState.meterDataCache, false);
        }
        updateTempChart();
      }

      updateCloudSyncStatus("success", "同期完了");
      logger.add("success", "クラウド(KV)から共有設定を読み込み反映しました", cfg);
      if (isManual) {
        alert("クラウドから最新の共有設定を読み込み、画面に反映しました。");
      }
    } else {
      updateCloudSyncStatus("idle", "クラウド同期");
      if (isManual) alert("クラウドに保存された共有設定がまだありません。");
    }
  } catch (err) {
    updateCloudSyncStatus("error", "読込失敗");
    logger.add("warn", "クラウド設定の取得をスキップしました: " + err.message);
  }
}

/**
 * ☁️ Cloudflare KVから24時間蓄積された温度履歴を取得・ローカルと統合
 */
async function fetchCloudTempHistory() {
  try {
    const res = await fetch("/api/sync/history", {
      headers: {
        "x-switchbot-token": appState.token || "",
        "x-switchbot-secret": appState.secret || ""
      }
    });

    const data = await res.json();
    if (data && data.success && Array.isArray(data.history) && data.history.length > 0) {
      const timeMap = new Map();

      // ローカル履歴をマップに登録
      (appState.tempHistory || []).forEach(h => {
        const key = h.ts || h.time;
        if (key) timeMap.set(key, h);
      });

      // クラウド履歴をマージ（重複はタイムスタンプで一意化）
      data.history.forEach(h => {
        const key = h.ts || h.time;
        if (key) {
          timeMap.set(key, { ...(timeMap.get(key) || {}), ...h, ts: key, time: key });
        }
      });

      const merged = Array.from(timeMap.values()).sort((a, b) => (a.ts || a.time) - (b.ts || b.time));
      appState.tempHistory = merged.slice(-1008); // 直近7日分保持
      localStorage.setItem(STORAGE_KEYS.TEMP_HISTORY, JSON.stringify(appState.tempHistory));

      updateTempChart();
      logger.add("success", `クラウドから温度履歴を取得・統合しました (${data.history.length}件)`, {
        totalMergedRecords: appState.tempHistory.length
      });
    }
  } catch (err) {
    logger.add("warn", "クラウド温度履歴の取得をスキップしました: " + err.message);
  }
}

/**
 * 📊 内外温度差分析用 CSVエクスポート機能
 */
function exportTempHistoryCsv() {
  if (!appState.tempHistory || appState.tempHistory.length === 0) {
    alert("エクスポート可能な温度履歴データがまだありません。");
    return;
  }

  // 表示対象の温度計一覧を特定（並び順を尊重）
  let meters = (appState.thermometers && appState.thermometers.length > 0) 
    ? appState.thermometers 
    : (appState.meterDataCache || []).map(m => m.device);

  if (!meters || meters.length === 0) {
    const foundIds = new Set();
    appState.tempHistory.forEach(h => {
      if (h.readings) {
        Object.keys(h.readings).forEach(id => foundIds.add(id));
      }
    });
    meters = Array.from(foundIds).map(id => ({ deviceId: id, deviceName: id }));
  }

  meters = sortMetersByOrder(meters);

  const outdoorId = appState.outdoorMeterId;
  const outdoorMeter = meters.find(m => m.deviceId === outdoorId);

  // CSVヘッダーの生成
  const headerCols = ["日時", "タイムスタンプ(ms)"];

  meters.forEach(meter => {
    const isOutdoor = (meter.deviceId === outdoorId);
    const prefix = isOutdoor ? `[外気] ${meter.deviceName}` : meter.deviceName;
    headerCols.push(`"${prefix} 温度(℃)"`);
    headerCols.push(`"${prefix} 湿度(%)"`);
  });

  // 外気温センサーが存在する場合、内外温度差（各室内棚 - 外気）の列を追加
  if (outdoorMeter) {
    meters.forEach(meter => {
      if (meter.deviceId !== outdoorId) {
        headerCols.push(`"内外温度差 [${meter.deviceName} - 外気](℃)"`);
      }
    });
  }

  const csvRows = [headerCols.join(",")];

  // データ行の生成
  appState.tempHistory.forEach(record => {
    const epoch = record.ts || record.time || 0;
    const d = new Date(epoch);
    const dateStr = !isNaN(d.getTime()) 
      ? `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      : record.label || "--";

    const row = [`"${dateStr}"`, epoch];

    let outdoorTemp = null;
    if (outdoorId && record.readings && record.readings[outdoorId]) {
      const oReading = record.readings[outdoorId];
      outdoorTemp = typeof oReading.temp === "number" ? oReading.temp : null;
    }

    meters.forEach(meter => {
      const r = record.readings ? record.readings[meter.deviceId] : null;
      const t = (r && typeof r.temp === "number") ? r.temp : "";
      const h = (r && typeof r.humidity === "number") ? r.humidity : "";
      row.push(t);
      row.push(h);
    });

    // 内外温度差の算出
    if (outdoorMeter) {
      meters.forEach(meter => {
        if (meter.deviceId !== outdoorId) {
          const r = record.readings ? record.readings[meter.deviceId] : null;
          const indoorTemp = (r && typeof r.temp === "number") ? r.temp : null;
          if (indoorTemp !== null && outdoorTemp !== null) {
            const diff = (indoorTemp - outdoorTemp).toFixed(2);
            row.push(diff);
          } else {
            row.push("");
          }
        }
      });
    }

    csvRows.push(row.join(","));
  });

  // UTF-8 BOM付きCSVを作成（Excelで日本語が文字化けしない対策）
  const csvContent = "\uFEFF" + csvRows.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const fileDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const filename = `kuwagata_temp_history_${fileDate}.csv`;

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  logger.add("success", `内外温度差分析用CSVをダウンロードしました: [${filename}]`, {
    filename: filename,
    recordsCount: appState.tempHistory.length,
    metersCount: meters.length,
    hasOutdoorSensor: !!outdoorMeter
  });
}

/**
 * 現在のDOMカード並び順をlocalStorageに保存
 */
function saveCurrentCardOrder() {
  const currentCards = elements.thermometerGrid.querySelectorAll(".sensor-card");
  const newOrder = [...currentCards].map(c => c.dataset.id).filter(Boolean);
  appState.meterOrder = newOrder;
  localStorage.setItem(STORAGE_KEYS.METER_ORDER, JSON.stringify(newOrder));

  // メーター配列とキャッシュを並び替え
  if (appState.thermometers && appState.thermometers.length > 0) {
    appState.thermometers = sortMetersByOrder(appState.thermometers);
  }
  if (appState.meterDataCache && appState.meterDataCache.length > 0) {
    appState.meterDataCache = sortMetersByOrder(appState.meterDataCache);
  }
  updateTempChart();

  logger.add("info", "温度計カードの位置（並び順）を保存しました", {
    newOrder: newOrder
  });

  // ☁️ クラウドへ自動同期
  debouncedSyncConfigToCloud();
}

/**
 * 🎨 設定モーダル内の温度計カラー設定UIを更新
 */
function updateColorSettingsInModal() {
  if (!elements.meterColorSettingsList) return;

  const meters = (appState.thermometers && appState.thermometers.length > 0)
    ? appState.thermometers
    : (appState.meterDataCache || []).map(m => m.device);

  if (!meters || meters.length === 0) {
    elements.meterColorSettingsList.innerHTML = `<div style="font-size: 0.8rem; color: var(--text-muted); padding: 6px;">検出された温度計がありません</div>`;
    return;
  }

  const sortedMeters = sortMetersByOrder(meters);
  let html = "";

  sortedMeters.forEach((meter, idx) => {
    const devId = meter.deviceId;
    const colorCfg = getMeterColorConfig(devId, idx);
    const currentColor = appState.meterColors[devId] || colorCfg.border;
    const isOutdoor = (devId === appState.outdoorMeterId);
    const badgeText = isOutdoor ? "☀️ 外気" : `センサー #${idx + 1}`;

    html += `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.03); gap: 8px;">
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${currentColor}; box-shadow: 0 0 6px ${currentColor}; flex-shrink: 0;"></span>
          <span style="font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(meter.deviceName)}</span>
          <span style="font-size: 0.7rem; color: #94a3b8; background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px;">${badgeText}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
          ${PRESET_COLORS.map(pColor => `
            <button type="button" class="preset-color-btn" data-id="${devId}" data-color="${pColor}" style="width: 18px; height: 18px; border-radius: 50%; background: ${pColor}; border: ${pColor.toLowerCase() === currentColor.toLowerCase() ? "2px solid #fff" : "1px solid rgba(255,255,255,0.3)"}; cursor: pointer; padding: 0;" title="${pColor}"></button>
          `).join("")}
          <label style="cursor: pointer; margin-left: 4px; display: flex; align-items: center;" title="自由色選択">
            <input type="color" class="modal-color-input" data-id="${devId}" value="${currentColor}" style="opacity: 0; width: 0; height: 0; position: absolute;">
            <span style="font-size: 0.85rem; padding: 2px 4px; border-radius: 4px; background: rgba(255,255,255,0.1); line-height: 1;">🎨</span>
          </label>
        </div>
      </div>
    `;
  });

  elements.meterColorSettingsList.innerHTML = html;

  // プリセットボタンクリック
  elements.meterColorSettingsList.querySelectorAll(".preset-color-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const devId = btn.dataset.id;
      const color = btn.dataset.color;
      appState.meterColors[devId] = color;
      localStorage.setItem(STORAGE_KEYS.METER_COLORS, JSON.stringify(appState.meterColors));
      updateColorSettingsInModal();
      renderThermometerCards(appState.meterDataCache, false);
      updateTempChart();
      logger.add("success", `温度計カラーを変更しました: [${color}]`, { deviceId: devId, color: color });
      debouncedSyncConfigToCloud();
    });
  });

  // カスタムカラー入力
  elements.meterColorSettingsList.querySelectorAll(".modal-color-input").forEach(input => {
    input.addEventListener("input", (e) => {
      const devId = input.dataset.id;
      const color = e.target.value;
      appState.meterColors[devId] = color;
      localStorage.setItem(STORAGE_KEYS.METER_COLORS, JSON.stringify(appState.meterColors));
      renderThermometerCards(appState.meterDataCache, false);
      updateTempChart();
    });
    input.addEventListener("change", (e) => {
      updateColorSettingsInModal();
      logger.add("success", `温度計カスタムカラーを保存しました: [${e.target.value}]`, { deviceId: input.dataset.id, color: e.target.value });
      debouncedSyncConfigToCloud();
    });
  });
}

/**
 * ☀️ 外気温センサー設定セレクトボックスの選択肢＆現在の選択状態を更新（トップレベル関数）
 */
function updateOutdoorMeterSettingsUI() {
  if (!elements.outdoorMeterSelect) return;

  // 現在取得できている温度計リスト
  const allMeters = (appState.devices || []).filter(d => 
    (d.deviceType.includes("Meter") || d.deviceType.includes("Sensor") || d.deviceType.includes("Hub")) &&
    !appState.excludedDeviceIds.includes(d.deviceId)
  );

  // キャッシュやthermometersも含めてユニーク化
  const meterMap = new Map();
  (appState.thermometers || []).forEach(m => meterMap.set(m.deviceId, m));
  (appState.meterDataCache || []).forEach(m => meterMap.set(m.device.deviceId, m.device));
  allMeters.forEach(m => meterMap.set(m.deviceId, m));

  // もし既定の E9D8AF0D85F9 がまだリストに無ければ補完登録
  if (appState.outdoorMeterId && !meterMap.has(appState.outdoorMeterId)) {
    meterMap.set(appState.outdoorMeterId, {
      deviceId: appState.outdoorMeterId,
      deviceName: "作業場温湿時計 (外気温)"
    });
  }

  let selectHtml = `<option value="">（設定なし / 全て飼育室内の左軸として表示）</option>`;
  meterMap.forEach(meter => {
    const mac = formatMacAddress(meter.deviceId);
    const isSelected = (meter.deviceId === appState.outdoorMeterId);
    selectHtml += `<option value="${meter.deviceId}" ${isSelected ? "selected" : ""}>${escapeHtml(meter.deviceName)} [${mac}]</option>`;
  });

  elements.outdoorMeterSelect.innerHTML = selectHtml;

  // 現在の選択ラベル表示
  const currentSelectedMeter = meterMap.get(appState.outdoorMeterId);
  if (currentSelectedMeter) {
    const formattedMac = formatMacAddress(currentSelectedMeter.deviceId);
    if (elements.outdoorMeterCurrentName) elements.outdoorMeterCurrentName.textContent = currentSelectedMeter.deviceName;
    if (elements.outdoorMeterMacBadge) {
      elements.outdoorMeterMacBadge.innerHTML = `BLE MAC: <span>${formattedMac}</span> <button type="button" class="btn-copy-mac" data-mac="${formattedMac}" data-name="${escapeHtml(currentSelectedMeter.deviceName)}" title="BLE MACをクリップボードにコピー">📋 コピー</button>`;
    }
  } else {
    if (elements.outdoorMeterCurrentName) elements.outdoorMeterCurrentName.textContent = "未設定 (全て室内)";
    if (elements.outdoorMeterMacBadge) elements.outdoorMeterMacBadge.textContent = "";
  }
}

function applyOrientationMode(mode) {
  document.body.classList.remove("force-portrait", "force-landscape");

  if (mode === "portrait") {
    document.body.classList.add("force-portrait");
    elements.orientationIcon.textContent = "📱";
    elements.orientationLabel.textContent = "縦固定";
  } else if (mode === "landscape") {
    document.body.classList.add("force-landscape");
    elements.orientationIcon.textContent = "🖥️";
    elements.orientationLabel.textContent = "横固定";
  } else {
    elements.orientationIcon.textContent = "🔄";
    elements.orientationLabel.textContent = "自動";
  }
}

async function callProxyApi(endpoint, options = {}) {
  const method = options.method || "GET";
  const headers = options.headers || {};
  headers["x-switchbot-token"] = appState.token;
  headers["x-switchbot-secret"] = appState.secret;
  if (!headers["Content-Type"] && method === "POST") {
    headers["Content-Type"] = "application/json";
  }
  options.headers = headers;

  try {
    const response = await fetch(endpoint, options);
    const resData = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errMsg = resData.error || `HTTP ${response.status}`;
      throw new Error(errMsg);
    }
    return resData;
  } catch (err) {
    logger.add("error", `API通信失敗: ${err.message}`);
    throw err;
  }
}

/**
 * デバイス一覧の取得と自動分類
 */
async function fetchDevicesAndStatus() {
  updateStatus("デバイス同期中...", false);
  logger.add("info", "SwitchBot デバイス一覧を取得中...", {
    endpoint: "/api/switchbot?action=devices",
    mode: "Cloud API v1.1"
  });

  try {
    const data = await callProxyApi("/api/switchbot?action=devices");
    if (data.statusCode !== 100 && !data.body) {
      throw new Error(data.message || "デバイス取得に失敗しました");
    }

    const deviceList = data.body.deviceList || [];
    const infraredRemoteList = data.body.infraredRemoteList || [];

    appState.devices = deviceList;
    appState.infraredDevices = infraredRemoteList;
    localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(deviceList));

    appState.thermometers = deviceList.filter(d => 
      (d.deviceType.includes("Meter") || d.deviceType.includes("Sensor") || d.deviceType.includes("Hub")) &&
      !appState.excludedDeviceIds.includes(d.deviceId)
    );

    appState.cameras = deviceList.filter(d => 
      d.deviceType.includes("Cam") &&
      !appState.excludedDeviceIds.includes(d.deviceId)
    );

    const aircon = infraredRemoteList.find(d => d.remoteType === "Air Conditioner");
    if (aircon) {
      localStorage.setItem(STORAGE_KEYS.AIRCON_ID, aircon.deviceId);
    }

    logger.add("success", `SwitchBot デバイス一覧を取得しました (${deviceList.length}台)`, {
      totalPhysicalDevices: deviceList.length,
      totalInfraredRemotes: infraredRemoteList.length,
      activeThermometers: appState.thermometers.length,
      activeCameras: appState.cameras.length,
      excludedDevicesCount: appState.excludedDeviceIds.length,
      airconDetected: !!aircon,
      devicesSummary: deviceList.map((d, i) => ({
        index: i + 1,
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        deviceType: d.deviceType,
        hubDeviceId: d.hubDeviceId || "none"
      }))
    });

    renderDeviceListModal(deviceList, infraredRemoteList);
    renderCameraCards(appState.cameras);

    // ☁️ デバイス一覧情報をクラウド(KV)へ同期（Cron自動記録用）
    syncConfigToCloud(false);

    await refreshThermometers();
    updateStatus("オンライン (正常)", false);
  } catch (err) {
    console.error("Fetch devices error:", err);
    updateStatus(`接続エラー: ${err.message}`, true);
    logger.add("error", `デバイス一覧の取得に失敗しました: ${err.message}`, {
      errorName: err.name,
      message: err.message
    });
    elements.deviceListContainer.innerHTML = `<div style="color: var(--accent-red); padding: 8px 0;">エラー: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * ⚡ 全温度計のステータス取得（並列リクエスト＋時系列履歴保存＋グラフ更新）
 */
async function refreshThermometers() {
  if (appState.thermometers.length === 0) {
    elements.thermometerGrid.innerHTML = `
      <div class="sensor-card empty-guide">
        表示対象の温度計デバイスがありません。「設定」からAPIキーを確認してください。
      </div>`;
    return;
  }

  const prevTime = appState.lastUpdatedText;
  elements.lastUpdated.innerHTML = `前回: <strong>${prevTime}</strong> <span style="color: var(--accent-blue); font-size: 0.78rem;">🔄 最新データを取得中...</span>`;

  logger.add("info", `温湿度計ステータス並列取得開始 (${appState.thermometers.length}台)`, {
    targetMeters: appState.thermometers.map(m => ({ id: m.deviceId, name: m.deviceName }))
  });

  // 並列取得
  const fetchPromises = appState.thermometers.map(async (meter) => {
    try {
      const res = await callProxyApi(`/api/switchbot?action=status&deviceId=${meter.deviceId}`);
      return {
        device: meter,
        status: res.body || { temperature: "--", humidity: "--", battery: "--" }
      };
    } catch (e) {
      return {
        device: meter,
        status: { temperature: "--", humidity: "--", battery: "--", error: e.message }
      };
    }
  });

  const results = await Promise.all(fetchPromises);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("ja-JP");
  appState.meterDataCache = results;
  appState.lastUpdatedText = timeStr;
  localStorage.setItem(STORAGE_KEYS.LAST_METER_DATA, JSON.stringify(results));
  localStorage.setItem(STORAGE_KEYS.LAST_METER_TIME, timeStr);

  // 📈 時系列履歴に記録
  recordTempHistory(results, now);

  renderThermometerCards(results, true);
  updateTempChart(); // グラフを即座に更新

  elements.lastUpdated.innerHTML = `最終取得: <strong>${timeStr}</strong> <span style="color: var(--accent-green); font-size: 0.75rem;">(最新)</span>`;
  
  logger.add("success", `全温湿度計データ取得完了 (${timeStr})`, {
    timestamp: timeStr,
    meterCount: results.length,
    readings: results.map(r => ({
      name: r.device.deviceName,
      deviceId: r.device.deviceId,
      temperature: r.status.temperature !== "--" ? `${r.status.temperature}℃` : "取得失敗",
      humidity: r.status.humidity !== "--" ? `${r.status.humidity}%` : "取得失敗",
      battery: r.status.battery !== "--" ? `${r.status.battery}%` : "取得失敗"
    }))
  });
}

/**
 * 📈 温度時系列履歴の蓄積
 */
function recordTempHistory(results, timestampDate) {
  const timeLabel = timestampDate.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const timeEpoch = timestampDate.getTime();

  const record = {
    ts: timeEpoch,
    time: timeEpoch,
    label: timeLabel,
    readings: {}
  };

  results.forEach(r => {
    if (typeof r.status.temperature === "number") {
      record.readings[r.device.deviceId] = {
        temp: r.status.temperature,
        humidity: typeof r.status.humidity === "number" ? r.status.humidity : null,
        name: r.device.deviceName
      };
    }
  });

  appState.tempHistory.push(record);

  // 最大1008件まで保持（直近7日分: 10分おき = 1日144件 x 7日）
  if (appState.tempHistory.length > 1008) {
    appState.tempHistory.shift();
  }

  localStorage.setItem(STORAGE_KEYS.TEMP_HISTORY, JSON.stringify(appState.tempHistory));

  // ☁️ クラウドへ最新測定値を非同期送信（バックグラウンド）
  try {
    fetch("/api/sync/history", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-switchbot-token": appState.token || "",
        "x-switchbot-secret": appState.secret || ""
      },
      body: JSON.stringify({ entry: record })
    }).catch(() => {});
  } catch (e) {}
}

/**
 * 📡 エアコン送信イベントの記録
 */
function recordAirconEvent(type, desc, temp) {
  const now = new Date();
  const timeEpoch = now.getTime();
  const timeStr = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const labelStr = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  const eventItem = {
    id: `ev_${timeEpoch}`,
    ts: timeEpoch,
    timeStr: timeStr,
    label: labelStr,
    type: type, // "manual" | "keepalive" | "off"
    desc: desc,
    temp: temp
  };

  if (!Array.isArray(appState.airconEvents)) {
    appState.airconEvents = [];
  }
  appState.airconEvents.push(eventItem);

  // 最大100件まで保持
  if (appState.airconEvents.length > 100) {
    appState.airconEvents.shift();
  }

  localStorage.setItem(STORAGE_KEYS.AIRCON_EVENTS, JSON.stringify(appState.airconEvents));

  // もし履歴が1件もない場合、現在時刻で基点データを作成してグラフ描画を確実にする
  if (!appState.tempHistory || appState.tempHistory.length === 0) {
    appState.tempHistory = [];
    const defaultPoint = {
      ts: timeEpoch,
      label: labelStr,
      readings: {}
    };
    if (appState.meterDataCache && appState.meterDataCache.length > 0) {
      appState.meterDataCache.forEach(r => {
        if (r.device && typeof r.status?.temperature === "number") {
          defaultPoint.readings[r.device.deviceId] = { temp: r.status.temperature, name: r.device.deviceName };
        }
      });
    }
    appState.tempHistory.push(defaultPoint);
    localStorage.setItem(STORAGE_KEYS.TEMP_HISTORY, JSON.stringify(appState.tempHistory));
  }

  // グラフを即座に再描画してマーカーピンを反映
  updateTempChart();

  logger.add("info", `グラフ用エアコン送信イベントを記録: [${desc}]`, {
    eventType: type,
    timestamp: timeStr,
    totalEventsCount: appState.airconEvents.length
  });
}

function initTempChart() {
  if (!elements.tempChartCanvas) return;
  const ctx = elements.tempChartCanvas.getContext("2d");

  // ❄️ エアコン送信イベント描画カスタムプラグイン
  const airconEventPlugin = {
    id: "airconEventPlugin",
    afterDatasetsDraw(chart) {
      if (!chart.data || !chart.data.labels || chart.data.labels.length === 0) return;
      const totalLabels = chart.data.labels.length;

      // オプションからイベントリストを取得（フォールバックでappState参照）
      const events = (chart.options && chart.options.plugins && chart.options.plugins.airconEventsList) ||
                     (chart.config && chart.config.options && chart.config.options.plugins && chart.config.options.plugins.airconEventsList) ||
                     (appState.airconEvents || []);

      if (!events || events.length === 0) {
        appState.renderedAirconPins = [];
        return;
      }

      // 描画ピンのリストを初期化（クリック判定用）
      appState.renderedAirconPins = [];

      const { ctx, chartArea: { top, bottom, left, right }, scales: { x } } = chart;

      events.forEach((ev, evIdx) => {
        // 🎯 核心修正: getPixelForTick ではなく getPixelForValue を使用
        let xPos = null;

        if (typeof ev.nearestIndex === "number" && ev.nearestIndex >= 0 && ev.nearestIndex < totalLabels) {
          xPos = x.getPixelForValue(ev.nearestIndex);
        } else if (ev.label) {
          const labelIdx = chart.data.labels.findIndex(l => l === ev.label);
          if (labelIdx !== -1) {
            xPos = x.getPixelForValue(labelIdx);
          }
        }

        // それでも見つからない場合、最新点（右端）にフォールバック
        if (xPos === null || isNaN(xPos)) {
          xPos = x.getPixelForValue(totalLabels - 1);
        }

        if (xPos === null || isNaN(xPos)) return;

        // グラフ描画領域内にクランプ
        if (xPos < left) xPos = left;
        if (xPos > right) xPos = right;

        ctx.save();

        // 線の色とスタイルの決定
        let lineColor = "rgba(56, 189, 248, 0.85)"; // 青 (手動送信)
        let pinIcon = "❄️";
        let badgeBg = "rgba(14, 116, 144, 0.94)";
        let badgeText = "#38bdf8";

        if (ev.type === "keepalive") {
          lineColor = "rgba(192, 132, 252, 0.9)"; // 紫 (定期キープアライブ)
          pinIcon = "⏱️";
          badgeBg = "rgba(88, 28, 135, 0.94)";
          badgeText = "#e9d5ff";
        } else if (ev.type === "off") {
          lineColor = "rgba(244, 63, 94, 0.9)"; // 赤 (停止)
          pinIcon = "⏹️";
          badgeBg = "rgba(159, 18, 57, 0.94)";
          badgeText = "#fecdd3";
        }

        // 1. 縦の補助線 (点線) - 視認性を向上
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = lineColor;
        ctx.moveTo(xPos, top);
        ctx.lineTo(xPos, bottom);
        ctx.stroke();

        // 2. 上部イベントマーカーピン (ピンバッジ) - 送信内容が一目でわかるラベル
        const timeShort = ev.timeStr ? ev.timeStr.slice(0, 5) : (ev.label || "");
        let labelText = "";
        if (ev.type === "off") {
          labelText = `⏹️ 停止 [${timeShort}]`;
        } else if (ev.type === "keepalive") {
          labelText = `⏱️ 定期 ${ev.temp || 16}℃ [${timeShort}]`;
        } else {
          labelText = `❄️ 冷房 ${ev.temp || 16}℃ [${timeShort}]`;
        }

        ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, sans-serif";
        const textWidth = ctx.measureText(labelText).width;
        const boxWidth = textWidth + 14;
        const boxHeight = 20;

        // 左右がグラフ枠外にはみ出さないよう調整
        let boxX = xPos - boxWidth / 2;
        if (boxX < left + 2) boxX = left + 2;
        if (boxX + boxWidth > right - 2) boxX = right - boxWidth - 2;

        // 重なり防止の2段ずらし (偶数/奇数で高さをずらす)
        const boxY = (evIdx % 2 === 0) ? (top + 4) : (top + 26);

        // 背景ボックス (シャドウ付き角丸)
        ctx.setLineDash([]);
        ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = badgeBg;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 5);
        ctx.fill();
        ctx.stroke();

        // シャドウ解除してテキスト描画
        ctx.shadowColor = "transparent";
        ctx.fillStyle = badgeText;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, boxX + boxWidth / 2, boxY + boxHeight / 2);

        ctx.restore();

        // 📌 クリック/ホバー検出用バウンディングボックスの保存
        appState.renderedAirconPins.push({
          x: boxX,
          y: boxY,
          w: boxWidth,
          h: boxHeight,
          centerX: boxX + boxWidth / 2,
          bottomY: boxY + boxHeight,
          event: ev
        });
      });
    }
  };

  appState.chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: []
    },
    plugins: [airconEventPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        airconEventsList: [], // ここにフィルタリングされたイベントが渡される
        legend: {
          position: "top",
          labels: {
            color: "#cbd5e1",
            font: { size: 12, family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto" },
            boxWidth: 14,
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          titleColor: "#f8fafc",
          bodyColor: "#cbd5e1",
          borderColor: "#334155",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              const unit = " ℃";
              return ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}${unit}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          grid: { color: "rgba(255, 255, 255, 0.08)" },
          ticks: {
            color: "#94a3b8",
            callback: function(val) { return val + " ℃"; }
          },
          suggestedMin: appState.chartMinTemp,
          suggestedMax: appState.chartMaxTemp,
          title: {
            display: true,
            text: "飼育室 [左軸]",
            color: "#94a3b8",
            font: { size: 10, weight: "bold" }
          }
        },
        yOutdoor: {
          type: "linear",
          display: true,
          position: "right",
          grid: { drawOnChartArea: false }, // 左軸のグリッド線と重なって二重線になるのを防止
          ticks: {
            color: "#ef4444",
            callback: function(val) { return val + " ℃"; }
          },
          title: {
            display: true,
            text: "外気温 [右軸]",
            color: "#ef4444",
            font: { size: 10, weight: "bold" }
          }
        }
      }
    }
  });

  updateTempChart();
}

/**
 * 📈 グラフデータの更新（選択された期間でフィルタリング）
 */
function updateTempChart() {
  if (!appState.chartInstance) return;

  const hours = appState.selectedGraphHours;
  const now = Date.now();
  const filterCutoff = hours > 0 ? (now - hours * 3600 * 1000) : 0;

  // フィルタリングされた履歴
  const filteredHistory = appState.tempHistory.filter(h => h.ts >= filterCutoff);

  if (filteredHistory.length === 0) {
    // 履歴がまだない場合、前回のキャッシュから1点だけ作成
    if (appState.meterDataCache && appState.meterDataCache.length > 0) {
      const singlePoint = {
        ts: now,
        label: new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
        readings: {}
      };
      appState.meterDataCache.forEach(r => {
        if (typeof r.status.temperature === "number") {
          singlePoint.readings[r.device.deviceId] = { temp: r.status.temperature, name: r.device.deviceName };
        }
      });
      filteredHistory.push(singlePoint);
    }
  }

  const labels = filteredHistory.map(h => h.label);

  // 表示対象の温度計一覧（並び順順序を適用）
  const rawMeters = appState.thermometers.length > 0 ? appState.thermometers : (appState.meterDataCache || []).map(m => m.device);
  const meters = sortMetersByOrder(rawMeters);

  let hasVisibleOutdoor = false;

  const datasets = meters.map((meter, index) => {
    const isOutdoor = (meter.deviceId === appState.outdoorMeterId);
    const color = getMeterColorConfig(meter.deviceId, index);
    const dataPoints = filteredHistory.map(h => {
      const r = h.readings[meter.deviceId];
      return r ? r.temp : null;
    });

    // 役割ラベルの生成
    let labelName = meter.deviceName;
    if (isOutdoor) {
      labelName = `☀️ 外気温 (${meter.deviceName})`;
    } else if (labelName.includes("吹") || labelName.includes("エアコン")) {
      labelName = "❄️ 吹き出し口";
    } else if (labelName.includes("上")) {
      labelName = "棚・上段";
    } else if (labelName.includes("中")) {
      labelName = "棚・中段";
    } else if (labelName.includes("下")) {
      labelName = "棚・下段";
    }

    // 案Bの表示判定：
    // - soloMeterIdがある場合：そのmeterのみ表示
    // - soloMeterIdがない場合：hiddenMeterIdsに含まれていなければ表示
    let isHidden = false;
    if (appState.soloMeterId) {
      isHidden = (meter.deviceId !== appState.soloMeterId);
    } else {
      isHidden = appState.hiddenMeterIds.includes(meter.deviceId);
    }

    if (isOutdoor && !isHidden) {
      hasVisibleOutdoor = true;
    }

    if (isOutdoor) {
      // ☀️ 外気温専用データセット（右軸 yOutdoor・破線・カスタムカラー対応）
      return {
        label: labelName,
        data: dataPoints,
        yAxisID: "yOutdoor",
        borderColor: color.border,
        backgroundColor: color.bg,
        borderDash: [6, 4], // 室内棚と一目で区別できる点線
        borderWidth: 2.2,
        pointRadius: filteredHistory.length > 30 ? 0 : 3,
        pointHoverRadius: 6,
        tension: 0.25,
        fill: false,
        hidden: isHidden
      };
    }

    // 🏠 室内飼育用データセット（左軸 y・実線・カスタムカラー対応）
    return {
      label: labelName,
      data: dataPoints,
      yAxisID: "y",
      borderColor: color.border,
      backgroundColor: color.bg,
      borderDash: [],
      borderWidth: 2.5,
      pointRadius: filteredHistory.length > 30 ? 0 : 3,
      pointHoverRadius: 6,
      tension: 0.25,
      fill: false,
      hidden: isHidden // Chart.jsのデータセット非表示属性
    };
  });

  // 外気温が表示中であれば右軸を表示、非表示なら非表示。また折れ線色と右目盛り色を完全同期
  if (appState.chartInstance.options.scales && appState.chartInstance.options.scales.yOutdoor) {
    appState.chartInstance.options.scales.yOutdoor.display = hasVisibleOutdoor;
    const outdoorColor = getMeterColorConfig(appState.outdoorMeterId);
    appState.chartInstance.options.scales.yOutdoor.ticks.color = outdoorColor.border;
    appState.chartInstance.options.scales.yOutdoor.title.color = outdoorColor.border;
  }

  // フィルタリングされたエアコン送信イベント
  const totalLabels = labels.length;
  const filteredEvents = (appState.airconEvents || [])
    .filter(ev => ev.ts >= filterCutoff)
    .map(ev => {
      // 1. ラベル（文字列）の完全一致があるか
      const exactLabelIdx = labels.findIndex(l => l === ev.label);
      if (exactLabelIdx !== -1) {
        return { ...ev, nearestIndex: exactLabelIdx };
      }

      // 2. filteredHistory のタイムスタンプに基づくインデックス特定
      let nearestIdx = -1;
      let minDiff = Infinity;
      filteredHistory.forEach((h, i) => {
        const diff = Math.abs(h.ts - ev.ts);
        if (diff < minDiff) {
          minDiff = diff;
          nearestIdx = i;
        }
      });

      // 最新の測定データより新しいイベントの場合、右端（最新点）にスナップ
      if (filteredHistory.length > 0 && ev.ts >= filteredHistory[filteredHistory.length - 1].ts) {
        nearestIdx = filteredHistory.length - 1;
      }

      if (nearestIdx === -1 && totalLabels > 0) {
        nearestIdx = totalLabels - 1;
      }

      return {
        ...ev,
        nearestIndex: nearestIdx
      };
    });

  appState.chartInstance.data.labels = labels;
  appState.chartInstance.data.datasets = datasets;
  if (!appState.chartInstance.options.plugins) {
    appState.chartInstance.options.plugins = {};
  }
  appState.chartInstance.options.plugins.airconEventsList = filteredEvents;
  appState.chartInstance.update();

  // 🏷️ 直近の送信履歴クイックチップを更新
  renderAirconHistoryChips();
}

/**
 * 💬 エアコン送信イベント詳細ツールチップ（ポップオーバー）の表示
 */
function showAirconEventTooltip(ev, screenX = null, screenY = null) {
  if (!elements.airconEventTooltip || !ev) return;

  const isKeepAlive = ev.type === "keepalive";
  const isOff = ev.type === "off";

  let typeText = "❄️ 手動送信 (画面ボタン操作)";
  let badgeText = "❄️ エアコン手動送信";
  let tempText = `${ev.temp || 16} ℃`;

  if (isKeepAlive) {
    typeText = "⏱️ 1時間おき定期自動送信 (キープアライブ)";
    badgeText = "⏱️ 定期キープアライブ送信";
    tempText = `${ev.temp || 16} ℃`;
  } else if (isOff) {
    typeText = "⏹️ 停止コマンド送信";
    badgeText = "⏹️ エアコン停止";
    tempText = "停止 (電源OFF)";
  }

  if (elements.ttBadge) elements.ttBadge.textContent = badgeText;
  if (elements.ttTime) elements.ttTime.textContent = ev.timeStr ? `${ev.timeStr}` : (ev.label || "--");
  if (elements.ttType) elements.ttType.textContent = typeText;
  if (elements.ttTemp) elements.ttTemp.textContent = tempText;
  if (elements.ttDesc) elements.ttDesc.textContent = ev.desc || (isOff ? "エアコン運転停止" : `冷房 ${ev.temp || 16}℃ (自動)`);

  // 位置調整
  if (screenX !== null && screenY !== null && elements.tempChartCanvas) {
    const containerRect = elements.tempChartCanvas.parentElement.getBoundingClientRect();
    let left = screenX;
    let top = screenY + 14;

    if (left < 140) left = 140;
    if (left > containerRect.width - 140) left = containerRect.width - 140;

    elements.airconEventTooltip.style.left = `${left}px`;
    elements.airconEventTooltip.style.top = `${top}px`;
    elements.airconEventTooltip.style.transform = "translateX(-50%)";
  } else {
    // デフォルト中央配置
    elements.airconEventTooltip.style.left = "50%";
    elements.airconEventTooltip.style.top = "12px";
    elements.airconEventTooltip.style.transform = "translateX(-50%)";
  }

  elements.airconEventTooltip.classList.remove("hidden");

  logger.add("info", `エアコン送信詳細ツールチップを表示: [${ev.desc || typeText}]`, {
    eventType: ev.type,
    time: ev.timeStr,
    temp: ev.temp,
    desc: ev.desc
  });
}

/**
 * ツールチップ非表示
 */
function hideAirconEventTooltip() {
  if (elements.airconEventTooltip) {
    elements.airconEventTooltip.classList.add("hidden");
  }
}

/**
 * 🏷️ グラフ直下の直近エアコン送信履歴クイックチップを描画
 */
function renderAirconHistoryChips() {
  if (!elements.airconEventChips) return;

  const events = (appState.airconEvents || []).slice(-6).reverse(); // 直近6件を新しい順
  if (events.length === 0) {
    elements.airconEventChips.innerHTML = `<span style="color: var(--text-muted); font-size: 0.72rem;">まだ送信履歴がありません（操作するとピンと詳細が表示されます）</span>`;
    return;
  }

  let html = "";
  events.forEach((ev, idx) => {
    let chipClass = "aircon-chip";
    let icon = "❄️";
    let text = `冷房 ${ev.temp || 16}℃`;

    if (ev.type === "keepalive") {
      chipClass += " chip-keepalive";
      icon = "⏱️";
      text = `定期 ${ev.temp || 16}℃`;
    } else if (ev.type === "off") {
      chipClass += " chip-off";
      icon = "⏹️";
      text = "停止";
    }

    const timeShort = ev.timeStr ? ev.timeStr.slice(0, 5) : (ev.label || "");
    html += `
      <button type="button" class="${chipClass}" data-index="${idx}" title="クリックで詳細を表示">
        <span>${icon}</span>
        <span>${text}</span>
        <span style="opacity: 0.8; font-weight: normal;">[${timeShort}]</span>
      </button>
    `;
  });

  elements.airconEventChips.innerHTML = html;

  // 各チップにクリックイベントをバインド
  const chipBtns = elements.airconEventChips.querySelectorAll(".aircon-chip");
  chipBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      const targetEv = events[idx];
      if (targetEv) {
        showAirconEventTooltip(targetEv);
      }
    });
  });
}

let isDraggingActive = false; // ドラッグ操作中のカードクリック抑止フラグ
let draggedCardEl = null;

/**
 * 温度計カードを描画
 */
function renderThermometerCards(meterDataList, isFresh = true) {
  let html = "";
  const timeBadge = isFresh ? "" : `<span style="font-size: 0.7rem; color: var(--accent-amber); background: rgba(245, 158, 11, 0.1); padding: 1px 5px; border-radius: 4px;">前回保存値</span>`;

  // 保存された並び順でソート
  const sortedList = sortMetersByOrder(meterDataList);

  sortedList.forEach((item, index) => {
    const { device, status } = item;
    const temp = status.temperature !== undefined ? status.temperature : "--";
    const humidity = status.humidity !== undefined ? status.humidity : "--";
    const battery = status.battery !== undefined ? `${status.battery}%` : "--";

    const isOutdoor = (device.deviceId === appState.outdoorMeterId);
    let roleBadge = `センサー #${index + 1}`;
    if (isOutdoor) {
      roleBadge = "☀️ 外気温";
    } else if (device.deviceName.includes("吹") || device.deviceName.includes("エアコン")) {
      roleBadge = "❄️ 吹き出し口";
    } else if (device.deviceName.includes("上")) {
      roleBadge = "棚・上段";
    } else if (device.deviceName.includes("中")) {
      roleBadge = "棚・中段";
    } else if (device.deviceName.includes("下")) {
      roleBadge = "棚・下段";
    }

    // デバイス固有カスタム色または基本パレット色
    const color = getMeterColorConfig(device.deviceId, index);

    let tempColor = "var(--text-main)";
    if (typeof temp === "number") {
      if (temp >= 26) tempColor = "var(--accent-red)";
      else if (temp >= 24) tempColor = "var(--accent-amber)";
      else tempColor = color.border; // グラフ色と合わせた視認性の高い強調表示
    }

    // 案Bに基づくカード表示状態（通常 / 非表示 / 単独表示）
    let isCardSolo = (appState.soloMeterId === device.deviceId);
    let isCardMuted = false;
    let cardStateBadge = "";

    if (appState.soloMeterId) {
      if (appState.soloMeterId === device.deviceId) {
        cardStateBadge = `<span style="font-size: 0.68rem; background: #2563eb; color: #fff; padding: 1px 5px; border-radius: 4px; margin-left: 4px;">🎯 単独表示</span>`;
      } else {
        isCardMuted = true;
      }
    } else if (appState.hiddenMeterIds.includes(device.deviceId)) {
      isCardMuted = true;
      cardStateBadge = `<span style="font-size: 0.68rem; background: rgba(255,255,255,0.1); color: #94a3b8; padding: 1px 5px; border-radius: 4px; margin-left: 4px;">OFF</span>`;
    }

    const cardClasses = ["sensor-card"];
    if (isCardMuted) cardClasses.push("card-muted");
    if (isCardSolo) cardClasses.push("card-solo");

    const bleMacFormatted = formatMacAddress(device.deviceId);

    html += `
      <div class="${cardClasses.join(" ")}" data-id="${device.deviceId}" draggable="true" title="クリックで表示切替 (ON ➔ OFF ➔ 単独表示 ➔ 全表示) / ⠿をつまんで位置変更" style="background: ${color.cardBg}; border: 1.5px solid ${color.cardBorder}; box-shadow: 0 4px 14px rgba(0,0,0,0.35);">
        <input type="color" class="card-color-input" data-id="${device.deviceId}" value="${color.border}" style="opacity: 0; width: 0; height: 0; position: absolute; pointer-events: none;">
        <div class="sensor-header">
          <div class="sensor-name" style="color: #f8fafc; font-weight: 700; display: flex; align-items: center; gap: 5px;">
            <span class="drag-handle" data-id="${device.deviceId}" title="長押し・ドラッグして並び替え">⠿</span>
            <span class="color-dot-btn" data-id="${device.deviceId}" title="クリックして色を変更" style="display: inline-block; width: 11px; height: 11px; border-radius: 50%; background-color: ${color.border}; box-shadow: 0 0 6px ${color.border}; cursor: pointer; flex-shrink: 0;"></span>
            <span class="device-name-text" title="クリックでBLE MAC (${bleMacFormatted}) をコピー" style="cursor: pointer;">${escapeHtml(device.deviceName)}</span>
            <span class="mac-info-icon" data-mac="${bleMacFormatted}" data-name="${escapeHtml(device.deviceName)}" title="クリックでBLE MAC (${bleMacFormatted}) をコピー" style="cursor: pointer; opacity: 0.65; font-size: 0.72rem; padding: 0 2px;">📋</span>
            ${cardStateBadge}
          </div>
          <div style="display: flex; gap: 4px; align-items: center;">
            ${timeBadge}
            <span class="sensor-role" style="background: ${color.badgeBg}; color: ${color.badgeText}; border: 1px solid ${color.cardBorder};">${roleBadge}</span>
            <button type="button" class="btn-color-picker" data-id="${device.deviceId}" title="カラー変更">🎨</button>
          </div>
        </div>
        <div class="temp-display">
          <span class="temp-val" style="color: ${tempColor}; text-shadow: 0 0 10px ${color.bg};">${temp}</span>
          <span class="temp-unit">℃</span>
        </div>
        <div class="sensor-metrics" style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px;">
          <span>💧 湿度: <strong>${humidity}%</strong></span>
          <span>🔋 電池: <strong>${battery}</strong></span>
        </div>
      </div>
    `;
  });

  elements.thermometerGrid.innerHTML = html;

  // 🎨 カラーピッカーボタン & ドットクリック時
  const colorTriggers = elements.thermometerGrid.querySelectorAll(".btn-color-picker, .color-dot-btn");
  colorTriggers.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const devId = btn.dataset.id;
      const input = elements.thermometerGrid.querySelector(`.card-color-input[data-id="${devId}"]`);
      if (input) {
        input.click();
      }
    });
  });

  // 🎨 カラーピッカー入力イベント
  const colorInputs = elements.thermometerGrid.querySelectorAll(".card-color-input");
  colorInputs.forEach(input => {
    input.addEventListener("input", (e) => {
      const devId = input.dataset.id;
      const newHex = e.target.value;
      appState.meterColors[devId] = newHex;
      localStorage.setItem(STORAGE_KEYS.METER_COLORS, JSON.stringify(appState.meterColors));
      renderThermometerCards(appState.meterDataCache, false);
      updateTempChart();
    });
    input.addEventListener("change", (e) => {
      const devId = input.dataset.id;
      const newHex = e.target.value;
      appState.meterColors[devId] = newHex;
      localStorage.setItem(STORAGE_KEYS.METER_COLORS, JSON.stringify(appState.meterColors));
      renderThermometerCards(appState.meterDataCache, false);
      updateTempChart();
      updateColorSettingsInModal();

      logger.add("success", `温度計カラーを変更しました: [${newHex}]`, {
        deviceId: devId,
        colorHex: newHex
      });

      debouncedSyncConfigToCloud();
    });
  });

  // 📋 MACアイコンおよびデバイス名クリック時（クリップボードにコピー）
  const macIcons = elements.thermometerGrid.querySelectorAll(".mac-info-icon");
  macIcons.forEach(icon => {
    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      const mac = icon.dataset.mac;
      const name = icon.dataset.name;
      copyToClipboard(mac, name);
    });
  });

  const nameTexts = elements.thermometerGrid.querySelectorAll(".device-name-text");
  nameTexts.forEach(txt => {
    txt.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = txt.closest(".sensor-card");
      const icon = card ? card.querySelector(".mac-info-icon") : null;
      if (icon) {
        copyToClipboard(icon.dataset.mac, icon.dataset.name);
      }
    });
  });

  // 🖱️ 案B：カードクリックによる3段階ステート循環 (ON ➔ OFF ➔ 単独表示 ➔ 全表示)
  const cards = elements.thermometerGrid.querySelectorAll(".sensor-card");
  cards.forEach(card => {
    card.addEventListener("click", () => {
      if (isDraggingActive) return; // ドラッグ中・直後はカードクリック切替を抑制

      const devId = card.dataset.id;
      const dev = (appState.thermometers.find(m => m.deviceId === devId) || 
                   (appState.meterDataCache.find(m => m.device.deviceId === devId) || {}).device) || { deviceName: devId };

      if (appState.soloMeterId === devId) {
        // 現在「単独表示」中 ➔ 3回目クリック：全表示（元通りリセット）
        appState.soloMeterId = null;
        appState.hiddenMeterIds = [];
        logger.add("info", `温度計表示リセット: 全温度計を表示します`, {
          action: "ALL",
          triggerMeter: dev.deviceName
        });
      } else if (appState.soloMeterId && appState.soloMeterId !== devId) {
        // 他のメーターが単独表示中にこのカードを押した ➔ このメーターを単独表示に切り替え
        appState.soloMeterId = devId;
        appState.hiddenMeterIds = [];
        logger.add("info", `温度計単独表示切り替え: [${dev.deviceName}] のみ表示`, {
          action: "SOLO",
          targetMeter: dev.deviceName,
          deviceId: devId
        });
      } else if (appState.hiddenMeterIds.includes(devId)) {
        // 現在「OFF」状態 ➔ 2回目クリック：このメーターのみ「単独表示」
        appState.soloMeterId = devId;
        appState.hiddenMeterIds = [];
        logger.add("info", `温度計単独表示: [${dev.deviceName}] のみ表示 (他を全OFF)`, {
          action: "SOLO",
          targetMeter: dev.deviceName,
          deviceId: devId
        });
      } else {
        // 現在「ON」状態 ➔ 1回目クリック：このメーターを「OFF」
        appState.hiddenMeterIds.push(devId);
        logger.add("info", `温度計非表示: [${dev.deviceName}] をグラフから隠しました`, {
          action: "OFF",
          targetMeter: dev.deviceName,
          deviceId: devId,
          currentlyHidden: appState.hiddenMeterIds
        });
      }

      // UIカードとグラフを即座に同期再描画
      renderThermometerCards(appState.meterDataCache, false);
      updateTempChart();
    });

    // ⠿ ドラッグ＆ドロップイベントバインド (HTML5 DnD + タッチ対応)
    card.addEventListener("dragstart", (e) => {
      isDraggingActive = true;
      draggedCardEl = card;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.dataset.id);
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      cards.forEach(c => c.classList.remove("drag-over"));
      draggedCardEl = null;
      setTimeout(() => { isDraggingActive = false; }, 120);
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (draggedCardEl && draggedCardEl !== card) {
        card.classList.add("drag-over");
      }
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (!draggedCardEl || draggedCardEl === card) return;

      const grid = elements.thermometerGrid;
      const allCards = [...grid.querySelectorAll(".sensor-card")];
      const fromIndex = allCards.indexOf(draggedCardEl);
      const toIndex = allCards.indexOf(card);

      if (fromIndex < toIndex) {
        grid.insertBefore(draggedCardEl, card.nextSibling);
      } else {
        grid.insertBefore(draggedCardEl, card);
      }

      saveCurrentCardOrder();
    });

    // 📱 スマホ・タブレット用 タッチドラッグ操作
    const handle = card.querySelector(".drag-handle");
    if (handle) {
      let isTouchMoving = false;

      handle.addEventListener("touchstart", (e) => {
        isDraggingActive = true;
        draggedCardEl = card;
      }, { passive: true });

      handle.addEventListener("touchmove", (e) => {
        if (!draggedCardEl) return;
        const touch = e.touches[0];
        isTouchMoving = true;
        draggedCardEl.classList.add("dragging");

        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetCard = targetEl ? targetEl.closest(".sensor-card") : null;
        cards.forEach(c => c.classList.remove("drag-over"));
        if (targetCard && targetCard !== draggedCardEl) {
          targetCard.classList.add("drag-over");
        }
      }, { passive: true });

      handle.addEventListener("touchend", (e) => {
        if (!draggedCardEl) return;
        cards.forEach(c => c.classList.remove("drag-over", "dragging"));

        if (isTouchMoving) {
          const touch = e.changedTouches[0];
          const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
          const targetCard = targetEl ? targetEl.closest(".sensor-card") : null;

          if (targetCard && targetCard !== draggedCardEl) {
            const grid = elements.thermometerGrid;
            const allCards = [...grid.querySelectorAll(".sensor-card")];
            const fromIndex = allCards.indexOf(draggedCardEl);
            const toIndex = allCards.indexOf(targetCard);
            if (fromIndex < toIndex) {
              grid.insertBefore(draggedCardEl, targetCard.nextSibling);
            } else {
              grid.insertBefore(draggedCardEl, targetCard);
            }
            saveCurrentCardOrder();
          }
        }

        draggedCardEl = null;
        isTouchMoving = false;
        setTimeout(() => { isDraggingActive = false; }, 200);
      });
    }
  });
}

/**
 * 📹 カメラカードの描画
 */
function renderCameraCards(cameras) {
  const container = document.getElementById("cameraGrid");
  if (!container) return;

  if (!cameras || cameras.length === 0) {
    container.innerHTML = `
      <div class="camera-card" style="text-align: center; color: var(--text-muted); padding: 20px; grid-column: 1 / -1;">
        検出されたカメラはありません。「設定」からAPIキーを確認してください。
      </div>`;
    return;
  }

  let html = "";
  cameras.forEach((cam) => {
    let camIcon = "📹";
    if (cam.deviceName.includes("エアコン")) camIcon = "❄️📹";
    else if (cam.deviceName.includes("全体")) camIcon = "🏠📹";
    else if (cam.deviceName.includes("屋外")) camIcon = "🌳📹";

    html += `
      <div class="camera-card">
        <div>
          <div class="camera-header">
            <div class="camera-title">${camIcon} ${escapeHtml(cam.deviceName)}</div>
            <span class="sensor-role" style="color: var(--accent-green); background: rgba(16, 185, 129, 0.12);">🟢 クラウド連携済</span>
          </div>
          <div class="camera-id-badge">ID: ${escapeHtml(cam.deviceId)}</div>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">
            種別: ${escapeHtml(cam.deviceType)} (P2P直接暗号化通信)
          </p>
        </div>

        <div>
          <div class="camera-status-row">
            <span>📡 死活監視: <strong>正常</strong></span>
            <span>🔒 暗号化: <strong>P2P保護</strong></span>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 10px;">
            <a href="switchbot://camera/${cam.deviceId}" class="btn btn-primary camera-btn" style="text-decoration: none; text-align: center;" title="スマホのSwitchBotアプリで映像を直接開く">
              📱 アプリで映像を開く
            </a>
            <button type="button" class="btn camera-btn" onclick="showPcViewingGuide('${escapeHtml(cam.deviceName)}')" style="flex: 1;" title="PCで見る方法">
              🖥️ PC表示案内
            </button>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

window.showPcViewingGuide = function(camName) {
  alert(`【${camName} の映像をMac/PCで確認する方法】\n\nSwitchBotカメラは暗号化P2P通信のため、ブラウザ内に直接動画を流すと通信量が膨大になります。\n\n安全かつ通信量を抑えてPCで見るには：\n1. スマホでSwitchBotアプリのカメラ映像を開く\n2. スマホの「画面ミラーリング (AirPlay / キャスト)」を押し、お使いのPC/Macに画面を映す\n\n※ これによりPCのCPU負荷ゼロで、見たい時だけ通信量最小限で確認できます。`);
};

/**
 * ❄️ エアコンへコマンド送信
 */
async function sendAirconCommand(command, parameter, displayDesc) {
  let airconId = localStorage.getItem(STORAGE_KEYS.AIRCON_ID);
  if (!airconId && appState.infraredDevices && appState.infraredDevices.length > 0) {
    const aircon = appState.infraredDevices.find(d => d.remoteType === "Air Conditioner");
    if (aircon) {
      airconId = aircon.deviceId;
      localStorage.setItem(STORAGE_KEYS.AIRCON_ID, airconId);
    }
  }

  // 🎯 グラフ上イベントマーカーを即座に先行記録（UXレスポンス即時化＆描画保証）
  let evType = "manual";
  if (command === "turnOff") {
    evType = "off";
  } else if (displayDesc && displayDesc.includes("自動再送信")) {
    evType = "keepalive";
  }
  recordAirconEvent(evType, displayDesc, appState.airconConfig.temp);

  if (!airconId) {
    elements.airconStatus.textContent = `⚠️ エアコン未連携: グラフにシミュレーション記録しました`;
    logger.add("warn", `エアコンデバイス未連携のためシミュレーション記録: [${displayDesc}]`, {
      command, parameter, displayDesc
    });
    return;
  }

  elements.airconStatus.textContent = `送信中 (${displayDesc})...`;
  logger.add("info", `エアコンコマンド送信リクエスト: [${command}]`, {
    targetDeviceId: airconId,
    command: command,
    parameter: parameter,
    description: displayDesc,
    parsedConfig: {
      temp: `${appState.airconConfig.temp}℃`,
      mode: MODE_NAMES[appState.airconConfig.mode] || appState.airconConfig.mode,
      fan: FAN_NAMES[appState.airconConfig.fan] || appState.airconConfig.fan
    }
  });

  try {
    const res = await callProxyApi("/api/switchbot", {
      method: "POST",
      body: JSON.stringify({
        deviceId: airconId,
        command: command,
        parameter: parameter,
        commandType: "command"
      })
    });

    if (res.statusCode === 100) {
      const now = new Date().toLocaleTimeString("ja-JP");
      elements.airconStatus.textContent = `✅ 送信成功: ${displayDesc} [${now}]`;
      logger.add("success", `エアコンコマンド送信成功: ${displayDesc}`, {
        statusCode: res.statusCode,
        message: res.message,
        executionTime: now
      });
    } else {
      elements.airconStatus.textContent = `⚠️ 送信結果: ${res.message || "応答なし"}`;
      logger.add("warn", `エアコンコマンド送信応答: [${res.message}]`, {
        statusCode: res.statusCode,
        message: res.message
      });
    }
  } catch (err) {
    elements.airconStatus.textContent = `❌ 送信失敗: ${err.message}`;
    logger.add("error", `エアコンコマンド送信エラー: ${err.message}`, {
      errorName: err.name,
      message: err.message
    });
  }
}

/**
 * シャッター操作
 */
async function controlShutter(action) {
  const bots = appState.devices.filter(d => d.deviceType === "Bot");
  if (bots.length === 0) {
    alert("シャッター操作用のボットが登録されていません。");
    return;
  }

  const targetBot = action === "open" ? bots[0] : (bots[1] || bots[0]);
  elements.shutterStatus.textContent = `シャッター(${action}) 操作中...`;

  logger.add("info", `シャッターBot操作リクエスト: [${action}]`, {
    botDeviceId: targetBot.deviceId,
    botName: targetBot.deviceName,
    action: action,
    command: "press"
  });

  try {
    const res = await callProxyApi("/api/switchbot", {
      method: "POST",
      body: JSON.stringify({
        deviceId: targetBot.deviceId,
        command: "press",
        parameter: "default",
        commandType: "command"
      })
    });

    if (res.statusCode === 100) {
      elements.shutterStatus.textContent = `✅ シャッター(${action}) コマンド実行完了`;
      logger.add("success", `シャッター(${action}) 操作完了`, {
        botName: targetBot.deviceName,
        result: res
      });
    } else {
      elements.shutterStatus.textContent = `⚠️ 実行結果: ${res.message}`;
      logger.add("warn", `シャッター(${action}) 実行警告`, {
        result: res
      });
    }
  } catch (err) {
    elements.shutterStatus.textContent = `❌ 操作失敗: ${err.message}`;
    logger.add("error", `シャッター(${action}) 操作失敗: ${err.message}`, {
      errorName: err.name,
      message: err.message
    });
  }
}

/**
 * キープアライブ制御
 */
function updateKeepAliveUI(enabled) {
  if (enabled) {
    const cfg = appState.airconConfig;
    const modeName = MODE_NAMES[cfg.mode] || "冷房";
    elements.keepAliveBadge.textContent = "稼働中";
    elements.keepAliveBadge.style.color = "var(--accent-green)";
    elements.keepAliveBadge.style.background = "rgba(16, 185, 129, 0.15)";
    elements.keepAliveInfo.innerHTML = `状態: <strong style="color: var(--accent-green);">稼働中</strong> (1時間おきに「${modeName} ${cfg.temp}℃」を自動送信)`;
    
    if (!appState.keepAliveTimer) {
      appState.keepAliveTimer = setInterval(() => {
        const c = appState.airconConfig;
        const mName = MODE_NAMES[c.mode] || "冷房";
        const param = `${c.temp},${c.mode},${c.fan},on`;
        logger.add("info", `⏱️ キープアライブ自動実行: [${mName} ${c.temp}℃] 送信`);
        sendAirconCommand("setAll", param, `自動再送信: ${mName} ${c.temp}℃`);
      }, 3600000);
    }
  } else {
    elements.keepAliveBadge.textContent = "安全停止中";
    elements.keepAliveBadge.style.color = "var(--accent-red)";
    elements.keepAliveBadge.style.background = "rgba(239, 68, 68, 0.15)";
    elements.keepAliveInfo.innerHTML = `状態: <strong style="color: var(--accent-red);">安全のため完全停止中 (夜間・テスト中の自動送信なし)</strong>`;
    
    if (appState.keepAliveTimer) {
      clearInterval(appState.keepAliveTimer);
      appState.keepAliveTimer = null;
    }
  }
}

/**
 * 設定モーダルのデバイス一覧レンダリング
 */
function renderDeviceListModal(devices, infrareds) {
  let html = `<div style="max-height: 240px; overflow-y: auto; background: var(--bg-primary); padding: 10px; border-radius: 8px;">`;
  
  html += `<div style="font-weight: 700; margin-bottom: 6px;">■ 物理デバイス (${devices.length}台):</div>`;
  html += `<p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px;">※ 不要なデバイス（自宅用など）のチェックを外すと画面から除外できます。</p>`;

  devices.forEach(d => {
    const isChecked = !appState.excludedDeviceIds.includes(d.deviceId);
    const formattedMac = formatMacAddress(d.deviceId);
    html += `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 4px 6px; border-radius: 4px; background: rgba(255,255,255,0.03); gap: 8px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; min-width: 0; flex: 1;">
          <input type="checkbox" class="device-toggle-checkbox" data-id="${d.deviceId}" ${isChecked ? "checked" : ""}>
          <span style="font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <strong>${escapeHtml(d.deviceName)}</strong> <span style="color: var(--text-muted); font-size: 0.75rem;">(${d.deviceType})</span>
          </span>
        </label>
        <button type="button" class="btn-copy-mac" data-mac="${formattedMac}" data-name="${escapeHtml(d.deviceName)}" title="BLE MAC (${formattedMac}) をクリップボードにコピー">
          📋 ${formattedMac}
        </button>
      </div>
    `;
  });

  html += `<div style="font-weight: 700; margin: 12px 0 6px 0;">■ 赤外線リモコン (${infrareds.length}台):</div>`;
  infrareds.forEach(d => {
    html += `<div style="font-size: 0.85rem; padding-left: 8px; color: var(--accent-blue);">• ${escapeHtml(d.deviceName)} (${d.remoteType})</div>`;
  });

  html += `</div>`;
  elements.deviceListContainer.innerHTML = html;

  const checkboxes = elements.deviceListContainer.querySelectorAll(".device-toggle-checkbox");
  checkboxes.forEach(cb => {
    cb.addEventListener("change", (e) => {
      const devId = e.target.dataset.id;
      if (e.target.checked) {
        appState.excludedDeviceIds = appState.excludedDeviceIds.filter(id => id !== devId);
      } else {
        if (!appState.excludedDeviceIds.includes(devId)) {
          appState.excludedDeviceIds.push(devId);
        }
      }
      localStorage.setItem(STORAGE_KEYS.EXCLUDED_DEVICES, JSON.stringify(appState.excludedDeviceIds));

      appState.thermometers = appState.devices.filter(d => 
        (d.deviceType.includes("Meter") || d.deviceType.includes("Sensor") || d.deviceType.includes("Hub")) &&
        !appState.excludedDeviceIds.includes(d.deviceId)
      );
      appState.cameras = appState.devices.filter(d => 
        d.deviceType.includes("Cam") &&
        !appState.excludedDeviceIds.includes(d.deviceId)
      );
      refreshThermometers();
      renderCameraCards(appState.cameras);
      updateOutdoorMeterSettingsUI();
    });
  });

  updateOutdoorMeterSettingsUI();
}

function updateStatus(text, isError) {
  elements.statusText.textContent = text;
  if (isError) {
    elements.connectionStatus.classList.add("error");
  } else {
    elements.connectionStatus.classList.remove("error");
  }
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
