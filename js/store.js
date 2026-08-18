/* 本地持久化封装：localStorage 读写 + 数据版本迁移 */
(function () {
  'use strict';

  /* 数据结构不兼容变更时递增此值：旧版本数据整体作废，回到默认值 */
  var DATA_VERSION = 1;
  var VERSION_KEY = 'app-data-version';

  function rawGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function rawSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { }
  }

  /* 版本迁移：首次升级时清理全部业务数据，避免旧结构解析异常 */
  (function migrate() {
    var v = rawGet(VERSION_KEY, 0);
    if (v !== DATA_VERSION) {
      ['settings', 'favorites', 'wordbook', 'progress', 'dictCache', 'transCache'].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) { }
      });
      rawSet(VERSION_KEY, DATA_VERSION);
    }
  })();

  var settings = rawGet('settings', null) || {
    engine: 'system', rate: 1.0, voice: '', fontSize: 17,
    apiKey: '', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/tts',
    model: 'doubao-tts-0001', cloudVoiceId: 'zh_female_cancan_mars_bigtts'
  };
  /* 大模型查词配置（OpenAI 兼容协议，与 TTS 密钥相互独立） */
  if (settings.llmApiKey === undefined) settings.llmApiKey = '';
  if (settings.llmBaseUrl === undefined) settings.llmBaseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
  if (settings.llmModel === undefined) settings.llmModel = '';
  if (settings.ttsApi === undefined) settings.ttsApi = 'doubao2'; /* doubao2 双向流式 | ark HTTP兼容 */
  if (settings.theme === undefined) settings.theme = 'system'; /* system | light | dark */
  var favorites = new Set(rawGet('favorites', []));
  var wordbook = rawGet('wordbook', []);
  var progress = rawGet('progress', {});
  var dictCache = rawGet('dictCache', {});
  var transCache = rawGet('transCache', {});

  function trimLru(obj, max) {
    var keys = Object.keys(obj);
    while (keys.length > max) { delete obj[keys.shift()]; }
  }

  window.Store = {
    /* settings */
    settings: settings,
    saveSettings: function () { rawSet('settings', settings); },

    /* favorites */
    favorites: favorites,
    toggleFavorite: function (id) {
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      rawSet('favorites', Array.from(favorites));
      return favorites.has(id);
    },

    /* wordbook */
    wordbook: wordbook,
    saveWordbook: function () { rawSet('wordbook', wordbook); },

    /* progress */
    progress: progress,
    saveProgress: function () { rawSet('progress', progress); },

    /* 本地词典（在线/大模型查词结果收录，离线可用） */
    dictGet: function (word) { return dictCache[word] || null; },
    dictPut: function (word, entry) {
      dictCache[word] = entry;
      trimLru(dictCache, 400);
      rawSet('dictCache', dictCache);
    },
    dictWords: function () { return Object.keys(dictCache); },
    dictRemove: function (word) {
      delete dictCache[word];
      rawSet('dictCache', dictCache);
    },
    dictClear: function () {
      dictCache = {};
      rawSet('dictCache', dictCache);
    },

    /* 翻译结果缓存（释义英译中，命中率高） */
    transGet: function (text) { return transCache[text] || null; },
    transPut: function (text, zh) {
      transCache[text] = zh;
      trimLru(transCache, 600);
      rawSet('transCache', transCache);
    },
    transCount: function () { return Object.keys(transCache).length; }
  };
})();
