/* تل‌چت — هسته برنامه: API، رویدادهای زنده، لیست گفتگوها و صفحه گفتگو */
'use strict';

/* ============================== ابزارها ============================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24"><path d="${ICONS[n] || ''}"/></svg>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTouch = matchMedia('(pointer: coarse)').matches;
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const Native = window.TelchatAndroid || null; // پل اپ اندروید

const store = {
  get(k, d = null) { try { const v = localStorage.getItem('tc_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tc_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem('tc_' + k); } catch { /* ignore */ } },
};

const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fmtTime = (ts) => new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(ts * 1000);
const sameDay = (a, b) => new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();
function fmtDay(ts) {
  const now = Date.now() / 1000;
  if (sameDay(ts, now)) return 'امروز';
  if (sameDay(ts, now - 86400)) return 'دیروز';
  const d = new Date(ts * 1000);
  const opts = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return new Intl.DateTimeFormat('fa-IR', opts).format(d);
}
function fmtListTime(ts) {
  if (!ts) return '';
  const now = Date.now() / 1000;
  if (sameDay(ts, now)) return fmtTime(ts);
  if (now - ts < 6 * 86400) return new Intl.DateTimeFormat('fa-IR', { weekday: 'short' }).format(ts * 1000);
  return new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'short' }).format(ts * 1000);
}
function fmtSize(b) {
  if (b < 1024) return faNum(b) + ' بایت';
  if (b < 1048576) return faNum((b / 1024).toFixed(1)) + ' کیلوبایت';
  return faNum((b / 1048576).toFixed(1)) + ' مگابایت';
}
const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

function lastSeenText(ls) {
  if (ls === undefined || ls === null) return '';
  if (ls < 0) return { '-1': 'اخیراً آنلاین بوده', '-2': 'در هفته اخیر آنلاین بوده', '-3': 'در ماه اخیر آنلاین بوده', '-4': 'خیلی وقت پیش آنلاین بوده' }[ls] || 'اخیراً آنلاین بوده';
  const now = App.now();
  if (now - ls < 45) return 'آنلاین';
  const diff = now - ls;
  if (diff < 3600) return 'آخرین بازدید ' + faNum(Math.max(1, Math.floor(diff / 60))) + ' دقیقه پیش';
  if (sameDay(ls, now)) return 'آخرین بازدید امروز ساعت ' + fmtTime(ls);
  if (sameDay(ls, now - 86400)) return 'آخرین بازدید دیروز ساعت ' + fmtTime(ls);
  return 'آخرین بازدید ' + fmtDay(ls);
}
const isOnline = (ls) => ls > 0 && App.now() - ls < 45;

function avatarHtml(o, cls = '', online = false) {
  const id = o?.id || 0;
  if (o?.type === 'saved') return `<div class="avatar saved-av ${cls}">${icon('bookmark')}</div>`;
  const name = (o?.title || o?.name || '?').trim();
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const dot = online ? '<i class="online-dot"></i>' : '';
  if (o?.avatar) return `<div class="avatar ${cls}"><img src="${esc(o.avatar)}" alt="" loading="lazy">${dot}</div>`;
  return `<div class="avatar c${id % 7} ${cls}">${esc(initials)}${dot}</div>`;
}

function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?»)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)@([a-zA-Z][a-zA-Z0-9_]{3,31})/g, '$1<a href="#" data-mention="$2">@$2</a>');
}
const emojiOnly = (t) => t && t.length <= 12 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const ERRORS = {
  invalid_credentials: 'نام کاربری یا رمز عبور اشتباه است',
  username_taken: 'این نام کاربری قبلاً گرفته شده است',
  invalid_username: 'نام کاربری باید با حرف انگلیسی شروع شود و ۴ تا ۳۲ کاراکتر (a-z، عدد، _) باشد',
  password_too_short: 'رمز عبور باید حداقل ۶ کاراکتر باشد',
  name_required: 'نام را وارد کنید',
  registration_closed: 'ثبت‌نام بسته است',
  invalid_register_code: 'کد دعوت نادرست است',
  file_too_large: 'حجم فایل بیش از حد مجاز است',
  user_blocked_you: 'این کاربر شما را مسدود کرده است',
  you_blocked_user: 'شما این کاربر را مسدود کرده‌اید',
  privacy_restricted: 'تنظیمات حریم خصوصی این کاربر اجازه افزودن به گروه را نمی‌دهد',
  invalid_password: 'رمز عبور فعلی اشتباه است',
  admin_required: 'فقط مدیران گروه این دسترسی را دارند',
  owner_required: 'فقط سازنده گروه این دسترسی را دارد',
  not_member: 'شما عضو این گفتگو نیستید',
  network: 'خطا در اتصال به سرور',
  not_installed: 'برنامه هنوز نصب نشده است. install.php را باز کنید',
};
const errText = (e) => ERRORS[e?.message] || ERRORS[e] || 'خطا: ' + (e?.message || e);

/* ============================== API ============================== */

const API = {
  base: 'api/index.php?action=',
  async call(action, data = {}, opts = {}) {
    let res;
    try {
      res = await fetch(this.base + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(App.token ? { 'X-Auth-Token': App.token } : {}) },
        body: JSON.stringify(data),
        signal: opts.signal,
        cache: 'no-store',
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('network');
    }
    let j;
    try { j = await res.json(); } catch { throw new Error('network'); }
    if (j.error) {
      if (j.error === 'unauthorized' && App.token) App.logout(true);
      throw new Error(j.error);
    }
    return j;
  },
  upload(file, extra = {}, onProgress = null, action = 'files.upload') {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file, file.name || 'file');
      Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
      const x = new XMLHttpRequest();
      x.open('POST', this.base + action);
      x.setRequestHeader('X-Auth-Token', App.token);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      x.onload = () => {
        try {
          const j = JSON.parse(x.responseText);
          j.error ? reject(new Error(j.error)) : resolve(j);
        } catch { reject(new Error(x.status === 413 ? 'file_too_large' : 'network')); }
      };
      x.onerror = () => reject(new Error('network'));
      x.send(fd);
      if (extra.__xhr) extra.__xhr(x);
    });
  },
};

/* ============================== وضعیت برنامه ============================== */

const App = {
  token: store.get('token'),
  me: store.get('me'),
  cfg: {},
  chats: new Map(),
  msgs: new Map(), // chatId -> {list, hasMore, hasMoreAfter}
  current: 0,
  lastEventId: -1,
  pollCtl: null,
  timeOffset: 0,
  typing: new Map(), // chatId -> Map(userId -> {name, kind, until})
  reply: null,
  editing: null,
  drafts: store.get('drafts', {}),
  settings: Object.assign({ theme: 'auto', fontSize: 16, sendEnter: !isTouch, sound: true, preview: true }, store.get('settings', {})),
  online: true,
  now() { return Math.floor(Date.now() / 1000) + this.timeOffset; },

  async start() {
    applyTheme();
    if ('serviceWorker' in navigator && !Native) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'open_chat') location.hash = '#/chat/' + e.data.chat_id;
      });
    }
    try { this.cfg = await API.call('config'); } catch (e) {
      if (e.message === 'not_installed') { $('#root').innerHTML = `<div class="empty-note">${ERRORS.not_installed}</div>`; return; }
    }
    if (!this.token) return renderAuth();
    if (window.Settings?.checkLock && !(await Settings.checkLock())) return;
    this.boot();
  },

  async boot() {
    renderLayout();
    Native?.setSession?.(location.href.split('#')[0].replace(/index\.html$/, ''), this.token);
    this.pollLoop();
    try {
      const r = await API.call('me.get');
      this.me = r.user; store.set('me', r.user);
      renderSideHeader();
    } catch { /* offline */ }
    await this.loadChats();
    route();
    window.Settings?.afterBoot?.();
  },

  logout(expired = false) {
    const t = this.token;
    this.token = null;
    this.pollCtl?.abort();
    if (!expired && t) {
      navigator.serviceWorker?.ready.then((r) => r.pushManager?.getSubscription()).then((s) => {
        fetch(API.base + 'auth.logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': t }, body: JSON.stringify({ endpoint: s?.endpoint || '' }) });
        s?.unsubscribe();
      }).catch(() => {});
    }
    Native?.clearSession?.();
    ['token', 'me', 'drafts', 'lock'].forEach((k) => store.del(k));
    location.hash = '';
    location.reload();
  },

  async loadChats() {
    try {
      const r = await API.call('chats.list');
      this.chats = new Map(r.chats.map((c) => [c.id, c]));
      renderChatList();
      if (this.current && this.chats.has(this.current)) renderChatHeader();
      updateBadge();
    } catch (e) { if (e.message !== 'network') toast(errText(e)); }
  },
  loadChatsSoon() { clearTimeout(this._lc); this._lc = setTimeout(() => this.loadChats(), 400); },

  /* ---------- دریافت رویدادهای زنده با Long Polling ---------- */
  async pollLoop() {
    let fails = 0;
    while (this.token) {
      this.pollCtl = new AbortController();
      const timer = setTimeout(() => this.pollCtl.abort(), 40000);
      try {
        const watch = [];
        const c = this.chats.get(this.current);
        if (c?.peer) watch.push(c.peer.id);
        const r = await API.call('poll', { last_id: this.lastEventId, visible: !document.hidden, watch }, { signal: this.pollCtl.signal });
        clearTimeout(timer);
        if (fails || !this.online) { this.setOnline(true); if (fails) { this.loadChats(); reloadCurrent(); } }
        fails = 0;
        this.timeOffset = r.presence.now - Math.floor(Date.now() / 1000);
        for (const [uid, ls] of Object.entries(r.presence.users || {})) updatePresence(+uid, ls);
        const wasInit = this.lastEventId < 0;
        this.lastEventId = r.last_id;
        if (!wasInit) r.events.forEach((e) => { try { handleEvent(e); } catch (err) { console.error(err); } });
      } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') continue;
        fails++;
        if (fails > 1) this.setOnline(false);
        await sleep(Math.min(15000, 1000 * fails));
      }
    }
  },
  restartPoll() { this.pollCtl?.abort(); },
  setOnline(v) {
    this.online = v;
    const el = $('.conn-state');
    if (el) el.hidden = v;
    renderChatHeader();
  },
};

