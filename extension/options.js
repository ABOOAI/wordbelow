"use strict";

const API_CONFIG_KEY = "wwInterlinearApiConfig";
const OPTIONS_SETTINGS_KEY = "wwInterlinearSettings";
const fields = {
  form: document.getElementById("api-form"),
  baseUrl: document.getElementById("base-url"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("api-key"),
  disableThinking: document.getElementById("disable-thinking"),
  batchSize: document.getElementById("batch-size"),
  concurrency: document.getElementById("concurrency"),
  reveal: document.getElementById("toggle-key"),
  save: document.getElementById("save"),
  test: document.getElementById("test"),
  clear: document.getElementById("clear-key"),
  importKey: document.getElementById("import-key"),
  keyFile: document.getElementById("key-file"),
  qwenPreset: document.getElementById("qwen-preset"),
  qwenHint: document.getElementById("qwen-hint"),
  thinkingHint: document.getElementById("thinking-hint"),
  performanceIntro: document.getElementById("performance-intro"),
  batchHint: document.getElementById("batch-hint"),
  status: document.getElementById("form-status"),
  translation: document.getElementById("test-translation")
};

let savedConfig = normalizeOptionsConfig();
let busy = false;
let ready = false;
let dirty = false;

function isQwenMtModel(model) {
  return /^qwen-mt(?:-|$)/i.test(String(model || "").trim());
}

function isMiMoModel(model) {
  return /^(?:[^/]+\/)?mimo(?:-|$)/i.test(String(model || "").trim());
}

function apiHostname(baseUrl) {
  try { return new URL(normalizeApiEndpoint(baseUrl)).hostname.toLowerCase(); }
  catch { return ""; }
}

function isMiMoEndpoint(baseUrl) {
  return /(^|\.)xiaomimimo\.com$/.test(apiHostname(baseUrl));
}

function renderModelHints() {
  const qwen = isQwenMtModel(fields.model.value);
  fields.qwenHint.hidden = !qwen;
  fields.thinkingHint.textContent = qwen
    ? "Qwen-MT 使用专用翻译参数，不发送 MiMo 深度思考参数。原勾选值保留，切回 MiMo 后仍可使用。"
    : "仅对可识别的 MiMo V2 系列模型（如 mimo-v2.6-flash）发送关闭思考参数，服务需支持该参数。其他模型保持服务默认行为。复杂专业文本可取消勾选，比较服务默认设置下的译文。";
  fields.performanceIntro.textContent = qwen
    ? "Qwen-MT 建议先用每批 4 句、同时 2 个请求；译文仍逐句显示。测试稳定后再增加，出现限流或等待变长时降低同时请求数。"
    : "默认每次合并 6 句，并同时发送最多 3 个请求；译文仍逐句显示在原文下方。";
  fields.batchHint.textContent = qwen
    ? "每批有总长度上限；批次结果边界异常时改为单句核对。专业长句或持续回退时，可选 1 句。"
    : "合并请求可减少等待；批次也有总长度上限。服务不支持批量结果时，可选择 1 句。";
}

function normalizeOptionsConfig(value = {}) {
  return {
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
    model: typeof value.model === "string" ? value.model : "",
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
    disableThinking: value.disableThinking !== false,
    batchSize: [1, 4, 6, 8].includes(Number(value.batchSize)) ? Number(value.batchSize) : 6,
    concurrency: [1, 2, 3, 4].includes(Number(value.concurrency)) ? Number(value.concurrency) : 3
  };
}

function writeConfigFields(config) {
  fields.baseUrl.value = config.baseUrl;
  fields.model.value = config.model;
  fields.apiKey.value = config.apiKey;
  fields.disableThinking.checked = config.disableThinking;
  fields.batchSize.value = String(config.batchSize);
  fields.concurrency.value = String(config.concurrency);
}

function draftDiffersFrom(config) {
  return fields.baseUrl.value.trim() !== config.baseUrl || fields.model.value.trim() !== config.model ||
    fields.apiKey.value.trim() !== config.apiKey || fields.disableThinking.checked !== config.disableThinking ||
    Number(fields.batchSize.value) !== config.batchSize || Number(fields.concurrency.value) !== config.concurrency;
}

function loopbackUrl(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
}

function normalizeApiEndpoint(input) {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 2048) throw new Error("请填写服务地址，长度不能超过 2048 个字符。");
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("请填写完整的服务地址，包含 https:// 或本机 http://。"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackUrl(url))) {
    throw new Error("远程服务必须使用 HTTPS；HTTP 仅支持 localhost、127.0.0.1 或 [::1]。");
  }
  if (url.username || url.password || raw.includes("?") || raw.includes("#")) {
    throw new Error("服务地址不能包含用户名、密码、查询参数或 # 片段。");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = !pathname ? "/v1/chat/completions"
    : pathname.endsWith("/chat/completions") ? pathname : `${pathname}/chat/completions`;
  if (url.href.length > 2048) throw new Error("服务地址过长，请使用更短的 API 地址。");
  return url.href;
}

