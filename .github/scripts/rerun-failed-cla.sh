#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "::error title=CLA rerun policy::$1" >&2
  exit 1
}

readonly MAX_SAFE_INTEGER=9007199254740991
readonly MAX_COMMENT_BYTES=65536
readonly EXPECTED_REPOSITORY='manaflow-ai/manaflow'
readonly MAX_API_RESPONSE_BYTES=8000000

# Every GitHub API response is bounded before a caller parses it. The helper
# still applies endpoint-specific page and object limits below; this shared
# cap prevents a malformed response from consuming unbounded shell memory.
gh() {
  local response response_bytes
  if [[ "${1:-}" != "api" ]]; then
    command gh "$@"
    return
  fi
  if ! response="$(command gh "$@")"; then
    return 1
  fi
  response_bytes="$(printf '%s' "${response}" | wc -c | tr -d '[:space:]')" || return 1
  [[ "${response_bytes}" =~ ^[0-9]+$ ]] || {
    echo "GitHub API response size is invalid" >&2
    return 1
  }
  (( response_bytes <= MAX_API_RESPONSE_BYTES )) || {
    echo "GitHub API response exceeds ${MAX_API_RESPONSE_BYTES} bytes" >&2
    return 1
  }
  printf '%s' "${response}"
}

safe_id() {
  local value="${1}"
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || return 1
  (( ${#value} <= 16 )) || return 1
  (( value <= MAX_SAFE_INTEGER ))
}

# The job-level expression is the first gate. Repeat it here so a
# future edit to that expression cannot turn this token into a
# general-purpose workflow rerunner.
[[ "${GH_REPO}" == "${EXPECTED_REPOSITORY}" ]] || fail "Unexpected target repository"
[[ "${EVENT_NAME}" == "issue_comment" ]] || fail "Unexpected event for CLA rerun"
[[ "${TARGET_EVENT}" == "pull_request_target" ]] || fail "Unexpected target event"
[[ "${TARGET_BASE_REF}" == "main" ]] || fail "Unexpected target base branch"
safe_id "${ISSUE_NUMBER}" || fail "Invalid or unsafe issue number"
[[ "${PR_NUMBER}" == "${ISSUE_NUMBER}" ]] || fail "Issue and pull request numbers differ"
[[ "${COMMENT_BODY}" == "recheck" || "${COMMENT_BODY}" == "I have read the CLA Document v2.2 and I hereby sign the CLA" ]] || fail "Comment is not an accepted CLA trigger"
[[ "${COMMENT_CREATED_AT}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail "Invalid comment timestamp"
safe_id "${COMMENT_ID}" || fail "Comment ID is invalid"
safe_id "${COMMENT_AUTHOR_ID}" || fail "Comment author ID is invalid"
[[ -n "${COMMENT_AUTHOR_LOGIN}" && "${COMMENT_AUTHOR_LOGIN}" != *$'\n'* && "${COMMENT_AUTHOR_LOGIN}" != *$'\r'* ]] || fail "Comment author is missing or malformed"
[[ "${COMMENT_AUTHOR_TYPE}" == "User" ]] || fail "Comment author is not a human user"
case "$(printf '%s' "${COMMENT_AUTHOR_LOGIN}" | tr '[:upper:]' '[:lower:]')" in
  *"[bot]") fail "Bot comments cannot trigger a CLA rerun" ;;
esac
[[ -n "${COMMENT_AUTHOR_ASSOCIATION}" &&
   "${COMMENT_AUTHOR_ASSOCIATION}" != *$'\n'* &&
   "${COMMENT_AUTHOR_ASSOCIATION}" != *$'\r'* ]] ||
  fail "Comment author association is malformed"
case "${SIGNATURE_RECORDED}" in
  true|false|'') ;;
  *) fail "The CLA action did not provide a valid signature result" ;;
esac
case "${CLA_PASSED}" in
  true|false|'') ;;
  *) fail "The CLA action did not provide a valid final result" ;;
esac
if [[ "${COMMENT_BODY}" == "I have read the CLA Document v2.2 and I hereby sign the CLA" ]]; then
  [[ "${SIGNATURE_RECORDED}" == "true" ]] ||
    fail "The signing comment did not result in a persisted signature"
  [[ "${CLA_PASSED}" == "true" ]] ||
    fail "The CLA action did not report cla_passed=true after the signature"
elif [[ "${CLA_PASSED}" != "true" ]]; then
  fail "The CLA action did not report cla_passed=true for the recheck"
fi
[[ "${CLA_GENERATION}" =~ ^v[0-9]+\.[0-9]+-action-[0-9a-f]{40}$ ]] || fail "Invalid CLA generation marker"
[[ "${WORKFLOW_SHA}" =~ ^[0-9a-f]{40}$ ]] || fail "Invalid trusted workflow revision"
checked_out_sha="$(git rev-parse HEAD 2>/dev/null)" || fail "Could not verify the trusted workflow checkout"
[[ "${checked_out_sha}" == "${WORKFLOW_SHA}" ]] || fail "The checkout is not the immutable workflow revision"
[[ "${WORKFLOW_PATH}" == ".github/workflows/cla.yml" ]] || fail "Unexpected CLA workflow path"
[[ -f .github/scripts/rerun-failed-cla.sh ]] || fail "The trusted CLA rerun helper is missing"

# These values are part of the trusted workflow contract. They are deliberately
# constants, not event or comment input, so a contributor cannot redirect this
# check to a different ledger.
readonly SIGNATURES_BRANCH='cla-signatures'
readonly SIGNATURES_PATH='signatures/version2/cla.json'
readonly MAX_RUN_PAGES=10
readonly MAX_LEDGER_BYTES=1000000
readonly MAX_LEDGER_SIGNATURES=10000
# GitHub wraps Contents API Base64 responses with newlines. Allow that
# transport overhead while bounding the raw field before normalization.
readonly MAX_LEDGER_RAW_BYTES=2000000
# These rendered job names are part of the v3 workflow contract. Keep them
# fixed here so a workflow edit cannot make this actions:write helper rerun an
# arbitrary failed job. The writer and compatibility jobs are optional failed
# members because a recheck can target a result-only failure; when either is
# failed, rerun-failed-jobs refreshes every failed v3 context together.
readonly CLA_ASSISTANT_JOB='CLA Assistant v3'
readonly CLA_WRITER_JOB='CLA ledger writer'
readonly CLA_COMPATIBILITY_JOB='CLA Assistant'
# A pull_request_target run normally reports the source head in `head_sha`,
# but GitHub has also returned a base execution SHA for fork runs.  The check
# run attached to the live source SHA is the authoritative fallback binding.
# Keep only the numeric run/job IDs parsed from GitHub's fixed Actions URL.
source_check_bindings_json='[]'
run_has_pull_request_association=false

source_check_binding_for_run() {
  local target_run_id="$1"
  jq -e --arg run_id "${target_run_id}" \
    'any(.[]?; .run_id == $run_id)' <<<"${source_check_bindings_json}" >/dev/null
}

source_check_binding_for_job() {
  local target_run_id="$1"
  local target_job_id="$2"
  jq -e \
    --arg run_id "${target_run_id}" \
    --arg job_id "${target_job_id}" \
    'any(.[]?; .run_id == $run_id and .job_id == $job_id)' \
    <<<"${source_check_bindings_json}" >/dev/null
}

