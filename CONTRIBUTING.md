# Contributing to PaneFlow

Thanks for your interest in PaneFlow. The project is in its early development stage.

## Before making a change

1. Read `AGENTS.md` and the relevant sections of `SPEC.md`.
2. Check existing issues and pull requests to avoid duplicate work.
3. For large changes or architecture changes, open an issue or discussion before investing in implementation.
4. Keep changes focused and avoid unrelated refactoring.

## Development expectations

- Use the Node version in `.nvmrc` and npm.
- Prefer the Make targets (`make dev`, `make check`, `make test-e2e`); they check the toolchain and install stale dependencies before running.
- Follow the existing TypeScript, Vue, and Electron conventions.
- Add tests for behavior changes.
- Treat remote website content as untrusted.
- Never include cookies, credentials, access tokens, real user browser profiles, or private page screenshots in commits or issue reports.
- Update documentation when behavior, architecture, setup, or limitations change.

## Pull requests

- Explain the user problem and the chosen approach.
- Include exact verification commands and results.
- Include screenshots for visible UI changes, with sensitive information removed.
- Keep the pull request focused and reasonably small.
- Do not include generated build output or local browser data.

## Project decisions

The product and MVP scope are defined in `SPEC.md`. Record significant architectural trade-offs in `docs/DECISIONS.md` rather than silently changing the design.