function setStatus(message, error = false) {
  fields.status.textContent = message;
  fields.status.classList.toggle("error", error);
}

function setFieldError(field, message = "") {
  const id = { baseUrl: "base-error", model: "model-error", apiKey: "key-error" }[field];
  const error = document.getElementById(id);
  error.textContent = message;
  error.hidden = !message;
  fields[field].setAttribute("aria-invalid", String(Boolean(message)));
}

function configComplete(config) {
  try {
    const endpoint = new URL(normalizeApiEndpoint(config.baseUrl));
    return Boolean(config.model.trim() && (config.apiKey.trim() || loopbackUrl(endpoint)));
  } catch { return false; }
}

function renderButtons() {
  for (const element of [fields.baseUrl, fields.model, fields.apiKey, fields.batchSize, fields.concurrency, fields.reveal, fields.save, fields.qwenPreset, fields.importKey, fields.keyFile]) element.disabled = busy || !ready;
  fields.disableThinking.disabled = busy || !ready || isQwenMtModel(fields.model.value);
  fields.test.disabled = busy || !ready || dirty || !configComplete(savedConfig);
  fields.clear.disabled = busy || !ready || !savedConfig.apiKey;
  fields.save.textContent = busy ? "请稍候…" : "保存设置";
}

function markDirty(field) {
  dirty = true;
  if (field) setFieldError(field);
  setStatus("修改尚未保存。请先保存，再测试翻译。");
  renderModelHints();
  renderButtons();
}

function readDraft() {
  for (const field of ["baseUrl", "model", "apiKey"]) setFieldError(field);
  const draft = {
    baseUrl: fields.baseUrl.value.trim(),
    model: fields.model.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    disableThinking: fields.disableThinking.checked,
    batchSize: [1, 4, 6, 8].includes(Number(fields.batchSize.value)) ? Number(fields.batchSize.value) : 6,
    concurrency: [1, 2, 3, 4].includes(Number(fields.concurrency.value)) ? Number(fields.concurrency.value) : 3
  };
  let firstInvalid = "";
  try { draft.baseUrl = normalizeApiEndpoint(draft.baseUrl); }
  catch (error) { setFieldError("baseUrl", error.message); firstInvalid = "baseUrl"; }
  if (!draft.model || draft.model.length > 200 || /[\x00-\x1f\x7f]/.test(draft.model)) {
    setFieldError("model", "请填写有效的模型名称，最多 200 个字符。"); firstInvalid ||= "model";
  }
  if (draft.apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(draft.apiKey)) {
    setFieldError("apiKey", "密钥格式不正确，或长度超过 4096 个字符。"); firstInvalid ||= "apiKey";
  }
  if (!firstInvalid && !draft.apiKey && !loopbackUrl(new URL(draft.baseUrl))) {
    setFieldError("apiKey", "远程服务需要 API 密钥。本机服务可留空。");
    firstInvalid = "apiKey";
  }
  if (!firstInvalid && isQwenMtModel(draft.model) && isMiMoEndpoint(draft.baseUrl)) {
    setFieldError("baseUrl", "Qwen-MT 不能使用 MiMo 服务地址。请填写百炼或实际支持此模型的服务地址。");
    firstInvalid = "baseUrl";
  }
  if (!firstInvalid && isQwenMtModel(draft.model) && draft.apiKey && draft.apiKey === savedConfig.apiKey &&
      (isMiMoModel(savedConfig.model) || isMiMoEndpoint(savedConfig.baseUrl)) &&
      apiHostname(draft.baseUrl) !== apiHostname(savedConfig.baseUrl)) {
    setFieldError("apiKey", "更换服务后，请重新填写百炼或新服务的 API 密钥，不能继续使用原 MiMo 密钥。");
    firstInvalid = "apiKey";
  }
  if (firstInvalid) { fields[firstInvalid].focus(); setStatus("请检查标出的设置项。", true); return null; }
  return draft;
}

