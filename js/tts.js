/* 双引擎 TTS：系统 Web Speech（默认）+ 火山方舟云端（可选） */
(function () {
  'use strict';

  const synth = window.speechSynthesis;

  const TTS = {
    voices: [],
    voicesReady: false,
    /* 运行时状态: idle | loading | playing | paused */
    state: 'idle',
    seqIndex: -1,
    seqTotal: 0,
    engine: 'system',
    rate: 1.0,
    voiceURI: '',
    cloud: { apiKey: '', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/tts', model: 'doubao-tts-0001', voiceId: '', ttsApi: 'doubao2' },
    _audio: null,
    _seqToken: 0,
    _listeners: [],
    _blobCache: new Map(),
    _curUtter: null, /* 持有引用，规避部分浏览器 utterance 被 GC 的 bug */
    /* Web Audio 播放状态（绕过浏览器自动播放限制） */
    _ctx: null,
    _srcNode: null,
    _buf: null,
    _startAt: 0,
    _offset: 0,
    _paused: false,
    _playOpts: null,
    _ctxBlocked: false
  };

  function emit() {
    TTS._listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { } });
  }
  function setState(s, idx, total) {
    TTS.state = s;
    if (idx !== undefined) TTS.seqIndex = idx;
    if (total !== undefined) TTS.seqTotal = total;
    emit();
  }
  TTS.onChange = function (fn) { TTS._listeners.push(fn); };
  TTS.offChange = function (fn) {
    var i = TTS._listeners.indexOf(fn);
    if (i >= 0) TTS._listeners.splice(i, 1);
  };
  TTS.speak = function (text, opts) {
    opts = opts || {};
    if (TTS.engine === 'cloud') { speakCloud(text, opts); } else { speakSystem(text, opts); }
  };
  TTS.playSequence = function (texts, start, onIndex) {
    TTS._seqToken++;
    playSeq(TTS._seqToken, texts, start, onIndex);
  };
  TTS.togglePause = function () {
    if (TTS.state === 'playing') { TTS.pause(); } else if (TTS.state === 'paused') { TTS.resume(); }
  };
  TTS.pause = function () {
    if (TTS.engine === 'cloud' && TTS._srcNode && TTS._ctx) {
      TTS._offset = TTS._ctx.currentTime - TTS._startAt;
      TTS._srcNode.onended = null;
      try { TTS._srcNode.stop(); } catch (e) { }
      TTS._srcNode = null;
      TTS._paused = true;
      setState('paused');
    } else if (TTS.engine === 'cloud' && TTS._audio) { TTS._audio.pause(); setState('paused'); }
    else if (synth && TTS.state === 'playing') { synth.pause(); setState('paused'); }
  };
  TTS.resume = function () {
    if (TTS.engine === 'cloud' && TTS._paused && TTS._buf && TTS._ctx) {
      TTS._paused = false;
      startBuffer(TTS._buf, TTS._offset, TTS._playOpts || {});
    } else if (TTS.engine === 'cloud' && TTS._audio) { TTS._audio.play().catch(function () { }); setState('playing'); }
    else if (synth) { synth.resume(); setState('playing'); }
  };
  TTS.stop = function () {
    TTS._seqToken++;
    stopCloudPlayback();
    if (TTS._audio) { try { TTS._audio.pause(); } catch (e) { } TTS._audio = null; }
    if (synth) { try { synth.cancel(); } catch (e) { } }
    setState('idle', -1, 0);
  };
  TTS.statusText = function () {
    if (TTS.state === 'loading') return '正在合成语音…';
    if (TTS.state === 'paused') return '已暂停 · 第 ' + (TTS.seqIndex + 1) + '/' + TTS.seqTotal + ' 段';
    if (TTS.state === 'playing') return '正在朗读 · 第 ' + (TTS.seqIndex + 1) + '/' + TTS.seqTotal + ' 段';
    return '朗读全文';
  };
  TTS.clearCache = function () { TTS._blobCache.clear(); };
  /* 供外部在任意首次交互时提前解锁音频上下文 */
  TTS.unlock = function () { ensureAudioCtx(); };
  TTS.englishVoices = function () {
    return TTS.voices.filter(function (v) { return /^en/i.test(v.lang); });
  };

  /* ---------- 语音列表加载 ---------- */
  function loadVoices() {
    if (!synth) { TTS.voicesReady = true; return; }
    var v = synth.getVoices();
    if (v && v.length) { TTS.voices = v; TTS.voicesReady = true; }
  }
  loadVoices();
  if (synth && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', loadVoices);
  } else if (synth) {
    synth.onvoiceschanged = loadVoices;
  }

  function pickVoice() {
    if (!TTS.voices.length) return null;
    if (TTS.voiceURI) {
      var found = TTS.voices.find(function (v) { return v.voiceURI === TTS.voiceURI; });
      if (found) return found;
    }
    var en = TTS.englishVoices();
    return en.find(function (v) { return /en[-_]US/i.test(v.lang); }) || en[0] || null;
  }

  /* ---------- 系统语音引擎 ---------- */
  function speakSystem(text, opts) {
    if (!synth) { if (opts.onError) opts.onError('当前浏览器不支持语音合成'); return; }
    try { synth.cancel(); } catch (e) { }
    var u = new SpeechSynthesisUtterance(text);
    var voice = pickVoice();
    if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'en-US'; }
    u.rate = TTS.rate;
    if (opts.onStart) u.onstart = opts.onStart;
    if (opts.onEnd) u.onend = opts.onEnd;
    u.onerror = function (ev) {
      var err = (ev && ev.error) ? String(ev.error) : '';
      if (err === 'interrupted' || err === 'canceled' || err === 'cancelled') return;
      if (opts.onError) opts.onError('朗读出错：' + (err || '未知错误'));
      else if (opts.onEnd) opts.onEnd();
    };
    TTS._curUtter = u; // prevent GC bug on some browsers
    setTimeout(function () {
      try { synth.speak(u); } catch (e) {
        if (opts.onError) opts.onError('朗读出错：' + (e.message || e));
        else if (opts.onEnd) opts.onEnd();
      }
    }, 60);
  }

  function playSeq(token, texts, index, onIndex) {
    if (index >= texts.length) { setState('idle', -1, 0); return; }
    if (TTS._seqToken !== token) return;
    setState(index === texts.length ? 'idle' : 'playing', index, texts.length);
    if (onIndex) onIndex(index);

    function next() {
      if (TTS._seqToken !== token) return;
      if (TTS.state === 'paused') return; // resumed via resume()
      playSeq(token, texts, index + 1, onIndex);
    }

    if (TTS.engine === 'cloud') {
      setState('loading', index, texts.length);
      speakCloud(texts[index], {
        onDone: next,
        onError: function (msg) {
          TTS._seqToken++;
          setState('idle', -1, 0);
          if (window.UI) UI.toast(msg, 4000);
        }
      });
    } else {
      speakSystem(texts[index], { onEnd: next });
    }
  }

  /* ---------- 云端引擎（豆包大模型 2.0 双向流式 / 方舟 HTTP） ---------- */
  function cacheKey(text) {
    return (TTS.cloud.ttsApi || 'doubao2') + '|' + TTS.cloud.endpoint + '|' + TTS.cloud.model + '|' + TTS.cloud.voiceId + '|' + TTS.rate + '|' + text;
  }

  function buildCloudBody(text) {
    var c = TTS.cloud;
    var isOpenAI = c.endpoint.indexOf('/audio/speech') !== -1 || /\/speech$/.test(c.endpoint);
    var body = { model: c.model, voice: c.voiceId || 'zh_female_cancan_mars_bigtts', speed: TTS.rate, response_format: 'mp3' };
    if (isOpenAI) body.input = text; else body.input = { text: text };
    /* 本地代理模式：附带原始端点与密钥，由 tools/serve.py 提取并转发 */
    body._endpoint = c.endpoint;
    body._apiKey = 'Bearer ' + c.apiKey;
    return JSON.stringify(body);
  }

  function fetchCloudAudio(text) {
    var key = cacheKey(text);
    if (TTS._blobCache.has(key)) return Promise.resolve(TTS._blobCache.get(key));
    var c = TTS.cloud;
    if (!c.apiKey) return Promise.reject(new Error('未配置 API Key，请到设置中填写'));

    /* 豆包语音合成大模型 2.0：同源走本地代理 /api/tts2（服务端双向流式 WebSocket，无 CORS 问题） */
    if ((c.ttsApi || 'doubao2') === 'doubao2') {
      return fetch('/api/tts2', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ text: text, apiKey: c.apiKey, speaker: c.voiceId || 'zh_female_xiaohe_uranus_bigtts' })
      }).then(function (resp) {
        if (resp.status === 501 || resp.status === 404 || resp.status === 405) {
          throw new Error('当前服务器不支持 TTS 代理：请关闭旧服务器窗口，双击 start.bat 重新启动，并访问终端显示的端口');
        }
        if (!resp.ok) return resp.text().then(function (t) { throw new Error('豆包 TTS 请求失败 HTTP ' + resp.status + '：' + t.slice(0, 200)); });
        return resp.arrayBuffer();
      }).then(function (buf) {
        TTS._blobCache.set(key, buf);
        return buf;
      }).catch(function (err) {
        var m = String(err && err.message || err);
        if (m.indexOf('Failed to fetch') !== -1 || m.indexOf('NetworkError') !== -1 || m.indexOf('load failed') !== -1) {
          m += '（可能是浏览器跨域限制，请使用 python tools/serve.py 启动本地代理）';
        }
        throw new Error(m);
      });
    }

    /* 方舟 HTTP（OpenAI 兼容）：同源请求走本地代理 /api/tts */
    return fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: buildCloudBody(text)
    }).then(function (resp) {
      if (resp.status === 501 || resp.status === 404 || resp.status === 405) {
        throw new Error('当前服务器不支持 TTS 代理：请关闭所有旧的服务器窗口，改用 python tools/serve.py 启动，并访问终端显示的新端口');
      }
      if (!resp.ok) return resp.text().then(function (t) { throw new Error('TTS 请求失败 HTTP ' + resp.status + '：' + t.slice(0, 120)); });
      return resp.arrayBuffer();
    }).then(function (buf) {
      TTS._blobCache.set(key, buf);
      return buf;
    }).catch(function (err) {
      var m = String(err && err.message || err);
      if (m.indexOf('Failed to fetch') !== -1 || m.indexOf('NetworkError') !== -1 || m.indexOf('load failed') !== -1) {
        m += '（可能是浏览器跨域限制，请使用 python tools/serve.py 启动本地代理）';
      }
      throw new Error(m);
    });
  }

  /* ---- Web Audio 播放：在用户点击手势内解锁 AudioContext，之后播放不再受自动播放策略限制 ---- */
  function ensureAudioCtx() {
    if (!TTS._ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { TTS._ctx = new AC(); } catch (e) { TTS._ctx = null; } }
    }
    if (TTS._ctx && TTS._ctx.state === 'suspended') {
      TTS._ctx.resume().then(function () { TTS._ctxBlocked = false; }).catch(function () { TTS._ctxBlocked = true; });
    }
    return TTS._ctx;
  }

  var BLOCKED_MSG = '浏览器拒绝解锁音频：请点击地址栏左侧图标 → 网站设置，确认「声音」未被设为阻止，然后刷新页面重试';

  function stopCloudPlayback() {
    if (TTS._srcNode) {
      TTS._srcNode.onended = null;
      try { TTS._srcNode.stop(); } catch (e) { }
      TTS._srcNode = null;
    }
    TTS._paused = false;
    TTS._buf = null;
    TTS._offset = 0;
    TTS._playOpts = null;
  }

  function startBuffer(buf, offset, opts) {
    var ctx = TTS._ctx;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    TTS._srcNode = src;
    TTS._buf = buf;
    TTS._startAt = ctx.currentTime - offset;
    TTS._offset = offset;
    TTS._playOpts = opts;
    src.onended = function () {
      if (TTS._srcNode !== src || TTS._paused) return;
      TTS._srcNode = null;
      TTS._buf = null;
      if (opts.onDone) opts.onDone();
    };
    try { src.start(0, Math.max(0, offset)); } catch (e) {
      if (opts.onError) opts.onError('音频播放出错'); else if (opts.onDone) opts.onDone();
      return;
    }
    setState('playing');
  }

  function playArrayBuffer(ab, opts) {
    /* 健壮性：确保拿到 ArrayBuffer（兼容 Uint8Array/异常类型） */
    if (ArrayBuffer.isView(ab)) ab = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
    if (!(ab instanceof ArrayBuffer)) { playAudioFallback(new Uint8Array(0).buffer, opts); return; }
    var ctx = TTS._ctx;
    if (!ctx || !ctx.decodeAudioData) { playAudioFallback(ab, opts); return; }
    if (ctx.state === 'suspended') {
      /* 手势解锁失败（多为站点声音权限被阻止）：再尝试一次，仍失败则给出明确指引 */
      ctx.resume().then(function () {
        if (ctx.state === 'running') { decodeAndPlay(ab, opts); }
        else if (opts.onError) { opts.onError(BLOCKED_MSG); }
      }).catch(function () { if (opts.onError) opts.onError(BLOCKED_MSG); });
      return;
    }
    decodeAndPlay(ab, opts);
  }

  function decodeAndPlay(ab, opts) {
    TTS._ctx.decodeAudioData(ab.slice(0)).then(function (buf) {
      startBuffer(buf, 0, opts);
    }).catch(function () {
      playAudioFallback(ab, opts);
    });
  }

  /* 兼容兜底：无 Web Audio 时用 HTMLAudioElement */
  function playAudioFallback(ab, opts) {
    var url = URL.createObjectURL(new Blob([ab], { type: 'audio/mpeg' }));
    var audio = new Audio(url);
    TTS._audio = audio;
    audio.onended = function () { if (opts.onDone) opts.onDone(); };
    audio.onerror = function () { if (opts.onError) opts.onError('音频播放出错'); else if (opts.onDone) opts.onDone(); };
    var p = audio.play();
    if (p && p.catch) p.catch(function () { if (opts.onError) opts.onError('音频播放被浏览器拦截：请按 Ctrl+F5 强制刷新后重试；若仍出现，请检查地址栏网站设置中「声音」是否被设为阻止'); });
    setState('playing');
  }

  function speakCloud(text, opts) {
    opts = opts || {};
    ensureAudioCtx(); /* 在点击手势内解锁音频 */
    if (TTS._ctxBlocked) { if (opts.onError) opts.onError(BLOCKED_MSG); return; }
    stopCloudPlayback();
    if (TTS._audio) { try { TTS._audio.pause(); } catch (e) { } TTS._audio = null; }
    setState('loading');
    fetchCloudAudio(text).then(function (ab) {
      playArrayBuffer(ab, opts);
    }).catch(function (err) {
      if (opts.onError) opts.onError(err.message);
    });
  }

  window.TTS = TTS;
})();
