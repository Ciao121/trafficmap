#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo ./install.sh"
  exit 1
fi

APP_DIR=/opt/traffic-map-monitor
APP_USER=trafficmap

command -v node >/dev/null || { echo "Node.js 20+ is required"; exit 1; }
command -v tcpdump >/dev/null || { echo "Install tcpdump first: apt install tcpdump"; exit 1; }

id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
cp -a package.json src public systemd config.example.json "$APP_DIR"/
mkdir -p "$APP_DIR/data"
[[ -f "$APP_DIR/config.json" ]] || cp "$APP_DIR/config.example.json" "$APP_DIR/config.json"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cd "$APP_DIR"
npm install --omit=dev
cp systemd/traffic-map-monitor.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now traffic-map-monitor

echo "Installed. Dashboard: http://SERVER_IP:3100"
echo "Edit $APP_DIR/config.json and restart with: systemctl restart traffic-map-monitor"
