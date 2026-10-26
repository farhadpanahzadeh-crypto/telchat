<?php
require dirname(__DIR__) . '/inc/bootstrap.php';
require dirname(__DIR__) . '/inc/actions.php';
require dirname(__DIR__) . '/inc/admin.php';

const PUBLIC_ACTIONS = ['auth.register', 'auth.login', 'config'];

try {
    $action = (string) ($_GET['action'] ?? '');
    if (!preg_match('/^[a-z_]+(\.[a-z_]+)?$/', $action)) {
        throw new ApiError('unknown_action', 404);
    }
    $fn = 'act_' . str_replace('.', '_', $action);
    if (!function_exists($fn)) {
        throw new ApiError('unknown_action', 404);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        throw new ApiError('method_not_allowed', 405);
    }
    $in = $_POST;
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) {
        $in = json_decode((string) file_get_contents('php://input'), true) ?: [];
    }
    if ((int) ($in['e'] ?? 0) === 1) {
        $in = open_request($in);
    } elseif (!empty($_SERVER['HTTP_X_ENC_TOKEN'])) {
        open_token_header((string) $_SERVER['HTTP_X_ENC_TOKEN']);
    }
    if (!in_array($action, PUBLIC_ACTIONS, true)) {
        current_user();
        encrypt_backlog();
    }
    send_json($fn($in));
} catch (ApiError $e) {
    send_json(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('telchat: ' . $e);
    send_json(['error' => 'server_error'], 500);
}