/* ============================== پردازش رویدادها ============================== */

function handleEvent(e) {
  const d = e.data;
  switch (e.type) {
    case 'message': onNewMessage(d); break;
    case 'message_edit': onEditMessage(d); break;
    case 'message_delete': onDeleteMessages(d.chat_id, d.ids); break;
    case 'read': onRead(d); break;
    case 'typing': onTyping(d); break;
    case 'chats_changed': App.loadChatsSoon(); break;
    case 'chat_removed':
      App.chats.delete(d.chat_id); App.msgs.delete(d.chat_id);
      if (App.current === d.chat_id) location.hash = '';
      renderChatList(); break;
    case 'chat_cleared':
      App.msgs.delete(d.chat_id);
      if (App.current === d.chat_id) loadMessages(d.chat_id);
      App.loadChatsSoon(); break;
  }
}

function onNewMessage(m) {
  const chat = App.chats.get(m.chat_id);
  const mine = m.user_id === App.me?.id;
  clearTyping(m.chat_id, m.user_id);
  const st = App.msgs.get(m.chat_id);
  if (st && !st.hasMoreAfter) {
    const tmp = m.client_id && st.list.findIndex((x) => x.client_id === m.client_id);
    if (tmp !== false && tmp >= 0) {
      if (st.list[tmp].pending) { st.list[tmp] = m; replaceMsgNode(m.client_id, m); }
    } else if (!st.list.some((x) => x.id === m.id)) {
      st.list.push(m);
      if (App.current === m.chat_id) appendMsgNode(m);
    }
  }
  if (!chat) { App.loadChatsSoon(); return; }
  chat.last_message = { ...m, preview: previewOf(m) };
  chat.updated_at = m.created_at;
  const viewing = App.current === m.chat_id && !document.hidden && isAtBottom();
  if (!mine && m.type !== 'system') {
    if (viewing) markRead(m.chat_id, m.id);
    else {
      chat.unread = (chat.unread || 0) + 1;
      if (!chat.muted) notifyIncoming(chat, m);
    }
  } else if (mine) {
    chat.last_read_id = Math.max(chat.last_read_id, m.id);
    if (chat.type === 'saved') chat.others_read_id = m.id;
  }
  if (App.current === m.chat_id && !viewing && !mine) updateToBottom();
  renderChatList();
  updateBadge();
}

function onEditMessage(m) {
  const st = App.msgs.get(m.chat_id);
  if (st) {
    const i = st.list.findIndex((x) => x.id === m.id);
    if (i >= 0) { st.list[i] = m; if (App.current === m.chat_id) replaceMsgNode(m.id, m); }
    st.list.forEach((x, j) => { if (x.reply_to?.id === m.id) { x.reply_to.text = previewOf(m); if (App.current === m.chat_id) replaceMsgNode(x.id, x); } });
  }
  const chat = App.chats.get(m.chat_id);
  if (chat?.last_message?.id === m.id) { chat.last_message = { ...m, preview: previewOf(m) }; renderChatList(); }
  if (chat?.pinned_message?.id === m.id) { chat.pinned_message = { ...m, preview: previewOf(m) }; renderPinned(); }
}

function onDeleteMessages(chatId, ids) {
  const st = App.msgs.get(chatId);
  if (st) st.list = st.list.filter((x) => !ids.includes(x.id));
  if (App.current === chatId) { ids.forEach((id) => $('#m' + id)?.remove()); fixGrouping(); }
  const chat = App.chats.get(chatId);
  if (chat && (ids.includes(chat.last_message?.id) || ids.includes(chat.pinned_message?.id) || chat.unread)) App.loadChatsSoon();
}

function onRead(d) {
  const chat = App.chats.get(d.chat_id);
  if (!chat) return;
  if (d.user_id === App.me?.id) {
    chat.last_read_id = Math.max(chat.last_read_id, d.last_read_id);
    App.loadChatsSoon();
    Settings.clearNotifications?.(d.chat_id);
  } else if (d.last_read_id > (chat.others_read_id || 0) || chat.others_read_id > 1e15) {
    chat.others_read_id = chat.others_read_id > 1e15 ? d.last_read_id : Math.max(chat.others_read_id, d.last_read_id);
    if (App.current === d.chat_id) $$('.msg.out').forEach((n) => updateTicks(n));
    renderChatList();
  }
}

function onTyping(d) {
  if (!App.typing.has(d.chat_id)) App.typing.set(d.chat_id, new Map());
  App.typing.get(d.chat_id).set(d.user_id, { name: d.name, kind: d.kind, until: Date.now() + 6000 });
  renderChatList();
  if (App.current === d.chat_id) renderChatHeader();
  clearTimeout(onTyping.t);
  onTyping.t = setTimeout(() => { renderChatList(); renderChatHeader(); }, 6100);
}
function clearTyping(chatId, userId) { App.typing.get(chatId)?.delete(userId); }
function typingText(chatId) {
  const m = App.typing.get(chatId);
  if (!m) return '';
  const now = Date.now();
  const list = [...m.values()].filter((t) => t.until > now);
  if (!list.length) return '';
  const chat = App.chats.get(chatId);
  const verb = list[0].kind === 'voice' ? 'در حال ضبط صدا' : list[0].kind === 'file' ? 'در حال ارسال فایل' : 'در حال نوشتن';
  if (chat?.type !== 'group') return verb + '...';
  if (list.length > 1) return faNum(list.length) + ' نفر ' + verb + '...';
  return list[0].name + ' ' + verb + '...';
}

function updatePresence(uid, ls) {
  for (const c of App.chats.values()) if (c.peer?.id === uid) c.peer.last_seen = ls;
  renderChatHeader();
}

function previewOf(m) {
  const L = { image: '🖼 عکس', video: '🎬 ویدیو', voice: '🎤 پیام صوتی', audio: '🎵 فایل صوتی', file: '📎 ' + (m.file?.name || 'فایل') };
  const body = (m.body || '').replace(/\s+/g, ' ').trim();
  return L[m.type] ? (body ? L[m.type] + '، ' + body : L[m.type]) : body;
}

