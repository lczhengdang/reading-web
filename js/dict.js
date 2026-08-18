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

  /* ---- 中文释义回填：LLM 批量优先，失败回退逐条并发（3 并发）+ 兜底超时 ---- */
  function fillTranslations(word, entry, cb) {
    var pending = entry._zhDone ? [] : entry.items.filter(function (it) { return it.zh === it.en; });
    var finished = false;
    function finish(final) {
      if (finished) return;
      finished = true;
      /* 缓存写入与弹窗是否存活解耦：查词完成即入库 */
      if (final) Store.dictPut(word, entry);
      cb(entry, final);
    }
    if (!pending.length) { finish(true); return; }
    var safety = setTimeout(function () { finish(true); }, llmConfigured() ? 25000 : 9000);
    function afterAll() { clearTimeout(safety); finish(true); }

    /* 逐条并发回退链（MyMemory -> Google） */
    function perItem() {
      var remaining = pending.slice();
      var done = 0;
      var CONCURRENCY = 3;
      function maybeFinish() {
        done++;
        if (done === CONCURRENCY) afterAll();
      }
      function work() {
        var it = remaining.shift();
        if (!it) { maybeFinish(); return; }
        translateText(it.en).then(function (zh) {
          it.zh = zh;
          if (!finished) cb(entry, false);
        }, function () { }).then(work);
      }
      for (var i = 0; i < CONCURRENCY; i++) work();
    }

    if (llmConfigured()) {
      translateBatchLLM(pending.map(function (it) { return it.en; })).then(function (arr) {
        pending.forEach(function (it, i) { it.zh = arr[i] || it.en; });
        if (!finished) cb(entry, false);
        afterAll();
      }, function () { perItem(); });
    } else {
      perItem();
    }
  }

  /* ---- 在线查词：多源降级链（LLM(可选) -> dictionaryapi.dev -> Datamuse -> Wiktionary） ----
     cb(entry, final)：entry 更新（final=true 表示翻译全部完成）
     onNotFound()：所有源均未收录该词
     onError()：所有源均网络/接口错误（可提示重试） */
  var NOT_FOUND = { notFound: true };

  function buildEntry(phonetic, defs) {
    return {
      phonetic: String(phonetic || '').replace(/^\/|\/$/g, ''),
      items: defs.map(function (it) { return { pos: it.pos, zh: it.zh || it.en, en: it.en }; })
    };
  }

  /* ---- 大模型查词（OpenAI 兼容协议，可选；配置于设置页） ---- */
  function llmConfigured() {
    return !!(Store.settings.llmApiKey && Store.settings.llmBaseUrl && Store.settings.llmModel);
  }
  function llmBaseUrl() {
    return String(Store.settings.llmBaseUrl).replace(/\/+$/, '');
  }
  function callLLMChat(messages, timeoutMs, maxTokens) {
    if (!llmConfigured()) return Promise.reject(new Error('llm not configured'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    var body = { model: Store.settings.llmModel, messages: messages, temperature: 0.3 };
    if (maxTokens) body.max_tokens = maxTokens;
    return fetch(llmBaseUrl() + '/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + Store.settings.llmApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('llm http ' + r.status);
      return r.json();
    }).then(function (j) {
      var content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!content) throw new Error('llm empty response');
      return String(content);
    }).catch(function (e) { clearTimeout(timer); throw e; });
  }
  /* 从模型返回文本中提取首个完整的 JSON 对象（容忍 markdown 包裹/前后多余文字，仅批量翻译等非流式路径使用） */
  function extractJsonObject(text) {
    var start = text.indexOf('{');
    if (start === -1) return null;
    var depth = 0;
    for (var i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
  }
  /* 增量提取累积流式文本中的完整 item 对象（字符串感知的花括号配对，跳过引号内转义字符） */
  function scanStreamItems(acc, fromIdx) {
    var out = [];
    var i = fromIdx;
    while (i < acc.length) {
      if (acc[i] !== '{') { i++; continue; }
      var depth = 0; var inStr = false; var esc = false; var j = i; var end = -1;
      for (; j < acc.length; j++) {
        var c = acc[j];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end === -1) break; /* 对象尚未完整，等待后续 chunk */
      try {
        var obj = JSON.parse(acc.slice(i, end + 1));
        if (obj && typeof obj === 'object') out.push(obj);
      } catch (e) { /* 忽略非法片段 */ }
      i = end + 1;
    }
    return { items: out, next: i };
  }

  /* 流式查词：SSE 增量解析，首条释义到达即渐进渲染 */
  function streamLLMDict(word, onEntry) {
    if (!llmConfigured()) return Promise.reject(new Error('llm not configured'));
    var prompt = '你是英语词典。查询单词 "' + word + '"，只输出 JSON，不要任何其他文字：' +
      '{"phonetic":"国际音标，不含斜杠，未知则为空字符串","items":[{"pos":"词性缩写如 n. v. adj. adv.","zh":"中文释义"}]}' +
      '，items 最多 4 条主要词性。若该词不存在，输出 {"phonetic":"","items":[]}';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
    return fetch(llmBaseUrl() + '/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + Store.settings.llmApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: Store.settings.llmModel, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 400, stream: true }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) { clearTimeout(timer); throw new Error('llm http ' + r.status); }
      if (!r.body || typeof r.body.getReader !== 'function') { clearTimeout(timer); throw new Error('llm no stream'); }
      var reader = r.body.getReader();
      var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
      var acc = ''; var buf = ''; var rawAll = '';
      var phoneticDone = false;
      var defs = [];
      var itemsStart = -1; var scanFrom = 0;
      var entry = { phonetic: '', items: [], _zhDone: true, _src: 'llm' };
      var emitted = 0;
      function emitPartial() {
        if (entry.items.length > emitted) {
          emitted = entry.items.length;
          if (onEntry) onEntry(entry);
        }
      }
      function processAcc() {
        if (!phoneticDone) {
          var m = acc.match(/"phonetic"\s*:\s*"([^"\\]*)"/);
          if (m) { entry.phonetic = m[1]; phoneticDone = true; }
        }
        if (itemsStart === -1) {
          var k = acc.indexOf('"items"');
          if (k !== -1) {
            var b = acc.indexOf('[', k);
            if (b !== -1) itemsStart = b + 1;
          }
        }
        if (itemsStart !== -1) {
          var res = scanStreamItems(acc, Math.max(itemsStart, scanFrom));
          res.items.forEach(function (it) {
            var zh = String(it.zh || '').trim();
            if (!zh) return;
            if (defs.length < 8) defs.push({ pos: String(it.pos || ''), zh: zh });
          });
          scanFrom = res.next;
          entry.items = defs.map(function (d) { return { pos: d.pos, zh: d.zh, en: d.zh }; });
          emitPartial();
        }
      }
      function applyDictData(data) {
        if (!data || !Array.isArray(data.items)) return false;
        data.items.slice(0, 8).forEach(function (it) {
          var zh = String(it.zh || '').trim();
          if (!zh || defs.length >= 8) return;
          defs.push({ pos: String(it.pos || ''), zh: zh });
        });
        if (!phoneticDone && typeof data.phonetic === 'string') { entry.phonetic = data.phonetic; phoneticDone = true; }
        entry.items = defs.map(function (d) { return { pos: d.pos, zh: d.zh, en: d.zh }; });
        emitPartial();
        return true;
      }
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) {
            clearTimeout(timer);
            if (!defs.length) {
              /* 兼容：部分服务忽略 stream 参数，一次性返回完整 JSON */
              try {
                var whole = JSON.parse(rawAll.trim());
                if (whole && whole.choices && whole.choices[0] && whole.choices[0].message && whole.choices[0].message.content) {
                  var cs = extractJsonObject(String(whole.choices[0].message.content));
                  if (cs && applyDictData(JSON.parse(cs))) return defs.length ? entry : NOT_FOUND;
                } else if (whole && Array.isArray(whole.items)) {
                  if (applyDictData(whole)) return defs.length ? entry : NOT_FOUND;
                }
              } catch (e) { /* 非 JSON 响应，按空结果处理 */ }
              return NOT_FOUND;
            }
            return entry;
          }
          var text = decoder ? decoder.decode(chunk.value, { stream: true }) : String.fromCharCode.apply(null, chunk.value);
          rawAll += text;
          buf += text;
          var idx;
          while ((idx = buf.indexOf('\n')) !== -1) {
            var line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            var delta;
            try { delta = JSON.parse(data); } catch (e) { continue; }
            var c = delta && delta.choices && delta.choices[0] && delta.choices[0].delta && delta.choices[0].delta.content;
            if (c) acc += c;
          }
          processAcc();
          return pump();
        });
      }
      return pump().catch(function (e) { clearTimeout(timer); throw e; });
    }).catch(function (e) { clearTimeout(timer); throw e; });
  }

  function dictLLM(word, onEntry) {
    return streamLLMDict(word, onEntry);
  }
  /* LLM 批量翻译：一次请求翻译全部条目，返回与输入同序的中文数组 */
  function translateBatchLLM(texts) {
    var prompt = '把下列英文词典释义翻译成中文，只输出 JSON 数组（与输入同序、等长，元素为中文翻译字符串），不要任何其他文字：\n' + JSON.stringify(texts);
    return callLLMChat([{ role: 'user', content: prompt }], 15000, 300).then(function (content) {
      var start = content.indexOf('[');
      if (start === -1) throw new Error('llm bad json');
      var depth = 0; var end = -1;
      for (var i = start; i < content.length; i++) {
        if (content[i] === '[') depth++;
        else if (content[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end === -1) throw new Error('llm bad json');
      var arr = JSON.parse(content.slice(start, end));
      if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('llm length mismatch');
      return arr.map(function (s) { return String(s).trim(); });
    });
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

  /* 降级链：已配置时 LLM 为首选源；依次尝试各源，任一源成功即返回 */
  function dictProviders() {
    var list = [];
    if (llmConfigured()) list.push(dictLLM);
    return list.concat([dictFreeDict, dictDatamuse, dictWiktionary]);
  }

  /* 单源：非 NOT_FOUND 错误自动重试 1 次（间隔 800ms）；onEntry 供流式源渐进渲染 */
  function tryDictSource(provider, word, retried, onEntry) {
    return provider(word, onEntry).catch(function (err) {
      if (err === NOT_FOUND) throw err;
      if (!retried) {
        return new Promise(function (res) { setTimeout(res, 800); }).then(function () {
          return tryDictSource(provider, word, true, onEntry);
        });
      }
      throw err;
    });
  }

  function nextDictSource(providers, word, i, sawNotFound, onEntry) {
    if (i >= providers.length) {
      return sawNotFound ? Promise.resolve(NOT_FOUND) : Promise.reject(new Error('all dict sources failed'));
    }
    return tryDictSource(providers[i], word, false, onEntry).then(function (entry) {
      if (entry === NOT_FOUND) return nextDictSource(providers, word, i + 1, true, onEntry);
      return entry;
    }, function (err) {
      if (err === NOT_FOUND) return nextDictSource(providers, word, i + 1, true, onEntry);
      return nextDictSource(providers, word, i + 1, sawNotFound, onEntry);
    });
  }

  function fetchOnlineDict(word, cb, onNotFound, onError) {
    nextDictSource(dictProviders(), word, 0, false, function (entry) {
      cb(entry, false);
    }).then(function (entry) {
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
