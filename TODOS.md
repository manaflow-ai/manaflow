[x] instead of using node-pty, install openvscode directly and make an extension that lets us interact with vscode's terminal and everything via socketio. like the extension needs to expose a socketio server that we can connect to and then we can send commands to the terminal and get the output back.
[x] get rid of node-pty entirely -- do a grep/rg of it in entire codebase, then remove it from everywhere. for most places like where we resize the node-pty thing, we can just get rid of it. get rid of the stuff in frontend like $taskId.run.$runId page as well like get rid of TerminalView.tsx and TerminalContextProvider.tsx entirely; when creating a new task inside the worker (like the tmux task specifically), we can just use childproc/exec instead of node-pty.
[x] create morph snapshot
[x] copy over the credentials properly
[x] fallback if user doesn't use gh cli
[x] whenever i start typing in /dashboard, even if i'm not focused on the textinput, it should automatically start typing in the textinput (including the keys i just pressed but weren't focused on the textinput)
[x] in @apps/server/src/index.ts, we need to make a new file that contains an express app, and then put it into the createServer call. (make sure to pnpm install express in the right places) the express app's job is to be a proxy to every single DockerVSCodeInstance that ever gets spun up. The goal is if the user goes to [containerName].[port].localhost:9776/ (9776 is the server's port), it should proxy to the port number of the vscode instance. the vscode instance can run other things besides vscode on different ports, but we just colloquially call it "vscode" for now. to do this, we need to modify @apps/server/src/vscode/DockerVSCodeInstance.ts that stores the port mappings of every single vscode instance that ever gets spun up, so that it also stores the container name of the vscode instance. then, in @apps/server/src/index.ts, we can use the express app to proxy to the vscode instance. if a vscode instance is not running, we will need to start it up on the fly. while it's being spun up, we need to show the user a loading screen. once it's ready, we need to redirect the user to the vscode instance. make sure to handle when docker containers get killed and when that happens, we need to update the port mappings. port mappings should be stored in a map in @apps/server/src/vscode/DockerVSCodeInstance.ts.
[x] figure out how to use convex binary
[x] fix openai environment auth
[x] package vite app and expose via the cmux cli.
[x] add amp
[x] make indicators on /dashboard that show which providers have been properly set up. like somehow check if the right files are in the right places based on the stuff in agentConfig.ts. we also need to make a check for docker status as well as git status to see if we can reach git or not. make a socketio endpoint that exposes this information.
[x] spawn agents in parallel faster
[x] bundle convex in executable somehow
[x] default claude code bypass permissions mode
[?] git fatal unsupported ssl backend
[x] onboarding: fix cli output on first run to be pretty and not spam logs
[x] ensure all the different CLIs work, not just claude
[x] make ctrl+c work to kill cli like immediately
[ ] copy ~/.claude/CLAUDE.md (and other config files) from host to worker.
[ ] copy CLAUDE.md to AGENTS.md, GEMINI.md etc for openai, gemini, etc. if CLAUDE.md is not present, we need to figure out generalizable logic for all of this. like if any one of AGENTS.md or GEMINI.md or CLAUDE.md is present, we should copy it to the right places.
[ ] figure out intricacies of deploying the Dockerfile to daytona
[ ] make it easy to provide context to claude code by using cmd + p to open a ton of editors
[ ] make it easy to create a new task from scratch without any existing directory or git repo
[ ] figure out how to get git working, rn worktrees are intermittently broken
[ ] make MorphVSCodeInstance actually work
[ ] vercel previews but devcontainer and docker and docker compose
[ ] vercel comments but it actually just pipes it to claude code and it auto makes a PR!
[ ] auto set up devcontainers: `bun x @devcontainers/cli up --workspace-folder /root/workspace` or a custom starting script
[ ] make persistent [worktree/branchname]-vscode.cmux.local domains for each vscode container instance. the cmux.local domains also need to support mapping to the ports in each of the DockerVSCodeInstances. like [worktree/branchname]-[portnumber].cmux.local should map to the port number of the vscode instance.
[x] rename branches after a task is created to something reasonable - PR #443: MAX_BRANCH_NAME_LENGTH=60 enforced
[ ] plan mode for claude code
[ ] update state for agent when they finish a task or fail a task
[ ] run bunx `bunx @devcontainers/cli up --workspace-folder .` and iterate on the .devcontainer/dockerfile/startup script until it works
[ ] add qwen code https://x.com/oran_ge/status/1947822347517628625
[ ] add grok code
[ ] add atlassian rovo
[ ] cmux cli npm publish and uvx publish
[x] onboarding CLI flow to copy vscode themes -- this needs its own convex tables, and we need to make sure to send the right files to the right places when spawning vscode instances. - Basic theme sync implemented: VS Code now respects the app's dark/light mode setting for Docker instances - Limitation: Morph instances use pre-built snapshots and don't support dynamic theme configuration yet
[ ] drafts for tasks
[ ] remove containerMappings from @apps/server/src/vscode/DockerVSCodeInstance.ts and just use convex and/or docker daemon as source of truth.
[ ] authentication with stack auth (or somehow collect user emails) when user tries to enable cloud mode
[ ] clear local storage if we change name of models in model selector multiselect
[x] renamed branch name (eg. cmux-claude-opus-4-extract-sidebar-into-its-own-jn73r96s46gfyx860q7qaj9a1n7mnefz) is too long. fix the code so branch names are always adskfjlaksdjf - PR #443: MAX_BRANCH_NAME_LENGTH=60 enforced
[ ] fix the
[ ] copy VS Code extensions and copy
[ ] copy vs code settings/theme: make it so that when we launch the cli for the first time, it will prompt the user if they want to copy their themes and extensions from either vscode, windsurf, or cursor. the user will have to choose from the cli which one they want. then we must copy the themes/extensions to the right place in all the remote machines.
[ ] make green checkbox timing more reliable
[ ] archive tasks button in sidebar
[ ] edit prompt after seeing what it did -- try multiple prompts at same time -- if click on main one, show page that has prompt, edit prompt, and recontinue execution. less tasks, but more so like linear. instead of task, convert it to a linear timeline flow thing. just want to add tasks. dont have to switch apps -- put backlog and tasks in execution
[x] notifications for when tasks are done - PR #444: unhide notification bell (infra was 95% built, just hidden)
[ ] zach: very good prompt that includes specific fields and context. plan mode first? take linear tickets and take what it wrote and expand it on codebase. and then edit the plan... create a plan. - zach uses porter to set up preview environments
[ ] zach2: because of conductor's quirks, it can't use github cli -- bugbot + greptile (just cancelded?) -- bugbot makes good comments. would be nice to just @claude to fix it. tell claude to look at PR comments using gh cli and fix it.
[ ] native swift mobile app!
[ ] open with xcode
[ ] keep crown, remove auto-pr @austinpower1258
[ ] detectTerminalIdle fixes + tests @austinpower1258
[x] finish git diff editor
[ ] dev servers @lawrencecchen
[ ] make cmd+v paste automatically into the editor even if the editor is not focused on the home page
[ ] ship electron
[ ] make control+j/k on home page start focusing on the list of tasks.
[ ] refactor antdmultiselect to use cmdk pako
[ ] make tui that renders tasks that needs attention as well as starting tasks. should also let user configure which agents to run.
[ ] use gh webhook cli to update all git sync states faster
[ ] select multiple tasks on frontend and do bulk actions on them
[ ] notifications queue
[x] if no agents selected, error! dont spawn all at the same time - Already implemented: dashboard.tsx lines 920-927 + canSubmit check at line 1377
[x] GitHub Projects integration: add GraphQL sync to GitHub App, add "Projects" tab to dashboard (PR #398). Templates pending: cmux-dev-roadmap, cmux-feature-board at https://github.com/users/karlorz/projects

SKIP_CONVEX=true SKIP_DOCKER_BUILD=true ./scripts/dev.sh
