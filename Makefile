# PaneFlow developer commands. Run `make` or `make help` for a summary.

SHELL := /bin/sh
.DEFAULT_GOAL := help

NODE_MIN_MAJOR := 24
NPM := npm
DEPS_STAMP := node_modules/.package-lock.json
ELECTRON_STAMP := node_modules/electron/path.txt

.PHONY: help check-toolchain deps runtime install start preview dev build typecheck lint test test-unit test-e2e check-contrast check package package-mac package-dir clean

help:
	@echo 'PaneFlow developer commands:'
	@echo ''
	@echo '  make start          Build, package, and launch PaneFlow with its real app identity'
	@echo '  make preview        Build and preview through the Electron dev runtime'
	@echo '  make dev            Start the development app with fixtures'
	@echo '  make build          Build main, preload, and renderer into out/'
	@echo '  make check          Typecheck, lint, run unit tests, and check contrast'
	@echo '  make typecheck      Strict TypeScript check'
	@echo '  make lint           ESLint across source, tests, and scripts'
	@echo '  make test-unit      Run the Vitest unit tests'
	@echo '  make test           Alias for test-unit'
	@echo '  make check-contrast Check light/dark design-token contrast'
	@echo '  make test-e2e       Build, then run the Playwright Electron tests'
	@echo '  make package        Build the unpacked macOS app'
	@echo '  make package-mac    Build the macOS DMG and ZIP'
	@echo '  make package-dir    Build the unpacked macOS app'
	@echo '  make install        Force a clean npm ci and Electron runtime install'
	@echo '  make clean          Remove build and test output'
	@echo ''
	@echo 'Dependencies and the Electron runtime are installed when missing or stale.'

check-toolchain:
	@command -v node >/dev/null 2>&1 || { echo "error: Node.js $(NODE_MIN_MAJOR)+ is required but 'node' was not found." >&2; exit 1; }
	@command -v $(NPM) >/dev/null 2>&1 || { echo "error: npm is required but was not found." >&2; exit 1; }
	@node -e "const major = Number(process.versions.node.split('.')[0]); if (major < $(NODE_MIN_MAJOR)) { console.error('error: PaneFlow requires Node.js $(NODE_MIN_MAJOR) or newer; found ' + process.version + '.'); console.error('If you use nvm, run: nvm install && nvm use'); process.exit(1); }"

deps: check-toolchain $(DEPS_STAMP)

$(DEPS_STAMP): package.json package-lock.json
	@echo '==> Installing npm dependencies'
	@$(NPM) ci

runtime: deps $(ELECTRON_STAMP)

$(ELECTRON_STAMP): $(DEPS_STAMP)
	@echo '==> Ensuring the Electron runtime is installed'
	@node node_modules/electron/install.js

install: check-toolchain
	@echo '==> Reinstalling npm dependencies'
	@$(NPM) ci
	@echo '==> Ensuring the Electron runtime is installed'
	@node node_modules/electron/install.js

start: runtime
	@echo '==> Starting packaged PaneFlow'
	@$(NPM) run start

preview: runtime
	@$(NPM) run preview

dev: runtime
	@$(NPM) run dev

build: deps
	@$(NPM) run build

typecheck: deps
	@$(NPM) run typecheck

lint: deps
	@$(NPM) run lint

test test-unit: deps
	@$(NPM) run test:unit

test-e2e: runtime
	@$(NPM) run test:e2e

check-contrast: deps
	@$(NPM) run check:contrast

check: typecheck lint test-unit check-contrast

package: package-dir

package-mac: runtime
	@$(NPM) run package:mac

package-dir: runtime
	@$(NPM) run package:dir

clean:
	@echo '==> Removing build and test output'
	@rm -rf out dist coverage test-results playwright-report blob-report
