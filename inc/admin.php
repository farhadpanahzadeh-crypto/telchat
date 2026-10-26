<?php
/** اکشن‌های پنل مدیریت — فقط برای کاربرانی که is_admin دارند */

function require_admin_user(): array
{
    $u = current_user();
    if (!(int) $u['is_admin']) {
        throw new ApiError('admin_only', 403);
    }
    return $u;
}

function admin_user_out(array $u): array
{
    return [
        'id' => (int) $u['id'],
        'username' => $u['username'],
        'name' => $u['name'],
        'avatar' => $u['avatar'],
        'bio' => $u['bio'],
        'last_seen' => (int) $u['last_seen'],
        'created_at' => (int) $u['created_at'],
        'is_admin' => (bool) (int) $u['is_admin'],
        'banned' => (bool) (int) $u['banned'],
        'messages' => (int) val('SELECT COUNT(*) FROM messages WHERE user_id = ? AND deleted = 0', [(int) $u['id']]),
        'sessions' => (int) val('SELECT COUNT(*) FROM tokens WHERE user_id = ?', [(int) $u['id']]),
    ];
}

function act_admin_stats(array $in): array
{
    require_admin_user();
    $now = time();
    $today = strtotime('today');
    $dir = UPLOAD_DIR;
    $free = @disk_free_space($dir);
    $days = [];
    for ($i = 13; $i >= 0; $i--) {
        $from = $today - $i * 86400;
        $days[] = [
            'day' => $from,
            'messages' => (int) val("SELECT COUNT(*) FROM messages WHERE created_at >= ? AND created_at < ? AND type <> 'system'", [$from, $from + 86400]),
        ];
    }
    return [
        'users' => (int) val('SELECT COUNT(*) FROM users'),
        'online' => (int) val('SELECT COUNT(*) FROM users WHERE last_seen > ?', [$now - 45]),
        'active_today' => (int) val('SELECT COUNT(*) FROM users WHERE last_seen >= ?', [$today]),
        'new_today' => (int) val('SELECT COUNT(*) FROM users WHERE created_at >= ?', [$today]),
        'banned' => (int) val('SELECT COUNT(*) FROM users WHERE banned = 1'),
        'messages' => (int) val("SELECT COUNT(*) FROM messages WHERE deleted = 0 AND type <> 'system'"),
        'messages_today' => (int) val("SELECT COUNT(*) FROM messages WHERE created_at >= ? AND type <> 'system'", [$today]),
        'groups' => (int) val("SELECT COUNT(*) FROM chats WHERE type = 'group'"),
        'private_chats' => (int) val("SELECT COUNT(*) FROM chats WHERE type = 'private'"),
        'files' => (int) val('SELECT COUNT(*) FROM files'),
        'files_size' => (int) val('SELECT COALESCE(SUM(size), 0) FROM files'),
        'disk_free' => $free === false ? null : (int) $free,
        'php' => PHP_VERSION,
        'db' => config('db')['driver'] ?? 'mysql',
        'https' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https',
        'daily' => $days,
    ];
}

function act_admin_users(array $in): array
{
    require_admin_user();
    $q = mb_trim(ltrim((string) ($in['q'] ?? ''), '@'));
    $page = max(1, (int) ($in['page'] ?? 1));
    $per = 30;
    $where = '1 = 1';
    $p = [];
    if ($q !== '') {
        $where = "(username LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!')";
        $p = [strtolower(like_pattern($q)), like_pattern($q)];
    }
    if (($in['filter'] ?? '') === 'banned') {
        $where .= ' AND banned = 1';
    } elseif (($in['filter'] ?? '') === 'admins') {
        $where .= ' AND is_admin = 1';
    } elseif (($in['filter'] ?? '') === 'online') {
        $where .= ' AND last_seen > ' . (time() - 45);
    }
    $total = (int) val("SELECT COUNT(*) FROM users WHERE $where", $p);
    $order = ($in['sort'] ?? '') === 'seen' ? 'last_seen DESC' : 'id DESC';
    $rows = all("SELECT * FROM users WHERE $where ORDER BY $order LIMIT $per OFFSET " . (($page - 1) * $per), $p);
    return ['users' => array_map('admin_user_out', $rows), 'total' => $total, 'pages' => max(1, (int) ceil($total / $per))];
}

