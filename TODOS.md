# cmux TODO Backlog

> Open items only. Completed items moved to GitHub Projects history.

## High Priority

- [ ] Copy host config files (CLAUDE.md, AGENTS.md, GEMINI.md) to workers (#20, #21)
- [ ] Update agent state on task completion/failure (#33)
- [ ] Add Grok Code provider (#36)
- [ ] Add Atlassian Rovo provider (#37)
- [ ] devsh npm publish and uvx publish (#38)

## Medium Priority

- [ ] Make MorphVSCodeInstance actually work (#26)
- [ ] Task drafts feature (#40)
- [ ] Persistent worktree-vscode.cmux.local domains (#30)
- [ ] Auto devcontainer setup (#29, #34)
- [ ] Remove containerMappings, use Convex as source of truth (#41)
- [ ] Archive tasks button in sidebar (#49)
- [ ] Green checkbox timing reliability (#48)

## UX Improvements

- [ ] Cmd+P to open multiple editors for context (#23)
- [ ] Create task without existing repo (#24)
- [ ] Cmd+V paste to unfocused editor (#60)
- [ ] Ctrl+J/K task list focus (#62)
- [ ] Bulk task actions (#66)
- [ ] TUI for task management (#64)

## Integrations

- [ ] Vercel preview environments with devcontainer (#27)
- [ ] Vercel comments → Claude Code PRs (#28)
- [ ] Stack Auth for cloud mode (#42)
- [ ] gh webhook CLI for faster git sync (#65)

## Platform

- [ ] Ship Electron app (#61)
- [ ] Native Swift mobile app (#54)
- [ ] Daytona Dockerfile deployment (#22)

## VS Code

- [ ] Copy VS Code extensions to remote (#46)
- [ ] VS Code settings/theme CLI onboarding (#47)

## Feedback Items

- [ ] Zach: Plan mode with Linear tickets, porter preview envs (#52)
- [ ] Zach2: @claude PR comment fixing via gh CLI (#53)

## Dev Notes

```bash
# Quick dev start (skip slow steps)
SKIP_CONVEX=true SKIP_DOCKER_BUILD=true ./scripts/dev.sh
```
