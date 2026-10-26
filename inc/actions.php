<?php
/** تمام اکشن‌های API. هر تابع act_* یک آرایه برمی‌گرداند که به JSON تبدیل می‌شود. */

/* ============================== کمکی‌ها ============================== */

const ONLINE_WINDOW = 45;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🙏', '🎉', '👎', '😍', '🤔'];

const PRIVACY_DEFAULTS = ['last_seen' => 'all', 'photo' => 'all', 'bio' => 'all', 'groups' => 'all'];

function privacy_of(array $u): array
{
    $p = json_decode((string) ($u['privacy'] ?? ''), true);
    return array_merge(PRIVACY_DEFAULTS, is_array($p) ? array_intersect_key($p, PRIVACY_DEFAULTS) : []);
}

/** رابطه صاحب اطلاعات با بیننده: آیا بیننده در مخاطبین اوست و آیا بلاک شده است */
function relation(int $owner, int $viewer): array
{
    static $cache = [];
    $k = "$owner:$viewer";
    if (!isset($cache[$k])) {
        $cache[$k] = [
            'contact' => (bool) val('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?', [$owner, $viewer]),
            'blocked' => (bool) val('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?', [$owner, $viewer]),
        ];
    }
    return $cache[$k];
}

function privacy_allows(array $owner, int $viewer, string $key): bool
{
    if ((int) $owner['id'] === $viewer) {
        return true;
    }
    $rel = relation((int) $owner['id'], $viewer);
    if ($rel['blocked']) {
        return false;
    }
    $v = privacy_of($owner)[$key];
    return $v === 'all' || ($v === 'contacts' && $rel['contact']);
}

/**
 * زمان آخرین بازدید با رعایت حریم خصوصی.
 * مقادیر منفی: -1 اخیراً، -2 در هفته اخیر، -3 در ماه اخیر، -4 خیلی وقت پیش
 */
function seen_value(array $u, int $viewer): int
{
    $ls = (int) $u['last_seen'];
    if ((int) $u['id'] === $viewer) {
        return $ls;
    }
    $me = current_user(false);
    $reciprocal = !$me || privacy_of($me)['last_seen'] !== 'nobody';
    if ($reciprocal && privacy_allows($u, $viewer, 'last_seen')) {
        return $ls;
    }
    if (relation((int) $u['id'], $viewer)['blocked']) {
        return -4;
    }
    $ago = time() - $ls;
    return $ago < 3 * 86400 ? -1 : ($ago < 7 * 86400 ? -2 : ($ago < 30 * 86400 ? -3 : -4));
}

function user_out(array $u, bool $full = false): array
{
    $viewer = (int) (current_user(false)['id'] ?? 0);
    $o = [
        'id' => (int) $u['id'],
        'username' => $u['username'],
        'name' => $u['name'],
        'avatar' => privacy_allows($u, $viewer, 'photo') ? $u['avatar'] : '',
        'last_seen' => seen_value($u, $viewer),
    ];
    if ($full) {
        $o['bio'] = privacy_allows($u, $viewer, 'bio') ? $u['bio'] : '';
        if ((int) $u['id'] !== $viewer && $viewer) {
            $o['is_contact'] = relation($viewer, (int) $u['id'])['contact'];
            $o['blocked'] = relation($viewer, (int) $u['id'])['blocked'];
            $o['blocked_me'] = relation((int) $u['id'], $viewer)['blocked'];
        }
    }
    return $o;
}

function users_by_ids(array $ids): array
{
    $ids = int_ids($ids);
    $out = [];
    if ($ids) {
        foreach (all('SELECT id, username, name, avatar, last_seen, bio, privacy FROM users WHERE id IN (' . in_list($ids) . ')', $ids) as $u) {
            $out[(int) $u['id']] = $u;
        }
    }
    return $out;
}

function chat_row(int $chatId): array
{
    $c = one('SELECT * FROM chats WHERE id = ?', [$chatId]);
    if (!$c) {
        throw new ApiError('chat_not_found', 404);
    }
    return $c;
}

function member_row(int $chatId, int $userId): ?array
{
    return one('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?', [$chatId, $userId]);
}

function require_member(int $chatId): array
{
    $m = member_row($chatId, uid());
    if (!$m) {
        throw new ApiError('not_member', 403);
    }
    return $m;
}

function require_admin(array $chat, array $member): void
{
    if ($chat['type'] === 'group' && !in_array($member['role'], ['owner', 'admin'], true)) {
        throw new ApiError('admin_required', 403);
    }
}

function member_ids(int $chatId): array
{
    return array_map('intval', array_column(all('SELECT user_id FROM chat_members WHERE chat_id = ?', [$chatId]), 'user_id'));
}

function emit(array $userIds, string $type, array $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $now = time();
    foreach (array_unique($userIds) as $u) {
        insert('events', ['user_id' => (int) $u, 'type' => $type, 'data' => $json, 'created_at' => $now]);
    }
}

function file_out(?array $f): ?array
{
    if (!$f) {
        return null;
    }
    return [
        'id' => (int) $f['id'],
        'url' => $f['path'],
        'name' => $f['name'],
        'mime' => $f['mime'],
        'size' => (int) $f['size'],
        'width' => (int) $f['width'],
        'height' => (int) $f['height'],
        'duration' => (int) $f['duration'],
    ];
}

function message_preview(array $m): string
{
    if ((int) $m['deleted']) {
        return 'پیام حذف شده';
    }
    $labels = ['image' => '🖼 عکس', 'video' => '🎬 ویدیو', 'voice' => '🎤 پیام صوتی', 'audio' => '🎵 فایل صوتی', 'file' => '📎 فایل'];
    $body = mb_trim(preg_replace('/\s+/u', ' ', (string) $m['body']) ?? '');
    if (isset($labels[$m['type']])) {
        return $body !== '' ? $labels[$m['type']] . '، ' . $body : $labels[$m['type']];
    }
    return $body;
}

/** تبدیل دسته‌ای ردیف‌های پیام به خروجی API */
function messages_out(array $rows): array
{
    if (!$rows) {
        return [];
    }
    $fileIds = $replyIds = $msgIds = $userIds = [];
    foreach ($rows as $m) {
        $msgIds[] = (int) $m['id'];
        $userIds[] = (int) $m['user_id'];
        if ((int) $m['file_id']) {
            $fileIds[] = (int) $m['file_id'];
        }
        if ((int) $m['reply_to_id']) {
            $replyIds[] = (int) $m['reply_to_id'];
        }
    }
    $replies = [];
    if ($replyIds = int_ids($replyIds)) {
        foreach (all('SELECT id, user_id, type, body, file_id, deleted FROM messages WHERE id IN (' . in_list($replyIds) . ')', $replyIds) as $r) {
            $replies[(int) $r['id']] = $r;
            $userIds[] = (int) $r['user_id'];
            if ((int) $r['file_id'] && $r['type'] === 'image') {
                $fileIds[] = (int) $r['file_id'];
            }
        }
    }
    $files = [];
    if ($fileIds = int_ids($fileIds)) {
        foreach (all('SELECT * FROM files WHERE id IN (' . in_list($fileIds) . ')', $fileIds) as $f) {
            $files[(int) $f['id']] = $f;
        }
    }
    $users = users_by_ids($userIds);
    $reactions = [];
    foreach (all('SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (' . in_list($msgIds) . ') ORDER BY created_at', $msgIds) as $r) {
        $reactions[(int) $r['message_id']][$r['emoji']][] = (int) $r['user_id'];
    }

    $out = [];
    foreach ($rows as $m) {
        $id = (int) $m['id'];
        $u = $users[(int) $m['user_id']] ?? null;
        $reply = null;
        if (($rid = (int) $m['reply_to_id']) && isset($replies[$rid])) {
            $r = $replies[$rid];
            $ru = $users[(int) $r['user_id']] ?? null;
            $reply = [
                'id' => $rid,
                'user_id' => (int) $r['user_id'],
                'name' => $ru['name'] ?? 'کاربر حذف شده',
                'type' => $r['type'],
                'text' => str_limit(message_preview($r), 120),
                'thumb' => ($r['type'] === 'image' && isset($files[(int) $r['file_id']]) && !(int) $r['deleted']) ? $files[(int) $r['file_id']]['path'] : null,
            ];
        }
        $rx = [];
        foreach ($reactions[$id] ?? [] as $emoji => $uids) {
            $rx[] = ['emoji' => $emoji, 'users' => $uids];
        }
        $out[] = [
            'id' => $id,
            'chat_id' => (int) $m['chat_id'],
            'user_id' => (int) $m['user_id'],
            'sender' => $u ? ['id' => (int) $u['id'], 'name' => $u['name'], 'avatar' => privacy_of($u)['photo'] === 'all' ? $u['avatar'] : ''] : ['id' => 0, 'name' => 'کاربر حذف شده', 'avatar' => ''],
            'type' => $m['type'],
            'body' => $m['body'],
            'file' => (int) $m['file_id'] ? file_out($files[(int) $m['file_id']] ?? null) : null,
            'reply_to' => $reply,
            'fwd_name' => $m['fwd_name'],
            'edited_at' => (int) $m['edited_at'],
            'created_at' => (int) $m['created_at'],
            'reactions' => $rx,
        ];
    }
    return $out;
}

