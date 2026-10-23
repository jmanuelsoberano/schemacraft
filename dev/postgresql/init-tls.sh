#!/usr/bin/env bash
# Runs as the image's postgres account on first initialization, not as a privileged helper.
set -euo pipefail
install -m 0600 /fixture-tls/server.key "$PGDATA/server.key"
install -m 0644 /fixture-tls/server.crt "$PGDATA/server.crt"
cat >> "$PGDATA/postgresql.conf" <<'CONFIG'
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
ssl_min_protocol_version = 'TLSv1.2'
CONFIG
