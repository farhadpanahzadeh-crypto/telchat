<?php
/**
 * رمزنگاری تل‌چت با libsodium (پروتکل NaCl: Curve25519 + XSalsa20-Poly1305)
 *
 * ۱) رمزنگاری انتقال: هر نشست مرورگر یک کلید موقت Curve25519 می‌سازد و با کلید عمومی سرور
 *    یک کلید مشترک به دست می‌آید. همه درخواست‌ها و پاسخ‌های API (شامل توکن ورود و متن پیام‌ها)
 *    با crypto_box رمز و احراز اصالت می‌شوند؛ بنابراین روی http هم شنود شبکه فقط متن رمز شده می‌بیند.
 *    برای جلوگیری از ارسال مجدد (Replay)، هر درخواست زمان و nonce یکتا دارد.
 * ۲) رمزنگاری در حالت ذخیره: متن پیام‌ها و رویدادها در دیتابیس با crypto_secretbox ذخیره می‌شوند.
 */

const ENC_PREFIX = 'e1:';

function crypto_on(): bool
{
    return function_exists('sodium_crypto_box') && function_exists('sodium_crypto_secretbox');
}

/** کلیدهای سرور؛ در اولین استفاده ساخته و در inc/config.php ذخیره می‌شوند */
function app_keys(): ?array
{
    static $keys = null;
    if ($keys !== null || !crypto_on()) {
        return $keys;
    }
    $k = config('keys');
    if (!$k) {
        $file = APP_ROOT . '/inc/config.php';
        $cfg = require $file;
        if (empty($cfg['keys'])) {
            $kp = sodium_crypto_box_keypair();
            $cfg['keys'] = [
                'box_public' => base64_encode(sodium_crypto_box_publickey($kp)),
                'box_secret' => base64_encode(sodium_crypto_box_secretkey($kp)),
                'data' => base64_encode(random_bytes(SODIUM_CRYPTO_SECRETBOX_KEYBYTES)),
            ];
            $php = "<?php\n// تنظیمات تل‌چت — از این فایل نسخه پشتیبان نگه دارید (کلیدهای رمزنگاری داخل آن است)\nreturn " . var_export($cfg, true) . ";\n";
            if (@file_put_contents($file, $php, LOCK_EX) === false) {
                return null;
            }
            if (function_exists('opcache_invalidate')) {
                @opcache_invalidate($file, true);
            }
        }
        $k = $cfg['keys'];
    }
    $keys = [
        'box_public' => base64_decode($k['box_public']),
        'box_secret' => base64_decode($k['box_secret']),
        'data' => base64_decode($k['data']),
    ];
    return $keys;
}

function server_public_key(): string
{
    $k = app_keys();
    return $k ? base64_encode($k['box_public']) : '';
}

/* ---------------- رمزنگاری در حالت ذخیره ---------------- */

function enc(string $plain): string
{
    $k = app_keys();
    if (!$k || $plain === '') {
        return $plain;
    }
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return ENC_PREFIX . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $k['data']));
}

function dec(?string $s): string
{
    $s = (string) $s;
    if (strncmp($s, ENC_PREFIX, 3) !== 0) {
        return $s;
    }
    $k = app_keys();
    $raw = base64_decode(substr($s, 3), true);
    if (!$k || $raw === false || strlen($raw) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES) {
        return $s;
    }
    $p = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $k['data']);
    return $p === false ? '' : $p;
}

/** پیام‌های قدیمی (قبل از فعال شدن رمزنگاری) به‌تدریج رمز می‌شوند */
function encrypt_backlog(): void
{
    $marker = APP_ROOT . '/inc/.enc-done';
    if (is_file($marker) || !app_keys() || mt_rand(1, 5) !== 1) {
        return;
    }
    $rows = all("SELECT id, body FROM messages WHERE body <> '' AND body NOT LIKE 'e1:%' LIMIT 300");
    foreach ($rows as $r) {
        q('UPDATE messages SET body = ? WHERE id = ?', [enc($r['body']), (int) $r['id']]);
    }
    if (count($rows) < 300) {
        @file_put_contents($marker, date('c'));
    }
}

/* ---------------- رمزنگاری انتقال ---------------- */

function b64($s): string
{
    return base64_encode($s);
}

function crypto_fail(string $why): void
{
    throw new ApiError('crypto_' . $why, 400);
}

/** بررسی زمان و یکتایی nonce برای جلوگیری از حمله تکرار */
function check_replay(string $nonce, int $ts): void
{
    if (abs(time() - $ts) > 600) {
        crypto_fail('clock');
    }
    $h = bin2hex(substr(hash('sha256', $nonce, true), 0, 16));
    try {
        insert('used_nonces', ['nonce' => $h, 'created_at' => time()]);
    } catch (PDOException $e) {
        crypto_fail('replay');
    }
    if (mt_rand(1, 100) === 1) {
        q('DELETE FROM used_nonces WHERE created_at < ?', [time() - 1200]);
    }
}

/** باز کردن درخواست رمز شده: {e:1, k, n, c} → داده اصلی */
function open_request(array $env): array
{
    $keys = app_keys();
    if (!$keys) {
        crypto_fail('unavailable');
    }
    $pk = base64_decode((string) ($env['k'] ?? ''), true);
    $nonce = base64_decode((string) ($env['n'] ?? ''), true);
    $c = base64_decode((string) ($env['c'] ?? ''), true);
    if (strlen((string) $pk) !== SODIUM_CRYPTO_BOX_PUBLICKEYBYTES || strlen((string) $nonce) !== SODIUM_CRYPTO_BOX_NONCEBYTES || $c === false) {
        crypto_fail('envelope');
    }
    $kp = sodium_crypto_box_keypair_from_secretkey_and_publickey($keys['box_secret'], $pk);
    $plain = sodium_crypto_box_open($c, $nonce, $kp);
    if ($plain === false) {
        crypto_fail('decrypt');
    }
    $GLOBALS['__box'] = $kp;
    $p = json_decode($plain, true);
    if (!is_array($p)) {
        crypto_fail('envelope');
    }
    check_replay($nonce, (int) ($p['ts'] ?? 0));
    if (!empty($p['t'])) {
        $GLOBALS['__token'] = (string) $p['t'];
    }
    return is_array($p['d'] ?? null) ? $p['d'] : [];
}

/** توکن رمز شده در هدر (برای آپلود فایل): k.n.c */
function open_token_header(string $h): void
{
    $parts = explode('.', $h);
    if (count($parts) !== 3) {
        crypto_fail('envelope');
    }
    open_request(['k' => $parts[0], 'n' => $parts[1], 'c' => $parts[2]]);
}

/** رمز کردن پاسخ با همان کلید مشترک درخواست */
function seal_response(string $json): string
{
    $kp = $GLOBALS['__box'] ?? null;
    if (!$kp) {
        return $json;
    }
    $nonce = random_bytes(SODIUM_CRYPTO_BOX_NONCEBYTES);
    return json_encode(['e' => 1, 'n' => b64($nonce), 'c' => b64(sodium_crypto_box($json, $nonce, $kp))]);
}

/** باز کردن یک تکه فایل رمز شده */
function open_bytes(string $c, string $nonceB64): string
{
    $kp = $GLOBALS['__box'] ?? null;
    $nonce = base64_decode($nonceB64, true);
    if (!$kp || strlen((string) $nonce) !== SODIUM_CRYPTO_BOX_NONCEBYTES) {
        crypto_fail('envelope');
    }
    $p = sodium_crypto_box_open($c, $nonce, $kp);
    if ($p === false) {
        crypto_fail('decrypt');
    }
    return $p;
}
