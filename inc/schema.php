<?php
/** ساختار جداول پایگاه داده (MySQL / MariaDB و SQLite برای تست محلی) */

function schema_statements(string $driver): array
{
    $mysql = $driver === 'mysql';
    $pk = $mysql ? 'INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $int = $mysql ? 'INT UNSIGNED' : 'INTEGER';
    $text = $mysql ? 'MEDIUMTEXT' : 'TEXT';
    $tail = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';

    $tables = [
        "CREATE TABLE IF NOT EXISTS users (
            id $pk,
            username VARCHAR(32) NOT NULL,
            name VARCHAR(64) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            bio VARCHAR(255) NOT NULL DEFAULT '',
            avatar VARCHAR(255) NOT NULL DEFAULT '',
            last_seen $int NOT NULL DEFAULT 0,
            visible_at $int NOT NULL DEFAULT 0,
            privacy VARCHAR(255) NOT NULL DEFAULT '',
            is_admin TINYINT NOT NULL DEFAULT 0,
            banned TINYINT NOT NULL DEFAULT 0,
            created_at $int NOT NULL DEFAULT 0
        )$tail",
        "CREATE UNIQUE INDEX ux_users_username ON users (username)",

        "CREATE TABLE IF NOT EXISTS tokens (
            id $pk,
            user_id $int NOT NULL,
            token_hash CHAR(64) NOT NULL,
            device VARCHAR(190) NOT NULL DEFAULT '',
            created_at $int NOT NULL DEFAULT 0,
            last_used $int NOT NULL DEFAULT 0
        )$tail",
        "CREATE UNIQUE INDEX ux_tokens_hash ON tokens (token_hash)",

        "CREATE TABLE IF NOT EXISTS chats (
            id $pk,
            type VARCHAR(10) NOT NULL,
            title VARCHAR(128) NOT NULL DEFAULT '',
            description VARCHAR(255) NOT NULL DEFAULT '',
            avatar VARCHAR(255) NOT NULL DEFAULT '',
            owner_id $int NOT NULL DEFAULT 0,
            uniq_key VARCHAR(64) NULL,
            last_message_id $int NOT NULL DEFAULT 0,
            pinned_message_id $int NOT NULL DEFAULT 0,
            accepted TINYINT NOT NULL DEFAULT 1,
            requested_by $int NOT NULL DEFAULT 0,
            created_at $int NOT NULL DEFAULT 0,
            updated_at $int NOT NULL DEFAULT 0
        )$tail",
        "CREATE UNIQUE INDEX ux_chats_uniq ON chats (uniq_key)",

        "CREATE TABLE IF NOT EXISTS chat_members (
            id $pk,
            chat_id $int NOT NULL,
            user_id $int NOT NULL,
            role VARCHAR(10) NOT NULL DEFAULT 'member',
            last_read_id $int NOT NULL DEFAULT 0,
            cleared_id $int NOT NULL DEFAULT 0,
            muted TINYINT NOT NULL DEFAULT 0,
            pinned TINYINT NOT NULL DEFAULT 0,
            hidden TINYINT NOT NULL DEFAULT 0,
            joined_at $int NOT NULL DEFAULT 0
        )$tail",
        "CREATE UNIQUE INDEX ux_members ON chat_members (chat_id, user_id)",
        "CREATE INDEX ix_members_user ON chat_members (user_id)",

        "CREATE TABLE IF NOT EXISTS messages (
            id $pk,
            chat_id $int NOT NULL,
            user_id $int NOT NULL,
            type VARCHAR(10) NOT NULL DEFAULT 'text',
            body $text NOT NULL,
            file_id $int NOT NULL DEFAULT 0,
            reply_to_id $int NOT NULL DEFAULT 0,
            fwd_name VARCHAR(64) NOT NULL DEFAULT '',
            edited_at $int NOT NULL DEFAULT 0,
            deleted TINYINT NOT NULL DEFAULT 0,
            created_at $int NOT NULL DEFAULT 0
        )$tail",
        "CREATE INDEX ix_messages_chat ON messages (chat_id, id)",

        "CREATE TABLE IF NOT EXISTS message_hidden (
            message_id $int NOT NULL,
            user_id $int NOT NULL,
            PRIMARY KEY (message_id, user_id)
        )$tail",

        "CREATE TABLE IF NOT EXISTS reactions (
            message_id $int NOT NULL,
            user_id $int NOT NULL,
            emoji VARCHAR(16) NOT NULL,
            created_at $int NOT NULL DEFAULT 0,
            PRIMARY KEY (message_id, user_id)
        )$tail",

        "CREATE TABLE IF NOT EXISTS files (
            id $pk,
            user_id $int NOT NULL,
            path VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL DEFAULT '',
            mime VARCHAR(128) NOT NULL DEFAULT '',
            size $int NOT NULL DEFAULT 0,
            width $int NOT NULL DEFAULT 0,
            height $int NOT NULL DEFAULT 0,
            duration $int NOT NULL DEFAULT 0,
            created_at $int NOT NULL DEFAULT 0
        )$tail",

        "CREATE TABLE IF NOT EXISTS events (
            id $pk,
            user_id $int NOT NULL,
            type VARCHAR(20) NOT NULL,
            data $text NOT NULL,
            created_at $int NOT NULL DEFAULT 0
        )$tail",
        "CREATE INDEX ix_events_user ON events (user_id, id)",

        "CREATE TABLE IF NOT EXISTS contacts (
            user_id $int NOT NULL,
            contact_id $int NOT NULL,
            created_at $int NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, contact_id)
        )$tail",

        "CREATE TABLE IF NOT EXISTS blocks (
            user_id $int NOT NULL,
            blocked_id $int NOT NULL,
            created_at $int NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, blocked_id)
        )$tail",

        "CREATE TABLE IF NOT EXISTS push_subs (
            id $pk,
            user_id $int NOT NULL,
            endpoint TEXT NOT NULL,
            endpoint_hash CHAR(64) NOT NULL,
            p256dh VARCHAR(255) NOT NULL,
            auth VARCHAR(64) NOT NULL,
            created_at $int NOT NULL DEFAULT 0
        )$tail",
        "CREATE UNIQUE INDEX ux_push_hash ON push_subs (endpoint_hash)",
        "CREATE INDEX ix_push_user ON push_subs (user_id)",
    ];
    return $tables;
}
