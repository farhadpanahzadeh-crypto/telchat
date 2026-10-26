<?php
/**
 * Web Push (RFC 8030 / 8291 / 8292) بدون نیاز به Composer.
 * فقط از افزونه‌های openssl و curl استفاده می‌کند که روی هاست‌های cPanel موجود هستند.
 */

function b64u_enc(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64u_dec(string $s): string
{
    $s = strtr($s, '-_', '+/');
    return (string) base64_decode($s . str_repeat('=', (4 - strlen($s) % 4) % 4));
}

/** کلید عمومی خام P-256 (65 بایت) را به PEM تبدیل می‌کند */
function ec_public_pem(string $raw): string
{
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

/** کلید خصوصی خام (d) + عمومی را به PEM تبدیل می‌کند */
function ec_private_pem(string $d, string $pub): string
{
    $der = hex2bin('30770201010420') . str_pad($d, 32, "\0", STR_PAD_LEFT)
        . hex2bin('a00a06082a8648ce3d030107a144034200') . $pub;
    return "-----BEGIN EC PRIVATE KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END EC PRIVATE KEY-----\n";
}

/** یک جفت کلید P-256 می‌سازد: [pem خصوصی, کلید عمومی خام] */
function ec_generate(): array
{
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$key) {
        throw new RuntimeException('openssl_pkey_new failed: ' . openssl_error_string());
    }
    openssl_pkey_export($key, $pem);
    $det = openssl_pkey_get_details($key);
    $pub = "\x04" . str_pad($det['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($det['ec']['y'], 32, "\0", STR_PAD_LEFT);
    return [$pem, $pub];
}

function vapid_generate(): array
{
    [$pem, $pub] = ec_generate();
    return ['public' => b64u_enc($pub), 'private_pem' => $pem];
}

/** امضای DER را به قالب خام r||s (64 بایت) تبدیل می‌کند */
function ecdsa_der_to_raw(string $der): string
{
    $pos = 2;
    if (ord($der[1]) & 0x80) {
        $pos += ord($der[1]) & 0x7f;
    }
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        $pos++; // 0x02
        $len = ord($der[$pos++]);
        $int = substr($der, $pos, $len);
        $pos += $len;
        $out .= str_pad(ltrim($int, "\0"), 32, "\0", STR_PAD_LEFT);
    }
    return $out;
}

/** رمزنگاری محتوای پیام با aes128gcm طبق RFC 8291 */
function webpush_encrypt(string $payload, string $uaPublic, string $authSecret, ?array $ephemeral = null, ?string $salt = null): string
{
    [$asPem, $asPublic] = $ephemeral ?? ec_generate();
    $salt = $salt ?? random_bytes(16);

    $peer = openssl_pkey_get_public(ec_public_pem($uaPublic));
    $priv = openssl_pkey_get_private($asPem);
    if (!$peer || !$priv) {
        throw new RuntimeException('invalid subscription key');
    }
    $ecdh = openssl_pkey_derive($peer, $priv, 32);
    if ($ecdh === false) {
        throw new RuntimeException('ecdh failed');
    }

    $ikm = hash_hkdf('sha256', $ecdh, 32, "WebPush: info\0" . $uaPublic . $asPublic, $authSecret);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);

    $tag = '';
    $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);

    return $salt . pack('N', 4096) . chr(strlen($asPublic)) . $asPublic . $cipher . $tag;
}

/** هدر Authorization برای VAPID */
function vapid_authorization(string $endpoint, array $vapid): string
{
    $p = parse_url($endpoint);
    $aud = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    $header = b64u_enc(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $claims = b64u_enc(json_encode([
        'aud' => $aud,
        'exp' => time() + 12 * 3600,
        'sub' => $vapid['subject'] ?? 'mailto:admin@example.com',
    ], JSON_UNESCAPED_SLASHES));
    $der = '';
    if (!openssl_sign("$header.$claims", $der, $vapid['private_pem'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('vapid sign failed');
    }
    $jwt = "$header.$claims." . b64u_enc(ecdsa_der_to_raw($der));
    return 'vapid t=' . $jwt . ', k=' . $vapid['public'];
}

/**
 * ارسال گروهی پوش.
 * $items: [['endpoint'=>..,'p256dh'=>..,'auth'=>..,'payload'=>string,'id'=>..], ...]
 * خروجی: آرایه‌ای از شناسه‌هایی که اشتراکشان منقضی شده (404/410)
 */
function webpush_send_many(array $items, array $vapid, int $ttl = 86400): array
{
    if (!$items || !function_exists('curl_multi_init')) {
        return [];
    }
    $mh = curl_multi_init();
    $handles = [];
    foreach ($items as $it) {
        try {
            $body = webpush_encrypt($it['payload'], b64u_dec($it['p256dh']), b64u_dec($it['auth']));
            $auth = vapid_authorization($it['endpoint'], $vapid);
        } catch (Throwable $e) {
            continue;
        }
        $ch = curl_init($it['endpoint']);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_HTTPHEADER => [
                'Authorization: ' . $auth,
                'Content-Type: application/octet-stream',
                'Content-Encoding: aes128gcm',
                'TTL: ' . $ttl,
                'Urgency: high',
            ],
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[] = [$ch, $it['id'] ?? null];
    }
    do {
        $status = curl_multi_exec($mh, $running);
        if ($running) {
            curl_multi_select($mh, 1.0);
        }
    } while ($running && $status === CURLM_OK);

    $expired = [];
    foreach ($handles as [$ch, $id]) {
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($code === 404 || $code === 410) {
            $expired[] = $id;
        }
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $expired;
}
