const { randomUUID } = require('node:crypto')
const { createServer } = require('node:http')

const DEFAULT_PORT = 4321
const MAX_BODY_BYTES = 16 * 1024

// Synthetic accounts for local authentication tests. There are no passwords or
// real credentials: signing in only creates a server-side session record.
const ACCOUNTS = {
  alice: { displayName: 'Alice', pane: 'one' },
  bob: { displayName: 'Bob', pane: 'two' }
}

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

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'))
        request.destroy()
      }
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function sessionFor(request, sessions) {
  const token = readCookie(request, 'paneflow_session')
  if (!token) {
    return null
  }

  const account = sessions.get(token)
  return account && ACCOUNTS[account] ? { token, account } : null
}

function setSessionCookie(response, token) {
  response.setHeader(
    'set-cookie',
    `paneflow_session=${encodeURIComponent(token)}; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax`
  )
}

function clearSessionCookie(response) {
  response.setHeader(
    'set-cookie',
    'paneflow_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
  )
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; --ink: #1e2420; --muted: #5f6b64; --line: #d8ded9; --surface: #fbfcfb; --accent: #2f6f5e; --danger: #a23b32; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #f2f5f2; }
  main { max-width: 760px; margin: 0 auto; padding: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  h1 { margin: 0 0 2px; font-size: 20px; letter-spacing: -0.02em; }
  h2 { margin: 22px 0 8px; font-size: 14px; letter-spacing: -0.01em; }
  .sub { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 20px; font-size: 13px; }
  dt { color: var(--muted); }
  dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .account-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
  button, a.button { appearance: none; border: 1px solid #c4cdc7; border-radius: 6px; background: #fff; color: var(--ink); padding: 6px 10px; font: inherit; font-size: 12px; text-decoration: none; cursor: pointer; }
  button:hover, a.button:hover { border-color: var(--accent); color: var(--accent); }
  .output { min-height: 24px; margin-top: 14px; padding: 10px 12px; border-radius: 6px; background: #eef3ef; color: #38443d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .error { margin: 0 0 12px; padding: 9px 11px; border-radius: 6px; background: #f7eae8; color: var(--danger); font-size: 12px; }
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
    <a class="button" href="/login">Sign-in fixture</a>
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

function loginPage(currentAccount, error) {
  const signedIn = currentAccount ? ACCOUNTS[currentAccount] : null
  const accountButtons = Object.entries(ACCOUNTS)
    .map(
      ([id, account]) => `
      <form method="post" action="/login" class="account-row">
        <button type="submit" name="account" value="${escapeHtml(id)}">Sign in as ${escapeHtml(account.displayName)}</button>
      </form>`
    )
    .join('')

  return pageShell('Fixture sign in', `
  <h1>Fixture sign in</h1>
  <p class="sub">Local accounts for independent per-pane session checks.</p>
  ${signedIn ? `<p class="sub">This profile is currently signed in as <strong>${escapeHtml(signedIn.displayName)}</strong>.</p>` : ''}
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <h2>Sign in</h2>
  ${accountButtons}
  <div class="actions">
    <a class="button" href="/account">Open account</a>
    <a class="button" href="/">Fixture home</a>
  </div>
  <p class="hint">
    Signing in creates a server-side session and sets an HttpOnly, persistent cookie for this
    browser profile only. No passwords or real credentials are involved.
  </p>`)
}

function accountPage(accountId, profileCookie) {
  const account = ACCOUNTS[accountId]
  return pageShell(`Signed in as ${account.displayName}`, `
  <h1 id="account-heading">Signed in as ${escapeHtml(account.displayName)}</h1>
  <p class="sub">Server-issued session for this browser profile only.</p>
  <dl>
    <dt>Account</dt><dd id="account-name">${escapeHtml(accountId)}</dd>
    <dt>Session cookie</dt><dd>HttpOnly; not visible to page JavaScript</dd>
    <dt>Profile cookie</dt><dd>${escapeHtml(profileCookie || '(empty)')}</dd>
    <dt>localStorage</dt><dd id="storage">—</dd>
  </dl>
  <div class="actions">
    <a class="button" href="/pane/${escapeHtml(account.pane)}">Open fixture pane</a>
    <a class="button" href="/other?from=account">Other page</a>
    <form method="post" action="/logout">
      <button type="submit">Sign out</button>
    </form>
  </div>
  <div class="output" id="output">Session active for ${escapeHtml(account.displayName)}.</div>
  <p class="hint">
    The session cookie is HttpOnly and scoped to the profile partition. This page should never
    show another profile's account.
  </p>
  <script>
    document.getElementById('storage').textContent =
      localStorage.getItem('paneflow_fixture') || '(empty)';
  </script>`)
}

function homePage() {
  return pageShell('PaneFlow fixtures', `
  <h1>PaneFlow local fixtures</h1>
  <p class="sub">Deterministic pages for manual checks and integration tests.</p>
  <dl>
    <dt>Cookie isolation</dt><dd>/pane/one?user=alice · /pane/two?user=bob</dd>
    <dt>Authentication</dt><dd>/login → /account with per-profile HttpOnly sessions</dd>
    <dt>Measurement</dt><dd>innerWidth / innerHeight / devicePixelRatio</dd>
    <dt>Popup policy</dt><dd>window.open is denied</dd>
  </dl>
  <div class="actions">
    <a class="button" href="/pane/one?user=alice">Alice pane</a>
    <a class="button" href="/pane/two?user=bob">Bob pane</a>
    <a class="button" href="/login">Sign in</a>
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

function redirect(response, location) {
  response.writeHead(303, { location, 'cache-control': 'no-store' })
  response.end()
}

function html(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(body)
}

function createRequestHandler(sessions) {
  return async function handleRequest(request, response) {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    const session = sessionFor(request, sessions)

    if (url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('ok')
      return
    }

    if (url.pathname === '/' && request.method === 'GET') {
      html(response, homePage())
      return
    }

    if (url.pathname === '/login' && request.method === 'GET') {
      html(response, loginPage(session?.account ?? null, null))
      return
    }

    if (url.pathname === '/login' && request.method === 'POST') {
      const body = new URLSearchParams(await readBody(request))
      const account = body.get('account') ?? ''

      if (!ACCOUNTS[account]) {
        html(response, loginPage(session?.account ?? null, 'Choose one of the fixture accounts.'), 400)
        return
      }

      const token = randomUUID()
      sessions.set(token, account)
      setSessionCookie(response, token)
      redirect(response, '/account')
      return
    }

    if (url.pathname === '/logout' && request.method === 'POST') {
      if (session) {
        sessions.delete(session.token)
      }
      clearSessionCookie(response)
      redirect(response, '/login')
      return
    }

    if (url.pathname === '/account' && request.method === 'GET') {
      if (!session) {
        redirect(response, '/login')
        return
      }
      html(
        response,
        accountPage(session.account, readCookie(request, 'paneflow_user'))
      )
      return
    }

    if (url.pathname === '/api/session' && request.method === 'GET') {
      response.writeHead(session ? 200 : 401, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      })
      response.end(JSON.stringify(session ? { account: session.account } : { account: null }))
      return
    }

    if (url.pathname === '/other' && request.method === 'GET') {
      html(response, otherPage(url.searchParams.get('from') ?? ''))
      return
    }

    if (url.pathname === '/popup' && request.method === 'GET') {
      html(response, popupPage())
      return
    }

    if (url.pathname.startsWith('/pane/') && request.method === 'GET') {
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

      html(response, panePage(paneName, requestedUser ? user : ''))
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }
}

async function startFixtureServer({ port = 0 } = {}) {
  const sessions = new Map()
  const handler = createRequestHandler(sessions)
  const server = createServer((request, response) => {
    handler(request, response).catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      }
      response.end('Fixture server error')
      if (process.env.NODE_ENV !== 'test') {
        console.error('Fixture request failed.', error)
      }
    })
  })

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
