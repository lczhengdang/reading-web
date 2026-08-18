/* 词典服务：词性解析 / 翻译降级链 / 在线查词（错误分类 + 渐进回填） */
(function () {
  'use strict';

  var Store = window.Store;

  /* ---- 词性解析 ---- */
  var POS_RE = /^(n|v|vt|vi|adj|adv|prep|conj|pron|num|int|interj|art|det|aux|abbr|modal)\.\s*/i;
  var POS_ABBR = {
    noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.',
    pronoun: 'pron.', preposition: 'prep.', conjunction: 'conj.',
    interjection: 'int.', exclamation: 'int.', determiner: 'det.',
    article: 'art.', number: 'num.', 'modal verb': 'modal',
    'phrasal verb': 'phr.v.', abbreviation: 'abbr.'
  };
  function parseDefs(definition) {
    var segs = String(definition).split(';');
    var out = []; var cur = '';
    segs.forEach(function (s) {
      s = s.trim(); if (!s) return;
      var m = s.match(POS_RE);
      if (m) { cur = m[1].toLowerCase() + '.'; s = s.slice(m[0].length).trim(); }
      if (s) out.push({ pos: cur, text: s });
    });
    return out;
  }

  /* ---- 翻译：多源降级链（MyMemory -> Google 公开接口），结果持久化缓存 ---- */
  function transMyMemory(text) {
    return fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en%7Czh-CN')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        if (j && j.responseStatus === 200 && j.responseData && j.responseData.translatedText) {
          var zh = String(j.responseData.translatedText).trim();
          if (zh && zh.toUpperCase() !== 'MYMEMORY WARNING') return zh;
        }
        throw new Error('mymemory failed');
      });
  }
  function transGoogle(text) {
    return fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' + encodeURIComponent(text))
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        if (Array.isArray(j) && Array.isArray(j[0])) {
          var zh = j[0].map(function (seg) { return seg[0] || ''; }).join('').trim();
          if (zh) return zh;
        }
        throw new Error('google failed');
      });
  }
  var PROVIDERS = [transMyMemory, transGoogle];

  function tryProviders(text, i) {
    if (i >= PROVIDERS.length) return Promise.reject(new Error('all providers failed'));
    return PROVIDERS[i](text).catch(function () { return tryProviders(text, i + 1); });
  }

  function translateText(text) {
    var cached = Store.transGet(text);
    if (cached) return Promise.resolve(cached);
    return tryProviders(text, 0).then(function (zh) {
      Store.transPut(text, zh);
      return zh;
    });
  }

  /* ---- 中文释义并发回填（限流 3 并发 + 9s 兜底） ---- */
  function fillTranslations(word, entry, cb) {
    var remaining = entry.items.slice();
    var done = 0;
    var finished = false;
    var CONCURRENCY = 3;
    function finish(final) {
      if (finished) return;
      finished = true;
      /* 缓存写入与弹窗是否存活解耦：查词完成即入库 */
      if (final) Store.dictPut(word, entry);
      cb(entry, final);
    }
    var safety = setTimeout(function () { finish(true); }, 9000);
    function work() {
      var it = remaining.shift();
      if (!it) {
        done++;
        if (done === CONCURRENCY) { clearTimeout(safety); finish(true); }
        return;
      }
      translateText(it.en).then(function (zh) {
        it.zh = zh;
        if (!finished) cb(entry, false);
      }, function () { }).then(work);
    }
    for (var i = 0; i < CONCURRENCY; i++) work();
  }

  /* ---- 在线查词 ----
     cb(entry, final)：entry 更新（final=true 表示翻译全部完成）
     onNotFound()：接口正常但该词未收录
     onError()：网络/接口错误（可提示重试） */
  function fetchOnlineDict(word, cb, onNotFound, onError) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
    fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word), {
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (r.status === 404) return null; /* 接口明确表示未收录 */
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) {
      clearTimeout(timer);
      if (!data) { onNotFound(); return; }
      if (!Array.isArray(data) || !data[0] || !data[0].meanings) { onNotFound(); return; }
      var e = data[0];
      var ph = e.phonetic || '';
      if (!ph && e.phonetics) {
        for (var i = 0; i < e.phonetics.length; i++) { if (e.phonetics[i].text) { ph = e.phonetics[i].text; break; } }
      }
      var items = [];
      e.meanings.forEach(function (m) {
        var tag = POS_ABBR[m.partOfSpeech] || m.partOfSpeech || '';
        (m.definitions || []).slice(0, 2).forEach(function (d) {
          items.push({ pos: tag, en: d.definition });
        });
      });
      if (!items.length) { onNotFound(); return; }
      items = items.slice(0, 8);
      var entry = {
        phonetic: ph.replace(/^\/|\/$/g, ''),
        items: items.map(function (it) { return { pos: it.pos, zh: it.en, en: it.en }; })
      };
      /* 先用英文释义立即出结果，中文翻译并发回填 */
      cb(entry, false);
      fillTranslations(word, entry, cb);
    }).catch(function () { clearTimeout(timer); onError(); });
  }

  window.Dict = {
    parseDefs: parseDefs,
    translateText: translateText,
    fetchOnlineDict: fetchOnlineDict
  };
})();