function message_out_by_id(int $id): ?array
{
    $m = one('SELECT * FROM messages WHERE id = ?', [$id]);
    return $m ? messages_out([$m])[0] : null;
}

/** آخرین پیامی که این عضو می‌تواند ببیند */
function last_visible_message(int $chatId, array $member): ?array
{
    return one(
        'SELECT * FROM messages m WHERE m.chat_id = ? AND m.deleted = 0 AND m.id > ?
         AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ?)
         ORDER BY m.id DESC LIMIT 1',
        [$chatId, (int) $member['cleared_id'], (int) $member['user_id']]
    );
}

function chat_out(array $c, array $member): array
{
    $me = (int) $member['user_id'];
    $chatId = (int) $c['id'];
    $o = [
        'id' => $chatId,
        'type' => $c['type'],
        'title' => $c['title'],
        'description' => $c['description'],
        'avatar' => $c['avatar'],
        'role' => $member['role'],
        'muted' => (int) $member['muted'],
        'pinned' => (int) $member['pinned'],
        'last_read_id' => (int) $member['last_read_id'],
        'pinned_message' => null,
        'peer' => null,
        'member_count' => 0,
        'updated_at' => (int) $c['updated_at'],
    ];
    $others = all('SELECT user_id, last_read_id FROM chat_members WHERE chat_id = ? AND user_id <> ?', [$chatId, $me]);
    $o['others_read_id'] = $others ? max(array_map('intval', array_column($others, 'last_read_id'))) : PHP_INT_MAX;
    if ($c['type'] === 'saved') {
        $o['others_read_id'] = (int) $c['last_message_id'];
        $o['title'] = 'پیام‌های ذخیره شده';
    }
    $o['request'] = null;
    if ($c['type'] === 'private' && (int) ($c['accepted'] ?? 1) !== 1) {
        if ((int) $c['requested_by'] === $me) {
            $sent = (int) val('SELECT COUNT(*) FROM messages WHERE chat_id = ? AND user_id = ? AND deleted = 0', [$chatId, $me]);
            $o['request'] = (int) $c['accepted'] === -1 ? 'declined' : ($sent ? 'waiting' : 'outgoing');
        } else {
            $o['request'] = 'incoming';
        }
    }
    if ($c['type'] === 'private') {
        $peerId = (int) ($others[0]['user_id'] ?? 0);
        $peer = $peerId ? one('SELECT * FROM users WHERE id = ?', [$peerId]) : null;
        if ($peer) {
            $o['peer'] = user_out($peer, true);
            $o['title'] = $peer['name'];
            $o['avatar'] = $peer['avatar'];
        } else {
            $o['title'] = 'کاربر حذف شده';
        }
    }
    if ($c['type'] === 'group') {
        $o['member_count'] = count($others) + 1;
    }
    $last = last_visible_message($chatId, $member);
    $o['last_message'] = $last ? messages_out([$last])[0] : null;
    if ($o['last_message']) {
        $o['last_message']['preview'] = str_limit(message_preview($last), 100);
        $o['updated_at'] = max($o['updated_at'], (int) $last['created_at']);
    }
    $o['unread'] = (int) val(
        'SELECT COUNT(*) FROM messages WHERE chat_id = ? AND id > ? AND id > ? AND user_id <> ? AND deleted = 0',
        [$chatId, (int) $member['last_read_id'], (int) $member['cleared_id'], $me]
    );
    if ((int) $c['pinned_message_id']) {
        $pm = one('SELECT * FROM messages WHERE id = ? AND deleted = 0', [(int) $c['pinned_message_id']]);
        if ($pm && (int) $pm['id'] > (int) $member['cleared_id']) {
            $o['pinned_message'] = messages_out([$pm])[0];
            $o['pinned_message']['preview'] = str_limit(message_preview($pm), 100);
        }
    }
    return $o;
}

function chat_for_me(int $chatId): array
{
    $m = require_member($chatId);
    return chat_out(chat_row($chatId), $m);
}

/** ایجاد پیام و ارسال رویداد و نوتیفیکیشن */
function create_message(array $chat, int $userId, array $data): array
{
    $now = time();
    $chatId = (int) $chat['id'];
    $id = insert('messages', [
        'chat_id' => $chatId,
        'user_id' => $userId,
        'type' => $data['type'] ?? 'text',
        'body' => $data['body'] ?? '',
        'file_id' => (int) ($data['file_id'] ?? 0),
        'reply_to_id' => (int) ($data['reply_to_id'] ?? 0),
        'fwd_name' => $data['fwd_name'] ?? '',
        'created_at' => $now,
    ]);
    q('UPDATE chats SET last_message_id = ?, updated_at = ? WHERE id = ?', [$id, $now, $chatId]);
    q('UPDATE chat_members SET hidden = 0 WHERE chat_id = ?', [$chatId]);
    if ($userId) {
        q('UPDATE chat_members SET last_read_id = ? WHERE chat_id = ? AND user_id = ?', [$id, $chatId, $userId]);
    }
    $msg = message_out_by_id($id);
    if (!empty($data['client_id'])) {
        $msg['client_id'] = str_limit((string) $data['client_id'], 40);
    }
    $members = member_ids($chatId);
    emit($members, 'message', $msg);

    if (($data['type'] ?? 'text') !== 'system') {
        $recipients = array_values(array_filter($members, fn($m) => $m !== $userId));
        if ($recipients) {
            defer(fn() => push_new_message($chat, $msg, $recipients));
        }
    }
    return $msg;
}

function system_message(array $chat, int $actorId, string $text): array
{
    return create_message($chat, $actorId, ['type' => 'system', 'body' => $text]);
}

function unread_total(int $userId): int
{
    return (int) val(
        'SELECT COUNT(*) FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
         WHERE m.id > cm.last_read_id AND m.id > cm.cleared_id AND m.user_id <> ? AND m.deleted = 0 AND cm.muted = 0',
        [$userId, $userId]
    );
}