let audioCtx;
function beep() {
  if (!App.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.setValueAtTime(1320, audioCtx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.start(); o.stop(audioCtx.currentTime + 0.26);
  } catch { /* ignore */ }
}

/** وقتی برنامه باز است (حتی در پس‌زمینه) اعلان محلی نمایش می‌دهد — بدون نیاز به سرویس خارجی */
function notifyIncoming(chat, m) {
  if (!document.hidden) { beep(); return; }
  if (Native || !('Notification' in window) || Notification.permission !== 'granted') return;
  const title = chat.type === 'group' ? chat.title : m.sender.name;
  let body = App.settings.preview ? previewOf(m) : 'پیام جدید';
  if (chat.type === 'group' && App.settings.preview) body = m.sender.name + ': ' + body;
  navigator.serviceWorker?.ready.then((reg) => reg.showNotification(title, {
    body, tag: 'chat-' + chat.id, icon: chat.avatar || 'assets/icons/icon-192.png', badge: 'assets/icons/badge.png',
    data: { chat_id: chat.id }, renotify: true,
  })).catch(() => {});
}

function updateBadge() {
  let n = 0;
  for (const c of App.chats.values()) if (!c.muted) n += c.unread || 0;
  document.title = (n ? '(' + faNum(n) + ') ' : '') + (App.cfg.app_name || 'تل‌چت');
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch { /* ignore */ }
}

/* ============================== صفحه ورود و ثبت‌نام ============================== */

function renderAuth(mode = 'login') {
  const reg = mode === 'register';
  const name = App.cfg.app_name || 'تل‌چت';
  $('#root').innerHTML = `
  <div class="auth"><form class="auth-box" autocomplete="on">
    <img class="logo" src="assets/icons/icon-192.png" alt="">
    <h1>${esc(name)}</h1>
    <p class="sub">${reg ? 'برای ساخت حساب جدید اطلاعات زیر را وارد کنید.' : 'برای ورود، نام کاربری و رمز عبور خود را وارد کنید.'}</p>
    ${reg ? '<div class="field"><label>نام نمایشی</label><input name="name" required maxlength="64" autocomplete="name"></div>' : ''}
    <div class="field"><label>نام کاربری</label><input name="username" class="ltr" required autocapitalize="none" autocomplete="username" dir="ltr" placeholder="username">
      ${reg ? '<div class="hint">حروف انگلیسی، عدد و _ (حداقل ۴ کاراکتر)</div>' : ''}</div>
    <div class="field"><label>رمز عبور</label><input name="password" type="password" required dir="ltr" autocomplete="${reg ? 'new-password' : 'current-password'}"></div>
    ${reg && App.cfg.register_code ? '<div class="field"><label>کد دعوت</label><input name="code" required dir="ltr"></div>' : ''}
    <div class="err-text"></div>
    <button class="btn" type="submit">${reg ? 'ثبت‌نام' : 'ورود'}</button>
    ${App.cfg.allow_registration !== false ? `<button class="btn flat switch" type="button">${reg ? 'حساب دارید؟ وارد شوید' : 'حساب ندارید؟ ثبت‌نام کنید'}</button>` : ''}
  </form></div>`;
  const f = $('.auth-box');
  $('.switch', f)?.addEventListener('click', () => renderAuth(reg ? 'login' : 'register'));
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      const r = await API.call(reg ? 'auth.register' : 'auth.login', data);
      App.token = r.token; App.me = r.user;
      store.set('token', r.token); store.set('me', r.user);
      App.boot();
    } catch (e) {
      $('.err-text', f).textContent = errText(e);
      btn.disabled = false;
    }
  });
}

/* ============================== چیدمان اصلی ============================== */

function renderLayout() {
  $('#root').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="side-header">
        <button class="ibtn" id="menuBtn" title="منو">${icon('menu')}</button>
        <div class="search-box">${icon('search')}<input id="search" placeholder="جستجو" autocomplete="off"></div>
      </div>
      <div class="conn-state" hidden>در انتظار اتصال...</div>
      <div id="installBanner"></div>
      <div class="chat-list" id="chatList"><div class="spinner"></div></div>
      <button class="fab" id="fab" title="پیام جدید">${icon('edit')}</button>
    </aside>
    <main class="chat-pane" id="pane"><div class="empty-pane">یک گفتگو را برای شروع پیام‌رسانی انتخاب کنید</div></main>
  </div>`;
  $('#menuBtn').onclick = () => Settings.openMenu();
  $('#fab').onclick = (e) => Settings.newChatMenu(e);
  let st;
  $('#search').addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => runSearch($('#search').value.trim()), 250); });
  $('#search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; runSearch(''); } });
  $('#chatList').addEventListener('click', onListClick);
  $('#chatList').addEventListener('contextmenu', onListContext);
  bindLongPress($('#chatList'), '.chat-item', (item, x, y) => chatItemMenu(+item.dataset.id, x, y));
  Settings.renderInstallBanner?.();
}

function renderSideHeader() { /* نام کاربر در منوی تنظیمات نمایش داده می‌شود */ }

function sortedChats() {
  return [...App.chats.values()].sort((a, b) => (b.pinned - a.pinned) || ((b.last_message?.created_at || b.updated_at) - (a.last_message?.created_at || a.updated_at)));
}

function chatItemHtml(c) {
  const lm = c.last_message;
  const typing = typingText(c.id);
  let sub = '';
  if (typing) sub = `<span class="typing">${esc(typing)}</span>`;
  else if (lm) {
    let who = '';
    if (lm.type !== 'system') {
      if (lm.user_id === App.me?.id && c.type !== 'saved') who = 'شما';
      else if (c.type === 'group') who = lm.sender.name;
    }
    sub = (who ? `<b>${esc(who)}: </b>` : '') + esc(lm.preview ?? previewOf(lm));
  } else if (c.type === 'group') sub = faNum(c.member_count) + ' عضو';
  let ticks = '';
  if (lm && lm.user_id === App.me?.id && lm.type !== 'system' && c.type !== 'saved') ticks = icon(lm.id <= c.others_read_id ? 'checks' : 'check');
  const right = c.unread ? `<span class="badge ${c.muted ? 'muted' : ''}">${faNum(c.unread > 999 ? '999+' : c.unread)}</span>` : (c.pinned ? `<span class="pin-mark">${icon('pin')}</span>` : '');
  const online = c.peer && isOnline(c.peer.last_seen);
  return `<div class="chat-item ${App.current === c.id ? 'active' : ''}" data-id="${c.id}">
    ${avatarHtml(c, '', online)}
    <div class="ci-body">
      <div class="ci-row"><div class="ci-title">${c.type === 'group' ? icon('group') : ''}<span>${esc(c.title)}</span>${c.muted ? icon('mute') : ''}</div>
        <div class="ci-time">${ticks}${fmtListTime(lm?.created_at)}</div></div>
      <div class="ci-row"><div class="ci-sub">${sub}</div>${right}</div>
    </div></div>`;
}

let searchState = null;
function renderChatList() {
  const el = $('#chatList');
  if (!el || searchState) return;
  const list = sortedChats();
  el.innerHTML = list.length ? list.map(chatItemHtml).join('') :
    `<div class="empty-note">هنوز گفتگویی ندارید.<br>از دکمه پایین یا جستجو، کاربر مورد نظر را با نام کاربری پیدا کنید.</div>`;
}

async function runSearch(q) {
  const el = $('#chatList');
  if (!q) { searchState = null; renderChatList(); return; }
  searchState = q;
  const ql = q.toLowerCase().replace(/^@/, '');
  const local = sortedChats().filter((c) => c.title.toLowerCase().includes(ql) || c.peer?.username?.includes(ql));
  const draw = (users = null, msgs = null) => {
    if (searchState !== q) return;
    let html = '';
    if (local.length) html += '<div class="list-title">گفتگوها</div>' + local.map(chatItemHtml).join('');
    if (users === null) html += '<div class="spinner"></div>';
    else {
      const known = new Set(local.map((c) => c.peer?.id).filter(Boolean));
      const u = users.filter((x) => !known.has(x.id));
      if (u.length) html += '<div class="list-title">کاربران</div>' + u.map((x) => `<div class="chat-item" data-user="${x.id}">${avatarHtml(x)}
        <div class="ci-body"><div class="ci-title">${esc(x.name)}</div><div class="ci-sub ltr" style="text-align:right">@${esc(x.username)}</div></div></div>`).join('');
      if (msgs?.length) html += '<div class="list-title">پیام‌ها</div>' + msgs.map((m) => {
        const c = App.chats.get(m.chat_id);
        return `<div class="chat-item" data-id="${m.chat_id}" data-msg="${m.id}">${avatarHtml(c || m.sender)}
        <div class="ci-body"><div class="ci-row"><div class="ci-title">${esc(c?.title || m.sender.name)}</div><div class="ci-time">${fmtListTime(m.created_at)}</div></div>
        <div class="ci-sub">${esc(previewOf(m))}</div></div></div>`;
      }).join('');
      if (!html) html = '<div class="empty-note">نتیجه‌ای یافت نشد</div>';
    }
    el.innerHTML = html;
  };
  draw();
  try {
    const [u, m] = await Promise.all([API.call('users.search', { q }), API.call('messages.search', { q })]);
    draw(u.users, m.messages);
  } catch { draw([], []); }
}

async function onListClick(e) {
  const item = e.target.closest('.chat-item');
  if (!item) return;
  if (item.dataset.user) {
    try {
      const r = await API.call('chats.open_private', { user_id: +item.dataset.user });
      App.chats.set(r.chat.id, r.chat);
      $('#search').value = ''; searchState = null;
      openChat(r.chat.id);
    } catch (err) { toast(errText(err)); }
    return;
  }
  if (item.dataset.msg) { $('#search').value = ''; searchState = null; renderChatList(); openChat(+item.dataset.id, +item.dataset.msg); return; }
  openChat(+item.dataset.id);
}
function onListContext(e) {
  const item = e.target.closest('.chat-item[data-id]');
  if (!item || isTouch) return;
  e.preventDefault();
  chatItemMenu(+item.dataset.id, e.clientX, e.clientY);
}
function chatItemMenu(id, x, y) {
  const c = App.chats.get(id);
  if (!c) return;
  const items = [
    { icon: 'pin', text: c.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن', fn: () => setChat(id, { pinned: c.pinned ? 0 : 1 }) },
    { icon: c.muted ? 'bell' : 'mute', text: c.muted ? 'روشن کردن اعلان' : 'بی‌صدا کردن', fn: () => setChat(id, { muted: c.muted ? 0 : 1 }) },
  ];
  if (c.unread) items.push({ icon: 'checks', text: 'علامت خوانده شده', fn: () => markRead(id, c.last_message?.id || 0, true) });
  items.push({ icon: 'delete', text: c.type === 'group' ? 'ترک گروه' : 'حذف گفتگو', danger: true, fn: () => Settings.deleteChat(c) });
  showMenu(items, x, y);
}
async function setChat(id, data) {
  try {
    const r = await API.call('chats.set', { chat_id: id, ...data });
    App.chats.set(id, r.chat); renderChatList(); renderChatHeader(); updateBadge();
  } catch (e) { toast(errText(e)); }
}

/* ============================== منوی بازشو ============================== */

function showMenu(items, x, y, reactions = null) {
  closeMenu();
  const bd = document.createElement('div');
  bd.className = 'ctx-backdrop';
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  let html = '';
  if (reactions) html += `<div class="ctx-reactions">${reactions.list.map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div>`;
  html += items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon)}<span>${esc(it.text)}</span></button>`).join('');
  m.innerHTML = html;
  document.body.append(bd, m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x - r.width, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  bd.onclick = closeMenu;
  bd.oncontextmenu = (e) => { e.preventDefault(); closeMenu(); };
  m.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeMenu();
    if (b.dataset.r) reactions.fn(b.dataset.r);
    else items[+b.dataset.i].fn();
  };
}
function closeMenu() { $$('.ctx-backdrop, .ctx-menu').forEach((n) => n.remove()); }

