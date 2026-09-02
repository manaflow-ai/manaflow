#!/usr/bin/env bash

# Fail-closed guard for workflows that can publish artifacts, write repository
# state, or read environment secrets. The workflow must still use a job-level
# `if` with github.ref_protected so an untrusted ref never gets a runner.

set -euo pipefail

readonly HEX_SHA_RE='^[0-9a-fA-F]{40}$'
readonly REF_NAME_RE='^refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$'

die() {
  echo "trusted-ref: $*" >&2
  exit 1
}

require_value() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "$value" ]] || die "$name is required"
}

require_sha_value() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ $HEX_SHA_RE ]] || die "$name must be a 40-character commit SHA"
}

require_sha() {
  local name="$1"
  require_sha_value "$name" "${!name:-}"
}

require_safe_path() {
  local path="$1"
  [[ "$path" != /* && "$path" != *..* && "$path" != *$'\n'* ]] || die "unsafe workflow path"
}

require_value GITHUB_REPOSITORY
require_value GITHUB_REF
require_value GITHUB_REF_TYPE
require_value GITHUB_SHA
require_value GITHUB_WORKFLOW_REF
require_value GITHUB_WORKFLOW_SHA
require_value GITHUB_EVENT_NAME
require_value GITHUB_REF_PROTECTED
require_value TRUSTED_WORKFLOW_PATH
require_value TRUSTED_REF_KIND
require_value TRUSTED_BASE_SHA
require_value TRUSTED_SOURCE_SHA

[[ "$GITHUB_REPOSITORY" == "${TRUSTED_REPOSITORY:-manaflow-ai/manaflow}" ]] || \
  die "unexpected repository: $GITHUB_REPOSITORY"
[[ "$GITHUB_REF_PROTECTED" == "true" ]] || \
  die "ref is not protected; refusing privileged workflow"
[[ "$GITHUB_EVENT_NAME" == "push" || "$GITHUB_EVENT_NAME" == "schedule" || \
  "$GITHUB_EVENT_NAME" == "workflow_call" ]] || \
  die "event $GITHUB_EVENT_NAME is not allowed"

require_safe_path "$TRUSTED_WORKFLOW_PATH"
require_sha GITHUB_SHA
require_sha GITHUB_WORKFLOW_SHA
require_sha TRUSTED_BASE_SHA
require_sha TRUSTED_SOURCE_SHA

# A reusable workflow inherits the caller's github context. The caller's ref
# and SHA are therefore separate from the release ref and SHA checked out by
# the called workflow. Normal workflows leave these overrides unset.
event_ref="${TRUSTED_EVENT_REF:-$GITHUB_REF}"
event_ref_type="${TRUSTED_EVENT_REF_TYPE:-$GITHUB_REF_TYPE}"
event_sha="${TRUSTED_EVENT_SHA:-$GITHUB_SHA}"
caller_ref="${TRUSTED_CALLER_REF:-$GITHUB_REF}"
workflow_ref="${TRUSTED_WORKFLOW_REF:-$GITHUB_WORKFLOW_REF}"
workflow_sha="${TRUSTED_WORKFLOW_SHA:-$GITHUB_WORKFLOW_SHA}"
ref_protected="${TRUSTED_REF_PROTECTED:-$GITHUB_REF_PROTECTED}"
called_workflow_path="${TRUSTED_CALLED_WORKFLOW_PATH:-$TRUSTED_WORKFLOW_PATH}"

[[ -n "$event_ref" && -n "$event_ref_type" && -n "$event_sha" &&
  -n "$caller_ref" && -n "$workflow_ref" && -n "$workflow_sha" &&
  -n "$ref_protected" ]] || die "trusted event context is incomplete"
require_sha_value TRUSTED_EVENT_SHA "$event_sha"
require_sha_value TRUSTED_WORKFLOW_SHA "$workflow_sha"
[[ "$ref_protected" == "true" ]] || \
  die "ref is not protected; refusing privileged workflow"
[[ "$TRUSTED_SOURCE_SHA" == "$event_sha" ]] || \
  die "trusted source SHA does not match the triggering revision"
require_safe_path "$called_workflow_path"

workflow_ref_prefix="${GITHUB_REPOSITORY}/${TRUSTED_WORKFLOW_PATH}@"
[[ "$workflow_ref" == "$workflow_ref_prefix"* ]] || \
  die "workflow ref does not identify the expected workflow"
workflow_ref_suffix="${workflow_ref#"$workflow_ref_prefix"}"
[[ "$workflow_ref_suffix" == "$caller_ref" ]] || \
  die "workflow ref does not identify the caller ref"

case "$TRUSTED_REF_KIND" in
  main)
    [[ "$event_ref" == "refs/heads/main" && "$event_ref_type" == "branch" ]] || \
      die "main policy requires refs/heads/main"
    [[ "$TRUSTED_BASE_SHA" == "$event_sha" ]] || \
      die "main policy requires the source SHA as its base"
    ;;
  tag)
    [[ "$event_ref_type" == "tag" && "$event_ref" =~ $REF_NAME_RE &&
      "$event_ref" == refs/tags/* ]] || \
      die "tag policy requires a protected vX.Y.Z tag"
    [[ "$TRUSTED_BASE_SHA" == "$event_sha" ]] || \
      die "tag policy requires the source SHA as its base"
    ;;
  release-branch)
    [[ "$event_ref_type" == "branch" && "$event_ref" =~ ^refs/heads/release/v[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
      die "release policy requires a release/vX.Y.Z branch"
    [[ "$TRUSTED_WORKFLOW_PATH" == ".github/workflows/release-pr.yml" &&
      "$caller_ref" == "refs/heads/main" ]] || \
      die "release policy requires the protected release-pr caller"
    ;;
  *)
    die "unknown ref policy: $TRUSTED_REF_KIND"
    ;;
esac

# A checkout step must run before this script. It is deliberately checked
# against the event SHA, rather than trusting the branch name or a mutable
# checkout ref.
checked_out_sha="$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || \
  die "the checkout is not a commit"
[[ "$checked_out_sha" == "$event_sha" ]] || \
  die "checked out $checked_out_sha, expected $event_sha"
git cat-file -e "$TRUSTED_BASE_SHA^{commit}" 2>/dev/null || \
  die "trusted base is not available locally"
git merge-base --is-ancestor "$TRUSTED_BASE_SHA" "$event_sha" || \
  die "checked out revision is not based on the trusted base SHA"

git cat-file -e "$workflow_sha:$TRUSTED_WORKFLOW_PATH" 2>/dev/null || \
  die "workflow file is missing from workflow SHA"
git cat-file -e "HEAD:$TRUSTED_WORKFLOW_PATH" 2>/dev/null || \
  die "workflow file is missing from checked-out revision"

workflow_blob="$(git rev-parse "$workflow_sha:$TRUSTED_WORKFLOW_PATH")" || \
  die "cannot resolve workflow blob at workflow SHA"
head_blob="$(git rev-parse "HEAD:$TRUSTED_WORKFLOW_PATH")" || \
  die "cannot resolve workflow blob at checked-out revision"
[[ "$workflow_blob" == "$head_blob" ]] || \
  die "workflow file changed after the trusted workflow revision"

if [[ "$called_workflow_path" != "$TRUSTED_WORKFLOW_PATH" ]]; then
  git cat-file -e "$workflow_sha:$called_workflow_path" 2>/dev/null || \
    die "called workflow file is missing from workflow SHA"
  git cat-file -e "HEAD:$called_workflow_path" 2>/dev/null || \
    die "called workflow file is missing from checked-out revision"
  called_workflow_blob="$(git rev-parse "$workflow_sha:$called_workflow_path")" || \
    die "cannot resolve called workflow blob at workflow SHA"
  head_called_workflow_blob="$(git rev-parse "HEAD:$called_workflow_path")" || \
    die "cannot resolve called workflow blob at checked-out revision"
  [[ "$called_workflow_blob" == "$head_called_workflow_blob" ]] || \
    die "called workflow file changed after the trusted workflow revision"
fi

git merge-base --is-ancestor "$workflow_sha" "$event_sha" || \
  die "workflow SHA is not an ancestor of the checked-out revision"

# Confirm that the remote ref still resolves to this exact commit. This closes
# the dispatch race where a mutable branch or tag moves after GitHub creates a
# run but before the privileged job starts. For annotated tags, accept the
# peeled commit object as well as the direct ref object.
remote_ref_output="$(GIT_TERMINAL_PROMPT=0 git ls-remote origin "$event_ref" "$event_ref^{}" 2>/dev/null)" || \
  die "unable to resolve remote ref"
remote_ref_lines="$(printf '%s\n' "$remote_ref_output" | awk 'NF == 2 { count += 1 } END { print count + 0 }')"
(( remote_ref_lines > 0 && remote_ref_lines <= 2 )) || \
  die "remote ref response is missing or unexpectedly large"
if ! printf '%s\n' "$remote_ref_output" | awk -v expected="$event_sha" '
  NF == 2 && $1 == expected { found = 1 }
  END { exit(found ? 0 : 1) }
'; then
  die "remote ref does not resolve to $event_sha"
fi

if [[ "$TRUSTED_REF_KIND" == "tag" ]]; then
  # A protected release tag must point at a commit already reachable from
  # protected main. This rejects a newly-created tag carrying an unrelated
  # history, even when the tag itself is covered by a ruleset.
  main_ref_output="$(GIT_TERMINAL_PROMPT=0 git ls-remote origin refs/heads/main 2>/dev/null)" || \
    die "unable to resolve protected main"
  main_sha="$(printf '%s\n' "$main_ref_output" | awk 'NF == 2 && $2 == "refs/heads/main" { print $1; exit }')"
  [[ "$main_sha" =~ $HEX_SHA_RE ]] || die "protected main did not resolve to a commit"
  git merge-base --is-ancestor "$event_sha" "$main_sha" || \
    die "tag revision is not reachable from protected main"
fi

if [[ "$TRUSTED_REF_KIND" == "release-branch" ]]; then
  # Generated release branches must carry the base SHA captured by the
  # trusted release-pr workflow. The value is passed only through the
  # reusable-workflow call, so a user cannot select an old branch. Main may
  # advance while a long build runs, but it must retain the captured base.
  git cat-file -e "$TRUSTED_BASE_SHA^{commit}" 2>/dev/null || \
    die "trusted release base is not available locally"
  main_ref_output="$(GIT_TERMINAL_PROMPT=0 git ls-remote origin refs/heads/main 2>/dev/null)" || \
    die "unable to resolve protected main"
  main_sha="$(printf '%s\n' "$main_ref_output" | awk 'NF == 2 && $2 == "refs/heads/main" { print $1; exit }')"
  [[ "$main_sha" =~ $HEX_SHA_RE ]] || die "protected main did not resolve to a commit"
  git merge-base --is-ancestor "$TRUSTED_BASE_SHA" "$main_sha" || \
    die "trusted release base is not reachable from the current protected main revision"
  release_parent="$(git rev-parse --verify "$event_sha^1" 2>/dev/null)" || \
    die "release branch tip has no parent"
  [[ "$release_parent" == "$TRUSTED_BASE_SHA" ]] || \
    die "release branch tip does not match the trusted base SHA"
  parent_count="$(git rev-list --parents -n 1 "$event_sha" | awk '{ print NF - 1 }')"
  [[ "$parent_count" == "1" ]] || \
    die "release branch tip must be a single-parent commit"

  release_version="${event_ref#refs/heads/release/v}"
  release_subject="$(git log -1 --format=%s "$event_sha")"
  [[ "$release_subject" == "chore: release v$release_version" ]] || \
    die "release branch commit has an unexpected subject"
  [[ "$(git log -1 --format=%an "$event_sha")" == "github-actions[bot]" ]] || \
    die "release branch commit author is not the Actions bot"
  [[ "$(git log -1 --format=%ae "$event_sha")" == "github-actions[bot]@users.noreply.github.com" ]] || \
    die "release branch commit author email is not the Actions bot"
  [[ "$(git log -1 --format=%cn "$event_sha")" == "github-actions[bot]" ]] || \
    die "release branch commit committer is not the Actions bot"
  [[ "$(git log -1 --format=%ce "$event_sha")" == "github-actions[bot]@users.noreply.github.com" ]] || \
    die "release branch commit committer email is not the Actions bot"

  changed_files="$(git diff-tree --no-commit-id --name-only -r "$event_sha")"
  [[ "$changed_files" == "apps/client/package.json" ]] || \
    die "release branch commit changes files outside the version manifest"
fi

echo "trusted-ref: verified $GITHUB_REPOSITORY $event_ref at $event_sha"
