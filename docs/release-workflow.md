# Release workflow

The release workflow runs from the protected `main` branch on its schedule.
It creates a single-file `release/vX.Y.Z` branch, then calls
`.github/workflows/release-updates.yml` as a reusable workflow. The call carries
the exact release commit, its `main` parent, and the protected caller commit.
The publishing workflow has no `push` or `workflow_dispatch` entrypoint, so the
pre-merge release call is the single source of the tag and its artifacts.

This removes the manual and post-merge paths that could otherwise select
arbitrary branch code or publish the same version twice. Outside the schedule,
wait for the next scheduled run or rerun a failed release job after confirming
that its captured base commit is still reachable from protected `main`.
The eventual merge commit does not start another publication or move the tag.
Retries can reuse a draft release without a tag only when its target commit
matches the captured release SHA.
Change detection reads the highest version tag directly, so merge-commit,
squash, and rebase strategies do not change the release source.
Keep the generated release branch and draft PR unchanged until all artifact
jobs finish. If either was merged, deleted, or force-pushed, start a new release
instead of rerunning the old one.

The trust gate rejects stale or moved refs, workflow changes, non-bot release
commits, and release commits that change files other than
`apps/client/package.json`. Keep `main` protected and configure non-empty
required reviewers for the `electron` environment before relying on publication.
Build jobs read signing and build values from that environment in the called
workflow. The caller does not use `secrets: inherit`, so unrelated repository
secrets do not cross the workflow boundary.
