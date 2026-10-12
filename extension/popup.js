"use strict";

const SETTINGS_KEY = "wwInterlinearSettings";
const DEFAULT_SETTINGS = {
  mode: "word",
  enabled: true,
  autoTranslate: false,
  disabledSites: [],
  glossSize: 0.6,
  glossColor: "auto",
  customGlossColor: "#4b5563",
  glossOpacity: null,
  showUnknown: true
};

const controls = {
  mode: document.getElementById("translation-mode"),
  modeHint: document.getElementById("mode-hint"),
  openOptions: document.getElementById("open-options"),
  unknownRow: document.getElementById("unknown-row"),
  source: document.getElementById("translation-source"),
  sourceNote: document.getElementById("source-note"),
  enabled: document.getElementById("enabled"),
  autoTranslate: document.getElementById("auto-translate"),
  autoTranslateHint: document.getElementById("auto-translate-hint"),
  siteDisabled: document.getElementById("site-disabled"),
  size: document.getElementById("gloss-size"),
  sizeValue: document.getElementById("gloss-size-value"),
  color: document.getElementById("gloss-color"),
  customColorField: document.getElementById("custom-color-field"),
  customColorPicker: document.getElementById("custom-gloss-color-picker"),
  customColorHex: document.getElementById("custom-gloss-color-hex"),
  customColorError: document.getElementById("custom-color-error"),
  transparency: document.getElementById("gloss-transparency"),
  transparencyValue: document.getElementById("gloss-transparency-value"),
  previewOriginal: document.getElementById("preview-original"),
  previewGloss: document.getElementById("preview-gloss"),
  unknown: document.getElementById("show-unknown"),
  host: document.getElementById("site-host"),
  status: document.getElementById("page-status"),
  saveStatus: document.getElementById("save-status"),
  refresh: document.getElementById("refresh-status")
};

let settings = { ...DEFAULT_SETTINGS };
let apiConfigured = false;
let activeTab = null;
let hostname = "";
let saveQueue = Promise.resolve();
let saveVersion = 0;
let statusVersion = 0;
let statusTimer;
let appearanceDraftActive = false;