function bindLongPress(root, sel, fn) {
  let t, sx, sy, fired;
  root.addEventListener('touchstart', (e) => {
    const target = e.target.closest(sel);
    if (!target) return;
    fired = false;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    t = setTimeout(() => { fired = true; navigator.vibrate?.(15); fn(target, sx, sy); }, 480);
  }, { passive: true });
  const cancel = (e) => {
    if (e.type === 'touchmove' && Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) < 10) return;
    clearTimeout(t);
  };
  root.addEventListener('touchmove', cancel, { passive: true });
  root.addEventListener('touchend', (e) => { clearTimeout(t); if (fired) { e.preventDefault(); fired = false; } });
  root.addEventListener('touchcancel', cancel);
}

/* ============================== مسیریابی ============================== */

function route() {
  const m = location.hash.match(/^#\/chat\/(\d+)/);
  if (m) openChat(+m[1], 0, true);
  else closeChat(true);
}
window.addEventListener('hashchange', () => { if (App.token && $('#pane')) route(); });

async function openChat(id, jumpTo = 0, fromRoute = false) {
  if (!fromRoute && location.hash !== '#/chat/' + id) {
    if (isMobile() && App.current) history.replaceState(null, '', '#/chat/' + id);
    else { App.pushedHash = true; location.hash = '#/chat/' + id; if (!jumpTo) return; }
  }
  if (App.current === id && !jumpTo) { document.body.classList.add('chat-open'); return; }
  if (!App.chats.has(id)) {
    try { const r = await API.call('chats.get', { chat_id: id }); App.chats.set(id, r.chat); } catch { location.hash = ''; return; }
  }
  saveDraft();
  App.current = id; App.reply = null; App.editing = null;
  document.body.classList.add('chat-open');
  renderChatPane();
  renderChatList();
  if (jumpTo) await jumpToMessage(jumpTo);
  else await loadMessages(id);
  App.restartPoll();
}

function closeChat(fromRoute = false) {
  saveDraft();
  App.current = 0;
  document.body.classList.remove('chat-open');
  stopRecording(true);
  if (!isMobile()) $('#pane').innerHTML = '<div class="empty-pane">یک گفتگو را برای شروع پیام‌رسانی انتخاب کنید</div>';
  renderChatList();
  if (!fromRoute) {
    if (App.pushedHash) { App.pushedHash = false; history.back(); } else location.hash = '';
  } else App.pushedHash = false;
}

function reloadCurrent() { if (App.current) { App.msgs.delete(App.current); loadMessages(App.current); } }

/* ============================== صفحه گفتگو ============================== */

function renderChatPane() {
  const c = App.chats.get(App.current);
  $('#pane').innerHTML = `
    <header class="chat-header" id="chatHeader"></header>
    <div class="pinned-bar" id="pinnedBar" hidden></div>
    <div class="chat-search" id="chatSearch" hidden>
      <button class="ibtn" data-act="search-close">${icon('close')}</button>
      <input placeholder="جستجو در گفتگو">
      <span class="count"></span>
      <button class="ibtn" data-act="search-up">${icon('up')}</button>
      <button class="ibtn" data-act="search-down">${icon('down')}</button>
    </div>
    <div class="messages" id="messages"><div class="msgs-inner" id="msgsInner"><div class="spinner"></div></div></div>
    <button class="to-bottom" id="toBottom" hidden>${icon('down')}<span class="badge" hidden></span></button>
    <div class="composer-wrap" id="composerWrap"></div>`;
  renderChatHeader();
  renderPinned();
  renderComposer();
  const box = $('#messages');
  box.addEventListener('scroll', onMessagesScroll, { passive: true });
  box.addEventListener('click', onMessagesClick);
  box.addEventListener('dblclick', onMessagesDblClick);
  box.addEventListener('contextmenu', (e) => {
    const n = e.target.closest('.msg[data-id]');
    if (!n || isTouch) return;
    if (e.target.closest('a') || window.getSelection().toString()) return;
    e.preventDefault();
    messageMenu(n, e.clientX, e.clientY);
  });
  bindLongPress(box, '.msg[data-id]', (n, x, y) => messageMenu(n, x, y));
  bindSwipeReply(box);
  $('#toBottom').onclick = () => scrollToBottom(true);
  $('#chatSearch').addEventListener('click', onChatSearchClick);
  $('#chatSearch input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runChatSearch(e.target.value.trim()); if (e.key === 'Escape') closeChatSearch(); });
  // کشیدن و رها کردن فایل
  const pane = $('#pane');
  pane.ondragover = (e) => { e.preventDefault(); };
  pane.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files.length) sendFiles([...e.dataTransfer.files]); };
}

function renderChatHeader() {
  const el = $('#chatHeader');
  const c = App.chats.get(App.current);
  if (!el || !c) return;
  let status = '', cls = '';
  const typing = typingText(c.id);
  if (!App.online) status = 'در انتظار اتصال...';
  else if (typing) { status = typing; cls = 'typing'; }
  else if (c.type === 'group') status = faNum(c.member_count) + ' عضو';
  else if (c.type === 'private' && c.peer) {
    if (c.peer.blocked_me) status = 'خیلی وقت پیش آنلاین بوده';
    else { status = lastSeenText(c.peer.last_seen); if (isOnline(c.peer.last_seen)) cls = 'online'; }
  }
  el.innerHTML = `
    <button class="ibtn back-btn" data-act="back">${icon('back')}</button>
    <div class="peer" data-act="info">${avatarHtml(c, 'sm')}<div style="min-width:0">
      <div class="peer-name">${esc(c.title)}</div><div class="peer-status ${cls}">${esc(status)}</div></div></div>
    <button class="ibtn" data-act="search">${icon('search')}</button>
    <button class="ibtn" data-act="more">${icon('more')}</button>`;
  el.onclick = (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'back') closeChat();
    if (a === 'info') Settings.chatInfo(c.id);
    if (a === 'search') openChatSearch();
    if (a === 'more') {
      const r = e.target.closest('button').getBoundingClientRect();
      const items = [
        { icon: c.muted ? 'bell' : 'mute', text: c.muted ? 'روشن کردن اعلان' : 'بی‌صدا کردن', fn: () => setChat(c.id, { muted: c.muted ? 0 : 1 }) },
        { icon: 'info', text: 'اطلاعات', fn: () => Settings.chatInfo(c.id) },
        { icon: 'clear', text: 'پاک کردن تاریخچه', fn: () => Settings.clearHistory(c) },
      ];
      if (c.peer) items.push({ icon: 'block', text: c.peer.blocked ? 'رفع مسدودیت' : 'مسدود کردن', danger: !c.peer.blocked, fn: () => Settings.toggleBlock(c.peer) });
      items.push({ icon: 'delete', text: c.type === 'group' ? 'ترک گروه' : 'حذف گفتگو', danger: true, fn: () => Settings.deleteChat(c) });
      showMenu(items, r.right, r.bottom);
    }
  };
}

function renderPinned() {
  const el = $('#pinnedBar');
  const c = App.chats.get(App.current);
  if (!el || !c) return;
  const pm = c.pinned_message;
  el.hidden = !pm;
  if (!pm) return;
  const canUnpin = c.type !== 'group' || ['owner', 'admin'].includes(c.role);
  el.innerHTML = `<div class="pb-line"></div><div class="pb-body"><div class="pb-title">پیام سنجاق شده</div><div class="pb-text">${esc(pm.preview || previewOf(pm))}</div></div>
    ${canUnpin ? `<button class="ibtn" data-unpin>${icon('close')}</button>` : ''}`;
  el.onclick = (e) => {
    if (e.target.closest('[data-unpin]')) { pinMessage(c.id, 0); return; }
    jumpToMessage(pm.id);
  };
}

