/*
 * WordWise Interlinear — a focused fork of breeze-r/wordwise (MIT).
 * Derived from WordWise's text-node walking, normalization and annotation
 * approach; redesigned for all-word, offline, interlinear reading.
 * Upstream revision and license are recorded in THIRD-PARTY-NOTICES.md.
 */
(() => {
  "use strict";
  if (globalThis.__wwInterlinearLoaded) return;
  globalThis.__wwInterlinearLoaded = true;

  const DEFAULTS = { enabled: true, autoTranslate: false, disabledSites: [], glossSize: 0.6, glossColor: "auto", customGlossColor: "#4b5563", glossOpacity: null, showUnknown: true, mode: "word", apiConfigured: false, apiRevision: 0, apiBatchSize: 6, apiConcurrency: 3 };
  const SKIP = "script,style,noscript,template,textarea,input,select,option,button,pre,code,kbd,samp,svg,math,canvas,video,audio,[contenteditable]:not([contenteditable='false']),[translate='no'],.wwil-token,.wwil-sentence-gloss";
  const TOKEN = /[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g;
  const pending = new Set();
  const roots = new Set();
  const observers = new Map();
  let settings = { ...DEFAULTS };
  let enabled = false;
  let epoch = 0;
  let timer = null;
  let running = false;
  let phase = "starting";
  let error = "";
  let viewportScanTimer = null;
  let mutationDepth = 0;
  let sentenceEngine;
  const isTopFrame = window === window.top;
  let initialized = false;
  let pageActivated = false;
  let pageAutoPaused = false;
  let activationRevision = 0;
  let pageLanguage = { isChinese: false, reason: "pending", han: 0, latin: 0 };
  let topPageChinese = !isTopFrame;
  let topLanguagePending = !isTopFrame;
  let lastPublishedChinese = null;
  let publicationRevision = 0;
  let hostname = location.hostname;
  try { if (!hostname) hostname = new URL(document.referrer).hostname; } catch (_) { /* about:blank */ }

  function normalizeWord(word) {
    return String(word || "").replace(/\u2019/g, "'").replace(/^['-]+|['-]+$/g, "").toLowerCase().trim();
  }

  function parseSettings(value) {
    const input = value && typeof value === "object" ? value : {};
    const size = Number(input.glossSize);
    return {
      enabled: input.enabled !== false,
      autoTranslate: input.autoTranslate === true,
      disabledSites: Array.isArray(input.disabledSites) ? input.disabledSites.filter(s => typeof s === "string") : [],
      glossSize: Number.isFinite(size) ? Math.max(0.45, Math.min(0.85, size)) : DEFAULTS.glossSize,
      glossColor: ["auto", "gray", "teal", "custom"].includes(input.glossColor) ? input.glossColor : "auto",
      customGlossColor: normalizeGlossColor(input.customGlossColor),
      glossOpacity: Number.isFinite(input.glossOpacity) && input.glossOpacity >= 0 && input.glossOpacity <= 1
        ? input.glossOpacity : null,
      showUnknown: input.showUnknown !== false,
      mode: input.mode === "sentence" ? "sentence" : "word",
      apiConfigured: input.apiConfigured === true,
      apiRevision: input.apiRevision || 0,
      apiBatchSize: [1, 4, 6, 8].includes(Number(input.apiBatchSize)) ? Number(input.apiBatchSize) : DEFAULTS.apiBatchSize,
      apiConcurrency: Number.isInteger(Number(input.apiConcurrency)) ? Math.max(1, Math.min(4, Number(input.apiConcurrency))) : DEFAULTS.apiConcurrency
    };
  }

  function normalizeGlossColor(value) {
    const hex = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (/^#[0-9a-f]{3}$/.test(hex)) return "#" + [...hex.slice(1)].map(char => char + char).join("");
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : DEFAULTS.customGlossColor;
  }

  function isBlocked(element) {
    if (!element || element.closest(SKIP)) return true;
    // contenteditable can be inherited through a shadow host.
    if (element.isContentEditable) return true;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? isBlocked(root.host) : false;
  }

  function isEligible(node) {
    if (!node?.isConnected || node.nodeType !== Node.TEXT_NODE || !/[A-Za-z]/.test(node.data)) return false;
    const element = node.parentElement;
    if (!element || isBlocked(element)) return false;
    if (element.closest("[hidden],[aria-hidden='true']")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function tokens(text) {
    return [...text.matchAll(new RegExp(TOKEN.source, "g"))];
  }

  function glossColor(element) {
    if (settings.glossColor === "auto") return "inherit";
    if (settings.glossColor === "custom") return settings.customGlossColor;
    const rgb = getComputedStyle(element).color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
    const lightText = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) > 150;
    return settings.glossColor === "teal" ? (lightText ? "#5eead4" : "#0f766e") : (lightText ? "#d1d5db" : "#4b5563");
  }

  function styleToken(wrapper) {
    wrapper.style.setProperty("--wwil-gloss-size", `${settings.glossSize}em`);
    wrapper.style.setProperty("--wwil-gloss-color", glossColor(wrapper.parentElement || document.body));
    if (settings.glossOpacity === null) wrapper.style.removeProperty("--wwil-gloss-opacity");
    else wrapper.style.setProperty("--wwil-gloss-opacity", String(settings.glossOpacity));
    const gloss = wrapper.querySelector(".wwil-gloss");
    if (gloss) gloss.hidden = !settings.showUnknown && wrapper.dataset.missing === "true";
  }

  function annotateTextNode(node, text, entries) {
    if (!enabled || !isEligible(node) || node.data !== text) return;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    const color = glossColor(node.parentElement);
    for (const match of tokens(text)) {
      const raw = match[0];
      const word = normalizeWord(raw);
      const entry = entries[word];
      const found = typeof entry?.gloss === "string" && entry.gloss.trim();
      if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const wrapper = document.createElement("span");
      wrapper.className = "wwil-token";
      wrapper.dataset.word = word;
      wrapper.dataset.missing = found ? "false" : "true";
      wrapper.style.setProperty("--wwil-gloss-size", `${settings.glossSize}em`);
      wrapper.style.setProperty("--wwil-gloss-color", color);
      if (settings.glossOpacity !== null) wrapper.style.setProperty("--wwil-gloss-opacity", String(settings.glossOpacity));
      const source = document.createElement("span");
      source.className = "wwil-source";
      source.lang = "en";
      source.textContent = raw;
      const gloss = document.createElement("span");
      gloss.className = "wwil-gloss";
      gloss.lang = "zh-Hans";
      gloss.setAttribute("aria-hidden", "true");
      gloss.textContent = found ? entry.gloss.trim() : "未收录";
      gloss.title = found ? (entry.full || entry.gloss) : "本地词典未收录此词，可能是专有名词、缩写或拼写变体。";
      gloss.hidden = !found && !settings.showUnknown;
      wrapper.append(source, gloss);
      fragment.appendChild(wrapper);
      lastIndex = match.index + raw.length;
    }
    if (lastIndex === 0) return;
    if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.replaceWith(fragment);
  }

  function schedule(delay = 80) {
    if (!enabled || running || timer !== null) return;
    timer = setTimeout(() => { timer = null; void drain(); }, delay);
  }

  async function drain() {
    if (!enabled || running) return;
    running = true;
    const revision = epoch;
    phase = "annotating";
    try {
      while (enabled && revision === epoch && pending.size) {
        const batch = [];
        const words = new Set();
        let length = 0;
        for (const node of pending) {
          pending.delete(node);
          if (!isEligible(node)) continue;
          const text = node.data;
          batch.push({ node, text });
          for (const match of tokens(text)) words.add(normalizeWord(match[0]));
          length += text.length;
          if (batch.length >= 35 || length >= 10000) break;
        }
        if (!batch.length) continue;
        if (settings.mode === "sentence") {
          sentenceEngine.processNodes(batch.map(item => item.node), settings);
          await new Promise(resolve => setTimeout(resolve, 0));
          continue;
        }
        const entries = await globalThis.WordWiseDictionary.lookupMany([...words]);
        if (!enabled || revision !== epoch) break;
        // Ignore our own DOM changes, but keep observing page-created updates.
        disconnectObservers();
        try { for (const item of batch) annotateTextNode(item.node, item.text, entries); }
        finally { connectObservers(); }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (revision === epoch) { phase = "ready"; error = ""; }
    } catch (err) {
      phase = "error";
      error = "词典读取失败，请在扩展管理页重新加载后刷新网页。";
      console.warn("词下 WordBelow：", err);
    } finally {
      running = false;
      if (pending.size && enabled && phase !== "error") schedule();
    }
  }

  function collect(root) {
    if (!enabled || !root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (isEligible(root)) pending.add(root);
      schedule();
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE && isBlocked(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) return isBlocked(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return isEligible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    if (root.shadowRoot) observeRoot(root.shadowRoot);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) pending.add(node);
      else if (node.shadowRoot) observeRoot(node.shadowRoot);
    }
    schedule();
  }

  function onMutations(records) {
    if (!shouldMonitor()) return;
    // Reclassify before collecting new English. A Chinese route must never be
    // annotated transiently, and skipped pages still observe dynamic content.
    refreshLanguage();
    if (!enabled) return;
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.addedNodes) collect(node);
      } else if (record.type === "characterData") {
        // Page scripts may edit an existing English span after annotation.
        const wrapper = record.target.parentElement?.closest(".wwil-token");
        if (wrapper) {
          if (record.target.parentElement?.closest(".wwil-gloss")) continue;
          disconnectObservers();
          const source = wrapper.querySelector(".wwil-source")?.textContent || "";
          const text = document.createTextNode(source);
          wrapper.replaceWith(text);
          connectObservers();
          collect(text);
        } else collect(record.target);
      } else collect(record.target);
    }
  }

  const OBSERVE = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class", "style", "contenteditable", "aria-hidden", "lang", "content"] };
  function disconnectObservers() { for (const observer of observers.values()) observer.disconnect(); }
  function connectObservers() {
    if (!shouldMonitor() || mutationDepth > 0) return;
    for (const [root, observer] of observers) {
      if (root instanceof ShadowRoot && !root.host.isConnected) continue;
      observer.observe(root, OBSERVE);
    }
  }
  function mutate(fn) {
    mutationDepth++;
    disconnectObservers();
    try { return fn(); }
    finally { mutationDepth--; connectObservers(); }
  }
  function observeRoot(root) {
    if (roots.has(root)) return;
    roots.add(root);
    observers.set(root, new MutationObserver(onMutations));
    if (root instanceof ShadowRoot) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = chrome.runtime.getURL("content.css");
      style.dataset.wwilStyle = "true";
      root.appendChild(style);
      const sentenceStyle = document.createElement("link");
      sentenceStyle.rel = "stylesheet";
      sentenceStyle.href = chrome.runtime.getURL("sentence.css");
      sentenceStyle.dataset.wwilStyle = "true";
      root.appendChild(sentenceStyle);
    }
    if (shouldMonitor() && mutationDepth === 0) observers.get(root).observe(root, OBSERVE);
    collect(root);
  }

  function allTokens() {
    return [...roots].flatMap(root => [...root.querySelectorAll(".wwil-token")]).filter(token => token.isConnected);
  }
  function restore() {
    disconnectObservers();
    pending.clear();
    mutate(() => {
      sentenceEngine?.restore();
      for (const wrapper of allTokens()) {
        wrapper.replaceWith(document.createTextNode(wrapper.querySelector(".wwil-source")?.textContent || ""));
      }
    });
  }

  function shouldMonitor() {
    return initialized && settings.enabled && !settings.disabledSites.includes(hostname);
  }

  function skipReason() {
    if (!settings.enabled) return "global-disabled";
    if (settings.disabledSites.includes(hostname)) return "site-paused";
    if (topLanguagePending) return "language-detection";
    if (pageLanguage.isChinese || topPageChinese) return "chinese-page";
    if (pageActivated) return "";
    if (settings.autoTranslate) return pageAutoPaused ? "auto-paused" : "";
    return "not-activated";
  }

  async function publishLanguage(force = false) {
    if (!isTopFrame || (!force && lastPublishedChinese === pageLanguage.isChinese)) return;
    const decision = pageLanguage.isChinese;
    const revision = ++publicationRevision;
    lastPublishedChinese = decision;
    try {
      const response = await chrome.runtime.sendMessage({ type: "ww-set-page-language", isChinese: decision });
      if (!response?.ok) {
        if (revision === publicationRevision) lastPublishedChinese = null;
        return false;
      }
      if (revision === publicationRevision && decision === pageLanguage.isChinese) {
        topLanguagePending = false;
        if (initialized) applySettings(settings, true);
      }
      return true;
    } catch (_) {
      if (revision === publicationRevision) lastPublishedChinese = null;
      return false;
    }
  }

  function refreshLanguage(publish = true) {
    const wasChinese = pageLanguage.isChinese;
    pageLanguage = globalThis.WordWiseLanguage.detect();
    if (isTopFrame && initialized && wasChinese && !pageLanguage.isChinese) topLanguagePending = true;
    // Observe shadow content even while Chinese translation is skipped.
    mutate(() => { for (const root of pageLanguage.shadowRoots) observeRoot(root); });
    applySettings(settings, true);
    if (publish) void publishLanguage();
  }

  function applySettings(value, languageOnly = false) {
    const previous = settings;
    settings = parseSettings(value);
    if (!languageOnly) {
      const wasChinese = pageLanguage.isChinese;
      pageLanguage = globalThis.WordWiseLanguage.detect();
      if (isTopFrame && initialized && wasChinese && !pageLanguage.isChinese) topLanguagePending = true;
      if (initialized) mutate(() => { for (const root of pageLanguage.shadowRoots) observeRoot(root); });
      void publishLanguage();
    }
    const nextEnabled = initialized && !skipReason();
    const changed = nextEnabled !== enabled || previous.mode !== settings.mode || previous.apiRevision !== settings.apiRevision || previous.apiConfigured !== settings.apiConfigured;
    enabled = nextEnabled;
    if (changed) {
      epoch++;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      restore();
      if (!enabled) { phase = skipReason() === "chinese-page" ? "skipped" : "paused"; }
      else { phase = "annotating"; connectObservers(); for (const root of roots) collect(root); }
    } else if (enabled && !languageOnly) {
      disconnectObservers();
      try { for (const wrapper of allTokens()) styleToken(wrapper); sentenceEngine?.restyle(settings); }
      finally { connectObservers(); }
    }
    if (!enabled) phase = skipReason() === "chinese-page" ? "skipped" : "paused";
    if (shouldMonitor()) connectObservers();
    else disconnectObservers();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ww-settings-updated") {
      applySettings(message.settings);
      return false;
    }
    if (message?.type === "ww-request-page-language" && isTopFrame) {
      (async () => {
        refreshLanguage(false);
        const published = await publishLanguage(true);
        sendResponse({ isChinese: pageLanguage.isChinese, pending: !published });
      })().catch(() => sendResponse({ isChinese: true, pending: true }));
      return true;
    }
    if (message?.type === "ww-page-activation-updated") {
      activationRevision++;
      pageActivated = typeof message.manualActive === "boolean" ? message.manualActive : message.active === true;
      pageAutoPaused = message.autoPaused === true;
      if (initialized) refreshLanguage();
      return false;
    }
    if (message?.type === "ww-top-language-updated") {
      if (!isTopFrame) {
        topPageChinese = message.isChinese === true;
        topLanguagePending = message.pending === true;
        if (initialized) refreshLanguage(false);
      } else if (message.pending && initialized) {
        // pushState changes the current document, so republish even when the
        // boolean stays English. A full navigation instead awaits the new script.
        topLanguagePending = true;
        refreshLanguage(false);
        if (message.reason === "url-changed") void publishLanguage(true);
      }
      return false;
    }
    if (message?.type !== "ww-interlinear-status") return false;
    const languageStatus = { skipReason: skipReason(), activated: pageActivated || (settings.autoTranslate && !pageAutoPaused),
      triggerMode: settings.autoTranslate ? "auto" : "manual", pagePaused: pageAutoPaused,
      language: { reason: pageLanguage.reason, han: pageLanguage.han, latin: pageLanguage.latin } };
    if (settings.mode === "sentence") {
      const status = sentenceEngine?.getStatus() || { phase: "starting", annotated: 0, missing: 0 };
      sendResponse({ enabled, ...status, ...languageStatus, phase: enabled ? status.phase : phase });
      return false;
    }
    const annotations = allTokens();
    sendResponse({ enabled, annotated: annotations.length, missing: annotations.filter(t => t.dataset.missing === "true").length, phase, error, ...languageStatus });
    return false;
  });

  // Copy the English original, even when a selection crosses the annotations.
  document.addEventListener("copy", event => {
    const selection = document.getSelection();
    if (!enabled || !event.clipboardData || !selection?.rangeCount || selection.isCollapsed) return;
    const fragment = selection.getRangeAt(0).cloneContents();
    if (!fragment.querySelector(".wwil-token,.wwil-gloss,.wwil-sentence-gloss")) return;
    fragment.querySelectorAll(".wwil-gloss,.wwil-sentence-gloss").forEach(node => node.remove());
    fragment.querySelectorAll(".wwil-token,.wwil-source").forEach(node => node.replaceWith(...node.childNodes));
    const box = document.createElement("div");
    box.appendChild(fragment);
    event.clipboardData.setData("text/plain", box.textContent);
    event.clipboardData.setData("text/html", box.innerHTML);
    event.preventDefault();
  }, true);

  async function start() {
    sentenceEngine = globalThis.WordWiseSentence.create({ isEligible, mutate, color: glossColor });
    const activationAtStart = activationRevision;
    const [data, activation] = await Promise.all([
      chrome.runtime.sendMessage({ type: "ww-get-settings" }),
      chrome.runtime.sendMessage({ type: "ww-get-page-activation" })
    ]);
    if (activationRevision === activationAtStart) {
      pageActivated = typeof activation?.manualActive === "boolean" ? activation.manualActive : activation?.active === true;
      pageAutoPaused = activation?.autoPaused === true;
    }
    settings = parseSettings(data?.settings);
    pageLanguage = globalThis.WordWiseLanguage.detect();
    if (isTopFrame) await publishLanguage(true);
    else {
      const top = await chrome.runtime.sendMessage({ type: "ww-get-top-page-language" });
      topPageChinese = top?.isChinese !== false;
      topLanguagePending = top?.pending !== false;
    }
    observeRoot(document.documentElement);
    initialized = true;
    refreshLanguage();
    // Pick up previously hidden text or newly attached open shadow roots.
    window.addEventListener("pageshow", event => {
      if (event.persisted) {
        // Back/forward caching revives this script and its old local variables.
        // Returning to a document still requires a fresh manual activation.
        activationRevision++;
        pageActivated = false;
        pageAutoPaused = false;
        if (isTopFrame) topLanguagePending = true;
        refreshLanguage(false);
        if (isTopFrame) void (async () => {
          await chrome.runtime.sendMessage({ type: "ww-reset-page-activation" });
          await publishLanguage(true);
        })().catch(() => {});
      } else {
        refreshLanguage();
        if (enabled) for (const root of roots) collect(root);
      }
    });
    const scanViewportChanges = () => {
      if (!shouldMonitor() || viewportScanTimer !== null) return;
      viewportScanTimer = setTimeout(() => {
        viewportScanTimer = null;
        refreshLanguage();
        if (enabled) for (const root of roots) collect(root);
      }, 700);
    };
    window.addEventListener("scroll", scanViewportChanges, { passive: true });
    window.addEventListener("resize", scanViewportChanges, { passive: true });
  }
  void start().catch(err => { phase = "error"; error = "扩展初始化失败，请刷新页面。"; console.warn(error, err); });
})();