validate_triggering_signature_record() {
  local ledger_response ledger_content ledger_content_compact ledger_json ledger_raw_bytes ledger_encoded_bytes ledger_decoded_bytes
  ledger_response="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --raw-field ref="${SIGNATURES_BRANCH}" \
    "repos/${GH_REPO}/contents/${SIGNATURES_PATH}" 2>/dev/null)" || fail "Could not query the trusted CLA signature ledger"
  jq -e '.type == "file" and .encoding == "base64" and (.content | type == "string") and (.content | length > 0)' <<<"${ledger_response}" >/dev/null || fail "The trusted CLA signature ledger response is malformed"
  ledger_content="$(jq -r '.content' <<<"${ledger_response}")"
  ledger_raw_bytes="$(printf '%s' "${ledger_content}" | wc -c | tr -d '[:space:]')"
  [[ "${ledger_raw_bytes}" =~ ^[0-9]+$ ]] || fail "Could not measure the trusted CLA signature ledger"
  (( ledger_raw_bytes <= MAX_LEDGER_RAW_BYTES )) || fail "The trusted CLA signature ledger response is too large"
  # The Contents API inserts line breaks into Base64 content. Remove only
  # transport whitespace before applying the encoded-size limit; otherwise a
  # valid near-limit ledger is rejected solely because it is wrapped.
  ledger_content_compact="$(printf '%s' "${ledger_content}" | LC_ALL=C tr -d '[:space:]')"
  [[ "${ledger_content_compact}" =~ ^[A-Za-z0-9+/]+={0,2}$ ]] || fail "The trusted CLA signature ledger is not valid base64"
  ledger_encoded_bytes="$(printf '%s' "${ledger_content_compact}" | wc -c | tr -d '[:space:]')"
  [[ "${ledger_encoded_bytes}" =~ ^[0-9]+$ ]] || fail "Could not measure the trusted CLA signature ledger"
  (( ledger_encoded_bytes % 4 == 0 )) || fail "The trusted CLA signature ledger is not valid base64"
  # The maintained action rejects ledgers larger than 1 MB. Enforce the same
  # bound before decoding, so a malformed Contents response cannot make this
  # privileged job retain an unbounded payload.
  (( ledger_encoded_bytes <= ((MAX_LEDGER_BYTES + 2) * 4 / 3 + 4) )) || fail "The trusted CLA signature ledger exceeds the 1 MB limit; ask an administrator to compact or migrate it before signing"
  if ! ledger_json="$(
    if base64 --decode >/dev/null 2>&1 <<<''; then
      printf '%s' "${ledger_content_compact}" | base64 --decode
    else
      printf '%s' "${ledger_content_compact}" | base64 -D
    fi
  )"; then
    fail "The trusted CLA signature ledger is not valid base64"
  fi
  ledger_decoded_bytes="$(printf '%s' "${ledger_json}" | wc -c | tr -d ' ')"
  [[ "${ledger_decoded_bytes}" =~ ^[0-9]+$ ]] || fail "Could not measure the decoded CLA signature ledger"
  (( ledger_decoded_bytes <= MAX_LEDGER_BYTES )) || fail "The trusted CLA signature ledger exceeds the 1 MB limit; ask an administrator to compact or migrate it before signing"
  jq -e \
    --arg login "${LIVE_COMMENT_LOGIN}" \
    --argjson id "${COMMENT_AUTHOR_ID}" \
    --argjson comment_id "${COMMENT_ID}" \
    --arg created_at "${COMMENT_CREATED_AT}" \
    --argjson repo_id "${repo_id}" \
    --argjson pr_number "${PR_NUMBER}" \
    --argjson max_signatures "${MAX_LEDGER_SIGNATURES}" \
    'type == "object" and
     (.signedContributors | type == "array") and
     (.signedContributors | length <= $max_signatures) and
     any(.signedContributors[]?;
       (.name | type == "string") and .name == $login and
       (.id | type == "number") and .id == $id and
       (.comment_id | type == "number") and .comment_id == $comment_id and
       (.created_at | type == "string") and .created_at == $created_at and
       (.repoId | type == "number") and .repoId == $repo_id and
       (.pullRequestNo | type == "number") and .pullRequestNo == $pr_number
     )' <<<"${ledger_json}" >/dev/null || fail "The signing comment was not the signature persisted by the CLA action"
}

issue_json="$(gh api "repos/${GH_REPO}/issues/${PR_NUMBER}" 2>/dev/null)" || fail "Could not query the issue"
issue_state="$(jq -r '.state // empty' <<<"${issue_json}")"
issue_pr_url="$(jq -r '.pull_request.url // empty' <<<"${issue_json}")"
[[ "${issue_state}" == "open" ]] || fail "The issue is not an open pull request"
[[ "${issue_pr_url}" == "https://api.github.com/repos/${GH_REPO}/pulls/${PR_NUMBER}" ]] || fail "The issue is not the exact repository pull request"

validate_live_triggering_comment() {
  local comment_json comment_body_bytes
  comment_json="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "repos/${GH_REPO}/issues/comments/${COMMENT_ID}" 2>/dev/null)" ||
    fail "Could not query the triggering comment"
  comment_body_bytes="$(jq -r '.body // empty' <<<"${comment_json}" | wc -c | tr -d '[:space:]')"
  [[ "${comment_body_bytes}" =~ ^[0-9]+$ && ${comment_body_bytes} -le ${MAX_COMMENT_BYTES} ]] ||
    fail "The triggering CLA comment exceeds the raw body bound"
  jq -e \
    --arg comment_id "${COMMENT_ID}" \
    --arg issue_url "https://api.github.com/repos/${GH_REPO}/issues/${PR_NUMBER}" \
    --arg body "${COMMENT_BODY}" \
    --arg author_id "${COMMENT_AUTHOR_ID}" \
    --arg author_type "${COMMENT_AUTHOR_TYPE}" \
    --arg created_at "${COMMENT_CREATED_AT}" \
    '(.id | type == "number" and floor == . and . > 0 and . <= 9007199254740991) and
     ((.id | tostring) == $comment_id)' <<<"${comment_json}" >/dev/null ||
    fail "The triggering CLA comment ID is malformed"
  jq -e \
    --arg issue_url "https://api.github.com/repos/${GH_REPO}/issues/${PR_NUMBER}" \
    --arg body "${COMMENT_BODY}" \
    --arg author_id "${COMMENT_AUTHOR_ID}" \
    --arg author_type "${COMMENT_AUTHOR_TYPE}" \
    --arg created_at "${COMMENT_CREATED_AT}" \
    '.issue_url == $issue_url and
     .body == $body and
     (.user | type == "object") and
     (.user.id | type == "number" and floor == . and . > 0 and . <= 9007199254740991) and
     (.user.id | tostring) == $author_id and
     .user.type == $author_type and
     (.user.login | type == "string") and
     (.user.login | length > 0) and
     .created_at == $created_at and
     .updated_at == $created_at and
     (.author_association | type == "string")' <<<"${comment_json}" >/dev/null ||
    fail "The triggering CLA comment was edited, deleted, or moved"
  LIVE_COMMENT_LOGIN="$(jq -er '.user.login | strings' <<<"${comment_json}")" ||
    fail "The triggering CLA comment author is malformed"
  LIVE_COMMENT_ASSOCIATION="$(jq -er '.author_association | strings' <<<"${comment_json}")" ||
    fail "The triggering CLA comment association is malformed"
}

# A comment can be edited or deleted after the writer records a signature; a
# stale event payload must never authorize a rerun of the failed check.
validate_live_triggering_comment

pr_json="$(gh api "repos/${GH_REPO}/pulls/${PR_NUMBER}" 2>/dev/null)" || fail "Could not query the pull request"
jq -e --arg repo "${GH_REPO}" --argjson number "${PR_NUMBER}" --arg base "${TARGET_BASE_REF}" '
  .number == $number and
  .state == "open" and
  .base.ref == $base and
  (.base.repo.id | type == "number") and
  .base.repo.full_name == $repo and
  (.head.sha | type == "string") and
  (.head.sha | test("^[0-9a-f]{40}$")) and
  (.head.repo.id | type == "number") and
  (.head.repo.full_name | type == "string") and
  (.user.login | type == "string") and
  (.user.id | type == "number")
' <<<"${pr_json}" >/dev/null || fail "The live pull request is not valid"
head_sha="$(jq -r '.head.sha' <<<"${pr_json}")"
head_ref="$(jq -r '.head.ref // empty' <<<"${pr_json}")"
head_repo="$(jq -r '.head.repo.full_name // empty' <<<"${pr_json}")"
head_repo_id="$(jq -r '.head.repo.id // empty' <<<"${pr_json}")"
repo_id="$(jq -r '.base.repo.id // empty' <<<"${pr_json}")"
pr_author_login="$(jq -r '.user.login // empty' <<<"${pr_json}")"
pr_author_id="$(jq -r '.user.id // empty' <<<"${pr_json}")"
[[ "${head_ref}" != "" && "${head_repo}" != "" ]] || fail "The pull request head repository is missing"
safe_id "${head_repo_id}" || fail "The pull request head repository ID is missing or unsafe"
safe_id "${repo_id}" || fail "The pull request base repository ID is missing or unsafe"
[[ "${pr_author_login}" != "" ]] || fail "The pull request author is missing"
safe_id "${pr_author_id}" || fail "The pull request author ID is missing or unsafe"
if [[ "${COMMENT_BODY}" == "I have read the CLA Document v2.2 and I hereby sign the CLA" ]]; then
  validate_triggering_signature_record
fi
# A contributor may recheck their own pull request. A different
# commenter must be a trusted repository participant, which limits
# unauthenticated users to the harmless no-op path.
if [[ "${COMMENT_BODY}" == "recheck" && "${COMMENT_AUTHOR_ID}" != "${pr_author_id}" ]]; then
  case "${LIVE_COMMENT_ASSOCIATION}" in
    OWNER|MEMBER|COLLABORATOR) ;;
    *) fail "Only the pull request author or a trusted repository participant may request a CLA rerun" ;;
  esac
fi

# The workflow-run list can omit pull_requests for pull_request_target runs.
# The exact live PR plus the run head_repository/head_branch binding below is
# used for populated source-head runs. Empty associations are accepted when
# the run execution SHA equals the live PR head SHA, or when the source-bound
# CLA check identifies the same run and job. A bare base or merge SHA is not
# sufficient evidence for a privileged rerun.
# GitHub may return a not-found or validation response when the source commit
# exists only in a fork. Treat only that documented missing-commit response as
# an empty association list; every other API failure remains fatal.
commit_prs_json=""
commit_association_error=""
commit_association_stderr_file="$(mktemp)"
cleanup_commit_association_stderr() {
  rm -f -- "${commit_association_stderr_file}"
}
trap cleanup_commit_association_stderr EXIT
if commit_prs_json="$(gh api \
  --method GET \
  --header 'Accept: application/vnd.github+json' \
  --raw-field per_page=100 \
  --raw-field page=1 \
  "repos/${GH_REPO}/commits/${head_sha}/pulls" 2>"${commit_association_stderr_file}")"; then
  :
