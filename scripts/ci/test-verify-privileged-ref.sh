#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GATE_SCRIPT="$SCRIPT_DIR/../../.github/scripts/verify-privileged-ref.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT

repo_dir="$tmp_dir/repo"
remote_dir="$tmp_dir/origin.git"
mkdir -p "$repo_dir/.github/workflows"
mkdir -p "$repo_dir/apps/client"
git -C "$repo_dir" init --quiet --initial-branch=main
git -C "$repo_dir" config user.name "CI test"
git -C "$repo_dir" config user.email "ci-test@example.invalid"
printf '%s\n' 'name: test' > "$repo_dir/.github/workflows/test.yml"
printf '%s\n' 'name: release-pr' > "$repo_dir/.github/workflows/release-pr.yml"
printf '%s\n' '{"version":"1.2.2"}' > "$repo_dir/apps/client/package.json"
git -C "$repo_dir" add .
git -C "$repo_dir" commit --quiet -m "test: add workflow"
workflow_sha="$(git -C "$repo_dir" rev-parse HEAD)"
printf '%s\n' 'trusted source' > "$repo_dir/source.txt"
git -C "$repo_dir" add source.txt
git -C "$repo_dir" commit --quiet -m "test: add source"
source_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" clone --quiet --bare . "$remote_dir"
git -C "$repo_dir" remote add origin "$remote_dir"
git -C "$repo_dir" push --quiet origin main
git -C "$repo_dir" -c tag.gpgSign=false tag v1.2.3
git -C "$repo_dir" push --quiet origin refs/tags/v1.2.3

run_gate() {
  local kind="$1"
  local ref="$2"
  local ref_type="$3"
  local sha="$4"
  local protected="$5"
  local base_sha="$6"
  local workflow_sha_value="$7"
  local trusted_source_sha="${8:-$sha}"
  local workflow_path=".github/workflows/test.yml"

  (
    cd "$repo_dir"
    git checkout --quiet --detach "$sha"
    GITHUB_REPOSITORY=manaflow-ai/manaflow \
    GITHUB_REF="$ref" \
    GITHUB_REF_TYPE="$ref_type" \
    GITHUB_SHA="$sha" \
    GITHUB_WORKFLOW_REF="manaflow-ai/manaflow/$workflow_path@$ref" \
    GITHUB_WORKFLOW_SHA="$workflow_sha_value" \
    GITHUB_EVENT_NAME=push \
    GITHUB_REF_PROTECTED="$protected" \
    TRUSTED_BASE_SHA="$base_sha" \
    TRUSTED_SOURCE_SHA="$trusted_source_sha" \
    TRUSTED_WORKFLOW_PATH="$workflow_path" \
    TRUSTED_REF_KIND="$kind" \
    "$GATE_SCRIPT"
  )
}

expect_success() {
  local description="$1"
  shift
  if ! run_gate "$@" >/dev/null; then
    echo "FAIL: expected success: $description" >&2
    exit 1
  fi
}

expect_failure() {
  local description="$1"
  shift
  if run_gate "$@" >/dev/null 2>&1; then
    echo "FAIL: expected failure: $description" >&2
    exit 1
  fi
}

expect_success "protected main" main refs/heads/main branch "$source_sha" true "$source_sha" "$workflow_sha"
expect_success "protected tag" tag refs/tags/v1.2.3 tag "$source_sha" true "$source_sha" "$source_sha"
expect_failure \
  "tag workflow must be the current protected-main revision" \
  tag refs/tags/v1.2.3 tag "$source_sha" true "$source_sha" "$workflow_sha"

git -C "$repo_dir" checkout --quiet -b release/v1.2.3
git -C "$repo_dir" config user.name "github-actions[bot]"
git -C "$repo_dir" config user.email "github-actions[bot]@users.noreply.github.com"
mkdir -p "$repo_dir/apps/client"
printf '%s\n' '{"version":"1.2.3"}' > "$repo_dir/apps/client/package.json"
git -C "$repo_dir" add apps/client/package.json
git -C "$repo_dir" commit --quiet -m "chore: release v1.2.3"
release_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" push --quiet origin release/v1.2.3
# The publishing workflow creates the version tag at the generated release
# commit, before the release branch is merged into main.
git -C "$repo_dir" -c tag.gpgSign=false tag -f v1.2.3 "$release_sha" >/dev/null
git -C "$repo_dir" push --quiet --force origin refs/tags/v1.2.3

