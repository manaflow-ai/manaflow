#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_REPOSITORY='manaflow-ai/manaflow'
readonly SIGN_PHRASE='I have read the CLA Document v2.2 and I hereby sign the CLA'
readonly MAX_SAFE_INTEGER=9007199254740991
readonly MAX_COMMENT_BYTES=65536

fail() {
  echo "::error title=CLA admission::${1}" >&2
  exit 1
}

emit() {
  [[ -n "${GITHUB_OUTPUT:-}" ]] || fail 'GITHUB_OUTPUT is unavailable'
  printf '%s=%s\n' "${1}" "${2}" >>"${GITHUB_OUTPUT}"
}

safe_id() {
  local value="${1}"
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || return 1
  (( ${#value} <= 16 )) || return 1
  (( value <= MAX_SAFE_INTEGER ))
}

safe_sha() {
  [[ "${1}" =~ ^[0-9a-f]{40}$ ]]
}

nonempty() {
  [[ -n "${1}" && "${1}" != *$'\n'* && "${1}" != *$'\r'* ]]
}

same_repository() {
  [[ "$(printf '%s' "${1}" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "${EXPECTED_REPOSITORY}" | tr '[:upper:]' '[:lower:]')" ]]
}

require_event_repository() {
  nonempty "${EVENT_REPOSITORY:-}" || fail 'Event repository is missing'
  same_repository "${EVENT_REPOSITORY}" || fail 'Event repository is not manaflow-ai/manaflow'
  safe_id "${EVENT_REPOSITORY_ID:-}" || fail 'Event repository ID is invalid'
}

require_pr_number() {
  safe_id "${PR_NUMBER:-}" || fail 'Pull request number is invalid'
}

require_event_repository
require_pr_number

if [[ "${EVENT_NAME:-}" == 'issue_comment' ]]; then
  [[ "${EVENT_ACTION:-}" == 'created' ]] || fail 'Issue-comment action is not created'

  # Ordinary comments are not CLA commands. Ignore them before making any
  # privileged admission decision, while exact commands receive full live
  # identity validation below.
  if [[ "${COMMENT_BODY:-}" != 'recheck' &&
        "${COMMENT_BODY:-}" != "${SIGN_PHRASE}" ]]; then
    # GitHub Actions expression equality is case-insensitive. The workflow
    # may therefore invoke this gate for a case-variant command that is not an
    # exact declaration. Mark it explicitly so the required result job can be
    # skipped instead of manufacturing a failed check for ordinary traffic.
    emit ignored true
    emit admitted false
    echo 'CLA comment ignored: body is not an exact command'
    exit 0
  fi

  [[ "${EVENT_ISSUE_STATE:-}" == 'open' ]] || fail 'Comment is not on an open issue'
  [[ "${EVENT_ISSUE_PR_URL:-}" == "https://api.github.com/repos/${EXPECTED_REPOSITORY}/pulls/${PR_NUMBER}" ]] ||
    fail 'Comment issue is not the exact repository pull request'
  [[ "${COMMENT_AUTHOR_TYPE:-}" == 'User' ]] || fail 'Comment author is not a human user'
  nonempty "${COMMENT_AUTHOR_LOGIN:-}" || fail 'Comment author login is missing'
  [[ "$(printf '%s' "${COMMENT_AUTHOR_LOGIN}" | tr '[:upper:]' '[:lower:]')" != *'[bot]' ]] || fail 'Bot comments cannot trigger CLA'
  safe_id "${COMMENT_AUTHOR_ID:-}" || fail 'Comment author ID is invalid'
  safe_id "${COMMENT_ID:-}" || fail 'Comment ID is invalid'
  [[ "${COMMENT_CREATED_AT:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    fail 'Comment creation timestamp is invalid'
  [[ "${COMMENT_UPDATED_AT:-}" == "${COMMENT_CREATED_AT}" ]] ||
    fail 'The newly created comment is already edited'
elif [[ "${EVENT_NAME:-}" == 'pull_request_target' ]]; then
  case "${EVENT_ACTION:-}" in
    opened|edited|reopened|synchronize) ;;
    *) fail 'Pull-request action is not an accepted CLA transition' ;;
  esac
  [[ "${EVENT_PR_STATE:-}" == 'open' ]] || fail 'Pull request is not open'
else
  fail 'Event is not an accepted CLA trigger'
fi

pr_json="$(gh api \
  --method GET \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  "repos/${EXPECTED_REPOSITORY}/pulls/${PR_NUMBER}" 2>/dev/null)" ||
  fail 'Could not read the live pull request'

jq -e \
  --arg repository "${EXPECTED_REPOSITORY}" \
  --arg number "${PR_NUMBER}" \
  --argjson repository_id "${EVENT_REPOSITORY_ID}" '
    (.number | type == "number") and
    ((.number | tostring) == $number) and
    .state == "open" and
    (.merged_at == null) and
    .base.ref == "main" and
    (.base.repo | type == "object") and
    .base.repo.full_name == $repository and
    (.base.repo.id | type == "number") and
    .base.repo.id == $repository_id and
    (.base.sha | type == "string") and
    (.base.sha | test("^[0-9a-f]{40}$")) and
    (.head.ref | type == "string") and
    (.head.ref | length > 0) and
    (.head.sha | type == "string") and
    (.head.sha | test("^[0-9a-f]{40}$")) and
    (.head.repo | type == "object") and
    (.head.repo.full_name | type == "string") and
    (.head.repo.full_name | length > 0) and
    (.head.repo.id | type == "number") and
    (.head.repo.id > 0 and .head.repo.id <= 9007199254740991) and
    (.user | type == "object") and
    (.user.id | type == "number") and
    (.user.id > 0 and .user.id <= 9007199254740991) and
    (.user.login | type == "string") and
    (.user.login | length > 0)
  ' <<<"${pr_json}" >/dev/null ||
  fail 'Live pull request identity is incomplete or targets a branch other than main'

live_number="$(jq -er '.number | tostring' <<<"${pr_json}")" || fail 'Live pull request number is malformed'
live_base_sha="$(jq -er '.base.sha | strings' <<<"${pr_json}")" || fail 'Live base SHA is malformed'
live_head_sha="$(jq -er '.head.sha | strings' <<<"${pr_json}")" || fail 'Live head SHA is malformed'
live_base_ref="$(jq -er '.base.ref | strings' <<<"${pr_json}")" || fail 'Live base ref is malformed'
live_base_repo="$(jq -er '.base.repo.full_name | strings' <<<"${pr_json}")" || fail 'Live base repository is malformed'
live_base_repo_id="$(jq -er '.base.repo.id | numbers | tostring' <<<"${pr_json}")" || fail 'Live base repository ID is malformed'
live_head_ref="$(jq -er '.head.ref | strings' <<<"${pr_json}")" || fail 'Live head ref is malformed'
live_head_repo="$(jq -er '.head.repo.full_name | strings' <<<"${pr_json}")" || fail 'Live head repository is malformed'
live_head_repo_id="$(jq -er '.head.repo.id | numbers | tostring' <<<"${pr_json}")" || fail 'Live head repository ID is malformed'
live_opener_id="$(jq -er '.user.id | numbers | tostring' <<<"${pr_json}")" || fail 'Live opener ID is malformed'

[[ "${live_number}" == "${PR_NUMBER}" ]] || fail 'Live pull request number changed'
safe_sha "${live_base_sha}" || fail 'Live base SHA is invalid'
safe_sha "${live_head_sha}" || fail 'Live head SHA is invalid'
safe_id "${live_base_repo_id}" || fail 'Live base repository ID is invalid'
safe_id "${live_head_repo_id}" || fail 'Live head repository ID is invalid'
safe_id "${live_opener_id}" || fail 'Live opener ID is invalid'

if [[ "${EVENT_NAME}" == 'issue_comment' ]]; then
  comment_json="$(gh api \
    --method GET \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "repos/${EXPECTED_REPOSITORY}/issues/comments/${COMMENT_ID}" 2>/dev/null)" ||
    fail 'Could not read the live triggering comment'
  comment_body_bytes="$(jq -r '.body // empty' <<<"${comment_json}" | wc -c | tr -d '[:space:]')" ||
    fail 'Could not measure the live comment'
  [[ "${comment_body_bytes}" =~ ^[0-9]+$ && ${comment_body_bytes} -le ${MAX_COMMENT_BYTES} ]] ||
    fail 'The triggering comment is larger than the supported bound'
  jq -e \
    --arg issue_url "https://api.github.com/repos/${EXPECTED_REPOSITORY}/issues/${PR_NUMBER}" \
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
     (.user.login | length > 0 and (test("[\\r\\n]") | not)) and
     .created_at == $created_at and
     .updated_at == $created_at and
     (.author_association | type == "string" and length > 0 and (test("[\\r\\n]") | not))' <<<"${comment_json}" >/dev/null ||
    fail 'The triggering comment changed, moved, or has an invalid identity'
  jq -e \
    '.id | type == "number" and floor == . and . > 0 and . <= 9007199254740991' \
    <<<"${comment_json}" >/dev/null ||
    fail 'The triggering comment ID is outside the safe numeric range'
  live_comment_association="$(jq -er '.author_association | strings' <<<"${comment_json}")" ||
    fail 'Live comment association is malformed'
  live_comment_login="$(jq -er '.user.login | strings' <<<"${comment_json}")" ||
    fail 'Live comment author login is malformed'
  nonempty "${live_comment_login}" || fail 'Live comment author login is malformed'
  nonempty "${live_comment_association}" || fail 'Live comment association is malformed'
fi

if [[ "${EVENT_NAME}" == 'pull_request_target' ]]; then
  nonempty "${EVENT_BASE_REF:-}" || fail 'Event base ref is missing'
  nonempty "${EVENT_BASE_REPOSITORY:-}" || fail 'Event base repository is missing'
  nonempty "${EVENT_BASE_REPOSITORY_ID:-}" || fail 'Event base repository ID is missing'
  nonempty "${EVENT_BASE_SHA:-}" || fail 'Event base SHA is missing'
  nonempty "${EVENT_HEAD_REF:-}" || fail 'Event head ref is missing'
  nonempty "${EVENT_HEAD_REPOSITORY:-}" || fail 'Event head repository is missing'
  nonempty "${EVENT_HEAD_REPOSITORY_ID:-}" || fail 'Event head repository ID is missing'
  nonempty "${EVENT_HEAD_SHA:-}" || fail 'Event head SHA is missing'
  [[ "${EVENT_PR_NUMBER:-}" == "${PR_NUMBER}" ]] || fail 'Event pull request number does not match'
  [[ "${EVENT_BASE_REF}" == "${live_base_ref}" &&
     "$(printf '%s' "${EVENT_BASE_REPOSITORY}" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "${live_base_repo}" | tr '[:upper:]' '[:lower:]')" &&
     "${EVENT_BASE_REPOSITORY_ID}" == "${live_base_repo_id}" &&
     "${EVENT_BASE_SHA}" == "${live_base_sha}" &&
     "${EVENT_HEAD_REF}" == "${live_head_ref}" &&
     "$(printf '%s' "${EVENT_HEAD_REPOSITORY}" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "${live_head_repo}" | tr '[:upper:]' '[:lower:]')" &&
     "${EVENT_HEAD_REPOSITORY_ID}" == "${live_head_repo_id}" &&
     "${EVENT_HEAD_SHA}" == "${live_head_sha}" ]] ||
    fail 'Pull-request event does not match the live pull request'
fi

emit head_sha "${live_head_sha}"
emit base_sha "${live_base_sha}"

if [[ "${EVENT_NAME}" == 'issue_comment' ]]; then
  if [[ "${COMMENT_BODY}" == "${SIGN_PHRASE}" ]]; then
    emit signing true
  else
    case "${live_comment_association:-}" in
      OWNER|MEMBER|COLLABORATOR)
        emit trusted_recheck true
        ;;
      *)
        if [[ "${COMMENT_AUTHOR_ID}" == "${live_opener_id}" ]]; then
          emit trusted_recheck true
        else
          fail 'Only the pull request author or a trusted repository participant may request a CLA recheck'
        fi
        ;;
    esac
  fi
fi

emit admitted true
