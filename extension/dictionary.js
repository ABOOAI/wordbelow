/* Local Chinese single-word glossary. No remote translation service is used. */
(() => {
  "use strict";
  const MAX_CACHED_SHARDS = 4;
  const MAX_CACHED_WORDS = 20000;
  const cache = new Map();
  const pending = new Map();
  const wordCache = new Map();
  // Short function words and contracted forms are authored concise glosses.
  // They are intentionally included even when an ordinary learner word list
  // would filter them out. A slash indicates alternative dictionary senses.
  const common = Object.freeze({
    "i": "我", "a": "一；不定冠词", "an": "一；不定冠词", "the": "定冠词",
    "am": "是", "is": "是", "are": "是", "was": "是（过去）", "were": "是（过去）",
    "be": "是；成为", "been": "是（完成式）", "being": "是；存在",
    "to": "到；向", "of": "的；属于", "in": "在…里", "on": "在…上",
    "at": "在；于", "by": "由；通过", "as": "作为；如同", "or": "或者",
    "if": "如果", "so": "所以；如此", "it": "它", "its": "它的",
    "he": "他", "she": "她", "we": "我们", "us": "我们", "me": "我",
    "my": "我的", "you": "你；你们", "your": "你的；你们的", "his": "他的",
    "her": "她；她的", "our": "我们的", "they": "他们；它们", "them": "他们；它们",
    "their": "他们的；它们的", "do": "做；助动词", "does": "做；助动词",
    "did": "做（过去）", "done": "做完；完成", "no": "不；没有", "not": "不",
    "yes": "是；好的", "and": "和；并且", "but": "但是", "for": "为了；给",
    "from": "从；来自", "with": "和；用", "up": "向上", "out": "向外",
    "off": "离开；关闭", "into": "进入…里", "have": "有；助动词", "has": "有；助动词",
    "had": "有（过去）", "can": "能；可以", "could": "能；可能", "may": "可以；可能",
    "might": "可能", "must": "必须", "will": "将会", "would": "会；愿意",
    "shall": "将；应当", "should": "应该", "this": "这；这个", "that": "那；那个",
    "these": "这些", "those": "那些", "there": "那里", "here": "这里",
    "what": "什么", "who": "谁", "why": "为什么", "how": "怎样", "when": "何时",
    "where": "哪里", "which": "哪一个", "than": "比", "then": "然后；那时",
    "now": "现在", "all": "全部", "any": "任何；一些", "some": "一些",
    "each": "每个", "every": "每个", "both": "两者", "one": "一；一个",
    "two": "二；两个", "only": "仅仅", "very": "非常", "too": "也；太",
    "also": "也", "just": "刚刚；仅仅", "more": "更多", "most": "最多；大多数",
    "less": "更少", "much": "许多", "many": "许多", "such": "这样的",
    "own": "自己的；拥有", "same": "相同的", "other": "其他的", "another": "另一个",
    "like": "喜欢；像", "help": "帮助", "helps": "帮助", "reading": "阅读",
    "rain": "雨；下雨", "rains": "下雨", "rained": "下雨（过去）", "raining": "下雨",
    "it's": "它是；它已", "i'm": "我是", "you're": "你是；你们是", "we're": "我们是",
    "they're": "他们是；它们是", "he's": "他是；他已", "she's": "她是；她已",
    "that's": "那是；那已", "there's": "有；那里是", "here's": "这是",
    "what's": "什么是", "who's": "谁是；谁已", "where's": "哪里是",
    "isn't": "不是", "aren't": "不是", "wasn't": "不是（过去）", "weren't": "不是（过去）",
    "don't": "不；不要", "doesn't": "不", "didn't": "没有（过去）", "can't": "不能",
    "cannot": "不能", "couldn't": "不能（过去）", "won't": "将不会", "wouldn't": "不会；不愿",
    "shouldn't": "不应该", "mustn't": "不许", "haven't": "尚未；没有", "hasn't": "尚未；没有",
    "hadn't": "尚未（过去）", "needn't": "不必", "shan't": "将不会", "let's": "让我们",
    "i've": "我已；我有", "you've": "你已；你有", "we've": "我们已；我们有",
    "they've": "他们已；他们有", "i'll": "我将", "you'll": "你将；你们将",
    "he'll": "他将", "she'll": "她将", "it'll": "它将", "we'll": "我们将", "they'll": "他们将",
    "i'd": "我会；我曾", "you'd": "你会；你曾", "he'd": "他会；他曾", "she'd": "她会；她曾",
    "we'd": "我们会；我们曾", "they'd": "他们会；他们曾", "it'd": "它会；它曾"
  });

  function normalize(word) {
    return typeof word === "string"
      ? word.normalize("NFKC").replace(/[‘’]/g, "'").trim().toLowerCase()
      : "";
  }

  function touch(name, data) {
    cache.delete(name);
    cache.set(name, data);
    while (cache.size > MAX_CACHED_SHARDS) cache.delete(cache.keys().next().value);
    return data;
  }

  function rememberWord(word, value) {
    wordCache.delete(word);
    wordCache.set(word, value);
    while (wordCache.size > MAX_CACHED_WORDS) wordCache.delete(wordCache.keys().next().value);
    return value;
  }

  async function loadShard(name) {
    if (cache.has(name)) return touch(name, cache.get(name));
    if (pending.has(name)) return pending.get(name);
    const request = (async () => {
      const url = chrome.runtime.getURL(`dictionary/${name}.json`);
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Local dictionary shard ${name} could not load (${response.status}).`);
      const data = await response.json();
      return touch(name, data);
    })();
    pending.set(name, request);
    try {
      return await request;
    } finally {
      pending.delete(name);
    }
  }

  async function lookupMany(words = []) {
    const keys = [...new Set(Array.from(words, normalize).filter(Boolean))];
    const result = Object.create(null);
    const groups = new Map();
    for (const word of keys) {
      if (Object.hasOwn(common, word)) {
        result[word] = { gloss: common[word], source: "常用词简释" };
        continue;
      }
      if (wordCache.has(word)) {
        result[word] = rememberWord(word, wordCache.get(word));
        continue;
      }
      const name = /^[a-z]/.test(word) ? word[0] : "other";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(word);
    }
    await Promise.all([...groups].map(async ([name, group]) => {
      const data = await loadShard(name);
      for (const word of group) {
        const value = Object.hasOwn(data, word) ? data[word] : null;
        if (!value) result[word] = rememberWord(word, null);
        else if (Array.isArray(value)) result[word] = rememberWord(word, { gloss: value[0], full: value[1], source: "ECDICT" });
        else result[word] = rememberWord(word, { gloss: value, source: "ECDICT" });
      }
    }));
    return result;
  }

  globalThis.WordWiseDictionary = Object.freeze({
    lookupMany,
    normalize,
    getStats: () => ({ cachedShards: cache.size, pendingShards: pending.size, maxCachedShards: MAX_CACHED_SHARDS, cachedWords: wordCache.size, maxCachedWords: MAX_CACHED_WORDS, commonOverrides: Object.keys(common).length })
  });
})();
