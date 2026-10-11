/**
 * Nova Insight - Work mode
 * An agentic mode where Nova plans, writes files, runs code and reports back, like a coding assistant.
 *  - The server only talks to the language model (never executes anything).
 *  - Every tool runs here in the browser: files live in a per-chat workspace (localStorage),
 *    Python runs in a Pyodide Web Worker and JavaScript runs in a sandboxed iframe.
 * Created by KaztryxAV.
 */
(function () {
  'use strict';

  const LIMITS = { files: 60, file: 200 * 1024, total: 1536 * 1024 };
  const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  const MAX_ROUNDS = 14;
  let deps = { userId: () => 'anon', toast: () => {} };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function abortError() { const e = new Error('aborted'); e.name = 'AbortError'; return e; }

  // ------------------------------------------------------------------ workspace storage
  function wsKey(convId) { return 'nova_ws:' + deps.userId() + ':' + convId; }

  function loadWs(convId) {
    try {
      const o = JSON.parse(localStorage.getItem(wsKey(convId)) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }

  function saveWs(convId, files) {
    try { localStorage.setItem(wsKey(convId), JSON.stringify(files)); return true; }
    catch (e) { return false; }
  }

  function cleanPath(p) {
    let s = String(p == null ? '' : p).replace(/\\/g, '/').trim().replace(/^(\.\/)+/, '').replace(/^\/+/, '');
    s = s.replace(/[^A-Za-z0-9._\-\/ ]/g, '_');
    const parts = s.split('/').filter((x) => x !== '' && x !== '.');
    if (!parts.length || parts.some((x) => x === '..')) return '';
    s = parts.join('/');
    return s.length > 120 ? '' : s;
  }

  function totalSize(files) {
    let n = 0;
    for (const k in files) n += (files[k] || '').length;
    return n;
  }

  function writeFile(files, path, content) {
    const p = cleanPath(path);
    if (!p) return { ok: false, msg: 'invalid file path "' + path + '"' };
    content = String(content == null ? '' : content);
    if (content.length > LIMITS.file) return { ok: false, msg: p + ' is too large (max ' + LIMITS.file / 1024 + ' KB)' };
    const isNew = !(p in files);
    if (isNew && Object.keys(files).length >= LIMITS.files) return { ok: false, msg: 'too many files (max ' + LIMITS.files + ')' };
    if (totalSize(files) - (files[p] || '').length + content.length > LIMITS.total) return { ok: false, msg: 'workspace is full' };
    files[p] = content;
    return { ok: true, path: p, isNew: isNew };
  }

  function fmtSize(n) {
    return n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  }

  function snapshot(files) {
    const names = Object.keys(files).sort();
    if (!names.length) return '';
    let out = '';
    let budget = 12500;
    const listed = [];
    for (const n of names) {
      const body = files[n];
      const cap = Math.min(5000, Math.max(0, budget));
      if (cap < 300) { listed.push(n + ' (' + body.length + ' chars)'); continue; }
      const shown = body.length > cap ? body.slice(0, cap) + '\n...(truncated, use read_file for the rest)' : body;
      out += '--- ' + n + ' (' + body.length + ' chars) ---\n' + shown + '\n';
      budget -= shown.length;
    }
    if (listed.length) out += '--- other files (contents omitted) ---\n' + listed.join('\n') + '\n';
    return out;
  }

  // ------------------------------------------------------------------ tool-call parsing
  function stripFences(t) {
    let s = String(t);
    s = s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
    const m = s.match(/^\s*```[A-Za-z0-9_+\-]*[ \t]*\n([\s\S]*?)\n?```\s*$/);
    if (m) s = m[1];
    return s.replace(/^\r?\n/, '').replace(/\s+$/, '') + '\n';
  }

  const KNOWN_TOOLS = ['write_file', 'read_file', 'delete_file', 'list_files', 'run_python', 'run_js', 'finish'];
  function normName(n) {
    const l = String(n || '').toLowerCase();
    return KNOWN_TOOLS.find((k) => l.indexOf(k) >= 0) || l;
  }

  function parseTools(text) {
    const tools = [];
    const re = /<tool\s+name\s*=\s*["']([a-z_]+)["']([^>]*?)(?:\/>|>([\s\S]*?)<\/tool>)/gi;
    let m;
    let narration = '';
    let last = 0;
    while ((m = re.exec(text)) !== null) {
      narration += text.slice(last, m.index);
      last = re.lastIndex;
      const attrs = m[2] || '';
      const pm = attrs.match(/path\s*=\s*"([^"]*)"/i) || attrs.match(/path\s*=\s*'([^']*)'/i);
      tools.push({ name: normName(m[1]), path: pm ? pm[1] : '', content: m[3] == null ? null : m[3] });
    }
    const tail = text.slice(last);
    narration += tail;
    const incomplete = /<tool\s+name\s*=/i.test(tail);
    if (incomplete) narration = narration.replace(/<tool\s+name\s*=[\s\S]*$/i, '');
    return { tools: tools, narration: narration.replace(/\n{3,}/g, '\n\n').trim(), incomplete: incomplete };
  }

  function compactReply(reply) {
    return reply.replace(/<tool\s+name\s*=\s*["']write_file["']([^>]*?)>([\s\S]*?)<\/tool>/gi, function (m, attrs, body) {
      const pm = attrs.match(/path\s*=\s*["']([^"']*)["']/i);
      return '<tool name="write_file" path="' + (pm ? pm[1] : '?') + '">(file saved, ' + body.length + ' chars)</tool>';
    });
  }

  // ------------------------------------------------------------------ Python runner (Pyodide worker)
  const PY_WORKER_SRC = [
    "let pyodide = null, loading = null;",
    "function walk(FS, dir, out) {",
    "  for (const n of FS.readdir(dir)) {",
    "    if (n === '.' || n === '..' || n === '__pycache__') continue;",
    "    const full = dir + '/' + n;",
    "    const st = FS.stat(full);",
    "    if (FS.isDir(st.mode)) walk(FS, full, out);",
    "    else out.push(full);",
    "  }",
    "}",
    "self.onmessage = async (e) => {",
    "  const d = e.data;",
    "  const out = [];",
    "  try {",
    "    if (!pyodide) {",
    "      if (!loading) {",
    "        importScripts('" + PYODIDE_BASE + "pyodide.js');",
    "        loading = loadPyodide({ indexURL: '" + PYODIDE_BASE + "' });",
    "      }",
    "      pyodide = await loading;",
    "    }",
    "    const FS = pyodide.FS;",
    "    pyodide.runPython(\"import os, sys, shutil\\nshutil.rmtree('/work', ignore_errors=True)\\nos.makedirs('/work', exist_ok=True)\\nfor _m in [k for k, v in list(sys.modules.items()) if getattr(v, '__file__', None) and str(v.__file__).startswith('/work')]:\\n    del sys.modules[_m]\\nos.chdir('/work')\\nif '/work' not in sys.path:\\n    sys.path.insert(0, '/work')\");",
    "    const before = {};",
    "    for (const p in d.files) {",
    "      const full = '/work/' + p;",
    "      const dir = full.slice(0, full.lastIndexOf('/'));",
    "      if (dir !== '/work') FS.mkdirTree(dir);",
    "      FS.writeFile(full, d.files[p]);",
    "      before[p] = d.files[p];",
    "    }",
    "    pyodide.setStdout({ batched: (s) => out.push(s) });",
    "    pyodide.setStderr({ batched: (s) => out.push(s) });",
    "    pyodide.setStdin({ stdin: () => null });",
    "    try { await pyodide.loadPackagesFromImports(d.code); } catch (pe) { out.push('(package load note: ' + pe + ')'); }",
    "    let err = '';",
    "    const g = pyodide.globals.get('dict')();",
    "    g.set('__name__', '__main__');",
    "    try { await pyodide.runPythonAsync(d.code, { globals: g }); }",
    "    catch (ex) { err = String(ex && ex.message ? ex.message : ex); }",
    "    try { g.destroy(); } catch (x) {}",
    "    const paths = []; walk(FS, '/work', paths);",
    "    const changed = {};",
    "    for (const full of paths) {",
    "      const rel = full.slice(6);",
    "      let txt;",
    "      try { txt = new TextDecoder('utf-8', { fatal: true }).decode(FS.readFile(full)); } catch (x) { continue; }",
    "      if (txt.length > 200000) continue;",
    "      if (before[rel] !== txt) changed[rel] = txt;",
    "    }",
    "    self.postMessage({ id: d.id, ok: true, out: out.join('\\n'), err: err, files: changed });",
    "  } catch (ex) {",
    "    self.postMessage({ id: d.id, ok: false, out: out.join('\\n'), err: String(ex && ex.message ? ex.message : ex), files: {} });",
    "  }",
    "};"
  ].join('\n');

  let pyWorker = null;
  let pyLoaded = false;
  let pyCounter = 0;

  function killPy() {
    if (pyWorker) { try { pyWorker.terminate(); } catch (e) {} pyWorker = null; }
  }

  function runPython(files, code, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      if (!pyWorker) {
        try {
          const blob = new Blob([PY_WORKER_SRC], { type: 'text/javascript' });
          pyWorker = new Worker(URL.createObjectURL(blob));
        } catch (e) {
          return resolve({ out: '', err: 'Python is not available in this browser (' + e.message + ').', files: {} });
        }
      }
      const worker = pyWorker;
      const id = ++pyCounter;
      const limit = pyLoaded ? 25000 : 100000;
      let settled = false;
      const done = (fn, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeEventListener('message', onMsg);
        worker.removeEventListener('error', onErr);
        if (signal) signal.removeEventListener('abort', onAbort);
        fn(val);
      };
      const onMsg = (ev) => {
        if (!ev.data || ev.data.id !== id) return;
        if (ev.data.ok) pyLoaded = true;
        done(resolve, { out: ev.data.out || '', err: ev.data.err || '', files: ev.data.files || {} });
      };
      const onErr = (ev) => {
        killPy();
        done(resolve, { out: '', err: 'Python engine failed to start (' + (ev.message || 'network blocked?') + ').', files: {} });
      };
      const onAbort = () => { killPy(); done(reject, abortError()); };
      const timer = setTimeout(() => {
        killPy();
        done(resolve, {
          out: '', files: {},
          err: pyLoaded ? 'Timed out after ' + limit / 1000 + 's (possible infinite loop or too much work).'
                        : 'Python engine took too long to load (slow connection?). Try again.'
        });
      }, limit);
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', onErr);
      if (signal) signal.addEventListener('abort', onAbort);
      worker.postMessage({ id: id, files: files, code: code });
    });
  }

  // ------------------------------------------------------------------ JavaScript runner (sandboxed iframe)
  function runJs(files, code, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
      const token = 'nj' + Math.random().toString(36).slice(2);
      const logs = [];
      let settled = false;
      const finish = (err, timedOut) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (signal) signal.removeEventListener('abort', onAbort);
        try { iframe.remove(); } catch (e) {}
        resolve({ out: logs.join('\n'), err: timedOut ? 'Timed out after 8s (infinite loop?).' : (err || ''), files: {} });
      };
      const onMsg = (ev) => {
        if (ev.source !== iframe.contentWindow) return;
        const d = ev.data;
        if (!d || d.token !== token) return;
        if (d.type === 'log') { if (logs.length < 400) logs.push(String(d.text).slice(0, 2000)); }
        else if (d.type === 'done') finish(d.error || '');
      };
      const onAbort = () => { settled = true; clearTimeout(timer); window.removeEventListener('message', onMsg); try { iframe.remove(); } catch (e) {} reject(abortError()); };
      const timer = setTimeout(() => finish('', true), 8000);
      window.addEventListener('message', onMsg);
      if (signal) signal.addEventListener('abort', onAbort);
      const payload = JSON.stringify({ code: code, files: files, token: token }).replace(/</g, '\\u003c');
      const runner = [
        '(function(){',
        'var P=' + payload + ';',
        'function send(t,x){try{parent.postMessage({token:P.token,type:t,text:x,error:x},"*");}catch(e){}}',
        'function fmt(a){return Array.prototype.map.call(a,function(v){if(typeof v==="string")return v;try{return typeof v==="object"?JSON.stringify(v):String(v);}catch(e){return String(v);}}).join(" ");}',
        '["log","info","debug"].forEach(function(k){console[k]=function(){send("log",fmt(arguments));};});',
        'console.warn=function(){send("log","[warn] "+fmt(arguments));};',
        'console.error=function(){send("log","[error] "+fmt(arguments));};',
        'window.addEventListener("error",function(e){send("log","[error] "+e.message);});',
        'window.addEventListener("unhandledrejection",function(e){send("log","[unhandled rejection] "+(e.reason&&e.reason.message||e.reason));});',
        'var AF=Object.getPrototypeOf(async function(){}).constructor;',
        '(async function(){var err="";try{await new AF("files",P.code)(P.files);}catch(e){err=(e&&e.stack?String(e.stack).split("\\n").slice(0,4).join("\\n"):String(e));}',
        'await new Promise(function(r){setTimeout(r,200);});send("done",err);})();',
        '})();'
      ].join('\n');
      iframe.srcdoc = '<!doctype html><html><body><script>' + runner.replace(/<\/script/gi, '<\\/script') + '<\/script></body></html>';
      document.body.appendChild(iframe);
    });
  }

  // ------------------------------------------------------------------ tool execution
  function clip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '\n...(output truncated)' : s;
  }

  function describeRun(res) {
    let t = '';
    if (res.out && res.out.trim()) t += '[output]\n' + clip(res.out.trim(), 2500) + '\n';
    if (res.err && res.err.trim()) t += '[error]\n' + clip(res.err.trim().split('\n').slice(-14).join('\n'), 1800) + '\n';
    if (!t) t = '(ran successfully, no output)\n';
    return t.trim();
  }

  async function execTool(tool, files, signal, state) {
    const name = tool.name;
    if (name === 'write_file') {
      const r = writeFile(files, tool.path, stripFences(tool.content == null ? '' : tool.content));
      if (!r.ok) return { ok: false, label: 'Could not write ' + (tool.path || 'file'), result: 'write_file ERROR: ' + r.msg };
      if (state.touched.indexOf(r.path) < 0) state.touched.push(r.path);
      return { ok: true, label: (r.isNew ? 'Created ' : 'Updated ') + r.path + ' (' + fmtSize(files[r.path].length) + ')', result: 'write_file ' + r.path + ': OK (' + files[r.path].length + ' chars)' };
    }
    if (name === 'read_file') {
      const p = cleanPath(tool.path);
      if (!p || !(p in files)) return { ok: false, label: 'Read ' + (tool.path || 'file') + ' (not found)', result: 'read_file ERROR: ' + (tool.path || '') + ' does not exist. Files: ' + (Object.keys(files).join(', ') || '(none)') };
      return { ok: true, label: 'Read ' + p, result: '--- ' + p + ' ---\n' + clip(files[p], 6000) };
    }
    if (name === 'delete_file') {
      const p = cleanPath(tool.path);
      if (!p || !(p in files)) return { ok: false, label: 'Delete ' + (tool.path || 'file') + ' (not found)', result: 'delete_file ERROR: not found' };
      delete files[p];
      state.touched = state.touched.filter((x) => x !== p);
      return { ok: true, label: 'Deleted ' + p, result: 'delete_file ' + p + ': OK' };
    }
    if (name === 'list_files') {
      const names = Object.keys(files).sort();
      return { ok: true, label: 'Listed files (' + names.length + ')', result: names.length ? names.map((n) => n + ' (' + files[n].length + ' chars)').join('\n') : '(workspace is empty)' };
    }
    if (name === 'run_python' || name === 'run_js') {
      const isPy = name === 'run_python';
      let code = tool.content != null && String(tool.content).trim() ? stripFences(tool.content) : '';
      let label = isPy ? 'Ran Python code' : 'Ran JavaScript code';
      if (!code && tool.path) {
        const p = cleanPath(tool.path);
        if (!p || !(p in files)) return { ok: false, label: 'Run ' + (tool.path) + ' (not found)', result: name + ' ERROR: ' + tool.path + ' does not exist' };
        code = files[p];
        label = 'Ran ' + p;
      }
      if (!code) return { ok: false, label: 'Run (nothing to run)', result: name + ' ERROR: no code or path given' };
      state.onStep(isPy && !pyLoaded ? label + ' - loading Python (first run)...' : label + '...');
      const res = isPy ? await runPython(files, code, signal) : await runJs(files, code, signal);
      let extra = '';
      if (isPy && res.files) {
        for (const p in res.files) {
          const w = writeFile(files, p, res.files[p]);
          if (w.ok) { if (state.touched.indexOf(w.path) < 0) state.touched.push(w.path); extra += '\n(file created/changed by the program: ' + w.path + ')'; }
        }
      }
      const bad = !!(res.err && res.err.trim());
      return { ok: !bad, label: label + (bad ? ' - failed' : ''), result: name + (tool.path ? ' ' + tool.path : '') + ':\n' + describeRun(res) + extra };
    }
    return { ok: false, label: 'Unknown tool "' + name + '"', result: 'ERROR: unknown tool "' + name + '". Use write_file, read_file, delete_file, list_files, run_python, run_js or finish.' };
  }

  // ------------------------------------------------------------------ progress card
  function cardHtml(convId, st) {
    const cls = st.status === 'done' ? 'done' : (st.status === 'working' ? 'working' : 'stopped');
    const badge = st.status === 'done' ? '\u2705 Done' : st.status === 'stopped' ? '\u23F9 Stopped' : st.status === 'error' ? '\u26A0\uFE0F Stopped early' : '\u23F3 Working\u2026';
    let h = '<div class="work-card" data-ws="' + esc(convId) + '">';
    h += '<div class="work-card-head"><span class="work-badge">\uD83D\uDEE0\uFE0F Work mode</span><span class="work-status ' + cls + '">' + badge + '</span></div>';
    if (st.plan) h += '<div class="work-plan">' + esc(st.plan) + '</div>';
    if (st.steps.length) {
      h += '<ul class="work-steps">';
      for (const s of st.steps) {
        h += '<li class="' + s.state + '"><span class="ws-ic">' + (s.state === 'ok' ? '\u2713' : s.state === 'err' ? '\u2717' : '\u25B6') + '</span><span class="ws-tx">' + esc(s.text) + '</span></li>';
      }
      h += '</ul>';
    }
    if (st.touched.length) {
      h += '<div class="work-chips">' + st.touched.slice(0, 12).map((f) => '<span class="work-chip">' + esc(f) + '</span>').join('') + (st.touched.length > 12 ? '<span class="work-chip">+' + (st.touched.length - 12) + ' more</span>' : '') + '</div>';
    }
    if (st.error) h += '<div class="work-error">' + esc(st.error) + '</div>';
    h += '<div class="work-card-actions"><button type="button" class="work-open-btn" data-ws="' + esc(convId) + '">\uD83D\uDCC2 Open workspace (' + st.fileCount + ' file' + (st.fileCount === 1 ? '' : 's') + ')</button></div>';
    h += '</div>';
    return h;
  }

  function stripCard(content) {
    const s = String(content || '');
    if (s.indexOf('<div class="work-card"') !== 0) return s;
    const i = s.indexOf('\n\n');
    return i < 0 ? '' : s.slice(i + 2);
  }

  // ------------------------------------------------------------------ model call (SSE)
  async function callModel(o, messages, context, signal, onProgress) {
    const body = Object.assign({}, o.extraBody || {}, {
      messages: messages,
      model: o.model || 'kazai',
      temperature: 0.35,
      work: true,
      workContext: context,
      thinking: 'moderate',
      isImageMode: false,
      webSearch: false
    });
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal });
    if (signal && signal.aborted) throw abortError();
    if (!res.ok) {
      const e = new Error('HTTP ' + res.status);
      e.noRetry = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
      throw e;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    let text = '';
    let sawDone = false;
    let serverError = '';
    const handle = (raw) => {
      const line = raw.trim();
      if (!line.startsWith('data:')) return;
      const j = line.replace(/^data:\s*/, '').trim();
      if (!j) return;
      try {
        const d = JSON.parse(j);
        if (d.error) serverError = String(d.error);
        if (d.delta) { text += d.delta; onProgress(text.length); }
        if (d.done) sawDone = true;
      } catch (e) { /* ignore partial frame */ }
    };
    for (;;) {
      if (signal && signal.aborted) { try { reader.cancel(); } catch (x) {} throw abortError(); }
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      const parts = buf.replace(/\r\n/g, '\n').split('\n\n');
      buf = parts.pop();
      parts.forEach(handle);
    }
    if (buf.trim()) handle(buf);
    if (serverError && !text.trim()) { const e = new Error(serverError); throw e; }
    if (!sawDone && !text.trim()) throw new Error('stream-dropped');
    return text;
  }

  async function callModelRetry(o, messages, context, signal, onProgress, onRetry) {
    const delays = [2500, 6000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await callModel(o, messages, context, signal, onProgress);
      } catch (e) {
        if (e.name === 'AbortError' || e.noRetry || attempt >= delays.length) throw e;
        onRetry(attempt + 1);
        await sleep(delays[attempt]);
        if (signal && signal.aborted) throw abortError();
      }
    }
  }

  // ------------------------------------------------------------------ the agent loop
  async function runAgent(o) {
    const files = loadWs(o.convId);
    const st = { status: 'working', plan: '', steps: [], touched: [], error: '', fileCount: Object.keys(files).length };
    let summary = '';
    const emit = () => {
      st.fileCount = Object.keys(files).length;
      o.onUpdate(cardHtml(o.convId, st), summary);
    };
    const pushStep = (text, state) => { const s = { text: text, state: state || 'run' }; st.steps.push(s); emit(); return s; };

    const msgs = [];
    (o.history || []).slice(-4).forEach((m) => {
      let c = stripCard(m.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!c) return;
      msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: c.slice(0, 1500) });
    });
    // roles must alternate sensibly; the new task always comes last as a user message
    msgs.push({ role: 'user', content: o.userText });

    emit();
    let finished = false;
    try {
      for (let round = 0; round < MAX_ROUNDS && !finished; round++) {
        if (o.signal.aborted) throw abortError();
        const thinkStep = pushStep(round === 0 ? 'Planning the work\u2026' : 'Thinking about the next step\u2026', 'run');
        let reply = '';
        try {
          reply = await callModelRetry(o, msgs, snapshot(files), o.signal,
            (n) => { thinkStep.text = (round === 0 ? 'Planning & writing' : 'Writing') + '\u2026 (' + n + ' chars)'; emit(); },
            (n) => { thinkStep.text = 'Connection hiccup - retrying (' + n + ')\u2026'; emit(); });
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          thinkStep.state = 'err';
          thinkStep.text = 'The AI engine did not respond';
          st.status = 'error';
          st.error = 'Nova could not reach the AI engine (' + (e.message || 'error') + '). Your files so far are kept - tap send to continue.';
          break;
        }
        const parsed = parseTools(reply);
        st.steps.splice(st.steps.indexOf(thinkStep), 1);
        if (round === 0 && parsed.narration) st.plan = parsed.narration.slice(0, 420);

        if (!parsed.tools.length) {
          if (parsed.incomplete) {
            msgs.push({ role: 'assistant', content: '(reply was cut off)' });
            msgs.push({ role: 'user', content: 'ACTION RESULTS:\nYour last reply was cut off before the closing </tool> tag. Write it again, more compactly, using complete files.' });
            pushStep('Reply was cut off - asking Nova to retry', 'err');
            continue;
          }
          summary = parsed.narration || reply.trim();
          finished = true;
          break;
        }

        const results = [];
        let finishNote = null;
        for (const tool of parsed.tools) {
          if (o.signal.aborted) throw abortError();
          if (tool.name === 'finish') { finishNote = (tool.content != null ? tool.content.trim() : '') || parsed.narration; break; }
          const step = pushStep(tool.name === 'write_file' ? 'Writing ' + (tool.path || 'file') + '\u2026' : 'Working\u2026', 'run');
          st.onStep = null;
          const ctx = { touched: st.touched, onStep: (t) => { step.text = t; emit(); } };
          let r;
          try {
            r = await execTool(tool, files, o.signal, ctx);
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            r = { ok: false, label: 'Tool failed', result: 'ERROR: ' + (e.message || e) };
          }
          st.touched = ctx.touched;
          step.state = r.ok ? 'ok' : 'err';
          step.text = r.label;
          results.push(r.result);
          saveWs(o.convId, files);
          emit();
        }
        saveWs(o.convId, files);
        if (parsed.incomplete) results.push('WARNING: your last tool call was cut off (no closing </tool>), so it was NOT executed. Write it again more compactly.');
        if (finishNote !== null) { summary = finishNote; finished = true; break; }
        msgs.push({ role: 'assistant', content: compactReply(reply) });
        msgs.push({ role: 'user', content: 'ACTION RESULTS:\n' + results.join('\n\n') + '\n\nContinue the job. If everything works and the job is complete, call finish with a short summary.' });
      }
      if (!finished && st.status === 'working') {
        summary = 'I did as much as I could in the step limit. Open the workspace to see the files, and tell me what to change or continue.';
        st.status = 'done';
      } else if (finished) {
        st.status = 'done';
      }
      if (st.status === 'error' && !summary) summary = '';
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
      st.status = 'stopped';
      st.steps.forEach((s) => { if (s.state === 'run') { s.state = 'err'; s.text = s.text.replace(/\u2026$/, '') + ' (stopped)'; } });
      saveWs(o.convId, files);
      emit();
      return { html: cardHtml(o.convId, st), summary: summary, stopped: true };
    }
    saveWs(o.convId, files);
    emit();
    return { html: cardHtml(o.convId, st), summary: summary, stopped: false };
  }

  // ------------------------------------------------------------------ ZIP (store only)
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const names = Object.keys(files);
    names.forEach((name) => {
      const nb = enc.encode(name);
      const data = enc.encode(files[name]);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), nb, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nb);
      offset += 30 + nb.length + data.length;
    });
    let cSize = 0;
    central.forEach((c) => { cSize += c.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, names.length, true); end.setUint16(10, names.length, true);
    end.setUint32(12, cSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  // ------------------------------------------------------------------ preview document
  function buildPreviewDoc(files, entry, token) {
    let html = String(files[entry] || '');
    const lookup = (href) => {
      const p = cleanPath(String(href).split(/[?#]/)[0]);
      return p && p in files ? files[p] : null;
    };
    html = html.replace(/<link\b[^>]*>/gi, (m) => {
      if (!/rel\s*=\s*["']?stylesheet/i.test(m)) return m;
      const hm = m.match(/href\s*=\s*["']([^"']+)["']/i);
      const css = hm ? lookup(hm[1]) : null;
      return css == null ? m : '<style>' + css.replace(/<\/style/gi, '<\\/style') + '</style>';
    });
    html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, src, b) => {
      const js = lookup(src);
      return js == null ? m : '<script' + (a + b).replace(/\s+$/, '') + '>' + js.replace(/<\/script/gi, '<\\/script') + '<\/script>';
    });
    const hook = '<script>(function(){var T=' + JSON.stringify(token) + ';function s(t,x){try{parent.postMessage({prev:T,type:t,text:x},"*");}catch(e){}}' +
      'function f(a){return Array.prototype.map.call(a,function(v){if(typeof v==="string")return v;try{return typeof v==="object"?JSON.stringify(v):String(v);}catch(e){return String(v);}}).join(" ");}' +
      '["log","info","debug"].forEach(function(k){var o=console[k];console[k]=function(){s("log",f(arguments));try{o.apply(console,arguments);}catch(e){}};});' +
      'var w=console.warn;console.warn=function(){s("log","[warn] "+f(arguments));try{w.apply(console,arguments);}catch(e){}};' +
      'var er=console.error;console.error=function(){s("log","[error] "+f(arguments));try{er.apply(console,arguments);}catch(e){}};' +
      'window.addEventListener("error",function(e){s("log","[error] "+e.message+(e.lineno?" (line "+e.lineno+")":""));});' +
      'window.addEventListener("unhandledrejection",function(e){s("log","[unhandled rejection] "+(e.reason&&e.reason.message||e.reason));});' +
      'function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},setItem:function(k,v){d[k]=String(v);},removeItem:function(k){delete d[k];},clear:function(){d={};},key:function(i){return Object.keys(d)[i]||null;},get length(){return Object.keys(d).length;}};}' +
      '["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x");}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true});}catch(e2){}}});' +
      '})();<\/script>';
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + hook);
    else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => m + '<head>' + hook + '</head>');
    else html = hook + html;
    return html;
  }

  // ------------------------------------------------------------------ workspace modal
  let modal = null;
  const M = { convId: '', files: {}, current: '', tab: 'files', token: '' };

  function langOf(name) {
    const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'nw-overlay';
    modal.innerHTML =
      '<div class="nw-modal" role="dialog" aria-label="Nova workspace">' +
      '<div class="nw-head"><div class="nw-title">\uD83D\uDEE0\uFE0F Nova Workspace <span class="nw-sub" id="nwSub"></span></div>' +
      '<div class="nw-head-actions"><button type="button" class="nw-btn" data-act="zip">\u2B07 Download ZIP</button>' +
      '<button type="button" class="nw-btn nw-close" data-act="close" aria-label="Close">\u2715</button></div></div>' +
      '<div class="nw-tabs"><button type="button" data-tab="files" class="active">Files</button>' +
      '<button type="button" data-tab="preview">Preview</button><button type="button" data-tab="console">Console</button></div>' +
      '<div class="nw-body">' +
      '<div class="nw-pane nw-pane-files active"><div class="nw-filelist" id="nwList"></div>' +
      '<div class="nw-viewer"><div class="nw-viewer-bar"><span class="nw-fname" id="nwName"></span>' +
      '<span class="nw-viewer-actions"><button type="button" class="nw-btn" data-act="run" id="nwRun" style="display:none">\u25B6 Run</button>' +
      '<button type="button" class="nw-btn" data-act="copy">Copy</button></span></div>' +
      '<pre class="nw-code"><code id="nwCode"></code></pre></div></div>' +
      '<div class="nw-pane nw-pane-preview"><div class="nw-prev-bar"><span id="nwPrevName"></span>' +
      '<span class="nw-viewer-actions"><button type="button" class="nw-btn" data-act="reload">\u21BB Reload</button></span></div>' +
      '<iframe id="nwFrame" sandbox="allow-scripts allow-modals allow-forms allow-popups" title="Preview"></iframe></div>' +
      '<div class="nw-pane nw-pane-console"><div class="nw-prev-bar"><span>Console</span><span class="nw-viewer-actions"><button type="button" class="nw-btn" data-act="clear">Clear</button></span></div>' +
      '<pre class="nw-console" id="nwConsole"></pre></div>' +
      '</div></div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) return closeModal();
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) return setTab(tabBtn.getAttribute('data-tab'));
      const file = e.target.closest('[data-file]');
      if (file) { M.current = file.getAttribute('data-file'); return renderFiles(); }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.getAttribute('data-act');
      if (a === 'close') closeModal();
      else if (a === 'zip') downloadZip();
      else if (a === 'copy') copyCurrent();
      else if (a === 'run') runCurrent();
      else if (a === 'reload') loadPreview();
      else if (a === 'clear') { document.getElementById('nwConsole').textContent = ''; }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal && modal.classList.contains('open')) closeModal(); });
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || !M.token || d.prev !== M.token) return;
      logConsole(d.text);
    });
    return modal;
  }

  function logConsole(text) {
    const c = document.getElementById('nwConsole');
    if (!c) return;
    c.textContent += (c.textContent ? '\n' : '') + text;
    c.scrollTop = c.scrollHeight;
  }

  function setTab(tab) {
    M.tab = tab;
    modal.querySelectorAll('.nw-tabs button').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
    modal.querySelectorAll('.nw-pane').forEach((p) => p.classList.remove('active'));
    modal.querySelector('.nw-pane-' + tab).classList.add('active');
    if (tab === 'preview') loadPreview();
  }

  function entryFile() {
    const names = Object.keys(M.files);
    if ('index.html' in M.files) return 'index.html';
    return names.find((n) => /\.html?$/i.test(n)) || '';
  }

  function loadPreview() {
    const frame = document.getElementById('nwFrame');
    const entry = entryFile();
    document.getElementById('nwPrevName').textContent = entry ? 'Preview: ' + entry : 'Preview';
    M.token = 'pv' + Math.random().toString(36).slice(2);
    if (!entry) {
      frame.srcdoc = '<body style="font-family:system-ui;padding:24px;color:#666">No HTML page in this workspace yet.<br>Ask Nova to build a web page and it will show up here.</body>';
      return;
    }
    frame.srcdoc = buildPreviewDoc(M.files, entry, M.token);
  }

  function renderFiles() {
    const names = Object.keys(M.files).sort();
    document.getElementById('nwSub').textContent = names.length + ' file' + (names.length === 1 ? '' : 's');
    const list = document.getElementById('nwList');
    if (!names.length) {
      list.innerHTML = '<div class="nw-empty">No files yet.</div>';
      document.getElementById('nwName').textContent = '';
      document.getElementById('nwCode').textContent = '';
      document.getElementById('nwRun').style.display = 'none';
      return;
    }
    if (!(M.current in M.files)) M.current = entryFile() || names[0];
    list.innerHTML = names.map((n) =>
      '<button type="button" class="nw-file' + (n === M.current ? ' active' : '') + '" data-file="' + esc(n) + '"><span class="nw-file-n">' + esc(n) + '</span><span class="nw-file-s">' + fmtSize(M.files[n].length) + '</span></button>').join('');
    document.getElementById('nwName').textContent = M.current;
    document.getElementById('nwCode').textContent = M.files[M.current];
    const l = langOf(M.current);
    document.getElementById('nwRun').style.display = (l === 'py' || l === 'js') ? '' : 'none';
  }

  async function runCurrent() {
    const name = M.current;
    const l = langOf(name);
    if (!(name in M.files) || (l !== 'py' && l !== 'js')) return;
    setTab('console');
    logConsole('$ run ' + name + (l === 'py' && !pyLoaded ? '   (loading Python, first run can take a while\u2026)' : ''));
    const res = l === 'py' ? await runPython(M.files, M.files[name], null) : await runJs(M.files, M.files[name], null);
    if (res.out && res.out.trim()) logConsole(res.out.trimEnd());
    if (res.err && res.err.trim()) logConsole('[error] ' + res.err.trim());
    if (!(res.out && res.out.trim()) && !(res.err && res.err.trim())) logConsole('(finished, no output)');
    if (res.files) {
      let changed = false;
      for (const p in res.files) { if (writeFile(M.files, p, res.files[p]).ok) { changed = true; logConsole('(saved ' + p + ')'); } }
      if (changed) { saveWs(M.convId, M.files); renderFiles(); }
    }
  }

  function copyCurrent() {
    const t = M.files[M.current];
    if (t == null) return;
    const done = () => deps.toast('Copied ' + M.current);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => {});
    else done();
  }

  function downloadZip() {
    if (!Object.keys(M.files).length) return deps.toast('Nothing to download yet');
    const blob = makeZip(M.files);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nova-workspace.zip';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function openWorkspace(convId) {
    ensureModal();
    M.convId = convId;
    M.files = loadWs(convId);
    M.current = '';
    document.getElementById('nwConsole').textContent = '';
    renderFiles();
    setTab(Object.keys(M.files).length && entryFile() ? 'preview' : 'files');
    modal.classList.add('open');
    document.body.classList.add('nw-open');
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('open');
    document.body.classList.remove('nw-open');
    const f = document.getElementById('nwFrame');
    if (f) f.srcdoc = '';
    M.token = '';
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.work-open-btn');
    if (!b) return;
    e.preventDefault();
    openWorkspace(b.getAttribute('data-ws') || '');
  });

  window.NovaWork = {
    init: function (d) { deps = Object.assign(deps, d || {}); },
    runAgent: runAgent,
    stripCard: stripCard,
    openWorkspace: openWorkspace,
    // exposed for testing
    _parseTools: parseTools,
    _buildPreviewDoc: buildPreviewDoc,
    _makeZip: makeZip,
    _cleanPath: cleanPath,
    _runJs: runJs,
    _runPython: runPython
  };
})();
