/* Sentence-by-sentence annotations that retain native source elements. */
(() => {
  "use strict";
  const GLOSS = ".wwil-sentence-gloss";
  const SKIP = "script,style,noscript,template,textarea,input,select,option,button,pre,code,kbd,samp,svg,math,canvas,video,audio,[contenteditable]:not([contenteditable='false']),[translate='no'],.wwil-token,.wwil-sentence-gloss";
  const BLOCK = "p,li,h1,h2,h3,h4,h5,h6,td,th,figcaption,blockquote,dt,dd,caption,summary";
  const MAX_SENTENCE_LENGTH = 2400;
  const MAX_CACHED_SENTENCES = 300;
  // A slow batch must not prevent later sentences from being translated.
  const GLOBAL_FAILURES = new Set(["AUTH", "RATE_LIMIT", "CONFIG", "PERMISSION", "NETWORK"]);

  function create({ isEligible, mutate, color }) {
    const groups = new Map();
    const glossItems = new WeakMap();
    const memo = new Map();
    const sharedRequests = new Map();
    const workers = new Set();
    let queue = [];
    let generation = 0;
    let current = null;
    let revision = "";
    let viewport = null;
    let processing = false;
    let halted = null;

    const changeDOM = typeof mutate === "function" ? mutate : fn => fn();
    const active = () => current?.enabled !== false && current?.mode === "sentence";

    function nearestBlock(node) {
      let fallback = node.parentElement;
      for (let element = node.parentElement; element; element = element.parentElement) {
        if (element.matches(BLOCK)) return element;
        const display = getComputedStyle(element).display;
        if (["block", "list-item", "table-cell", "table-caption", "flow-root"].includes(display)) return element;
        fallback = element;
      }
      return fallback;
    }

    function auxiliaryText(node) {
      // The core eligibility hook requires Latin letters. Keep punctuation-only
      // and whitespace nodes as well, so sentence boundaries across links work.
      const element = node.parentElement;
      if (!element || !node.isConnected || /[A-Za-z]/.test(node.data)) return false;
      if (element.closest(SKIP) || element.isContentEditable || element.closest("[hidden],[aria-hidden='true']")) return false;
      let root = element.getRootNode();
      while (root instanceof ShadowRoot) {
        if (root.host.closest(SKIP) || root.host.isContentEditable) return false;
        root = root.host.getRootNode();
      }
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    }

    function readSource(container) {
      const parts = [];
      let text = "";
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.parentElement?.closest(GLOSS) || nearestBlock(node) !== container) return NodeFilter.FILTER_REJECT;
          return isEligible(node) || auxiliaryText(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      while (walker.nextNode()) {
        const node = walker.currentNode;
        parts.push({ node, start: text.length, end: text.length + node.data.length });
        text += node.data;
      }
      return { text, parts };
    }

    function sentences(text) {
      let segments;
      if (typeof Intl.Segmenter === "function") {
        segments = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)];
      } else {
        segments = [...text.matchAll(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g)].map(match => ({ segment: match[0], index: match.index }));
      }
      return segments.map(({ segment, index }) => ({
        text: segment.trim(), end: index + segment.trimEnd().length
      })).filter(item => /[A-Za-z]/.test(item.text));
    }

    function styleGloss(gloss) {
      const size = Number(current?.glossSize);
      gloss.style.setProperty("--wwil-sentence-size", `${Number.isFinite(size) ? Math.max(0.45, Math.min(0.85, size)) : 0.6}em`);
      gloss.style.setProperty("--wwil-sentence-color", typeof color === "function" ? color(gloss.parentElement) : "inherit");
      if (Number.isFinite(current?.glossOpacity) && current.glossOpacity >= 0 && current.glossOpacity <= 1) {
        gloss.style.setProperty("--wwil-sentence-opacity", String(current.glossOpacity));
      } else gloss.style.removeProperty("--wwil-sentence-opacity");
    }

    function setLabel(item, label, state) {
      item.state = state;
      changeDOM(() => {
        item.gloss.textContent = label;
        item.gloss.dataset.state = state;
        styleGloss(item.gloss);
      });
    }

    function onlyWhitespaceAfter(child) {
      for (let next = child.nextSibling; next; next = next.nextSibling) {
        if (next.nodeType === Node.TEXT_NODE && !next.data.trim()) continue;
        if (next.nodeType === Node.ELEMENT_NODE && next.matches(GLOSS)) continue;
        return false;
      }
      return true;
    }

    function insertGloss(group, sentence, source) {
      const part = source.parts.find(part => sentence.end > part.start && sentence.end <= part.end);
      if (!part || !part.node.isConnected) return null;
      const offset = sentence.end - part.start;
      const gloss = document.createElement("span");
      gloss.className = "wwil-sentence-gloss";
      gloss.lang = "zh-Hans";
      gloss.setAttribute("aria-hidden", "true");
      gloss.setAttribute("translate", "no");
      const range = document.createRange();
      range.setStart(part.node, offset);
      range.collapse(true);
      group.touched.add(part.node.parentNode);
      // When the sentence ends at the end of an inline link/emphasis node,
      // place the Chinese after that intact ancestor instead of inside it.
      if (!part.node.data.slice(offset).trim()) {
        let child = part.node;
        for (let parent = child.parentElement; parent && parent !== group.container; parent = child.parentElement) {
          const display = getComputedStyle(parent).display;
          if (!onlyWhitespaceAfter(child) || !["inline", "contents", "inline-block"].includes(display)) break;
          range.setStartAfter(parent);
          range.collapse(true);
          child = parent;
        }
      }
      const insertionParent = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentNode : range.startContainer;
      group.touched.add(insertionParent);
      range.insertNode(gloss);
      styleGloss(gloss);
      const item = { group, gloss, text: sentence.text, state: "waiting", generation, revision };
      glossItems.set(gloss, item);
      return item;
    }

    function removeGroup(group) {
      if (groups.get(group.container) === group) groups.delete(group.container);
      group.removed = true;
      for (const item of group.items) viewport?.unobserve(item.gloss);
      changeDOM(() => {
        for (const item of group.items) item.gloss.remove();
        // Range insertion only splits text nodes. Normalizing those parents
        // restores their original serialization without cloning any elements.
        for (const parent of group.touched) parent.normalize();
      });
    }

    function stillCurrent(item, checkSource = true) {
      const group = item.group;
      if (!active() || item.generation !== generation || item.revision !== revision || group.removed || groups.get(group.container) !== group || !item.gloss.isConnected) return false;
      if (checkSource) {
        const fresh = readSource(group.container);
        if (fresh.text !== group.signature) {
          rebuild(group.container);
          return false;
        }
      }
      return true;
    }

    function ensureViewport() {
      if (viewport) return;
      if (typeof IntersectionObserver !== "function") return;
      viewport = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = glossItems.get(entry.target);
          if (item?.state === "waiting") enqueue(item);
        }
      }, { rootMargin: "400px" });
    }

    function enqueue(item) {
      if (item.state !== "waiting" || !stillCurrent(item)) return;
      item.state = "queued";
      viewport?.unobserve(item.gloss);
      queue.push(item);
      pump();
    }

    function cacheTranslation(key, translation) {
      memo.delete(key);
      memo.set(key, translation);
      while (memo.size > MAX_CACHED_SENTENCES) memo.delete(memo.keys().next().value);
      return translation;
    }

    async function translate(text, requestRevision, requestGeneration) {
      const cacheKey = `${requestRevision}\u0000${text}`;
      if (memo.has(cacheKey)) return cacheTranslation(cacheKey, memo.get(cacheKey));
      // A restored page must not join an old in-flight request that the
      // background has cancelled because navigation/activation changed.
      const key = `${requestGeneration}\u0000${cacheKey}`;
      if (sharedRequests.has(key)) return sharedRequests.get(key);
      const request = (async () => {
        let response;
        try { response = await chrome.runtime.sendMessage({ type: "ww-translate-sentence", text }); }
        catch (_) { throw Object.assign(new Error("翻译失败，请检查 API 设置或刷新网页"), { code: "NETWORK" }); }
        if (!response?.ok) {
          const safeError = typeof response?.error === "string" ? response.error.replace(/\s+/g, " ").slice(0, 90) : "翻译失败，请检查 API 设置";
          const code = typeof response?.code === "string" && /^[A-Z_]{1,40}$/.test(response.code) ? response.code : "UNKNOWN";
          throw Object.assign(new Error(safeError), { code });
        }
        const translation = typeof response.translation === "string" ? response.translation.trim() : "";
        if (!translation || translation.length > 10000) throw new Error("未收到有效译文，请检查 API 设置");
        return cacheTranslation(cacheKey, translation);
      })();
      sharedRequests.set(key, request);
      try { return await request; }
      finally { if (sharedRequests.get(key) === request) sharedRequests.delete(key); }
    }

    function haltAfterFailure(item, error) {
      if (!GLOBAL_FAILURES.has(error.code) || !stillCurrent(item, false)) return;
      halted = { code: error.code, label: error.message || "翻译失败，请检查 API 设置" };
      queue = [];
      changeDOM(() => {
        for (const group of groups.values()) for (const queued of group.items) {
          if (!["waiting", "queued"].includes(queued.state)) continue;
          viewport?.unobserve(queued.gloss);
          setLabel(queued, halted.label, "error");
        }
      });
    }

    async function run(item) {
      try {
        if (!stillCurrent(item)) return;
        setLabel(item, "翻译中…", "translating");
        const translation = await translate(item.text, item.revision, item.generation);
        if (stillCurrent(item)) setLabel(item, translation, "done");
      } catch (error) {
        if (stillCurrent(item)) {
          setLabel(item, error.message || "翻译失败，请检查 API 设置", "error");
          haltAfterFailure(item, error);
        }
      } finally {
        workers.delete(item);
        pump();
      }
    }

    function pump() {
      if (!active() || !current.apiConfigured || processing || halted) return;
      const batchSize = [1, 4, 6, 8].includes(Number(current.apiBatchSize)) ? Number(current.apiBatchSize) : 6;
      const concurrency = Number.isInteger(Number(current.apiConcurrency)) ? Math.max(1, Math.min(4, Number(current.apiConcurrency))) : 3;
      const limit = Math.min(32, batchSize * concurrency);
      // Prioritize the prose being read now. Deferred offscreen items stay
      // observed, so scrolling back can enqueue them without losing a sentence.
      queue = queue.filter(item => item.state === "queued" && stillCurrent(item));
      queue.sort((a, b) => viewportDistance(a) - viewportDistance(b));
      const activeWorkers = () => [...workers].filter(item => item.generation === generation && item.revision === revision).length;
      while (activeWorkers() < limit && queue.length) {
        const item = queue.shift();
        if (item.state !== "queued" || !stillCurrent(item)) continue;
        if (viewportDistance(item) > 400) {
          item.state = "waiting";
          viewport?.observe(item.gloss);
          continue;
        }
        workers.add(item);
        // run() contains its own catch/finally; the outer catch also contains
        // unexpected DOM/site errors so they never become unhandled rejections.
        void run(item).catch(() => { workers.delete(item); pump(); });
      }
    }

    function viewportDistance(item) {
      const rect = item.gloss.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= innerHeight) return 0;
      return rect.top > innerHeight ? rect.top - innerHeight : -rect.bottom;
    }

    function rebuild(container) {
      const previous = groups.get(container);
      if (previous) removeGroup(previous);
      if (!active() || !container.isConnected) return;
      const source = readSource(container);
      if (!/[A-Za-z]/.test(source.text)) return;
      const list = sentences(source.text);
      const group = { container, signature: source.text, items: [], touched: new Set(), removed: false };
      groups.set(container, group);
      changeDOM(() => {
        // Reverse insertion keeps earlier character offsets valid.
        for (const sentence of list.reverse()) {
          const item = insertGloss(group, sentence, source);
          if (item) group.items.unshift(item);
        }
      });
      ensureViewport();
      for (const item of group.items) {
        if (item.text.length > MAX_SENTENCE_LENGTH) setLabel(item, "句子过长（超过 2400 字符）", "too-long");
        else if (!current.apiConfigured) setLabel(item, "请先配置 API", "needs-config");
        else if (halted) setLabel(item, halted.label, "error");
        else {
          setLabel(item, "等待翻译…", "waiting");
          if (viewport) viewport.observe(item.gloss);
          else {
            // Fallback only translates sentences near the viewport.
            const rect = item.gloss.getBoundingClientRect();
            if (rect.bottom >= -100 && rect.top <= innerHeight + 100) enqueue(item);
          }
        }
      }
    }

    function processNodes(nodes, settings) {
      if (settings?.enabled === false || settings?.mode !== "sentence") return;
      const nextRevision = String(settings.apiRevision || "") + ":" + Boolean(settings.apiConfigured);
      if (current && nextRevision !== revision) restore();
      current = { ...settings };
      revision = nextRevision;
      processing = true;
      try {
        for (const group of [...groups.values()]) if (!group.container.isConnected) removeGroup(group);
        const containers = new Set();
        for (const node of nodes || []) {
          if (node?.nodeType !== Node.TEXT_NODE || node.parentElement?.closest(GLOSS)) continue;
          const container = nearestBlock(node);
          if (container) containers.add(container);
        }
        for (const container of containers) {
          const source = readSource(container);
          const previous = groups.get(container);
          if (previous?.signature === source.text) {
            changeDOM(() => { for (const item of previous.items) styleGloss(item.gloss); });
            continue;
          }
          rebuild(container);
        }
      } catch (_) {
        // A hostile site may remove nodes during grouping. The root observer
        // will offer its current source nodes again on the next update.
      } finally {
        processing = false;
        pump();
      }
    }

    function restore() {
      generation++;
      queue = [];
      viewport?.disconnect();
      viewport = null;
      current = null;
      halted = null;
      for (const group of [...groups.values()]) removeGroup(group);
      groups.clear();
    }

    function restyle(settings) {
      if (!current) return;
      current = { ...current, glossSize: settings.glossSize, glossColor: settings.glossColor,
        customGlossColor: settings.customGlossColor, glossOpacity: settings.glossOpacity };
      changeDOM(() => { for (const group of groups.values()) for (const item of group.items) styleGloss(item.gloss); });
    }

    function getStatus() {
      let annotated = 0;
      let missing = 0;
      let translating = false;
      let error = halted?.label || "";
      for (const group of groups.values()) for (const item of group.items) {
        if (!item.gloss.isConnected) continue;
        if (item.state === "done") annotated++;
        else if (["error", "needs-config", "too-long"].includes(item.state)) {
          missing++;
          if (!error) error = item.gloss.textContent;
        } else if (["queued", "translating"].includes(item.state)) translating = true;
      }
      return { annotated, missing, phase: !active() ? "idle" : translating ? "translating" : error ? "error" : "ready", error };
    }

    return Object.freeze({ processNodes, restore, restyle, getStatus });
  }

  globalThis.WordWiseSentence = Object.freeze({ create });
})();
