# Makefile for cloudrouter CLI

VERSION ?= 0.1.0
COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

# Auth configuration (set via env or make arguments for production)
# These are baked into the binary via ldflags
STACK_PROJECT_ID ?=
STACK_PUBLISHABLE_CLIENT_KEY ?=
CMUX_API_URL ?=
CONVEX_SITE_URL ?=

# Package path for ldflags
AUTH_PKG := github.com/manaflow-ai/cloudrouter/internal/auth

# Production ldflags - strips debug info, bakes in config
LDFLAGS := -s -w \
           -X main.Version=$(VERSION) \
           -X main.Commit=$(COMMIT) \
           -X main.BuildTime=$(BUILD_TIME) \
           -X main.Mode=prod \
           -X '$(AUTH_PKG).ProjectID=$(STACK_PROJECT_ID)' \
           -X '$(AUTH_PKG).PublishableKey=$(STACK_PUBLISHABLE_CLIENT_KEY)' \
           -X '$(AUTH_PKG).CmuxURL=$(CMUX_API_URL)' \
           -X '$(AUTH_PKG).ConvexSiteURL=$(CONVEX_SITE_URL)'

.PHONY: build build-dev build-prod build-all build-npm clean test install install-dev deps npm-version npm-publish npm-publish-dry build-npm-cloudrouter npm-publish-cloudrouter npm-publish-cloudrouter-dry

# =============================================================================
# Development builds
# =============================================================================

build-dev:
	@echo "Building for development (Mode=dev)..."
	@echo "  Dev defaults: localhost:9779, famous-camel-162.convex.site"
	go build -ldflags "-X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME) -X main.Mode=dev" \
		-o bin/cmux ./cmd/cmux
	@echo "Dev build complete: bin/cmux"

install-dev: build-dev
	cp bin/cmux /usr/local/bin/cmux

# =============================================================================
# Production builds
# =============================================================================

build: build-prod

build-prod:
	@echo "Building for production (Mode=prod)..."
	@if [ -z "$(STACK_PROJECT_ID)" ]; then echo "Error: STACK_PROJECT_ID is required"; exit 1; fi
	@if [ -z "$(STACK_PUBLISHABLE_CLIENT_KEY)" ]; then echo "Error: STACK_PUBLISHABLE_CLIENT_KEY is required"; exit 1; fi
	@if [ -z "$(CMUX_API_URL)" ]; then echo "Error: CMUX_API_URL is required"; exit 1; fi
	@if [ -z "$(CONVEX_SITE_URL)" ]; then echo "Error: CONVEX_SITE_URL is required"; exit 1; fi
	go build -ldflags "$(LDFLAGS)" -o bin/cmux ./cmd/cmux
	@echo "Production build complete: bin/cmux"

install: build
	cp bin/cmux /usr/local/bin/cmux

# =============================================================================
# Cross-platform builds
# =============================================================================

build-all:
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-darwin-amd64 ./cmd/cmux
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-darwin-arm64 ./cmd/cmux
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-linux-amd64 ./cmd/cmux
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-linux-arm64 ./cmd/cmux
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cmux-windows-amd64.exe ./cmd/cmux

# =============================================================================
# NPM package builds
# =============================================================================

# Dev ldflags for npm packages (uses Mode=dev which enables hardcoded dev defaults)
DEV_LDFLAGS := -s -w \
               -X main.Version=$(VERSION) \
               -X main.Commit=$(COMMIT) \
               -X main.BuildTime=$(BUILD_TIME) \
               -X main.Mode=dev

# Build npm packages with dev mode (no credentials needed - uses hardcoded dev defaults)
build-npm-dev:
	@echo "Building npm packages with dev mode..."
	@mkdir -p npm/darwin-arm64/bin npm/darwin-x64/bin npm/linux-arm64/bin npm/linux-x64/bin npm/win32-x64/bin
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/darwin-arm64/bin/cmux ./cmd/cmux
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/darwin-x64/bin/cmux ./cmd/cmux
	GOOS=linux GOARCH=arm64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/linux-arm64/bin/cmux ./cmd/cmux
	GOOS=linux GOARCH=amd64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/linux-x64/bin/cmux ./cmd/cmux
	GOOS=windows GOARCH=amd64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/win32-x64/bin/cmux.exe ./cmd/cmux
	@echo "Done! Dev binaries built in npm/*/bin/"
	@echo "Dev defaults: localhost:9779, famous-camel-162.convex.site"

# Build binaries for npm packages (production)
# Usage: make build-npm STACK_PROJECT_ID=... STACK_PUBLISHABLE_CLIENT_KEY=... CMUX_API_URL=... CONVEX_SITE_URL=...
build-npm:
	@echo "Building npm packages..."
	@if [ -z "$(STACK_PROJECT_ID)" ]; then echo "Error: STACK_PROJECT_ID is required"; exit 1; fi
	@if [ -z "$(STACK_PUBLISHABLE_CLIENT_KEY)" ]; then echo "Error: STACK_PUBLISHABLE_CLIENT_KEY is required"; exit 1; fi
	@if [ -z "$(CMUX_API_URL)" ]; then echo "Error: CMUX_API_URL is required"; exit 1; fi
	@if [ -z "$(CONVEX_SITE_URL)" ]; then echo "Error: CONVEX_SITE_URL is required"; exit 1; fi
	@mkdir -p npm/darwin-arm64/bin npm/darwin-x64/bin npm/linux-arm64/bin npm/linux-x64/bin npm/win32-x64/bin npm/cmux/lib
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/darwin-arm64/bin/cmux ./cmd/cmux
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/darwin-x64/bin/cmux ./cmd/cmux
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/linux-arm64/bin/cmux ./cmd/cmux
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/linux-x64/bin/cmux ./cmd/cmux
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/win32-x64/bin/cmux.exe ./cmd/cmux
	@# Copy darwin-arm64 binary to lib/cmux as fallback for bunx/npx
	@cp npm/darwin-arm64/bin/cmux npm/cmux/lib/cmux
	@chmod +x npm/cmux/lib/cmux npm/cmux/bin/cmux 2>/dev/null || true
	@echo "Done! Binaries built in npm/*/bin/"
	@# Verify all binaries report same version
	@echo "Verifying binary versions..."
	@EXPECTED="cloudrouter version $(VERSION)"; \
	for bin in npm/darwin-arm64/bin/cmux npm/darwin-x64/bin/cmux npm/cmux/lib/cmux; do \
		ACTUAL=$$($$bin --version 2>/dev/null || echo "failed"); \
		if [ "$$ACTUAL" != "$$EXPECTED" ]; then \
			echo "ERROR: $$bin reports '$$ACTUAL' but expected '$$EXPECTED'"; \
			exit 1; \
		fi; \
	done
	@echo "All binaries verified at version $(VERSION)"

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
# Cloudrouter NPM package builds (@manaflow-ai/cloudrouter)
# =============================================================================