else
  commit_association_error="${commit_prs_json}"$'\n'"$(cat "${commit_association_stderr_file}")"
  if jq -e '
    ((.status == 404 or .status == "404") and
      (.message == "Not Found" or .message == "Resource not found")) or
    ((.status == 422 or .status == "422") and
      (.message | type == "string" and startswith("No commit found for SHA: ")))
  ' <<<"${commit_prs_json}" >/dev/null 2>&1 ||
     { grep -Eq 'HTTP 404' <<<"${commit_association_error}" &&
       grep -Eq 'Not Found|Resource not found' <<<"${commit_association_error}"; } ||
     { grep -Eq 'HTTP 422' <<<"${commit_association_error}" &&
       grep -Eq 'No commit found for SHA: [0-9a-f]{40}' <<<"${commit_association_error}"; }; then
    commit_prs_json='[]'
  else
    fail "Could not query pull request associations"
  fi
fi
cleanup_commit_association_stderr
trap - EXIT
jq -e 'type == "array"' <<<"${commit_prs_json}" >/dev/null || fail "Could not validate pull request associations"
association_count="$(jq -r 'length' <<<"${commit_prs_json}")"
[[ "${association_count}" =~ ^[0-9]+$ ]] || fail "Could not count pull request associations"
(( association_count <= 100 )) || fail "The pull request association page is oversized"
if (( association_count == 100 )); then
  commit_prs_page2="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --raw-field per_page=100 \
    --raw-field page=2 \
    "repos/${GH_REPO}/commits/${head_sha}/pulls" 2>/dev/null)" || fail "Could not query pull request associations page 2"
  jq -e 'type == "array"' <<<"${commit_prs_page2}" >/dev/null || fail "Could not validate pull request associations page 2"
  commit_prs_page2_count="$(jq -r 'length' <<<"${commit_prs_page2}")"
  [[ "${commit_prs_page2_count}" =~ ^[0-9]+$ ]] || fail "Could not count pull request associations page 2"
  (( commit_prs_page2_count <= 100 )) || fail "The pull request association page is oversized"
  commit_prs_json="$(jq -c --argjson page2 "${commit_prs_page2}" '. + $page2' <<<"${commit_prs_json}")"
  association_count=$((association_count + commit_prs_page2_count))
  (( commit_prs_page2_count < 100 )) || fail "Too many pull request associations for this head after two pages; ask an administrator to resolve the association before requesting a rerun"
fi
if (( association_count > 0 )); then
  jq -e \
    --arg repo "${GH_REPO}" \
    --arg pr "${PR_NUMBER}" \
    --arg sha "${head_sha}" \
    --arg base "${TARGET_BASE_REF}" \
    --arg head_ref "${head_ref}" \
    --argjson head_repo_id "${head_repo_id}" '
      any(.[]?;
        (.number | tostring) == $pr and
        .base.ref == $base and
        .base.repo.full_name == $repo and
        .head.ref == $head_ref and
        .head.sha == $sha and
        (.head.repo.id | type == "number") and
        .head.repo.id == $head_repo_id
      )
    ' <<<"${commit_prs_json}" >/dev/null || fail "The current head is not associated with this pull request"
elif [[ "${head_repo}" == "${GH_REPO}" ]]; then
  fail "The base-repository head has no pull request association"
fi

