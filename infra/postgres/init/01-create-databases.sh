#!/usr/bin/env bash
# Runs on first container start (when /var/lib/postgresql/data is empty).
#
# Creates the per-service databases owned by the `chatsundere` user.
# Keep this ahead of service activation so upstream backend changes do not make
# a fresh dev volume fail before migrations can run.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    -- auth_db already exists (created via POSTGRES_DB env), but ensuring is cheap.
    SELECT 'CREATE DATABASE auth_db OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec

    SELECT 'CREATE DATABASE auth_db_test OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db_test')\gexec

    SELECT 'CREATE DATABASE sync_db OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db')\gexec

    SELECT 'CREATE DATABASE sync_db_test OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db_test')\gexec

    SELECT 'CREATE DATABASE proxy_db OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'proxy_db')\gexec
EOSQL