function normalizeCustomColor(value) {
  const color = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (/^#[a-f0-9]{6}$/.test(color)) return color;
  if (/^#[a-f0-9]{3}$/.test(color)) return `#${[...color.slice(1)].map(character => character.repeat(2)).join("")}`;
  return null;
}

function normalizedOpacity(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function effectiveOpacity(value, mode = settings.mode) {
  return normalizedOpacity(value) ?? (mode === "sentence" ? 0.92 : 0.9);
}

function customColorError(message = "") {
  controls.customColorError.textContent = message;
  controls.customColorError.hidden = !message;
  controls.customColorHex.setAttribute("aria-invalid", String(Boolean(message)));
}

function normalizeSettings(stored) {
  const value = stored && typeof stored === "object" ? stored : {};
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    mode: value.mode === "sentence" ? "sentence" : "word",
    enabled: value.enabled !== false,
    autoTranslate: value.autoTranslate === true,
    disabledSites: Array.isArray(value.disabledSites) ? value.disabledSites.filter(site => typeof site === "string") : [],
    glossSize: Number.isFinite(value.glossSize) ? Math.min(0.85, Math.max(0.45, value.glossSize)) : 0.6,
    glossColor: ["auto", "gray", "teal", "custom"].includes(value.glossColor) ? value.glossColor : "auto",
    customGlossColor: normalizeCustomColor(value.customGlossColor) || DEFAULT_SETTINGS.customGlossColor,
    glossOpacity: normalizedOpacity(value.glossOpacity),
    showUnknown: value.showUnknown !== false
  };
}

function previewStyle(size, color, customColor = settings.customGlossColor, opacity = effectiveOpacity(settings.glossOpacity)) {
  controls.sizeValue.value = `${Math.round(Number(size) * 100)}%`;
  document.documentElement.style.setProperty("--preview-size", `${size}em`);
  // Automatic color follows the surrounding page text, including dark mode.
  const colors = { auto: "inherit", gray: "var(--muted)", teal: "var(--accent)", custom: normalizeCustomColor(customColor) || settings.customGlossColor };
  document.documentElement.style.setProperty("--preview-color", colors[color] || colors.auto);
  document.documentElement.style.setProperty("--preview-opacity", String(opacity));
  controls.transparencyValue.value = `${Math.round((1 - opacity) * 100)}%`;
  controls.customColorField.hidden = color !== "custom";
  controls.previewOriginal.textContent = controls.mode.value === "sentence" ? "Reading opens doors." : "Reading";
  controls.previewGloss.textContent = controls.mode.value === "sentence" ? "阅读打开新的天地。" : "阅读";
}

function previewAppearanceDraft() {
  previewStyle(Number(controls.size.value), controls.color.value,
    normalizeCustomColor(controls.customColorHex.value) || controls.customColorPicker.value,
    1 - Number(controls.transparency.value) / 100);
}

function renderSettings() {
  controls.mode.value = settings.mode;
  const sentenceMode = settings.mode === "sentence";
  controls.unknownRow.hidden = sentenceMode;
  controls.modeHint.textContent = sentenceMode
    ? (settings.autoTranslate ? "自动将英文句子发送至配置服务，可能产生费用。" : "右键网页 → 翻译此页后，将句子发送至配置服务，可能产生费用。")
    : (settings.autoTranslate ? "自动标注英文网页，使用本地词典，无需联网。" : "右键网页 → 翻译此页后使用本地词典，无需联网。");
  controls.autoTranslate.checked = settings.autoTranslate;
  controls.autoTranslateHint.textContent = settings.autoTranslate
    ? (sentenceMode ? "自动向已配置服务发送英文句子，可能计费；中文页面仍跳过" : "自动使用本地词典标注英文；中文页面仍跳过")
    : "关闭时需右键网页 → 翻译此页；中文页面仍跳过";
  document.querySelector(".local-badge").textContent = sentenceMode ? "API 翻译" : "离线词典";
  controls.source.textContent = sentenceMode
    ? "翻译源：你配置的 OpenAI 兼容 API"
    : "翻译源：本地 ECDICT 英汉词典";
  controls.sourceNote.textContent = sentenceMode
    ? (apiConfigured ? "API 已设置；保留英文，在每句下方显示小字译文。" : "API 尚未设置，请先打开“API 设置”填写服务信息。")
    : "无需账号或 API；按词典词义标注，不做整段翻译。";
  controls.enabled.checked = settings.enabled;
  controls.siteDisabled.checked = hostname ? settings.disabledSites.includes(hostname) : false;
  controls.siteDisabled.disabled = !hostname;
  if (!appearanceDraftActive) {
    controls.size.value = String(settings.glossSize);
    controls.color.value = settings.glossColor;
    controls.customColorPicker.value = settings.customGlossColor;
    controls.customColorHex.value = settings.customGlossColor;
    controls.transparency.value = String(Math.round((1 - effectiveOpacity(settings.glossOpacity)) * 100));
    customColorError();
  }
  controls.unknown.checked = settings.showUnknown;
  if (appearanceDraftActive) previewAppearanceDraft();
  else previewStyle(settings.glossSize, settings.glossColor, settings.customGlossColor, effectiveOpacity(settings.glossOpacity));
}

function feedback(message, isError = false) {
  controls.saveStatus.textContent = message;
  controls.saveStatus.classList.toggle("error", isError);
}

function saveChange(apply) {
  const version = ++saveVersion;
  feedback("正在保存…");
  // Serialize rapid edits and re-read before each full-object write so unrelated
  // settings and site exclusions are preserved.
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const latest = normalizeSettings(stored[SETTINGS_KEY]);
    const next = normalizeSettings(apply(latest));
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    settings = next;
    if (version === saveVersion) {
      renderSettings();
      feedback("已保存；未启用的网页需右键选择“翻译此页”。");
      clearTimeout(statusTimer);
      statusTimer = setTimeout(refreshStatus, 350);
    }
  }).catch(() => {
    if (version === saveVersion) {
      renderSettings();
      feedback("保存失败，请重新打开扩展后再试。", true);
    }
  });
}