# A fork-only commit can be absent from the commit association API.
# Resolve it through the live open-PR list instead. The head filter
# is owner:ref, so the result must contain exactly one PR with the
# exact number, SHA, head repository, and base repository. This
# rejects duplicate or cross-PR matches before a run is selected,
# and the helper is called again immediately before the POST.
validate_live_open_head_association() {
  local head_owner head_name open_prs_page open_pr_count open_prs_json matching_open_prs_json open_association_count
  [[ "${head_repo}" == */* && "${head_repo}" != */*/* ]] || fail "The pull request head repository name is invalid"
  head_owner="${head_repo%%/*}"
  head_name="${head_repo#*/}"
  [[ -n "${head_owner}" && -n "${head_name}" ]] || fail "The pull request head repository name is invalid"
  open_prs_page="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --raw-field state=open \
    --raw-field base="${TARGET_BASE_REF}" \
    --raw-field head="${head_owner}:${head_ref}" \
    --raw-field per_page=100 \
    --raw-field page=1 \
    "repos/${GH_REPO}/pulls" 2>/dev/null)" || fail "Could not query live open pull requests for this head"
  jq -e 'type == "array"' <<<"${open_prs_page}" >/dev/null || fail "Could not validate live open pull requests"
  open_pr_count="$(jq -r 'length' <<<"${open_prs_page}")"
  [[ "${open_pr_count}" =~ ^[0-9]+$ ]] || fail "Could not count live open pull requests"
  (( open_pr_count <= 100 )) || fail "The live open pull request page is oversized"
  if (( open_pr_count == 100 )); then
    open_prs_page2="$(gh api \
      --method GET \
      --header 'Accept: application/vnd.github+json' \
      --raw-field state=open \
      --raw-field base="${TARGET_BASE_REF}" \
      --raw-field head="${head_owner}:${head_ref}" \
      --raw-field per_page=100 \
      --raw-field page=2 \
      "repos/${GH_REPO}/pulls" 2>/dev/null)" || fail "Could not query live open pull requests page 2"
    jq -e 'type == "array"' <<<"${open_prs_page2}" >/dev/null || fail "Could not validate live open pull requests page 2"
    open_pr_count2="$(jq -r 'length' <<<"${open_prs_page2}")"
    [[ "${open_pr_count2}" =~ ^[0-9]+$ ]] || fail "Could not count live open pull requests page 2"
    (( open_pr_count2 <= 100 )) || fail "The live open pull request page is oversized"
    open_prs_page="$(jq -c --argjson page2 "${open_prs_page2}" '. + $page2' <<<"${open_prs_page}")"
    open_pr_count=$((open_pr_count + open_pr_count2))
    (( open_pr_count2 < 100 )) || fail "Too many open pull requests share this head after two pages; push a new head or ask an administrator to resolve the association before requesting a rerun"
  fi
  open_prs_json="$(jq -c '[.]' <<<"${open_prs_page}")"
  if ! matching_open_prs_json="$(jq -c \
      --arg repo "${GH_REPO}" \
      --arg sha "${head_sha}" \
      --arg base "${TARGET_BASE_REF}" \
      --arg head_ref "${head_ref}" \
      --arg head_repo "${head_repo}" \
      --argjson head_repo_id "${head_repo_id}" \
      --argjson repo_id "${repo_id}" '
        [ .[] | .[]?
          | select(
              (.number | type == "number") and
              .state == "open" and
              .base.ref == $base and
              .base.repo.full_name == $repo and
              (.base.repo.id | type == "number") and
              .base.repo.id == $repo_id and
              .head.ref == $head_ref and
              .head.sha == $sha and
              .head.repo.full_name == $head_repo and
              (.head.repo.id | type == "number") and
              .head.repo.id == $head_repo_id
            )
        ]
        | sort_by(.number)
      ' <<<"${open_prs_json}")"; then
    fail "Could not validate live open pull request data"
  fi
  open_association_count="$(jq -r 'length' <<<"${matching_open_prs_json}")"
  [[ "${open_association_count}" =~ ^[0-9]+$ ]] || fail "Could not count live open pull request associations"
  [[ "${open_association_count}" == "1" ]] || fail "Expected exactly one open pull request for this head"
  jq -e --argjson number "${PR_NUMBER}" '.[0].number == $number' <<<"${matching_open_prs_json}" >/dev/null || fail "The live head is associated with a different pull request"
}
validate_live_open_head_association

# The REST workflow-run API can omit `pull_requests` for a fork. Most runs
# still expose the source SHA in `head_sha`; when they do not, bind the run and
# selected job to a failed CLA check that GitHub attached to this exact source
# SHA. A check run is created by the GitHub Actions app, so an untrusted fork
# cannot forge this association in the base repository. The later job and PR
# rechecks still require the same source repository, branch, and current SHA.
refresh_source_check_bindings() {
  local source_checks_page source_checks_page2 source_checks_error source_checks_error_file
  local source_check_count source_check_count2
  if [[ "${head_repo}" == "${GH_REPO}" ]]; then
    source_check_bindings_json='[]'
    return 0
  fi

  source_checks_error_file="$(mktemp)"
  if source_checks_page="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --raw-field per_page=100 \
    --raw-field page=1 \
    "repos/${GH_REPO}/commits/${head_sha}/check-runs" 2>"${source_checks_error_file}")"; then
    rm -f -- "${source_checks_error_file}"
  else
    source_checks_error="$(cat "${source_checks_error_file}")"
    rm -f -- "${source_checks_error_file}"
    if grep -Eq 'HTTP 404|HTTP 422' <<<"${source_checks_error}" &&
       grep -Eq 'Not Found|Resource not found|No commit found for SHA: [0-9a-f]{40}' <<<"${source_checks_error}"; then
      # A fork-only commit may not be addressable through the base repository.
      # The strict source-SHA run path remains available in that case.
      source_checks_page='{"check_runs":[]}'
    else
      fail "Could not query check runs for the live pull request head"
    fi
  fi
  jq -e 'type == "object" and (.check_runs | type == "array")' <<<"${source_checks_page}" >/dev/null || fail "Could not validate source check runs"
  source_check_count="$(jq -r '.check_runs | length' <<<"${source_checks_page}")"
  [[ "${source_check_count}" =~ ^[0-9]+$ ]] || fail "Could not count source check runs"
  (( source_check_count <= 100 )) || fail "The source check-run page is oversized"
  if (( source_check_count == 100 )); then
    source_checks_page2="$(gh api \
      --method GET \
      --header 'Accept: application/vnd.github+json' \
      --raw-field per_page=100 \
      --raw-field page=2 \
      "repos/${GH_REPO}/commits/${head_sha}/check-runs" 2>/dev/null)" || fail "Could not query source check runs page 2"
    jq -e 'type == "object" and (.check_runs | type == "array")' <<<"${source_checks_page2}" >/dev/null || fail "Could not validate source check runs page 2"
    source_check_count2="$(jq -r '.check_runs | length' <<<"${source_checks_page2}")"
    [[ "${source_check_count2}" =~ ^[0-9]+$ ]] || fail "Could not count source check runs page 2"
    (( source_check_count2 <= 100 )) || fail "The source check-run page is oversized"
    source_checks_page="$(jq -c --argjson page2 "${source_checks_page2}" '.check_runs += $page2.check_runs' <<<"${source_checks_page}")"
    source_check_count=$((source_check_count + source_check_count2))
    (( source_check_count2 < 100 )) || fail "Too many source check runs for this head; ask an administrator to resolve the check history before requesting a rerun"
  fi
  source_check_bindings_json="$(jq -c \
    --arg sha "${head_sha}" \
    --arg assistant_job "${CLA_ASSISTANT_JOB}" '
      [ .check_runs[]?
        | select(
            (.name | type == "string") and
            .name == $assistant_job and
            (.head_sha | type == "string") and
            .head_sha == $sha and
            .conclusion == "failure" and
            (.app.slug | type == "string") and
            .app.slug == "github-actions" and
            (.details_url | type == "string") and
            (.details_url | test("^https://github\\.com/manaflow-ai/manaflow/actions/runs/[0-9]+/job/[0-9]+$"))
          )
        | .details_url
        | capture("/actions/runs/(?<run>[1-9][0-9]*)/job/(?<job>[1-9][0-9]*)$")
        | {run_id: .run, job_id: .job}
      ]
      | unique_by([.run_id, .job_id])
    ' <<<"${source_checks_page}")" || fail "Could not identify the source-bound CLA check"
  jq -e 'all(.[]; (.run_id | type == "string" and test("^[1-9][0-9]{0,15}$")) and (.job_id | type == "string" and test("^[1-9][0-9]{0,15}$")))' <<<"${source_check_bindings_json}" >/dev/null || fail "The source-bound CLA check identity is malformed"
}
refresh_source_check_bindings

workflow_page="$(gh api \
  --method GET \
  --header 'Accept: application/vnd.github+json' \
  --raw-field per_page=100 \
  --raw-field page=1 \
  "repos/${GH_REPO}/actions/workflows" 2>/dev/null)" || fail "Could not query repository workflows"
jq -e 'type == "object" and (.workflows | type == "array")' <<<"${workflow_page}" >/dev/null || fail "Could not validate repository workflows"
workflow_count="$(jq -r '.workflows | length' <<<"${workflow_page}")"
[[ "${workflow_count}" =~ ^[0-9]+$ ]] || fail "Could not count repository workflows"
(( workflow_count <= 100 )) || fail "The repository workflow page is oversized"
if (( workflow_count == 100 )); then
  workflow_page2="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --raw-field per_page=100 \
    --raw-field page=2 \
    "repos/${GH_REPO}/actions/workflows" 2>/dev/null)" || fail "Could not query repository workflows page 2"
  jq -e 'type == "object" and (.workflows | type == "array")' <<<"${workflow_page2}" >/dev/null || fail "Could not validate repository workflows page 2"
  workflow_count2="$(jq -r '.workflows | length' <<<"${workflow_page2}")"
  [[ "${workflow_count2}" =~ ^[0-9]+$ ]] || fail "Could not count repository workflows page 2"
  (( workflow_count2 <= 100 )) || fail "The repository workflow page is oversized"
  workflow_page="$(jq -c --argjson page2 "${workflow_page2}" '.workflows += $page2.workflows' <<<"${workflow_page}")"
  workflow_count=$((workflow_count + workflow_count2))
  (( workflow_count2 < 100 )) || fail "Too many active repository workflows after two pages; ask an administrator to reduce the workflow list before requesting a rerun"
fi
workflow_json="$(jq -c '[.]' <<<"${workflow_page}")"
workflow_id="$(jq -r --arg path "${WORKFLOW_PATH}" '[.[] | .workflows[]? | select(.path == $path and .state == "active") | .id] | if length == 1 then .[0] else empty end' <<<"${workflow_json}")"
safe_id "${workflow_id}" || fail "The expected CLA workflow ID is missing or unsafe"

# Search a bounded first page, then choose the newest completed
# failure created no later than this comment. Edited, reopened, and
# synchronize events can leave several eligible failures for one
# exact head, so sort by creation time and run ID and select the
# newest one. Every candidate is tied to the exact workflow path,
# event, and PR association. When GitHub includes pull_requests on a
# run, bind the candidate to the exact PR object, including its
# source head SHA.
# GitHub can return an empty array for fork pull_request_target runs. Those
# candidates are retained when the execution SHA is the live source SHA, or
# when a GitHub Actions check on that source SHA identifies the same run. A
# selected assistant job must match that check's run and job IDs below.
runs_page="$(gh api \
  --method GET \
  --header 'Accept: application/vnd.github+json' \
  --raw-field event="${TARGET_EVENT}" \
  --raw-field branch="${head_ref}" \
  --raw-field per_page=100 \
  --raw-field page=1 \
  "repos/${GH_REPO}/actions/workflows/${workflow_id}/runs" 2>/dev/null)" || fail "Could not query CLA workflow runs"
jq -e 'type == "object" and (.workflow_runs | type == "array")' <<<"${runs_page}" >/dev/null || fail "Could not validate CLA workflow runs"
run_count="$(jq -r '.workflow_runs | length' <<<"${runs_page}")"
[[ "${run_count}" =~ ^[0-9]+$ ]] || fail "Could not count CLA workflow runs"
(( run_count <= 100 )) || fail "The CLA workflow run page is oversized"
runs_json="$(jq -c '[.]' <<<"${runs_page}")"

# The API returns newest runs first. Probe additional bounded pages when the
# first page is full, so normal workflow history growth does not strand a
# failed check. GitHub documents a 1,000-result cap for filtered workflow-run
# queries, so ten 100-item pages cover the complete API result window. Search
# the complete bounded window before deciding whether it is full: a valid
# candidate on page ten is still actionable. If the window is full and no
# candidate matches, fail with an actionable message instead of pretending page
# 11 can reveal an unreported run. `runs_json` stays an array of response
# objects; the candidate query below flattens each `.workflow_runs` array
# explicitly.
page_count="${run_count}"
page_number=2
while (( page_count == 100 && page_number <= MAX_RUN_PAGES )); do
  next_runs_page="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --raw-field event="${TARGET_EVENT}" \
    --raw-field branch="${head_ref}" \
    --raw-field per_page=100 \
    --raw-field page="${page_number}" \
    "repos/${GH_REPO}/actions/workflows/${workflow_id}/runs" 2>/dev/null)" || fail "Could not query CLA workflow runs page ${page_number}"
  jq -e 'type == "object" and (.workflow_runs | type == "array")' <<<"${next_runs_page}" >/dev/null || fail "Could not validate CLA workflow runs page ${page_number}"
  page_count="$(jq -r '.workflow_runs | length' <<<"${next_runs_page}")"
  [[ "${page_count}" =~ ^[0-9]+$ ]] || fail "Could not count CLA workflow runs page ${page_number}"
  (( page_count <= 100 )) || fail "The CLA workflow returned an oversized run page"
  runs_json="$(jq -c --argjson next_page "${next_runs_page}" '. + [$next_page]' <<<"${runs_json}")"
  (( page_number++ ))
done
run_window_full=false
(( page_count == 100 )) && run_window_full=true

# `pull_requests` is optional for fork runs, but when GitHub sends it, the
# field must keep its documented array shape. Treat a changed or malformed
# response as an infrastructure error. Silently treating it as an unmatched
# run could strand a required failed check with no recovery path.
if ! jq -e '
  all(.[] | .workflow_runs[]?;
    (type == "object") and
    (.pull_requests == null or (.pull_requests | type == "array"))
  )
' <<<"${runs_json}" >/dev/null; then
  fail "The CLA workflow returned malformed pull request associations"
fi

# Keep the run-binding predicate inline in each snapshot check below. These
# jq programs consume independently fetched API responses; sharing a mutable
# transformed result would make a later TOCTOU recheck look authoritative when
# it is only a copy of the earlier response.
if ! candidate_list_json="$(jq -c \
    --arg path "${WORKFLOW_PATH}" \
    --arg event "${TARGET_EVENT}" \
    --arg sha "${head_sha}" \
    --arg workflow_id "${workflow_id}" \
    --arg pr "${PR_NUMBER}" \
    --arg repo "${GH_REPO}" \
    --arg head_repo "${head_repo}" \
    --argjson head_repo_id "${head_repo_id}" \
    --argjson repo_id "${repo_id}" \
    --argjson source_check_bindings "${source_check_bindings_json}" \
    --arg base "${TARGET_BASE_REF}" \
    --arg head_ref "${head_ref}" \
    --arg before "${COMMENT_CREATED_AT}" '
      def run_binds_to_pr:
        (.pull_requests) as $raw_prs
        | (if $raw_prs == null then []
           elif ($raw_prs | type) == "array" then $raw_prs
           else null end) as $prs
        | if $prs == null then false
          elif ($prs | length) == 0 then
            (.id | tostring) as $run_id
            | .head_branch == $head_ref and
            (
              ((.head_repository | type) == "object" and
               .head_repository.full_name == $head_repo and
               (.head_repository.id | type == "number") and
               .head_repository.id == $head_repo_id) or
              (.head_repository == null and
               $head_repo == $repo and
               $head_repo_id == $repo_id)
            )
            and
            (
              .head_sha == $sha or
              ($head_repo != $repo and
               any($source_check_bindings[]?; .run_id == $run_id))
            )
          else any($prs[]?;
            (.number | type == "number") and
            (.number | tostring) == $pr and
            .base.ref == $base and
            ((.base.repo.full_name // "") == "" or
             .base.repo.full_name == $repo) and
            (.base.repo.id | type == "number") and
            .base.repo.id == $repo_id and
            .head.ref == $head_ref and
            .head.sha == $sha and
            (.head.repo.id | type == "number") and
            .head.repo.id == $head_repo_id and
            ((.head.repo.full_name // "") == "" or
             .head.repo.full_name == $head_repo)
          )
          end;
      [ .[] | .workflow_runs[]?
        | select(
            (.path == $path or
            ((.path | startswith($path + "@")) and
             ((.path | length) > (($path | length) + 1)))) and
            .event == $event and
            (.workflow_id | type == "number") and
            .workflow_id == ($workflow_id | tonumber) and
            (.head_sha | type == "string") and
            (.head_sha | test("^[0-9a-f]{40}$")) and
            (.id | type == "number") and
            .id > 0 and
            .status == "completed" and
            .conclusion == "failure" and
            (.created_at | type == "string") and
            .created_at <= $before and
            run_binds_to_pr
          )
      ]
      | sort_by([.created_at, .id])
    ' <<<"${runs_json}")"; then
  fail "Could not validate CLA workflow run data"
fi
candidate_count="$(jq -r 'length' <<<"${candidate_list_json}")"
[[ "${candidate_count}" =~ ^[0-9]+$ ]] || fail "Could not count matching CLA workflow runs"
if [[ "${candidate_count}" == "0" ]]; then
  if [[ "${run_window_full}" == true ]]; then
    fail "The GitHub workflow-run result window is full after ${MAX_RUN_PAGES} pages and contains no matching failed CLA run; push a new commit or ask an administrator to prune old runs before requesting a rerun"
  fi
  # Do not silently treat a failed run with an empty association and a
  # different execution SHA as a successful no-op. It is not eligible for a
  # rerun, but it still needs an explicit fail-closed migration/error path.
  # Runs with the exact source SHA are handled by the candidate query above;
  # this count therefore only catches mismatched runs that would otherwise be
  # indistinguishable from an absent check.
  empty_execution_mismatch_count="$(jq -r \
    --arg path "${WORKFLOW_PATH}" \
    --arg event "${TARGET_EVENT}" \
    --arg sha "${head_sha}" \
    --arg workflow_id "${workflow_id}" \
    --arg repo "${GH_REPO}" \
    --arg head_repo "${head_repo}" \
    --argjson head_repo_id "${head_repo_id}" \
    --argjson repo_id "${repo_id}" \
    --argjson source_check_bindings "${source_check_bindings_json}" \
    --arg head_ref "${head_ref}" \
    --arg before "${COMMENT_CREATED_AT}" \
    '[ .[] | .workflow_runs[]?
      | (.id | tostring) as $run_id
      | select(
          (.path == $path or
           ((.path | startswith($path + "@")) and
            ((.path | length) > (($path | length) + 1)))) and
          .event == $event and
          (.workflow_id | type == "number") and
          .workflow_id == ($workflow_id | tonumber) and
          (.head_sha | type == "string") and
          (.head_sha | test("^[0-9a-f]{40}$")) and
          .head_sha != $sha and
          (.id | type == "number") and
          .id > 0 and
          .status == "completed" and
          .conclusion == "failure" and
          (.created_at | type == "string") and
          .created_at <= $before and
          .head_branch == $head_ref and
          (.pull_requests == null or
           ((.pull_requests | type) == "array" and
            (.pull_requests | length) == 0)) and
          (
            ((.head_repository | type) == "object" and
             .head_repository.full_name == $head_repo and
             (.head_repository.id | type == "number") and
             .head_repository.id == $head_repo_id) or
            (.head_repository == null and
             $head_repo == $repo and
             $head_repo_id == $repo_id)
          ) and
          (($head_repo != $repo and
            any($source_check_bindings[]?; .run_id == $run_id)) | not)
        )
    ] | length' <<<"${runs_json}")"
  [[ "${empty_execution_mismatch_count}" =~ ^[0-9]+$ ]] || fail "Could not count unbound CLA workflow runs"
  if (( empty_execution_mismatch_count > 0 )); then
    fail "The workflow run has no pull request association and its execution SHA does not match the current pull request head"
  fi
  # A run from before this workflow generation cannot be safely
  # rerun: GitHub reruns the old workflow revision, which could
  # execute the archived action or an obsolete policy. Distinguish
  # that migration case from a normal no-op after a successful CLA
  # check so contributors receive an actionable recovery path.
  stale_run_count="$(jq -r \
    --arg path "${WORKFLOW_PATH}" \
    --arg event "${TARGET_EVENT}" \
    --arg sha "${head_sha}" \
    --arg workflow_id "${workflow_id}" \
    --arg pr "${PR_NUMBER}" \
    --arg repo "${GH_REPO}" \
    --arg head_ref "${head_ref}" \
    --arg head_repo "${head_repo}" \
    --argjson head_repo_id "${head_repo_id}" \
    --argjson repo_id "${repo_id}" \
    --argjson source_check_bindings "${source_check_bindings_json}" \
    --arg base "${TARGET_BASE_REF}" \
    --arg before "${COMMENT_CREATED_AT}" \
    'def run_binds_to_pr:
       (.pull_requests) as $raw_prs
       | (if $raw_prs == null then []
          elif ($raw_prs | type) == "array" then $raw_prs
          else null end) as $prs
       | if $prs == null then false
         elif ($prs | length) == 0 then
           (.id | tostring) as $run_id
           | .head_branch == $head_ref and
           (
             ((.head_repository | type) == "object" and
              .head_repository.full_name == $head_repo and
              (.head_repository.id | type == "number") and
              .head_repository.id == $head_repo_id) or
             (.head_repository == null and
              $head_repo == $repo and
              $head_repo_id == $repo_id)
           )
           and
           (
             .head_sha == $sha or
             ($head_repo != $repo and
              any($source_check_bindings[]?; .run_id == $run_id))
           )
         else any($prs[]?;
           (.number | type == "number") and
           (.number | tostring) == $pr and
           .base.ref == $base and
           ((.base.repo.full_name // "") == "" or
            .base.repo.full_name == $repo) and
           (.base.repo.id | type == "number") and
           .base.repo.id == $repo_id and
           .head.ref == $head_ref and
           .head.sha == $sha and
           (.head.repo.id | type == "number") and
           .head.repo.id == $head_repo_id and
           ((.head.repo.full_name // "") == "" or
            .head.repo.full_name == $head_repo)
         )
         end;
     [ .[] | .workflow_runs[]?
      | select(
          (.path == $path or
          ((.path | startswith($path + "@")) and
            ((.path | length) > (($path | length) + 1)))) and
          .event == $event and
          (.workflow_id | type == "number") and
          .workflow_id == ($workflow_id | tonumber) and
          (.head_sha | type == "string") and
          (.head_sha | test("^[0-9a-f]{40}$")) and
          (.id | type == "number") and
          .id > 0 and
          .status == "completed" and
          .conclusion == "failure" and
          (.created_at | type == "string") and
          .created_at <= $before and
          run_binds_to_pr
        )
    ] | length' <<<"${runs_json}")"
  [[ "${stale_run_count}" =~ ^[0-9]+$ ]] || fail "Could not count stale CLA workflow runs"
  if (( stale_run_count > 0 )); then
    fail "The failed CLA check was created by an older workflow generation. Push a new commit or close and reopen this pull request to create a current-generation CLA check, then post the exact signing declaration again."
  fi
  # A valid signature can arrive after the check already passed.
  # Preserve the action's historical no-op behavior in that case.
  echo "No failed CLA run exists for this pull request head"
  exit 0
fi
# candidate_list_json is sorted oldest-first above. The selected run
# is fully fetched and validated below before any state-changing API
# call, so multiple historical failures do not create ambiguity.
candidate_json="$(jq -c '.[-1]' <<<"${candidate_list_json}")"
run_id="$(jq -r '.id // empty' <<<"${candidate_json}")"
safe_id "${run_id}" || fail "The selected CLA run ID is invalid or unsafe"
run_execution_sha="$(jq -r '.head_sha // empty' <<<"${candidate_json}")"
[[ "${run_execution_sha}" =~ ^[0-9a-f]{40}$ ]] || fail "The selected CLA run execution SHA is invalid"
run_head_branch="$(jq -r '.head_branch // empty' <<<"${candidate_json}")"
[[ -n "${run_head_branch}" && "${run_head_branch}" != *$'\n'* && "${run_head_branch}" != *$'\r'* ]] || fail "The selected CLA run head branch is invalid"

# A run with a populated pull_requests array already carries an
# authenticated source-PR association. Some GitHub API responses omit that
# array. For those responses, a source execution SHA is preferred; a fork run
# with a different execution SHA is accepted only when its failed CLA check is
# independently attached to the live source SHA. A bare branch/repository
# match is never enough because a branch can be reused after a push.
validate_run_source_binding() {
  local run_payload="$1"
  local execution_sha pull_requests_type pull_request_count
  run_has_pull_request_association=false
  execution_sha="$(jq -r '.head_sha // empty' <<<"${run_payload}")"
  [[ "${execution_sha}" =~ ^[0-9a-f]{40}$ ]] || fail "The workflow run execution SHA is invalid"
  pull_requests_type="$(jq -r 'if .pull_requests == null then "null" else (.pull_requests | type) end' <<<"${run_payload}")"
  case "${pull_requests_type}" in
    null) pull_request_count=0 ;;
    array) pull_request_count="$(jq -r '.pull_requests | length' <<<"${run_payload}")" ;;
    *) fail "The workflow run pull request association is malformed" ;;
  esac
  [[ "${pull_request_count}" =~ ^[0-9]+$ ]] || fail "The workflow run pull request association count is invalid"
  if (( pull_request_count == 0 )); then
    if [[ "${execution_sha}" == "${head_sha}" ]]; then
      return 0
    fi
    [[ "${head_repo}" != "${GH_REPO}" ]] ||
      fail "The base-repository workflow run has no pull request association"
    source_check_binding_for_run "${run_id}" ||
      fail "The fork workflow run has no check bound to the current pull request head"
  else
    run_has_pull_request_association=true
  fi
}

# Re-read the individual run. The list response is only a discovery
# result, not authorization to rerun it.
run_json="$(gh api "repos/${GH_REPO}/actions/runs/${run_id}" 2>/dev/null)" || fail "Could not query the selected CLA run"
jq -e \
  --arg run_id "${run_id}" \
  --arg path "${WORKFLOW_PATH}" \
  --arg event "${TARGET_EVENT}" \
  --arg sha "${head_sha}" \
  --arg run_sha "${run_execution_sha}" \
  --arg run_head_branch "${run_head_branch}" \
  --arg pr "${PR_NUMBER}" \
  --arg repo "${GH_REPO}" \
  --arg head_repo "${head_repo}" \
  --argjson head_repo_id "${head_repo_id}" \
  --argjson source_check_bindings "${source_check_bindings_json}" \
  --argjson repo_id "${repo_id}" \
  --arg head_ref "${head_ref}" \
  --arg workflow_id "${workflow_id}" \
  --arg base "${TARGET_BASE_REF}" \
  --arg before "${COMMENT_CREATED_AT}" '
    def run_binds_to_pr:
      (.pull_requests) as $raw_prs
      | (if $raw_prs == null then []
         elif ($raw_prs | type) == "array" then $raw_prs
         else null end) as $prs
      | if $prs == null then false
        elif ($prs | length) == 0 then
          (.id | tostring) as $run_id
          | .head_branch == $head_ref and
          (
            ((.head_repository | type) == "object" and
             .head_repository.full_name == $head_repo and
             (.head_repository.id | type == "number") and
             .head_repository.id == $head_repo_id) or
            (.head_repository == null and
             $head_repo == $repo and
             $head_repo_id == $repo_id)
          )
          and
          (
            .head_sha == $sha or
            ($head_repo != $repo and
             any($source_check_bindings[]?; .run_id == $run_id))
          )
        else any($prs[]?;
          (.number | type == "number") and
          (.number | tostring) == $pr and
          .base.ref == $base and
          ((.base.repo.full_name // "") == "" or
           .base.repo.full_name == $repo) and
          (.base.repo.id | type == "number") and
          .base.repo.id == $repo_id and
          .head.ref == $head_ref and
          .head.sha == $sha and
          (.head.repo.id | type == "number") and
          .head.repo.id == $head_repo_id and
          ((.head.repo.full_name // "") == "" or
           .head.repo.full_name == $head_repo)
        )
        end;
    .id == ($run_id | tonumber) and
    .workflow_id == ($workflow_id | tonumber) and
    (.path == $path or
     ((.path | startswith($path + "@")) and
      ((.path | length) > (($path | length) + 1)))) and
    .event == $event and
    .status == "completed" and
    .conclusion == "failure" and
    .head_sha == $run_sha and
    .head_branch == $run_head_branch and
    (.created_at | type == "string") and
    .created_at <= $before and
    run_binds_to_pr
  ' <<<"${run_json}" >/dev/null || fail "The selected run no longer matches the exact failed CLA check"
validate_run_source_binding "${run_json}"

# Jobs expose the source head even on GitHub responses where the parent run's
# execution SHA is the base revision. Use that exact source SHA for every job
# identity check in the fallback path; the run itself remains bound to its
# immutable execution SHA above.
set_run_job_binding() {
  run_job_sha="${1}"
  source_sha_fallback=false
  if [[ "${1}" != "${head_sha}" ]]; then
    run_job_sha="${head_sha}"
    if [[ "${run_has_pull_request_association}" == true ]]; then
      # A populated pull_requests association is the authenticated source
      # binding. GitHub can expose either the source or execution SHA on jobs;
      # use the source form for the PR-facing check without requiring a second
      # check-run lookup.
      return 0
    fi
    source_check_binding_for_run "${run_id}" || fail "The selected fork workflow run is not bound to the current pull request head"
    source_sha_fallback=true
  fi
}
set_run_job_binding "${run_execution_sha}"

# Close the main TOCTOU window. A push, close, or another rerun can
# happen while the API calls above run. Never rerun a stale head.
latest_pr_json="$(gh api "repos/${GH_REPO}/pulls/${PR_NUMBER}" 2>/dev/null)" || fail "Could not recheck the pull request"
jq -e --arg repo "${GH_REPO}" --argjson number "${PR_NUMBER}" --arg sha "${head_sha}" --arg base "${TARGET_BASE_REF}" --arg head_ref "${head_ref}" --arg head_repo "${head_repo}" --argjson head_repo_id "${head_repo_id}" --argjson base_repo_id "${repo_id}" --arg opener "${pr_author_login}" --argjson opener_id "${pr_author_id}" '
  .number == $number and
  .state == "open" and
  .base.ref == $base and
  .base.repo.full_name == $repo and
  .base.repo.id == $base_repo_id and
  .head.sha == $sha and
  .head.ref == $head_ref and
  .head.repo.full_name == $head_repo and
  .head.repo.id == $head_repo_id and
  .user.id == $opener_id and
  .user.login == $opener
' <<<"${latest_pr_json}" >/dev/null || fail "The pull request changed while selecting the CLA run"

# Ensure another queued invocation did not already rerun this run.
final_run_json="$(gh api "repos/${GH_REPO}/actions/runs/${run_id}" 2>/dev/null)" || fail "Could not recheck the selected CLA run"
jq -e \
  --arg path "${WORKFLOW_PATH}" \
  --arg event "${TARGET_EVENT}" \
  --arg sha "${head_sha}" \
  --arg run_sha "${run_execution_sha}" \
  --arg run_head_branch "${run_head_branch}" \
  --arg pr "${PR_NUMBER}" \
  --arg repo "${GH_REPO}" \
  --arg head_repo "${head_repo}" \
  --argjson head_repo_id "${head_repo_id}" \
  --argjson source_check_bindings "${source_check_bindings_json}" \
  --argjson repo_id "${repo_id}" \
  --arg head_ref "${head_ref}" \
  --arg workflow_id "${workflow_id}" \
  --arg run_id "${run_id}" \
  --arg base "${TARGET_BASE_REF}" \
  --arg before "${COMMENT_CREATED_AT}" '
    def run_binds_to_pr:
      (.pull_requests) as $raw_prs
      | (if $raw_prs == null then []
         elif ($raw_prs | type) == "array" then $raw_prs
         else null end) as $prs
      | if $prs == null then false
        elif ($prs | length) == 0 then
          (.id | tostring) as $run_id
          | .head_branch == $head_ref and
          (
            ((.head_repository | type) == "object" and
             .head_repository.full_name == $head_repo and
             (.head_repository.id | type == "number") and
             .head_repository.id == $head_repo_id) or
            (.head_repository == null and
             $head_repo == $repo and
             $head_repo_id == $repo_id)
          )
          and
          (
            .head_sha == $sha or
            ($head_repo != $repo and
             any($source_check_bindings[]?; .run_id == $run_id))
          )
        else any($prs[]?;
          (.number | type == "number") and
          (.number | tostring) == $pr and
          .base.ref == $base and
          ((.base.repo.full_name // "") == "" or
           .base.repo.full_name == $repo) and
          (.base.repo.id | type == "number") and
          .base.repo.id == $repo_id and
          .head.ref == $head_ref and
          .head.sha == $sha and
          (.head.repo.id | type == "number") and
          .head.repo.id == $head_repo_id and
          ((.head.repo.full_name // "") == "" or
           .head.repo.full_name == $head_repo)
        )
        end;
    .id == ($run_id | tonumber) and
    .workflow_id == ($workflow_id | tonumber) and
    (.path == $path or
     ((.path | startswith($path + "@")) and
      ((.path | length) > (($path | length) + 1)))) and
    .event == $event and
    .status == "completed" and
    .conclusion == "failure" and
    .head_sha == $run_sha and
    .head_branch == $run_head_branch and
    (.created_at | type == "string") and
    .created_at <= $before and
    run_binds_to_pr
' <<<"${final_run_json}" >/dev/null || fail "The exact failed CLA run is no longer eligible"
validate_run_source_binding "${final_run_json}"
if [[ "${run_has_pull_request_association}" != true &&
      "${run_execution_sha}" != "${head_sha}" ]]; then
  # The association shape can change between API reads. Refresh the source
  # check before deriving the job binding when the fallback is still needed.
  refresh_source_check_bindings
fi
set_run_job_binding "${run_execution_sha}"

# Fetch the complete bounded job set for one exact run. The rerun endpoint
# requires actions:write, so discovery must fail closed if pagination or shape
# checks cannot prove that every failed job belongs to this CLA workflow.
# The workflow-run response is authoritative for workflow name, head branch,
# and source repository. GitHub's jobs endpoint does not document those fields
# and omits them in production, so job validation uses only its documented
# identity fields, plus optional source metadata when GitHub supplies it.
fetch_jobs_for_run() {
  local target_run_id="$1"
  local page_json page_count page2_json page2_count
  page_json="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --raw-field per_page=100 \
    --raw-field page=1 \
    "repos/${GH_REPO}/actions/runs/${target_run_id}/jobs" 2>/dev/null)" || return 1
  jq -e 'type == "object" and (.jobs | type == "array")' <<<"${page_json}" >/dev/null || return 1
  page_count="$(jq -r '.jobs | length' <<<"${page_json}")"
  [[ "${page_count}" =~ ^[0-9]+$ ]] || return 1
  (( page_count <= 100 )) || return 1
  if (( page_count == 100 )); then
    page2_json="$(gh api \
      --method GET \
      --header 'Accept: application/vnd.github+json' \
      --raw-field per_page=100 \
      --raw-field page=2 \
      "repos/${GH_REPO}/actions/runs/${target_run_id}/jobs" 2>/dev/null)" || return 1
    jq -e 'type == "object" and (.jobs | type == "array")' <<<"${page2_json}" >/dev/null || return 1
    page2_count="$(jq -r '.jobs | length' <<<"${page2_json}")"
    [[ "${page2_count}" =~ ^[0-9]+$ ]] || return 1
    (( page2_count <= 100 )) || return 1
    page_json="$(jq -c --argjson page2 "${page2_json}" '.jobs += $page2.jobs' <<<"${page_json}")"
    (( page2_count < 100 )) || return 1
  fi
  jq -c '[.]' <<<"${page_json}"
}

jobs_json="$(fetch_jobs_for_run "${run_id}")" || fail "Could not query and validate jobs for the selected CLA run"

# Validate every failed job before granting the state-changing API call. The
# v3 writer, required result, and migration compatibility jobs are the only
# failures this helper may replay. If the writer or compatibility job failed,
# use the failed-jobs endpoint so GitHub refreshes every head-bound context;
# otherwise replay only the required result job. Any extra failure,
# cancellation, malformed job, or stale source identity aborts the request.
validate_failed_job_set() {
  local payload="$1"
  local all_jobs_json failed_jobs_json failed_count nonfailure_count
  local unexpected_count assistant_count assistant_valid_count writer_count writer_valid_count
  local compatibility_count compatibility_valid_count
  if ! all_jobs_json="$(jq -c '[.[] | .jobs[]?]' <<<"${payload}")"; then
    fail "Could not flatten jobs for the selected CLA run"
  fi
  jq -e \
    --arg run_id "${run_id}" \
    'type == "array" and all(.[];
      (.id | type == "number") and
      .id > 0 and
      (.run_id | type == "number") and
      .run_id == ($run_id | tonumber) and
      (.name | type == "string") and
      (.status == "completed") and
      (.conclusion | type == "string")
    )' <<<"${all_jobs_json}" >/dev/null || fail "The selected CLA run contains a malformed or incomplete job"

  failed_jobs_json="$(jq -c '[.[] | select(.conclusion != "success" and .conclusion != "skipped")]' <<<"${all_jobs_json}")"
  failed_count="$(jq -r 'length' <<<"${failed_jobs_json}")"
  [[ "${failed_count}" =~ ^[0-9]+$ ]] || fail "Could not count failed jobs for the selected CLA run"
  nonfailure_count="$(jq -r '[.[] | select(.conclusion != "failure")] | length' <<<"${failed_jobs_json}")"
  (( nonfailure_count == 0 )) || fail "The selected CLA run contains a cancelled or non-failure job; refusing to rerun it"
  unexpected_count="$(jq -r \
    --arg assistant_job "${CLA_ASSISTANT_JOB}" \
    --arg writer_job "${CLA_WRITER_JOB}" \
    --arg compatibility_job "${CLA_COMPATIBILITY_JOB}" \
    '[.[] | select(.name != $assistant_job and .name != $writer_job and .name != $compatibility_job)] | length' \
    <<<"${failed_jobs_json}")"
  (( unexpected_count == 0 )) || fail "The selected CLA run contains an unexpected failed job; refusing to rerun it"

  if ! assistant_count="$(jq -r \
      --arg assistant_job "${CLA_ASSISTANT_JOB}" \
      '[.[] | select(.name == $assistant_job)] | length' <<<"${failed_jobs_json}")" ||
     ! assistant_valid_count="$(jq -r \
       --arg run_id "${run_id}" \
       --arg run_sha "${run_job_sha}" \
       --arg head_repo "${head_repo}" \
       --argjson head_repo_id "${head_repo_id}" \
       --arg assistant_job "${CLA_ASSISTANT_JOB}" \
       --arg generation_step "CLA generation ${CLA_GENERATION}" \
       '[.[] | select(
          .name == $assistant_job and
          .run_id == ($run_id | tonumber) and
          (.head_sha | type == "string") and
          .head_sha == $run_sha and
          ((has("head_repository") | not) or
           (.head_repository == null or
            ((.head_repository | type) == "object" and
             .head_repository.full_name == $head_repo and
             .head_repository.id == $head_repo_id))) and
          any(.steps[]?;
            .name == $generation_step and
            .status == "completed"
          )
       )] | length' <<<"${failed_jobs_json}")"; then
    fail "Could not validate failed CLA Assistant v3 jobs"
  fi
  [[ "${assistant_count}" =~ ^[0-9]+$ && "${assistant_valid_count}" =~ ^[0-9]+$ ]] || fail "Could not count failed CLA Assistant v3 jobs"
  (( assistant_count == 1 )) || fail "Expected exactly one failed CLA Assistant v3 job"
  (( assistant_valid_count == 1 )) || fail "The selected failed CLA check was created by an older workflow generation. Push a new commit or close and reopen this pull request to create a current-generation CLA check, then post the exact signing declaration again."

  if ! writer_count="$(jq -r \
      --arg writer_job "${CLA_WRITER_JOB}" \
      '[.[] | select(.name == $writer_job)] | length' <<<"${failed_jobs_json}")" ||
     ! writer_valid_count="$(jq -r \
       --arg run_id "${run_id}" \
       --arg run_sha "${run_job_sha}" \
       --arg head_repo "${head_repo}" \
       --argjson head_repo_id "${head_repo_id}" \
       --arg writer_job "${CLA_WRITER_JOB}" \
       '[.[] | select(
          .name == $writer_job and
          .run_id == ($run_id | tonumber) and
          (.head_sha | type == "string") and
          .head_sha == $run_sha and
          ((has("head_repository") | not) or
           (.head_repository == null or
            ((.head_repository | type) == "object" and
             .head_repository.full_name == $head_repo and
             .head_repository.id == $head_repo_id)))
       )] | length' <<<"${failed_jobs_json}")"; then
    fail "Could not validate failed CLA ledger writer jobs"
  fi
  [[ "${writer_count}" =~ ^[0-9]+$ && "${writer_valid_count}" =~ ^[0-9]+$ ]] || fail "Could not count failed CLA ledger writer jobs"
  (( writer_count <= 1 )) || fail "The selected CLA run contains multiple failed CLA ledger writer jobs"
  (( writer_valid_count == writer_count )) || fail "The failed CLA ledger writer job is malformed or bound to a different source"

  compatibility_count="$(jq -r --arg compatibility_job "${CLA_COMPATIBILITY_JOB}" '[.[] | select(.name == $compatibility_job)] | length' <<<"${failed_jobs_json}")"
  if ! compatibility_valid_count="$(jq -r \
      --arg run_id "${run_id}" \
      --arg run_sha "${run_job_sha}" \
      --arg head_repo "${head_repo}" \
      --argjson head_repo_id "${head_repo_id}" \
      --arg compatibility_job "${CLA_COMPATIBILITY_JOB}" \
      '[.[] | select(
         .name == $compatibility_job and
         .run_id == ($run_id | tonumber) and
         (.head_sha | type == "string") and
         .head_sha == $run_sha and
         ((has("head_repository") | not) or
          (.head_repository == null or
           ((.head_repository | type) == "object" and
            .head_repository.full_name == $head_repo and
            .head_repository.id == $head_repo_id)))
      )] | length' <<<"${failed_jobs_json}")"; then
    fail "Could not validate failed CLA compatibility jobs"
  fi
  [[ "${compatibility_count}" =~ ^[0-9]+$ && "${compatibility_valid_count}" =~ ^[0-9]+$ ]] || fail "Could not count failed CLA compatibility jobs"
  (( compatibility_count <= 1 )) || fail "The selected CLA run contains multiple failed compatibility jobs"
  (( compatibility_valid_count == compatibility_count )) || fail "The failed CLA compatibility job is malformed or bound to a different source"
  if (( writer_count == 1 || compatibility_count == 1 )); then
    RERUN_FAILED_JOBS=true
  else
    RERUN_FAILED_JOBS=false
  fi
}
validate_failed_job_set "${jobs_json}"
if ! cla_job_json="$(jq -c \
    --arg run_id "${run_id}" \
    --arg run_sha "${run_job_sha}" \
    --arg assistant_job "${CLA_ASSISTANT_JOB}" \
    --arg generation_step "CLA generation ${CLA_GENERATION}" \
    --arg head_repo "${head_repo}" \
    --argjson head_repo_id "${head_repo_id}" \
    '[.[] | .jobs[]?
      | select(
          (.run_id | tostring) == $run_id and
          .name == $assistant_job and
          .status == "completed" and
          .conclusion == "failure" and
          (.head_sha | type == "string") and
          .head_sha == $run_sha and
          (
            .head_repository == null or
            (.head_repository.full_name == $head_repo and
             .head_repository.id == $head_repo_id)
          ) and
          any(.steps[]?;
            .name == $generation_step and
            .status == "completed"
          )
        )
    ]
    | if length == 1 then .[0] else empty end
  ' <<<"${jobs_json}")"; then
  fail "Could not validate CLA Assistant v3 job data"
