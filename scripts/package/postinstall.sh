#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[cmux] %s\n' "$*"
}

wait_for_apt_locks() {
  local locks=(
    /var/lib/dpkg/lock-frontend
    /var/lib/dpkg/lock
    /var/lib/apt/lists/lock
    /var/cache/apt/archives/lock
  )
  local waited=0
  while true; do
    local busy=0
    for lock in "${locks[@]}"; do
      if [ -e "$lock" ] && command -v fuser >/dev/null 2>&1 && fuser "$lock" >/dev/null 2>&1; then
        busy=1
        break
      fi
    done
    if [ "$busy" -eq 0 ]; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge 120 ]; then
      log "timed out waiting for apt locks"
      return 1
    fi
  done
}

apt_run() {
  wait_for_apt_locks || return 1
  env DEBIAN_FRONTEND=noninteractive apt-get "$@"
}

install_debian_dependencies() {
  if ! command -v apt-get >/dev/null 2>&1; then
    return
  fi

  if [ -x /opt/cmux/repo-enablers/deb/github-cli.sh ]; then
    bash /opt/cmux/repo-enablers/deb/github-cli.sh
  fi

  if ! command -v gh >/dev/null 2>&1; then
    apt_run update
    apt_run install -y gh
  fi
}

install_rpm_dependencies() {
  local pkg_mgr=""
  if command -v dnf >/dev/null 2>&1; then
    pkg_mgr="dnf"
  elif command -v yum >/dev/null 2>&1; then
    pkg_mgr="yum"
  else
    return
  fi

  if [ -x /opt/cmux/repo-enablers/rpm/github-cli.sh ]; then
    bash /opt/cmux/repo-enablers/rpm/github-cli.sh
  fi

  if command -v gh >/dev/null 2>&1; then
    return
  fi

  if [ "$pkg_mgr" = "dnf" ]; then
    dnf -y install gh
  else
    yum -y install gh
  fi
}

ensure_user() {
  if getent passwd cmux >/dev/null 2>&1; then
    return
  fi

  if command -v useradd >/dev/null 2>&1; then
    useradd --system --home-dir /opt/cmux --create-home --shell /usr/sbin/nologin cmux
  elif command -v adduser >/dev/null 2>&1; then
    adduser --system --home /opt/cmux --shell /usr/sbin/nologin cmux
  else
    log "unable to create cmux system user automatically; please create it manually"
    return
  fi
}

ensure_user
install_debian_dependencies
install_rpm_dependencies

install -d -m 0755 -o cmux -g cmux /opt/cmux /opt/cmux/workspace /var/log/cmux

if command -v chown >/dev/null 2>&1; then
  chown -R cmux:cmux /opt/cmux || true
  chown -R cmux:cmux /var/log/cmux || true
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi

log "enable services with: systemctl enable --now cmux.target"