function push_new_message(array $chat, array $msg, array $recipientIds): void
{
    $vapid = config('vapid');
    if (!$vapid || empty($vapid['private_pem'])) {
        return;
    }
    $ids = int_ids($recipientIds);
    if (!$ids) {
        return;
    }
    $chatId = (int) $chat['id'];
    // کاربرانی که چت را بی‌صدا کرده‌اند یا هم‌اکنون برنامه را باز دارند نوتیف نمی‌گیرند
    $rows = all(
        'SELECT u.id FROM users u JOIN chat_members cm ON cm.user_id = u.id AND cm.chat_id = ?
         WHERE u.id IN (' . in_list($ids) . ') AND cm.muted = 0 AND u.visible_at < ?',
        array_merge([$chatId], $ids, [time() - 25])
    );
    $targets = array_map('intval', array_column($rows, 'id'));
    if (!$targets) {
        return;
    }
    $subs = all('SELECT * FROM push_subs WHERE user_id IN (' . in_list($targets) . ')', $targets);
    if (!$subs) {
        return;
    }
    $text = str_limit(message_preview(['type' => $msg['type'], 'body' => $msg['body'], 'deleted' => 0]), 180);
    $title = $msg['sender']['name'];
    if ($chat['type'] === 'group') {
        $title = $chat['title'];
        $text = $msg['sender']['name'] . ': ' . $text;
    }
    $icon = $chat['type'] === 'group' ? $chat['avatar'] : $msg['sender']['avatar'];
    $badges = [];
    $items = [];
    foreach ($subs as $s) {
        $u = (int) $s['user_id'];
        $badges[$u] = $badges[$u] ?? unread_total($u);
        $items[] = [
            'id' => (int) $s['id'],
            'endpoint' => $s['endpoint'],
            'p256dh' => $s['p256dh'],
            'auth' => $s['auth'],
            'payload' => json_encode([
                'title' => $title,
                'body' => $text,
                'icon' => $icon,
                'chat_id' => $chatId,
                'message_id' => $msg['id'],
                'badge' => $badges[$u],
                'tag' => 'chat-' . $chatId,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];
    }
    $expired = webpush_send_many($items, $vapid);
    if ($expired = int_ids($expired)) {
        q('DELETE FROM push_subs WHERE id IN (' . in_list($expired) . ')', $expired);
    }
}

/* ============================== فایل‌ها ============================== */

const SAFE_EXT = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp',
    'mp4', 'webm', 'mov', 'm4v', '3gp', 'mkv',
    'mp3', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wav', 'flac', 'weba',
    'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'txt', 'csv', 'rtf',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'apk', 'json',
];

function store_upload(array $f, int $userId, array $meta = []): array
{
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $code = $f['error'] ?? 0;
        throw new ApiError(in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 'file_too_large' : 'upload_failed');
    }
    $max = (int) config('max_upload_mb') * 1024 * 1024;
    if ($f['size'] > $max) {
        throw new ApiError('file_too_large');
    }
    $name = str_limit(basename(str_replace('\\', '/', (string) $f['name'])), 200) ?: 'file';
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $mime = 'application/octet-stream';
    if (function_exists('finfo_open')) {
        $fi = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($fi, $f['tmp_name']) ?: $mime;
        finfo_close($fi);
    }
    if ($mime === 'application/octet-stream' && !empty($f['type'])) {
        $mime = (string) $f['type'];
    }
    // ضبط صدا در مرورگرها گاهی به‌صورت video/webm شناسایی می‌شود
    if (($meta['kind'] ?? '') === 'voice' && str_starts_with($mime, 'video/')) {
        $mime = 'audio/' . substr($mime, 6);
    }
    if (!in_array($ext, SAFE_EXT, true)) {
        $ext = 'bin';
    }
    $sub = date('Y/m');
    $dir = UPLOAD_DIR . '/' . $sub;
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        throw new ApiError('upload_dir_not_writable', 500);
    }
    $file = bin2hex(random_bytes(16)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], "$dir/$file")) {
        throw new ApiError('upload_failed', 500);
    }
    @chmod("$dir/$file", 0644);
    $w = $h = 0;
    if (str_starts_with($mime, 'image/') && ($sz = @getimagesize("$dir/$file"))) {
        [$w, $h] = $sz;
    } else {
        $w = (int) ($meta['width'] ?? 0);
        $h = (int) ($meta['height'] ?? 0);
    }
    $row = [
        'user_id' => $userId,
        'path' => "uploads/$sub/$file",
        'name' => $name,
        'mime' => str_limit($mime, 128),
        'size' => (int) $f['size'],
        'width' => (int) $w,
        'height' => (int) $h,
        'duration' => max(0, (int) ($meta['duration'] ?? 0)),
        'created_at' => time(),
    ];
    $row['id'] = insert('files', $row);
    return $row;
}

/** ساخت آواتار مربعی (در صورت وجود GD) */
function store_avatar(array $f, int $userId): string
{
    $row = store_upload($f, $userId);
    if (!str_starts_with($row['mime'], 'image/')) {
        throw new ApiError('image_required');
    }
    $src = APP_ROOT . '/' . $row['path'];
    if (!function_exists('imagecreatefromstring')) {
        return $row['path'];
    }
    $img = @imagecreatefromstring((string) file_get_contents($src));
    if (!$img) {
        return $row['path'];
    }
    $w = imagesx($img);
    $h = imagesy($img);
    $s = min($w, $h);
    $dst = imagecreatetruecolor(320, 320);
    imagecopyresampled($dst, $img, 0, 0, (int) (($w - $s) / 2), (int) (($h - $s) / 2), 320, 320, $s, $s);
    $path = 'uploads/' . date('Y/m') . '/' . bin2hex(random_bytes(16)) . '.jpg';
    imagejpeg($dst, APP_ROOT . '/' . $path, 88);
    imagedestroy($img);
    imagedestroy($dst);
    @unlink($src);
    q('UPDATE files SET path = ?, mime = ? WHERE id = ?', [$path, 'image/jpeg', (int) $row['id']]);
    return $path;
}

/* ============================== احراز هویت ============================== */

function validate_username(string $u): string
{
    $u = strtolower(trim($u));
    if (!preg_match('/^[a-z][a-z0-9_]{3,31}$/', $u)) {
        throw new ApiError('invalid_username');
    }
    return $u;
}

function act_auth_register(array $in): array
{
    if (!config('allow_registration')) {
        throw new ApiError('registration_closed', 403);
    }
    $code = (string) (config('register_code') ?? '');
    if ($code !== '' && !hash_equals($code, (string) ($in['code'] ?? ''))) {
        throw new ApiError('invalid_register_code', 403);
    }
    $username = validate_username((string) ($in['username'] ?? ''));
    $name = str_limit(mb_trim((string) ($in['name'] ?? '')), 64);
    $pass = (string) ($in['password'] ?? '');
    if ($name === '') {
        throw new ApiError('name_required');
    }
    if (strlen($pass) < 6) {
        throw new ApiError('password_too_short');
    }
    if (val('SELECT id FROM users WHERE username = ?', [$username])) {
        throw new ApiError('username_taken');
    }
    $isFirst = !val('SELECT COUNT(*) FROM users');
    $id = insert('users', [
        'username' => $username,
        'name' => $name,
        'password_hash' => password_hash($pass, PASSWORD_DEFAULT),
        'is_admin' => $isFirst ? 1 : 0,
        'created_at' => time(),
        'last_seen' => time(),
    ]);
    return ['token' => issue_token($id), 'user' => user_out(one('SELECT * FROM users WHERE id = ?', [$id]), true)];
}

function act_auth_login(array $in): array
{
    $username = strtolower(trim((string) ($in['username'] ?? '')));
    $u = one('SELECT * FROM users WHERE username = ?', [$username]);
    if (!$u || !password_verify((string) ($in['password'] ?? ''), $u['password_hash'])) {
        usleep(400000);
        throw new ApiError('invalid_credentials', 401);
    }
    if ((int) ($u['banned'] ?? 0)) {
        throw new ApiError('account_banned', 403);
    }
    if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $in['password'], PASSWORD_DEFAULT), (int) $u['id']]);
    }
    return ['token' => issue_token((int) $u['id']), 'user' => user_out($u, true)];
}

function act_auth_logout(array $in): array
{
    $u = current_user();
    if (!empty($in['endpoint'])) {
        q('DELETE FROM push_subs WHERE endpoint_hash = ?', [hash('sha256', (string) $in['endpoint'])]);
    }
    q('DELETE FROM tokens WHERE id = ?', [(int) $u['token_id']]);
    return ['ok' => true];
}

function act_config(array $in): array
{
    return [
        'app_name' => config('app_name'),
        'allow_registration' => (bool) config('allow_registration'),
        'register_code' => (string) (config('register_code') ?? '') !== '',
        'vapid_public' => config('vapid')['public'] ?? '',
        'max_upload_mb' => (int) config('max_upload_mb'),
        'reactions' => REACTIONS,
    ];
}