fi
if [[ -z "${cla_job_json}" ]]; then
  # The run matched the current PR and failed, but no job carried
  # this workflow generation marker. It is an old or malformed
  # generation and must not be replayed with the privileged token.
  fail "The selected failed CLA check was created by an older workflow generation. Push a new commit or close and reopen this pull request to create a current-generation CLA check, then post the exact signing declaration again."
fi
job_id="$(jq -r '.id // empty' <<<"${cla_job_json}")"
safe_id "${job_id}" || fail "The selected CLA job ID is invalid or unsafe"
if [[ "${source_sha_fallback}" == true ]]; then
  source_check_binding_for_job "${run_id}" "${job_id}" ||
    fail "The selected CLA job is not the job bound to the current pull request head"
fi

# Re-read the individual job. The jobs list is discovery only, just
# like the workflow-run list above.
job_json="$(gh api "repos/${GH_REPO}/actions/jobs/${job_id}" 2>/dev/null)" || fail "Could not query the selected CLA Assistant v3 job"
jq -e \
  --arg job_id "${job_id}" \
  --arg run_id "${run_id}" \
  --arg run_sha "${run_job_sha}" \
  --arg assistant_job "${CLA_ASSISTANT_JOB}" \
  --arg generation_step "CLA generation ${CLA_GENERATION}" \
  --arg head_repo "${head_repo}" \
  --argjson head_repo_id "${head_repo_id}" '
    .id == ($job_id | tonumber) and
    .run_id == ($run_id | tonumber) and
    .name == $assistant_job and
    .status == "completed" and
    .conclusion == "failure" and
    (.head_sha | type == "string") and
    .head_sha == $run_sha and
    (
      (has("head_repository") | not) or
      .head_repository == null or
      ((.head_repository | type) == "object" and
       .head_repository.full_name == $head_repo and
       .head_repository.id == $head_repo_id)
    ) and
    any(.steps[]?;
      .name == $generation_step and
      .status == "completed"
    )
  ' <<<"${job_json}" >/dev/null || fail "The selected CLA Assistant v3 job no longer matches the failed job in this run"