function safeError(message) {
  let text = typeof message === "string" && message ? message : "请求失败，请检查服务地址、模型、密钥和网络。";
  for (const secret of [savedConfig.apiKey, fields.apiKey.value]) {
    if (secret) text = text.split(secret).join("[密钥已隐藏]");
  }
  return text.slice(0, 500);
}

fields.form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !ready) return;
  const draft = readDraft();
  if (!draft) return;
  busy = true;
  renderButtons();
  setStatus("正在请求服务访问权限…");
  try {
    // Call from the submit gesture before any other awaited action.
    const granted = await chrome.permissions.request({ origins: [`${new URL(draft.baseUrl).origin}/*`] });
    if (!granted) {
      setStatus("未授予服务访问权限，设置未保存。", true);
      return;
    }
    await chrome.storage.local.set({ [API_CONFIG_KEY]: draft });
    savedConfig = { ...draft };
    writeConfigFields(draft);
    dirty = false;
    setStatus("已保存。可测试翻译，再到扩展弹窗选择整句模式。");
  } catch {
    setStatus("保存失败，请重新打开设置页面后重试。", true);
  } finally {
    busy = false;
    renderButtons();
  }
});

fields.test.addEventListener("click", async () => {
  if (busy || dirty || !configComplete(savedConfig)) return;
  busy = true;
  renderButtons();
  setStatus("正在测试已保存的服务设置…");
  fields.translation.textContent = "正在翻译…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "ww-api-test" });
    if (!response?.ok || typeof response.translation !== "string" || !response.translation.trim()) {
      fields.translation.textContent = "未获得译文。";
      setStatus(safeError(response?.error), true);
    } else {
      fields.translation.textContent = response.translation;
      setStatus("测试成功。当前标注方式保持不变。");
    }
  } catch {
    fields.translation.textContent = "未获得译文。";
    setStatus("无法联系扩展翻译服务，请重新加载扩展后重试。", true);
  } finally {
    busy = false;
    renderButtons();
  }
});

fields.clear.addEventListener("click", async () => {
  if (busy || !savedConfig.apiKey) return;
  busy = true;
  renderButtons();
  try {
    const stored = await chrome.storage.local.get(API_CONFIG_KEY);
    const current = stored[API_CONFIG_KEY] || savedConfig;
    const clearedConfig = { ...normalizeOptionsConfig(current), apiKey: "" };
    await chrome.storage.local.set({ [API_CONFIG_KEY]: clearedConfig });
    savedConfig = clearedConfig;
    fields.apiKey.value = "";
    fields.apiKey.type = "password";
    fields.reveal.textContent = "显示";
    fields.reveal.setAttribute("aria-pressed", "false");
    fields.reveal.setAttribute("aria-label", "显示 API 密钥");
    dirty = draftDiffersFrom(savedConfig);
    setFieldError("apiKey");
    setStatus("已清除保存的密钥。服务地址、模型与性能设置保留。");
  } catch {
    setStatus("清除失败，请重新打开设置页面后重试。", true);
  } finally { busy = false; renderButtons(); }
});

fields.reveal.addEventListener("click", () => {
  const reveal = fields.apiKey.type === "password";
  fields.apiKey.type = reveal ? "text" : "password";
  fields.reveal.textContent = reveal ? "隐藏" : "显示";
  fields.reveal.setAttribute("aria-pressed", String(reveal));
  fields.reveal.setAttribute("aria-label", reveal ? "隐藏 API 密钥" : "显示 API 密钥");
});
fields.qwenPreset.addEventListener("click", () => {
  if (busy || !ready) return;
  const previousModel = fields.model.value;
  const previousBaseUrl = fields.baseUrl.value.trim();
  const previousWasMiMo = isMiMoModel(previousModel) || isMiMoEndpoint(previousBaseUrl);
  const preserveAddress = Boolean(apiHostname(previousBaseUrl)) && !previousWasMiMo;
  const preserveKey = preserveAddress && isQwenMtModel(previousModel) &&
    !isMiMoModel(savedConfig.model) && !isMiMoEndpoint(savedConfig.baseUrl) &&
    (apiHostname(previousBaseUrl) === apiHostname(savedConfig.baseUrl) ||
      fields.apiKey.value.trim() !== savedConfig.apiKey);
  fields.model.value = "qwen-mt-flash";
  fields.baseUrl.value = preserveAddress ? previousBaseUrl : "";
  if (!preserveKey) fields.apiKey.value = "";
  fields.apiKey.type = "password";
  fields.reveal.textContent = "显示";
  fields.reveal.setAttribute("aria-pressed", "false");
  fields.reveal.setAttribute("aria-label", "显示 API 密钥");
  fields.batchSize.value = "4";
  fields.concurrency.value = "2";
  for (const field of ["baseUrl", "model", "apiKey"]) setFieldError(field);
  dirty = true;
  renderModelHints();
  renderButtons();
  const nextStep = !preserveAddress
    ? "请填写服务控制台提供的地址和对应密钥，再点击保存。"
    : preserveKey
      ? "已保留当前 Qwen-MT 地址与密钥草稿；确认后点击保存。"
      : "已保留当前服务地址；请确认此服务支持 Qwen-MT，并填写对应密钥，再点击保存。";
  setStatus(`已填写 Qwen-MT 模型和 4 × 2 设置，原保存配置未改动。${nextStep}`);
  (preserveAddress ? fields.apiKey : fields.baseUrl).focus();
});

