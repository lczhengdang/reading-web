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
    'phrasal verb': 'phr.v.', abbreviation: 'abbr.',
    adj: 'adj.', adv: 'adv.'
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

  /* ---- 带超时的 fetch（避免单请求挂起） ---- */
  function fetchWithTimeout(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(timer); return r; })
      .catch(function (e) { clearTimeout(timer); throw e; });
  }

  /* ---- 翻译：多源降级链（MyMemory -> Google 公开接口），结果持久化缓存 ---- */
  function transMyMemory(text) {
    return fetchWithTimeout('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en%7Czh-CN', 5000)
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
    return fetchWithTimeout('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' + encodeURIComponent(text), 5000)
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

  /* ---- 在线查词：多源降级链（dictionaryapi.dev -> Wiktionary） ----
     cb(entry, final)：entry 更新（final=true 表示翻译全部完成）
     onNotFound()：所有源均未收录该词
     onError()：所有源均网络/接口错误（可提示重试） */
  var NOT_FOUND = { notFound: true };

  function buildEntry(phonetic, defs) {
    return {
      phonetic: String(phonetic || '').replace(/^\/|\/$/g, ''),
      items: defs.map(function (it) { return { pos: it.pos, zh: it.en, en: it.en }; })
    };
  }

  /* 源 1：Free Dictionary API（404 表示未收录） */
  function dictFreeDict(word) {
    return fetchWithTimeout('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word), 8000)
      .then(function (r) {
        if (r.status === 404) return NOT_FOUND;
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (data) {
        if (data === NOT_FOUND) return NOT_FOUND;
        if (!Array.isArray(data) || !data[0] || !data[0].meanings) return NOT_FOUND;
        var e = data[0];
        var ph = e.phonetic || '';
        if (!ph && e.phonetics) {
          for (var i = 0; i < e.phonetics.length; i++) { if (e.phonetics[i].text) { ph = e.phonetics[i].text; break; } }
        }
        var defs = [];
        e.meanings.forEach(function (m) {
          var tag = POS_ABBR[m.partOfSpeech] || m.partOfSpeech || '';
          (m.definitions || []).slice(0, 2).forEach(function (d) {
            defs.push({ pos: tag, en: d.definition });
          });
        });
        if (!defs.length) return NOT_FOUND;
        return buildEntry(ph, defs.slice(0, 8));
      });
  }

  /* 源 2：Datamuse（CORS 开放、国内可达；defs 格式 "pos\t释义"，无音标） */
  function stemCandidates(word) {
    var cands = [word];
    if (/ies$/.test(word) && word.length > 4) cands.push(word.replace(/ies$/, 'y'));           /* cities -> city */
    if (/sses$/.test(word)) cands.push(word.replace(/sses$/, 'ss'));                            /* classes -> class */
    if (/ches$|shes$|xes$|zes$/.test(word)) cands.push(word.replace(/es$/, ''));                /* watches -> watch */
    if (/[^s]s$/.test(word) && !/ss$/.test(word)) cands.push(word.replace(/s$/, ''));           /* gets -> get */
    if (/ied$/.test(word) && word.length > 4) cands.push(word.replace(/ied$/, 'y'));            /* carried -> carry */
    if (/ed$/.test(word) && word.length > 3) {
      cands.push(word.replace(/ed$/, ''));                                                      /* ignited -> ignit */
      cands.push(word.replace(/ed$/, 'e'));                                                     /* ignited -> ignite */
      if (!/[^aeiou][aeiou][^aeiouwxy]$/.test(word.slice(0, -2))) {
        cands.push(word.replace(/([bdfgklmnprt])\1ed$/, '$1'));                                 /* dropped -> drop */
      }
    }
    if (/ing$/.test(word) && word.length > 4) {
      cands.push(word.replace(/ing$/, ''));                                                     /* firing -> fir */
      cands.push(word.replace(/ing$/, 'e'));                                                    /* firing -> fire */
      cands.push(word.replace(/([bdfgklmnprt])\1ing$/, '$1'));                                  /* running -> run */
    }
    var seen = {};
    return cands.filter(function (c) {
      if (c.length < 3 || seen[c]) return false;
      seen[c] = 1; return true;
    });
  }
  function datamuseLookup(word, cands, i) {
    if (i >= cands.length) return Promise.resolve(NOT_FOUND);
    return fetchWithTimeout('https://api.datamuse.com/words?sp=' + encodeURIComponent(cands[i]) + '&md=d&max=3', 8000)
      .then(function (r) {
        if (!r.ok) throw new Error('datamuse http ' + r.status);
        return r.json();
      }).then(function (arr) {
        if (!Array.isArray(arr)) return datamuseLookup(word, cands, i + 1);
        var exact = arr.filter(function (e) { return e.word && e.word.toLowerCase() === cands[i].toLowerCase(); })[0];
        if (!exact || !exact.defs || !exact.defs.length) return datamuseLookup(word, cands, i + 1);
        var defs = [];
        exact.defs.slice(0, 8).forEach(function (d) {
          var tab = d.indexOf('\t');
          var pos = tab >= 0 ? (POS_ABBR[d.slice(0, tab)] || d.slice(0, tab) + '.') : '';
          var en = (tab >= 0 ? d.slice(tab + 1) : d).trim();
          if (en.length > 3) defs.push({ pos: pos, en: en });
        });
        if (!defs.length) return datamuseLookup(word, cands, i + 1);
        return buildEntry('', defs);
      });
  }
  function dictDatamuse(word) {
    return datamuseLookup(word, stemCandidates(word), 0);
  }

  /* 源 3：Wiktionary 官方 API（origin=* 原生支持 CORS；部分网络环境不可达，作为末位兜底） */
  var WIKT_POS = { noun: 1, verb: 1, adjective: 1, adverb: 1, pronoun: 1, preposition: 1, conjunction: 1, interjection: 1, determiner: 1, article: 1, numeral: 1 };
  function cleanWikiDef(s) {
    while (/\{\{[^{}]*\}\}/.test(s)) s = s.replace(/\{\{[^{}]*\}\}/g, ''); /* 逐层剥离嵌套模板 */
    return s
      .replace(/<ref[^>]*\/>/g, '')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
      .replace(/\[\[[^\[\]|]*\|([^\[\]]*)\]\]/g, '$1')
      .replace(/\[\[([^\[\]]*)\]\]/g, '$1')
      .replace(/''+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function dictWiktionary(word) {
    return fetchWithTimeout('https://en.wiktionary.org/w/api.php?action=parse&page=' + encodeURIComponent(word) + '&prop=wikitext&format=json&origin=*', 8000)
      .then(function (r) {
        if (!r.ok) throw new Error('wiktionary http ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || j.error || !j.parse || !j.parse.wikitext) return NOT_FOUND;
        var wt = j.parse.wikitext['*'] || '';
        var head = wt.match(/^==English==\s*$/m);
        if (!head) return NOT_FOUND;
        var section = wt.slice(head.index + head[0].length);
        var nextLang = section.search(/^==[^=]/m);
        if (nextLang >= 0) section = section.slice(0, nextLang);
        var ph = '';
        var ipa = section.match(/\{\{IPA\|en\|\/([^/]+)\//);
        if (ipa) ph = ipa[1];
        var defs = [];
        var lines = section.split('\n');
        var pos = '';
        var taken = 0;
        for (var i = 0; i < lines.length && defs.length < 8; i++) {
          var line = lines[i].trim();
          var h = line.match(/^===\s*([A-Za-z][A-Za-z ]*?)\s*===/);
          if (h) {
            var p = h[1].toLowerCase();
            pos = WIKT_POS[p] ? p : '';
            taken = 0;
            continue;
          }
          if (!pos || taken >= 2 || !/^#[^#:*]/.test(line)) continue;
          var def = cleanWikiDef(line.slice(1));
          if (def.length > 3) { defs.push({ pos: POS_ABBR[pos] || pos, en: def }); taken++; }
        }
        if (!defs.length) return NOT_FOUND;
        return buildEntry(ph, defs);
      });
  }

  var DICT_PROVIDERS = [dictFreeDict, dictDatamuse, dictWiktionary];

  /* 单源：非 NOT_FOUND 错误自动重试 1 次（间隔 800ms） */
  function tryDictSource(provider, word, retried) {
    return provider(word).catch(function (err) {
      if (err === NOT_FOUND) throw err;
      if (!retried) {
        return new Promise(function (res) { setTimeout(res, 800); }).then(function () {
          return tryDictSource(provider, word, true);
        });
      }
      throw err;
    });
  }

  /* 降级链：依次尝试各源；任一源成功即返回，否则汇总结果决定 notfound/error */
  function nextDictSource(word, i, sawNotFound) {
    if (i >= DICT_PROVIDERS.length) {
      return sawNotFound ? Promise.resolve(NOT_FOUND) : Promise.reject(new Error('all dict sources failed'));
    }
    return tryDictSource(DICT_PROVIDERS[i], word, false).then(function (entry) {
      if (entry === NOT_FOUND) return nextDictSource(word, i + 1, true);
      return entry;
    }, function (err) {
      if (err === NOT_FOUND) return nextDictSource(word, i + 1, true);
      return nextDictSource(word, i + 1, sawNotFound);
    });
  }

  function fetchOnlineDict(word, cb, onNotFound, onError) {
    nextDictSource(word, 0, false).then(function (entry) {
      if (entry === NOT_FOUND) { onNotFound(); return; }
      /* 先用英文释义立即出结果，中文翻译并发回填 */
      cb(entry, false);
      fillTranslations(word, entry, cb);
    }).catch(function () { onError(); });
  }

  window.Dict = {
    parseDefs: parseDefs,
    translateText: translateText,
    fetchOnlineDict: fetchOnlineDict
  };
})();
