# Makefile for devsh CLI

VERSION ?= 0.1.0
COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

# Auth configuration (required for production builds)
# Set these via environment or make arguments:
#   make build-npm STACK_PROJECT_ID=... STACK_PUBLISHABLE_CLIENT_KEY=... CMUX_API_URL=... CONVEX_SITE_URL=...
# These same env vars can also be used at runtime to override build-time values.
STACK_PROJECT_ID ?=
STACK_PUBLISHABLE_CLIENT_KEY ?=
CMUX_API_URL ?=
CONVEX_SITE_URL ?=
CMUX_SERVER_URL ?=

# Package path for ldflags
AUTH_PKG := github.com/karlorz/devsh/internal/auth

# Strip debug info and disable DWARF for smaller binaries
# Mode=prod ensures production defaults are used
LDFLAGS := -s -w \
           -X main.Version=$(VERSION) \
           -X main.Commit=$(COMMIT) \
           -X main.BuildTime=$(BUILD_TIME) \
           -X main.Mode=prod \
           -X '$(AUTH_PKG).ProjectID=$(STACK_PROJECT_ID)' \
           -X '$(AUTH_PKG).PublishableKey=$(STACK_PUBLISHABLE_CLIENT_KEY)' \
           -X '$(AUTH_PKG).CmuxURL=$(CMUX_API_URL)' \
           -X '$(AUTH_PKG).ConvexSiteURL=$(CONVEX_SITE_URL)' \
           -X '$(AUTH_PKG).ServerURL=$(CMUX_SERVER_URL)'

.PHONY: help build clean test install install-dev install-prod fmt lint run deps build-all build-npm \
        npm-version npm-publish npm-publish-dry npm-publish-devsh npm-publish-devsh-dry

help:
	@echo "devsh Makefile targets"
	@echo ""
	@echo "Build and install:"
	@echo "  make build                     Build devsh binary"
	@echo "  make install-dev               Build dev mode binary and install to ~/.local/bin/devsh"
	@echo "  make build-prod                Build production binary (requires STACK_* and CMUX_* env vars)"
	@echo "  make install-prod              Build production binary and install to ~/.local/bin/devsh"
	@echo ""
	@echo "npm publish:"
	@echo "  Required order:"
	@echo "    1) make npm-version VERSION=x.y.z"
	@echo "    2) make npm-publish-dry"
	@echo "    3) make npm-publish"
	@echo ""
	@echo "From repo root (recommended wrapper targets):"
	@echo "  1) cd packages/devsh && make npm-version VERSION=x.y.z"
	@echo "  2) make devsh-npm-republish-prod-dry DEVSH_NPM_VERSION=x.y.z"
	@echo "  3) make devsh-npm-republish-prod DEVSH_NPM_VERSION=x.y.z"

build:
	go build -ldflags "$(LDFLAGS)" -o bin/devsh ./cmd/devsh

install: build
	cp bin/devsh /usr/local/bin/devsh

clean:
	rm -rf bin/
	rm -f npm/darwin-arm64/bin/devsh npm/darwin-x64/bin/devsh
	rm -f npm/linux-arm64/bin/devsh npm/linux-x64/bin/devsh
	rm -f npm/win32-x64/bin/devsh.exe

test:
	go test -v ./...

fmt:
	go fmt ./...

lint:
	golangci-lint run

deps:
	go mod download
	go mod tidy

run: build
	./bin/devsh

# Build for all platforms (standalone)
build-all:
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/devsh-darwin-amd64 ./cmd/devsh
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/devsh-darwin-arm64 ./cmd/devsh
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/devsh-linux-amd64 ./cmd/devsh
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/devsh-linux-arm64 ./cmd/devsh
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/devsh-windows-amd64.exe ./cmd/devsh

# Build binaries for npm packages
build-npm:
	@echo "Building npm packages..."
	@mkdir -p npm/darwin-arm64/bin npm/darwin-x64/bin npm/linux-arm64/bin npm/linux-x64/bin npm/win32-x64/bin
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/darwin-arm64/bin/devsh ./cmd/devsh
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/darwin-x64/bin/devsh ./cmd/devsh
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/linux-arm64/bin/devsh ./cmd/devsh
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/linux-x64/bin/devsh ./cmd/devsh
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/win32-x64/bin/devsh.exe ./cmd/devsh
	@chmod +x npm/devsh/bin/devsh
	@echo "Done! Binaries built in npm/*/bin/"

# Update version in all npm package.json files
npm-version:
	@echo "Updating npm package versions to $(VERSION)..."
	@for pkg in devsh darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-x64; do \
		if [ -f "npm/$$pkg/package.json" ]; then \
			sed -i '' 's/"version": "[^"]*"/"version": "$(VERSION)"/' npm/$$pkg/package.json; \
			if [ "$$pkg" = "devsh" ]; then \
				sed -i '' 's/"devsh-darwin-arm64": "[^"]*"/"devsh-darwin-arm64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"devsh-darwin-x64": "[^"]*"/"devsh-darwin-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"devsh-linux-arm64": "[^"]*"/"devsh-linux-arm64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"devsh-linux-x64": "[^"]*"/"devsh-linux-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"devsh-win32-x64": "[^"]*"/"devsh-win32-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
			fi; \
		fi; \
	done
	@echo "Done!"

