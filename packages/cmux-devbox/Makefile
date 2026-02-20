# Makefile for cmux devbox CLI

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

# Package path for ldflags
AUTH_PKG := github.com/cmux-cli/cmux-devbox/internal/auth

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
           -X '$(AUTH_PKG).ConvexSiteURL=$(CONVEX_SITE_URL)'

.PHONY: build clean test install fmt lint run deps build-all build-npm npm-publish

build:
	go build -ldflags "$(LDFLAGS)" -o bin/cmux-devbox ./cmd/cmux-devbox

install: build
	cp bin/cmux-devbox /usr/local/bin/cmux-devbox

clean:
	rm -rf bin/
	rm -rf npm/*/bin/cmux npm/*/bin/cmux.exe

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
	./bin/cmux-devbox

# Build for all platforms (standalone)
build-all:
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-devbox-darwin-amd64 ./cmd/cmux-devbox
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-devbox-darwin-arm64 ./cmd/cmux-devbox
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-devbox-linux-amd64 ./cmd/cmux-devbox
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-devbox-linux-arm64 ./cmd/cmux-devbox
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-devbox-windows-amd64.exe ./cmd/cmux-devbox

# Build binaries for npm packages
build-npm:
	@echo "Building npm packages..."
	@mkdir -p npm/darwin-arm64/bin npm/darwin-x64/bin npm/linux-arm64/bin npm/linux-x64/bin npm/win32-x64/bin
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/darwin-arm64/bin/cmux ./cmd/cmux-devbox
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/darwin-x64/bin/cmux ./cmd/cmux-devbox
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/linux-arm64/bin/cmux ./cmd/cmux-devbox
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/linux-x64/bin/cmux ./cmd/cmux-devbox
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/win32-x64/bin/cmux.exe ./cmd/cmux-devbox
	@chmod +x npm/cmux/bin/cmux
	@echo "Done! Binaries built in npm/*/bin/"

# Update version in all npm package.json files
npm-version:
	@echo "Updating npm package versions to $(VERSION)..."
	@for pkg in cmux darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-x64; do \
		if [ -f "npm/$$pkg/package.json" ]; then \
			sed -i '' 's/"version": "[^"]*"/"version": "$(VERSION)"/' npm/$$pkg/package.json; \
			if [ "$$pkg" = "cmux" ]; then \
				sed -i '' 's/"cmux-darwin-arm64": "[^"]*"/"cmux-darwin-arm64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"cmux-darwin-x64": "[^"]*"/"cmux-darwin-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"cmux-linux-arm64": "[^"]*"/"cmux-linux-arm64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"cmux-linux-x64": "[^"]*"/"cmux-linux-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"cmux-win32-x64": "[^"]*"/"cmux-win32-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
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
	cd npm/cmux && npm publish --access public
	@echo "Done!"

# Dry-run publish (for testing)
npm-publish-dry: build-npm
	@echo "Dry-run publishing to npm..."
	cd npm/darwin-arm64 && npm publish --access public --dry-run
	cd npm/darwin-x64 && npm publish --access public --dry-run
	cd npm/linux-arm64 && npm publish --access public --dry-run
	cd npm/linux-x64 && npm publish --access public --dry-run
	cd npm/win32-x64 && npm publish --access public --dry-run
	cd npm/cmux && npm publish --access public --dry-run
	@echo "Done!"

# =============================================================================
# Environment-specific builds
# =============================================================================

# Dev build - sets Mode=dev which causes auth package to use dev defaults:
#   - CMUX_API_URL -> http://localhost:9779
#   - CONVEX_SITE_URL -> https://famous-camel-162.convex.site (dev deployment)
# Runtime override still works: CMUX_API_URL=http://custom:port cmux ...
build-dev:
	@echo "Building for development (Mode=dev)..."
	@echo "  Dev defaults: localhost:9779, famous-camel-162.convex.site"
	go build -ldflags "-X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME) -X main.Mode=dev" \
		-o bin/cmux-devbox ./cmd/cmux-devbox
	@echo "Dev build complete: bin/cmux-devbox"

# Staging build - bakes in staging config
# REQUIRED: STAGING_CONVEX_URL must be explicitly set to prevent fallback to prod
# Override with: make build-staging STAGING_PROJECT_ID=... STAGING_CMUX_URL=... STAGING_CONVEX_URL=...
STAGING_PROJECT_ID ?= $(STACK_PROJECT_ID)
STAGING_PUBLISHABLE_KEY ?= $(STACK_PUBLISHABLE_CLIENT_KEY)
STAGING_CMUX_URL ?= https://staging.manaflow.com
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
		-o bin/cmux-devbox-staging ./cmd/cmux-devbox
	@echo "Staging build complete: bin/cmux-devbox-staging"

# Production build - bakes in production config (Mode=prod)
# All config values MUST be provided via env vars or make arguments
# Override with: make build-prod STACK_PROJECT_ID=... CMUX_API_URL=...
build-prod:
	@echo "Building for production (Mode=prod)..."
	@if [ -z "$(STACK_PROJECT_ID)" ]; then echo "Error: STACK_PROJECT_ID is required"; exit 1; fi
	@if [ -z "$(STACK_PUBLISHABLE_CLIENT_KEY)" ]; then echo "Error: STACK_PUBLISHABLE_CLIENT_KEY is required"; exit 1; fi
	@if [ -z "$(CMUX_API_URL)" ]; then echo "Error: CMUX_API_URL is required"; exit 1; fi
	@if [ -z "$(CONVEX_SITE_URL)" ]; then echo "Error: CONVEX_SITE_URL is required"; exit 1; fi
	go build -ldflags "-s -w \
		-X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME) -X main.Mode=prod \
		-X '$(AUTH_PKG).ProjectID=$(STACK_PROJECT_ID)' \
		-X '$(AUTH_PKG).PublishableKey=$(STACK_PUBLISHABLE_CLIENT_KEY)' \
		-X '$(AUTH_PKG).CmuxURL=$(CMUX_API_URL)' \
		-X '$(AUTH_PKG).ConvexSiteURL=$(CONVEX_SITE_URL)'" \
		-o bin/cmux-devbox ./cmd/cmux-devbox
	@echo "Production build complete: bin/cmux-devbox"
