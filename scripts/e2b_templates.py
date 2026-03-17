#!/usr/bin/env python3
"""
Build the E2B templates used by cloudrouter (base + docker) and update the
versioned manifest in packages/shared/src/e2b-templates.json.

This is analogous to scripts/snapshot.py (Morph snapshots), but for E2B
templates.

Usage:
  export E2B_API_KEY="..."
  python3 scripts/e2b_templates.py

Optional:
  python3 scripts/e2b_templates.py --no-cache
  python3 scripts/e2b_templates.py --skip-docker
  python3 scripts/e2b_templates.py --json
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import textwrap
import typing as t

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import tomllib

REPO_ROOT = Path(__file__).resolve().parent.parent

E2B_TEMPLATE_ROOT = REPO_ROOT / "packages/cloudrouter"
E2B_CONFIG_PATH = E2B_TEMPLATE_ROOT / "e2b.docker.toml"

E2B_TEMPLATE_MANIFEST_PATH = REPO_ROOT / "packages/shared/src/e2b-templates.json"
CURRENT_MANIFEST_SCHEMA_VERSION = 1


class E2BTemplateVersionEntry(t.TypedDict):
    version: int
    e2bTemplateId: str
    capturedAt: str


class E2BTemplatePresetEntry(t.TypedDict):
    templateId: str
    label: str
    cpu: str
    memory: str
    disk: str
    versions: list[E2BTemplateVersionEntry]
    description: t.NotRequired[str]


class E2BTemplateManifestEntry(t.TypedDict):
    schemaVersion: int
    updatedAt: str
    templates: list[E2BTemplatePresetEntry]


@dataclass(frozen=True, slots=True)
class TemplatePlan:
    preset_id: str
    config_path: Path
    label: str
    disk_display: str
    description: str

    @property
    def key(self) -> str:
        return self.preset_id


def _iso_timestamp() -> str:
    return (
        datetime.now(tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _read_toml(path: Path) -> dict[str, t.Any]:
    with path.open("rb") as f:
        return t.cast(dict[str, t.Any], tomllib.load(f))


def _require_str(config: dict[str, t.Any], key: str, *, path: Path) -> str:
    value = config.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{path}: missing or invalid {key!r}")
    return value


def _require_int(config: dict[str, t.Any], key: str, *, path: Path) -> int:
    value = config.get(key)
    if not isinstance(value, int):
        raise ValueError(f"{path}: missing or invalid {key!r}")
    return value


def _cpu_display(cpu_count: int) -> str:
    return f"{cpu_count} vCPU"


def _memory_display(memory_mb: int) -> str:
    # E2B config is in MB; we display in GB like the rest of cmux.
    gb = memory_mb / 1024
    if abs(gb - round(gb)) < 1e-9:
        return f"{int(round(gb))} GB RAM"
    return f"{gb:.1f} GB RAM"


def _run(cmd: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            check=True,
            text=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as e:
        combined = (e.stdout or "") + ("\n" if e.stdout and e.stderr else "") + (e.stderr or "")
        raise RuntimeError(
            textwrap.dedent(
                f"""\
                Command failed: {" ".join(cmd)}
                Exit code: {e.returncode}

                Output:
                {combined.strip()}
                """
            ).rstrip()
        ) from e


def _e2b_build(*, config_path: Path, no_cache: bool) -> None:
    cmd = [
        "e2b",
        "template",
        "build",
        "--config",
        str(config_path),
        "--path",
        str(E2B_TEMPLATE_ROOT),
    ]
    if no_cache:
        cmd.append("--no-cache")
    _run(cmd, cwd=REPO_ROOT)


def _e2b_list_templates(*, team_id: str) -> list[dict[str, t.Any]]:
    cp = _run(
        ["e2b", "template", "list", "--format", "json", "--team", team_id],
        cwd=REPO_ROOT,
    )
    raw = cp.stdout.strip()
    if not raw:
        raise RuntimeError("e2b template list returned empty output")
    parsed: t.Any = json.loads(raw)
    if isinstance(parsed, dict) and isinstance(parsed.get("templates"), list):
        templates = parsed["templates"]
    else:
        templates = parsed
    if not isinstance(templates, list):
        raise RuntimeError("Unexpected e2b template list output shape")
    normalized: list[dict[str, t.Any]] = []
    for item in templates:
        if isinstance(item, dict):
            normalized.append(item)
    return normalized


def _extract_template_name(item: dict[str, t.Any]) -> str | None:
    for key in ("name", "templateName", "template_name"):
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _extract_template_id(item: dict[str, t.Any]) -> str | None:
    for key in ("id", "templateId", "template_id", "templateID"):
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _find_template_id(*, templates: list[dict[str, t.Any]], template_name: str) -> str:
    for item in templates:
        name = _extract_template_name(item)
        if name == template_name:
            template_id = _extract_template_id(item)
            if template_id:
                return template_id

    names = sorted({n for n in (_extract_template_name(t) for t in templates) if n})
    raise RuntimeError(
        f"Could not find template {template_name!r} in e2b template list (found {len(names)} templates)"
    )


def _load_manifest(path: Path) -> E2BTemplateManifestEntry:
    if not path.exists():
        return {
            "schemaVersion": CURRENT_MANIFEST_SCHEMA_VERSION,
            "updatedAt": _iso_timestamp(),
            "templates": [],
        }
    with path.open("r", encoding="utf-8") as f:
        data: t.Any = json.load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"Manifest at {path} is not a JSON object")
    schema_version = data.get("schemaVersion")
    if schema_version != CURRENT_MANIFEST_SCHEMA_VERSION:
        raise RuntimeError(
            f"Unsupported e2b template manifest schemaVersion: {schema_version!r}"
        )
    templates = data.get("templates")
    if not isinstance(templates, list):
        raise RuntimeError(f"Manifest at {path} is missing templates[]")
    return t.cast(E2BTemplateManifestEntry, data)


def _upsert_template_preset(
    manifest: E2BTemplateManifestEntry,
    *,
    plan: TemplatePlan,
    cpu: str,
    memory: str,
    e2b_template_id: str,
    captured_at: str,
) -> None:
    templates = manifest["templates"]
    preset = next((t for t in templates if t.get("templateId") == plan.preset_id), None)
    if preset is None:
        preset = {
            "templateId": plan.preset_id,
            "label": plan.label,
            "cpu": cpu,
            "memory": memory,
            "disk": plan.disk_display,
            "versions": [],
            "description": plan.description,
        }
        templates.append(t.cast(E2BTemplatePresetEntry, preset))

    versions = preset.get("versions")
    if not isinstance(versions, list):
        preset["versions"] = []
        versions = preset["versions"]

    existing_versions: list[E2BTemplateVersionEntry] = [
        v
        for v in versions
        if isinstance(v, dict)
        and isinstance(v.get("version"), int)
        and isinstance(v.get("e2bTemplateId"), str)
        and isinstance(v.get("capturedAt"), str)
    ]
    existing_versions.sort(key=lambda v: v["version"])
    preset["versions"] = existing_versions

    last = existing_versions[-1] if existing_versions else None
    last_id = last["e2bTemplateId"] if last else None
    if last_id == e2b_template_id:
        # Avoid spamming versions when template IDs are stable across rebuilds.
        return

    next_version = (existing_versions[-1]["version"] + 1) if existing_versions else 1
    existing_versions.append(
        {"version": next_version, "e2bTemplateId": e2b_template_id, "capturedAt": captured_at}
    )


def _sort_manifest_templates(manifest: E2BTemplateManifestEntry, order: list[str]) -> None:
    order_index = {preset_id: idx for idx, preset_id in enumerate(order)}

    def sort_key(preset: E2BTemplatePresetEntry) -> tuple[int, str]:
        preset_id = preset.get("templateId", "")
        return (order_index.get(preset_id, 999), preset_id)

    manifest["templates"] = sorted(manifest["templates"], key=sort_key)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-cache", action="store_true", help="Pass --no-cache to e2b builds")
    parser.add_argument("--json", action="store_true", help="Print a machine-readable summary to stdout")
    args = parser.parse_args(argv)

    if not os.environ.get("E2B_API_KEY"):
        print("E2B_API_KEY is required to build templates", file=sys.stderr)
        return 2

    cfg = _read_toml(E2B_CONFIG_PATH)

    team_id = _require_str(cfg, "team_id", path=E2B_CONFIG_PATH)
    cpu_count = _require_int(cfg, "cpu_count", path=E2B_CONFIG_PATH)
    memory_mb = _require_int(cfg, "memory_mb", path=E2B_CONFIG_PATH)

    cpu_display = _cpu_display(cpu_count)
    memory_display = _memory_display(memory_mb)

    template_name = _require_str(cfg, "template_name", path=E2B_CONFIG_PATH)

    plan = TemplatePlan(
        preset_id="cmux-devbox-docker",
        config_path=E2B_CONFIG_PATH,
        label="Standard workspace",
        disk_display="20 GB SSD",
        description="E2B template for cmux workspaces with Docker-in-Docker enabled.",
    )

    _e2b_build(config_path=E2B_CONFIG_PATH, no_cache=args.no_cache)

    templates = _e2b_list_templates(team_id=team_id)
    template_id = _find_template_id(templates=templates, template_name=template_name)

    captured_at = _iso_timestamp()
    manifest = _load_manifest(E2B_TEMPLATE_MANIFEST_PATH)
    manifest["updatedAt"] = captured_at

    _upsert_template_preset(
        manifest,
        plan=plan,
        cpu=cpu_display,
        memory=memory_display,
        e2b_template_id=template_id,
        captured_at=captured_at,
    )
    _sort_manifest_templates(manifest, [plan.preset_id])

    E2B_TEMPLATE_MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    summary = {
        "updatedAt": captured_at,
        "teamId": team_id,
        "templates": [
            {
                "presetId": plan.preset_id,
                "templateName": template_name,
                "e2bTemplateId": template_id,
            },
        ],
        "manifestPath": str(E2B_TEMPLATE_MANIFEST_PATH),
    }

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"Updated {E2B_TEMPLATE_MANIFEST_PATH}:")
        for entry in summary["templates"]:
            print(f"- {entry['presetId']}: {entry['e2bTemplateId']} ({entry['templateName']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

