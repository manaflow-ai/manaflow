#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="${repo_root}/.github/scripts/fixtures/fork-rerun.json"
fake_gh="${repo_root}/.github/scripts/fixtures/cla-rerun-fake-gh"
temp_dir="$(mktemp -d)"
trap 'rm -rf -- "${temp_dir}"' EXIT
ln -s -- "${fake_gh}" "${temp_dir}/gh"

jq -e '
  .runs.workflow_runs[0].pull_requests == [] and
  .runs.workflow_runs[0].head_sha != .pull_request.head.sha and
  .runs.workflow_runs[0].head_repository.full_name == .pull_request.head.repo.full_name and
  .source_check_runs.check_runs[0].head_sha == .pull_request.head.sha and
  .jobs.jobs[0].head_sha == .pull_request.head.sha
' "${fixture}" >/dev/null

workflow_sha="$(git -C "${repo_root}" rev-parse HEAD)"
common_env=(
  "PATH=${temp_dir}:${PATH}"
  "CLA_FIXTURE=${fixture}"
  "CLA_POST_LOG=${temp_dir}/post.log"
  "GH_REPO=manaflow-ai/manaflow"
  "EVENT_NAME=issue_comment"
  "TARGET_EVENT=pull_request_target"
  "TARGET_BASE_REF=main"
  "ISSUE_NUMBER=42"
  "PR_NUMBER=42"
  "COMMENT_BODY=recheck"
  "COMMENT_CREATED_AT=2026-09-01T12:00:00Z"
  "COMMENT_ID=9001"
  "COMMENT_AUTHOR_ID=1234"
  "COMMENT_AUTHOR_LOGIN=contributor"
  "COMMENT_AUTHOR_TYPE=User"
  "COMMENT_AUTHOR_ASSOCIATION=NONE"
  "SIGNATURE_RECORDED="
  "CLA_PASSED=true"
  "CLA_GENERATION=v2.2-action-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  "WORKFLOW_SHA=${workflow_sha}"
  "WORKFLOW_PATH=.github/workflows/cla.yml"
)

rm -f -- "${temp_dir}/post.log"
env "${common_env[@]}" bash "${repo_root}/.github/scripts/rerun-failed-cla.sh" >/dev/null
[[ "$(<"${temp_dir}/post.log")" == "repos/manaflow-ai/manaflow/actions/jobs/8800/rerun" ]]

rm -f -- "${temp_dir}/post.log"
if env "${common_env[@]}" CLA_FIXTURE_NO_SOURCE_CHECK=true bash "${repo_root}/.github/scripts/rerun-failed-cla.sh" >"${temp_dir}/negative.log" 2>&1; then
  echo "unbound fork run was accepted" >&2
  exit 1
fi
[[ ! -e "${temp_dir}/post.log" ]]
rg -q 'no pull request association|no check bound|unbound CLA workflow' "${temp_dir}/negative.log"

rm -f -- "${temp_dir}/post.log"
if env "${common_env[@]}" CLA_FIXTURE_WRONG_SOURCE_JOB=true bash "${repo_root}/.github/scripts/rerun-failed-cla.sh" >"${temp_dir}/wrong-job.log" 2>&1; then
  echo "source-bound check for a different job was accepted" >&2
  exit 1
fi
[[ ! -e "${temp_dir}/post.log" ]]
rg -q 'job is not the job bound|job is no longer bound' "${temp_dir}/wrong-job.log"

echo "CLA fork rerun fixture passed"
