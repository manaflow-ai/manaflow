# Code Review Guidelines

## General

- Do not silence errors. You should rethrow them, log them, etc. Just anything but ignore/silence them.
- Do not have stray logs
- No dead code (commented-out code, unreachable branches)

## TypeScript

- "any" or "casts" is forbidden
- Detect if useEffects have infinite loops
- No missing await - catch floating promises
- No == - use strict equality ===
- Check dependency arrays - useMemo, useCallback, not just useEffect
- No stale closures - especially in event handlers and timers
- No ! (non-null assertion) without justification. Even then, think of how you can structure your code to not even need non-null assertions at all

## Convex

- Ensure we have necessary indices
- Ensure we don't do full table scans for filters, but rather use the right index
- No external API calls in queries/mutations - use actions for side effects
- Convex has bare v8 runtime and node runtime. Think about which runtime a file is in and which APIs are allowed
- Always define argument and return validators - don't skip args: {} or use loose typing
- Don't trust client data - validate even with TypeScript types (runtime vs compile time)

## Rust

- Do not use .unwrap() in non-test code
- Prefer ? operator for error propagation
- Avoid unnecessary .clone()
- No unsafe blocks without clear justification and comment

Catch other errors too, use your best judgment.
