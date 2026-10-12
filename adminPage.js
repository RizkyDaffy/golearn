/**
 * Server-rendered admin UI for /admin/pins (vanilla JS + Tailwind CDN).
 * The page itself is public; every API call it makes needs an admin PIN session.
 */
function renderAdminPage() {
    return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Golearn - PIN Manager</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/lucide@latest"></script>
<style>
  body { font-family: 'Plus Jakarta Sans', 'Segoe UI', Inter, sans-serif; }
  .key-btn { transition: transform .08s ease, background .15s ease; }
  .key-btn:active { transform: scale(.92); }
  .dot { width: 14px; height: 14px; border-radius: 9999px; background: #1e293b; border: 2px solid #334155; }
  .dot.on { background: #58CC02; border-color: #58CC02; }
  .shake { animation: shake .35s; }
  @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-9px)} 40%{transform:translateX(9px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
  [hidden] { display: none !important; }
</style>
</head>
<body class="bg-[#0B0F17] text-slate-100 min-h-screen">

<!-- ============================ PIN GATE ============================ -->
<div id="gate" class="min-h-screen flex items-center justify-center p-6">
  <div class="w-full max-w-sm text-center">
    <div class="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-emerald-500/15 border border-emerald-500/30 mb-5">
      <i data-lucide="shield-check" class="w-8 h-8 text-emerald-400"></i>
    </div>
    <h1 class="text-2xl font-bold mb-1">Admin PIN</h1>
    <p class="text-slate-400 text-sm mb-6">Enter an admin PIN to manage accounts.</p>
    <div id="dots" class="flex items-center justify-center gap-3 mb-3 min-h-[20px]"></div>
    <div id="gateError" class="h-5 text-duo-red text-sm font-semibold mb-2" style="color:#FF4B4B"></div>
    <div class="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="1">1</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="2">2</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="3">3</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="4">4</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="5">5</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="6">6</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="7">7</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="8">8</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="9">9</button>
      <button class="key-btn py-4 rounded-2xl bg-transparent" data-key="clear" style="color:#94a3b8">Clear</button>
      <button class="key-btn py-4 rounded-2xl bg-slate-800 text-xl font-bold" data-key="0">0</button>
      <button class="key-btn py-4 rounded-2xl bg-transparent flex items-center justify-center" data-key="back"><i data-lucide="delete" class="w-6 h-6" style="color:#94a3b8"></i></button>
    </div>
    <button id="gateUnlock" class="mt-5 w-full max-w-[280px] py-3.5 rounded-2xl font-bold text-[#0B0F17]" style="background:#58CC02">Unlock</button>
    <a href="/" class="block mt-4 text-sm" style="color:#94a3b8">&larr; Back to Golearn</a>
  </div>
</div>

<!-- ============================ MANAGER ============================ -->
<div id="manager" hidden>
  <header class="sticky top-0 z-20 bg-[#0F172A]/90 backdrop-blur border-b border-slate-800">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-lg font-bold">Golearn</span>
        <span class="text-xs font-bold px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">PIN MANAGER</span>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <a href="/view/list" id="viewLink" class="hidden sm:inline-flex px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">Questions</a>
        <a href="/" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">Open app</a>
        <span id="whoami" class="px-3 py-2 rounded-xl bg-slate-800/60 text-slate-300 hidden sm:inline"></span>
        <button id="signOut" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">Sign out</button>
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

    <section class="bg-[#1E293B] border border-slate-700/60 rounded-2xl p-5">
      <h2 class="font-bold mb-4 flex items-center gap-2"><i data-lucide="user-plus" class="w-5 h-5 text-emerald-400"></i>New PIN account</h2>
      <form id="createForm" class="grid grid-cols-2 sm:grid-cols-12 gap-3 items-end">
        <label class="col-span-2 sm:col-span-4 block">
          <span class="text-xs font-semibold text-slate-400">Username</span>
          <input name="username" required maxlength="40" autocomplete="off" placeholder="e.g. siti.a"
            class="mt-1 w-full px-3 py-2.5 rounded-xl bg-[#0B0F17] border border-slate-700 outline-none focus:border-emerald-500">
        </label>
        <label class="block">
          <span class="text-xs font-semibold text-slate-400">PIN</span>
          <input name="pin" inputmode="numeric" autocomplete="off" placeholder="auto"
            class="mt-1 w-full sm:w-32 px-3 py-2.5 rounded-xl bg-[#0B0F17] border border-slate-700 outline-none focus:border-emerald-500">
        </label>
        <label class="block col-span-2 sm:col-span-3">
          <span class="text-xs font-semibold text-slate-400">Role</span>
          <select name="role" class="mt-1 w-full px-3 py-2.5 rounded-xl bg-[#0B0F17] border border-slate-700 outline-none">
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label class="col-span-2 sm:col-span-3 block">
          <span class="text-xs font-semibold text-slate-400">Note (optional)</span>
          <input name="note" maxlength="200" autocomplete="off" placeholder="class 7B"
            class="mt-1 w-full px-3 py-2.5 rounded-xl bg-[#0B0F17] border border-slate-700 outline-none focus:border-emerald-500">
        </label>
        <button class="col-span-2 sm:col-span-12 sm:w-auto px-5 py-2.5 rounded-xl font-bold text-[#0B0F17]" style="background:#58CC02">Create</button>
      </form>
      <p class="text-xs text-slate-500 mt-3">PIN = 4-10 digits. Leave it empty to generate one automatically, then share it with the user.</p>
      <div id="reveal" hidden class="mt-4 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
        <div class="text-xs font-semibold text-emerald-300 mb-1">Show this once to the user</div>
        <div class="flex items-center gap-3 flex-wrap">
          <span id="revealText" class="text-xl font-mono font-bold tracking-[0.3em]"></span>
          <button id="copyPin" class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700">Copy</button>
        </div>
      </div>
    </section>

    <section class="bg-[#1E293B] border border-slate-700/60 rounded-2xl overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-700/60 flex items-center justify-between">
        <h2 class="font-bold flex items-center gap-2"><i data-lucide="key-round" class="w-5 h-5 text-emerald-400"></i>Accounts</h2>
        <span id="count" class="text-xs text-slate-400"></span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-slate-400 bg-[#0F172A]/60">
            <tr>
              <th class="px-5 py-3 font-semibold">Username</th>
              <th class="px-3 py-3 font-semibold">Role</th>
              <th class="px-3 py-3 font-semibold">Status</th>
              <th class="px-3 py-3 font-semibold">Last used</th>
              <th class="px-5 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </section>
  </main>
</div>

<div id="toast" hidden class="fixed bottom-6 right-6 max-w-xs px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-lg"></div>

<script>
(function () {
  var TOKEN_KEY = 'welearn_pin_token';
  var token = localStorage.getItem(TOKEN_KEY) || '';
  var me = null;

  var gate = document.getElementById('gate');
  var manager = document.getElementById('manager');
  var dotsEl = document.getElementById('dots');
  var errEl = document.getElementById('gateError');
  var rowsEl = document.getElementById('rows');
  var toastEl = document.getElementById('toast');
  var typed = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.style.background = bad ? '#FF4B4B' : '#16a34a';
    toastEl.hidden = false;
    setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (token) opts.headers.authorization = 'Bearer ' + token;
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.error || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function unlock() {
    gate.hidden = true;
    manager.hidden = false;
    document.getElementById('whoami').textContent = me.username + (me.role === 'admin' ? ' (admin)' : '');
    document.getElementById('viewLink').href = '/view/list?token=' + encodeURIComponent(token);
    render();
  }

  function lock(message) {
    manager.hidden = true;
    gate.hidden = false;
    errEl.textContent = message || '';
    typed = '';
    drawDots();
  }

  // ---------------- gate keypad ----------------
  function drawDots() {
    var html = '';
    for (var i = 0; i < Math.max(typed.length, 4); i++) {
      html += '<span class="dot' + (i < typed.length ? ' on' : '') + '"></span>';
    }
    dotsEl.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
  }

  function press(key) {
    errEl.textContent = '';
    if (key === 'back') typed = typed.slice(0, -1);
    else if (key === 'clear') typed = '';
    else if (typed.length < 10) typed += key;
    drawDots();
  }

  gate.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-key]');
    if (btn) press(btn.getAttribute('data-key'));
  });

  document.getElementById('gateUnlock').addEventListener('click', submitPin);

  document.addEventListener('keydown', function (e) {
    if (!manager.hidden) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') submitPin();
    else return;
  });

  function submitPin() {
    if (typed.length < 4) {
      errEl.textContent = 'PIN is too short';
      gate.firstElementChild.classList.add('shake');
      setTimeout(function () { gate.firstElementChild.classList.remove('shake'); }, 400);
      return;
    }
    api('/api/auth/pin', { method: 'POST', body: JSON.stringify({ pin: typed }) })
      .then(function (data) {
        if (data.role !== 'admin') {
          errEl.textContent = 'That PIN is not an admin PIN';
          return;
        }
        token = data.token;
        localStorage.setItem(TOKEN_KEY, token);
        me = { username: data.username, role: data.role };
        typed = '';
        unlock();
      })
      .catch(function (err) { errEl.textContent = err.message; });
  }

  // ---------------- table ----------------
  function fmtDate(value) {
    if (!value) return 'never';
    var d = new Date(value);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function render() {
    api('/api/admin/pins').then(function (data) {
      document.getElementById('count').textContent = data.pins.length + ' account(s)';
      rowsEl.innerHTML = data.pins.map(function (p) {
        var isSelf = p.id === data.actor.id;
        return '<tr class="border-t border-slate-700/50 hover:bg-slate-700/20" data-id="' + esc(p.id) + '">'
          + '<td class="px-5 py-3"><div class="font-semibold">' + esc(p.username)
          + (isSelf ? ' <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">you</span>' : '')
          + '</div>' + (p.note ? '<div class="text-xs text-slate-400">' + esc(p.note) + '</div>' : '') + '</td>'
          + '<td class="px-3 py-3"><select class="role px-2 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-700 text-xs">'
          + ['user', 'admin'].map(function (r) { return '<option value="' + r + '"' + (r === p.role ? ' selected' : '') + '>' + r + '</option>'; }).join('')
          + '</select></td>'
          + '<td class="px-3 py-3"><span class="text-xs px-2 py-1 rounded-lg ' + (p.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400') + '">' + (p.active ? 'active' : 'disabled') + '</span></td>'
          + '<td class="px-3 py-3 text-xs text-slate-400">' + fmtDate(p.last_used_at) + '</td>'
          + '<td class="px-5 py-3 whitespace-nowrap text-right">'
          + '<button class="act px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs" data-act="rename">Rename</button> '
          + '<button class="act px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs" data-act="reset">New PIN</button> '
          + '<button class="act px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs" data-act="toggle">' + (p.active ? 'Disable' : 'Enable') + '</button> '
          + '<button class="act px-2.5 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-xs" data-act="delete"' + (isSelf ? ' disabled' : '') + '>Delete</button>'
          + '</td></tr>';
      }).join('');
    }).catch(function (err) {
      if (err.status === 401 || err.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        token = '';
        lock(err.status === 403 ? 'Admin PIN required' : '');
      } else {
        toast(err.message, true);
      }
    });
  }

  function patch(id, body) {
    return api('/api/admin/pins/' + id, { method: 'PATCH', body: JSON.stringify(body) })
      .then(function (res) { render(); return res; });
  }

  rowsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.act');
    if (!btn || btn.disabled) return;
    var row = btn.closest('tr');
    var id = row.getAttribute('data-id');
    var name = row.querySelector('.font-semibold').childNodes[0].textContent.trim();
    var act = btn.getAttribute('data-act');

    if (act === 'rename') {
      var next = window.prompt('Username for ' + name + ':', name);
      if (!next || next.trim() === name) return;
      patch(id, { username: next.trim() }).catch(function (err) { toast(err.message, true); });
    } else if (act === 'reset') {
      var pin = window.prompt('New PIN for ' + name + ' (4-10 digits). Leave empty to generate:');
      if (pin === null) return;
      var payload = { pin: pin.trim() };
      if (!payload.pin) payload.pin = String(Math.floor(100000 + Math.random() * 900000));
      patch(id, payload).then(function (res) {
        if (res.pin && res.pin.pin) toast(name + ' PIN is now ' + res.pin.pin);
      }).catch(function (err) { toast(err.message, true); });
    } else if (act === 'toggle') {
      patch(id, { active: btn.textContent === 'Enable' }).catch(function (err) { toast(err.message, true); });
    } else if (act === 'delete') {
      if (!window.confirm('Delete ' + name + '? This cannot be undone.')) return;
      api('/api/admin/pins/' + id, { method: 'DELETE' }).then(render).catch(function (err) { toast(err.message, true); });
    }
  });

  rowsEl.addEventListener('change', function (e) {
    if (!e.target.classList.contains('role')) return;
    var id = e.target.closest('tr').getAttribute('data-id');
    patch(id, { role: e.target.value }).catch(function (err) {
      toast(err.message, true);
      render();
    });
  });

  // ---------------- create ----------------
  document.getElementById('createForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var body = {
      username: form.username.value,
      pin: form.pin.value.trim() || undefined,
      role: form.role.value,
      note: form.note.value.trim() || undefined,
    };
    api('/api/admin/pins', { method: 'POST', body: JSON.stringify(body) }).then(function (res) {
      form.reset();
      var reveal = document.getElementById('reveal');
      document.getElementById('revealText').textContent = res.pin.username + '  ' + res.pin.pin;
      reveal.hidden = false;
      render();
    }).catch(function (err) { toast(err.message, true); });
  });

  document.getElementById('copyPin').addEventListener('click', function () {
    navigator.clipboard.writeText(document.getElementById('revealText').textContent).then(function () {
      toast('Copied');
    });
  });

  document.getElementById('signOut').addEventListener('click', function () {
    localStorage.removeItem(TOKEN_KEY);
    token = '';
    me = null;
    lock('');
  });

  // ---------------- boot ----------------
  drawDots();
  if (window.lucide) window.lucide.createIcons();

  if (token) {
    api('/api/auth/me').then(function (data) {
      if (data.role !== 'admin') {
        lock('Use an admin PIN for this page');
        return;
      }
      me = data;
      unlock();
    }).catch(function () {
      localStorage.removeItem(TOKEN_KEY);
      token = '';
    });
  }
})();
</script>
</body>
</html>`;
}

module.exports = { renderAdminPage };