# Recheck both resources immediately before the state-changing call.
# This prevents a push or a concurrent rerun from making the job
# stale while the preceding API requests were in flight.
latest_pr_json="$(gh api "repos/${GH_REPO}/pulls/${PR_NUMBER}" 2>/dev/null)" || fail "Could not recheck the pull request before rerun"
jq -e --arg repo "${GH_REPO}" --argjson number "${PR_NUMBER}" --arg sha "${head_sha}" --arg base "${TARGET_BASE_REF}" --arg head_ref "${head_ref}" --arg head_repo "${head_repo}" --argjson head_repo_id "${head_repo_id}" --argjson base_repo_id "${repo_id}" --arg opener "${pr_author_login}" '
  .number == $number and
  .state == "open" and
  .base.ref == $base and
  .base.repo.full_name == $repo and
  .base.repo.id == $base_repo_id and
  .head.sha == $sha and
  .head.ref == $head_ref and
  .head.repo.full_name == $head_repo and
  .head.repo.id == $head_repo_id and
  .user.login == $opener
' <<<"${latest_pr_json}" >/dev/null || fail "The pull request changed while selecting the CLA job"
final_job_json="$(gh api "repos/${GH_REPO}/actions/jobs/${job_id}" 2>/dev/null)" || fail "Could not recheck the selected CLA job"
jq -e \
  --arg job_id "${job_id}" \
  --arg run_id "${run_id}" \
  --arg run_sha "${run_job_sha}" \
  --arg assistant_job "${CLA_ASSISTANT_JOB}" \
  --arg generation_step "CLA generation ${CLA_GENERATION}" \
  --arg head_repo "${head_repo}" \
  --argjson head_repo_id "${head_repo_id}" '
    .id == ($job_id | tonumber) and
    .run_id == ($run_id | tonumber) and
    .name == $assistant_job and
    .status == "completed" and
    .conclusion == "failure" and
    (.head_sha | type == "string") and
    .head_sha == $run_sha and
    (
      (has("head_repository") | not) or
      .head_repository == null or
      ((.head_repository | type) == "object" and
       .head_repository.full_name == $head_repo and
       .head_repository.id == $head_repo_id)
    ) and
    any(.steps[]?;
      .name == $generation_step and
      .status == "completed"
    )