/* ============================== پروفایل ============================== */

function act_me_get(array $in): array
{
    $u = current_user();
    return ['user' => user_out($u, true) + ['is_admin' => (bool) (int) $u['is_admin']]];
}

function act_me_update(array $in): array
{
    $u = current_user();
    $set = [];
    if (isset($in['name'])) {
        $name = str_limit(mb_trim((string) $in['name']), 64);
        if ($name === '') {
            throw new ApiError('name_required');
        }
        $set['name'] = $name;
    }
    if (isset($in['bio'])) {
        $set['bio'] = str_limit(mb_trim((string) $in['bio']), 255);
    }
    if (isset($in['username'])) {
        $un = validate_username((string) $in['username']);
        if ($un !== $u['username'] && val('SELECT id FROM users WHERE username = ?', [$un])) {
            throw new ApiError('username_taken');
        }
        $set['username'] = $un;
    }
    if ($set) {
        q('UPDATE users SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($set))) . ' WHERE id = ?', array_merge(array_values($set), [(int) $u['id']]));
        notify_contacts((int) $u['id']);
    }
    return ['user' => user_out(one('SELECT * FROM users WHERE id = ?', [(int) $u['id']]), true)];
}

function act_me_avatar(array $in): array
{
    $u = current_user();
    $path = empty($_FILES['file']) ? '' : store_avatar($_FILES['file'], (int) $u['id']);
    q('UPDATE users SET avatar = ? WHERE id = ?', [$path, (int) $u['id']]);
    notify_contacts((int) $u['id']);
    return ['user' => user_out(one('SELECT * FROM users WHERE id = ?', [(int) $u['id']]), true)];
}

function act_me_password(array $in): array
{
    $u = current_user();
    if (!password_verify((string) ($in['current'] ?? ''), $u['password_hash'])) {
        throw new ApiError('invalid_password');
    }
    if (strlen((string) ($in['new'] ?? '')) < 6) {
        throw new ApiError('password_too_short');
    }
    q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $in['new'], PASSWORD_DEFAULT), (int) $u['id']]);
    q('DELETE FROM tokens WHERE user_id = ? AND id <> ?', [(int) $u['id'], (int) $u['token_id']]);
    return ['ok' => true];
}

/** به همه کسانی که با این کاربر چت دارند خبر می‌دهد که اطلاعاتش عوض شده */
function notify_contacts(int $userId): void
{
    $rows = all('SELECT DISTINCT cm2.user_id FROM chat_members cm JOIN chat_members cm2 ON cm2.chat_id = cm.chat_id WHERE cm.user_id = ?', [$userId]);
    emit(array_map('intval', array_column($rows, 'user_id')), 'chats_changed', []);
}

/* ============================== کاربران ============================== */

/** الگوی LIKE امن که در MySQL و SQLite یکسان کار می‌کند */
function like_pattern(string $q): string
{
    return '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
}

function act_users_search(array $in): array
{
    $qs = mb_trim((string) ($in['q'] ?? ''));
    $qs = ltrim($qs, '@');
    if (mb_strlen($qs) < 2) {
        return ['users' => []];
    }
    $like = like_pattern($qs);
    $rows = all(
        "SELECT * FROM users WHERE id <> ? AND banned = 0 AND (username LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!') ORDER BY (username = ?) DESC, last_seen DESC LIMIT 30",
        [uid(), strtolower($like), $like, strtolower($qs)]
    );
    return ['users' => array_map(fn($u) => user_out($u, true), $rows)];
}

function act_users_get(array $in): array
{
    $u = one('SELECT * FROM users WHERE id = ?', [(int) ($in['id'] ?? 0)]);
    if (!$u) {
        throw new ApiError('user_not_found', 404);
    }
    return ['user' => user_out($u, true)];
}

/* ============================== چت‌ها ============================== */

function act_chats_list(array $in): array
{
    $me = uid();
    $rows = all(
        'SELECT c.*, cm.id AS m_id, cm.role, cm.last_read_id, cm.cleared_id, cm.muted, cm.pinned, cm.hidden, cm.user_id
         FROM chat_members cm JOIN chats c ON c.id = cm.chat_id
         WHERE cm.user_id = ? AND cm.hidden = 0 ORDER BY c.updated_at DESC',
        [$me]
    );
    $chats = [];
    foreach ($rows as $r) {
        $chats[] = chat_out($r, $r);
    }
    return ['chats' => $chats];
}

function act_chats_get(array $in): array
{
    return ['chat' => chat_for_me((int) ($in['chat_id'] ?? 0))];
}

function act_chats_open_private(array $in): array
{
    $me = uid();
    $peerId = (int) ($in['user_id'] ?? 0);
    if ($peerId === $me) {
        return act_chats_saved($in);
    }
    if (!val('SELECT id FROM users WHERE id = ?', [$peerId])) {
        throw new ApiError('user_not_found', 404);
    }
    $key = 'p' . min($me, $peerId) . '_' . max($me, $peerId);
    $chat = one('SELECT * FROM chats WHERE uniq_key = ?', [$key]);
    $now = time();
    if (!$chat) {
        $id = insert('chats', ['type' => 'private', 'uniq_key' => $key, 'accepted' => 0, 'requested_by' => $me, 'created_at' => $now, 'updated_at' => $now]);
        foreach ([$me, $peerId] as $u) {
            insert('chat_members', ['chat_id' => $id, 'user_id' => $u, 'joined_at' => $now, 'hidden' => $u === $me ? 0 : 1]);
        }
        $chat = chat_row($id);
    } else {
        q('UPDATE chat_members SET hidden = 0 WHERE chat_id = ? AND user_id = ?', [(int) $chat['id'], $me]);
        // کسی که قبلاً درخواست را رد کرده، با باز کردن دوباره گفتگو می‌تواند آن را بپذیرد
        if ((int) $chat['accepted'] === -1 && (int) $chat['requested_by'] !== $me) {
            q('UPDATE chats SET accepted = 0 WHERE id = ?', [(int) $chat['id']]);
        }
    }
    return ['chat' => chat_for_me((int) $chat['id'])];
}

/** پاسخ به درخواست گفتگو: قبول، رد یا رد و مسدود کردن */
function act_chats_respond(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $chat = chat_row($chatId);
    $me = uid();
    if ($chat['type'] !== 'private' || (int) $chat['accepted'] === 1 || (int) $chat['requested_by'] === $me) {
        throw new ApiError('no_request');
    }
    $requester = (int) $chat['requested_by'];
    if (!empty($in['accept'])) {
        q('UPDATE chats SET accepted = 1 WHERE id = ?', [$chatId]);
        system_message(chat_row($chatId), $me, current_user()['name'] . ' درخواست گفتگو را پذیرفت');
        emit([$me, $requester], 'chats_changed', ['chat_id' => $chatId]);
        return ['chat' => chat_for_me($chatId)];
    }
    q('UPDATE chats SET accepted = -1 WHERE id = ?', [$chatId]);
    q('UPDATE chat_members SET hidden = 1 WHERE id = ?', [(int) $member['id']]);
    if (!empty($in['block']) && !val('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?', [$me, $requester])) {
        insert('blocks', ['user_id' => $me, 'blocked_id' => $requester, 'created_at' => time()]);
    }
    emit([$requester], 'chats_changed', ['chat_id' => $chatId]);
    emit([$me], 'chat_removed', ['chat_id' => $chatId]);
    return ['ok' => true];
}

function act_chats_saved(array $in): array
{
    $me = uid();
    $key = 's' . $me;
    $chat = one('SELECT * FROM chats WHERE uniq_key = ?', [$key]);
    if (!$chat) {
        $now = time();
        $id = insert('chats', ['type' => 'saved', 'uniq_key' => $key, 'owner_id' => $me, 'created_at' => $now, 'updated_at' => $now]);
        insert('chat_members', ['chat_id' => $id, 'user_id' => $me, 'role' => 'owner', 'joined_at' => $now]);
        $chat = chat_row($id);
    }
    q('UPDATE chat_members SET hidden = 0 WHERE chat_id = ? AND user_id = ?', [(int) $chat['id'], $me]);
    return ['chat' => chat_for_me((int) $chat['id'])];
}