/* ---------- بارگذاری پیام‌ها ---------- */

async function loadMessages(chatId) {
  const c = App.chats.get(chatId);
  let st = App.msgs.get(chatId);
  if (!st) {
    try {
      const params = { chat_id: chatId, limit: 50 };
      if (c?.unread > 30 && c.last_read_id) params.around_id = c.last_read_id;
      const r = await API.call('messages.list', params);
      st = { list: r.messages, hasMore: r.has_more, hasMoreAfter: r.has_more_after };
      App.msgs.set(chatId, st);
    } catch (e) {
      if (App.current === chatId) $('#msgsInner').innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
      return;
    }
  }
  if (App.current !== chatId) return;
  renderMessages();
  const sep = $('.unread-sep');
  if (sep) sep.scrollIntoView({ block: 'center' });
  else scrollToBottom();
  setTimeout(checkRead, 300);
}

function renderMessages() {
  const st = App.msgs.get(App.current);
  const inner = $('#msgsInner');
  if (!inner || !st) return;
  const c = App.chats.get(App.current);
  if (!st.list.length) {
    inner.innerHTML = `<div class="empty-pane" style="margin-top:30vh">${c?.type === 'saved' ? 'پیام‌ها، فایل‌ها و یادداشت‌های خود را اینجا ذخیره کنید' : 'هنوز پیامی ارسال نشده است...'}</div>`;
    return;
  }
  const frag = [];
  let prev = null;
  let unreadPlaced = false;
  for (const m of st.list) {
    if (!prev || !sameDay(prev.created_at, m.created_at)) frag.push(`<div class="day-sep">${fmtDay(m.created_at)}</div>`);
    if (!unreadPlaced && c && c.unread && m.id > c.last_read_id && m.user_id !== App.me.id && !m.pending) {
      frag.push('<div class="unread-sep">پیام‌های خوانده نشده</div>');
      unreadPlaced = true;
    }
    frag.push(msgHtml(m));
    prev = m;
  }
  inner.innerHTML = frag.join('');
  fixGrouping();
}

function msgHtml(m) {
  const c = App.chats.get(m.chat_id);
  if (m.type === 'system') return `<div class="sys-msg" id="m${m.id}" data-id="${m.id}" data-sys="1">${esc(m.body)}</div>`;
  const out = m.user_id === App.me.id;
  const isGroup = c?.type === 'group';
  const media = (m.type === 'image' || m.type === 'video') ? ' media' : '';
  let inner = '';
  if (isGroup && !out) inner += `<div class="b-sender" style="color:${nameColor(m.user_id)}" data-user="${m.user_id}">${esc(m.sender.name)}</div>`;
  if (m.fwd_name) inner += `<div class="b-fwd">بازارسال از ${esc(m.fwd_name)}</div>`;
  if (m.reply_to) {
    inner += `<div class="b-reply" data-jump="${m.reply_to.id}">${m.reply_to.thumb ? `<img src="${esc(m.reply_to.thumb)}" alt="">` : ''}
      <div class="r-body"><div class="r-name">${esc(m.reply_to.name)}</div><div class="r-text">${esc(m.reply_to.text)}</div></div></div>`;
  }
  const f = m.file;
  const progress = m.pending && m.progress !== undefined ? `<div class="b-progress">${faNum(Math.round(m.progress * 100))}٪</div>` : '';
  if (m.type === 'image' && f) {
    const w = f.width || 300, hgt = f.height || 300;
    const ratio = Math.min(1, 420 / hgt, 480 / w);
    inner += `<div style="position:relative"><img class="b-img" src="${esc(f.url)}" data-view="${esc(f.url)}" style="aspect-ratio:${w}/${hgt};width:${Math.round(w * ratio)}px" alt="" loading="lazy">${progress}</div>`;
  } else if (m.type === 'video' && f) {
    inner += `<div style="position:relative"><video class="b-video" src="${esc(f.url)}#t=0.1" controls preload="metadata" playsinline></video>${progress}</div>`;
  } else if ((m.type === 'voice' || m.type === 'audio') && f) {
    inner += `<div class="b-audio" data-src="${esc(f.url)}"><button class="play">${icon('play')}</button>
      <div class="wave"><div class="bar"><i></i></div><div class="dur">${f.duration ? fmtDur(f.duration) : (m.type === 'audio' ? esc(f.name) : '0:00')}</div></div></div>`;
  } else if (f) {
    inner += `<a class="b-file" href="${esc(f.url)}" download="${esc(f.name)}" target="_blank"><div class="f-icon">${icon(m.pending ? 'clock' : 'download')}</div>
      <div class="f-info"><div class="f-name">${esc(f.name)}</div><div class="f-size">${m.pending && m.progress !== undefined ? faNum(Math.round(m.progress * 100)) + '٪ — ' : ''}${fmtSize(f.size)}</div></div></a>`;
  }
  const body = m.body || '';
  const meta = `<span class="b-meta${media && !body ? ' on-media' : ''}">${m.edited_at ? '<span class="b-edited">ویرایش شده</span>' : ''}${fmtTime(m.created_at)}${out ? '<span class="ticks"></span>' : ''}</span>`;
  if (body) inner += `<div class="b-text${!f && emojiOnly(body) ? ' big-emoji' : ''}">${linkify(body)}${meta}</div>`;
  else inner += meta;
  if (m.reactions?.length) {
    inner += `<div class="b-reactions">${m.reactions.map((r) => `<button data-react="${esc(r.emoji)}" class="${r.users.includes(App.me.id) ? 'mine' : ''}">${r.emoji} ${r.users.length > 1 ? faNum(r.users.length) : ''}</button>`).join('')}</div>`;
  }
  const av = isGroup && !out ? `<div data-user="${m.user_id}">${avatarHtml(m.sender, 'xs')}</div>` : '';
  return `<div class="msg ${out ? 'out' : 'in'}" id="m${m.id}" data-id="${m.id}" data-user="${m.user_id}" data-ts="${m.created_at}">
    ${out ? '' : av}<div class="bubble${media}">${inner}</div></div>`;
}

const NAME_COLORS = ['#e17076', '#eda86c', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
const nameColor = (id) => NAME_COLORS[id % 7];

function updateTicks(node) {
  const t = $('.ticks', node);
  if (!t) return;
  const id = +node.dataset.id;
  const c = App.chats.get(App.current);
  const st = App.msgs.get(App.current);
  const m = st?.list.find((x) => String(x.id) === node.dataset.id || x.client_id === node.dataset.id);
  if (m?.pending) t.innerHTML = icon('clock');
  else t.innerHTML = icon(c && id <= c.others_read_id ? 'checks' : 'check');
}

/** گروه‌بندی پیام‌های پشت سر هم یک فرستنده (مثل تلگرام) */
function fixGrouping() {
  const nodes = $$('#msgsInner > *');
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n.classList.contains('msg')) continue;
    const p = nodes[i - 1], nx = nodes[i + 1];
    const same = (a) => a && a.classList.contains('msg') && a.dataset.user === n.dataset.user && Math.abs(a.dataset.ts - n.dataset.ts) < 600;
    n.classList.toggle('group-start', !same(p));
    n.classList.toggle('group-end', !same(nx));
    const sender = $('.b-sender', n);
    if (sender) sender.hidden = same(p);
    if (n.classList.contains('out')) updateTicks(n);
  }
}

function appendMsgNode(m) {
  const inner = $('#msgsInner');
  if (!inner) return;
  const atBottom = isAtBottom() || m.user_id === App.me.id;
  if ($('.empty-pane', inner)) inner.innerHTML = '';
  const st = App.msgs.get(m.chat_id);
  const prev = st.list[st.list.length - 2];
  let html = '';
  if (!prev || !sameDay(prev.created_at, m.created_at)) html += `<div class="day-sep">${fmtDay(m.created_at)}</div>`;
  inner.insertAdjacentHTML('beforeend', html + msgHtml(m));
  fixGrouping();
  if (atBottom) scrollToBottom(true);
}

function replaceMsgNode(oldId, m) {
  const n = document.getElementById('m' + oldId);
  if (!n) return;
  const wasBottom = isAtBottom();
  n.outerHTML = msgHtml(m);
  fixGrouping();
  if (wasBottom) scrollToBottom();
}

/* ---------- اسکرول ---------- */

