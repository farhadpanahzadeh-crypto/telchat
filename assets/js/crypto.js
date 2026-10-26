/*
 * رمزنگاری انتقال تل‌چت (NaCl box: Curve25519 + XSalsa20-Poly1305) با کتابخانه داخلی tweetnacl.
 * در هر بار باز شدن برنامه یک جفت‌کلید موقت ساخته می‌شود؛ همه درخواست‌ها و پاسخ‌ها رمز می‌شوند.
 * روی http هم کار می‌کند چون به Web Crypto (crypto.subtle) نیازی ندارد.
 */
'use strict';
window.Sec = {
  enabled: false,
  serverPub: null,
  kp: null,
  shared: null,
  offset: 0,

  b64e(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
  b64d(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },

  init(cfg) {
    this.enabled = false;
    if (!cfg?.box_public || !window.nacl) return false;
    this.serverPub = this.b64d(cfg.box_public);
    this.kp = nacl.box.keyPair();
    this.shared = nacl.box.before(this.serverPub, this.kp.secretKey);
    this.offset = (cfg.now || 0) ? cfg.now - Math.floor(Date.now() / 1000) : 0;
    this.enabled = true;
    return true;
  },
  now() { return Math.floor(Date.now() / 1000) + this.offset; },

  seal(token, data) {
    const nonce = nacl.randomBytes(24);
    const msg = new TextEncoder().encode(JSON.stringify({ t: token || '', ts: this.now(), d: data }));
    return { e: 1, k: this.b64e(this.kp.publicKey), n: this.b64e(nonce), c: this.b64e(nacl.box.after(msg, nonce, this.shared)) };
  },
  open(env) {
    const m = nacl.box.open.after(this.b64d(env.c), this.b64d(env.n), this.shared);
    if (!m) throw new Error('crypto_decrypt');
    return JSON.parse(new TextDecoder().decode(m));
  },
  /** توکن رمز شده برای هدر درخواست‌های آپلود */
  tokenHeader(token) {
    const e = this.seal(token, {});
    return e.k + '.' + e.n + '.' + e.c;
  },
  sealBytes(u8) {
    const nonce = nacl.randomBytes(24);
    return { n: this.b64e(nonce), c: nacl.box.after(u8, nonce, this.shared) };
  },
  /** اثر انگشت کلید سرور برای مقایسه (مثل تلگرام) */
  fingerprint() {
    if (!this.serverPub) return '';
    const h = nacl.hash(this.serverPub);
    const hex = [...h.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return hex.match(/.{4}/g).join(' ');
  },
};
