from __future__ import annotations

import os
import shlex
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing helpers only
    from morphcloud.api import Instance, Snapshot

MORPH_EXPECTED_UNAME_ARCH = "x86_64"
DOCKER_ENGINE_VERSION = "28.5.1"
DOCKER_COMPOSE_VERSION = "v2.40.0"
DOCKER_BUILDX_VERSION = "v0.29.1"


def write_remote_file(
    snapshot: "Snapshot | Instance",
    *,
    remote_path: str,
    content: str,
    executable: bool = False,
) -> "Snapshot | Instance":
    """Write text content to `remote_path` on the snapshot without remote exec."""
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tmp:
            tmp.write(content)
            tmp.flush()
            tmp_path = Path(tmp.name)
        mode = 0o755 if executable else 0o644
        os.chmod(tmp_path, mode)
        return snapshot.upload(
            str(tmp_path),
            remote_path,
            recursive=False,
        )
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


def write_remote_file_from_path(
    snapshot: "Snapshot | Instance",
    *,
    remote_path: str,
    local_path: Path,
    executable: bool = False,
) -> "Snapshot | Instance":
    """Read a local file and upload its contents to the snapshot."""
    text = local_path.read_text(encoding="utf-8")
    return write_remote_file(
        snapshot,
        remote_path=remote_path,
        content=text,
        executable=executable,
    )


def ensure_docker_cli_plugins(
    *,
    compose_version: str = DOCKER_COMPOSE_VERSION,
    buildx_version: str = DOCKER_BUILDX_VERSION,
    expected_arch: str = MORPH_EXPECTED_UNAME_ARCH,
) -> str:
    """Return command string to install docker CLI plugins and validate arch."""
    compose_download = " ".join(
        [
            "curl",
            "-fsSL",
            f"https://github.com/docker/compose/releases/download/{compose_version}/docker-compose-linux-{expected_arch}",
            "-o",
            "/usr/local/lib/docker/cli-plugins/docker-compose",
        ]
    )
    buildx_download = " ".join(
        [
            "curl",
            "-fsSL",
            f"https://github.com/docker/buildx/releases/download/{buildx_version}/buildx-{buildx_version}.linux-amd64",
            "-o",
            "/usr/local/lib/docker/cli-plugins/docker-buildx",
        ]
    )

    docker_plugin_cmds = [
        "set -euo pipefail",
        "export PATH=/usr/bin:/usr/local/bin:/usr/sbin:/sbin:$PATH",
        "if ! command -v docker >/dev/null 2>&1; then",
        "  echo 'Error: docker command not found in PATH' >&2",
        "  exit 1",
        "fi",
        "mkdir -p /usr/local/lib/docker/cli-plugins",
        "mkdir -p /usr/local/bin",
        "arch=$(uname -m)",
        f'echo "Architecture detected: $arch"',
        compose_download,
        "chmod +x /usr/local/lib/docker/cli-plugins/docker-compose",
        "ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose",
        buildx_download,
        "chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx",
        "docker compose version",
        "docker buildx version",
    ]
    return "\n".join(docker_plugin_cmds)


