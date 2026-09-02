#!/usr/bin/env bash
set -euo pipefail

# Run the JavaScript/TypeScript test suites that do not need a service account.
# The command environment is rebuilt from an allowlist so a runner credential
# cannot reach contributor-controlled test code by accident.

readonly temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
readonly temp_prefix="${temp_root%/}"
readonly test_home="${temp_prefix}/cmux-untrusted-test-home"
readonly test_tmp="${temp_prefix}/cmux-untrusted-test-tmp"
readonly path_value="${PATH:-/usr/bin:/bin}"

mkdir -p "${test_home}/.config" "${test_tmp}"

cleanup() {
  rm -rf -- "${test_home}" "${test_tmp}"
}
trap cleanup EXIT

run_untrusted() {
  local working_directory="$1"
  shift

  (
    cd "${working_directory}"
    env -i \
      PATH="${path_value}" \
      HOME="${test_home}" \
      TMPDIR="${test_tmp}" \
      XDG_CONFIG_HOME="${test_home}/.config" \
      LANG=C.UTF-8 \
      LC_ALL=C.UTF-8 \
      CI=true \
      NO_COLOR=1 \
      GIT_TERMINAL_PROMPT=0 \
      NPM_CONFIG_IGNORE_SCRIPTS=true \
      GITHUB_TOKEN= \
      ACTIONS_RUNTIME_TOKEN= \
      ACTIONS_ID_TOKEN_REQUEST_TOKEN= \
      AWS_ACCESS_KEY_ID= \
      AWS_SECRET_ACCESS_KEY= \
      AWS_SESSION_TOKEN= \
      NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:9 \
      NEXT_PUBLIC_WWW_ORIGIN=http://127.0.0.1:9 \
      NEXT_PUBLIC_STACK_PROJECT_ID=11111111-1111-4111-8111-111111111111 \
      NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=pck_pt4nwry6sdskews2pxk4g2fbe861ak2zvaf3mqendspa0 \
      NEXT_PUBLIC_GITHUB_APP_SLUG=cmux-test \
      STACK_SECRET_SERVER_KEY=ssk_untrusted_test \
      STACK_SUPER_SECRET_ADMIN_KEY=ssk_untrusted_test \
      STACK_DATA_VAULT_SECRET=01234567890123456789012345678901 \
      CMUX_GITHUB_APP_ID=1 \
      CMUX_GITHUB_APP_PRIVATE_KEY=untrusted-test-key \
      CMUX_TASK_RUN_JWT_SECRET=untrusted-test-jwt \
      MORPH_API_KEY=untrusted-test-morph \
      MORPH_API_BASE_URL=http://127.0.0.1:9 \
      CONVEX_DEPLOY_KEY=untrusted-test-convex \
      ANTHROPIC_API_KEY=untrusted-test-anthropic \
      AWS_BEARER_TOKEN_BEDROCK=untrusted-test-bedrock \
      OPENAI_API_KEY= \
      GEMINI_API_KEY= \
      "$@"
  )
}

# Client, Convex, and shared tests are deterministic and run in full.
run_untrusted . bunx vitest run --config apps/client/vitest.config.ts apps/client/src apps/client/electron
run_untrusted packages/convex bunx vitest run --config vitest.config.ts
run_untrusted . bunx vitest run packages/shared/src

# Server tests that depend on a locally built native-core addon are covered by
# the dedicated native-core workflow. The remaining server tests run here.
run_untrusted apps/server bunx vitest run --exclude '**/compareRefs.test.ts'

# Worker tests use local temporary repositories and do not need credentials.
run_untrusted apps/worker bunx vitest run

# The authenticated GitHub-repository tests and live Morph/Sandbox tests need
# service credentials. Keep the unauthenticated route assertion in this job.
run_untrusted apps/www bunx vitest run --config vitest.config.ts --exclude '**/github.repos.route.test.ts'
run_untrusted apps/www bunx vitest run --config vitest.config.ts lib/routes/github.repos.route.test.ts --testNamePattern 'rejects unauthenticated requests'

# This package checks that its publishable artifact does not leak environment
# values and does not require a service account.
run_untrusted packages/cmux bun run test
