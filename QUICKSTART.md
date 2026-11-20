# Quickstart — Fresh PaneFlow Repository

> Historical starter-kit guide. For PaneFlow 1.0 setup and usage, see [`README.md`](./README.md).

## 1. Create the GitHub repository

Create a new **public** GitHub repository named `paneflow`. Do not select an auto-generated README, license, or `.gitignore` if you plan to upload this starter kit as-is.

## 2. Put the starter files in the repository

Recommended approach:

```bash
git clone https://github.com/<your-account>/paneflow.git
cd paneflow
```

Extract/copy the contents of this starter kit into the repository root, including hidden files and directories such as `.opencode/` and `.github/`. From the repository root, one reliable macOS method is:

```bash
unzip ~/Downloads/PaneFlow-Fresh-Project.zip -d /tmp
cp -a /tmp/PaneFlow-Fresh-Project/. .
```

If you prefer to start locally before creating the GitHub repository:

```bash
mkdir paneflow
cd paneflow
unzip ~/Downloads/PaneFlow-Fresh-Project.zip -d /tmp
cp -a /tmp/PaneFlow-Fresh-Project/. .
git init -b main
```

When you create the GitHub repository later, add it as `origin` before pushing: `git remote add origin https://github.com/<your-account>/paneflow.git`.

Do not add a license until you have chosen one.

## 3. Check the local toolchain

Use Node 24 LTS, as declared in `.nvmrc`:

```bash
node --version
npm --version
git status --short
```

If you use nvm:

```bash
nvm install
nvm use
```

## 4. Use OpenCode 2

This starter kit uses OpenCode 2 project configuration, agent, skill, and permission conventions. Check your version:

```bash
opencode --version
```

Use OpenCode 2.x. If you are still on OpenCode 1.x, upgrade first. On macOS with Homebrew, the current OpenCode 2 formula is:

```bash
brew install anomalyco/tap/opencode-v2
```

Then verify that `opencode --version` reports `2.x`. Do not try to mix V1 permission syntax with this starter kit.

## 5. Start OpenCode

From the repository root:

```bash
opencode
```

Run this command in the OpenCode TUI:

```text
/start
```

The `/start` command explicitly tells OpenCode to perform Phase 0 only. It must build and run a small native-view experiment, not merely write a plan.

## 6. Review the Phase 0 result

Before moving on, confirm that the report includes:

- Two independently navigable `WebContentsView` browser panes.
- Visible and clickable controls/address chrome.
- Proven view stacking and hit-testing behavior.
- Correct bounds after resizing the window and panes.
- Separate persistent browser sessions.
- Cleanup of views and `webContents`.
- A documented architecture decision in `docs/DECISIONS.md`.
- Actual verification commands and results in `docs/PHASE_REPORTS.md`.

If an experiment fails, ask OpenCode to investigate and adjust the Phase 0 approach. Do not ask it to build the full UI on top of an unproven composition strategy.

## 7. Continue implementation

Once Phase 0 is reviewed, use:

```text
/next
```

Use `/next` again for the next small, complete slice. Use `/verify` to run checks and `/review` for read-only code/security/UI review.

## 8. Commit and connect GitHub

The agent must not commit or push. Review the diff yourself, then commit and push manually when ready:

```bash
git status
git diff --check
git diff
# Review all changed files before committing.
git add .
git commit -m "chore: bootstrap PaneFlow project"
git push -u origin main
```

For later work, prefer feature branches and pull requests. CI becomes fully active after Phase 0 creates the app package and lockfile.