run_called_gate_in() {
  local gate_repo="$1"
  shift
  local event_name="${1:-workflow_call}"
  local event_ref="${2:-refs/heads/release/v1.2.3}"
  local event_sha="${3:-$release_sha}"
  local base_sha="${4:-$source_sha}"
  local caller_ref="${5:-refs/heads/main}"
  local workflow_ref="${6:-manaflow-ai/manaflow/.github/workflows/release-pr.yml@$caller_ref}"
  local protected="${7:-true}"
  local caller_sha="${8:-$source_sha}"
  local workflow_sha_value="${9:-$caller_sha}"
  (
    cd "$gate_repo"
    git checkout --quiet --detach "$event_sha"
    GITHUB_REPOSITORY=manaflow-ai/manaflow \
    GITHUB_REF="$caller_ref" \
    GITHUB_REF_TYPE=branch \
    GITHUB_SHA="$caller_sha" \
    GITHUB_WORKFLOW_REF="$workflow_ref" \
    GITHUB_WORKFLOW_SHA="$workflow_sha_value" \
    GITHUB_EVENT_NAME="$event_name" \
    GITHUB_REF_PROTECTED="$protected" \
    TRUSTED_BASE_SHA="$base_sha" \
    TRUSTED_CALLED_WORKFLOW_PATH=.github/workflows/test.yml \
    TRUSTED_CALLER_REF="$caller_ref" \
    TRUSTED_EVENT_REF="$event_ref" \
    TRUSTED_EVENT_REF_TYPE=branch \
    TRUSTED_EVENT_SHA="$event_sha" \
    TRUSTED_REF_KIND=release-branch \
    TRUSTED_REF_PROTECTED="$protected" \
    TRUSTED_SOURCE_SHA="$event_sha" \
    TRUSTED_WORKFLOW_SHA="$workflow_sha_value" \
    TRUSTED_WORKFLOW_PATH=.github/workflows/release-pr.yml \
    "$GATE_SCRIPT"
  )
}

run_called_gate() {
  run_called_gate_in "$repo_dir" "$@"
}

expect_called_failure() {
  local description="$1"
  shift
  if run_called_gate "$@" >/dev/null 2>&1; then
    echo "FAIL: expected called workflow failure: $description" >&2
    exit 1
  fi
}

if ! run_called_gate >/dev/null; then
  echo "FAIL: expected reusable release workflow call to pass" >&2
  exit 1
fi
if ! run_called_gate schedule >/dev/null; then
  echo "FAIL: expected reusable release workflow scheduled caller to pass" >&2
  exit 1
fi

# Main can advance while a long release build runs. The captured base remains
# trusted when it is still an ancestor of the protected main tip.
git -C "$repo_dir" checkout --quiet main
printf '%s\n' 'main advanced during release build' > "$repo_dir/main-advance.txt"
git -C "$repo_dir" add main-advance.txt
git -C "$repo_dir" commit --quiet -m "test: advance main during release"
git -C "$repo_dir" push --quiet origin main
if ! run_called_gate >/dev/null; then
  echo "FAIL: release call should allow a protected main fast-forward" >&2
  exit 1
fi

# A runner may only have the release tip and its base locally when main moves.
# The gate must fetch the current protected-main commit before checking ancestry.
shallow_dir="$tmp_dir/shallow"
git clone --quiet --no-local --depth=3 --branch release/v1.2.3 "$remote_dir" "$shallow_dir"
main_advance_sha="$(git -C "$repo_dir" rev-parse main)"
if ! run_called_gate_in "$shallow_dir" workflow_call refs/heads/release/v1.2.3 "$release_sha" "$source_sha" refs/heads/main "manaflow-ai/manaflow/.github/workflows/release-pr.yml@refs/heads/main" true "$main_advance_sha" "$main_advance_sha" >/dev/null; then
  echo "FAIL: release call should fetch an advanced protected main commit" >&2
  exit 1