# Publish to npm (run build-npm first)
npm-publish: build-npm
	@echo "Publishing to npm..."
	@echo "1. Publishing platform packages..."
	cd npm/darwin-arm64 && npm publish --access public
	cd npm/darwin-x64 && npm publish --access public
	cd npm/linux-arm64 && npm publish --access public
	cd npm/linux-x64 && npm publish --access public
	cd npm/win32-x64 && npm publish --access public
	@echo "2. Publishing main package..."
	cd npm/devsh && npm publish --access public
	@echo "Done!"

# Dry-run publish (for testing)
npm-publish-dry: build-npm
	@echo "Dry-run publishing to npm..."
	cd npm/darwin-arm64 && npm publish --access public --dry-run
	cd npm/darwin-x64 && npm publish --access public --dry-run
	cd npm/linux-arm64 && npm publish --access public --dry-run
	cd npm/linux-x64 && npm publish --access public --dry-run
	cd npm/win32-x64 && npm publish --access public --dry-run
	cd npm/devsh && npm publish --access public --dry-run
	@echo "Done!"

# =============================================================================
# Environment-specific builds
# =============================================================================

# Path to .env file (searches up from current dir, defaults to repo root)
ENV_FILE := $(shell for d in . .. ../.. ../../..; do [ -f "$$d/.env" ] && echo "$$d/.env" && break; done)