function parseKeyFile(text) {
  const raw = String(text || "").trim();
  if (!raw || /[\r\n]/.test(raw)) throw new Error("密钥文件需包含一条纯密钥或单行 API_KEY 配置，不能包含多条配置。");
  const assignment = raw.match(/^(?:export\s+)?(?:API_KEY|DASHSCOPE_API_KEY|OPENAI_API_KEY)\s*=\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^"'\r\n]+))$/i);
  const key = (assignment ? assignment[1] || assignment[2] || assignment[3] : raw).trim();
  if (!key || key.length > 4096 || !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(key)) {
    throw new Error("未识别到有效的单条 API 密钥。请使用纯密钥或 API_KEY=密钥 的文本文件。");
  }
  return key;
}

fields.importKey.addEventListener("click", () => {
  if (!busy && ready) fields.keyFile.click();
});

fields.keyFile.addEventListener("change", async () => {
  if (busy || !ready) return;
  const file = fields.keyFile.files?.[0];
  if (!file) return;
  busy = true;
  renderButtons();
  try {
    if (fields.keyFile.files.length !== 1 || !/\.(?:txt|key)$/i.test(file.name) || file.size > 16 * 1024) {
      throw new Error("请选择一个不超过 16 KB 的 .txt 或 .key 密钥文件。");
    }
    const key = parseKeyFile(await file.text());
    fields.apiKey.value = key;
    fields.apiKey.type = "password";
    fields.reveal.textContent = "显示";
    fields.reveal.setAttribute("aria-pressed", "false");
    fields.reveal.setAttribute("aria-label", "显示 API 密钥");
    dirty = true;
    setFieldError("apiKey");
    setStatus("已导入隐藏的密钥草稿，尚未保存。核对服务地址和模型后，点击保存设置。");
  } catch (error) {
    const message = error?.message && /^密钥文件需|^未识别到|^请选择一个/.test(error.message)
      ? error.message : "无法读取密钥文件，请选择纯文本密钥文件后重试。";
    setFieldError("apiKey", message);
    setStatus(message, true);
  } finally {
    fields.keyFile.value = "";
    busy = false;
    renderButtons();
  }
});
for (const field of ["baseUrl", "model", "apiKey"]) fields[field].addEventListener("input", () => markDirty(field));
for (const field of ["disableThinking", "batchSize", "concurrency"]) fields[field].addEventListener("change", () => markDirty());

function renderAnnotationStyle(settings = {}) {
  const size = Number.isFinite(settings.glossSize) ? Math.min(.85, Math.max(.45, settings.glossSize)) : .6;
  const colors = { auto: "inherit", gray: "var(--muted)", teal: "var(--gloss-teal)" };
  document.documentElement.style.setProperty("--gloss-size", `${size}em`);
  document.documentElement.style.setProperty("--gloss-color", colors[settings.glossColor] || colors.auto);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[OPTIONS_SETTINGS_KEY]) renderAnnotationStyle(changes[OPTIONS_SETTINGS_KEY].newValue);
});

async function initializeOptions() {
  try {
    const stored = await chrome.storage.local.get([API_CONFIG_KEY, OPTIONS_SETTINGS_KEY]);
    const config = stored[API_CONFIG_KEY] || {};
    savedConfig = normalizeOptionsConfig(config);
    writeConfigFields(savedConfig);
    renderModelHints();
    renderAnnotationStyle(stored[OPTIONS_SETTINGS_KEY]);
    ready = true;
    renderButtons();
    setStatus(configComplete(savedConfig) ? "已读取保存的设置。点击测试会发送示例句子。" : "填写自己的服务地址、模型和密钥后保存。");
  } catch { setStatus("无法读取设置，请重新打开此页面后重试。", true); }
}

initializeOptions();