function act_admin_user_update(array $in): array
{
    $admin = require_admin_user();
    $id = (int) ($in['id'] ?? 0);
    $u = one('SELECT * FROM users WHERE id = ?', [$id]);
    if (!$u) {
        throw new ApiError('user_not_found', 404);
    }
    $self = $id === (int) $admin['id'];
    $set = [];
    if (isset($in['name'])) {
        $name = str_limit(mb_trim((string) $in['name']), 64);
        if ($name === '') {
            throw new ApiError('name_required');
        }
        $set['name'] = $name;
    }
    if (isset($in['username'])) {
        $un = validate_username((string) $in['username']);
        if ($un !== $u['username'] && val('SELECT id FROM users WHERE username = ?', [$un])) {
            throw new ApiError('username_taken');
        }
        $set['username'] = $un;
    }
    if (isset($in['bio'])) {
        $set['bio'] = str_limit(mb_trim((string) $in['bio']), 255);
    }
    if (!empty($in['password'])) {
        if (strlen((string) $in['password']) < 6) {
            throw new ApiError('password_too_short');
        }
        $set['password_hash'] = password_hash((string) $in['password'], PASSWORD_DEFAULT);
    }
    if (isset($in['is_admin']) && !$self) {
        $set['is_admin'] = $in['is_admin'] ? 1 : 0;
    }
    if (isset($in['banned']) && !$self) {
        $set['banned'] = $in['banned'] ? 1 : 0;
    }
    if (isset($in['remove_avatar']) && $in['remove_avatar']) {
        $set['avatar'] = '';
    }
    if ($set) {
        q('UPDATE users SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($set))) . ' WHERE id = ?', array_merge(array_values($set), [$id]));
    }
    if (!empty($set['banned']) || (!empty($in['password']) && !$self)) {
        q('DELETE FROM tokens WHERE user_id = ?', [$id]);
        q('DELETE FROM push_subs WHERE user_id = ?', [$id]);
    }
    notify_contacts($id);
    return ['user' => admin_user_out(one('SELECT * FROM users WHERE id = ?', [$id]))];
}

function act_admin_user_create(array $in): array
{
    require_admin_user();
    $username = validate_username((string) ($in['username'] ?? ''));
    $name = str_limit(mb_trim((string) ($in['name'] ?? '')), 64);
    if ($name === '') {
        throw new ApiError('name_required');
    }
    if (strlen((string) ($in['password'] ?? '')) < 6) {
        throw new ApiError('password_too_short');
    }
    if (val('SELECT id FROM users WHERE username = ?', [$username])) {
        throw new ApiError('username_taken');
    }
    $id = insert('users', [
        'username' => $username,
        'name' => $name,
        'password_hash' => password_hash((string) $in['password'], PASSWORD_DEFAULT),
        'is_admin' => !empty($in['is_admin']) ? 1 : 0,
        'created_at' => time(),
    ]);
    return ['user' => admin_user_out(one('SELECT * FROM users WHERE id = ?', [$id]))];
}

function act_admin_user_logout(array $in): array
{
    $admin = require_admin_user();
    $id = (int) ($in['id'] ?? 0);
    q('DELETE FROM tokens WHERE user_id = ? AND id <> ?', [$id, (int) $admin['token_id']]);
    return ['ok' => true];
}

function act_admin_user_delete(array $in): array
{
    $admin = require_admin_user();
    $id = (int) ($in['id'] ?? 0);
    if ($id === (int) $admin['id']) {
        throw new ApiError('cannot_delete_self');
    }
    if (!val('SELECT id FROM users WHERE id = ?', [$id])) {
        throw new ApiError('user_not_found', 404);
    }
    if (!empty($in['delete_messages'])) {
        $chats = array_map('intval', array_column(all('SELECT DISTINCT chat_id FROM messages WHERE user_id = ? AND deleted = 0', [$id]), 'chat_id'));
        q("UPDATE messages SET deleted = 1, body = '' WHERE user_id = ?", [$id]);
        foreach ($chats as $c) {
            emit(member_ids($c), 'chat_cleared', ['chat_id' => $c]);
        }
    }
    delete_user($id);
    return ['ok' => true];
}

function act_admin_groups(array $in): array
{
    require_admin_user();
    $q = mb_trim((string) ($in['q'] ?? ''));
    $page = max(1, (int) ($in['page'] ?? 1));
    $per = 30;
    $where = "c.type = 'group'";
    $p = [];
    if ($q !== '') {
        $where .= " AND c.title LIKE ? ESCAPE '!'";
        $p[] = like_pattern($q);
    }
    $total = (int) val("SELECT COUNT(*) FROM chats c WHERE $where", $p);
    $rows = all("SELECT c.*, u.name AS owner_name FROM chats c LEFT JOIN users u ON u.id = c.owner_id WHERE $where ORDER BY c.updated_at DESC LIMIT $per OFFSET " . (($page - 1) * $per), $p);
    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'id' => (int) $r['id'],
            'title' => $r['title'],
            'description' => $r['description'],
            'avatar' => $r['avatar'],
            'owner' => $r['owner_name'] ?? '',
            'members' => (int) val('SELECT COUNT(*) FROM chat_members WHERE chat_id = ?', [(int) $r['id']]),
            'messages' => (int) val("SELECT COUNT(*) FROM messages WHERE chat_id = ? AND deleted = 0 AND type <> 'system'", [(int) $r['id']]),
            'created_at' => (int) $r['created_at'],
            'updated_at' => (int) $r['updated_at'],
        ];
    }
    return ['groups' => $out, 'total' => $total, 'pages' => max(1, (int) ceil($total / $per))];
}

