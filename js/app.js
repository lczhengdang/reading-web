/* 考研阅读 - Web 版主应用 */
(function () {
  'use strict';

  var UIi = window.UI;
  var T = window.TTS;
  var Store = window.Store;
  var Dict = window.Dict;

  /* ============ 数据准备（索引：仅元信息，正文按需加载） ============ */
  var articles = (window.KAOYAN_INDEX || []).slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  var DICT = new Map();
  (window.KAOYAN_DICT || []).forEach(function (e) { DICT.set(e.word.toLowerCase(), e); });

  var SRC_META = {
    'The Economist': { cls: 'eco', zh: '经济学人' },
    'Scientific American': { cls: 'sa', zh: '科学美国人' },
    'Nature': { cls: 'nat', zh: '自然' },
    'The Guardian': { cls: 'gua', zh: '卫报' }
  };

  var settings = Store.settings;
  var favorites = Store.favorites;
  var wordbook = Store.wordbook;
  var progress = Store.progress;

  function applyTtsSettings() {
    T.engine = settings.engine;
    T.rate = settings.rate;
    T.voiceURI = settings.voice;
    T.cloud.apiKey = settings.apiKey;
    T.cloud.endpoint = settings.endpoint || T.cloud.endpoint;
    T.cloud.model = settings.model || T.cloud.model;
    T.cloud.voiceId = settings.cloudVoiceId || '';
    document.documentElement.style.setProperty('--reading-size', settings.fontSize + 'px');
  }

  /* ============ 深浅色主题（system / light / dark） ============ */
  function applyTheme() {
    var t = settings.theme || 'system';
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }
  function effectiveDark() {
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function themeLabel() {
    return settings.theme === 'system' ? '主题：跟随系统' : (settings.theme === 'light' ? '主题：浅色' : '主题：深色');
  }
  function paintThemeBtns() {
    var iconName = effectiveDark() ? 'sun' : 'moon';
    var db = document.getElementById('f-theme');
    if (db) { db.innerHTML = UIi.icon(iconName); db.setAttribute('aria-label', themeLabel()); }
    var mb = document.querySelector('.bottomnav .theme-nav .navicon');
    if (mb) mb.innerHTML = UIi.icon(iconName);
  }
  function cycleTheme() {
    var order = ['system', 'light', 'dark'];
    var i = order.indexOf(settings.theme || 'system');
    settings.theme = order[(i + 1) % order.length];
    Store.saveSettings();
    applyTheme();
    paintThemeBtns();
    UIi.toast(themeLabel());
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if ((settings.theme || 'system') === 'system') paintThemeBtns();
    });
  }

  /* ============ 工具 ============ */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function srcBadge(src) {
    var m = SRC_META[src] || { cls: 'eco', zh: src };
    return '<span class="src-badge src-' + m.cls + '">' + esc(src) + '</span>';
  }
  function diffDots(d) {
    var s = '<span class="diff-dots">';
    for (var i = 0; i < 5; i++) s += '<i class="' + (i < d ? 'f' : '') + '"></i>';
    return s + '</span>';
  }
  var WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

  /* ============ 底部导航 ============ */
  var NAV_ITEMS = [
    { key: 'library', label: '文章库', icon: 'book' },
    { key: 'wordbook', label: '生词本', icon: 'translate' },
    { key: 'settings', label: '设置', icon: 'settings' }
  ];
  function renderNav(active) {
    var nav = document.getElementById('bottomnav');
    nav.innerHTML = '';
    NAV_ITEMS.forEach(function (item) {
      var b = UIi.el('button', 'navitem' + (item.key === active ? ' active' : ''));
      b.innerHTML = '<span class="navicon">' + UIi.icon(item.icon) + '</span><span>' + item.label + '</span>';
      b.addEventListener('click', function () { location.hash = '#/' + item.key; });
      nav.appendChild(b);
    });
    /* 移动端主题切换入口 */
    var tb = UIi.el('button', 'navitem theme-nav');
    tb.setAttribute('aria-label', '切换深浅色');
    tb.innerHTML = '<span class="navicon">' + UIi.icon(effectiveDark() ? 'sun' : 'moon') + '</span><span>主题</span>';
    tb.addEventListener('click', cycleTheme);
    nav.appendChild(tb);
    document.querySelectorAll('.topnav-links a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.nav === active);
    });
  }

  /* ============ 路由 ============ */
  var view = document.getElementById('view');
  var cleanupFns = [];
  function addCleanup(fn) { cleanupFns.push(fn); }
  window.addEventListener('hashchange', route);

  function route() {
    T.stop();
    UIi.closeSheet();
    cleanupFns.forEach(function (fn) { try { fn(); } catch (e) { } });
    cleanupFns = [];
    view.scrollTop = 0; window.scrollTo(0, 0);

    var hash = location.hash || '#/library';
    if (hash.indexOf('#/reader/') === 0) { renderReader(decodeURIComponent(hash.slice('#/reader/'.length))); }
    else if (hash === '#/wordbook') { renderWordbook(); }
    else if (hash === '#/settings') { renderSettings(); }
    else { renderLibrary(); }
    view.classList.remove('view-anim');
    void view.offsetWidth;
    view.classList.add('view-anim');
  }

  /* ============ 文章库 ============ */
  var libFilter = { q: '', src: '', topic: '', diff: 0, favOnly: false };

  function matchesFilter(a) {
    var q = libFilter.q.trim().toLowerCase();
    if (q && (a.title + a.source + (a.sourceZh || '') + a.topic).toLowerCase().indexOf(q) === -1) return false;
    if (libFilter.src && a.source !== libFilter.src) return false;
    if (libFilter.topic && a.topic !== libFilter.topic) return false;
    if (libFilter.diff && a.difficulty !== libFilter.diff) return false;
    if (libFilter.favOnly && !favorites.has(a.id)) return false;
    return true;
  }

  function renderLibrary() {
    renderNav('library');
    view.innerHTML = '';

    var head = UIi.el('div', 'lib-head',
      '<div class="masthead">Kaoyan Reading · 同源外刊</div><h1>文章库</h1><div class="sub">双语对照精读 · 共 ' + articles.length + ' 篇 · 已收藏 ' + favorites.size + ' 篇</div>');
    view.appendChild(head);

    var bar = UIi.el('div', 'searchbar');
    bar.innerHTML = UIi.icon('search') + '<input type="search" placeholder="搜索标题 / 来源 / 话题…" value="' + esc(libFilter.q) + '" autocomplete="off" aria-label="搜索文章">';
    var input = bar.querySelector('input');
    var debounce = null;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { libFilter.q = input.value; refreshList(); }, 120);
    });
    view.appendChild(bar);

    var panel = UIi.el('div', 'filter-panel');
    view.appendChild(panel);

    /* 卡片一次性构建，筛选只切换可见性（避免全量重建与动画重放） */
    var list = UIi.el('div', 'article-list');
    var cards = [];
    articles.forEach(function (a, idx) {
      var card = buildArticleCard(a, idx);
      cards.push({ a: a, card: card });
      list.appendChild(card);
    });
    var emptyEl = UIi.el('div', 'empty-state', '没有匹配的文章<br>试试调整筛选条件');
    emptyEl.style.display = 'none';
    emptyEl.style.gridColumn = '1 / -1';
    list.appendChild(emptyEl);
    view.appendChild(list);

    function applyFilter() {
      var shown = 0;
      cards.forEach(function (c) {
        var vis = matchesFilter(c.a);
        c.card.style.display = vis ? '' : 'none';
        if (vis) shown++;
      });
      emptyEl.style.display = shown ? 'none' : '';
      return shown;
    }
    function updateStats() {
      var stats = panel.querySelector('.fp-stats span');
      if (stats) stats.textContent = '共 ' + articles.length + ' 篇 · 当前显示 ' + applyFilter() + ' 篇';
      else applyFilter();
      var clear = panel.querySelector('.fp-clear');
      if (clear) clear.style.display = filterActive() ? '' : 'none';
    }
    function refreshList() {
      renderLibraryPanel(panel, refreshList);
      updateStats();
    }

    renderLibraryPanel(panel, refreshList);
    updateStats();
  }

  function filterActive() {
    return libFilter.q || libFilter.src || libFilter.topic || libFilter.diff || libFilter.favOnly;
  }

  function buildArticleCard(a, idx) {
    var fav = favorites.has(a.id);
    var card = UIi.el('article', 'article-card card-anim');
    card.style.animationDelay = Math.min(idx, 12) * 40 + 'ms';
    card.innerHTML =
      '<div class="ac-top">' + srcBadge(a.source) + '<span class="badge">' + esc(a.topic) + '</span>' +
      '<button class="icon-btn ac-fav" aria-label="收藏">' +
      UIi.icon(fav ? 'star' : 'starBorder', fav ? 'fav-active' : '') + '</button></div>' +
      '<div class="ac-title">' + esc(a.title) + '</div>' +
      '<div class="ac-meta"><span>' + a.year + '</span><span>·</span><span>' + a.wordCount + ' 词</span><span>·</span><span>难度</span>' + diffDots(a.difficulty) + '</div>';
    card.addEventListener('click', function (ev) {
      if (ev.target.closest('.ac-fav')) {
        var nowFav = Store.toggleFavorite(a.id);
        UIi.toast(nowFav ? '已收藏' : '已取消收藏');
        var btn = ev.target.closest('.ac-fav');
        btn.innerHTML = UIi.icon(nowFav ? 'star' : 'starBorder', nowFav ? 'fav-active' : '');
        var sub = view.querySelector('.lib-head .sub');
        if (sub) sub.innerHTML = '双语对照精读 · 共 ' + articles.length + ' 篇 · 已收藏 ' + favorites.size + ' 篇';
        if (libFilter.favOnly) {
          card.style.display = nowFav ? '' : 'none';
          var stats = view.querySelector('.fp-stats span');
          if (stats) stats.textContent = '共 ' + articles.length + ' 篇 · 当前显示 ' + view.querySelectorAll('.article-card:not([style*="none"])').length + ' 篇';
        }
        return;
      }
      location.hash = '#/reader/' + encodeURIComponent(a.id);
    });
    return card;
  }

  function renderLibraryPanel(panel, onChange) {
    panel.innerHTML = '';

    function chip(label, on, handler) {
      var c = UIi.el('button', 'chip' + (on ? ' on' : ''));
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
      c.innerHTML = (on ? UIi.icon('check', 'sm') : '') + esc(label);
      c.addEventListener('click', handler);
      return c;
    }
    function row(label, buildChips) {
      var r = UIi.el('div', 'fp-row');
      r.appendChild(UIi.el('span', 'fp-label', esc(label)));
      var chips = UIi.el('div', 'fp-chips');
      buildChips(chips);
      r.appendChild(chips);
      panel.appendChild(r);
    }

    row('收藏', function (wrap) {
      wrap.appendChild(chip('仅看收藏', libFilter.favOnly, function () {
        libFilter.favOnly = !libFilter.favOnly; onChange();
      }));
    });

    row('来源', function (wrap) {
      var sources = Array.from(new Set(articles.map(function (a) { return a.source; })));
      sources.forEach(function (s) {
        wrap.appendChild(chip(SRC_META[s] ? SRC_META[s].zh : s, libFilter.src === s, function () {
          libFilter.src = libFilter.src === s ? '' : s; onChange();
        }));
      });
    });

    row('话题', function (wrap) {
      var topics = Array.from(new Set(articles.map(function (a) { return a.topic; }))).sort();
      topics.forEach(function (t) {
        wrap.appendChild(chip(t, libFilter.topic === t, function () {
          libFilter.topic = libFilter.topic === t ? '' : t; onChange();
        }));
      });
    });

    row('难度', function (wrap) {
      for (var d = 1; d <= 5; d++) {
        (function (d) {
          wrap.appendChild(chip('难度 ' + d, libFilter.diff === d, function () {
            libFilter.diff = libFilter.diff === d ? 0 : d; onChange();
          }));
        })(d);
      }
    });

    var stats = UIi.el('div', 'fp-stats');
    stats.innerHTML = '<span></span>';
    var clear = UIi.el('button', 'fp-clear', '清除筛选 ×');
    clear.style.display = 'none';
    clear.addEventListener('click', function () {
      libFilter.q = ''; libFilter.src = ''; libFilter.topic = ''; libFilter.diff = 0; libFilter.favOnly = false;
      renderLibrary();
    });
    stats.appendChild(clear);
    panel.appendChild(stats);
  }

  /* ============ 阅读器 ============ */
  function loadArticle(id) {
    return fetch('data/articles/' + encodeURIComponent(id) + '.json').then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function renderReader(id) {
    var meta = articles.find(function (a) { return a.id === id; });
    if (!meta) { location.hash = '#/library'; return; }
    renderNav('library');
    view.innerHTML = '';
    /* 先用元信息渲染骨架，正文异步加载（Service Worker 缓存后离线可读） */
    view.appendChild(UIi.el('div', 'def-loading', '<span class="spinner"></span><span>正在加载文章…</span>'));
    loadArticle(id).then(function (article) {
      if (location.hash !== '#/reader/' + encodeURIComponent(id)) return;
      view.innerHTML = '';
      renderReaderView(article);
    }).catch(function () {
      view.innerHTML = '';
      var err = UIi.el('div', 'empty-state');
      err.innerHTML = '文章加载失败，请检查网络后重试<br><br>';
      var back = UIi.el('button', 'btn btn-tonal', '返回文章库');
      back.addEventListener('click', function () { location.hash = '#/library'; });
      err.appendChild(back);
      view.appendChild(err);
    });
  }

  function renderReaderView(article) {
    var id = article.id;
    var expanded = new Set();
    var showAll = false;

    /* --- 顶部栏 --- */
    var topbar = UIi.el('div', 'reader-topbar');
    var backBtn = UIi.el('button', 'icon-btn', UIi.icon('back'));
    backBtn.setAttribute('aria-label', '返回文章库');
    backBtn.addEventListener('click', function () { location.hash = '#/library'; });
    var title = UIi.el('div', 'title', esc(article.title));
    topbar.appendChild(backBtn); topbar.appendChild(title);
    ['A-', 'A+'].forEach(function (label) {
      var b = UIi.el('button', 'icon-btn', '<span style="font-weight:700">' + label + '</span>');
      b.setAttribute('aria-label', label === 'A+' ? '增大字号' : '减小字号');
      b.addEventListener('click', function () {
        settings.fontSize = Math.min(30, Math.max(13, settings.fontSize + (label === 'A+' ? 1 : -1)));
        Store.saveSettings();
        document.documentElement.style.setProperty('--reading-size', settings.fontSize + 'px');
        UIi.toast('字号 ' + settings.fontSize);
      });
      topbar.appendChild(b);
    });
    var favBtn = UIi.el('button', 'icon-btn');
    function paintFav() {
      var f = favorites.has(id);
      favBtn.innerHTML = UIi.icon(f ? 'star' : 'starBorder', f ? 'fav-active' : '');
      favBtn.setAttribute('aria-label', f ? '取消收藏' : '收藏');
    }
    paintFav();
    favBtn.addEventListener('click', function () {
      var nowFav = Store.toggleFavorite(id);
      paintFav();
      UIi.toast(nowFav ? '已收藏' : '已取消收藏');
    });
    topbar.appendChild(favBtn);
    var rprog = UIi.el('div', 'rprog');
    rprog.appendChild(UIi.el('div', 'rprog-fill'));
    topbar.appendChild(rprog);
    view.appendChild(topbar);

    /* --- 文章头部 --- */
    var head = UIi.el('div', 'reader-head');
    head.innerHTML =
      '<h2>' + esc(article.title) + '</h2>' +
      '<div class="reader-meta">' + srcBadge(article.source) +
      '<span>' + esc(article.topic) + '</span><span>' + article.year + '</span>' +
      '<span>' + article.wordCount + ' 词</span>' + diffDots(article.difficulty) + '</div>';
    var actions = UIi.el('div', 'reader-actions');
    var zhAllBtn = UIi.el('button', 'pill-btn', UIi.icon('translate') + '<span>显示全部译文</span>');
    zhAllBtn.addEventListener('click', function () {
      showAll = !showAll;
      zhAllBtn.classList.toggle('on', showAll);
      zhAllBtn.querySelector('span').textContent = showAll ? '隐藏全部译文' : '显示全部译文';
      updateZh();
    });
    actions.appendChild(zhAllBtn);
    head.appendChild(actions);
    view.appendChild(head);

    /* --- 阅读进度恢复提示 --- */
    var savedIdx = progress[id] || 0;
    function scrollPara(i, block) {
      var el = parasWrap.children[i];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: block || 'center' });
    }
    if (savedIdx > 0 && savedIdx < article.paragraphs.length) {
      var hint = UIi.el('div', 'restore-hint');
      hint.innerHTML = '<span>上次读到第 ' + (savedIdx + 1) + ' 段，</span><button>继续上次阅读</button>';
      hint.querySelector('button').addEventListener('click', function () { scrollPara(savedIdx, 'center'); });
      view.appendChild(hint);
    }

    /* --- 段落 --- */
    var parasWrap = UIi.el('div', 'paras');
    var zhDivs = [];
    article.paragraphs.forEach(function (p, i) {
      var para = UIi.el('div', 'para');
      para.dataset.i = i;
      para.style.animationDelay = Math.min(i, 8) * 55 + 'ms';
      var en = UIi.el('div', 'en');
      var last = 0; var m;
      WORD_RE.lastIndex = 0;
      while ((m = WORD_RE.exec(p.en)) !== null) {
        if (m.index > last) en.appendChild(document.createTextNode(p.en.slice(last, m.index)));
        var w = UIi.el('span', 'w', esc(m[0]));
        w.setAttribute('role', 'button');
        w.setAttribute('tabindex', '0');
        en.appendChild(w);
        last = m.index + m[0].length;
      }
      en.appendChild(document.createTextNode(p.en.slice(last)));
      var zh = UIi.el('div', 'zh', esc(p.zh));
      zh.style.display = 'none';
      zhDivs.push(zh);

      var ctrl = UIi.el('div', 'para-ctrl');
      var speakBtn = UIi.el('button', 'pill-btn', UIi.icon('volume') + '<span>朗读</span>');
      speakBtn.addEventListener('click', function () { T.playSequence(article.paragraphs.map(function (x) { return x.en; }), i, onSeqIndex); });
      var zhBtn = UIi.el('button', 'pill-btn', '<span>译文</span>');
      zhBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleZh(i);
      });
      ctrl.appendChild(speakBtn); ctrl.appendChild(zhBtn);

      para.appendChild(en); para.appendChild(zh); para.appendChild(ctrl);
      para.addEventListener('click', function (ev) {
        var wEl = ev.target.closest('.w');
        if (wEl) { lookupWord(wEl.textContent); return; }
        if (ev.target.closest('.pill-btn')) return;
        toggleZh(i);
      });
      /* 键盘可访问：Enter/Space 查词 */
      en.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var wEl = ev.target.closest ? ev.target.closest('.w') : null;
        if (wEl) { ev.preventDefault(); lookupWord(wEl.textContent); }
      });
      parasWrap.appendChild(para);
    });
    view.appendChild(parasWrap);

    function toggleZh(i) {
      if (expanded.has(i)) expanded.delete(i); else expanded.add(i);
      updateZh();
    }
    function updateZh() {
      zhDivs.forEach(function (z, i) {
        z.style.display = (showAll || expanded.has(i)) ? '' : 'none';
      });
    }

    function onSeqIndex(i) {
      var all = parasWrap.querySelectorAll('.para');
      all.forEach(function (x) { x.classList.remove('speaking'); });
      if (parasWrap.children[i]) parasWrap.children[i].classList.add('speaking');
      scrollPara(i, 'center');
    }
    addCleanup(function () {
      var all = parasWrap.querySelectorAll('.para.speaking');
      all.forEach(function (x) { x.classList.remove('speaking'); });
    });

    /* --- 播放条 --- */
    var player = UIi.el('div', 'playerbar');
    var pbStatus = UIi.el('div', 'pb-status');
    var pbMain = UIi.el('button', 'pb-btn main icon-btn');
    var pbStop = UIi.el('button', 'pb-btn sub icon-btn', UIi.icon('stop'));
    pbStop.setAttribute('aria-label', '停止朗读');
    player.appendChild(pbStatus); player.appendChild(pbMain); player.appendChild(pbStop);
    view.appendChild(player);

    /* 当前段落定位：IntersectionObserver（视口 35% 线），不支持时退化为几何计算 */
    var curIdx = 0;
    var io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) curIdx = parseInt(en.target.dataset.i, 10) || 0;
        });
      }, { rootMargin: '-35% 0px -64% 0px', threshold: 0 });
      Array.prototype.forEach.call(parasWrap.children, function (p) { io.observe(p); });
      addCleanup(function () { io.disconnect(); });
    }
    function currentParaIndex() {
      if (io) return curIdx;
      var top = window.innerHeight * 0.35;
      var idx = 0;
      var kids = parasWrap.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].getBoundingClientRect().top <= top) idx = i; else break;
      }
      return idx;
    }
    function paintPlayer() {
      pbStatus.textContent = T.statusText();
      var icon = T.state === 'playing' ? 'pause' : 'play';
      pbMain.innerHTML = UIi.icon(icon);
      pbMain.setAttribute('aria-label', T.state === 'playing' ? '暂停' : '播放');
    }
    T.onChange(paintPlayer);
    addCleanup(function () { T.offChange(paintPlayer); });
    paintPlayer();

    pbMain.addEventListener('click', function () {
      if (T.state === 'playing' || T.state === 'paused' || T.state === 'loading') {
        T.togglePause();
      } else {
        T.playSequence(article.paragraphs.map(function (x) { return x.en; }), currentParaIndex(), onSeqIndex);
      }
    });
    pbStop.addEventListener('click', function () { T.stop(); });

    /* --- 阅读进度保存 + 顶部进度条 --- */
    var rprogFill = topbar.querySelector('.rprog-fill');
    var rafId = 0;
    function updateProgressbar() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      if (rprogFill) rprogFill.style.width = pct.toFixed(1) + '%';
    }
    function onScroll() {
      if (rafId) return;
      rafId = requestAnimationFrame(function () {
        rafId = 0;
        updateProgressbar();
        var idx = currentParaIndex();
        if (idx !== progress[id]) {
          progress[id] = idx;
          Store.saveProgress();
        }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    updateProgressbar();
    addCleanup(function () { window.removeEventListener('scroll', onScroll); if (rafId) cancelAnimationFrame(rafId); });
  }

  /* --- 点词查词（本地词典 + 在线兜底） --- */
  function lookupWord(raw) {
    var word = raw.trim().replace(/^['"(\.,;:!?\-]+|['").,;:!?\-]+$/g, '').toLowerCase();
    if (!word) return;
    var localEntry = DICT.get(word);
    var cachedEntry = Store.dictGet(word);
    /* 大模型已配置时，仅命中大模型缓存；旧在线词典缓存重新走大模型查询 */
    var llmOn = !!(settings.llmApiKey && settings.llmBaseUrl && settings.llmModel);
    var usableCache = cachedEntry && (!llmOn || cachedEntry._src === 'llm') ? cachedEntry : null;
    var entry = localEntry || usableCache;
    var srcLabel = localEntry ? '本地词典' : (usableCache ? '本地词典 · 已收录' : '');
    var hadLocalRecord = !!entry;

    UIi.openSheet(function (sheet) {
      var headRow = UIi.el('div', 'sheet-head');
      headRow.appendChild(UIi.el('h3', null, esc(word)));
      if (srcLabel) headRow.appendChild(UIi.el('span', 'dict-src', srcLabel));
      sheet.appendChild(headRow);

      var body = UIi.el('div', 'dict-body');
      sheet.appendChild(body);

      var actions = UIi.el('div', 'sheet-actions');
      sheet.appendChild(actions);

      function renderEntry(e, src, animate) {
        body.innerHTML = '';
        if (e.phonetic) {
          var ph = UIi.el('div', 'phonetic', '<span>/' + esc(e.phonetic) + '/</span>');
          var phSpk = UIi.el('button', 'icon-btn', UIi.icon('volume', 'sm'));
          phSpk.setAttribute('aria-label', '播放发音');
          phSpk.addEventListener('click', function () { T.speak(word, { onError: function (m) { UIi.toast(m); } }); });
          ph.appendChild(phSpk);
          body.appendChild(ph);
        }
        var defs;
        if (e.items && e.items.length) {
          defs = e.items.map(function (it) { return { pos: it.pos, text: it.zh, en: it.en }; });
        } else {
          defs = Dict.parseDefs(e.definition);
          if (!defs.length) defs = [{ pos: '', text: e.definition }];
        }
        defs.forEach(function (d, di) {
          var item = UIi.el('div', 'def-item');
          if (animate !== false) item.style.animationDelay = di * 35 + 'ms';
          if (d.pos) item.appendChild(UIi.el('span', 'pos-tag', esc(d.pos)));
          var wrap = UIi.el('span', 'def-text');
          wrap.appendChild(UIi.el('span', null, esc(d.text)));
          if (d.en && d.en !== d.text) wrap.appendChild(UIi.el('span', 'def-en', esc(d.en)));
          item.appendChild(wrap);
          body.appendChild(item);
        });
        actions.innerHTML = '';
        var defStr = e.definition;
        if (!defStr && e.items) {
          defStr = e.items.map(function (i) { return (i.pos ? i.pos + ' ' : '') + i.zh; }).join('; ');
        }
        var inBook = wordbook.some(function (w) { return w.word === word; });
        var addBtn = UIi.el('button', 'btn btn-tonal');
        addBtn.innerHTML = UIi.icon(inBook ? 'check' : 'add', 'sm') + '<span>' + (inBook ? '已在生词本' : '加入生词本') + '</span>';
        addBtn.disabled = inBook;
        addBtn.addEventListener('click', function () {
          wordbook.unshift({ word: word, phonetic: e.phonetic || '', definition: defStr });
          Store.saveWordbook();
          UIi.toast('已加入生词本');
          UIi.closeSheet();
        });
        actions.appendChild(addBtn);
        appendCommonActions(actions);
        if (src) {
          var tag = sheet.querySelector('.dict-src');
          if (!tag) { tag = UIi.el('span', 'dict-src'); headRow.appendChild(tag); }
          tag.textContent = src;
        }
      }

      function appendCommonActions(actionsEl) {
        var spk = UIi.el('button', 'btn btn-text', UIi.icon('volume', 'sm') + '<span>发音</span>');
        spk.addEventListener('click', function () { T.speak(word, { onError: function (m) { UIi.toast(m); } }); });
        actionsEl.appendChild(spk);
        var closeBtn = UIi.el('button', 'btn btn-text', '关闭');
        closeBtn.addEventListener('click', UIi.closeSheet);
        actionsEl.appendChild(closeBtn);
      }

      function startOnline() {
        body.innerHTML = '';
        actions.innerHTML = '';
        var loadingMsg;
        if (llmOn) loadingMsg = '大模型查询中，请稍等…';
        else if (settings.llmApiKey || settings.llmBaseUrl || settings.llmModel) loadingMsg = '大模型配置不完整，正在联网查询…';
        else loadingMsg = '本地未收录，正在联网查询…';
        body.appendChild(UIi.el('div', 'def-loading', '<span class="spinner"></span><span>' + loadingMsg + '</span>'));
        appendCommonActions(actions);
        var rendered = false;
        Dict.fetchOnlineDict(word, function (e, final) {
          if (!sheet.isConnected) return;
          var label = final ? '本地词典 · 已收录' : (e._src === 'llm' ? '大模型' : '在线词典');
          renderEntry(e, label, !rendered);
          rendered = true;
          if (final && !hadLocalRecord) UIi.toast('已加入本地词典，下次可离线查询');
        }, function () {
          if (!sheet.isConnected) return;
          body.innerHTML = '';
          body.appendChild(UIi.el('div', 'def def-empty', '本地词典暂未收录，在线查询也未找到该词'));
        }, function () {
          if (!sheet.isConnected) return;
          body.innerHTML = '';
          body.appendChild(UIi.el('div', 'def def-empty', '在线查询失败，请检查网络连接'));
          actions.innerHTML = '';
          var retry = UIi.el('button', 'btn btn-tonal', '重试');
          retry.addEventListener('click', startOnline);
          actions.appendChild(retry);
          appendCommonActions(actions);
        });
      }

      if (entry) {
        renderEntry(entry, '');
      } else {
        startOnline();
      }
    });
  }

  /* ============ 生词本 ============ */
  function renderWordbook() {
    renderNav('wordbook');
    view.innerHTML = '';
    var head = UIi.el('div', 'wb-head');
    head.appendChild(UIi.el('h1', null, '生词本 <span style="font-size:14px;font-weight:400;color:var(--md-on-surface-variant)">(' + wordbook.length + ')</span>'));
    if (wordbook.length) {
      var clearBtn = UIi.el('button', 'icon-btn', UIi.icon('delete'));
      clearBtn.setAttribute('aria-label', '清空生词本');
      clearBtn.addEventListener('click', async function () {
        var ok = await UIi.confirmDialog('清空生词本', '确定删除全部 ' + wordbook.length + ' 个生词吗？');
        if (ok) { wordbook.length = 0; Store.saveWordbook(); renderWordbook(); UIi.toast('已清空'); }
      });
      head.appendChild(clearBtn);
    }
    view.appendChild(head);

    var list = UIi.el('div', 'wb-list');
    if (!wordbook.length) {
      list.innerHTML = '<div class="empty-state">生词本还是空的<br>阅读时长按 / 点击单词即可加入</div>';
    } else {
      wordbook.forEach(function (w, i) {
        var card = UIi.el('div', 'wb-card');
        card.style.animationDelay = Math.min(i, 12) * 40 + 'ms';
        var main = UIi.el('div', 'wb-main');
        main.innerHTML = '<div class="wb-word"><span>' + esc(w.word) + '</span>' + (w.phonetic ? '<small>/' + esc(w.phonetic) + '/</small>' : '') + '</div>';
        var defWrap = UIi.el('div', 'wb-def');
        Dict.parseDefs(w.definition).forEach(function (d) {
          var line = UIi.el('div', 'wb-def-line');
          if (d.pos) line.appendChild(UIi.el('span', 'pos-tag', esc(d.pos)));
          line.appendChild(UIi.el('span', null, esc(d.text)));
          defWrap.appendChild(line);
        });
        main.appendChild(defWrap);
        var acts = UIi.el('div', 'wb-actions');
        var spk = UIi.el('button', 'icon-btn', UIi.icon('volume'));
        spk.setAttribute('aria-label', '播放发音');
        spk.addEventListener('click', function () { T.speak(w.word, { onError: function (m) { UIi.toast(m); } }); });
        var del = UIi.el('button', 'icon-btn', UIi.icon('close'));
        del.setAttribute('aria-label', '删除 ' + w.word);
        del.addEventListener('click', function () {
          wordbook.splice(i, 1); Store.saveWordbook();
          renderWordbook();
          UIi.toast('已删除 ' + w.word);
        });
        acts.appendChild(spk); acts.appendChild(del);
        card.appendChild(main); card.appendChild(acts);
        list.appendChild(card);
      });
    }
    view.appendChild(list);
  }

  /* ============ 设置 ============ */
  function renderSettings() {
    renderNav('settings');
    view.innerHTML = '';
    view.appendChild(UIi.el('div', 'set-head', '<h1>设置</h1>'));
    var body = UIi.el('div', 'set-body');
    view.appendChild(body);

    /* --- 朗读引擎 --- */
    var c1 = UIi.el('div', 'set-card');
    c1.innerHTML = '<h2>朗读引擎</h2><div class="hint">系统语音离线可用；云端高质量语音需联网并配置密钥。</div>' +
      '<div class="seg"><button data-e="system">系统语音</button><button data-e="cloud">云端 · 火山方舟</button></div>';
    var segs = c1.querySelectorAll('.seg button');
    function paintSeg() {
      segs.forEach(function (b) { b.classList.toggle('on', b.dataset.e === settings.engine); });
      cloudBox.style.display = settings.engine === 'cloud' ? '' : 'none';
    }
    segs.forEach(function (b) {
      b.addEventListener('click', function () {
        settings.engine = b.dataset.e; Store.saveSettings(); applyTtsSettings(); paintSeg();
        UIi.toast(settings.engine === 'cloud' ? '已切换为云端语音' : '已切换为系统语音');
      });
    });
    var cloudBox = UIi.el('div');
    cloudBox.innerHTML =
      '<div class="hint warn">注意：浏览器直接调用云端接口可能被跨域(CORS)拦截，如请求失败请切回系统语音。</div>' +
      '<input class="field" type="password" id="f-key" placeholder="ARK API Key" value="' + esc(settings.apiKey) + '">' +
      '<input class="field" type="text" id="f-endpoint" placeholder="TTS 端点" value="' + esc(settings.endpoint) + '">' +
      '<input class="field" type="text" id="f-model" placeholder="模型名称" value="' + esc(settings.model) + '">' +
      '<input class="field" type="text" id="f-cvoice" placeholder="音色 ID" value="' + esc(settings.cloudVoiceId) + '">' +
      '<div class="set-row"><button class="btn btn-tonal" id="f-save" style="margin-top:12px">保存云端配置</button></div>';
    c1.appendChild(cloudBox);
    body.appendChild(c1);
    paintSeg();
    function b(id) { return document.getElementById(id); }
    b('f-save').addEventListener('click', function () {
      settings.apiKey = b('f-key').value.trim();
      settings.endpoint = b('f-endpoint').value.trim() || settings.endpoint;
      settings.model = b('f-model').value.trim() || settings.model;
      settings.cloudVoiceId = b('f-cvoice').value.trim();
      Store.saveSettings(); applyTtsSettings();
      UIi.toast('云端配置已保存');
    });

    /* --- 大模型查词（OpenAI 兼容接口，可选） --- */
    var cLlm = UIi.el('div', 'set-card');
    cLlm.innerHTML = '<h2>大模型查词</h2><div class="hint">配置后查词与释义翻译优先走大模型，失败自动回退在线词典。API Key 仅保存在本机浏览器 localStorage，不会上传。</div>';
    var llmBox = UIi.el('div');
    llmBox.innerHTML =
      '<div class="hint warn">注意：浏览器直连部分服务可能被跨域(CORS)拦截，若保存后查词仍失败请更换支持 CORS 的接口或留空回退。</div>' +
      '<input class="field" type="password" id="f-llmkey" placeholder="API Key" value="' + esc(settings.llmApiKey) + '">' +
      '<input class="field" type="text" id="f-llmurl" placeholder="Base URL（不含 /chat/completions）" value="' + esc(settings.llmBaseUrl) + '">' +
      '<div class="set-row"><button class="btn btn-tonal" id="f-llm-fetch" style="margin-top:12px">获取模型列表</button></div>' +
      '<select class="field" id="f-llm-model" style="display:none"></select>' +
      '<input class="field" type="text" id="f-llm-model-manual" placeholder="模型名称（如列表获取失败可手动输入）" value="' + esc(settings.llmModel) + '">' +
      '<div class="set-row"><button class="btn btn-tonal" id="f-llm-save" style="margin-top:12px">保存大模型配置</button></div>' +
      '<div class="hint" id="f-llm-status"></div>';
    cLlm.appendChild(llmBox);
    body.appendChild(cLlm);
    function paintLlmStatus() {
      var missing = [];
      if (!settings.llmApiKey) missing.push('API Key');
      if (!settings.llmBaseUrl) missing.push('Base URL');
      if (!settings.llmModel) missing.push('模型名称');
      var el = document.getElementById('f-llm-status');
      if (!el) return;
      if (!missing.length) {
        el.textContent = '当前状态：已启用，查词优先走大模型（模型 ' + settings.llmModel + '）';
      } else if (settings.llmApiKey || settings.llmBaseUrl || settings.llmModel) {
        el.textContent = '当前状态：配置不完整，缺 ' + missing.join('、') + ' —— 查词仍走在线词典';
      } else {
        el.textContent = '当前状态：未配置，查词走在线词典链路';
      }
    }
    paintLlmStatus();
    var llmSel = b('f-llm-model');
    var llmManual = b('f-llm-model-manual');
    b('f-llm-fetch').addEventListener('click', function () {
      var key = b('f-llmkey').value.trim();
      var url = b('f-llmurl').value.trim().replace(/\/+$/, '');
      if (!key || !url) { UIi.toast('请先填写 API Key 与 Base URL'); return; }
      UIi.toast('正在获取模型列表…');
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
      fetch(url + '/models', { headers: { 'Authorization': 'Bearer ' + key }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) {
          var ids = ((j && j.data) || []).map(function (m) { return m && m.id; }).filter(Boolean).sort();
          if (!ids.length) throw new Error('empty');
          llmSel.innerHTML = '';
          ids.forEach(function (id) { llmSel.appendChild(new Option(id, id)); });
          if (ids.indexOf(settings.llmModel) >= 0) llmSel.value = settings.llmModel;
          llmSel.style.display = '';
          llmManual.style.display = 'none';
          UIi.toast('已获取 ' + ids.length + ' 个模型，请选择后保存');
        })
        .catch(function () {
          clearTimeout(timer);
          llmSel.style.display = 'none';
          llmManual.style.display = '';
          UIi.toast('模型列表获取失败（可能是 CORS 拦截或 Key 无效），请手动输入模型名', 4000);
        });
    });
    b('f-llm-save').addEventListener('click', function () {
      settings.llmApiKey = b('f-llmkey').value.trim();
      settings.llmBaseUrl = b('f-llmurl').value.trim().replace(/\/+$/, '');
      settings.llmModel = (llmSel.style.display !== 'none' && llmSel.value) ? llmSel.value : llmManual.value.trim();
      Store.saveSettings();
      paintLlmStatus();
      UIi.toast(settings.llmApiKey && settings.llmBaseUrl && settings.llmModel ? '大模型查词已启用' : '配置不完整，将继续使用在线词典链路');
    });

    /* --- 语音与阅读 --- */
    var c2 = UIi.el('div', 'set-card');
    c2.innerHTML = '<h2>语音与阅读</h2>';
    var r1 = UIi.el('div', 'set-row');
    r1.innerHTML = '<label>语速</label><input type="range" id="f-rate" min="0.5" max="2" step="0.1" value="' + settings.rate + '"><span class="value" id="f-rate-v">' + settings.rate.toFixed(1) + '</span>';
    c2.appendChild(r1);

    var r2 = UIi.el('div', 'set-row');
    r2.innerHTML = '<label>字号</label><input type="range" id="f-size" min="13" max="30" step="1" value="' + settings.fontSize + '"><span class="value" id="f-size-v">' + settings.fontSize + '</span>';
    c2.appendChild(r2);

    var r3 = UIi.el('div', 'set-row');
    var voiceSel = UIi.el('select', 'field');
    voiceSel.id = 'f-voice';
    voiceSel.style.marginTop = '0';
    function fillVoices() {
      voiceSel.innerHTML = '';
      var opt0 = new Option('自动选择英文音色', '');
      voiceSel.appendChild(opt0);
      var eng = T.voices.filter(function (v) { return /^en/i.test(v.lang); });
      var others = T.voices.filter(function (v) { return !/^en/i.test(v.lang); });
      eng.concat(others).forEach(function (v) {
        var o = new Option((v.name || v.voiceURI) + ' (' + v.lang + ')', v.voiceURI);
        voiceSel.appendChild(o);
      });
      voiceSel.value = settings.voice;
      if (!eng.length && T.voices.length) {
        var tip = UIi.el('span', 'hint');
        tip.textContent = '未发现英文语音，请确认系统已安装 TTS 引擎';
        c2.appendChild(tip);
      }
    }
    r3.innerHTML = '<label>音色</label>';
    r3.appendChild(voiceSel);
    c2.appendChild(r3);
    fillVoices();
    var voiceWatcher = function () { if (T.voicesReady && voiceSel.options.length <= 1) fillVoices(); };
    T.onChange(voiceWatcher);
    addCleanup(function () { T.offChange(voiceWatcher); });

    if (synthHasVoicesLater()) {
      var retry = setInterval(function () {
        if (T.voices.length) { fillVoices(); clearInterval(retry); }
      }, 400);
      addCleanup(function () { clearInterval(retry); });
    }
    function synthHasVoicesLater() { return window.speechSynthesis && !T.voices.length; }

    var rateInput = r1.querySelector('#f-rate');
    var sizeInput = r2.querySelector('#f-size');
    rateInput.addEventListener('input', function () {
      settings.rate = parseFloat(this.value);
      r1.querySelector('#f-rate-v').textContent = settings.rate.toFixed(1);
      Store.saveSettings(); applyTtsSettings();
    });
    sizeInput.addEventListener('input', function () {
      settings.fontSize = parseInt(this.value);
      r2.querySelector('#f-size-v').textContent = settings.fontSize;
      Store.saveSettings(); applyTtsSettings();
    });
    voiceSel.addEventListener('change', function () {
      settings.voice = voiceSel.value; Store.saveSettings(); applyTtsSettings();
    });

    var r4 = UIi.el('div', 'set-row');
    var testBtn = UIi.el('button', 'btn btn-tonal', UIi.icon('volume', 'sm') + '<span>试听发音</span>');
    testBtn.addEventListener('click', function () {
      T.stop();
      T.speak('Hello! Keep reading every day, and your English will improve.', { onError: function (m) { UIi.toast(m, 4000); } });
      UIi.toast('正在试听…');
    });
    r4.appendChild(testBtn);
    c2.appendChild(r4);
    body.appendChild(c2);

    /* --- 数据管理 --- */
    var c3 = UIi.el('div', 'set-card');
    c3.innerHTML = '<h2>数据管理</h2>';
    var dmHint = UIi.el('div', 'hint');
    c3.appendChild(dmHint);
    function paintDmHint() {
      var llmState = (settings.llmApiKey && settings.llmBaseUrl && settings.llmModel) ? '已配置' : '未配置';
      dmHint.textContent = '生词 ' + wordbook.length + ' 个 · 收藏 ' + favorites.size + ' 篇 · 阅读进度 ' + Object.keys(progress).length + ' 篇 · 译文缓存 ' + Store.transCount() + ' 条 · 本地词典已收录 ' + Store.dictWords().length + ' 词 · 大模型查词：' + llmState;
    }
    paintDmHint();

    /* 本地词典收录管理 */
    function openDictManager() {
      UIi.openSheet(function (sheet) {
        var headRow = UIi.el('div', 'sheet-head');
        var headTitle = UIi.el('h3');
        function paintHead() { headTitle.textContent = '本地词典收录（' + Store.dictWords().length + '）'; }
        paintHead();
        headRow.appendChild(headTitle);
        sheet.appendChild(headRow);
        var listWrap = UIi.el('div', 'dict-body');
        sheet.appendChild(listWrap);
        function renderList() {
          listWrap.innerHTML = '';
          var words = Store.dictWords().sort();
          if (!words.length) {
            listWrap.appendChild(UIi.el('div', 'def def-empty', '暂无收录词，阅读时查词会自动收录'));
          } else {
            words.forEach(function (w) {
              var e = Store.dictGet(w) || {};
              var firstDef = (e.items && e.items[0]) ? ((e.items[0].pos ? e.items[0].pos + ' ' : '') + e.items[0].zh) : '';
              var card = UIi.el('div', 'wb-card');
              var main = UIi.el('div', 'wb-main');
              main.innerHTML = '<div class="wb-word"><span>' + esc(w) + '</span>' + (e.phonetic ? '<small>/' + esc(e.phonetic) + '/</small>' : '') + '</div>' +
                (firstDef ? '<div class="wb-def">' + esc(firstDef) + '</div>' : '');
              var acts = UIi.el('div', 'wb-actions');
              var del = UIi.el('button', 'icon-btn', UIi.icon('close'));
              del.setAttribute('aria-label', '删除 ' + w);
              del.addEventListener('click', function () {
                Store.dictRemove(w);
                UIi.toast('已删除 ' + w);
                paintHead(); renderList(); paintDmHint();
              });
              acts.appendChild(del);
              card.appendChild(main); card.appendChild(acts);
              listWrap.appendChild(card);
            });
          }
          paintDmHint();
        }
        renderList();
        var actions = UIi.el('div', 'sheet-actions');
        var closeBtn = UIi.el('button', 'btn btn-text', '关闭');
        closeBtn.addEventListener('click', UIi.closeSheet);
        actions.appendChild(closeBtn);
        sheet.appendChild(actions);
      });
    }

    var r6 = UIi.el('div', 'set-row');
    var bm = UIi.el('button', 'btn btn-text', '管理收录词');
    bm.addEventListener('click', openDictManager);
    var bcl = UIi.el('button', 'btn btn-text', '清空收录');
    bcl.addEventListener('click', async function () {
      if (await UIi.confirmDialog('清空本地词典收录', '确定删除全部 ' + Store.dictWords().length + ' 个收录词吗？')) {
        Store.dictClear();
        paintDmHint();
        UIi.toast('已清空收录');
      }
    });
    r6.appendChild(bm); r6.appendChild(bcl);
    c3.appendChild(r6);

    var r5 = UIi.el('div', 'set-row');
    var bw = UIi.el('button', 'btn btn-text', '清空生词本');
    bw.addEventListener('click', async function () {
      if (await UIi.confirmDialog('清空生词本', '确定删除全部生词吗？')) {
        wordbook.length = 0; Store.saveWordbook(); renderSettings(); UIi.toast('已清空');
      }
    });
    var bp = UIi.el('button', 'btn btn-text', '清空阅读进度');
    bp.addEventListener('click', async function () {
      if (await UIi.confirmDialog('清空阅读进度', '确定清空所有文章的阅读进度吗？')) {
        Object.keys(progress).forEach(function (k) { delete progress[k]; });
        Store.saveProgress(); renderSettings(); UIi.toast('已清空');
      }
    });
    var bc = UIi.el('button', 'btn btn-text', '清 TTS 缓存');
    bc.addEventListener('click', function () { T.clearCache(); UIi.toast('已清除语音缓存'); });
    r5.appendChild(bw); r5.appendChild(bp); r5.appendChild(bc);
    c3.appendChild(r5);
    body.appendChild(c3);

    body.appendChild(UIi.el('div', 'set-foot', '考研英语阅读 Web 版 v2.1 · 内置 ' + articles.length + ' 篇外刊 · ' + DICT.size + ' 词词典'));
  }

  /* ============ 启动 ============ */
  applyTtsSettings();
  applyTheme();
  var themeBtn = document.getElementById('f-theme');
  if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
  paintThemeBtns();
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
  if (!location.hash) location.hash = '#/library';
  route();
})();