fi

expect_called_failure "manual event" workflow_dispatch
expect_called_failure \
  "feature-branch caller" \
  workflow_call \
  refs/heads/release/v1.2.3 \
  "$release_sha" \
  "$source_sha" \
  refs/heads/feature
expect_called_failure \
  "unexpected caller workflow" \
  workflow_call \
  refs/heads/release/v1.2.3 \
  "$release_sha" \
  "$source_sha" \
  refs/heads/main \
  manaflow-ai/manaflow/.github/workflows/test.yml@refs/heads/main
expect_called_failure \
  "unprotected caller" \
  workflow_call \
  refs/heads/release/v1.2.3 \
  "$release_sha" \
  "$source_sha" \
  refs/heads/main \
  manaflow-ai/manaflow/.github/workflows/release-pr.yml@refs/heads/main \
  false
expect_failure "unprotected main" main refs/heads/main branch "$source_sha" false "$source_sha" "$workflow_sha"
expect_failure "feature branch" main refs/heads/feature branch "$source_sha" true "$source_sha" "$workflow_sha"
expect_failure "unprotected tag" tag refs/tags/v1.2.3 tag "$source_sha" false "$source_sha" "$workflow_sha"
expect_failure "non-semver tag" tag refs/tags/v1 tag "$source_sha" true "$source_sha" "$workflow_sha"
expect_failure "source SHA mismatch" main refs/heads/main branch "$source_sha" true "$source_sha" "$workflow_sha" "0000000000000000000000000000000000000000"

git -C "$repo_dir" checkout --quiet --detach "$workflow_sha"
printf '%s\n' 'divergent workflow revision' > "$repo_dir/.github/workflows/test.yml"
git -C "$repo_dir" add .github/workflows/test.yml
git -C "$repo_dir" commit --quiet -m "test: divergent workflow"
divergent_workflow_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" checkout --quiet --detach "$source_sha"
expect_failure "workflow SHA is not an ancestor" main refs/heads/main branch "$source_sha" true "$source_sha" "$divergent_workflow_sha"
expect_called_failure \
  "release base is not an ancestor of current main" \
  workflow_call \
  refs/heads/release/v1.2.3 \
  "$release_sha" \
  "$divergent_workflow_sha"

git -C "$repo_dir" checkout --quiet -b release/v1.2.4 "$source_sha"
git -C "$repo_dir" config user.name "CI test"
git -C "$repo_dir" config user.email "ci-test@example.invalid"
printf '%s\n' '{"version":"1.2.4"}' > "$repo_dir/apps/client/package.json"
git -C "$repo_dir" add apps/client/package.json
git -C "$repo_dir" commit --quiet -m "chore: release v1.2.4"
wrong_author_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" push --quiet origin release/v1.2.4
expect_called_failure \
  "release commit has an untrusted author" \
  workflow_call \
  refs/heads/release/v1.2.4 \
  "$wrong_author_sha"

git -C "$repo_dir" checkout --quiet -b release/v1.2.5 "$source_sha"
git -C "$repo_dir" config user.name "github-actions[bot]"
git -C "$repo_dir" config user.email "github-actions[bot]@users.noreply.github.com"
printf '%s\n' '{"version":"1.2.5"}' > "$repo_dir/apps/client/package.json"
printf '%s\n' 'unexpected' > "$repo_dir/unexpected.txt"
git -C "$repo_dir" add apps/client/package.json unexpected.txt
git -C "$repo_dir" commit --quiet -m "chore: release v1.2.5"
extra_file_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" push --quiet origin release/v1.2.5
expect_called_failure \
  "release commit changes an extra file" \
  workflow_call \
  refs/heads/release/v1.2.5 \
  "$extra_file_sha"

