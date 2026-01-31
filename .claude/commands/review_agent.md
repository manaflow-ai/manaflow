---
description: Run code review with codex and analyze against project guidelines
allowed-tools: Bash(codex:*), Read
---

Read the project review guidelines from REVIEW.md at the project root.

Then run codex code review against main branch (timeout 5 minutes):

```
codex review --base main -c model="gpt-5.2" -c model_reasoning_effort="xhigh"
```

Analyze the codex findings against the review guidelines and address any issues found.
