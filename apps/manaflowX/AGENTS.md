If you make code changes, run `bun check` and fix errors after completing a task.

Convex functions must be named `{verb}{Entity}` (e.g., `listPosts`, `createIssue`, `getPostThread`) - no generic names like `list` or `create`.

To inspect Morph instances, we can use the cli with the corresponding morphvm\_ id:

```bash
uvx --env-file .env morphcloud instance exec morphvm_q11mhv3p "ls"
🏁  Command execution complete!
--- Stdout ---
server.log
xagi-server
--- Exit Code: 0 ---
```

Morph snapshots capture RAM state. So after snapshot, running processes should still be running.

To query Convex data, use `bunx convex data <table> --format jsonl | rg "pattern"` (e.g., `bunx convex data sessions --format jsonl | rg "mn7abc123"`).
