const { createServer } = require('node:http')

const DEFAULT_PORT = 4321

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sanitizeName(value) {
  const sanitized = String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 32)
  return sanitized || 'pane'
}

function sanitizeUser(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 32)
}

function readCookie(request, name) {
  const header = request.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return ''
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; --ink: #1e2420; --muted: #5f6b64; --line: #d8ded9; --surface: #fbfcfb; --accent: #2f6f5e; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #f2f5f2; }
  main { max-width: 760px; margin: 0 auto; padding: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  h1 { margin: 0 0 2px; font-size: 20px; letter-spacing: -0.02em; }
  .sub { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 20px; font-size: 13px; }
  dt { color: var(--muted); }
  dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  button, a.button { appearance: none; border: 1px solid #c4cdc7; border-radius: 6px; background: #fff; color: var(--ink); padding: 6px 10px; font: inherit; font-size: 12px; text-decoration: none; cursor: pointer; }
  button:hover, a.button:hover { border-color: var(--accent); color: var(--accent); }
  .output { min-height: 24px; margin-top: 14px; padding: 10px 12px; border-radius: 6px; background: #eef3ef; color: #38443d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .hint { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; line-height: 1.55; }
  code { background: #eef1ee; padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`
}

function panePage(paneName, user) {
  const name = escapeHtml(paneName)
  const signedIn = escapeHtml(user)
  const heading = user ? `Pane ${name} — signed in as ${signedIn}` : `Pane ${name}`
  return pageShell(`Pane ${paneName}`, `
  <h1>${heading}</h1>
  <p class="sub">Local Phase 0 fixture page. No third-party content.</p>
  <dl>
    <dt>Address</dt><dd id="address"></dd>
    <dt>Profile cookie</dt><dd id="cookie">—</dd>
    <dt>localStorage</dt><dd id="storage">—</dd>
    <dt>Viewport</dt><dd id="viewport"></dd>
    <dt>Pixel ratio</dt><dd id="ratio"></dd>
  </dl>
  <div class="actions">
    <button type="button" id="storage-button">Increment localStorage</button>
    <button type="button" id="popup-button">Open popup (should be denied)</button>
    <button type="button" id="permission-button">Request notifications</button>
    <a class="button" href="/other?from=${encodeURIComponent(paneName)}">Navigate to another page</a>
  </div>
  <div class="output" id="output">Ready.</div>
  <p class="hint">
    Each pane uses its own persistent Electron partition. Set a per-profile cookie by opening
    <code>?user=alice</code> or <code>?user=bob</code>. Cookie and storage values above should
    never appear in another pane.
  </p>
  <script>
    const paneName = ${JSON.stringify(paneName)};
    const output = document.getElementById('output');
    function refresh() {
      document.getElementById('address').textContent = location.href;
      document.getElementById('cookie').textContent = document.cookie || '(empty)';
      const stored = localStorage.getItem('paneflow_fixture') || '(empty)';
      document.getElementById('storage').textContent = stored;
      document.getElementById('viewport').textContent = window.innerWidth + ' × ' + window.innerHeight;
      document.getElementById('ratio').textContent = String(window.devicePixelRatio);
    }
    document.getElementById('storage-button').addEventListener('click', () => {
      const next = Number(localStorage.getItem('paneflow_fixture') || '0') + 1;
      localStorage.setItem('paneflow_fixture', String(next));
      refresh();
      output.textContent = 'localStorage set to ' + next + ' in profile for ' + paneName + '.';
    });
    document.getElementById('popup-button').addEventListener('click', () => {
      const popup = window.open('/popup', 'paneflow-popup', 'width=420,height=320');
      output.textContent = popup === null ? 'Popup denied by PaneFlow.' : 'Popup object returned.';
    });
    document.getElementById('permission-button').addEventListener('click', async () => {
      const result = await Notification.requestPermission();
      output.textContent = 'Notification permission: ' + result;
    });
    window.addEventListener('resize', refresh);
    refresh();
  </script>`)
}

function homePage() {
  return pageShell('PaneFlow fixtures', `
  <h1>PaneFlow local fixtures</h1>
  <p class="sub">Deterministic pages for manual checks and integration tests.</p>
  <dl>
    <dt>Cookie isolation</dt><dd>/pane/one?user=alice · /pane/two?user=bob</dd>
    <dt>Measurement</dt><dd>innerWidth / innerHeight / devicePixelRatio</dd>
    <dt>Popup policy</dt><dd>window.open is denied</dd>
  </dl>
  <div class="actions">
    <a class="button" href="/pane/one?user=alice">Alice pane</a>
    <a class="button" href="/pane/two?user=bob">Bob pane</a>
    <a class="button" href="/other">Other page</a>
  </div>
  <p class="hint">This server binds to 127.0.0.1 and serves no external assets.</p>`)
}

function otherPage(from) {
  return pageShell('Another page', `
  <h1>Another page</h1>
  <p class="sub">Navigation target for history and reload checks.</p>
  <dl><dt>Arrived from</dt><dd>${escapeHtml(from || 'direct')}</dd><dt>Address</dt><dd>${escapeHtml('/other')}</dd></dl>
  <div class="actions"><a class="button" href="/pane/one">Back to fixture pane</a></div>`)
}

function popupPage() {
  return pageShell('Popup opened', `
  <h1>Popup opened</h1>
  <p class="sub">If this page is visible in a new window, the Phase 0 popup policy is not working.</p>`)
}

function requestHandler(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ok')
    return
  }

  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(homePage())
    return
  }

  if (url.pathname === '/other') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(otherPage(url.searchParams.get('from') ?? ''))
    return
  }

  if (url.pathname === '/popup') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(popupPage())
    return
  }

  if (url.pathname.startsWith('/pane/')) {
    const paneName = sanitizeName(decodeURIComponent(url.pathname.slice('/pane/'.length)))
    const requestedUser = url.searchParams.has('user')
    const user = sanitizeUser(url.searchParams.get('user') ?? '')

    if (requestedUser && user) {
      const current = readCookie(request, 'paneflow_user')
      if (current !== user) {
        response.setHeader(
          'set-cookie',
          `paneflow_user=${encodeURIComponent(user)}; Max-Age=86400; Path=/; SameSite=Lax`
        )
      }
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(panePage(paneName, requestedUser ? user : ''))
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Not found')
}

async function startFixtureServer({ port = 0 } = {}) {
  const server = createServer(requestHandler)
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })

  const address = server.address()
  const actualPort = address && typeof address === 'object' ? address.port : port

  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
  }
}

module.exports = { startFixtureServer }

if (require.main === module) {
  startFixtureServer({ port: DEFAULT_PORT })
    .then((server) => {
      console.log(`PaneFlow fixture server: ${server.url}`)
    })
    .catch((error) => {
      console.error('Failed to start the PaneFlow fixture server.', error)
      process.exitCode = 1
    })
}
