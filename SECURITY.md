# Security

PaneFlow is a local-first macOS desktop workspace that embeds multiple remote
websites in native Electron views. It is not a security boundary between those
websites, an anonymity tool, or a hardened multi-user system.

This document describes the implemented controls, the threat boundaries, and
the security checklist for the current unsigned local build. Report suspected
issues privately rather than opening a public issue with exploit details or
live credentials.

## Supported build and distribution status

- The current artifact is an **arm64-only, unsigned/ad-hoc local build**.
- It is not signed with a Developer ID Application certificate and is not
  notarized or stapled.
- Gatekeeper may block it on another Mac. That is expected; do not present it
  as a notarized release or disable Gatekeeper system-wide.
- Automatic updates, crash reporting, telemetry, extensions, and cloud sync are
  not implemented.
- Signed distribution requires the owner's Apple Developer credentials and a
  separate release process; those steps are intentionally not automated here.

## Threat boundaries

| Boundary | Trust | What it means |
| --- | --- | --- |
| Trusted shell | Trusted local code | The Vue shell is served from the internal `paneflow://shell/` protocol, sandboxed, context-isolated, and has the typed preload bridge. |
| Main process | Trusted local code | Owns windows, native views, sessions, persistence, dialogs, and IPC validation. |
| Remote pane | **Untrusted** | Every website, including localhost, LAN, staging, and production sites, is hostile. It receives no preload bridge, Node.js, filesystem, environment, or privileged IPC. |
| Profile partition | Browser-session isolation | Each profile has its own persistent Electron partition. This isolates cookies, storage, and cache; it is not an OS process or user sandbox. |
| Local OS account | Out of scope | Malware, another local user with access to your account, a compromised OS, or a compromised Chromium runtime can read local profile data. |

All panes share the application's Chromium runtime. A Chromium exploit affecting
one pane can affect the application; profile isolation is not a remedy for
renderer exploits.

## Implemented controls

### Trusted shell

- Packaged and local production builds load the shell from
  `paneflow://shell/index.html` using a privileged, standard, secure custom
  protocol. The handler serves only files inside the built renderer directory,
  rejects traversal and malformed paths, sets explicit MIME types, and sends
  `X-Content-Type-Options: nosniff`.
- The shell `WebContentsView` uses `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`, and no
  remote preload.
- Shell navigation, redirects outside the development origin, new windows, and
  webview attachment are denied.
- The production CSP has no development network allowance:
  `connect-src 'self'`, `script-src 'self'`, `object-src 'none'`,
  `frame-src 'none'`, `base-uri 'none'`, `form-action 'none'`, and
  `frame-ancestors 'none'`. Inline `<style>`/`style=""` remains allowed because
  Vue binds pane geometry through inline styles; inline script and eval are not.
- Development may add the explicit loopback Vite origin and its WebSocket to
  `connect-src`. `ELECTRON_RENDERER_URL` is ignored in packaged runs and is
  accepted only for a loopback `http(s)` origin whose loaded origin is verified.
- The preload exposes named operations only. There is no generic
  `send`/`invoke` bridge.

### IPC

- Every `ipcMain.handle` checks that the sender is the shell `WebContents`, that
  the sender frame is the shell's main frame, and that its document URL is the
  built shell entry or the validated development origin.
- Main re-validates payload types, IDs, lengths, URLs, viewport settings, and
  geometry. Renderer validation is only a convenience.
- Unauthorized `get-state` requests receive an empty default state instead of
  workspace metadata.
- An e2e test creates a separate node-enabled `BrowserWindow` in the same
  Electron process and confirms its IPC calls are rejected. This covers sender
  identity, not just the absence of a preload in ordinary remote panes.

### Remote browser panes

- Remote views use `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`,
  `nodeIntegrationInWorker: false`, `webviewTag: false`, `webSecurity: true`,
  `allowRunningInsecureContent: false`, and no application preload.
- Navigation and redirects are restricted in main to `http:`, `https:`, and
  `about:blank`. Unsupported schemes (`javascript:`, `data:`, `file:`,
  `chrome:`, custom protocols) are rejected before load.
- Embedded URL credentials (`https://user:password@host/`) are rejected so they
  cannot enter workspace files, exports, screenshots, or logs.
- New windows/popups are denied. Downloads, web notifications, camera,
  microphone, geolocation, clipboard, display capture, HID/serial/USB, and
  Bluetooth pairing are denied by the session policy. Permission checks are
  deny-by-default as well as permission requests.
- TLS certificate errors are not ignored, and Chromium web security is not
  disabled.
- Per-pane DevTools are local developer tools, not a remote feature.

### Profiles and persisted data

- Profile partitions are derived only from internally generated UUIDs:
  `persist:paneflow-profile-<uuid>`. User labels, URLs, and workspace names
  never influence partition or directory names.