function isAtBottom() {
  const b = $('#messages');
  return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 80;
}
function scrollToBottom(smooth = false) {
  const st = App.msgs.get(App.current);
  if (st?.hasMoreAfter) { App.msgs.delete(App.current); loadMessages(App.current); return; }
  const b = $('#messages');
  if (b) b.scrollTo({ top: b.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}
let loadingMore = false;
let scrollT;
function onMessagesScroll() {
  const b = $('#messages');
  const st = App.msgs.get(App.current);
  if (!b || !st) return;
  if (b.scrollTop < 300 && st.hasMore && !loadingMore) loadOlder();
  if (b.scrollHeight - b.scrollTop - b.clientHeight < 300 && st.hasMoreAfter && !loadingMore) loadNewer();
  updateToBottom();
  clearTimeout(scrollT);
  scrollT = setTimeout(checkRead, 150);
}
async function loadOlder() {
  const chatId = App.current;
  const st = App.msgs.get(chatId);
  if (!st.list.length) return;
  loadingMore = true;
  try {
    const r = await API.call('messages.list', { chat_id: chatId, before_id: st.list[0].id, limit: 50 });
    if (App.current !== chatId) return;
    const b = $('#messages');
    const h0 = b.scrollHeight, t0 = b.scrollTop;
    st.list = r.messages.concat(st.list);
    st.hasMore = r.has_more;
    renderMessages();
    b.scrollTop = t0 + (b.scrollHeight - h0);
  } catch { /* ignore */ } finally { loadingMore = false; }
}
async function loadNewer() {
  const chatId = App.current;
  const st = App.msgs.get(chatId);
  loadingMore = true;
  try {
    const r = await API.call('messages.list', { chat_id: chatId, after_id: st.list[st.list.length - 1].id, limit: 50 });
    if (App.current !== chatId) return;
    const b = $('#messages');
    const t0 = b.scrollTop;
    st.list = st.list.concat(r.messages);
    st.hasMoreAfter = r.has_more_after;
    renderMessages();
    b.scrollTop = t0;
  } catch { /* ignore */ } finally { loadingMore = false; }
}
function updateToBottom() {
  const btn = $('#toBottom');
  if (!btn) return;
  const c = App.chats.get(App.current);
  btn.hidden = isAtBottom() && !App.msgs.get(App.current)?.hasMoreAfter;
  const badge = $('.badge', btn);
  badge.hidden = !c?.unread;
  badge.textContent = faNum(c?.unread || 0);
}

/** پیام‌هایی که روی صفحه دیده شده‌اند را خوانده شده علامت می‌زند */
function checkRead() {
  if (document.hidden || !App.current) return;
  const b = $('#messages');
  if (!b) return;
  const bottom = b.getBoundingClientRect().bottom;
  const nodes = $$('#msgsInner > [data-id]');
  for (let i = nodes.length - 1; i >= 0; i--) {
    const r = nodes[i].getBoundingClientRect();
    if (r.top < bottom - 10) {
      const id = +nodes[i].dataset.id;
      if (id > 0) markRead(App.current, id);
      break;
    }
  }
}
let readT = {};
function markRead(chatId, id, force = false) {
  const c = App.chats.get(chatId);
  if (!c || !id || (!force && id <= c.last_read_id)) return;
  const st = App.msgs.get(chatId);
  if (st && !force) {
    const after = st.list.filter((x) => x.id > id && x.user_id !== App.me.id).length;
    c.unread = st.hasMoreAfter ? Math.max(0, c.unread - st.list.filter((x) => x.id > c.last_read_id && x.id <= id && x.user_id !== App.me.id).length) : after;
  } else c.unread = 0;
  c.last_read_id = id;
  renderChatList(); updateBadge(); updateToBottom();
  Settings.clearNotifications?.(chatId);
  clearTimeout(readT[chatId]);
  readT[chatId] = setTimeout(() => API.call('messages.read', { chat_id: chatId, last_id: id }).catch(() => {}), 300);
}
document.addEventListener('visibilitychange', () => {
  if (!App.token) return;
  App.restartPoll();
  if (!document.hidden) setTimeout(checkRead, 200);
});

/* ---------- کلیک روی پیام‌ها ---------- */

function onMessagesClick(e) {
  const t = e.target;
  const jump = t.closest('[data-jump]');
  if (jump) { jumpToMessage(+jump.dataset.jump); return; }
  const view = t.closest('[data-view]');
  if (view) { openViewer(view.dataset.view); return; }
  const react = t.closest('[data-react]');
  if (react) { reactTo(+t.closest('.msg').dataset.id, react.dataset.react); return; }
  const play = t.closest('.b-audio .play');
  if (play) { toggleAudio(play.closest('.b-audio')); return; }
  const bar = t.closest('.b-audio .bar');
  if (bar) { seekAudio(bar, e); return; }
  const mention = t.closest('[data-mention]');
  if (mention) { e.preventDefault(); openByUsername(mention.dataset.mention); return; }
  const user = t.closest('[data-user]:not(.msg)');
  if (user) { Settings.userProfile(+user.dataset.user); }
}
function onMessagesDblClick(e) {
  if (isTouch) return;
  const n = e.target.closest('.msg[data-id]');
  if (!n || e.target.closest('a, video, .b-audio')) return;
  window.getSelection()?.removeAllRanges();
  reactTo(+n.dataset.id, App.cfg.reactions?.[1] || '❤️');
}
async function openByUsername(u) {
  try {
    const r = await API.call('users.search', { q: u });
    const user = r.users.find((x) => x.username === u.toLowerCase());
    if (user) Settings.userProfile(user.id, user);
    else toast('کاربر یافت نشد');
  } catch (e) { toast(errText(e)); }
}

function findMsg(id) { return App.msgs.get(App.current)?.list.find((x) => x.id === id); }

function messageMenu(node, x, y) {
  const id = +node.dataset.id;
  const m = findMsg(id);
  const c = App.chats.get(App.current);
  if (!m || !c || m.pending) return;
  const out = m.user_id === App.me.id;
  const isAdmin = c.type !== 'group' || ['owner', 'admin'].includes(c.role);
  const items = [{ icon: 'reply', text: 'پاسخ', fn: () => startReply(m) }];
  if (m.body) items.push({ icon: 'copy', text: 'کپی متن', fn: () => copyText(m.body) });
  if (out && !m.fwd_name && (m.type === 'text' || m.body !== undefined)) items.push({ icon: 'edit', text: 'ویرایش', fn: () => startEdit(m) });
  if (m.file) items.push({ icon: 'download', text: 'دانلود', fn: () => downloadFile(m.file) });
  if (isAdmin) items.push({ icon: 'pin', text: c.pinned_message?.id === m.id ? 'برداشتن سنجاق' : 'سنجاق کردن', fn: () => pinMessage(c.id, c.pinned_message?.id === m.id ? 0 : m.id) });
  items.push({ icon: 'forward', text: 'بازارسال', fn: () => Settings.forwardPicker([m.id]) });
  if (c.type !== 'saved') items.push({ icon: 'bookmark', text: 'ذخیره در پیام‌های ذخیره شده', fn: () => saveToSaved(m.id) });
  items.push({ icon: 'delete', text: 'حذف', danger: true, fn: () => Settings.deleteMessage(m, c) });
  node.classList.add('selected');
  showMenu(items, x, y, { list: App.cfg.reactions || ['👍', '❤️', '😂', '😮', '😢', '🔥'], fn: (r) => reactTo(id, r) });
  const obs = new MutationObserver(() => { if (!$('.ctx-menu')) { node.classList.remove('selected'); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}
function copyText(t) {
  (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast('متن کپی شد')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('متن کپی شد');
  });
}
function downloadFile(f) {
  const a = document.createElement('a'); a.href = f.url; a.download = f.name || ''; a.target = '_blank'; document.body.append(a); a.click(); a.remove();
}
async function saveToSaved(id) {
  try {
    const r = await API.call('chats.saved');
    App.chats.set(r.chat.id, r.chat);
    await API.call('messages.forward', { message_ids: [id], to_chat_id: r.chat.id });
    toast('در پیام‌های ذخیره شده ذخیره شد');
  } catch (e) { toast(errText(e)); }
}
async function reactTo(id, emoji) {
  try {
    const r = await API.call('messages.react', { message_id: id, emoji });
    onEditMessage(r.message);
  } catch (e) { toast(errText(e)); }
}
async function pinMessage(chatId, id) {
  try {
    const r = await API.call('messages.pin', { chat_id: chatId, message_id: id });
    App.chats.set(chatId, r.chat); renderPinned();
  } catch (e) { toast(errText(e)); }
}

async function jumpToMessage(id) {
  let n = document.getElementById('m' + id);
  if (!n) {
    try {
      const r = await API.call('messages.list', { chat_id: App.current, around_id: id, limit: 50 });
      App.msgs.set(App.current, { list: r.messages, hasMore: r.has_more, hasMoreAfter: r.has_more_after });
      renderMessages();
      n = document.getElementById('m' + id);
    } catch (e) { toast(errText(e)); return; }
  }
  if (!n) { toast('پیام یافت نشد'); return; }
  n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const b = $('.bubble', n) || n;
  b.classList.add('highlight');
  setTimeout(() => b.classList.remove('highlight'), 1500);
}

/* ---------- کشیدن برای پاسخ (موبایل) ---------- */
function bindSwipeReply(box) {
  let sx, sy, node, dx, active;
  box.addEventListener('touchstart', (e) => {
    node = e.target.closest('.msg[data-id]');
    if (!node) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; active = false;
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (!node) return;
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (!active && Math.abs(y) > 12) { node = null; return; }
    if (!active && x < -12 && Math.abs(x) > Math.abs(y) * 1.5) active = true;
    if (active) {
      dx = Math.max(-90, Math.min(0, x));
      $('.bubble', node).style.transform = `translateX(${dx}px)`;
    }
  }, { passive: true });
  box.addEventListener('touchend', () => {
    if (!node) return;
    const b = $('.bubble', node);
    b.style.transform = '';
    if (active && dx < -60) {
      const m = findMsg(+node.dataset.id);
      if (m && !m.pending) { navigator.vibrate?.(10); startReply(m); }
    }
    node = null;
  });
}

/* ---------- پخش‌کننده صوت ---------- */
let curAudio = null;
function toggleAudio(el) {
  if (curAudio && curAudio.el !== el) { curAudio.a.pause(); }
  if (!el._a) {
    const a = new Audio(el.dataset.src);
    el._a = a;
    const bar = $('.bar i', el), dur = $('.dur', el), btn = $('.play', el);
    a.ontimeupdate = () => { if (a.duration) bar.style.width = (a.currentTime / a.duration * 100) + '%'; dur.textContent = fmtDur(a.currentTime); };
    a.onplay = () => { btn.innerHTML = icon('pause'); };
    a.onpause = () => { btn.innerHTML = icon('play'); };
    a.onended = () => { btn.innerHTML = icon('play'); bar.style.width = '0'; if (a.duration && isFinite(a.duration)) dur.textContent = fmtDur(a.duration); playNextVoice(el); };
  }
  curAudio = { el, a: el._a };
  el._a.paused ? el._a.play().catch(() => toast('پخش این فایل ممکن نیست')) : el._a.pause();
}
function playNextVoice(el) {
  const msgs = $$('.b-audio');
  const i = msgs.indexOf(el);
  if (i >= 0 && msgs[i + 1]) toggleAudio(msgs[i + 1]);
}
function seekAudio(bar, e) {
  const el = bar.closest('.b-audio');
  const a = el._a;
  if (!a || !a.duration) return;
  const r = bar.getBoundingClientRect();
  a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
}

/* ---------- نمایشگر عکس ---------- */
function openViewer(url) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<div class="v-top"><button class="ibtn" data-close>${icon('close')}</button><a class="ibtn" href="${esc(url)}" download target="_blank">${icon('download')}</a></div><img src="${esc(url)}" alt="">`;
  v.onclick = (e) => { if (!e.target.closest('a')) v.remove(); };
  document.body.append(v);
  const esck = (e) => { if (e.key === 'Escape') { v.remove(); removeEventListener('keydown', esck); } };
  addEventListener('keydown', esck);
}

/* ---------- جستجو در گفتگو ---------- */
let csResults = [], csIndex = 0;
function openChatSearch() { const s = $('#chatSearch'); s.hidden = false; $('input', s).focus(); }
function closeChatSearch() { const s = $('#chatSearch'); s.hidden = true; $('input', s).value = ''; $('.count', s).textContent = ''; csResults = []; }
async function runChatSearch(q) {
  if (q.length < 2) return;
  try {
    const r = await API.call('messages.search', { q, chat_id: App.current });
    csResults = r.messages; csIndex = 0;
    $('#chatSearch .count').textContent = csResults.length ? faNum(1) + ' از ' + faNum(csResults.length) : 'نتیجه‌ای نیست';
    if (csResults.length) jumpToMessage(csResults[0].id);
  } catch (e) { toast(errText(e)); }
}
function onChatSearchClick(e) {
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'search-close') closeChatSearch();
  if ((a === 'search-up' || a === 'search-down') && csResults.length) {
    csIndex = (csIndex + (a === 'search-up' ? 1 : -1) + csResults.length) % csResults.length;
    $('#chatSearch .count').textContent = faNum(csIndex + 1) + ' از ' + faNum(csResults.length);
    jumpToMessage(csResults[csIndex].id);
  }
}

/* ============================== نوار نوشتن پیام ============================== */

const EMOJIS = '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👻 💀 🤡 💩 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🦾 🧠 👀 👁 👄 💋 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🕊 🌹 🌷 🌸 🌺 🌻 🌼 💐 🍀 🌿 🌱 🌳 🌴 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ⛅ ☁️ 🌧 ❄️ ☃️ 💧 🌊 🍎 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥕 🌽 🍕 🍔 🍟 🌭 🥪 🌮 🍿 🧁 🍰 🎂 🍫 🍬 🍭 ☕ 🍵 🥤 🎉 🎊 🎈 🎁 🏆 🥇 ⚽ 🏀 🎮 🎵 🎶 🎤 🎧 📱 💻 ⌚ 📷 💡 📚 ✏️ 📌 📎 ✂️ 🔒 🔑 💰 💎 🚗 ✈️ 🚀 🏠 🕌 ⏰ ✅ ❌ ⚠️ ❓ ❗ 🇮🇷'.split(' ');

function renderComposer() {
  const wrap = $('#composerWrap');
  const c = App.chats.get(App.current);
  if (!wrap || !c) return;
  if (c.peer?.blocked) {
    wrap.innerHTML = `<div class="blocked-bar" data-unblock>رفع مسدودیت</div>`;
    $('[data-unblock]', wrap).onclick = () => Settings.toggleBlock(c.peer);
    return;
  }
  wrap.innerHTML = `
    <div class="emoji-panel" id="emojiPanel" hidden>${EMOJIS.map((e) => `<button type="button">${e}</button>`).join('')}</div>
    <div class="composer-inner">
      <div class="composer">
        <div class="composer-bar" id="composerBar" hidden></div>
        <div class="composer-row" id="composerRow">
          <button class="ibtn" id="emojiBtn" title="ایموجی">${icon('emoji')}</button>
          <textarea id="input" rows="1" placeholder="پیام" dir="auto"></textarea>
          <button class="ibtn" id="attachBtn" title="پیوست">${icon('attach')}</button>
        </div>
      </div>
      <button class="send-btn" id="sendBtn">${icon('mic')}</button>
    </div>
    <input type="file" id="fileInput" multiple hidden>`;
  const input = $('#input');
  input.value = App.drafts[App.current] || '';
  autoGrow();
  updateSendBtn();
  input.addEventListener('input', () => { autoGrow(); updateSendBtn(); sendTyping(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (App.settings.sendEnter || e.ctrlKey || e.metaKey)) { e.preventDefault(); sendText(); }
    if (e.key === 'Escape') cancelBar();
    if (e.key === 'ArrowUp' && !input.value) {
      const st = App.msgs.get(App.current);
      const last = st?.list.slice().reverse().find((m) => m.user_id === App.me.id && !m.fwd_name && !m.pending && m.type !== 'system');
      if (last) { e.preventDefault(); startEdit(last); }
    }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); sendFiles(files); }
  });
  $('#sendBtn').addEventListener('click', () => {
    if (recorder) { stopRecording(false); return; }
    if (input.value.trim() || App.editing) sendText();
    else startRecording();
  });
  $('#attachBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { sendFiles([...e.target.files]); e.target.value = ''; };
  $('#emojiBtn').onclick = () => { const p = $('#emojiPanel'); p.hidden = !p.hidden; };
  $('#emojiPanel').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, s) + b.textContent + input.value.slice(input.selectionEnd ?? s);
    input.selectionStart = input.selectionEnd = s + b.textContent.length;
    updateSendBtn(); autoGrow();
    if (!isTouch) input.focus();
  };
  $('#messages').addEventListener('click', () => { const p = $('#emojiPanel'); if (p) p.hidden = true; });
  if (!isTouch) input.focus();
}

function autoGrow() {
  const i = $('#input');
  if (!i) return;
  i.style.height = 'auto';
  i.style.height = Math.min(180, i.scrollHeight) + 'px';
}
function updateSendBtn() {
  const b = $('#sendBtn');
  if (!b || recorder) return;
  b.innerHTML = icon(($('#input').value.trim() || App.editing) ? (App.editing ? 'check' : 'send') : 'mic');
}
function saveDraft() {
  const i = $('#input');
  if (!i || !App.current || App.editing) return;
  const v = i.value;
  if (v.trim()) App.drafts[App.current] = v; else delete App.drafts[App.current];
  store.set('drafts', App.drafts);
}
let typingSentAt = 0;
function sendTyping(kind = 'text') {
  if (Date.now() - typingSentAt < 4000 || !App.current) return;
  typingSentAt = Date.now();
  API.call('messages.typing', { chat_id: App.current, kind }).catch(() => {});
}

function showBar(kind, m) {
  const bar = $('#composerBar');
  if (!bar) return;
  bar.hidden = false;
  bar.innerHTML = `${icon(kind === 'edit' ? 'edit' : 'reply')}<div class="cb-body"><div class="cb-title">${kind === 'edit' ? 'ویرایش پیام' : 'پاسخ به ' + esc(m.sender.name)}</div>
    <div class="cb-text">${esc(previewOf(m))}</div></div><button class="ibtn">${icon('close')}</button>`;
  $('button', bar).onclick = cancelBar;
  $('.cb-body', bar).onclick = () => jumpToMessage(m.id);
}
function cancelBar() {
  const wasEdit = App.editing;
  App.reply = null; App.editing = null;
  const bar = $('#composerBar');
  if (bar) bar.hidden = true;
  if (wasEdit) { $('#input').value = App.drafts[App.current] || ''; autoGrow(); }
  updateSendBtn();
}
function startReply(m) {
  App.editing = null; App.reply = m;
  showBar('reply', m);
  updateSendBtn();
  $('#input')?.focus();
}
function startEdit(m) {
  App.reply = null; App.editing = m;
  showBar('edit', m);
  const i = $('#input');
  i.value = m.body || '';
  autoGrow(); updateSendBtn();
  i.focus();
}

async function sendText() {
  const input = $('#input');
  const text = input.value.trim();
  const chatId = App.current;
  if (App.editing) {
    const m = App.editing;
    if (text === (m.body || '')) { cancelBar(); return; }
    cancelBar();
    input.value = App.drafts[chatId] || ''; autoGrow(); updateSendBtn();
    try { const r = await API.call('messages.edit', { message_id: m.id, body: text }); onEditMessage(r.message); } catch (e) { toast(errText(e)); }
    return;
  }
  if (!text) return;
  input.value = ''; autoGrow();
  delete App.drafts[chatId]; store.set('drafts', App.drafts);
  const reply = App.reply;
  cancelBar();
  // پیام‌های طولانی مثل تلگرام به چند بخش تقسیم می‌شوند
  const parts = [];
  for (let i = 0; i < text.length; i += 4000) parts.push(text.slice(i, i + 4000));
  for (const [i, p] of parts.entries()) await sendMessage(chatId, { body: p, reply_to_id: i === 0 ? reply?.id : 0 }, i === 0 ? reply : null);
  if (!isTouch) input.focus();
}

let tmpSeq = 0;
function addPending(chatId, data, reply) {
  const cid = 'c' + Date.now().toString(36) + (tmpSeq++);
  const m = {
    id: cid, client_id: cid, pending: true, chat_id: chatId, user_id: App.me.id, sender: { id: App.me.id, name: App.me.name },
    type: data.type || 'text', body: data.body || '', file: data.file || null, fwd_name: '', edited_at: 0, created_at: App.now(), reactions: [],
    reply_to: reply ? { id: reply.id, name: reply.sender.name, text: previewOf(reply), thumb: null } : null,
  };
  let st = App.msgs.get(chatId);
  if (!st) { st = { list: [], hasMore: false, hasMoreAfter: false }; App.msgs.set(chatId, st); }
  if (st.hasMoreAfter) { App.msgs.delete(chatId); st = { list: [], hasMore: true, hasMoreAfter: false }; App.msgs.set(chatId, st); renderMessages(); }
  st.list.push(m);
  if (App.current === chatId) appendMsgNode(m);
  return m;
}
function resolvePending(tmp, real) {
  const st = App.msgs.get(tmp.chat_id);
  if (!st) return;
  const i = st.list.indexOf(tmp);
  if (st.list.some((x) => x.id === real.id)) {
    if (i >= 0) st.list.splice(i, 1);
    document.getElementById('m' + tmp.id)?.remove();
    return;
  }
  if (i >= 0) st.list[i] = real;
  if (App.current === tmp.chat_id) replaceMsgNode(tmp.id, real);
  const c = App.chats.get(real.chat_id);
  if (c) {
    c.last_message = { ...real, preview: previewOf(real) };
    c.updated_at = real.created_at;
    if (c.type === 'saved') { c.others_read_id = real.id; document.getElementById('m' + real.id) && updateTicks(document.getElementById('m' + real.id)); }
    renderChatList();
  }
}
function failPending(tmp, e) {
  const st = App.msgs.get(tmp.chat_id);
  if (st) st.list = st.list.filter((x) => x !== tmp);
  document.getElementById('m' + tmp.id)?.remove();
  toast(errText(e));
}

async function sendMessage(chatId, data, reply) {
  const tmp = addPending(chatId, data, reply);
  try {
    const r = await API.call('messages.send', { chat_id: chatId, body: data.body || '', reply_to_id: data.reply_to_id || 0, file_id: data.file_id || 0, kind: data.kind || '', client_id: tmp.client_id });
    resolvePending(tmp, r.message);
  } catch (e) {
    failPending(tmp, e);
    if (e.message === 'network' && data.body) { const i = $('#input'); if (i && !i.value) { i.value = data.body; autoGrow(); updateSendBtn(); } }
  }
}

/** فشرده‌سازی عکس قبل از ارسال (مثل تلگرام) */
async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 300 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 1920;
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

async function sendFiles(files, kind = '') {
  const chatId = App.current;
  if (!chatId) return;
  const input = $('#input');
  const caption = input && files.length === 1 && !App.editing ? input.value.trim() : '';
  if (caption) { input.value = ''; autoGrow(); updateSendBtn(); delete App.drafts[chatId]; }
  const reply = App.reply;
  cancelBar();
  const maxMb = App.cfg.max_upload_mb || 50;
  for (let file of files) {
    if (file.size > maxMb * 1048576) { toast(ERRORS.file_too_large + ' (حداکثر ' + faNum(maxMb) + ' مگابایت)'); continue; }
    if (!kind) file = await compressImage(file);
    let type = kind === 'voice' ? 'voice' : file.type.startsWith('image/') && !/svg|heic|heif/.test(file.type) ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
    const local = URL.createObjectURL(file);
    let dims = { width: 0, height: 0 };
    if (type === 'image') dims = await new Promise((r) => { const im = new Image(); im.onload = () => r({ width: im.naturalWidth, height: im.naturalHeight }); im.onerror = () => r(dims); im.src = local; });
    const tmp = addPending(chatId, { type, body: caption, file: { url: local, name: file.name, size: file.size, mime: file.type, duration: file.duration || 0, ...dims } }, reply);
    tmp.progress = 0;
    sendTyping('file');
    try {
      const meta = { kind: kind || '', duration: Math.round(file.duration || 0) };
      const up = await API.upload(file, meta, (p) => {
        tmp.progress = p;
        const n = document.getElementById('m' + tmp.id);
        const pr = n && ($('.b-progress', n) || $('.f-size', n));
        if (pr) pr.textContent = pr.classList.contains('f-size') ? faNum(Math.round(p * 100)) + '٪ — ' + fmtSize(file.size) : faNum(Math.round(p * 100)) + '٪';
      });
      const r = await API.call('messages.send', { chat_id: chatId, body: caption, file_id: up.file.id, kind: kind || '', reply_to_id: reply?.id || 0, client_id: tmp.client_id });
      resolvePending(tmp, r.message);
    } catch (e) { failPending(tmp, e); }
  }
}

/* ---------- ضبط پیام صوتی ---------- */
let recorder = null, recChunks = [], recStart = 0, recTimer = null, recStream = null;
async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('مرورگر شما از ضبط صدا پشتیبانی نمی‌کند'); return; }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { toast('دسترسی به میکروفون داده نشد'); return; }
  const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  recChunks = [];
  recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
  recorder.start(250);
  recStart = Date.now();
  const row = $('#composerRow');
  row.hidden = true;
  row.insertAdjacentHTML('afterend', `<div class="rec-bar" id="recBar"><span class="dot"></span><span class="time">0:00</span><button class="cancel" id="recCancel">لغو</button></div>`);
  $('#recCancel').onclick = () => stopRecording(true);
  const btn = $('#sendBtn');
  btn.classList.add('recording');
  btn.innerHTML = icon('send');
  recTimer = setInterval(() => {
    const t = $('#recBar .time');
    if (t) t.textContent = fmtDur((Date.now() - recStart) / 1000);
    sendTyping('voice');
  }, 500);
}
function stopRecording(cancel) {
  if (!recorder) return;
  const rec = recorder;
  recorder = null;
  clearInterval(recTimer);
  const dur = (Date.now() - recStart) / 1000;
  rec.onstop = () => {
    recStream?.getTracks().forEach((t) => t.stop());
    if (cancel || dur < 0.7 || !recChunks.length) return;
    const type = rec.mimeType || 'audio/webm';
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File(recChunks, 'voice.' + ext, { type: type.split(';')[0] });
    file.duration = dur;
    sendFiles([file], 'voice');
  };
  try { rec.stop(); } catch { /* ignore */ }
  $('#recBar')?.remove();
  const row = $('#composerRow');
  if (row) row.hidden = false;
  $('#sendBtn')?.classList.remove('recording');
  updateSendBtn();
}

/* ============================== تم و ظاهر ============================== */

function applyTheme() {
  const s = App.settings;
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--fs', (s.fontSize || 16) + 'px');
  $('meta[name=theme-color]')?.setAttribute('content', dark ? '#212121' : '#ffffff');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* اپ اندروید وقتی کاربر روی نوتیف می‌زند این تابع را صدا می‌زند */
window.telchatOpenChat = (id) => { if (App.token) location.hash = '#/chat/' + id; };

window.addEventListener('DOMContentLoaded', () => App.start());
