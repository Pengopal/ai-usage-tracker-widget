const { spawn } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { interpret } = require('./core/interpret');

const RPC_TIMEOUT = 25000;
const LOGIN_TIMEOUT = 5 * 60 * 1000;

class CodexConnection {
  constructor(binary, home) {
    mkdirSync(home, { recursive: true });
    const env = { ...process.env, CODEX_HOME: home };
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    this.nextId = 0;
    this.pending = new Map();
    this.child = spawn(binary, [
      'app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="keyring"',
    ], { cwd: home, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => this.receive(line));
    this.child.once('error', () => this.close());
    this.child.once('exit', () => this.close());
    this.child.stdin.on('error', () => this.close());
    this.ready = this.request('initialize', {
      clientInfo: { name: 'pengopal_usage_tracker', title: 'Pengopal AI Usage Tracker', version: require('../package.json').version },
    }).then(() => this.send({ method: 'initialized' })).catch((error) => {
      this.close();
      throw error;
    });
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message?.method === 'account/login/completed') this.onLogin?.(message.params);
    const pending = this.pending.get(message?.id);
    if (!pending || message.method) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error('ChatGPT could not complete the request.'));
    else pending.resolve(message.result);
  }

  send(message) {
    if (this.closed) throw new Error('The ChatGPT connection closed. Try again.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error('The ChatGPT connection closed. Try again.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close('The ChatGPT request timed out. Try again.'), RPC_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  close(message = 'The ChatGPT connection closed. Try again.') {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.child.kill();
    const error = new Error(message);
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.onClose?.(error);
  }
}

class ChatGPT {
  constructor({ binary, home, openBrowser, legacy }) {
    Object.assign(this, { binary, home, openBrowser, legacy });
  }

  async connect() {
    if (!this.connection || this.connection.closed) {
      if (!this.binary) throw new Error('This build is missing the ChatGPT sign-in runtime.');
      this.connection = new CodexConnection(this.binary, this.home);
    }
    const connection = this.connection;
    await connection.ready;
    return connection;
  }

  async read() {
    if (!this.binary) return this.legacy.readExistingLogin();
    const connection = await this.connect();
    const { account } = await connection.request('account/read', { refreshToken: false });
    if (account?.type !== 'chatgpt') return this.legacy.readExistingLogin();

    let limits;
    try {
      limits = await connection.request('account/rateLimits/read');
    } catch {
      // A revoked session may have been cleared while app-server tried to refresh it.
      if (!connection.closed) {
        const current = await connection.request('account/read', { refreshToken: false });
        if (!current.account) return { connected: false };
      }
      return { connected: true, error: 'Could not read ChatGPT usage. Try syncing again or reconnect in Settings.' };
    }
    const usage = limits.rateLimitsByLimitId?.codex ?? limits.rateLimits;
    return interpret('openai', { auth: true, usage, plan: account.planType });
  }

  async signIn(signal) {
    const connection = await this.connect();
    if (signal.aborted) return false;

    let loginId;
    let timer;
    let succeeded = false;
    let complete;
    const completion = new Promise((resolve) => { complete = resolve; });
    const cancel = () => complete({ cancelled: true });
    // Buffer notifications that arrive as soon as the start reply does.
    const early = new Map();
    connection.onLogin = (notice) => {
      if (notice?.loginId === loginId && loginId) complete(notice);
      else if (!loginId && notice?.loginId) early.set(notice.loginId, notice);
    };
    connection.onClose = (error) => complete({ error });
    signal.addEventListener('abort', cancel, { once: true });

    try {
      const login = await connection.request('account/login/start', { type: 'chatgpt' });
      loginId = login.loginId;
      if (!loginId) throw new Error('ChatGPT did not start browser sign-in. Try again.');
      if (signal.aborted) return false;
      const url = new URL(login.authUrl);
      if (!['https://auth.openai.com', 'https://chatgpt.com'].includes(url.origin) || url.username || url.password) {
        throw new Error('ChatGPT returned an unexpected sign-in address.');
      }
      if (early.has(loginId)) complete(early.get(loginId));
      timer = setTimeout(() => complete({ error: new Error('ChatGPT sign-in timed out. Try again.') }), LOGIN_TIMEOUT);
      const opening = Promise.resolve().then(() => this.openBrowser(url.href)).then(
        () => completion, () => ({ error: new Error('Could not open your default browser. Try again.') }),
      );
      const result = await Promise.race([opening, completion]);
      if (result.cancelled) return false;
      if (!result.success) {
        throw result.error instanceof Error ? result.error : new Error('ChatGPT sign-in did not finish. Try again.');
      }
      succeeded = true;
      await this.legacy.signOut().catch(() => {});
      return true;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      connection.onLogin = null;
      connection.onClose = null;
      if (loginId && !succeeded && !connection.closed) {
        await connection.request('account/login/cancel', { loginId }).catch(() => {});
      }
    }
  }

  async signOut() {
    await this.legacy.signOut();
    if (this.binary) await (await this.connect()).request('account/logout');
  }

  close() { this.connection?.close(); }
}

function bundledCodex(packaged) {
  const triplet = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }[process.arch];
  if (process.platform !== 'win32' || !triplet) return null;
  const root = packaged ? path.join(process.resourcesPath, 'codex')
    : path.join(__dirname, '..', 'node_modules', '@openai', `codex-win32-${process.arch}`);
  const binary = path.join(root, 'vendor', triplet, 'bin', 'codex.exe');
  return existsSync(binary) ? binary : null;
}

module.exports = { ChatGPT, bundledCodex };