# Build cloudrouter npm packages (production)
# Usage: make build-npm-cloudrouter STACK_PROJECT_ID=... STACK_PUBLISHABLE_CLIENT_KEY=... CMUX_API_URL=... CONVEX_SITE_URL=...
build-npm-cloudrouter:
	@echo "Building cloudrouter npm packages..."
	@if [ -z "$(STACK_PROJECT_ID)" ]; then echo "Error: STACK_PROJECT_ID is required"; exit 1; fi
	@if [ -z "$(STACK_PUBLISHABLE_CLIENT_KEY)" ]; then echo "Error: STACK_PUBLISHABLE_CLIENT_KEY is required"; exit 1; fi
	@if [ -z "$(CMUX_API_URL)" ]; then echo "Error: CMUX_API_URL is required"; exit 1; fi
	@if [ -z "$(CONVEX_SITE_URL)" ]; then echo "Error: CONVEX_SITE_URL is required"; exit 1; fi
	@mkdir -p npm/cloudrouter-darwin-arm64/bin npm/cloudrouter-darwin-x64/bin npm/cloudrouter-linux-arm64/bin npm/cloudrouter-linux-x64/bin npm/cloudrouter-win32-x64/bin npm/cloudrouter/lib
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-darwin-arm64/bin/cloudrouter ./cmd/cmux
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-darwin-x64/bin/cloudrouter ./cmd/cmux
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-linux-arm64/bin/cloudrouter ./cmd/cmux
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-linux-x64/bin/cloudrouter ./cmd/cmux
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-win32-x64/bin/cloudrouter.exe ./cmd/cmux
	@# Copy darwin-arm64 binary to lib/cloudrouter as fallback for bunx/npx
	@cp npm/cloudrouter-darwin-arm64/bin/cloudrouter npm/cloudrouter/lib/cloudrouter
	@chmod +x npm/cloudrouter/lib/cloudrouter npm/cloudrouter/bin/cloudrouter 2>/dev/null || true
	@echo "Done! Cloudrouter binaries built in npm/cloudrouter-*/bin/"
	@# Verify binaries report correct version
	@echo "Verifying binary versions..."
	@EXPECTED="cloudrouter version $(VERSION)"; \
	for bin in npm/cloudrouter-darwin-arm64/bin/cloudrouter npm/cloudrouter-darwin-x64/bin/cloudrouter npm/cloudrouter/lib/cloudrouter; do \
		ACTUAL=$$($$bin --version 2>/dev/null || echo "failed"); \
		if [ "$$ACTUAL" != "$$EXPECTED" ]; then \
			echo "ERROR: $$bin reports '$$ACTUAL' but expected '$$EXPECTED'"; \
			exit 1; \
		fi; \
	done
	@echo "All cloudrouter binaries verified at version $(VERSION)"

# Publish cloudrouter to npm
npm-publish-cloudrouter: build-npm-cloudrouter
	@echo "Publishing @manaflow-ai/cloudrouter to npm..."
	@echo "1. Publishing platform packages..."
	cd npm/cloudrouter-darwin-arm64 && npm publish --access public
	cd npm/cloudrouter-darwin-x64 && npm publish --access public
	cd npm/cloudrouter-linux-arm64 && npm publish --access public
	cd npm/cloudrouter-linux-x64 && npm publish --access public
	cd npm/cloudrouter-win32-x64 && npm publish --access public
	@echo "2. Publishing main package..."
	cd npm/cloudrouter && npm publish --access public
	@echo "Done! Published @manaflow-ai/cloudrouter"

# Dry-run publish cloudrouter (for testing)
npm-publish-cloudrouter-dry: build-npm-cloudrouter
	@echo "Dry-run publishing @manaflow-ai/cloudrouter to npm..."
	cd npm/cloudrouter-darwin-arm64 && npm publish --access public --dry-run
	cd npm/cloudrouter-darwin-x64 && npm publish --access public --dry-run
	cd npm/cloudrouter-linux-arm64 && npm publish --access public --dry-run
	cd npm/cloudrouter-linux-x64 && npm publish --access public --dry-run
	cd npm/cloudrouter-win32-x64 && npm publish --access public --dry-run
	cd npm/cloudrouter && npm publish --access public --dry-run
	@echo "Done!"

# =============================================================================
# Utilities
# =============================================================================

clean:
	rm -rf bin/
	rm -rf npm/*/bin/cmux npm/*/bin/cmux.exe npm/cmux/lib/cmux

test:
	go test -v ./...

deps:
	go mod download
	go mod tidy
