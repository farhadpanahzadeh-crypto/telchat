<?php
/**
 * نصب‌کننده تل‌چت — یک بار اجرا کنید و سپس این فایل را حذف کنید.
 */
declare(strict_types=1);

define('ROOT', __DIR__);
require ROOT . '/inc/webpush.php';
require ROOT . '/inc/schema.php';

$configFile = ROOT . '/inc/config.php';
$installed = is_file($configFile);
$errors = [];
$done = false;

function h($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

$checks = [
    'PHP 8.0 یا بالاتر' => version_compare(PHP_VERSION, '8.0.0', '>='),
    'افزونه PDO MySQL یا SQLite' => extension_loaded('pdo_mysql') || extension_loaded('pdo_sqlite'),
    'افزونه mbstring' => extension_loaded('mbstring'),
    'پوشه inc قابل نوشتن است' => is_writable(ROOT . '/inc'),
    'پوشه uploads قابل نوشتن است' => is_writable(ROOT . '/uploads'),
];
$optional = [
    'افزونه OpenSSL و cURL (فقط برای Web Push روی https)' => extension_loaded('openssl') && function_exists('openssl_pkey_derive') && extension_loaded('curl'),
    'افزونه GD (برای برش آواتار)' => extension_loaded('gd'),
    'اتصال HTTPS (اختیاری — روی http هم کار می‌کند)' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https',
];

if (!$installed && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $driver = ($_POST['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
    $db = $driver === 'mysql' ? [
        'driver' => 'mysql',
        'host' => trim($_POST['db_host'] ?? 'localhost') ?: 'localhost',
        'port' => (int) ($_POST['db_port'] ?? 3306) ?: 3306,
        'name' => trim($_POST['db_name'] ?? ''),
        'user' => trim($_POST['db_user'] ?? ''),
        'pass' => (string) ($_POST['db_pass'] ?? ''),
    ] : [
        'driver' => 'sqlite',
        'path' => ROOT . '/inc/data/telchat.sqlite',
    ];
    $appName = trim($_POST['app_name'] ?? '') ?: 'تل‌چت';
    $email = trim($_POST['email'] ?? '');
    $adminUser = strtolower(trim($_POST['admin_username'] ?? ''));
    $adminName = trim($_POST['admin_name'] ?? '');
    $adminPass = (string) ($_POST['admin_password'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'ایمیل معتبر وارد کنید.';
    }
    if (!preg_match('/^[a-z][a-z0-9_]{3,31}$/', $adminUser)) {
        $errors[] = 'نام کاربری باید با حرف انگلیسی شروع شود و ۴ تا ۳۲ کاراکتر (حروف انگلیسی، عدد، _) باشد.';
    }
    if ($adminName === '') {
        $errors[] = 'نام نمایشی مدیر را وارد کنید.';
    }
    if (strlen($adminPass) < 6) {
        $errors[] = 'رمز عبور حداقل ۶ کاراکتر باشد.';
    }
    if ($driver === 'mysql' && ($db['name'] === '' || $db['user'] === '')) {
        $errors[] = 'نام دیتابیس و کاربر دیتابیس را وارد کنید.';
    }

    if (!$errors) {
        try {
            $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION];
            if ($driver === 'sqlite') {
                if (!is_dir(ROOT . '/inc/data')) {
                    mkdir(ROOT . '/inc/data', 0755, true);
                }
                $pdo = new PDO('sqlite:' . $db['path'], null, null, $opts);
            } else {
                $pdo = new PDO("mysql:host={$db['host']};port={$db['port']};dbname={$db['name']};charset=utf8mb4", $db['user'], $db['pass'], $opts);
            }
            foreach (schema_statements($driver) as $sql) {
                try {
                    $pdo->exec($sql);
                } catch (PDOException $e) {
                    // ایندکس‌های تکراری در نصب مجدد نادیده گرفته می‌شوند
                    if (stripos($sql, 'CREATE TABLE') === 0) {
                        throw $e;
                    }
                }
            }
            try {
                $vapid = vapid_generate();
                $vapid['subject'] = 'mailto:' . $email;
            } catch (Throwable $e) {
                $vapid = [];
            }

            $st = $pdo->prepare('SELECT id FROM users WHERE username = ?');
            $st->execute([$adminUser]);
            if (!$st->fetchColumn()) {
                $st = $pdo->prepare('INSERT INTO users (username, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)');
                $st->execute([$adminUser, $adminName, password_hash($adminPass, PASSWORD_DEFAULT), time()]);
            }

            $config = [
                'app_name' => $appName,
                'db' => $db,
                'vapid' => $vapid,
                'allow_registration' => !empty($_POST['allow_registration']),
                'register_code' => trim($_POST['register_code'] ?? ''),
                'poll_timeout' => 20,
                'max_upload_mb' => max(1, (int) ($_POST['max_upload_mb'] ?? 200)),
            ];
            $php = "<?php\n// تنظیمات تل‌چت — این فایل توسط نصب‌کننده ساخته شده است\nreturn " . var_export($config, true) . ";\n";
            if (file_put_contents($configFile, $php) === false) {
                throw new RuntimeException('امکان نوشتن inc/config.php وجود ندارد.');
            }
            @chmod($configFile, 0640);

            // نام برنامه در manifest
            $mf = ROOT . '/manifest.webmanifest';
            if (is_writable($mf)) {
                $m = json_decode((string) file_get_contents($mf), true);
                if (is_array($m)) {
                    $m['name'] = $appName;
                    $m['short_name'] = $appName;
                    file_put_contents($mf, json_encode($m, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                }
            }
            $done = true;
        } catch (Throwable $e) {
            $errors[] = 'خطا: ' . $e->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>نصب تل‌چت</title>
<style>
@font-face{font-family:Vazirmatn;src:url(assets/fonts/Vazirmatn.woff2) format("woff2");font-weight:100 900}
*{box-sizing:border-box}
body{margin:0;font-family:Vazirmatn,Tahoma,sans-serif;background:#e7ebf0;color:#222;line-height:1.8}
.box{max-width:640px;margin:32px auto;background:#fff;border-radius:16px;padding:24px 28px;box-shadow:0 4px 20px rgba(0,0,0,.08)}
h1{margin:0 0 8px;color:#3390ec;font-size:24px}
h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #eee;padding-bottom:6px}
label{display:block;margin:10px 0 4px;font-size:14px;color:#555}
input,select{width:100%;padding:10px 12px;border:1px solid #d0d7de;border-radius:10px;font:inherit;direction:ltr;text-align:left}
input[type=checkbox]{width:auto}
.rtl{direction:rtl;text-align:right}
button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:10px;background:#3390ec;color:#fff;font:inherit;font-size:16px;cursor:pointer}
.ok{color:#1a7f37}.bad{color:#cf222e}.warn{color:#9a6700}
.err{background:#ffebe9;border:1px solid #ffcecb;padding:10px 14px;border-radius:10px;margin:8px 0}
.success{background:#dafbe1;border:1px solid #aceebb;padding:14px;border-radius:10px}
ul{padding-right:20px;margin:4px 0}
code{background:#f1f3f5;padding:1px 6px;border-radius:6px;direction:ltr;display:inline-block}
.row{display:flex;gap:12px}.row>div{flex:1}
</style>
</head>
<body>
<div class="box">
<h1>نصب تل‌چت</h1>
<?php if ($done): ?>
    <div class="success">
        <b>نصب با موفقیت انجام شد 🎉</b>
        <p>برای امنیت، همین الان فایل <code>install.php</code> را از طریق File Manager حذف کنید.</p>
        <p><a href="./">ورود به برنامه</a></p>
    </div>
<?php elseif ($installed): ?>
    <div class="err">برنامه قبلاً نصب شده است. برای نصب مجدد ابتدا فایل <code>inc/config.php</code> را حذف کنید. لطفاً <code>install.php</code> را پاک کنید.</div>
    <p><a href="./">ورود به برنامه</a></p>
<?php else: ?>
    <h2>بررسی نیازمندی‌ها</h2>
    <ul>
    <?php foreach ($checks as $k => $v): ?>
        <li class="<?= $v ? 'ok' : 'bad' ?>"><?= $v ? '✔' : '✘' ?> <?= h($k) ?></li>
    <?php endforeach; ?>
    <?php foreach ($optional as $k => $v): ?>
        <li class="<?= $v ? 'ok' : 'warn' ?>"><?= $v ? '✔' : '⚠' ?> <?= h($k) ?></li>
    <?php endforeach; ?>
    </ul>
    <?php foreach ($errors as $e): ?><div class="err"><?= h($e) ?></div><?php endforeach; ?>
    <form method="post" autocomplete="off">
        <h2>پایگاه داده</h2>
        <label>نوع دیتابیس</label>
        <select name="driver" class="rtl" onchange="document.getElementById('my').style.display=this.value==='mysql'?'':'none'">
            <option value="mysql">MySQL / MariaDB (پیشنهادی)</option>
            <option value="sqlite" <?= ($_POST['driver'] ?? '') === 'sqlite' ? 'selected' : '' ?>>SQLite (بدون نیاز به ساخت دیتابیس)</option>
        </select>
        <div id="my" style="<?= ($_POST['driver'] ?? '') === 'sqlite' ? 'display:none' : '' ?>">
            <div class="row">
                <div><label>هاست</label><input name="db_host" value="<?= h($_POST['db_host'] ?? 'localhost') ?>"></div>
                <div style="flex:.4"><label>پورت</label><input name="db_port" value="<?= h($_POST['db_port'] ?? '3306') ?>"></div>
            </div>
            <label>نام دیتابیس (مثلاً <code>cpuser_telchat</code>)</label>
            <input name="db_name" value="<?= h($_POST['db_name'] ?? '') ?>">
            <label>نام کاربری دیتابیس</label>
            <input name="db_user" value="<?= h($_POST['db_user'] ?? '') ?>">
            <label>رمز دیتابیس</label>
            <input name="db_pass" type="password">
        </div>

        <h2>تنظیمات برنامه</h2>
        <label>نام برنامه</label>
        <input name="app_name" class="rtl" value="<?= h($_POST['app_name'] ?? 'تل‌چت') ?>">
        <label>ایمیل مدیر</label>
        <input name="email" type="email" value="<?= h($_POST['email'] ?? '') ?>">
        <label>حداکثر حجم فایل (مگابایت)</label>
        <input name="max_upload_mb" type="number" value="<?= h($_POST['max_upload_mb'] ?? '200') ?>">
        <label><input type="checkbox" name="allow_registration" value="1" <?= ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !empty($_POST['allow_registration']) ? 'checked' : '' ?>> ثبت‌نام آزاد کاربران فعال باشد</label>
        <label>کد دعوت برای ثبت‌نام (اختیاری — اگر پر شود فقط کسانی که کد را دارند ثبت‌نام می‌کنند)</label>
        <input name="register_code" value="<?= h($_POST['register_code'] ?? '') ?>">

        <h2>حساب مدیر</h2>
        <label>نام کاربری (انگلیسی)</label>
        <input name="admin_username" value="<?= h($_POST['admin_username'] ?? '') ?>">
        <label>نام نمایشی</label>
        <input name="admin_name" class="rtl" value="<?= h($_POST['admin_name'] ?? '') ?>">
        <label>رمز عبور</label>
        <input name="admin_password" type="password">

        <button type="submit">نصب</button>
    </form>
<?php endif; ?>
</div>
</body>
</html>
