#!/usr/bin/env bash
# One-time provisioning on the inspected Ubuntu ECS. Run with sudo only after
# repository publication and access grants have been explicitly approved.
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Requires sudo' >&2; exit 1; }
for path in /srv/fetch-news /etc/fetch-news.env /etc/systemd/system/fetch-news.service /etc/sudoers.d/fetch-news /etc/nginx/snippets/fetch-news.locations.conf; do
  [[ ! -e "$path" ]] || { echo "Existing project resource: $path; inspect before proceeding" >&2; exit 1; }
done
! getent passwd fetch-news >/dev/null || { echo 'Runtime account already exists' >&2; exit 1; }
! getent group fetch-news >/dev/null || { echo 'Runtime group already exists' >&2; exit 1; }
getent passwd deploy >/dev/null
for port in 3107 3108; do
  [[ -z "$(ss -H -ltn "sport = :$port")" ]] || { echo "Port $port is occupied" >&2; exit 1; }
done
[[ -z "$(mariadb -N -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='fetch_news'; SELECT User FROM mysql.user WHERE User='fetch_news';")" ]] || { echo 'Database/account collision' >&2; exit 1; }
/usr/bin/node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
nginx -t
useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin fetch-news
usermod -aG fetch-news deploy
install -d -o deploy -g fetch-news -m 0755 /srv/fetch-news /srv/fetch-news/releases /srv/fetch-news/incoming
touch /srv/fetch-news/.pulse-deployment
chown deploy:fetch-news /srv/fetch-news/.pulse-deployment
python3 - <<'PY'
import os, secrets, subprocess, grp
password = secrets.token_hex(32)
sql = f"CREATE DATABASE fetch_news CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'fetch_news'@'127.0.0.1' IDENTIFIED BY '{password}'; GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON fetch_news.* TO 'fetch_news'@'127.0.0.1';"
subprocess.run(['mariadb'], input=sql, text=True, check=True, stdout=subprocess.DEVNULL)
env = f'''NODE_ENV=production
HOST=127.0.0.1
PORT=3107
APP_BASE_PATH=/davyluiy/fetch-news/
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=fetch_news
DB_PASSWORD={password}
DB_NAME=fetch_news
ENCRYPTION_KEY={__import__('base64').b64encode(secrets.token_bytes(32)).decode()}
COOKIE_SECURE=true
WORKER_ENABLED=true
'''
fd = os.open('/etc/fetch-news.env', os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o640)
with os.fdopen(fd,'w') as f: f.write(env)
os.chown('/etc/fetch-news.env', 0, grp.getgrnam('fetch-news').gr_gid)
print('Created isolated schema and protected environment file; credentials not printed.')
PY
cat > /etc/systemd/system/fetch-news.service <<'UNIT'
[Unit]
Description=Pulse hotspot tracking
After=network.target mariadb.service
Wants=network.target
StartLimitIntervalSec=60
StartLimitBurst=5
[Service]
Type=simple
User=fetch-news
Group=fetch-news
WorkingDirectory=/srv/fetch-news/current
EnvironmentFile=/etc/fetch-news.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
CapabilityBoundingSet=
MemoryMax=384M
TasksMax=64
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
UNIT
printf '%s\n' 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart fetch-news.service, /usr/bin/systemctl stop fetch-news.service' > /etc/sudoers.d/fetch-news
chmod 0440 /etc/sudoers.d/fetch-news
visudo -cf /etc/sudoers.d/fetch-news
systemctl daemon-reload
systemctl enable fetch-news.service
# The Nginx route is installed only after a healthy first release exists.
echo 'Provisioning complete. Run the approved GitHub Actions deployment next.'
