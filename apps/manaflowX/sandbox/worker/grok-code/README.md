# @xai-official/grok (darwin-arm64)

Prebuilt Grok CLI

## Install

```bash
npm i -g @xai-official/grok
```

## Usage

```bash
grok --help
```

On startup the CLI may print a non-blocking hint if a newer version is
available on npm. To upgrade:

```bash
npm i -g @xai-official/grok@latest
```

## Supported platforms

- darwin-arm64 (Apple Silicon)

## Build and publish (maintainers)

- Build binary on macOS arm64:
  ```bash
  cargo build -p the-tui --release
  # binary at x/ivan/grok-tui/target/release/the-tui
  ```
- Package and publish:
  ```bash
  cd x/ivan/grok-tui/npm/grok
  npm publish
  ```

If your binary is in a non-default location, export:

```bash
export GROK_DARWIN_ARM64=/abs/path/to/the-tui
```
