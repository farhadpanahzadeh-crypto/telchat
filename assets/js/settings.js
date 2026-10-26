/* تل‌چت — تنظیمات، حریم خصوصی، پروفایل، گروه‌ها و دیالوگ‌ها */
'use strict';

/* ============================== مودال با پشته صفحات ============================== */

const Modal = {
  stack: [],
  wrap: null,
  open(page, opts = {}) {
    this.close();
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap ' + (opts.sheet ? 'sheet' : 'full');
    this.wrap.innerHTML = '<div class="modal"></div>';
    this.wrap.addEventListener('mousedown', (e) => { if (e.target === this.wrap) this.close(); });
    document.body.append(this.wrap);
    this.stack = [];
    this.push(page);
  },
  push(page) {
    if (!this.wrap) return this.open(page);
    this.stack.push(page);
    this.render();
  },
  pop() {
    this.stack.pop();
    this.stack.length ? this.render() : this.close();
  },
  refresh() { if (this.stack.length) this.render(); },
  async render() {
    const page = this.stack[this.stack.length - 1];
    const m = $('.modal', this.wrap);
    const back = this.stack.length > 1;
    m.innerHTML = `<div class="modal-head"><button class="ibtn" data-mclose>${icon(back ? 'back' : 'close')}</button><h3>${esc(page.title || '')}</h3>
      ${page.action ? `<button class="ibtn primary" data-maction>${icon(page.action.icon)}</button>` : ''}</div>
      <div class="modal-body"><div class="spinner"></div></div>${page.foot ? `<div class="modal-foot">${page.foot}</div>` : ''}`;
    $('[data-mclose]', m).onclick = () => (back ? this.pop() : this.close());
    if (page.action) $('[data-maction]', m).onclick = () => page.action.fn(m);
    const body = $('.modal-body', m);
    try {
      const html = typeof page.html === 'function' ? await page.html() : page.html;
      if (this.stack[this.stack.length - 1] !== page) return;
      body.innerHTML = html;
      page.mount?.(body, m);
    } catch (e) { body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`; }
  },
  close() {
    this.wrap?.remove();
    this.wrap = null;
    this.stack = [];
  },
};
addEventListener('keydown', (e) => { if (e.key === 'Escape' && Modal.wrap && !$('.ctx-menu')) Modal.stack.length > 1 ? Modal.pop() : Modal.close(); });

/** دیالوگ تأیید به سبک تلگرام */
function dialog({ title = '', text = '', buttons = [{ text: 'تأیید', value: true }], check = null, input = null }) {
  return new Promise((resolve) => {
    const w = document.createElement('div');
    w.className = 'modal-wrap';
    w.style.zIndex = 70;
    w.innerHTML = `<div class="modal dialog">${title ? `<h3>${esc(title)}</h3>` : ''}${text ? `<p>${esc(text)}</p>` : ''}
      ${input ? `<div class="field"><input type="${input.type || 'text'}" placeholder="${esc(input.placeholder || '')}" dir="auto" value="${esc(input.value || '')}"></div>` : ''}
      ${check ? `<label class="check"><input type="checkbox" ${check.checked ? 'checked' : ''}> ${esc(check.text)}</label>` : ''}
      <div class="actions"><button data-v="__cancel">لغو</button>${buttons.map((b, i) => `<button data-i="${i}" class="${b.danger ? 'danger' : ''}">${esc(b.text)}</button>`).join('')}</div></div>`;
    document.body.append(w);
    const inp = $('input:not([type=checkbox])', w);
    inp?.focus();
    const done = (v) => { w.remove(); resolve(v); };
    w.addEventListener('mousedown', (e) => { if (e.target === w) done(null); });
    inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('[data-i="0"]', w).click(); });
    $('.actions', w).onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.v === '__cancel') return done(null);
      const btn = buttons[+b.dataset.i];
      done({ value: btn.value, checked: $('input[type=checkbox]', w)?.checked || false, input: inp?.value ?? '' });
    };
  });
}

const sItem = (ic, title, sub = '', attrs = '', right = '') => {
  let cls = 's-item';
  attrs = attrs.replace(/class="([^"]*)"/, (_, c) => { cls += ' ' + c.replace('s-item', '').trim(); return ''; });
  return `<div class="${cls}" ${attrs}>${ic ? icon(ic) : ''}<div class="s-body"><div class="s-title">${title}</div>${sub ? `<div class="s-sub">${sub}</div>` : ''}</div>${right}</div>`;
};
const toggleHtml = (on) => `<label class="toggle"><input type="checkbox" ${on ? 'checked' : ''}><span></span></label>`;
const PRIV_LABEL = { all: 'همه', contacts: 'مخاطبین من', nobody: 'هیچ‌کس' };

function userRow(u, extra = '', attrs = '') {
  const st = u.last_seen !== undefined ? lastSeenText(u.last_seen) : '@' + u.username;
  return `<div class="user-row" data-uid="${u.id}" ${attrs}>${avatarHtml(u, 'sm', isOnline(u.last_seen))}<div class="u-body"><div class="u-name">${esc(u.name)}</div>
    <div class="u-sub ${isOnline(u.last_seen) ? 'online' : ''}">${esc(st)}</div></div>${extra}</div>`;
}

function pickImage() {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*';
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

/* ============================== قفل برنامه (رمز محلی) ============================== */

async function hashCode(code) {
  const data = new TextEncoder().encode('telchat:' + code);
  if (crypto.subtle) {
    const d = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (const b of data) h = ((h << 5) + h + b) >>> 0;
  return 'x' + h.toString(16);
}

/* ============================== شیء تنظیمات ============================== */

const Settings = {
  saveSettings() { store.set('settings', App.settings); applyTheme(); },

  /* ---------- قفل ---------- */
  checkLock() {
    const lock = store.get('lock');
    if (!lock) return Promise.resolve(true);
    return new Promise((resolve) => this.showLock(() => resolve(true)));
  },
  showLock(onUnlock) {
    if ($('.lock-screen')) return;
    const lock = store.get('lock');
    const el = document.createElement('div');
    el.className = 'lock-screen';
    el.innerHTML = `${icon('lock')}<div>رمز عبور برنامه را وارد کنید</div><input type="password" inputmode="numeric" autocomplete="off" maxlength="8"><div class="err-text"></div>
      <button class="btn flat" style="width:auto">رمز را فراموش کرده‌اید؟ خروج از حساب</button>`;
    $('svg', el).style.cssText = 'width:56px;height:56px;color:var(--primary)';
    document.body.append(el);
    const inp = $('input', el);
    inp.focus();
    inp.addEventListener('input', async () => {
      if (inp.value.length < 4) return;
      if (await hashCode(inp.value) === lock.hash) { el.remove(); onUnlock?.(); }
      else if (inp.value.length >= 8 || inp.value.length === lock.len) { $('.err-text', el).textContent = 'رمز اشتباه است'; inp.value = ''; navigator.vibrate?.(200); }
    });
    $('button', el).onclick = async () => {
      const r = await dialog({ title: 'خروج از حساب', text: 'برای حذف رمز باید از حساب خارج شوید و دوباره وارد شوید.', buttons: [{ text: 'خروج', value: 1, danger: true }] });
      if (r) App.logout();
    };
  },
  initAutoLock() {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      const lock = store.get('lock');
      if (!lock) return;
      if (document.hidden) hiddenAt = Date.now();
      else if (lock.auto && hiddenAt && Date.now() - hiddenAt > lock.auto * 1000) this.showLock();
    });
  },

  afterBoot() {
    this.initAutoLock();
    if (isSecure && 'Notification' in window && Notification.permission === 'granted') this.ensurePush(false);
  },

  /* ---------- بنر نصب برنامه ---------- */
  renderInstallBanner() {
    const el = $('#installBanner');
    if (!el || isStandalone || store.get('hideInstall')) return;
    const close = `<button class="ibtn" data-x style="width:30px;height:30px">${icon('close')}</button>`;
    if (isIOS) {
      el.innerHTML = `<div class="install-banner"><div style="flex:1">برای نصب روی آیفون: در Safari دکمه <b>Share</b> و سپس <b>Add to Home Screen</b> را بزنید.</div>${close}</div>`;
    } else if (window.__installPrompt) {
      el.innerHTML = `<div class="install-banner"><div style="flex:1">برنامه را روی دستگاه خود <b>نصب</b> کنید</div><button data-install>نصب</button>${close}</div>`;
      $('[data-install]', el).onclick = async () => { window.__installPrompt.prompt(); await window.__installPrompt.userChoice; window.__installPrompt = null; el.innerHTML = ''; };
    } else if (/Android/i.test(navigator.userAgent)) {
      el.innerHTML = `<div class="install-banner"><div style="flex:1">برای نصب: در Chrome منوی <b>⋮</b> و سپس <b>Add to Home screen</b> (افزودن به صفحه اصلی) را بزنید.</div>${close}</div>`;
    } else return;
    $('[data-x]', el).onclick = () => { store.set('hideInstall', 1); el.innerHTML = ''; };
  },

  /* ---------- نوتیفیکیشن ---------- */
  async ensurePush(interactive) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !App.cfg.vapid_public) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const key = Uint8Array.from(atob(App.cfg.vapid_public.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await API.call('push.subscribe', sub.toJSON());
      return true;
    } catch (e) {
      if (interactive) console.warn('push subscribe failed', e);
      return false;
    }
  },
  async enableNotifications() {
    if (!('Notification' in window)) {
      toast(isIOS && !isStandalone ? 'ابتدا برنامه را به صفحه اصلی اضافه کنید (Add to Home Screen)' : 'این مرورگر از اعلان پشتیبانی نمی‌کند');
      return;
    }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('اجازه نمایش اعلان داده نشد'); return; }
    const ok = await this.ensurePush(true);
    toast(ok ? 'اعلان‌ها فعال شد' : 'اعلان‌ها هنگام باز بودن برنامه فعال شد');
    if (ok) API.call('push.test').catch(() => {});
    Modal.refresh();
  },
  async clearNotifications(chatId) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      (await reg?.getNotifications({ tag: 'chat-' + chatId }))?.forEach((n) => n.close());
    } catch { /* ignore */ }
  },

  /* ============================== منوی اصلی ============================== */

  openMenu() {
    const me = App.me;
    const dark = document.documentElement.dataset.theme === 'dark';
    Modal.open({
      title: App.cfg.app_name || 'تل‌چت',
      html: `<div class="profile-head">${avatarHtml(me, 'lg')}<div class="p-name">${esc(me.name)}</div><div class="p-status ltr">@${esc(me.username)}</div></div>
        <div class="s-sep"></div>
        ${sItem('group', 'گروه جدید', '', 'data-a="group"')}
        ${sItem('contacts', 'مخاطبین', '', 'data-a="contacts"')}
        ${sItem('bookmark', 'پیام‌های ذخیره شده', '', 'data-a="saved"')}
        ${sItem('settings', 'تنظیمات', '', 'data-a="settings"')}
        ${sItem('palette', 'حالت شب', '', 'data-a="night"', toggleHtml(dark))}
        ${me.is_admin ? sItem('shield', 'پنل مدیریت', '', 'data-a="admin"') : ''}
        <div class="s-sep"></div>
        <div class="s-note">${esc(App.cfg.app_name || 'تل‌چت')} — پیام‌رسان روی سرور شخصی شما</div>`,
      mount: (b) => {
        b.onclick = (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'group') this.createGroup();
          if (a === 'contacts') Modal.push(this.contactsPage());
          if (a === 'saved') { Modal.close(); this.openSaved(); }
          if (a === 'admin') window.open('admin/', '_blank');
          if (a === 'settings') Modal.push(this.settingsPage());
          if (a === 'night') {
            e.preventDefault();
            App.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            this.saveSettings();
            $('[data-a=night] input', b).checked = App.settings.theme === 'dark';
          }
        };
      },
    }, { sheet: false });
  },

  newChatMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu([
      { icon: 'person', text: 'پیام جدید', fn: () => Modal.open(this.contactsPage(true)) },
      { icon: 'group', text: 'گروه جدید', fn: () => this.createGroup() },
      { icon: 'bookmark', text: 'پیام‌های ذخیره شده', fn: () => this.openSaved() },
    ], r.right, r.top - 150);
  },

  async openSaved() {
    try {
      const r = await API.call('chats.saved');
      App.chats.set(r.chat.id, r.chat);
      openChat(r.chat.id);
    } catch (e) { toast(errText(e)); }
  },

  async openPrivate(userId) {
    try {
      const r = await API.call('chats.open_private', { user_id: userId });
      App.chats.set(r.chat.id, r.chat);
      Modal.close();
      openChat(r.chat.id);
    } catch (e) { toast(errText(e)); }
  },

  /* ---------- مخاطبین و جستجوی کاربر ---------- */
  contactsPage(newMessage = false) {
    let list = [];
    return {
      title: newMessage ? 'پیام جدید' : 'مخاطبین',
      html: async () => {
        list = (await API.call('contacts.list')).users;
        return `<div class="modal-search"><input placeholder="جستجوی نام یا نام کاربری" autocomplete="off"></div><div data-list></div>`;
      },
      mount: (b) => {
        const box = $('[data-list]', b);
        const draw = (users, title) => {
          box.innerHTML = (title ? `<div class="list-title" style="padding:10px 16px 4px">${title}</div>` : '') +
            (users.length ? users.map((u) => userRow(u)).join('') : `<div class="empty-note">${title === null ? 'نتیجه‌ای یافت نشد' : 'هنوز مخاطبی اضافه نکرده‌اید.<br>با جستجوی نام کاربری، افراد را پیدا کنید.'}</div>`);
        };
        draw(list, list.length ? 'مخاطبین' : '');
        let t;
        $('input', b).oninput = (e) => {
          clearTimeout(t);
          const q = e.target.value.trim();
          if (q.length < 2) { draw(list, list.length ? 'مخاطبین' : ''); return; }
          t = setTimeout(async () => {
            try { draw((await API.call('users.search', { q })).users, null); } catch (er) { draw([], null); toast(errText(er)); }
          }, 250);
        };
        if (!isTouch) $('input', b).focus();
        box.onclick = (e) => {
          const r = e.target.closest('[data-uid]');
          if (r) newMessage ? this.openPrivate(+r.dataset.uid) : this.userProfile(+r.dataset.uid);
        };
      },
    };
  },

  /* ---------- پروفایل کاربر ---------- */
  async userProfile(id, preset = null) {
    if (id === App.me.id) { Modal.open(this.settingsPage()); return; }
    const page = {
      title: 'اطلاعات کاربر',
      html: async () => {
        const u = preset || (await API.call('users.get', { id })).user;
        preset = null;
        page.u = u;
        const online = isOnline(u.last_seen);
        return `<div class="profile-head">${avatarHtml(u, 'lg')}<div class="p-name">${esc(u.name)}</div>
          <div class="p-status ${online ? 'online' : ''}">${esc(u.blocked_me ? 'خیلی وقت پیش آنلاین بوده' : lastSeenText(u.last_seen))}</div></div>
          <div class="s-sep"></div>
          ${u.bio ? sItem('info', esc(u.bio), 'بیوگرافی') : ''}
          ${sItem('at', `<span class="ltr">@${esc(u.username)}</span>`, 'نام کاربری', 'data-a="copy"')}
          <div class="s-sep"></div>
          ${sItem('chat', 'ارسال پیام', '', 'data-a="msg"')}
          ${sItem(u.is_contact ? 'delete' : 'personAdd', u.is_contact ? 'حذف از مخاطبین' : 'افزودن به مخاطبین', '', 'data-a="contact"')}
          ${sItem('block', u.blocked ? 'رفع مسدودیت' : 'مسدود کردن کاربر', '', `data-a="block" class="${u.blocked ? '' : 's-item danger'}"`)}`;
      },
      mount: (b) => {
        const u = page.u;
        $('.profile-head .avatar', b).onclick = () => u.avatar && openViewer(u.avatar);
        b.onclick = async (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'copy') copyText('@' + u.username);
          if (a === 'msg') this.openPrivate(u.id);
          if (a === 'contact') {
            await API.call(u.is_contact ? 'contacts.remove' : 'contacts.add', { user_id: u.id }).catch((er) => toast(errText(er)));
            toast(u.is_contact ? 'از مخاطبین حذف شد' : 'به مخاطبین اضافه شد');
            Modal.refresh();
          }
          if (a === 'block') { await this.toggleBlock(u); Modal.refresh(); }
        };
      },
    };
    Modal.wrap ? Modal.push(page) : Modal.open(page);
  },

  async toggleBlock(u) {
    if (!u.blocked) {
      const r = await dialog({ title: 'مسدود کردن ' + u.name, text: 'آیا مطمئن هستید؟ این کاربر دیگر نمی‌تواند به شما پیام دهد و آخرین بازدید و عکس شما را نمی‌بیند.', buttons: [{ text: 'مسدود کردن', value: 1, danger: true }] });
      if (!r) return;
    }
    try {
      await API.call(u.blocked ? 'blocks.remove' : 'blocks.add', { user_id: u.id });
      toast(u.blocked ? 'مسدودیت برداشته شد' : 'کاربر مسدود شد');
      u.blocked = !u.blocked;
      await App.loadChats();
      if (App.current) renderComposer();
    } catch (e) { toast(errText(e)); }
  },

  /* ============================== تنظیمات ============================== */

  settingsPage() {
    return {
      title: 'تنظیمات',
      action: { icon: 'more', fn: (m) => {
        const r = $('[data-maction]', m).getBoundingClientRect();
        showMenu([{ icon: 'logout', text: 'خروج از حساب', danger: true, fn: () => this.confirmLogout() }], r.right, r.bottom);
      } },
      html: () => {
        const me = App.me;
        return `<div class="profile-head"><div class="avatar lg ${me.avatar ? '' : 'c' + (me.id % 7)}" data-a="avatar">${me.avatar ? `<img src="${esc(me.avatar)}" alt="">` : esc((me.name || '?')[0])}<div class="cam-badge">${icon('camera')}</div></div>
          <div class="p-name">${esc(me.name)}</div><div class="p-status online">آنلاین</div></div>
          <div class="s-sep"></div>
          <div class="s-head">حساب کاربری</div>
          ${sItem('at', `<span class="ltr">@${esc(me.username)}</span>`, 'برای تغییر نام کاربری ضربه بزنید', 'data-a="profile"')}
          ${sItem('info', me.bio ? esc(me.bio) : 'بیوگرافی', me.bio ? 'بیوگرافی' : 'چند کلمه درباره خودتان بنویسید', 'data-a="profile"')}
          <div class="s-sep"></div>
          ${sItem('person', 'ویرایش پروفایل', '', 'data-a="profile"')}
          ${sItem('bell', 'اعلان‌ها و صداها', '', 'data-a="notif"')}
          ${sItem('lock', 'حریم خصوصی و امنیت', '', 'data-a="privacy"')}
          ${sItem('chat', 'تنظیمات گفتگو', '', 'data-a="chat"')}
          ${sItem('devices', 'دستگاه‌ها', '', 'data-a="devices"')}
          ${sItem('bookmark', 'پیام‌های ذخیره شده', '', 'data-a="saved"')}
          ${sItem('android', 'نصب برنامه روی گوشی', '', 'data-a="install"')}
          <div class="s-sep"></div>
          ${sItem('logout', 'خروج از حساب', '', 'data-a="logout" class="s-item danger"')}
          <div class="s-note" style="text-align:center">${esc(App.cfg.app_name || 'تل‌چت')} نسخه ۱.۰</div>`;
      },
      mount: (b) => {
        b.onclick = (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'avatar') this.changeAvatar();
          if (a === 'profile') Modal.push(this.profilePage());
          if (a === 'notif') Modal.push(this.notifPage());
          if (a === 'privacy') Modal.push(this.privacyPage());
          if (a === 'chat') Modal.push(this.chatSettingsPage());
          if (a === 'devices') Modal.push(this.devicesPage());
          if (a === 'saved') { Modal.close(); this.openSaved(); }
          if (a === 'install') Modal.push(this.installPage());
          if (a === 'logout') this.confirmLogout();
        };
      },
    };
  },

  async confirmLogout() {
    const r = await dialog({ title: 'خروج', text: 'آیا می‌خواهید از حساب خود خارج شوید؟', buttons: [{ text: 'خروج', value: 1, danger: true }] });
    if (r) App.logout();
  },

  async changeAvatar() {
    const choice = App.me.avatar ? await dialog({ title: 'عکس پروفایل', buttons: [{ text: 'انتخاب عکس جدید', value: 'new' }, { text: 'حذف عکس', value: 'del', danger: true }] }) : { value: 'new' };
    if (!choice) return;
    try {
      let r;
      if (choice.value === 'del') r = await API.call('me.avatar');
      else {
        const f = await pickImage();
        if (!f) return;
        toast('در حال بارگذاری...');
        r = await API.upload(await compressImage(f), {}, null, 'me.avatar');
      }
      App.me = r.user; store.set('me', r.user);
      Modal.refresh();
    } catch (e) { toast(errText(e)); }
  },

  profilePage() {
    const me = App.me;
    return {
      title: 'ویرایش پروفایل',
      html: `<div class="pad">
        <div class="field"><label>نام</label><input name="name" maxlength="64" value="${esc(me.name)}"></div>
        <div class="field"><label>بیوگرافی</label><textarea name="bio" rows="3" maxlength="255">${esc(me.bio || '')}</textarea>
          <div class="hint">هر چیزی مثل سن، شغل یا شهر. مثال: ۲۳ ساله، طراح از تهران</div></div>
        <div class="field"><label>نام کاربری</label><input name="username" dir="ltr" value="${esc(me.username)}" autocapitalize="none">
          <div class="hint">دیگران می‌توانند شما را با این نام کاربری پیدا کنند. حروف a-z، اعداد و _ و حداقل ۴ کاراکتر.</div></div>
        <div class="err-text"></div><button class="btn" data-save>ذخیره</button></div>`,
      mount: (b) => {
        $('[data-save]', b).onclick = async () => {
          const data = { name: $('[name=name]', b).value, bio: $('[name=bio]', b).value, username: $('[name=username]', b).value };
          try {
            const r = await API.call('me.update', data);
            App.me = r.user; store.set('me', r.user);
            toast('ذخیره شد');
            Modal.pop(); Modal.refresh();
          } catch (e) { $('.err-text', b).textContent = errText(e); }
        };
      },
    };
  },

  notifPage() {
    const s = App.settings;
    return {
      title: 'اعلان‌ها و صداها',
      html: async () => {
        let status, sub = '';
        if (!isSecure) {
          status = 'اعلان داخل برنامه (صدا، لرزش و بنر)';
          sub = 'سایت روی http (بدون SSL) اجرا می‌شود؛ مرورگرها روی http اجازه اعلان سیستمی نمی‌دهند. تا وقتی برنامه باز است، پیام‌های جدید با صدا، لرزش و بنر داخل برنامه اطلاع داده می‌شوند.';
        } else if (!('Notification' in window)) status = isIOS && !isStandalone ? 'ابتدا برنامه را به صفحه اصلی اضافه کنید' : 'پشتیبانی نمی‌شود';
        else if (Notification.permission === 'granted') {
          let pushOk = false;
          try { pushOk = !!(await (await navigator.serviceWorker.ready).pushManager?.getSubscription()); } catch { /* ignore */ }
          status = 'فعال';
          sub = pushOk ? 'وقتی برنامه باز است اعلان‌ها مستقیم از سرور شما می‌رسند. وقتی برنامه بسته است، فقط با اینترنت بین‌الملل و از طریق سرویس Push مرورگر می‌رسند.' : 'اعلان‌ها هنگام باز بودن برنامه (حتی در پس‌زمینه) نمایش داده می‌شوند.';
        } else if (Notification.permission === 'denied') status = 'مسدود شده در تنظیمات مرورگر';
        else status = 'غیرفعال';
        const canEnable = isSecure && 'Notification' in window && Notification.permission === 'default';
        return `<div class="s-head">اعلان‌ها</div>
          ${sItem('bell', 'وضعیت اعلان‌ها', esc(status), canEnable ? 'data-a="enable"' : '', canEnable ? '<span class="s-val">فعال‌سازی</span>' : '')}
          ${sub ? `<div class="s-note">${sub}</div>` : ''}
          ${sItem('eye', 'نمایش متن پیام', 'نمایش متن پیام در اعلان', 'data-a="preview"', toggleHtml(s.preview))}
          ${sItem('bell', 'صدای پیام', '', 'data-a="sound"', toggleHtml(s.sound))}
          ${isSecure && 'Notification' in window && Notification.permission === 'granted' ? sItem('send', 'ارسال اعلان آزمایشی', '', 'data-a="test"') : ''}
          ${!isSecure && /Android/i.test(navigator.userAgent) ? `<div class="s-sep"></div><div class="s-note"><b>فعال کردن اعلان سیستمی و میکروفون روی http در اندروید (اختیاری):</b><br>
            ۱. در Chrome آدرس <span class="ltr">chrome://flags</span> را باز کنید.<br>
            ۲. عبارت <span class="ltr">Insecure origins treated as secure</span> را جستجو کنید.<br>
            ۳. آدرس سایت (<span class="ltr">${esc(location.origin)}</span>) را وارد و گزینه را Enabled کنید، سپس Chrome را دوباره باز کنید.</div>` : ''}`;
      },
      mount: (b) => {
        b.onclick = (e) => {
          const it = e.target.closest('[data-a]');
          if (!it) return;
          const a = it.dataset.a;
          if (a === 'enable') this.enableNotifications();
          if (a === 'test') API.call('push.test').then((r) => {
            toast(r.devices ? 'اعلان آزمایشی ارسال شد' : 'در حال نمایش اعلان محلی');
            navigator.serviceWorker.ready.then((reg) => reg.showNotification(App.cfg.app_name || 'تل‌چت', { body: 'اعلان‌ها کار می‌کنند ✅', icon: 'assets/icons/icon-192.png', tag: 'local-test' }));
          }).catch((er) => toast(errText(er)));
          if (a === 'preview' || a === 'sound') {
            e.preventDefault();
            s[a] = !s[a];
            $('input', it).checked = s[a];
            this.saveSettings();
          }
        };
      },
    };
  },

  /* ---------- حریم خصوصی و امنیت ---------- */
  privacyPage() {
    let data;
    return {
      title: 'حریم خصوصی و امنیت',
      html: async () => {
        data = await API.call('privacy.get');
        const p = data.privacy;
        const lock = store.get('lock');
        return `<div class="s-head">امنیت</div>
          ${sItem('lock', 'قفل برنامه با رمز', lock ? 'فعال' : 'غیرفعال', 'data-a="passcode"')}
          ${sItem('key', 'تغییر رمز عبور', 'رمز ورود به حساب', 'data-a="password"')}
          ${sItem('devices', 'دستگاه‌های فعال', faNum(data.sessions) + ' دستگاه', 'data-a="devices"')}
          ${sItem('block', 'کاربران مسدود شده', data.blocked.length ? faNum(data.blocked.length) + ' کاربر' : 'هیچ', 'data-a="blocked"')}
          <div class="s-sep"></div>
          <div class="s-head">حریم خصوصی</div>
          ${sItem('eye', 'آخرین بازدید و آنلاین', '', 'data-k="last_seen"', `<span class="s-val">${PRIV_LABEL[p.last_seen]}</span>`)}
          ${sItem('photo', 'عکس پروفایل', '', 'data-k="photo"', `<span class="s-val">${PRIV_LABEL[p.photo]}</span>`)}
          ${sItem('info', 'بیوگرافی', '', 'data-k="bio"', `<span class="s-val">${PRIV_LABEL[p.bio]}</span>`)}
          ${sItem('group', 'دعوت به گروه‌ها', '', 'data-k="groups"', `<span class="s-val">${PRIV_LABEL[p.groups]}</span>`)}
          <div class="s-note">«مخاطبین من» یعنی کسانی که شما آن‌ها را به مخاطبین خود اضافه کرده‌اید.</div>
          <div class="s-sep"></div>
          <div class="s-head">حذف حساب</div>
          ${sItem('delete', 'حذف حساب کاربری من', 'همه اطلاعات حساب شما برای همیشه پاک می‌شود', 'data-a="delete" class="s-item danger"')}`;
      },
      mount: (b) => {
        b.onclick = (e) => {
          const k = e.target.closest('[data-k]')?.dataset.k;
          if (k) { Modal.push(this.privacyOption(k, data.privacy)); return; }
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'passcode') Modal.push(this.passcodePage());
          if (a === 'password') Modal.push(this.passwordPage());
          if (a === 'devices') Modal.push(this.devicesPage());
          if (a === 'blocked') Modal.push(this.blockedPage(data.blocked));
          if (a === 'delete') this.deleteAccount();
        };
      },
    };
  },

  privacyOption(key, privacy) {
    const titles = {
      last_seen: ['آخرین بازدید و وضعیت آنلاین', 'چه کسانی می‌توانند آخرین بازدید و وضعیت آنلاین مرا ببینند؟',
        'اگر آخرین بازدید خود را با کسی به اشتراک نگذارید، شما هم آخرین بازدید او را نخواهید دید. به جای زمان دقیق، عبارتی تقریبی مثل «اخیراً» نمایش داده می‌شود.'],
      photo: ['عکس پروفایل', 'چه کسانی می‌توانند عکس پروفایل مرا ببینند؟', ''],
      bio: ['بیوگرافی', 'چه کسانی می‌توانند بیوگرافی مرا ببینند؟', ''],
      groups: ['دعوت به گروه', 'چه کسانی می‌توانند مرا به گروه‌ها اضافه کنند؟', ''],
    };
    const [title, q, note] = titles[key];
    const opts = key === 'groups' ? ['all', 'contacts'] : ['all', 'contacts', 'nobody'];
    return {
      title,
      html: `<div class="s-head">${q}</div>${opts.map((o) => `<label class="s-item"><input type="radio" name="p" value="${o}" ${privacy[key] === o ? 'checked' : ''}><div class="s-body">${PRIV_LABEL[o]}</div></label>`).join('')}
        ${note ? `<div class="s-note">${note}</div>` : ''}`,
      mount: (b) => {
        b.onchange = async (e) => {
          try {
            const r = await API.call('privacy.set', { [key]: e.target.value });
            Object.assign(privacy, r.privacy);
            toast('ذخیره شد');
          } catch (er) { toast(errText(er)); }
        };
      },
    };
  },

  blockedPage(list) {
    return {
      title: 'کاربران مسدود شده',
      html: () => (list.length ? `<div class="s-note">کاربران مسدود شده نمی‌توانند به شما پیام دهند و عکس و آخرین بازدید شما را نمی‌بینند. برای رفع مسدودیت روی کاربر بزنید.</div>` + list.map((u) => userRow(u, `<button class="btn flat" style="width:auto" data-unblock="${u.id}">رفع</button>`)).join('') : '<div class="empty-note">هیچ کاربری مسدود نشده است</div>')
        + `<div class="s-sep"></div>${sItem('personAdd', 'مسدود کردن کاربر', '', 'data-a="add"')}`,
      mount: (b) => {
        b.onclick = async (e) => {
          const ub = e.target.closest('[data-unblock]');
          if (ub) {
            await API.call('blocks.remove', { user_id: +ub.dataset.unblock }).catch((er) => toast(errText(er)));
            list.splice(list.findIndex((u) => u.id === +ub.dataset.unblock), 1);
            Modal.refresh(); App.loadChats();
            return;
          }
          if (e.target.closest('[data-a=add]')) {
            const r = await dialog({ title: 'مسدود کردن کاربر', input: { placeholder: 'نام کاربری' }, buttons: [{ text: 'مسدود کن', value: 1, danger: true }] });
            if (!r?.input) return;
            try {
              const u = (await API.call('users.search', { q: r.input })).users.find((x) => x.username === r.input.replace('@', '').toLowerCase());
              if (!u) { toast('کاربر یافت نشد'); return; }
              await API.call('blocks.add', { user_id: u.id });
              list.unshift(u); Modal.refresh(); App.loadChats();
            } catch (er) { toast(errText(er)); }
          }
        };
      },
    };
  },

  passcodePage() {
    return {
      title: 'قفل برنامه',
      html: () => {
        const lock = store.get('lock');
        const autos = [[60, '۱ دقیقه'], [300, '۵ دقیقه'], [3600, '۱ ساعت'], [0, 'فقط هنگام باز کردن برنامه']];
        return `<div class="profile-head">${icon('lock')}</div>
          <div class="s-note" style="text-align:center">وقتی رمز برنامه فعال باشد، هنگام باز کردن برنامه باید رمز را وارد کنید. این رمز فقط روی همین دستگاه ذخیره می‌شود.</div>
          ${lock ? `${sItem('', 'غیرفعال کردن رمز', '', 'data-a="off" class="s-item danger"')}
            ${sItem('', 'تغییر رمز', '', 'data-a="set"')}
            <div class="s-head">قفل خودکار</div>
            ${autos.map(([v, t]) => `<label class="s-item"><input type="radio" name="auto" value="${v}" ${(lock.auto || 0) === v ? 'checked' : ''}><div class="s-body">${t}</div></label>`).join('')}`
            : sItem('', 'فعال کردن رمز', '', 'data-a="set" style="color:var(--primary)"')}`;
      },
      mount: (b) => {
        const ic = $('.profile-head svg', b);
        if (ic) ic.style.cssText = 'width:64px;height:64px;color:var(--primary);margin:auto';
        b.onclick = async (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'off') { store.del('lock'); toast('رمز برنامه غیرفعال شد'); Modal.refresh(); }
          if (a === 'set') {
            const r1 = await dialog({ title: 'رمز جدید', text: 'یک رمز ۴ تا ۸ رقمی وارد کنید', input: { type: 'password', placeholder: '••••' }, buttons: [{ text: 'ادامه', value: 1 }] });
            if (!r1) return;
            if (!/^\d{4,8}$/.test(r1.input)) { toast('رمز باید ۴ تا ۸ رقم باشد'); return; }
            const r2 = await dialog({ title: 'تکرار رمز', input: { type: 'password', placeholder: '••••' }, buttons: [{ text: 'ذخیره', value: 1 }] });
            if (!r2) return;
            if (r1.input !== r2.input) { toast('رمزها یکسان نیستند'); return; }
            store.set('lock', { hash: await hashCode(r1.input), len: r1.input.length, auto: store.get('lock')?.auto ?? 300 });
            toast('رمز برنامه فعال شد');
            Modal.refresh();
          }
        };
        b.onchange = (e) => {
          if (e.target.name !== 'auto') return;
          const lock = store.get('lock');
          lock.auto = +e.target.value;
          store.set('lock', lock);
        };
      },
    };
  },

  passwordPage() {
    return {
      title: 'تغییر رمز عبور',
      html: `<div class="pad">
        <div class="field"><label>رمز فعلی</label><input type="password" name="current" dir="ltr" autocomplete="current-password"></div>
        <div class="field"><label>رمز جدید</label><input type="password" name="new" dir="ltr" autocomplete="new-password"></div>
        <div class="field"><label>تکرار رمز جدید</label><input type="password" name="new2" dir="ltr" autocomplete="new-password"></div>
        <div class="s-note" style="padding:0 0 12px">پس از تغییر رمز، از همه دستگاه‌های دیگر خارج می‌شوید.</div>
        <div class="err-text"></div><button class="btn" data-save>تغییر رمز</button></div>`,
      mount: (b) => {
        $('[data-save]', b).onclick = async () => {
          const cur = $('[name=current]', b).value, nw = $('[name=new]', b).value;
          if (nw !== $('[name=new2]', b).value) { $('.err-text', b).textContent = 'رمزهای جدید یکسان نیستند'; return; }
          try {
            await API.call('me.password', { current: cur, new: nw });
            toast('رمز عبور تغییر کرد');
            Modal.pop();
          } catch (e) { $('.err-text', b).textContent = errText(e); }
        };
      },
    };
  },

  devicesPage() {
    const devName = (ua) => {
      const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'نامشخص';
      const app = /TelchatAndroid/i.test(ua) ? 'اپ اندروید' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'مرورگر';
      return app + ' روی ' + os;
    };
    return {
      title: 'دستگاه‌ها',
      html: async () => {
        const s = (await API.call('sessions.list')).sessions;
        const cur = s.find((x) => x.current);
        const others = s.filter((x) => !x.current);
        const row = (x) => sItem('devices', esc(devName(x.device)), (x.current ? 'همین دستگاه — آنلاین' : 'آخرین فعالیت: ' + fmtDay(x.last_used) + ' ' + fmtTime(x.last_used)), x.current ? '' : `data-sid="${x.id}"`);
        return `<div class="s-head">این دستگاه</div>${cur ? row(cur) : ''}
          ${others.length ? sItem('logout', 'خروج از همه دستگاه‌های دیگر', '', 'data-a="all" class="s-item danger"') : ''}
          <div class="s-sep"></div><div class="s-head">نشست‌های فعال</div>
          ${others.length ? others.map(row).join('') + '<div class="s-note">برای خروج یک دستگاه، روی آن بزنید.</div>' : '<div class="empty-note">دستگاه دیگری وارد حساب شما نشده است</div>'}`;
      },
      mount: (b) => {
        b.onclick = async (e) => {
          const sid = e.target.closest('[data-sid]')?.dataset.sid;
          const all = e.target.closest('[data-a=all]');
          if (!sid && !all) return;
          const r = await dialog({ text: all ? 'از همه دستگاه‌های دیگر خارج شوید؟' : 'این دستگاه از حساب شما خارج شود؟', buttons: [{ text: 'خروج', value: 1, danger: true }] });
          if (!r) return;
          await API.call('sessions.terminate', all ? { all_others: 1 } : { id: +sid }).catch((er) => toast(errText(er)));
          Modal.refresh();
        };
      },
    };
  },

  async deleteAccount() {
    const r = await dialog({ title: 'حذف حساب', text: 'با حذف حساب، پروفایل، مخاطبین و عضویت شما در گروه‌ها برای همیشه حذف می‌شود. برای تأیید رمز عبور خود را وارد کنید.', input: { type: 'password', placeholder: 'رمز عبور' }, buttons: [{ text: 'حذف حساب', value: 1, danger: true }] });
    if (!r) return;
    try {
      await API.call('me.delete', { password: r.input });
      App.logout(true);
    } catch (e) { toast(errText(e)); }
  },

  chatSettingsPage() {
    const s = App.settings;
    return {
      title: 'تنظیمات گفتگو',
      html: `<div class="s-head">اندازه متن پیام‌ها</div>
        <div class="pad" style="display:flex;align-items:center;gap:12px">${icon('textSize')}<input type="range" min="13" max="22" value="${s.fontSize}" data-fs style="flex:1;accent-color:var(--primary)"><span data-fsv>${faNum(s.fontSize)}</span></div>
        <div class="s-sep"></div><div class="s-head">پوسته</div>
        ${[['auto', 'خودکار (مطابق سیستم)'], ['light', 'روز'], ['dark', 'شب']].map(([v, t]) => `<label class="s-item"><input type="radio" name="theme" value="${v}" ${s.theme === v ? 'checked' : ''}><div class="s-body">${t}</div></label>`).join('')}
        <div class="s-sep"></div><div class="s-head">صفحه‌کلید</div>
        ${sItem('send', 'ارسال با کلید Enter', 'در صورت خاموش بودن، با Ctrl+Enter ارسال می‌شود', 'data-a="enter"', toggleHtml(s.sendEnter))}`,
      mount: (b) => {
        $('[data-fs]', b).oninput = (e) => { s.fontSize = +e.target.value; $('[data-fsv]', b).textContent = faNum(s.fontSize); this.saveSettings(); };
        b.onchange = (e) => { if (e.target.name === 'theme') { s.theme = e.target.value; this.saveSettings(); } };
        $('[data-a=enter]', b).onclick = (e) => { e.preventDefault(); s.sendEnter = !s.sendEnter; $('[data-a=enter] input', b).checked = s.sendEnter; this.saveSettings(); };
      },
    };
  },

  installPage() {
    return {
      title: 'نصب برنامه',
      html: () => `<div class="s-head">اندروید</div>
          ${window.__installPrompt ? sItem('download', 'نصب برنامه', '', 'data-a="pwa"') : ''}
          <div class="s-note">۱. سایت را در <b>Chrome</b> باز کنید.<br>۲. منوی <b>⋮</b> (بالای صفحه) را بزنید.<br>۳. گزینه <b>Add to Home screen</b> یا <b>Install app</b> (افزودن به صفحه اصلی) را انتخاب کنید.</div>
          <div class="s-sep"></div><div class="s-head">آیفون و آیپد</div>
          <div class="s-note">۱. سایت را در <b>Safari</b> باز کنید.<br>۲. دکمه <b>Share</b> (مربع با فلش رو به بالا) را بزنید.<br>۳. گزینه <b>Add to Home Screen</b> را انتخاب کنید.<br>۴. از این به بعد برنامه را از آیکون صفحه اصلی باز کنید.</div>`,
      mount: (b) => {
        b.onclick = async (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'pwa' && window.__installPrompt) { window.__installPrompt.prompt(); await window.__installPrompt.userChoice; window.__installPrompt = null; Modal.refresh(); }
        };
      },
    };
  },

  /* ============================== گروه‌ها ============================== */

  userPicker({ title, excluded = [], onDone, doneIcon = 'check' }) {
    const picked = new Map();
    let contacts = [];
    return {
      title,
      action: { icon: doneIcon, fn: () => onDone([...picked.values()]) },
      html: async () => {
        contacts = (await API.call('contacts.list')).users;
        const recent = [...App.chats.values()].filter((c) => c.peer).map((c) => c.peer);
        const seen = new Set();
        contacts = contacts.concat(recent).filter((u) => !seen.has(u.id) && seen.add(u.id) && !excluded.includes(u.id));
        return `<div class="chips" data-chips></div><div class="modal-search"><input placeholder="جستجوی افراد..." autocomplete="off"></div><div data-list></div>`;
      },
      mount: (b) => {
        const box = $('[data-list]', b);
        const draw = (users) => {
          box.innerHTML = users.length ? users.map((u) => userRow(u, `<input type="checkbox" ${picked.has(u.id) ? 'checked' : ''}>`)).join('') : '<div class="empty-note">برای پیدا کردن افراد، نام کاربری آن‌ها را جستجو کنید</div>';
        };
        const chips = () => { $('[data-chips]', b).innerHTML = [...picked.values()].map((u) => `<span class="chip" data-uid="${u.id}">${avatarHtml(u)}${esc(u.name)}</span>`).join(''); };
        draw(contacts);
        let t, last = contacts;
        $('input', b).oninput = (e) => {
          clearTimeout(t);
          const q = e.target.value.trim();
          if (q.length < 2) { last = contacts; draw(contacts); return; }
          t = setTimeout(async () => { last = (await API.call('users.search', { q })).users.filter((u) => !excluded.includes(u.id)); draw(last); }, 250);
        };
        b.onclick = (e) => {
          const row = e.target.closest('[data-uid]');
          if (!row) return;
          const id = +row.dataset.uid;
          if (picked.has(id)) picked.delete(id);
          else { const u = last.find((x) => x.id === id) || contacts.find((x) => x.id === id); if (u) picked.set(id, u); }
          chips(); draw(last);
        };
      },
    };
  },

  createGroup() {
    const picker = this.userPicker({
      title: 'افزودن اعضا',
      doneIcon: 'check',
      onDone: (users) => Modal.push({
        title: 'گروه جدید',
        html: `<div class="pad" style="text-align:center"><div class="avatar lg c5" data-av style="margin:0 auto 20px;cursor:pointer">${icon('camera')}</div>
          <div class="field"><label>نام گروه</label><input name="title" maxlength="128"></div>
          <div class="field"><label>توضیحات (اختیاری)</label><input name="desc" maxlength="255"></div>
          <div class="s-note" style="text-align:right">${faNum(users.length)} عضو: ${esc(users.map((u) => u.name).join('، '))}</div>
          <div class="err-text"></div><button class="btn" data-create>ساخت گروه</button></div>`,
        mount: (b) => {
          let file = null;
          $('[data-av]', b).onclick = async () => {
            file = await pickImage();
            if (file) $('[data-av]', b).innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
          };
          $('input', b).focus();
          $('[data-create]', b).onclick = async () => {
            const title = $('[name=title]', b).value.trim();
            if (!title) { $('.err-text', b).textContent = 'نام گروه را وارد کنید'; return; }
            try {
              const r = await API.call('chats.create_group', { title, description: $('[name=desc]', b).value, member_ids: users.map((u) => u.id) });
              let chat = r.chat;
              if (file) chat = (await API.upload(await compressImage(file), { chat_id: chat.id }, null, 'chats.avatar')).chat;
              App.chats.set(chat.id, chat);
              if (users.length && chat.member_count - 1 < users.length) toast('برخی افراد به دلیل تنظیمات حریم خصوصی اضافه نشدند');
              Modal.close();
              openChat(chat.id);
            } catch (e) { $('.err-text', b).textContent = errText(e); }
          };
        },
      }),
    });
    Modal.open(picker);
  },

  async chatInfo(chatId) {
    const c0 = App.chats.get(chatId);
    if (c0?.type === 'private' && c0.peer) { this.userProfileInChat(c0); return; }
    const page = {
      title: c0?.type === 'group' ? 'اطلاعات گروه' : 'پیام‌های ذخیره شده',
      html: async () => {
        const c = (await API.call('chats.info', { chat_id: chatId })).chat;
        page.c = c;
        App.chats.set(chatId, Object.assign(App.chats.get(chatId) || {}, c));
        const admin = ['owner', 'admin'].includes(c.role);
        page.action = c.type === 'group' && admin ? { icon: 'edit', fn: () => Modal.push(this.editGroupPage(c)) } : null;
        if (c.type === 'saved') return this.mediaHtml(c.media) || '<div class="empty-note">هنوز عکس یا ویدیویی ذخیره نکرده‌اید</div>';
        const roleTxt = { owner: 'سازنده', admin: 'مدیر' };
        return `<div class="profile-head">${avatarHtml(c, 'lg')}<div class="p-name">${esc(c.title)}</div><div class="p-status">${faNum(c.member_count)} عضو</div></div>
          ${c.description ? `<div class="s-sep"></div>${sItem('info', esc(c.description), 'توضیحات')}` : ''}
          <div class="s-sep"></div>
          ${sItem(c.muted ? 'mute' : 'bell', 'اعلان‌ها', c.muted ? 'خاموش' : 'روشن', 'data-a="mute"', toggleHtml(!c.muted))}
          <div class="s-sep"></div>
          <div class="s-head">${faNum(c.member_count)} عضو</div>
          ${sItem('personAdd', 'افزودن عضو', '', 'data-a="add" style="color:var(--primary)"')}
          ${c.members.map((u) => userRow(u, u.role !== 'member' ? `<span class="role">${roleTxt[u.role]}</span>` : '')).join('')}
          ${c.media.length ? `<div class="s-sep"></div><div class="s-head">رسانه‌ها</div>${this.mediaHtml(c.media)}` : ''}
          <div class="s-sep"></div>
          ${sItem('clear', 'پاک کردن تاریخچه', '', 'data-a="clear"')}
          ${sItem('logout', 'ترک گروه', '', 'data-a="leave" class="s-item danger"')}
          ${c.role === 'owner' ? sItem('delete', 'حذف گروه برای همه', '', 'data-a="destroy" class="s-item danger"') : ''}`;
      },
      mount: (b, m) => {
        const c = page.c;
        if (page.action) {
          const head = $('.modal-head', m);
          if (!$('[data-maction]', head)) {
            head.insertAdjacentHTML('beforeend', `<button class="ibtn primary" data-maction>${icon('edit')}</button>`);
            $('[data-maction]', head).onclick = page.action.fn;
          }
        }
        $('.profile-head .avatar', b)?.addEventListener('click', () => c.avatar && openViewer(c.avatar));
        this.bindMedia(b);
        b.addEventListener('click', async (e) => {
          const row = e.target.closest('.user-row[data-uid]');
          if (row) { this.memberMenu(c, +row.dataset.uid, e); return; }
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'mute') { e.preventDefault(); await setChat(chatId, { muted: c.muted ? 0 : 1 }); Modal.refresh(); }
          if (a === 'add') Modal.push(this.userPicker({
            title: 'افزودن عضو', excluded: c.members.map((u) => u.id),
            onDone: async (users) => {
              if (!users.length) { Modal.pop(); return; }
              try { await API.call('chats.add_members', { chat_id: chatId, user_ids: users.map((u) => u.id) }); Modal.pop(); Modal.refresh(); } catch (er) { toast(errText(er)); }
            },
          }));
          if (a === 'clear') this.clearHistory(c);
          if (a === 'leave') this.deleteChat(c);
          if (a === 'destroy') {
            const r = await dialog({ title: 'حذف گروه', text: 'گروه و همه پیام‌های آن برای همه اعضا حذف می‌شود. این کار قابل بازگشت نیست.', buttons: [{ text: 'حذف گروه', value: 1, danger: true }] });
            if (r) { await API.call('chats.delete_group', { chat_id: chatId }).catch((er) => toast(errText(er))); Modal.close(); }
          }
        });
      },
    };
    Modal.open(page);
  },

  mediaHtml(media) {
    if (!media?.length) return '';
    return `<div class="media-grid">${media.map((m) => m.type === 'image'
      ? `<div style="background-image:url('${esc(m.file.url)}')" data-view="${esc(m.file.url)}"></div>`
      : `<div data-video="${esc(m.file.url)}"><video src="${esc(m.file.url)}#t=0.1" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover"></video>${icon('play')}</div>`).join('')}</div>`;
  },
  bindMedia(b) {
    b.addEventListener('click', (e) => {
      const v = e.target.closest('[data-view]');
      if (v) { openViewer(v.dataset.view); return; }
      const vid = e.target.closest('[data-video]');
      if (vid) {
        const w = document.createElement('div');
        w.className = 'viewer';
        w.innerHTML = `<div class="v-top"><button class="ibtn">${icon('close')}</button></div><video src="${esc(vid.dataset.video)}" controls autoplay playsinline></video>`;
        $('button', w).onclick = () => w.remove();
        document.body.append(w);
      }
    });
  },

  userProfileInChat(c) {
    const page = {
      title: 'اطلاعات کاربر',
      html: async () => {
        const info = (await API.call('chats.info', { chat_id: c.id })).chat;
        const u = info.peer;
        page.u = u; page.info = info;
        return `<div class="profile-head">${avatarHtml(u, 'lg')}<div class="p-name">${esc(u.name)}</div>
          <div class="p-status ${isOnline(u.last_seen) ? 'online' : ''}">${esc(u.blocked_me ? 'خیلی وقت پیش آنلاین بوده' : lastSeenText(u.last_seen))}</div></div>
          <div class="s-sep"></div>
          ${u.bio ? sItem('info', esc(u.bio), 'بیوگرافی') : ''}
          ${sItem('at', `<span class="ltr">@${esc(u.username)}</span>`, 'نام کاربری', 'data-a="copy"')}
          ${sItem(info.muted ? 'mute' : 'bell', 'اعلان‌ها', info.muted ? 'خاموش' : 'روشن', 'data-a="mute"', toggleHtml(!info.muted))}
          ${info.media.length ? `<div class="s-sep"></div><div class="s-head">رسانه‌ها</div>${this.mediaHtml(info.media)}` : ''}
          <div class="s-sep"></div>
          ${sItem(u.is_contact ? 'delete' : 'personAdd', u.is_contact ? 'حذف از مخاطبین' : 'افزودن به مخاطبین', '', 'data-a="contact"')}
          ${sItem('clear', 'پاک کردن تاریخچه', '', 'data-a="clear"')}
          ${sItem('block', u.blocked ? 'رفع مسدودیت' : 'مسدود کردن کاربر', '', `data-a="block" class="s-item ${u.blocked ? '' : 'danger'}"`)}
          ${sItem('delete', 'حذف گفتگو', '', 'data-a="delete" class="s-item danger"')}`;
      },
      mount: (b) => {
        const u = page.u;
        $('.profile-head .avatar', b).onclick = () => u.avatar && openViewer(u.avatar);
        this.bindMedia(b);
        b.addEventListener('click', async (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'copy') copyText('@' + u.username);
          if (a === 'mute') { e.preventDefault(); await setChat(c.id, { muted: page.info.muted ? 0 : 1 }); Modal.refresh(); }
          if (a === 'contact') { await API.call(u.is_contact ? 'contacts.remove' : 'contacts.add', { user_id: u.id }).catch((er) => toast(errText(er))); Modal.refresh(); }
          if (a === 'clear') this.clearHistory(c);
          if (a === 'block') { await this.toggleBlock(u); Modal.refresh(); }
          if (a === 'delete') this.deleteChat(c);
        });
      },
    };
    Modal.open(page);
  },

  memberMenu(c, uid, e) {
    if (uid === App.me.id) return;
    const m = c.members.find((x) => x.id === uid);
    const items = [
      { icon: 'person', text: 'مشاهده پروفایل', fn: () => this.userProfile(uid) },
      { icon: 'chat', text: 'ارسال پیام', fn: () => this.openPrivate(uid) },
    ];
    if (c.role === 'owner') items.push({ icon: 'star', text: m.role === 'admin' ? 'برکناری از مدیریت' : 'انتخاب به‌عنوان مدیر', fn: async () => {
      await API.call('chats.set_role', { chat_id: c.id, user_id: uid, role: m.role === 'admin' ? 'member' : 'admin' }).catch((er) => toast(errText(er)));
      Modal.refresh();
    } });
    if ((c.role === 'owner' && m.role !== 'owner') || (c.role === 'admin' && m.role === 'member')) items.push({ icon: 'delete', text: 'حذف از گروه', danger: true, fn: async () => {
      const r = await dialog({ text: m.name + ' از گروه حذف شود؟', buttons: [{ text: 'حذف', value: 1, danger: true }] });
      if (!r) return;
      await API.call('chats.remove_member', { chat_id: c.id, user_id: uid }).catch((er) => toast(errText(er)));
      Modal.refresh();
    } });
    showMenu(items, e.clientX, e.clientY);
  },

  editGroupPage(c) {
    return {
      title: 'ویرایش گروه',
      html: `<div class="pad" style="text-align:center"><div style="display:inline-block;position:relative;cursor:pointer" data-av>${avatarHtml(c, 'lg')}<div class="cam-badge" style="border-radius:50%;opacity:1">${icon('camera')}</div></div>
        <div class="field" style="margin-top:20px"><label>نام گروه</label><input name="title" maxlength="128" value="${esc(c.title)}"></div>
        <div class="field"><label>توضیحات</label><textarea name="desc" rows="3" maxlength="255">${esc(c.description || '')}</textarea></div>
        <div class="err-text"></div><button class="btn" data-save>ذخیره</button></div>`,
      mount: (b) => {
        $('.cam-badge svg', b).style.color = '#fff';
        $('[data-av]', b).onclick = async () => {
          const f = await pickImage();
          if (!f) return;
          try {
            const r = await API.upload(await compressImage(f), { chat_id: c.id }, null, 'chats.avatar');
            Object.assign(c, r.chat); App.chats.set(c.id, Object.assign(App.chats.get(c.id), r.chat));
            $('[data-av] .avatar', b).outerHTML = avatarHtml(r.chat, 'lg');
            renderChatList(); renderChatHeader();
          } catch (e) { toast(errText(e)); }
        };
        $('[data-save]', b).onclick = async () => {
          try {
            const r = await API.call('chats.update', { chat_id: c.id, title: $('[name=title]', b).value, description: $('[name=desc]', b).value });
            App.chats.set(c.id, Object.assign(App.chats.get(c.id), r.chat));
            renderChatList(); renderChatHeader();
            Modal.pop(); Modal.refresh();
          } catch (e) { $('.err-text', b).textContent = errText(e); }
        };
      },
    };
  },

  /* ============================== حذف و بازارسال ============================== */

  async deleteMessage(m, c) {
    const out = m.user_id === App.me.id;
    const canAll = out || c.type === 'private' || ['owner', 'admin'].includes(c.role);
    const r = await dialog({
      title: 'حذف پیام', text: 'آیا می‌خواهید این پیام را حذف کنید؟',
      check: canAll && c.type !== 'saved' ? { text: c.type === 'private' ? 'برای ' + c.title + ' هم حذف شود' : 'برای همه حذف شود', checked: true } : null,
      buttons: [{ text: 'حذف', value: 1, danger: true }],
    });
    if (!r) return;
    try {
      await API.call('messages.delete', { message_ids: [m.id], for_all: c.type === 'saved' || r.checked ? 1 : 0 });
      onDeleteMessages(c.id, [m.id]);
    } catch (e) { toast(errText(e)); }
  },

  async deleteChat(c) {
    if (c.type === 'group') {
      const r = await dialog({ title: 'ترک گروه', text: 'آیا می‌خواهید گروه «' + c.title + '» را ترک کنید؟', buttons: [{ text: 'ترک گروه', value: 1, danger: true }] });
      if (!r) return;
      await API.call('chats.leave', { chat_id: c.id }).catch((e) => toast(errText(e)));
    } else {
      const r = await dialog({
        title: 'حذف گفتگو', text: 'آیا می‌خواهید این گفتگو را حذف کنید؟',
        check: c.type === 'private' ? { text: 'برای ' + c.title + ' هم حذف شود', checked: false } : null,
        buttons: [{ text: 'حذف گفتگو', value: 1, danger: true }],
      });
      if (!r) return;
      await API.call('chats.clear', { chat_id: c.id, for_all: r.checked ? 1 : 0, hide: 1 }).catch((e) => toast(errText(e)));
    }
    Modal.close();
    App.chats.delete(c.id);
    if (App.current === c.id) closeChat();
    renderChatList();
  },

  async clearHistory(c) {
    const r = await dialog({
      title: 'پاک کردن تاریخچه', text: 'همه پیام‌های این گفتگو برای شما پاک می‌شود.',
      check: c.type === 'private' ? { text: 'برای ' + c.title + ' هم پاک شود', checked: false } : null,
      buttons: [{ text: 'پاک کردن', value: 1, danger: true }],
    });
    if (!r) return;
    await API.call('chats.clear', { chat_id: c.id, for_all: r.checked ? 1 : 0 }).catch((e) => toast(errText(e)));
    Modal.close();
  },

  forwardPicker(ids) {
    Modal.open({
      title: 'بازارسال به...',
      html: `<div class="modal-search"><input placeholder="جستجو" autocomplete="off"></div><div data-list></div>`,
      mount: (b) => {
        const box = $('[data-list]', b);
        const draw = (q = '') => {
          const list = sortedChats().filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()));
          box.innerHTML = list.map((c) => `<div class="user-row" data-cid="${c.id}">${avatarHtml(c, 'sm')}<div class="u-body"><div class="u-name">${esc(c.title)}</div>
            <div class="u-sub">${c.type === 'group' ? faNum(c.member_count) + ' عضو' : c.type === 'saved' ? '' : '@' + esc(c.peer?.username || '')}</div></div></div>`).join('');
        };
        draw();
        $('input', b).oninput = (e) => draw(e.target.value.trim());
        box.onclick = async (e) => {
          const row = e.target.closest('[data-cid]');
          if (!row) return;
          const to = +row.dataset.cid;
          try {
            await API.call('messages.forward', { message_ids: ids, to_chat_id: to });
            Modal.close();
            toast('پیام بازارسال شد');
            if (to !== App.current) openChat(to);
          } catch (er) { toast(errText(er)); }
        };
      },
    });
  },
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  if (App.token) Settings.renderInstallBanner();
});