function act_chats_create_group(array $in): array
{
    $me = current_user();
    $title = str_limit(mb_trim((string) ($in['title'] ?? '')), 128);
    if ($title === '') {
        throw new ApiError('title_required');
    }
    $ids = int_ids($in['member_ids'] ?? []);
    $ids = array_keys(addable_users($ids));
    $now = time();
    $chatId = insert('chats', [
        'type' => 'group',
        'title' => $title,
        'description' => str_limit(mb_trim((string) ($in['description'] ?? '')), 255),
        'owner_id' => (int) $me['id'],
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    insert('chat_members', ['chat_id' => $chatId, 'user_id' => (int) $me['id'], 'role' => 'owner', 'joined_at' => $now]);
    foreach ($ids as $u) {
        if ($u !== (int) $me['id']) {
            insert('chat_members', ['chat_id' => $chatId, 'user_id' => $u, 'joined_at' => $now]);
        }
    }
    system_message(chat_row($chatId), (int) $me['id'], $me['name'] . ' گروه «' . $title . '» را ساخت');
    emit(member_ids($chatId), 'chats_changed', []);
    return ['chat' => chat_for_me($chatId)];
}

/** کاربرانی که طبق تنظیمات حریم خصوصی اجازه افزودنشان به گروه را داریم */
function addable_users(array $ids): array
{
    $out = [];
    foreach (users_by_ids($ids) as $id => $u) {
        if ($id === uid() || privacy_allows($u, uid(), 'groups')) {
            $out[$id] = $u;
        }
    }
    return $out;
}

function act_chats_info(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $chat = chat_row($chatId);
    $out = chat_out($chat, $member);
    $out['members'] = [];
    if ($chat['type'] === 'group') {
        $rows = all('SELECT u.*, cm.role FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? ORDER BY cm.id', [$chatId]);
        foreach ($rows as $r) {
            $out['members'][] = user_out($r) + ['role' => $r['role']];
        }
    }
    $out['media'] = messages_out(all(
        "SELECT * FROM messages m WHERE chat_id = ? AND deleted = 0 AND id > ? AND type IN ('image','video')
         AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ?) ORDER BY id DESC LIMIT 60",
        [$chatId, (int) $member['cleared_id'], uid()]
    ));
    return ['chat' => $out];
}

function act_chats_update(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $chat = chat_row($chatId);
    if ($chat['type'] !== 'group') {
        throw new ApiError('not_group');
    }
    require_admin($chat, $member);
    $title = str_limit(mb_trim((string) ($in['title'] ?? $chat['title'])), 128);
    if ($title === '') {
        throw new ApiError('title_required');
    }
    $desc = str_limit(mb_trim((string) ($in['description'] ?? $chat['description'])), 255);
    q('UPDATE chats SET title = ?, description = ? WHERE id = ?', [$title, $desc, $chatId]);
    if ($title !== $chat['title']) {
        system_message(chat_row($chatId), uid(), current_user()['name'] . ' نام گروه را به «' . $title . '» تغییر داد');
    }
    emit(member_ids($chatId), 'chats_changed', []);
    return ['chat' => chat_for_me($chatId)];
}

function act_chats_avatar(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $chat = chat_row($chatId);
    if ($chat['type'] !== 'group') {
        throw new ApiError('not_group');
    }
    require_admin($chat, $member);
    $path = empty($_FILES['file']) ? '' : store_avatar($_FILES['file'], uid());
    q('UPDATE chats SET avatar = ? WHERE id = ?', [$path, $chatId]);
    emit(member_ids($chatId), 'chats_changed', []);
    return ['chat' => chat_for_me($chatId)];
}

function act_chats_add_members(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    require_member($chatId);
    $chat = chat_row($chatId);
    if ($chat['type'] !== 'group') {
        throw new ApiError('not_group');
    }
    $existing = member_ids($chatId);
    $requested = array_diff(int_ids($in['user_ids'] ?? []), $existing);
    $users = addable_users($requested);
    if (!$users) {
        if ($requested) {
            throw new ApiError('privacy_restricted', 403);
        }
        return ['chat' => chat_for_me($chatId)];
    }
    $now = time();
    foreach ($users as $u) {
        insert('chat_members', ['chat_id' => $chatId, 'user_id' => (int) $u['id'], 'joined_at' => $now]);
    }
    $names = implode('، ', array_column($users, 'name'));
    system_message($chat, uid(), current_user()['name'] . ' ' . $names . ' را به گروه اضافه کرد');
    emit(member_ids($chatId), 'chats_changed', []);
    return ['chat' => chat_for_me($chatId)];
}

function act_chats_remove_member(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $chat = chat_row($chatId);
    require_admin($chat, $member);
    $target = member_row($chatId, (int) ($in['user_id'] ?? 0));
    if (!$target || $chat['type'] !== 'group') {
        throw new ApiError('not_member');
    }
    if ($target['role'] === 'owner' || ($target['role'] === 'admin' && $member['role'] !== 'owner')) {
        throw new ApiError('forbidden', 403);
    }
    q('DELETE FROM chat_members WHERE id = ?', [(int) $target['id']]);
    $tu = one('SELECT name FROM users WHERE id = ?', [(int) $target['user_id']]);
    emit([(int) $target['user_id']], 'chat_removed', ['chat_id' => $chatId]);
    system_message($chat, uid(), current_user()['name'] . ' ' . ($tu['name'] ?? '') . ' را از گروه حذف کرد');
    emit(member_ids($chatId), 'chats_changed', []);
    return ['chat' => chat_for_me($chatId)];
}

function act_chats_set_role(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    if ($member['role'] !== 'owner') {
        throw new ApiError('owner_required', 403);
    }
    $role = ($in['role'] ?? '') === 'admin' ? 'admin' : 'member';
    $target = member_row($chatId, (int) ($in['user_id'] ?? 0));
    if (!$target || $target['role'] === 'owner') {
        throw new ApiError('forbidden', 403);
    }
    q('UPDATE chat_members SET role = ? WHERE id = ?', [$role, (int) $target['id']]);
    emit(member_ids($chatId), 'chats_changed', []);
    return ['ok' => true];
}

function act_chats_leave(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $chat = chat_row($chatId);
    if ($chat['type'] !== 'group') {
        throw new ApiError('not_group');
    }
    q('DELETE FROM chat_members WHERE id = ?', [(int) $member['id']]);
    if ($member['role'] === 'owner') {
        $next = one("SELECT * FROM chat_members WHERE chat_id = ? ORDER BY (role = 'admin') DESC, id LIMIT 1", [$chatId]);
        if ($next) {
            q("UPDATE chat_members SET role = 'owner' WHERE id = ?", [(int) $next['id']]);
            q('UPDATE chats SET owner_id = ? WHERE id = ?', [(int) $next['user_id'], $chatId]);
        }
    }
    emit([uid()], 'chat_removed', ['chat_id' => $chatId]);
    if (member_ids($chatId)) {
        system_message($chat, uid(), current_user()['name'] . ' گروه را ترک کرد');
        emit(member_ids($chatId), 'chats_changed', []);
    }
    return ['ok' => true];
}

function act_chats_set(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    if (isset($in['muted'])) {
        q('UPDATE chat_members SET muted = ? WHERE id = ?', [$in['muted'] ? 1 : 0, (int) $member['id']]);
    }
    if (isset($in['pinned'])) {
        q('UPDATE chat_members SET pinned = ? WHERE id = ?', [$in['pinned'] ? 1 : 0, (int) $member['id']]);
    }
    emit([uid()], 'chats_changed', []);
    return ['chat' => chat_for_me($chatId)];
}

function act_chats_clear(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $chat = chat_row($chatId);
    $forAll = !empty($in['for_all']) && $chat['type'] === 'private';
    $last = (int) val('SELECT MAX(id) FROM messages WHERE chat_id = ?', [$chatId]);
    if ($forAll) {
        q('UPDATE chat_members SET cleared_id = ? WHERE chat_id = ?', [$last, $chatId]);
        emit(member_ids($chatId), 'chat_cleared', ['chat_id' => $chatId]);
    } else {
        q('UPDATE chat_members SET cleared_id = ? WHERE id = ?', [$last, (int) $member['id']]);
        emit([uid()], 'chat_cleared', ['chat_id' => $chatId]);
    }
    if (!empty($in['hide'])) {
        q('UPDATE chat_members SET hidden = 1 WHERE id = ?', [(int) $member['id']]);
        emit([uid()], 'chat_removed', ['chat_id' => $chatId]);
    }
    return ['ok' => true];
}

function act_chats_delete_group(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    if ($member['role'] !== 'owner') {
        throw new ApiError('owner_required', 403);
    }
    $ids = member_ids($chatId);
    q('DELETE FROM chat_members WHERE chat_id = ?', [$chatId]);
    q('UPDATE messages SET deleted = 1 WHERE chat_id = ?', [$chatId]);
    emit($ids, 'chat_removed', ['chat_id' => $chatId]);
    return ['ok' => true];
}

/* ============================== پیام‌ها ============================== */

function act_messages_list(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $limit = max(1, min(100, (int) ($in['limit'] ?? 40)));
    $base = 'SELECT * FROM messages m WHERE m.chat_id = ? AND m.deleted = 0 AND m.id > ?
              AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ?)';
    $p = [$chatId, (int) $member['cleared_id'], uid()];
    $hasMoreAfter = false;
    if (!empty($in['around_id'])) {
        $a = (int) $in['around_id'];
        $older = all("$base AND m.id <= ? ORDER BY m.id DESC LIMIT " . (int) ($limit / 2), array_merge($p, [$a]));
        $newer = all("$base AND m.id > ? ORDER BY m.id ASC LIMIT " . ((int) ($limit / 2) + 1), array_merge($p, [$a]));
        $hasMoreAfter = count($newer) > (int) ($limit / 2);
        if ($hasMoreAfter) {
            array_pop($newer);
        }
        $rows = array_merge(array_reverse($older), $newer);
        $hasMore = count($older) >= (int) ($limit / 2);
    } elseif (!empty($in['after_id'])) {
        $rows = all("$base AND m.id > ? ORDER BY m.id ASC LIMIT " . ($limit + 1), array_merge($p, [(int) $in['after_id']]));
        $hasMoreAfter = count($rows) > $limit;
        if ($hasMoreAfter) {
            array_pop($rows);
        }
        $hasMore = true;
    } else {
        $sql = $base . (!empty($in['before_id']) ? ' AND m.id < ?' : '') . ' ORDER BY m.id DESC LIMIT ' . ($limit + 1);
        if (!empty($in['before_id'])) {
            $p[] = (int) $in['before_id'];
        }
        $rows = all($sql, $p);
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }
        $rows = array_reverse($rows);
    }
    return ['messages' => messages_out($rows), 'has_more' => $hasMore, 'has_more_after' => $hasMoreAfter];
}