# Dev build - reads config from .env file and bakes values into binary
# Values from .env take priority over hardcoded defaults
# Runtime env vars can still override baked-in values
# Version includes -dev suffix to distinguish from production builds
build-dev:
	@echo "Building for development (Mode=dev)..."
	@# Extract values from .env file if it exists
	$(eval DEV_CONVEX_SITE_URL := $(shell [ -f "$(ENV_FILE)" ] && grep -E '^CONVEX_SITE_URL=' "$(ENV_FILE)" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" || echo ""))
	$(eval DEV_CMUX_URL := $(shell [ -f "$(ENV_FILE)" ] && grep -E '^CMUX_API_URL=' "$(ENV_FILE)" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" || echo ""))
	$(eval DEV_SERVER_URL := $(shell [ -f "$(ENV_FILE)" ] && grep -E '^CMUX_SERVER_URL=' "$(ENV_FILE)" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" || echo ""))
	$(eval DEV_PROJECT_ID := $(shell [ -f "$(ENV_FILE)" ] && grep -E '^(STACK_PROJECT_ID|NEXT_PUBLIC_STACK_PROJECT_ID)=' "$(ENV_FILE)" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" || echo ""))
	$(eval DEV_PUBLISHABLE_KEY := $(shell [ -f "$(ENV_FILE)" ] && grep -E '^(STACK_PUBLISHABLE_CLIENT_KEY|NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY)=' "$(ENV_FILE)" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" || echo ""))
	@if [ -n "$(ENV_FILE)" ]; then \
		echo "  Loading config from: $(ENV_FILE)"; \
	else \
		echo "  No .env file found, using hardcoded defaults"; \
	fi
	@if [ -n "$(DEV_CONVEX_SITE_URL)" ]; then echo "    CONVEX_SITE_URL: $(DEV_CONVEX_SITE_URL)"; fi
	@if [ -n "$(DEV_CMUX_URL)" ]; then echo "    CMUX_API_URL: $(DEV_CMUX_URL)"; fi
	@if [ -n "$(DEV_SERVER_URL)" ]; then echo "    CMUX_SERVER_URL: $(DEV_SERVER_URL)"; fi
	go build -ldflags "-X main.Version=$(VERSION)-dev -X main.Commit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME) -X main.Mode=dev \
		-X '$(AUTH_PKG).ProjectID=$(DEV_PROJECT_ID)' \
		-X '$(AUTH_PKG).PublishableKey=$(DEV_PUBLISHABLE_KEY)' \
		-X '$(AUTH_PKG).CmuxURL=$(DEV_CMUX_URL)' \
		-X '$(AUTH_PKG).ConvexSiteURL=$(DEV_CONVEX_SITE_URL)' \
		-X '$(AUTH_PKG).ServerURL=$(DEV_SERVER_URL)'" \
		-o bin/devsh ./cmd/devsh
	@echo "Dev build complete: bin/devsh"

# Install dev build to user directory (matches install-cloudrouter-dev pattern)
install-dev: build-dev
	@mkdir -p ~/.local/bin
	@cp bin/devsh ~/.local/bin/devsh
	@# Clear macOS extended attributes (com.apple.provenance can cause hangs)
	@xattr -c ~/.local/bin/devsh 2>/dev/null || true
	@echo "Installed to ~/.local/bin/devsh"
	@if ! echo "$$PATH" | grep -q "$$HOME/.local/bin"; then \
		echo ""; \
		echo "Add to your shell profile (~/.zshrc or ~/.bashrc):"; \
		echo '  export PATH="$$HOME/.local/bin:$$PATH"'; \
	else \
		echo "Run 'devsh --version' to verify."; \
	fi

# Staging build - bakes in staging config
# REQUIRED: STAGING_CONVEX_URL must be explicitly set to prevent fallback to prod
# Override with: make build-staging STAGING_PROJECT_ID=... STAGING_CMUX_URL=... STAGING_CONVEX_URL=...
STAGING_PROJECT_ID ?= $(STACK_PROJECT_ID)
STAGING_PUBLISHABLE_KEY ?= $(STACK_PUBLISHABLE_CLIENT_KEY)
STAGING_CMUX_URL ?= https://staging.karldigi.dev
# No default - must be explicitly set
STAGING_CONVEX_URL ?=

build-staging:
	@echo "Building for staging..."
	@if [ -z "$(STAGING_PROJECT_ID)" ]; then echo "Error: STAGING_PROJECT_ID is required (or set STACK_PROJECT_ID)"; exit 1; fi
	@if [ -z "$(STAGING_PUBLISHABLE_KEY)" ]; then echo "Error: STAGING_PUBLISHABLE_KEY is required (or set STACK_PUBLISHABLE_CLIENT_KEY)"; exit 1; fi
	@if [ -z "$(STAGING_CONVEX_URL)" ]; then echo "Error: STAGING_CONVEX_URL is required to prevent accidental prod fallback"; exit 1; fi
	go build -ldflags "-s -w \
		-X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME) -X main.Mode=prod \
		-X '$(AUTH_PKG).ProjectID=$(STAGING_PROJECT_ID)' \
		-X '$(AUTH_PKG).PublishableKey=$(STAGING_PUBLISHABLE_KEY)' \
		-X '$(AUTH_PKG).CmuxURL=$(STAGING_CMUX_URL)' \
		-X '$(AUTH_PKG).ConvexSiteURL=$(STAGING_CONVEX_URL)'" \
		-o bin/devsh-staging ./cmd/devsh
	@echo "Staging build complete: bin/devsh-staging"

# Production build - bakes in production config (Mode=prod)
# All config values MUST be provided via env vars or make arguments
# Override with: make build-prod STACK_PROJECT_ID=... CMUX_API_URL=... CMUX_SERVER_URL=...
build-prod:
	@echo "Building for production (Mode=prod)..."
	@if [ -z "$(STACK_PROJECT_ID)" ]; then echo "Error: STACK_PROJECT_ID is required"; exit 1; fi
	@if [ -z "$(STACK_PUBLISHABLE_CLIENT_KEY)" ]; then echo "Error: STACK_PUBLISHABLE_CLIENT_KEY is required"; exit 1; fi
	@if [ -z "$(CMUX_API_URL)" ]; then echo "Error: CMUX_API_URL is required"; exit 1; fi
	@if [ -z "$(CONVEX_SITE_URL)" ]; then echo "Error: CONVEX_SITE_URL is required"; exit 1; fi
	@if [ -z "$(CMUX_SERVER_URL)" ]; then echo "Error: CMUX_SERVER_URL is required"; exit 1; fi
	go build -ldflags "-s -w \
		-X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME) -X main.Mode=prod \
		-X '$(AUTH_PKG).ProjectID=$(STACK_PROJECT_ID)' \
		-X '$(AUTH_PKG).PublishableKey=$(STACK_PUBLISHABLE_CLIENT_KEY)' \
		-X '$(AUTH_PKG).CmuxURL=$(CMUX_API_URL)' \
		-X '$(AUTH_PKG).ConvexSiteURL=$(CONVEX_SITE_URL)' \
		-X '$(AUTH_PKG).ServerURL=$(CMUX_SERVER_URL)'" \
		-o bin/devsh ./cmd/devsh
	@echo "Production build complete: bin/devsh"

# Install prod build to user directory (for local head agent use)
install-prod: build-prod
	@mkdir -p ~/.local/bin
	@cp bin/devsh ~/.local/bin/devsh
	@# Clear macOS extended attributes (com.apple.provenance can cause hangs)
	@xattr -c ~/.local/bin/devsh 2>/dev/null || true
	@echo "Installed to ~/.local/bin/devsh (production mode)"
	@# Show version to confirm prod build
	@~/.local/bin/devsh --version

# Aliases (for root Makefile delegation)
npm-publish-devsh: npm-publish

npm-publish-devsh-dry: npm-publish-dry
