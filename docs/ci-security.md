# CI security boundary

Pull requests run `.github/workflows/tests.yml`. That workflow uses the
read-only `pull_request` event, grants only `contents: read`, disables package
lifecycle scripts, and does not bind an environment or a secret.

The full integration suite runs from
`.github/workflows/tests-trusted.yml`. It is triggered only by a push to
`main`, checks out the immutable push SHA, and is the only test workflow that
uses the `dev` environment. A pull request must therefore be merged before its
code can run with development credentials.

Do not change the trusted workflow to `pull_request_target`, or check out a
pull request head from a secret-bearing job. Those patterns execute
contributor-controlled code with repository credentials.

The workflow contract is verified by
`scripts/ci/verify-workflow-secret-boundary.rb` from the read-only `Checks`
workflow. Keep that test green when adding a workflow trigger or a secret.