async function refreshStatus() {
  const version = ++statusVersion;
  controls.refresh.disabled = true;
  try {
    if (!hostname || !Number.isInteger(activeTab?.id)) {
      controls.status.textContent = "请在普通的 HTTP 或 HTTPS 网页上使用。";
      return;
    }
    if (!settings.enabled) {
      controls.status.textContent = "翻译功能已关闭。";
      return;
    }
    if (settings.disabledSites.includes(hostname)) {
      controls.status.textContent = "此网站已暂停标注。";
      return;
    }
    controls.status.textContent = "正在读取标注状态…";
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "ww-interlinear-status" }, { frameId: 0 });
    if (version !== statusVersion) return;
    if (!response) throw new Error("No content status");
    if (response.skipReason === "global-disabled") {
      controls.status.textContent = "翻译功能已关闭。";
    } else if (response.skipReason === "site-paused") {
      controls.status.textContent = "此网站已暂停标注。";
    } else if (response.skipReason === "chinese-page") {
      controls.status.textContent = "中文页面已自动跳过，不启用翻译。";
    } else if (response.skipReason === "language-detection") {
      controls.status.textContent = "正在判断网页语言，暂不启用翻译。";
    } else if (response.skipReason === "auto-paused") {
      controls.status.textContent = "当前页已暂停自动翻译：右键网页 → 翻译此页，可恢复翻译。";
    } else if (response.skipReason === "not-activated") {
      controls.status.textContent = "当前页尚未翻译：右键网页 → 翻译此页。";
    } else if (settings.mode === "sentence" && !apiConfigured) {
      controls.status.textContent = "整句模式需要先配置 API 服务。";
    } else if (response.enabled === false) {
      controls.status.textContent = "当前网页未启用标注。";
    } else if (["loading", "dictionary-loading"].includes(response.phase)) {
      controls.status.textContent = "正在加载本地词典…";
    } else if (response.phase === "error") {
      controls.status.textContent = typeof response.error === "string" && response.error
        ? response.error.slice(0, 180) : "标注暂时失败，请刷新网页后重试。";
    } else {
      const annotated = Math.max(0, Number(response.annotated) || 0).toLocaleString("zh-CN");
      const missing = Math.max(0, Number(response.missing) || 0).toLocaleString("zh-CN");
      const scanning = ["scanning", "annotating", "processing", "translating"].includes(response.phase)
        ? (settings.mode === "sentence" ? "正在翻译 · " : "正在标注 · ") : "";
      controls.status.textContent = settings.mode === "sentence"
        ? `${scanning}已翻译 ${annotated} 句 · 未翻译 ${missing} 句`
        : `${scanning}已标注 ${annotated} 个词 · 未收录 ${missing} 个词`;
    }
  } catch {
    if (version === statusVersion) {
      controls.status.textContent = "当前页暂未响应，请刷新网页后再试。浏览器内置页及商店页面不支持标注。";
    }
  } finally {
    if (version === statusVersion) controls.refresh.disabled = false;
  }
}

async function refreshApiConfiguration() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "ww-get-settings" });
    apiConfigured = Boolean(response?.settings?.apiConfigured);
  } catch { apiConfigured = false; }
  renderSettings();
}

controls.mode.addEventListener("change", () => {
  const mode = controls.mode.value;
  saveChange(latest => ({ ...latest, mode }));
});
controls.openOptions.addEventListener("click", async () => {
  try { await chrome.runtime.openOptionsPage(); }
  catch { feedback("无法打开 API 设置，请从扩展管理页面打开扩展选项。", true); }
});