- New and duplicated panes receive independent sessions. Sessions are never
  shared between panes, and there is no user-facing profile manager.
- Closing a pane uses Electron session APIs to remove its cookies, storage,
  cache, and auth cache, then removes metadata and best-effort deletes its
  partition directory. **Clear Site Data…** performs the same clear for a live
  pane after confirmation and reloads it.
- Workspace JSON contains pane IDs, profile references, URLs, viewport settings,
  and layout only. It never contains cookies, tokens, page contents, or profile
  databases.
- Imported workspace files are untrusted: they are size-limited, schema-checked,
  URL/viewport/layout-validated, stripped of profile identities, and given
  fresh sessions and pane IDs. Import never executes file content or restores
  arbitrary filesystem paths.
- Invalid store files are preserved with a `.corrupt-<timestamp>` suffix rather
  than silently overwritten.

## Secret handling

- Website credentials and session cookies stay in Electron-managed partitions
  under the app's user-data directory. PaneFlow does not implement its own
  password or token store.
- Do not put credentials, bearer tokens, session identifiers, or private page
  content in workspace names, pane URLs, fixtures, screenshots, exports, test
  artifacts, or Git.
- Exported workspaces include pane URLs, including query strings. A URL like
  `https://example.com/?token=...` is exported verbatim; use non-secret test
  URLs when sharing an export.
- Logs avoid full URLs where practical, but error messages may include a
  hostname or the selected local file path. Do not paste logs containing
  sensitive URLs into public issues.
- Browser data and generated `dist/` artifacts are ignored by Git. Never commit
  a user-data directory, `.corrupt-*` file, profile store, or exported workspace.
- The current unsigned build does not enable Electron's cookie-encryption fuse.
  Chromium cookies are stored in the user-data directory protected by normal
  OS account permissions. Enabling OS-backed cookie encryption belongs in a
  verified signed-distribution build, not an ad-hoc local build.

## Unsigned local distribution

Use these builds only on a machine you control:

1. Build from the reviewed commit with `npm ci` and the documented commands.
2. Record the artifact SHA-256 and compare it with the expected build output.
3. If Gatekeeper blocks a locally built app, open it from Finder with the
   explicit Open action or remove the quarantine attribute from that specific
   app after verifying its hash. Do not disable Gatekeeper globally.
4. Never distribute an unsigned build as notarized, trusted, or production-ready.

Signed-release prerequisites (not implemented): Developer ID Application
certificate, hardened runtime enabled, notarization credentials stored outside
the repository, notarization and stapling of the app and DMG, `spctl` and
`codesign` verification, and a documented update channel.

## Packaging checklist

Run from a clean checkout:

- [ ] `git status` contains only intended source/documentation changes; no
      `.env`, user data, exported workspace, or generated profile store.
- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run test:e2e` (macOS GUI session)
- [ ] `npm run build`
- [ ] `npm run package:dir` or `npm run package:mac`
- [ ] `npx electron-fuses read --app dist/mac-arm64/PaneFlow.app` reports
      RunAsNode disabled, Node options/inspector disabled, embedded ASAR
      integrity enabled, only-load-app-from-asar enabled, and file-protocol
      extra privileges disabled. The `@electron/fuses` 1.8.0 CLI bundled with
      electron-builder labels Electron 45's unconfigured `WasmTrapHandlers`
      fuse as `undefined`; the configured security fuses still read correctly.
- [ ] Inspect `Info.plist` for `CFBundleIdentifier`, version, icon, category,
      and `ElectronAsarIntegrity`.
- [ ] Confirm the app is unsigned/ad-hoc (`codesign -dv` or the documented
      local check); do not claim notarization.
- [ ] Launch the packaged app with a fresh user-data directory and verify the
      shell and a pane load.
- [ ] Verify `dist/` contains no user data, credentials, or exported workspaces.
- [ ] Record artifact sizes, hashes, and commands in
      `docs/PHASE_REPORTS.md`.

## Relevant verification

- Unit tests cover CSP construction, trusted shell URL matching, shell asset
  path traversal/MIME handling, partition directory validation, URL scheme,
  credential, and length rejection, and workspace-import validation.
- The Playwright e2e test verifies the custom shell protocol, CSP inline-script
  and cross-origin fetch blocking, remote bridge/Node absence, invalid-sender
  rejection, blocked remote `file:`/`data:` navigation, popup/permission
  denial, profile isolation, session teardown, and restart persistence.
- See [`docs/PHASE_REPORTS.md`](./docs/PHASE_REPORTS.md) and
  [`docs/MANUAL_CHECKS.md`](./docs/MANUAL_CHECKS.md) for exact results.

## Reporting

Open a GitHub security advisory or contact the repository owner privately. Do
not include live credentials, cookies, private URLs, or a weaponized exploit in
a public issue. There is no paid bug-bounty program.