' <<<"${final_job_json}" >/dev/null || fail "The exact failed CLA Assistant v3 job is no longer eligible"
if [[ "${source_sha_fallback}" == true ]]; then
  source_check_binding_for_job "${run_id}" "${job_id}" ||
    fail "The selected CLA job is no longer bound to the current pull request head"
fi

# Re-fetch the whole job set immediately before the state-changing call. This
# catches a newly cancelled or unrelated failed job that could otherwise be
# pulled into a failed-jobs rerun after the first validation.
final_jobs_json="$(fetch_jobs_for_run "${run_id}")" || fail "Could not recheck and validate jobs for the selected CLA run"
validate_failed_job_set "${final_jobs_json}"
final_job_id="$(jq -r \
  --arg run_id "${run_id}" \
  --arg run_sha "${run_job_sha}" \
  --arg assistant_job "${CLA_ASSISTANT_JOB}" \
  --arg generation_step "CLA generation ${CLA_GENERATION}" \
  --arg head_repo "${head_repo}" \
  --argjson head_repo_id "${head_repo_id}" \
  '[.[] | .jobs[]? | select(
      .run_id == ($run_id | tonumber) and
      .name == $assistant_job and
      .status == "completed" and
      .conclusion == "failure" and
      (.head_sha | type == "string") and
      .head_sha == $run_sha and
      ((has("head_repository") | not) or
       (.head_repository == null or
        ((.head_repository | type) == "object" and
         .head_repository.full_name == $head_repo and
         .head_repository.id == $head_repo_id))) and
      any(.steps[]?;
        .name == $generation_step and
        .status == "completed"
      )
    )]
    | if length == 1 then .[0].id else empty end' <<<"${final_jobs_json}")"