function act_messages_send(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    require_member($chatId);
    $chat = chat_row($chatId);
    assert_not_blocked($chat);
    $body = str_limit(mb_trim((string) ($in['body'] ?? '')), 4096);
    $type = 'text';
    $fileId = (int) ($in['file_id'] ?? 0);
    if ($fileId) {
        $f = one('SELECT * FROM files WHERE id = ? AND user_id = ?', [$fileId, uid()]);
        if (!$f) {
            throw new ApiError('file_not_found', 404);
        }
        $kind = (string) ($in['kind'] ?? '');
        if ($kind === 'voice') {
            $type = 'voice';
        } elseif ($kind !== 'file' && str_starts_with($f['mime'], 'image/') && !in_array($f['mime'], ['image/svg+xml', 'image/heic', 'image/heif'], true)) {
            $type = 'image';
        } elseif ($kind !== 'file' && str_starts_with($f['mime'], 'video/')) {
            $type = 'video';
        } elseif ($kind !== 'file' && str_starts_with($f['mime'], 'audio/')) {
            $type = 'audio';
        } else {
            $type = 'file';
        }
    } elseif ($body === '') {
        throw new ApiError('empty_message');
    }
    $replyTo = (int) ($in['reply_to_id'] ?? 0);
    if ($replyTo && !val('SELECT id FROM messages WHERE id = ? AND chat_id = ?', [$replyTo, $chatId])) {
        $replyTo = 0;
    }
    $msg = create_message($chat, uid(), [
        'type' => $type, 'body' => $body, 'file_id' => $fileId, 'reply_to_id' => $replyTo,
        'client_id' => (string) ($in['client_id'] ?? ''),
    ]);
    return ['message' => $msg];
}

/** در چت خصوصی اگر یکی دیگری را بلاک کرده باشد یا درخواست گفتگو پذیرفته نشده باشد ارسال ممکن نیست */
function assert_not_blocked(array $chat): void
{
    if ($chat['type'] !== 'private') {
        return;
    }
    $me = uid();
    $accepted = (int) ($chat['accepted'] ?? 1);
    if ($accepted !== 1) {
        if ((int) $chat['requested_by'] !== $me) {
            throw new ApiError('request_not_accepted', 403);
        }
        if ($accepted === -1) {
            throw new ApiError('request_declined', 403);
        }
        if (val('SELECT COUNT(*) FROM messages WHERE chat_id = ? AND user_id = ? AND deleted = 0', [(int) $chat['id'], $me])) {
            throw new ApiError('request_pending', 403);
        }
    }
    foreach (member_ids((int) $chat['id']) as $peer) {
        if ($peer === $me) {
            continue;
        }
        if (relation($me, $peer)['blocked']) {
            throw new ApiError('you_blocked_user', 403);
        }
        if (relation($peer, $me)['blocked']) {
            throw new ApiError('user_blocked_you', 403);
        }
    }
}

function own_message(int $id): array
{
    $m = one('SELECT * FROM messages WHERE id = ? AND deleted = 0', [$id]);
    if (!$m) {
        throw new ApiError('message_not_found', 404);
    }
    require_member((int) $m['chat_id']);
    return $m;
}

function act_messages_edit(array $in): array
{
    $m = own_message((int) ($in['message_id'] ?? 0));
    if ((int) $m['user_id'] !== uid() || $m['type'] === 'system' || $m['fwd_name'] !== '') {
        throw new ApiError('forbidden', 403);
    }
    $body = str_limit(mb_trim((string) ($in['body'] ?? '')), 4096);
    if ($body === '' && $m['type'] === 'text') {
        throw new ApiError('empty_message');
    }
    q('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', [$body, time(), (int) $m['id']]);
    $msg = message_out_by_id((int) $m['id']);
    emit(member_ids((int) $m['chat_id']), 'message_edit', $msg);
    return ['message' => $msg];
}

function act_messages_delete(array $in): array
{
    $ids = int_ids($in['message_ids'] ?? []);
    $forAll = !empty($in['for_all']);
    $me = uid();
    $byChat = [];
    foreach ($ids as $id) {
        $m = one('SELECT * FROM messages WHERE id = ? AND deleted = 0', [$id]);
        if (!$m) {
            continue;
        }
        $chatId = (int) $m['chat_id'];
        $member = member_row($chatId, $me);
        if (!$member) {
            continue;
        }
        $chat = chat_row($chatId);
        $canAll = (int) $m['user_id'] === $me || $chat['type'] === 'private'
            || ($chat['type'] === 'group' && in_array($member['role'], ['owner', 'admin'], true));
        if ($forAll && $canAll) {
            q('UPDATE messages SET deleted = 1, body = ? WHERE id = ?', ['', $id]);
            q('DELETE FROM reactions WHERE message_id = ?', [$id]);
            $byChat[$chatId]['all'][] = $id;
        } else {
            if (!val('SELECT 1 FROM message_hidden WHERE message_id = ? AND user_id = ?', [$id, $me])) {
                insert('message_hidden', ['message_id' => $id, 'user_id' => $me]);
            }
            $byChat[$chatId]['me'][] = $id;
        }
    }
    foreach ($byChat as $chatId => $g) {
        if (!empty($g['all'])) {
            if (in_array((int) val('SELECT pinned_message_id FROM chats WHERE id = ?', [$chatId]), $g['all'], true)) {
                q('UPDATE chats SET pinned_message_id = 0 WHERE id = ?', [$chatId]);
            }
            emit(member_ids($chatId), 'message_delete', ['chat_id' => $chatId, 'ids' => $g['all']]);
        }
        if (!empty($g['me'])) {
            emit([$me], 'message_delete', ['chat_id' => $chatId, 'ids' => $g['me']]);
        }
    }
    return ['ok' => true];
}

