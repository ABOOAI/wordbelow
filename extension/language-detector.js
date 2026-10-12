/* Local page-language detection. Only the visible original text is sampled. */
(() => {
  "use strict";
  const EXCLUDE = "script,style,noscript,template,textarea,input,select,option,button,pre,code,kbd,samp,svg,math,canvas,video,audio,[contenteditable]:not([contenteditable='false']),[translate='no'],.wwil-gloss,.wwil-sentence-gloss";
  const PRIMARY = "main,article,[role='main']";
  const MAX_CHARS = 12000;
  const MAX_NODES = 3500;

  function detect() {
    const visibleCache = new Map();
    function visible(element) {
      if (!element) return true;
      if (visibleCache.has(element)) return visibleCache.get(element);
      const parent = element.parentElement || (element.getRootNode() instanceof ShadowRoot ? element.getRootNode().host : null);
      let result = !element.matches(EXCLUDE) && !element.hidden && element.getAttribute("aria-hidden") !== "true" && !element.isContentEditable;
      if (result) {
        const style = getComputedStyle(element);
        result = style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.contentVisibility !== "hidden" && Number(style.opacity) !== 0 && visible(parent);
      }
      visibleCache.set(element, result);
      return result;
    }

    const scopes = [document.body || document.documentElement];
    const shadowRoots = [];
    let visited = 0;
    // TreeWalker does not cross shadow boundaries; inspect open roots explicitly.
    for (let index = 0; index < scopes.length && visited < MAX_NODES; index++) {
      const scope = scopes[index];
      if (!scope) continue;
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, {
        acceptNode: node => visible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      function discover(element) {
        if (element.shadowRoot && visible(element)) {
          scopes.push(element.shadowRoot);
          shadowRoots.push(element.shadowRoot);
        }
      }
      if (scope.nodeType === Node.ELEMENT_NODE) discover(scope);
      while (visited++ < MAX_NODES && walker.nextNode()) discover(walker.currentNode);
    }

    function sample(sampleRoots) {
      let text = "", count = 0;
      for (const scope of sampleRoots) {
        if (!scope || text.length >= MAX_CHARS || count >= MAX_NODES) break;
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) return visible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            return visible(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        });
        while (count++ < MAX_NODES && walker.nextNode() && text.length < MAX_CHARS) {
          const node = walker.currentNode;
          if (node.nodeType === Node.TEXT_NODE) text += node.data.slice(0, MAX_CHARS - text.length) + " ";
        }
      }
      return text;
    }
    const primaryRoots = scopes.flatMap(scope => [...(scope?.querySelectorAll(PRIMARY) || [])])
      .filter(element => visible(element) && !element.parentElement?.closest(PRIMARY));
    const primaryShadows = shadowRoots.filter(root => {
      let host = root.host;
      while (host) {
        if (primaryRoots.some(primary => primary.contains(host))) return true;
        const parentRoot = host.getRootNode();
        host = parentRoot instanceof ShadowRoot ? parentRoot.host : null;
      }
      return false;
    });
    // A custom reader inside <main> may keep all its prose in shadow <p>s.
    // Include those roots and avoid sampling a nested primary twice.
    const primarySamples = [...primaryRoots.filter(primary => !primaryShadows.some(root => root.contains(primary))), ...primaryShadows];
    let text = sample(primarySamples);
    if ((text.match(/[A-Za-z\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length < 40) text = sample(scopes);
    const han = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
    const hangul = (text.match(/[\uac00-\ud7af]/g) || []).length;
    const declaredLanguage = (document.documentElement.lang ||
      document.querySelector("meta[http-equiv='content-language' i]")?.content || "").trim().toLowerCase();
    const declaredChinese = /^zh(?:[-_]|$)/.test(declaredLanguage);
    const share = han / Math.max(1, han + latin);
    // Japanese/Korean prose also contains Han characters; avoid treating it as Chinese.
    const otherCjk = !declaredChinese && (kana >= 8 || hangul >= 8) && kana + hangul >= han * 0.2;
    let isChinese = false, reason = "non-chinese";
    if (!otherCjk) {
      if ((han >= 30 && share >= 0.3) || (han >= 8 && share >= 0.5)) {
        isChinese = true; reason = "chinese-content";
      } else if (declaredChinese && ((han >= 2 && share >= 0.12) || latin < 80)) {
        // A declared Chinese loading/empty page waits for real content. Strong
        // English content overrides a stale or incorrect lang="zh" attribute.
        isChinese = true; reason = "chinese-language";
      }
    }
    return { isChinese, reason, declaredLanguage, han, latin, sampleChars: text.length, shadowRoots };
  }
  globalThis.WordWiseLanguage = { detect };
})();
