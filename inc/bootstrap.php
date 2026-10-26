<?php
declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));
define('UPLOAD_DIR', APP_ROOT . '/uploads');

require_once __DIR__ . '/webpush.php';

class ApiError extends Exception
{
    public int $status;

    public function __construct(string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

function config(?string $key = null)
{
    static $cfg = null;
    if ($cfg === null) {
        $file = APP_ROOT . '/inc/config.php';
        if (!is_file($file)) {
            throw new ApiError('not_installed', 503);
        }
        $cfg = require $file;
        $cfg += [
            'poll_timeout' => 20,
            'max_upload_mb' => 200,
            'allow_registration' => true,
            'app_name' => 'تل‌چت',
        ];
    }
    return $key === null ? $cfg : ($cfg[$key] ?? null);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config('db');
        $opts = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        if (($c['driver'] ?? 'mysql') === 'sqlite') {
            $pdo = new PDO('sqlite:' . $c['path'], null, null, $opts);
            $pdo->exec('PRAGMA journal_mode=WAL');
            $pdo->exec('PRAGMA busy_timeout=5000');
        } else {
            $dsn = 'mysql:host=' . $c['host'] . ';port=' . ($c['port'] ?? 3306) . ';dbname=' . $c['name'] . ';charset=utf8mb4';
            $pdo = new PDO($dsn, $c['user'], $c['pass'], $opts);
        }
        migrate($pdo);
    }
    return $pdo;
}

/** به‌روزرسانی ساختار دیتابیس نصب‌های قدیمی‌تر (فقط یک بار اجرا می‌شود) */
function migrate(PDO $pdo): void
{
    $marker = APP_ROOT . '/inc/.schema-3';
    if (is_file($marker)) {
        return;
    }
    $columns = [
        ['users', 'banned', 'TINYINT NOT NULL DEFAULT 0'],
        ['chats', 'accepted', 'TINYINT NOT NULL DEFAULT 1'],
        ['chats', 'requested_by', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    foreach ($columns as [$table, $col, $def]) {
        try {
            $pdo->query("SELECT $col FROM $table LIMIT 1");
        } catch (PDOException $e) {
            $pdo->exec("ALTER TABLE $table ADD COLUMN $col $def");
        }
    }
    @file_put_contents($marker, date('c'));
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    foreach (array_values($params) as $i => $v) {
        $st->bindValue($i + 1, $v, is_int($v) ? PDO::PARAM_INT : (is_null($v) ? PDO::PARAM_NULL : PDO::PARAM_STR));
    }
    $st->execute();
    return $st;
}

function one(string $sql, array $params = []): ?array
{
    $r = q($sql, $params)->fetch();
    return $r === false ? null : $r;
}

function all(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function val(string $sql, array $params = [])
{
    $r = q($sql, $params)->fetchColumn();
    return $r === false ? null : $r;
}

function insert(string $table, array $data): int
{
    $cols = implode(',', array_keys($data));
    $marks = implode(',', array_fill(0, count($data), '?'));
    q("INSERT INTO $table ($cols) VALUES ($marks)", array_values($data));
    return (int) db()->lastInsertId();
}

function in_list(array $ids): string
{
    return $ids ? implode(',', array_fill(0, count($ids), '?')) : 'NULL';
}

function int_ids($v): array
{
    if (!is_array($v)) {
        $v = [$v];
    }
    return array_values(array_unique(array_filter(array_map('intval', $v), fn($x) => $x > 0)));
}

function mb_trim(string $s): string
{
    return preg_replace('/^[\s\x{200c}\x{200f}\x{200e}]+|[\s\x{200c}\x{200f}\x{200e}]+$/u', '', $s) ?? '';
}

function str_limit(string $s, int $n): string
{
    return mb_strlen($s) > $n ? mb_substr($s, 0, $n) : $s;
}

function base_url(): string
{
    $u = config('app_url');
    if ($u) {
        return rtrim($u, '/');
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $dir = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/'))), '/');
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir;
}

/* ----------------------------- احراز هویت ----------------------------- */

function request_token(): string
{
    $t = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    if (!$t) {
        $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (stripos($h, 'Bearer ') === 0) {
            $t = substr($h, 7);
        }
    }
    return preg_match('/^[a-f0-9]{64}$/', $t) ? $t : '';
}

function current_user(bool $required = true): ?array
{
    static $user = false;
    if ($user === false) {
        $user = null;
        $t = request_token();
        if ($t) {
            $row = one('SELECT t.id AS token_id, t.last_used, u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?', [hash('sha256', $t)]);
            if ($row && !(int) ($row['banned'] ?? 0)) {
                $user = $row;
                $now = time();
                if ($now - (int) $row['last_used'] > 300) {
                    q('UPDATE tokens SET last_used = ? WHERE id = ?', [$now, (int) $row['token_id']]);
                }
            }
        }
    }
    if ($required && !$user) {
        throw new ApiError('unauthorized', 401);
    }
    return $user;
}

function uid(): int
{
    return (int) current_user()['id'];
}

function issue_token(int $userId): string
{
    $t = bin2hex(random_bytes(32));
    insert('tokens', [
        'user_id' => $userId,
        'token_hash' => hash('sha256', $t),
        'device' => str_limit((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 190),
        'created_at' => time(),
        'last_used' => time(),
    ]);
    return $t;
}

/* ------------------------- کارهای پس از پاسخ ------------------------- */

function defer(callable $fn): void
{
    $GLOBALS['__deferred'][] = $fn;
}

function send_json($data, int $status = 200): void
{
    $out = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $deferred = $GLOBALS['__deferred'] ?? [];
    if (!$deferred) {
        echo $out;
        return;
    }
    ignore_user_abort(true);
    @set_time_limit(60);
    header('Content-Length: ' . strlen($out));
    header('Connection: close');
    echo $out;
    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    flush();
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    }
    foreach ($deferred as $fn) {
        try {
            $fn();
        } catch (Throwable $e) {
            error_log('telchat deferred: ' . $e->getMessage());
        }
    }
}
