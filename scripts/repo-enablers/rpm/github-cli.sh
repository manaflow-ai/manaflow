#!/usr/bin/env bash
set -euo pipefail

repo_url="https://cli.github.com/packages/rpm/gh-cli.repo"
gpg_url="https://cli.github.com/packages/githubcli-archive-keyring.gpg"

if command -v dnf >/dev/null 2>&1; then
  dnf -y install dnf-plugins-core >/dev/null 2>&1 || true
  if ! dnf repolist | grep -q '^gh-cli'; then
    dnf config-manager --add-repo "${repo_url}"
  fi
elif command -v yum >/dev/null 2>&1; then
  yum -y install yum-utils >/dev/null 2>&1 || true
  if ! yum repolist | grep -q '^gh-cli'; then
    yum-config-manager --add-repo "${repo_url}"
  fi
else
  echo "Neither dnf nor yum found; cannot enable GitHub CLI repo" >&2
  exit 1
fi

rpm --import "${gpg_url}"
