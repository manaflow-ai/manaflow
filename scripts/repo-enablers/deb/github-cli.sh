#!/usr/bin/env bash
set -euo pipefail

keyring="/usr/share/keyrings/githubcli-archive-keyring.gpg"
list_file="/etc/apt/sources.list.d/github-cli.list"
arch="$(dpkg --print-architecture)"

install -m 0755 -d /usr/share/keyrings

if [ ! -f "${keyring}" ]; then
  github-curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of="${keyring}"
  chmod go+r "${keyring}"
fi

cat <<EOF > "${list_file}"
deb [arch=${arch} signed-by=${keyring}] https://cli.github.com/packages stable main
EOF