def ensure_docker() -> str:
    """Return command string to install Docker engine and enable BuildKit."""
    daemon_config = '{"features":{"buildkit":true}}'
    docker_ready_loop = "\n".join(
        [
            "for i in {1..30}; do",
            "  if docker info >/dev/null 2>&1; then",
            "    echo 'Docker ready'; break;",
            "  else",
            "    echo 'Waiting for Docker...';",
            "    [ $i -eq 30 ] && { echo 'Docker failed to start after 30 attempts'; exit 1; };",
            "    sleep 2;",
            "  fi;",
            "done",
        ]
    )

    script_lines = [
        f"export DOCKER_VERSION={shlex.quote(DOCKER_ENGINE_VERSION)}",
        "need_install=1",
        "if command -v docker >/dev/null 2>&1; then",
        "  installed_version=$(docker --version | awk '{print $3}' | tr -d ',')",
        "  echo \"Docker version detected: $installed_version\"",
        "  if dpkg --compare-versions \"$installed_version\" ge \"$DOCKER_VERSION\"; then",
        "    need_install=0",
        "    echo \"Docker already meets minimum version $DOCKER_VERSION; skipping install\"",
        "  else",
        "    echo \"Docker $installed_version older than required $DOCKER_VERSION; reinstalling\"",
        "  fi",
        "fi",
        "if [ \"$need_install\" -eq 1 ]; then",
        "  DEBIAN_FRONTEND=noninteractive apt-get update",
        "  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg lsb-release",
        "  . /etc/os-release && export distro=${ID:-debian} && export codename=${VERSION_CODENAME:-${UBUNTU_CODENAME:-stable}}",
        "  case \"$distro\" in ubuntu|debian) ;; *) distro='debian';; esac",
        "  install -m 0755 -d /etc/apt/keyrings",
        "  curl -fsSL https://download.docker.com/linux/${distro}/gpg | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg",
        "  chmod a+r /etc/apt/keyrings/docker.gpg",
        "  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/%s %s stable\\n' \"$(dpkg --print-architecture)\" \"$distro\" \"$codename\" > /etc/apt/sources.list.d/docker.list",
        "  DEBIAN_FRONTEND=noninteractive apt-get update",
        "  set +e",
        "  target_version=$(apt-cache madison docker-ce | awk -v ver=\"$DOCKER_VERSION\" '$3 ~ ver {print $3; exit}')",
        "  target_status=$?",
        "  set -e",
        "  if [ \"$target_status\" -ne 0 ]; then",
        "    echo 'Failed to determine exact docker-ce version; falling back to latest available' >&2",
        "    target_version=\"\"",
        "  fi",
        "  if [ -n \"$target_version\" ]; then",
        "    version_args=\"docker-ce=$target_version docker-ce-cli=$target_version\"",
        "  else",
        "    echo \"Desired Docker Engine $DOCKER_VERSION not found in apt repo; installing latest available.\" >&2",
        "    version_args=\"docker-ce docker-ce-cli\"",
        "  fi",
        "  echo \"Docker install candidates: $version_args\"",
        "  if ! DEBIAN_FRONTEND=noninteractive apt-get install -y $version_args containerd.io docker-buildx-plugin docker-compose-plugin python3-docker git; then",
        "    echo 'Docker CE installation failed; attempting docker.io fallback' >&2",
        "    DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-buildx-plugin docker-compose-plugin python3-docker git",
        "  fi",
        "  rm -rf /var/lib/apt/lists/*",
        "fi",
        "if ! command -v docker >/dev/null 2>&1; then",
        "  echo 'Docker CLI missing after installation attempts' >&2",
        "  exit 1",
        "fi",
        "mkdir -p /etc/docker",
        f"echo {shlex.quote(daemon_config)} > /etc/docker/daemon.json",
        "echo 'DOCKER_BUILDKIT=1' >> /etc/environment",
        "if command -v systemctl >/dev/null 2>&1; then",
        "  systemctl enable docker >/dev/null 2>&1 || true",
        "  systemctl restart docker",
        "else",
        "  if ! command -v dockerd >/dev/null 2>&1; then",
        "    echo 'dockerd binary missing; cannot start Docker daemon' >&2",
        "    exit 1",
        "  fi",
        "  echo 'systemctl unavailable; starting dockerd manually' >&2",
        "  pkill -f '^dockerd' >/dev/null 2>&1 || true",
        "  nohup dockerd >/var/log/dockerd.log 2>&1 &",
        "  sleep 3",
        "fi",
    ]
    script_lines.extend(docker_ready_loop.splitlines())
    script_lines.extend(
        [
            "installed_version=$(docker --version | awk '{print $3}' | tr -d \",\")",
            "echo \"Docker version: $installed_version\"",
            "if ! dpkg --compare-versions \"$installed_version\" ge \"$DOCKER_VERSION\"; then",
            "  echo \"Docker version $installed_version is older than required $DOCKER_VERSION\" >&2",
            "  exit 1",
            "fi",
            "if docker compose version >/dev/null 2>&1; then",
            "  docker compose version",
            "elif command -v docker-compose >/dev/null 2>&1; then",
            "  docker-compose --version",
            "else",
            "  echo 'Docker compose CLI not available after installation' >&2",
            "  exit 1",
            "fi",
            "docker buildx version",
            "echo 'Docker commands verified'",
            "echo '::1       localhost' >> /etc/hosts",
        ]
    )
    return "\n".join(script_lines)