function act_messages_forward(array $in): array
{
    $ids = int_ids($in['message_ids'] ?? []);
    sort($ids);
    $targets = int_ids($in['to_chat_ids'] ?? ($in['to_chat_id'] ?? []));
    $me = uid();
    $sources = [];
    foreach ($ids as $id) {
        $m = one('SELECT * FROM messages WHERE id = ? AND deleted = 0', [$id]);
        if ($m && $m['type'] !== 'system' && member_row((int) $m['chat_id'], $me)) {
            $sources[] = $m;
        }
    }
    $sent = [];
    foreach ($targets as $chatId) {
        require_member($chatId);
        $chat = chat_row($chatId);
        assert_not_blocked($chat);
        foreach ($sources as $m) {
            $fwd = $m['fwd_name'];
            if ($fwd === '' && (int) $m['user_id'] !== $me) {
                $fwd = (string) val('SELECT name FROM users WHERE id = ?', [(int) $m['user_id']]);
            } elseif ($fwd === '') {
                $fwd = current_user()['name'];
            }
            $sent[] = create_message($chat, $me, ['type' => $m['type'], 'body' => $m['body'], 'file_id' => (int) $m['file_id'], 'fwd_name' => $fwd]);
        }
    }
    return ['messages' => $sent];
}

function act_messages_react(array $in): array
{
    $m = own_message((int) ($in['message_id'] ?? 0));
    $emoji = (string) ($in['emoji'] ?? '');
    $me = uid();
    $cur = val('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?', [(int) $m['id'], $me]);
    q('DELETE FROM reactions WHERE message_id = ? AND user_id = ?', [(int) $m['id'], $me]);
    if ($emoji !== '' && $emoji !== $cur) {
        if (!in_array($emoji, REACTIONS, true)) {
            throw new ApiError('invalid_reaction');
        }
        insert('reactions', ['message_id' => (int) $m['id'], 'user_id' => $me, 'emoji' => $emoji, 'created_at' => time()]);
    }
    $msg = message_out_by_id((int) $m['id']);
    emit(member_ids((int) $m['chat_id']), 'message_edit', $msg);
    return ['message' => $msg];
}

function act_messages_pin(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $chat = chat_row($chatId);
    require_admin($chat, $member);
    $mid = (int) ($in['message_id'] ?? 0);
    if ($mid && !val('SELECT id FROM messages WHERE id = ? AND chat_id = ? AND deleted = 0', [$mid, $chatId])) {
        throw new ApiError('message_not_found', 404);
    }
    q('UPDATE chats SET pinned_message_id = ? WHERE id = ?', [$mid, $chatId]);
    if ($mid) {
        $pm = one('SELECT * FROM messages WHERE id = ?', [$mid]);
        system_message($chat, uid(), current_user()['name'] . ' پیامی را سنجاق کرد: «' . str_limit(message_preview($pm), 40) . '»');
    }
    emit(member_ids($chatId), 'chats_changed', ['chat_id' => $chatId]);
    return ['chat' => chat_for_me($chatId)];
}

function act_messages_read(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    $member = require_member($chatId);
    $last = min((int) ($in['last_id'] ?? 0), (int) val('SELECT MAX(id) FROM messages WHERE chat_id = ?', [$chatId]));
    if ($last > (int) $member['last_read_id']) {
        q('UPDATE chat_members SET last_read_id = ? WHERE id = ?', [$last, (int) $member['id']]);
        emit(member_ids($chatId), 'read', ['chat_id' => $chatId, 'user_id' => uid(), 'last_read_id' => $last]);
    }
    return ['ok' => true];
}

function act_messages_typing(array $in): array
{
    $chatId = (int) ($in['chat_id'] ?? 0);
    require_member($chatId);
    $others = array_values(array_filter(member_ids($chatId), fn($u) => $u !== uid()));
    emit($others, 'typing', [
        'chat_id' => $chatId,
        'user_id' => uid(),
        'name' => current_user()['name'],
        'kind' => ($in['kind'] ?? '') === 'voice' ? 'voice' : (($in['kind'] ?? '') === 'file' ? 'file' : 'text'),
    ]);
    return ['ok' => true];
}

function act_messages_search(array $in): array
{
    $qs = mb_trim((string) ($in['q'] ?? ''));
    if (mb_strlen($qs) < 2) {
        return ['messages' => []];
    }
    $like = like_pattern($qs);
    $me = uid();
    $sql = "SELECT m.* FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
            WHERE m.deleted = 0 AND m.id > cm.cleared_id AND m.type <> 'system' AND m.body LIKE ? ESCAPE '!'
            AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ?)";
    $p = [$me, $like, $me];
    if (!empty($in['chat_id'])) {
        $sql .= ' AND m.chat_id = ?';
        $p[] = (int) $in['chat_id'];
    }
    $rows = all($sql . ' ORDER BY m.id DESC LIMIT 50', $p);
    return ['messages' => messages_out($rows)];
}

/* ============================== آپلود ============================== */

function act_files_upload(array $in): array
{
    if (empty($_FILES['file'])) {
        throw new ApiError('no_file');
    }
    $row = store_upload($_FILES['file'], uid(), $_POST);
    return ['file' => file_out($row)];
}

/* ============================== رویدادها (Long Polling) ============================== */

function act_poll(array $in): array
{
    $u = current_user();
    $me = (int) $u['id'];
    $now = time();
    $visible = !empty($in['visible']);
    q('UPDATE users SET last_seen = ?' . ($visible ? ', visible_at = ?' : '') . ' WHERE id = ?', $visible ? [$now, $now, $me] : [$now, $me]);

    if (mt_rand(1, 50) === 1) {
        q('DELETE FROM events WHERE created_at < ?', [$now - 3 * 86400]);
    }

    $last = (int) ($in['last_id'] ?? -1);
    $maxId = (int) val('SELECT MAX(id) FROM events WHERE user_id = ?', [$me]);
    if ($last < 0 || $last > $maxId) {
        return ['last_id' => $maxId, 'events' => [], 'presence' => presence($in), 'reset' => true];
    }

    $timeout = max(0, min(50, (int) ($in['wait'] ?? config('poll_timeout'))));
    $start = microtime(true);
    $events = [];
    while (true) {
        $events = all('SELECT id, type, data FROM events WHERE user_id = ? AND id > ? ORDER BY id LIMIT 300', [$me, $last]);
        if ($events || microtime(true) - $start >= $timeout || connection_aborted()) {
            break;
        }
        usleep(900000);
        // اتصال کاربر به‌روز نگه داشته می‌شود تا وضعیت «آنلاین» قطع نشود
        if (time() - $now >= 15) {
            $now = time();
            q('UPDATE users SET last_seen = ?' . ($visible ? ', visible_at = ?' : '') . ' WHERE id = ?', $visible ? [$now, $now, $me] : [$now, $me]);
        }
    }
    $out = [];
    foreach ($events as $e) {
        $out[] = ['id' => (int) $e['id'], 'type' => $e['type'], 'data' => json_decode($e['data'], true)];
        $last = (int) $e['id'];
    }
    return ['last_id' => $last, 'events' => $out, 'presence' => presence($in)];
}