[[ "${final_job_id}" == "${job_id}" ]] || fail "The selected CLA job changed while preparing the rerun"

# Repeat the positive live-PR association check after all discovery
# calls. A second open PR for the same fork ref and SHA must stop the
# rerun even if it appeared while the earlier checks were running.
validate_live_open_head_association

# Revalidate the exact comment and persisted signature after every discovery
# request. This closes the final comment and ledger TOCTOU window before the
# Actions API mutation.
validate_live_triggering_comment
if [[ "${COMMENT_BODY}" == "I have read the CLA Document v2.2 and I hereby sign the CLA" ]]; then
  validate_triggering_signature_record
elif [[ "${COMMENT_AUTHOR_ID}" != "${pr_author_id}" ]]; then
  case "${LIVE_COMMENT_ASSOCIATION}" in
    OWNER|MEMBER|COLLABORATOR) ;;
    *) fail "Only the pull request author or a trusted repository participant may request a CLA rerun" ;;
  esac
fi
# Reconfirm that this exact source head is still the one open pull request
# immediately before the Actions mutation. The API cannot provide a
# transaction, so this is the narrowest practical final race window.
validate_live_open_head_association
if [[ "${source_sha_fallback}" == true ]]; then
  # Re-read the source check immediately before the mutation. This keeps the
  # run/job binding from becoming stale while the PR and job checks execute.
  refresh_source_check_bindings
  source_check_binding_for_job "${run_id}" "${job_id}" ||
    fail "The selected CLA job is no longer bound to the current pull request head"
fi

if [[ "${RERUN_FAILED_JOBS}" == true ]]; then
  rerun_endpoint="repos/${GH_REPO}/actions/runs/${run_id}/rerun-failed-jobs"
  rerun_description="failed CLA v3 jobs (writer, assistant, and compatibility)"
else
  rerun_endpoint="repos/${GH_REPO}/actions/jobs/${job_id}/rerun"
  rerun_description="CLA job ${job_id}"
fi
if ! gh api \
  --method POST \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  "${rerun_endpoint}" >/dev/null 2>&1; then
  fail "Could not rerun the exact failed CLA job set"
fi
echo "Requested rerun for ${rerun_description} in workflow run ${run_id} at execution ${run_execution_sha} for PR head ${head_sha}"