function act_admin_group_members(array $in): array
{
    require_admin_user();
    $rows = all('SELECT u.*, cm.role FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? ORDER BY cm.id', [(int) ($in['id'] ?? 0)]);
    return ['members' => array_map(fn($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'username' => $r['username'], 'avatar' => $r['avatar'], 'role' => $r['role']], $rows)];
}

function act_admin_group_delete(array $in): array
{
    require_admin_user();
    $id = (int) ($in['id'] ?? 0);
    $chat = one("SELECT * FROM chats WHERE id = ? AND type = 'group'", [$id]);
    if (!$chat) {
        throw new ApiError('chat_not_found', 404);
    }
    $ids = member_ids($id);
    q('DELETE FROM chat_members WHERE chat_id = ?', [$id]);
    q('UPDATE messages SET deleted = 1 WHERE chat_id = ?', [$id]);
    emit($ids, 'chat_removed', ['chat_id' => $id]);
    return ['ok' => true];
}

/** ارسال اطلاعیه از طرف مدیر به همه کاربران (در گفتگوی خصوصی) */
function act_admin_broadcast(array $in): array
{
    $admin = require_admin_user();
    $text = str_limit(mb_trim((string) ($in['text'] ?? '')), 4096);
    if ($text === '') {
        throw new ApiError('empty_message');
    }
    $me = (int) $admin['id'];
    $users = array_map('intval', array_column(all('SELECT id FROM users WHERE id <> ? AND banned = 0', [$me]), 'id'));
    $now = time();
    foreach ($users as $u) {
        $key = 'p' . min($me, $u) . '_' . max($me, $u);
        $chat = one('SELECT * FROM chats WHERE uniq_key = ?', [$key]);
        if (!$chat) {
            $cid = insert('chats', ['type' => 'private', 'uniq_key' => $key, 'created_at' => $now, 'updated_at' => $now]);
            insert('chat_members', ['chat_id' => $cid, 'user_id' => $me, 'joined_at' => $now]);
            insert('chat_members', ['chat_id' => $cid, 'user_id' => $u, 'joined_at' => $now]);
            $chat = chat_row($cid);
        }
        create_message($chat, $me, ['type' => 'text', 'body' => $text]);
    }
    return ['sent' => count($users)];
}

const EDITABLE_SETTINGS = ['app_name', 'allow_registration', 'register_code', 'max_upload_mb', 'poll_timeout'];

function act_admin_settings_get(array $in): array
{
    require_admin_user();
    $out = [];
    foreach (EDITABLE_SETTINGS as $k) {
        $out[$k] = config($k);
    }
    $out['config_writable'] = is_writable(APP_ROOT . '/inc/config.php');
    $out['upload_limit'] = ini_get('upload_max_filesize') . ' / ' . ini_get('post_max_size');
    return ['settings' => $out];
}

function act_admin_settings_set(array $in): array
{
    require_admin_user();
    $file = APP_ROOT . '/inc/config.php';
    $cfg = require $file;
    if (isset($in['app_name'])) {
        $cfg['app_name'] = str_limit(mb_trim((string) $in['app_name']), 40) ?: 'تل‌چت';
    }
    if (isset($in['allow_registration'])) {
        $cfg['allow_registration'] = (bool) $in['allow_registration'];
    }
    if (isset($in['register_code'])) {
        $cfg['register_code'] = str_limit(trim((string) $in['register_code']), 64);
    }
    if (isset($in['max_upload_mb'])) {
        $cfg['max_upload_mb'] = max(1, min(2048, (int) $in['max_upload_mb']));
    }
    if (isset($in['poll_timeout'])) {
        $cfg['poll_timeout'] = max(0, min(50, (int) $in['poll_timeout']));
    }
    $php = "<?php\n// تنظیمات تل‌چت\nreturn " . var_export($cfg, true) . ";\n";
    if (@file_put_contents($file, $php, LOCK_EX) === false) {
        throw new ApiError('config_not_writable', 500);
    }
    if (function_exists('opcache_invalidate')) {
        @opcache_invalidate($file, true);
    }
    $mf = APP_ROOT . '/manifest.webmanifest';
    if (isset($in['app_name']) && is_writable($mf)) {
        $m = json_decode((string) file_get_contents($mf), true);
        if (is_array($m)) {
            $m['name'] = $m['short_name'] = $cfg['app_name'];
            @file_put_contents($mf, json_encode($m, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }
    }
    return ['ok' => true];
}
