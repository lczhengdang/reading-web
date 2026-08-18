/* UI 基础组件：图标 / Toast / 底部弹窗 / 确认对话框 */
(function () {
  'use strict';

  const P = {
    book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
    translate: 'M12.87 15.07l-2.54-2.51.03-.03A11.8 11.8 0 0 0 13.99 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z',
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
    star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    starBorder: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    stop: 'M6 6h12v12H6z',
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'
  };

  function icon(name, cls) {
    const path = P[name] || P.book;
    return '<svg class="svg-icon ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ---- toast ---- */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }

  /* ---- bottom sheet（支持 Esc 关闭与焦点管理） ---- */
  var lastFocus = null;
  function overlayKeydown(ev) {
    if (ev.key === 'Escape') { closeSheet(); return; }
    if (ev.key !== 'Tab') return;
    /* 简易焦点圈定：Tab 循环保持在弹窗内 */
    var sheet = document.querySelector('#overlay-root .sheet');
    if (!sheet) return;
    var focusables = sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
  function openSheet(contentBuilder) {
    closeSheet();
    lastFocus = document.activeElement;
    const root = document.getElementById('overlay-root');
    const ov = el('div', 'overlay');
    const sheet = el('div', 'sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.appendChild(el('div', 'sheet-grab'));
    if (contentBuilder) contentBuilder(sheet);
    ov.appendChild(sheet);
    ov.addEventListener('click', function (ev) {
      if (ev.target === ov) closeSheet();
    });
    root.appendChild(ov);
    document.addEventListener('keydown', overlayKeydown);
    var focusables = sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusables.length) focusables[0].focus();
    return sheet;
  }

  function closeSheet() {
    const root = document.getElementById('overlay-root');
    if (root.firstChild) {
      while (root.firstChild) root.removeChild(root.firstChild);
      document.removeEventListener('keydown', overlayKeydown);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      lastFocus = null;
    }
  }

  /* ---- confirm dialog（支持 Esc 取消） ---- */
  function confirmDialog(title, message) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      const wrap = el('div', 'dialog-wrap');
      const dlg = el('div', 'dialog');
      dlg.setAttribute('role', 'alertdialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.appendChild(el('h3', null, title));
      dlg.appendChild(el('p', null, message));
      const row = el('div', 'row');
      const cancel = el('button', 'btn btn-text', '取消');
      const ok = el('button', 'btn btn-text', '确定');
      function done(val) {
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(val);
      }
      function onKey(ev) { if (ev.key === 'Escape') done(false); }
      cancel.addEventListener('click', function () { done(false); });
      ok.addEventListener('click', function () { done(true); });
      row.appendChild(cancel);
      row.appendChild(ok);
      dlg.appendChild(row);
      wrap.appendChild(dlg);
      wrap.addEventListener('click', function (ev) { if (ev.target === wrap) done(false); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      ok.focus();
    });
  }

  window.UI = { icon: icon, el: el, toast: toast, openSheet: openSheet, closeSheet: closeSheet, confirmDialog: confirmDialog };
})();