git -C "$repo_dir" checkout --quiet -b release/v1.2.7 "$source_sha"
printf '%s\n' '{"version":"1.2.7"}' > "$repo_dir/apps/client/package.json"
mkdir -p "$repo_dir/.github/scripts"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$repo_dir/.github/scripts/verify-privileged-ref.sh"
git -C "$repo_dir" add apps/client/package.json .github/scripts/verify-privileged-ref.sh
git -C "$repo_dir" commit --quiet -m "chore: release v1.2.7"
replaced_gate_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" push --quiet origin release/v1.2.7
expect_called_failure \
  "release revision replaces its verifier" \
  workflow_call \
  refs/heads/release/v1.2.7 \
  "$replaced_gate_sha"

git -C "$repo_dir" checkout --quiet -b release/v1.2.6 "$source_sha"
printf '%s\n' '{"version":"1.2.6"}' > "$repo_dir/apps/client/package.json"
git -C "$repo_dir" add apps/client/package.json
git -C "$repo_dir" commit --quiet -m "chore: release v1.2.6"
unpublished_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" push --quiet origin release/v1.2.6
expect_called_failure \
  "release revision has no immutable release tag" \
  workflow_call \
  refs/heads/release/v1.2.6 \
  "$unpublished_sha"

git -C "$repo_dir" checkout --quiet -b release/v1.2.8 "$source_sha"
printf '%s\n' '{"version":"1.2.8"}' > "$repo_dir/apps/client/package.json"
git -C "$repo_dir" add apps/client/package.json
git -C "$repo_dir" commit --quiet -m "chore: release v1.2.8"
mismatched_tag_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" push --quiet origin release/v1.2.8
git -C "$repo_dir" -c tag.gpgSign=false tag v1.2.8 "$source_sha"
git -C "$repo_dir" push --quiet origin refs/tags/v1.2.8
expect_called_failure \
  "release tag points at a different commit" \
  workflow_call \
  refs/heads/release/v1.2.8 \
  "$mismatched_tag_sha"

git -C "$repo_dir" checkout --quiet main
git -C "$repo_dir" config user.name "CI test"
git -C "$repo_dir" config user.email "ci-test@example.invalid"
git -C "$repo_dir" merge --quiet --no-ff release/v1.2.3 -m "Merge release v1.2.3"
post_merge_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" push --quiet origin main
tag_sha="$(git -C "$repo_dir" ls-remote origin \
  refs/tags/v1.2.3 'refs/tags/v1.2.3^{}' | awk 'NF == 2 { print $1; exit }')"
if [[ "$tag_sha" != "$release_sha" ]]; then
  echo "FAIL: post-merge main changed the release tag source" >&2
  exit 1
fi
expect_called_failure \
  "post-merge main SHA cannot replace the pre-merge release source" \
  workflow_call \
  refs/heads/release/v1.2.3 \
  "$post_merge_sha" \
  "$source_sha"
expect_success "main advanced after the run started" main refs/heads/main branch "$source_sha" true "$source_sha" "$workflow_sha"

# A protected-main ref that diverges from the triggering revision must still
# fail. Ancestry tolerates a fast-forward only; it does not trust an unrelated
# history merely because the ref is named main.
git -C "$repo_dir" checkout --quiet --orphan divergent-main
git -C "$repo_dir" rm --quiet -r --cached .
printf '%s\n' 'unrelated main history' > "$repo_dir/divergent.txt"
git -C "$repo_dir" add divergent.txt
git -C "$repo_dir" commit --quiet -m "test: divergent protected main"
divergent_main_sha="$(git -C "$repo_dir" rev-parse HEAD)"
git -C "$repo_dir" push --quiet --force origin "$divergent_main_sha:refs/heads/main"
git -C "$repo_dir" clean --quiet -fd
git -C "$repo_dir" checkout --quiet --detach "$source_sha"
expect_failure "divergent protected main history" main refs/heads/main branch "$source_sha" true "$source_sha" "$workflow_sha"

echo "verify-privileged-ref behavior tests passed"