function presence(array $in): array
{
    $ids = array_slice(int_ids($in['watch'] ?? []), 0, 100);
    $out = [];
    if ($ids) {
        $viewer = uid();
        foreach (all('SELECT id, last_seen, privacy FROM users WHERE id IN (' . in_list($ids) . ')', $ids) as $r) {
            $out[(string) $r['id']] = seen_value($r, $viewer);
        }
    }
    return ['now' => time(), 'users' => (object) $out];
}

/* ============================== نوتیفیکیشن ============================== */

function act_push_subscribe(array $in): array
{
    $endpoint = (string) ($in['endpoint'] ?? '');
    $p256 = (string) ($in['keys']['p256dh'] ?? '');
    $auth = (string) ($in['keys']['auth'] ?? '');
    if (!preg_match('#^https://#', $endpoint) || strlen(b64u_dec($p256)) !== 65 || strlen(b64u_dec($auth)) < 16) {
        throw new ApiError('invalid_subscription');
    }
    $hash = hash('sha256', $endpoint);
    q('DELETE FROM push_subs WHERE endpoint_hash = ?', [$hash]);
    insert('push_subs', [
        'user_id' => uid(),
        'endpoint' => $endpoint,
        'endpoint_hash' => $hash,
        'p256dh' => $p256,
        'auth' => $auth,
        'created_at' => time(),
    ]);
    return ['ok' => true];
}

function act_push_unsubscribe(array $in): array
{
    q('DELETE FROM push_subs WHERE endpoint_hash = ? AND user_id = ?', [hash('sha256', (string) ($in['endpoint'] ?? '')), uid()]);
    return ['ok' => true];
}

function act_push_test(array $in): array
{
    $me = uid();
    defer(function () use ($me) {
        $subs = all('SELECT * FROM push_subs WHERE user_id = ?', [$me]);
        $items = [];
        foreach ($subs as $s) {
            $items[] = [
                'id' => (int) $s['id'], 'endpoint' => $s['endpoint'], 'p256dh' => $s['p256dh'], 'auth' => $s['auth'],
                'payload' => json_encode(['title' => config('app_name'), 'body' => 'اعلان‌ها با موفقیت فعال شد ✅', 'tag' => 'test'], JSON_UNESCAPED_UNICODE),
            ];
        }
        $expired = int_ids(webpush_send_many($items, config('vapid')));
        if ($expired) {
            q('DELETE FROM push_subs WHERE id IN (' . in_list($expired) . ')', $expired);
        }
    });
    return ['ok' => true, 'devices' => (int) val('SELECT COUNT(*) FROM push_subs WHERE user_id = ?', [$me])];
}

/* ============================== حریم خصوصی و امنیت ============================== */

function act_privacy_get(array $in): array
{
    $me = current_user();
    $blocked = all('SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC', [(int) $me['id']]);
    return [
        'privacy' => privacy_of($me),
        'blocked' => array_map(fn($u) => user_out($u), $blocked),
        'sessions' => (int) val('SELECT COUNT(*) FROM tokens WHERE user_id = ?', [(int) $me['id']]),
    ];
}

function act_privacy_set(array $in): array
{
    $me = current_user();
    $p = privacy_of($me);
    foreach (PRIVACY_DEFAULTS as $k => $_) {
        if (isset($in[$k])) {
            $allowed = $k === 'groups' ? ['all', 'contacts'] : ['all', 'contacts', 'nobody'];
            if (!in_array($in[$k], $allowed, true)) {
                throw new ApiError('invalid_value');
            }
            $p[$k] = $in[$k];
        }
    }
    q('UPDATE users SET privacy = ? WHERE id = ?', [json_encode($p), (int) $me['id']]);
    notify_contacts((int) $me['id']);
    return ['privacy' => $p];
}

function act_blocks_add(array $in): array
{
    $id = (int) ($in['user_id'] ?? 0);
    if ($id === uid() || !val('SELECT id FROM users WHERE id = ?', [$id])) {
        throw new ApiError('user_not_found', 404);
    }
    if (!val('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?', [uid(), $id])) {
        insert('blocks', ['user_id' => uid(), 'blocked_id' => $id, 'created_at' => time()]);
    }
    emit([uid(), $id], 'chats_changed', []);
    return ['ok' => true];
}

function act_blocks_remove(array $in): array
{
    $id = (int) ($in['user_id'] ?? 0);
    q('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?', [uid(), $id]);
    emit([uid(), $id], 'chats_changed', []);
    return ['ok' => true];
}

function act_contacts_list(array $in): array
{
    $rows = all('SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id WHERE c.user_id = ? ORDER BY u.name', [uid()]);
    return ['users' => array_map(fn($u) => user_out($u, true), $rows)];
}

function act_contacts_add(array $in): array
{
    $id = (int) ($in['user_id'] ?? 0);
    if ($id === uid() || !val('SELECT id FROM users WHERE id = ?', [$id])) {
        throw new ApiError('user_not_found', 404);
    }
    if (!val('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?', [uid(), $id])) {
        insert('contacts', ['user_id' => uid(), 'contact_id' => $id, 'created_at' => time()]);
    }
    emit([$id], 'chats_changed', []);
    return ['ok' => true];
}

function act_contacts_remove(array $in): array
{
    $id = (int) ($in['user_id'] ?? 0);
    q('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?', [uid(), $id]);
    emit([$id], 'chats_changed', []);
    return ['ok' => true];
}

function act_sessions_list(array $in): array
{
    $me = current_user();
    $rows = all('SELECT id, device, created_at, last_used FROM tokens WHERE user_id = ? ORDER BY last_used DESC', [(int) $me['id']]);
    return ['sessions' => array_map(fn($r) => [
        'id' => (int) $r['id'],
        'device' => $r['device'],
        'created_at' => (int) $r['created_at'],
        'last_used' => (int) $r['last_used'],
        'current' => (int) $r['id'] === (int) $me['token_id'],
    ], $rows)];
}

function act_sessions_terminate(array $in): array
{
    $me = current_user();
    if (!empty($in['all_others'])) {
        q('DELETE FROM tokens WHERE user_id = ? AND id <> ?', [(int) $me['id'], (int) $me['token_id']]);
    } else {
        q('DELETE FROM tokens WHERE user_id = ? AND id = ? AND id <> ?', [(int) $me['id'], (int) ($in['id'] ?? 0), (int) $me['token_id']]);
    }
    return ['ok' => true];
}

function act_me_delete(array $in): array
{
    $me = current_user();
    if (!password_verify((string) ($in['password'] ?? ''), $me['password_hash'])) {
        throw new ApiError('invalid_password');
    }
    delete_user((int) $me['id']);
    return ['ok' => true];
}

/** حذف کامل یک کاربر (پیام‌هایش با نام «کاربر حذف شده» باقی می‌مانند) */
function delete_user(int $id): void
{
    $groups = array_map('intval', array_column(all("SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id WHERE cm.user_id = ? AND c.type = 'group'", [$id]), 'id'));
    foreach ($groups as $g) {
        $member = member_row($g, $id);
        if (!$member) {
            continue;
        }
        q('DELETE FROM chat_members WHERE id = ?', [(int) $member['id']]);
        if ($member['role'] === 'owner') {
            $next = one("SELECT * FROM chat_members WHERE chat_id = ? ORDER BY (role = 'admin') DESC, id LIMIT 1", [$g]);
            if ($next) {
                q("UPDATE chat_members SET role = 'owner' WHERE id = ?", [(int) $next['id']]);
                q('UPDATE chats SET owner_id = ? WHERE id = ?', [(int) $next['user_id'], $g]);
            }
        }
        emit(member_ids($g), 'chats_changed', []);
    }
    notify_contacts($id);
    foreach (['tokens', 'push_subs', 'contacts', 'blocks', 'reactions'] as $t) {
        q("DELETE FROM $t WHERE user_id = ?", [$id]);
    }
    q('DELETE FROM contacts WHERE contact_id = ?', [$id]);
    q('DELETE FROM blocks WHERE blocked_id = ?', [$id]);
    q('DELETE FROM chat_members WHERE user_id = ?', [$id]);
    q('DELETE FROM users WHERE id = ?', [$id]);
}