controls.enabled.addEventListener("change", () => {
  const enabled = controls.enabled.checked;
  saveChange(latest => ({ ...latest, enabled }));
});
controls.autoTranslate.addEventListener("change", () => {
  const autoTranslate = controls.autoTranslate.checked;
  saveChange(latest => ({ ...latest, autoTranslate }));
});
controls.siteDisabled.addEventListener("change", () => {
  const disabled = controls.siteDisabled.checked;
  if (!hostname) return;
  saveChange(latest => ({
    ...latest,
    disabledSites: disabled
      ? [...new Set([...latest.disabledSites, hostname])]
      : latest.disabledSites.filter(site => site !== hostname)
  }));
});
controls.size.addEventListener("input", () => { appearanceDraftActive = true; previewAppearanceDraft(); });
controls.size.addEventListener("change", () => {
  appearanceDraftActive = false;
  const glossSize = Number(controls.size.value);
  saveChange(latest => ({ ...latest, glossSize }));
});
controls.color.addEventListener("change", () => {
  const glossColor = controls.color.value;
  appearanceDraftActive = false;
  customColorError();
  previewAppearanceDraft();
  saveChange(latest => ({ ...latest, glossColor }));
});
controls.customColorPicker.addEventListener("input", () => {
  appearanceDraftActive = true;
  controls.customColorHex.value = controls.customColorPicker.value;
  customColorError();
  previewAppearanceDraft();
});
controls.customColorPicker.addEventListener("change", () => {
  const customGlossColor = normalizeCustomColor(controls.customColorPicker.value);
  if (!customGlossColor) return;
  appearanceDraftActive = false;
  controls.customColorHex.value = customGlossColor;
  customColorError();
  previewAppearanceDraft();
  saveChange(latest => ({ ...latest, glossColor: "custom", customGlossColor }));
});
controls.customColorHex.addEventListener("input", () => {
  appearanceDraftActive = true;
  const color = normalizeCustomColor(controls.customColorHex.value);
  customColorError(color ? "" : "请输入 #RGB 或 #RRGGBB 格式的有效颜色。");
  if (color) { controls.customColorPicker.value = color; previewAppearanceDraft(); }
});
controls.customColorHex.addEventListener("change", () => {
  const customGlossColor = normalizeCustomColor(controls.customColorHex.value);
  if (!customGlossColor) {
    appearanceDraftActive = true;
    customColorError("请输入 #RGB 或 #RRGGBB 格式的有效颜色；当前值未保存。");
    feedback("颜色格式有误，请修改标出的色值。", true);
    return;
  }
  appearanceDraftActive = false;
  controls.customColorHex.value = customGlossColor;
  controls.customColorPicker.value = customGlossColor;
  customColorError();
  previewAppearanceDraft();
  saveChange(latest => ({ ...latest, glossColor: "custom", customGlossColor }));
});
controls.transparency.addEventListener("input", () => { appearanceDraftActive = true; previewAppearanceDraft(); });
controls.transparency.addEventListener("change", () => {
  const glossOpacity = Math.round((1 - Number(controls.transparency.value) / 100) * 100) / 100;
  appearanceDraftActive = false;
  previewAppearanceDraft();
  saveChange(latest => ({ ...latest, glossOpacity }));
});
controls.unknown.addEventListener("change", () => {
  const showUnknown = controls.unknown.checked;
  saveChange(latest => ({ ...latest, showUnknown }));
});
controls.refresh.addEventListener("click", refreshStatus);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[SETTINGS_KEY]) {
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    renderSettings();
  }
  if (changes.wwInterlinearApiConfig) refreshApiConfiguration();
});

async function initialize() {
  try {
    const [stored, tabs] = await Promise.all([
      chrome.storage.local.get(SETTINGS_KEY),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);
    settings = normalizeSettings(stored[SETTINGS_KEY]);
    activeTab = tabs[0] || null;
    try {
      const url = new URL(activeTab?.url || "");
      if (["http:", "https:"].includes(url.protocol)) hostname = url.hostname;
    } catch { /* The URL may be unavailable on a protected browser page. */ }
    controls.host.textContent = hostname || "此页面无法设置网站暂停";
    controls.host.title = hostname;
    renderSettings();
    [controls.mode, controls.enabled, controls.autoTranslate, controls.size, controls.color, controls.customColorPicker, controls.customColorHex, controls.transparency, controls.unknown].forEach(control => { control.disabled = false; });
    await refreshApiConfiguration();
    await refreshStatus();
  } catch {
    controls.host.textContent = "无法读取当前网站";
    controls.status.textContent = "无法读取扩展设置，请重新打开后再试。";
    feedback("扩展初始化失败。", true);
  }
}

initialize();
