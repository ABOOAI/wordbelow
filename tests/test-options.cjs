"use strict";
// Portable settings regression test. Uses synthetic data and never calls a real API.
// Run from any directory: node path/to/tests/test-options.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "options.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "extension", "manifest.json"), "utf8"));
const checks = [];
function check(name, condition) { assert.ok(condition, name); checks.push(name); }

async function environment(config = {}) {
  const elements = new Map();
  const stored = {
    wwInterlinearApiConfig: structuredClone(config),
    wwInterlinearSettings: { mode: "sentence", enabled: true, autoTranslate: false, glossColor: "custom", customGlossColor: "#347c91" }
  };
  const original = JSON.stringify(stored);
  let writes = 0, permissionRequests = 0, apiRequests = 0;
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) {
        const attributes = new Map(), handlers = new Map();
        const element = {
          id, value: "", textContent: "", type: id === "api-key" ? "password" : "text",
          checked: false, disabled: true, hidden: false,
          classList: { toggle() {} },
          setAttribute(name, value) { attributes.set(name, value); },
          getAttribute(name) { return attributes.get(name); },
          addEventListener(name, handler) { handlers.set(name, handler); },
          async fire(name) { return handlers.get(name)?.({ preventDefault() {} }); },
          focus() { document.activeElement = element; }
        };
        elements.set(id, element);
      }
      return elements.get(id);
    },
    documentElement: { style: { setProperty() {} } }
  };
  const chrome = {
    storage: {
      local: {
        async get() { return structuredClone(stored); },
        async set(value) { writes++; Object.assign(stored, structuredClone(value)); }
      },
      onChanged: { addListener() {} }
    },
    permissions: { async request() { permissionRequests++; return true; } },
    runtime: { async sendMessage() { apiRequests++; return { ok: true, translation: "测试译文" }; } }
  };
  const context = vm.createContext({ document, chrome, URL, console, structuredClone });
  vm.runInContext(source, context, { filename: "options.js" });
  await Promise.resolve();
  await Promise.resolve();
  return {
    field: id => document.getElementById(id),
    document, context, stored, original,
    unchanged: () => JSON.stringify(stored) === original,
    counts: () => ({ writes, permissionRequests, apiRequests })
  };
}

async function presetCase(name, config, expectedAddress, expectedKey) {
  const e = await environment(config);
  check(`${name}: startup preserves settings and credential`, e.unchanged());
  check(`${name}: startup makes no writes or requests`, Object.values(e.counts()).every(value => value === 0));
  await e.field("qwen-preset").fire("click");
  check(`${name}: preset address`, e.field("base-url").value === expectedAddress);
  check(`${name}: preset credential draft`, e.field("api-key").value === expectedKey);
  check(`${name}: Qwen model and 4 × 2`, e.field("model").value === "qwen-mt-flash" && e.field("batch-size").value === "4" && e.field("concurrency").value === "2");
  check(`${name}: existing stored configuration stays unchanged`, e.unchanged());
  check(`${name}: draft remains hidden and untested`, e.field("api-key").type === "password" && e.field("test").disabled && Object.values(e.counts()).every(value => value === 0));
  check(`${name}: relevant field gets keyboard focus`, e.document.activeElement.id === (expectedAddress ? "api-key" : "base-url"));
  check(`${name}: no credential in visible feedback`, !expectedKey || !e.field("form-status").textContent.includes(expectedKey));
  return e;
}

async function main() {
  check("rebranded manifest and version", manifest.name === "词下 · WordBelow" && manifest.version === "1.5.0");
  const blank = await presetCase("new installation", {}, "", "");
  await blank.field("api-form").fire("submit");
  check("empty service address is rejected before permissions or storage", blank.field("base-error").textContent.includes("请填写服务地址") && Object.values(blank.counts()).every(value => value === 0));
  await presetCase("MiMo service", { model: "mimo-v2.6-flash", baseUrl: "https://api.xiaomimimo.com/v1", apiKey: "synthetic-previous-credential", batchSize: 8, concurrency: 4 }, "", "");
  await presetCase("MiMo model on gateway", { model: "provider/mimo-v2.6-flash", baseUrl: "https://gateway.example/v1", apiKey: "synthetic-previous-credential" }, "", "");
  await presetCase("Qwen service", { model: "qwen-mt-flash", baseUrl: "https://provider.example/compatible-mode/v1/chat/completions", apiKey: "synthetic-qwen-credential", disableThinking: false }, "https://provider.example/compatible-mode/v1/chat/completions", "synthetic-qwen-credential");
  await presetCase("compatible non-MiMo gateway", { model: "other-model", baseUrl: "https://gateway.example/v1", apiKey: "synthetic-previous-credential" }, "https://gateway.example/v1", "");
  await presetCase("invalid address", { model: "qwen-mt-flash", baseUrl: "provider.invalid/no-protocol", apiKey: "synthetic-previous-credential" }, "", "");
  await presetCase("remote HTTP address", { model: "qwen-mt-flash", baseUrl: "http://provider.example/v1", apiKey: "synthetic-previous-credential" }, "", "");
  const changedHost = await environment({ model: "qwen-mt-flash", baseUrl: "https://provider.example/v1", apiKey: "synthetic-qwen-credential" });
  changedHost.field("base-url").value = "https://other-provider.example/v1";
  await changedHost.field("qwen-preset").fire("click");
  check("preset clears a saved credential when the draft changes to another host", changedHost.field("base-url").value === "https://other-provider.example/v1" && changedHost.field("api-key").value === "");
  check("cross-host preset leaves stored settings untouched", changedHost.unchanged() && Object.values(changedHost.counts()).every(value => value === 0));
  const qwen = await environment({ model: "qwen-mt-flash", baseUrl: "https://provider.example/v1", apiKey: "synthetic-qwen-credential" });
  await qwen.field("qwen-preset").fire("click");
  await qwen.field("api-form").fire("submit");
  check("explicit save normalizes the retained address and keeps its key", qwen.stored.wwInterlinearApiConfig.baseUrl === "https://provider.example/v1/chat/completions" && qwen.stored.wwInterlinearApiConfig.apiKey === "synthetic-qwen-credential");
  check("explicit save preserves annotation preferences", qwen.stored.wwInterlinearSettings.mode === "sentence" && qwen.stored.wwInterlinearSettings.customGlossColor === "#347c91" && !qwen.stored.wwInterlinearSettings.autoTranslate);
  check("only explicit save requests permission and writes once", qwen.counts().writes === 1 && qwen.counts().permissionRequests === 1 && qwen.counts().apiRequests === 0);
  console.log(JSON.stringify({ passed: true, count: checks.length, checks, realApiCalls: 0 }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
