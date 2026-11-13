/* ============================================================
   لوحة تحكم البوت — منطق التطبيق
   يتكلم مع نقاط /admin/api على خادم البوت.
   ============================================================ */
(function () {
  'use strict';

  // ---- الحالة المحفوظة في المتصفح ----
  const store = {
    get url() { return localStorage.getItem('adminApiUrl') || ''; },
    set url(v) { localStorage.setItem('adminApiUrl', v); },
    get token() { return localStorage.getItem('adminToken') || ''; },
    set token(v) { localStorage.setItem('adminToken', v); },
    clear() { localStorage.removeItem('adminApiUrl'); localStorage.removeItem('adminToken'); },
  };

  const state = {
    usersPage: 1,
    usersQuery: '',
    usersBannedOnly: false,
    usersTotal: 0,
    usersPages: 1,
    withdrawals: [],
    connected: false,
  };

  // ---- اختصارات ----
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const date = (s) => s ? String(s).slice(0, 16).replace('T', ' ') : '—';

  function toast(msg, kind = 'ok') {
    const el = $('toast');
    el.textContent = msg;
    el.className = `toast ${kind}`;
    setTimeout(() => el.classList.add('hidden'), 3500);
  }

  // ---- نداء الـ API ----
  async function api(path, options = {}) {
    const res = await fetch(`${store.url.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': store.token,
        ...(options.headers || {}),
      },
    });
    let data = {};
    try { data = await res.json(); } catch { /* استجابة فارغة */ }
    if (!res.ok) {
      const err = new Error(data.error || `خطأ ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ============ الدخول ============
  async function login() {
    const url = $('apiUrl').value.trim().replace(/\/$/, '');
    const token = $('apiToken').value.trim();
    const errBox = $('loginError');
    const btn = $('loginBtn');

    errBox.classList.add('hidden');
    if (!url || !token) {
      errBox.textContent = '⚠️ أدخل الرابط ورمز الدخول.';
      errBox.classList.remove('hidden');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      errBox.textContent = '⚠️ الرابط لازم يبدأ بـ http:// أو https://';
      errBox.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ جارٍ الاتصال...';
    try {
      store.url = url;
      store.token = token;
      // 1) نتحقق من الرابط أولاً عبر /ping (ما يحتاج رمز) —
      //    هكا نفرّق بين «رابط غلط» و«رمز غلط» في الرسالة.
      const ping = await fetch(`${url}/admin/api/ping`);
      if (!ping.ok) throw new Error(`الخدمة ما تستجيبش (${ping.status})`);
      // 2) ثم نتحقق من الرمز عبر نقطة محمية
      await api('/admin/api/stats');
      enterApp();
      toast('✅ تم الاتصال بلوحة التحكم');
    } catch (err) {
      let msg;
      if (err.status === 401) {
        msg = '❌ رمز الدخول غير صحيح — تأكد من ADMIN_API_TOKEN.';
      } else if (err.status === 503) {
        msg = '❌ واجهة الإدارة معطّلة على السيرفر — اضبط ADMIN_API_TOKEN.';
      } else if (/Failed to fetch|NetworkError|fetch failed/i.test(err.message)) {
        msg = '❌ تعذّر الوصول للرابط.\n\nتأكد أنه صحيح، وأن الخدمة تعمل (Render المجاني ينام — افتح الرابط في المتصفح أولاً).';
      } else {
        msg = `❌ ${err.message}`;
      }
      errBox.textContent = msg;
      errBox.classList.remove('hidden');
      store.clear();
    } finally {
      btn.disabled = false;
      btn.textContent = 'دخول';
    }
  }

  function enterApp() {
    $('loginScreen').classList.add('hidden');
    $('app').classList.remove('hidden');
    state.connected = true;
    setConnBadge('متصل', 'ok');
    refreshAll();
  }

  function logout() {
    store.clear();
    state.connected = false;
    $('app').classList.add('hidden');
    $('loginScreen').classList.remove('hidden');
    $('apiToken').value = '';
  }

  function setConnBadge(text, kind) {
    const b = $('connBadge');
    b.textContent = text;
    b.className = `badge ${kind || ''}`;
  }

  // ============ التبويبات ============
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'users') loadUsers();
      if (btn.dataset.tab === 'withdrawals') loadWithdrawals();
      if (btn.dataset.tab === 'deposits') loadDeposits();
    });
  });

  // ============ الرئيسية ============
  async function loadStats() {
    try {
      const s = await api('/admin/api/stats');
      $('stUsers').textContent = num(s.users);
      $('stBanned').textContent = num(s.banned);
      $('stBalances').textContent = money(s.balances);
      $('stDeposited').textContent = money(s.deposited);
      $('stWithdrawn').textContent = money(s.withdrawn);
      $('stProfit').textContent = money(s.profit);
      $('stActive').textContent = `${num(s.activeInvestments.count)} (${money(s.activeInvestments.total)})`;
      $('stPending').textContent = `${num(s.pendingWithdrawals.count)} (${money(s.pendingWithdrawals.total)})`;
      $('stReferrals').textContent = num(s.referrals);

      $('dashInfo').innerHTML =
        `مكافأة الإحالة: <b>${money(s.referralBonus)}</b> · ` +
        `الحد الأدنى للإيداع: <b>${money(s.minDeposit)}</b> · ` +
        `وقت السيرفر: <b>${date(s.serverTime)}</b>`;

      const pending = s.pendingWithdrawals.count;
      const badge = $('wdBadge');
      if (pending > 0) {
        badge.textContent = pending;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
      setConnBadge('متصل', 'ok');
    } catch (err) {
      setConnBadge('انقطع الاتصال', 'err');
      toast(err.message, 'err');
      if (err.status === 401) logout();
    }
  }

  // ============ المستخدمون ============
  async function loadUsers() {
    const params = new URLSearchParams({
      page: state.usersPage,
      q: state.usersQuery,
      banned: state.usersBannedOnly ? '1' : '0',
    });
    try {
      const data = await api(`/admin/api/users?${params}`);
      state.usersTotal = data.total;
      state.usersPages = data.pages;
      const tbody = $('usersTable').querySelector('tbody');

      if (data.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">لا نتائج</td></tr>';
      } else {
        tbody.innerHTML = data.users.map((u) => `
          <tr>
            <td><code>${esc(u.id)}</code></td>
            <td>${esc(u.firstName || '—')}${u.username ? `<br><span class="muted">@${esc(u.username)}</span>` : ''}</td>
            <td><b>${money(u.balance)}</b></td>
            <td>${money(u.totalDeposited)}</td>
            <td>${money(u.totalWithdrawn)}</td>
            <td>${u.banned
              ? `<span class="pill err">محظور</span>${u.banReason ? `<br><span class="muted" style="font-size:.75rem">${esc(u.banReason)}</span>` : ''}`
              : `<span class="pill ok">نشط</span>`}${u.isAdmin ? ' <span class="pill muted">أدمن</span>' : ''}</td>
            <td><div class="actions">
              <button class="btn btn-sm" onclick="App.viewUser(${u.id})">👁 تفاصيل</button>
              <button class="btn btn-sm btn-primary" onclick="App.addBalance(${u.id})">💰 رصيد</button>
              ${u.banned
                ? `<button class="btn btn-sm btn-success" onclick="App.setBan(${u.id}, false)">🔓 فك</button>`
                : `<button class="btn btn-sm btn-danger" onclick="App.banPrompt(${u.id})">🚫 حظر</button>`}
            </div></td>
          </tr>`).join('');
      }
      $('usersPageInfo').textContent = `صفحة ${data.page} من ${data.pages} — ${num(data.total)} مستخدم`;
      $('usersPrev').disabled = data.page <= 1;
      $('usersNext').disabled = data.page >= data.pages;
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  // ============ تفاصيل مستخدم ============
  async function viewUser(id) {
    openModal('جارٍ التحميل...', '<p class="muted">⏳</p>');
    try {
      const d = await api(`/admin/api/users/${id}`);
      const u = d.user;
      const txLabels = {
        deposit: '📥 إيداع', invest: '📈 استثمار', profit: '💸 ربح يومي',
        capital: '🔄 إعادة رأس مال', withdraw: '📤 سحب', refund: '↩️ إرجاع',
        referral: '🤝 مكافأة إحالة', admin_credit: '➕ إضافة إدارة', admin_debit: '➖ خصم إدارة',
      };
      const wdLabels = { pending: '⏳ معلّق', approved: '✅ موافق', paid: '💰 مدفوع', rejected: '❌ مرفوض' };

      openModal(`👤 مستخدم ${u.id}`, `
        <dl class="kv">
          <dt>الاسم</dt><dd class="rtl">${esc(u.firstName || '—')} ${u.username ? `(@${esc(u.username)})` : ''}</dd>
          <dt>الرصيد</dt><dd class="rtl"><b>${money(u.balance)}</b></dd>
          <dt>إجمالي الإيداع</dt><dd class="rtl">${money(u.totalDeposited)}</dd>
          <dt>إجمالي السحب</dt><dd class="rtl">${money(u.totalWithdrawn)}</dd>
          <dt>إجمالي الأرباح</dt><dd class="rtl">${money(u.totalProfit)}</dd>
          <dt>الحالة</dt><dd class="rtl">${u.banned ? `🚫 محظور ${u.banReason ? `— ${esc(u.banReason)}` : ''}` : '✅ نشط'}</dd>
          <dt>رمز الإحالة</dt><dd>${esc(u.referralCode || '—')}</dd>
          <dt>دعاه</dt><dd>${u.referredBy ? esc(u.referredBy) : '—'}</dd>
          <dt>عدد المدعوّنين</dt><dd class="rtl">${num(u.referralCount)}</dd>
          <dt>عقود نشطة</dt><dd class="rtl">${num(u.activeInvestments.count)} (${money(u.activeInvestments.total)})</dd>
          <dt>إيداعات مكتملة</dt><dd class="rtl">${num(u.creditedDeposits.count)}</dd>
          <dt>التسجيل</dt><dd>${date(u.createdAt)}</dd>
        </dl>

        <div class="form-row" style="margin-top:18px">
          <button class="btn btn-primary" onclick="App.addBalance(${u.id})">💰 إضافة/خصم رصيد</button>
          ${u.banned
            ? `<button class="btn btn-success" onclick="App.setBan(${u.id}, false)">🔓 رفع الحظر</button>`
            : `<button class="btn btn-danger" onclick="App.banPrompt(${u.id})">🚫 حظر</button>`}
        </div>

        <div class="sub-title">🧾 آخر العمليات</div>
        ${d.transactions.length ? `<table class="mini-table"><thead><tr>
            <th>#</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th><th>التاريخ</th></tr></thead><tbody>
            ${d.transactions.map((t) => `<tr>
              <td>${t.id}</td>
              <td>${txLabels[t.type] || t.type}</td>
              <td style="color:${t.amount >= 0 ? '#86efac' : '#fca5a5'}">${t.amount >= 0 ? '+' : ''}${money(Math.abs(t.amount))}</td>
              <td class="muted">${esc(t.note || '—')}</td>
              <td class="muted">${date(t.date)}</td></tr>`).join('')}
          </tbody></table>` : '<p class="muted">لا عمليات.</p>'}

        <div class="sub-title">📥 آخر الإيداعات</div>
        ${d.deposits.length ? `<table class="mini-table"><thead><tr>
            <th>#</th><th>رقم العملية</th><th>المبلغ</th><th>العملة</th><th>الحالة</th></tr></thead><tbody>
            ${d.deposits.map((x) => `<tr>
              <td>${x.id}</td><td><code>${esc(x.invoiceId)}</code></td>
              <td>${money(x.amount)}</td><td>${esc((x.currency || '').toUpperCase())}</td>
              <td>${x.credited ? '<span class="pill ok">مُضاف</span>' : `<span class="pill muted">${esc(x.status)}</span>`}</td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">لا إيداعات.</p>'}

        <div class="sub-title">📈 الاستثمارات</div>
        ${d.investments.length ? `<table class="mini-table"><thead><tr>
            <th>#</th><th>المستوى</th><th>المبلغ</th><th>اليومي</th><th>الحالة</th><th>الأيام</th></tr></thead><tbody>
            ${d.investments.map((i) => `<tr>
              <td>${i.id}</td><td>${i.level}</td><td>${money(i.amount)}</td>
              <td>${i.dailyRate}%</td>
              <td>${i.status === 'active' ? '<span class="pill ok">نشط</span>' : `<span class="pill muted">${esc(i.status)}</span>`}</td>
              <td>${i.paidDays}/${i.durationDays}</td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">لا استثمارات.</p>'}
      `);
    } catch (err) {
      openModal('خطأ', `<p class="error-box">${esc(err.message)}</p>`);
    }
  }

  // ============ إضافة/خصم رصيد ============
  function addBalance(id) {
    openModal(`💰 تعديل رصيد — مستخدم ${id}`, `
      <div class="form-row">
        <div style="flex:1;min-width:160px">
          <label>المبلغ بالدولار</label>
          <input id="balAmount" type="number" step="0.01" placeholder="50">
        </div>
        <div style="flex:2;min-width:200px">
          <label>ملاحظة (اختياري)</label>
          <input id="balNote" type="text" placeholder="مكافأة / تصحيح / ...">
        </div>
      </div>
      <p class="hint">💰 قيمة موجبة = <b>إضافة</b> · قيمة سالبة = <b>خصم</b></p>
      <div class="form-row">
        <button class="btn btn-primary" onclick="App.doAddBalance(${id})">✅ تنفيذ</button>
        <button class="btn btn-ghost" onclick="App.closeModal()">إلغاء</button>
      </div>
      <p id="balErr" class="error-box hidden"></p>
    `);
    setTimeout(() => $('balAmount').focus(), 60);
  }

  async function doAddBalance(id) {
    const amount = Number($('balAmount').value);
    const note = $('balNote').value.trim();
    if (!Number.isFinite(amount) || amount === 0) {
      const e = $('balErr');
      e.textContent = '⚠️ أدخل مبلغاً صحيحاً (غير صفر).';
      e.classList.remove('hidden');
      return;
    }
    try {
      const r = await api(`/admin/api/users/${id}/balance`, {
        method: 'POST',
        body: JSON.stringify({ amount, note }),
      });
      closeModal();
      toast(`✅ تم التعديل — الرصيد الجديد: ${money(r.newBalance)}`);
      loadUsers();
      loadStats();
    } catch (err) {
      const e = $('balErr');
      e.textContent = `❌ ${err.message}`;
      e.classList.remove('hidden');
    }
  }

  // ============ الحظر ============
  function banPrompt(id) {
    openModal(`🚫 حظر مستخدم ${id}`, `
      <div class="form-row">
        <div style="flex:1">
          <label>السبب (اختياري — يظهر للمستخدم)</label>
          <input id="banReason" type="text" placeholder="سبام / احتيال / ...">
        </div>
      </div>
      <div class="form-row">
        <button class="btn btn-danger" onclick="App.doBan(${id}, true)">🚫 تأكيد الحظر</button>
        <button class="btn btn-ghost" onclick="App.closeModal()">إلغاء</button>
      </div>
      <p class="hint">المحظور ما يقدر يستخدم البوت، ويوصله إشعار بالحظر.</p>
    `);
    setTimeout(() => $('banReason').focus(), 60);
  }

  async function doBan(id, banned, reason = '') {
    try {
      await api(`/admin/api/users/${id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ banned, reason }),
      });
      closeModal();
      toast(banned ? `✅ تم حظر ${id}` : `✅ تم رفع الحظر عن ${id}`);
      loadUsers();
      loadStats();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function setBan(id, banned) {
    doBan(id, banned, '');
  }

  // ============ السحوبات ============
  async function loadWithdrawals() {
    const status = $('wdStatusFilter').value;
    try {
      const data = await api(`/admin/api/withdrawals${status ? `?status=${status}` : ''}`);
      state.withdrawals = data.withdrawals;
      const tbody = $('wdTable').querySelector('tbody');
      const pill = { pending: 'warn', approved: 'ok', paid: 'ok', rejected: 'err' };
      const label = { pending: '⏳ معلّق', approved: '✅ موافق', paid: '💰 مدفوع', rejected: '❌ مرفوض' };

      if (!data.withdrawals.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty">لا طلبات</td></tr>';
      } else {
        tbody.innerHTML = data.withdrawals.map((w) => `
          <tr>
            <td>#${w.id}</td>
            <td><code>${esc(w.userId)}</code>${w.username ? `<br><span class="muted">@${esc(w.username)}</span>` : ''}</td>
            <td><b>${money(w.amount)}</b></td>
            <td>${esc((w.currency || '').toUpperCase())}</td>
            <td><code title="${esc(w.address)}">${esc(w.address.slice(0, 14))}…</code></td>
            <td><span class="pill ${pill[w.status] || 'muted'}">${label[w.status] || esc(w.status)}</span></td>
            <td class="muted">${date(w.createdAt)}</td>
            <td><div class="actions">
              ${w.status === 'pending' ? `
                <button class="btn btn-sm btn-success" onclick="App.wdApprove(${w.id})">✅ موافقة</button>
                <button class="btn btn-sm btn-danger" onclick="App.wdRejectPrompt(${w.id})">❌ رفض</button>` : ''}
              ${w.status === 'approved' ? `
                <button class="btn btn-sm btn-primary" onclick="App.wdMarkPaid(${w.id})">💰 تم الدفع</button>` : ''}
              <button class="btn btn-sm" onclick="App.wdDetails(${w.id})">👁</button>
            </div></td>
          </tr>`).join('');
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function wdApprove(id) {
    if (!confirm('موافقة على الطلب؟\n\nلو NOWPayments مهيّأ للسحب التلقائي راح يُنفّذ فوراً.')) return;
    try {
      const r = await api(`/admin/api/withdrawals/${id}/approve`, { method: 'POST', body: '{}' });
      toast(r.status === 'paid' ? '✅ تم الدفع تلقائياً' : '✅ تمت الموافقة — نفّذ التحويل يدوياً');
      loadWithdrawals();
      loadStats();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function wdMarkPaid(id) {
    if (!confirm('تعليم الطلب كمدفوع؟')) return;
    try {
      await api(`/admin/api/withdrawals/${id}/mark-paid`, { method: 'POST', body: '{}' });
      toast('✅ تم التعليم كمدفوع');
      loadWithdrawals();
      loadStats();
    } catch (err) { toast(err.message, 'err'); }
  }

  function wdRejectPrompt(id) {
    openModal(`❌ رفض طلب السحب #${id}`, `
      <div class="form-row">
        <div style="flex:1">
          <label>سبب الرفض (اختياري)</label>
          <input id="rejectNote" type="text" placeholder="عنوان خاطئ / ...">
        </div>
      </div>
      <p class="hint">المبلغ يُرجَع تلقائياً لمحفظة المستخدم.</p>
      <div class="form-row">
        <button class="btn btn-danger" onclick="App.doReject(${id})">❌ تأكيد الرفض</button>
        <button class="btn btn-ghost" onclick="App.closeModal()">إلغاء</button>
      </div>
    `);
    setTimeout(() => $('rejectNote').focus(), 60);
  }

  async function doReject(id) {
    const note = $('rejectNote')?.value.trim() || null;
    try {
      await api(`/admin/api/withdrawals/${id}/reject`, {
        method: 'POST', body: JSON.stringify({ note }),
      });
      closeModal();
      toast('✅ تم الرفض وإرجاع المبلغ');
      loadWithdrawals();
      loadStats();
    } catch (err) { toast(err.message, 'err'); }
  }

  function wdDetails(id) {
    const w = state.withdrawals.find((x) => x.id === id);
    if (!w) return;
    openModal(`💸 طلب السحب #${w.id}`, `
      <dl class="kv">
        <dt>المستخدم</dt><dd>${esc(w.userId)} ${w.username ? `(@${esc(w.username)})` : ''}</dd>
        <dt>المبلغ</dt><dd class="rtl"><b>${money(w.amount)}</b></dd>
        <dt>العملة</dt><dd class="rtl">${esc((w.currency || '').toUpperCase())}</dd>
        <dt>العنوان</dt><dd style="word-break:break-all">${esc(w.address)}</dd>
        <dt>الحالة</dt><dd class="rtl">${esc(w.status)}</dd>
        <dt>معرّف الدفع</dt><dd>${esc(w.payoutId || '—')}</dd>
        <dt>ملاحظة الأدمن</dt><dd class="rtl">${esc(w.adminNote || '—')}</dd>
        <dt>أُنشئ</dt><dd>${date(w.createdAt)}</dd>
        <dt>آخر تحديث</dt><dd>${date(w.updatedAt)}</dd>
      </dl>
    `);
  }

  // ============ الإيداعات ============
  async function loadDeposits() {
    const status = $('depStatusFilter').value;
    try {
      const data = await api(`/admin/api/deposits${status ? `?status=${status}` : ''}`);
      const tbody = $('depTable').querySelector('tbody');
      if (!data.deposits.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty">لا إيداعات</td></tr>';
        return;
      }
      const label = {
        waiting: '⏳ انتظار', confirming: '🔄 تأكيد', confirmed: '✅ مؤكد',
        sending: '📤 إرسال', finished: '✅ مكتمل', partially_paid: '⚠️ جزئي',
        failed: '❌ فاشل', expired: '⌛️ منتهي', refunded: '↩️ مسترد',
      };
      tbody.innerHTML = data.deposits.map((d) => `
        <tr>
          <td>#${d.id}</td>
          <td><code>${esc(d.userId)}</code>${d.username ? `<br><span class="muted">@${esc(d.username)}</span>` : ''}</td>
          <td><code>${esc(d.invoiceId)}</code></td>
          <td><b>${money(d.amount)}</b></td>
          <td>${esc((d.currency || '').toUpperCase())}</td>
          <td><span class="pill muted">${label[d.status] || esc(d.status)}</span></td>
          <td>${d.credited ? '<span class="pill ok">✅</span>' : '<span class="pill muted">—</span>'}</td>
          <td class="muted">${date(d.createdAt)}</td>
        </tr>`).join('');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  // ============ النافذة المنبثقة ============
  function openModal(title, html) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  // ============ التحديث ============
  function refreshAll() {
    loadStats();
    loadUsers();
    loadWithdrawals();
  }

  // ============ ربط الأحداث ============
  $('loginBtn').addEventListener('click', login);
  $('apiToken').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('apiUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('logoutBtn').addEventListener('click', logout);
  $('refreshBtn').addEventListener('click', refreshAll);
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  $('userSearchBtn').addEventListener('click', () => {
    state.usersQuery = $('userSearch').value.trim();
    state.usersBannedOnly = $('bannedOnly').checked;
    state.usersPage = 1;
    loadUsers();
  });
  $('userSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('userSearchBtn').click(); });
  $('bannedOnly').addEventListener('change', () => {
    state.usersBannedOnly = $('bannedOnly').checked;
    state.usersPage = 1;
    loadUsers();
  });
  $('usersPrev').addEventListener('click', () => { if (state.usersPage > 1) { state.usersPage--; loadUsers(); } });
  $('usersNext').addEventListener('click', () => { if (state.usersPage < state.usersPages) { state.usersPage++; loadUsers(); } });

  $('wdRefreshBtn').addEventListener('click', loadWithdrawals);
  $('wdStatusFilter').addEventListener('change', loadWithdrawals);
  $('depRefreshBtn').addEventListener('click', loadDeposits);
  $('depStatusFilter').addEventListener('change', loadDeposits);

  // ============ البدء ============
  if (store.url && store.token) {
    $('apiUrl').value = store.url;
    $('apiToken').value = store.token;
    api('/admin/api/stats')
      .then(enterApp)
      .catch(() => { $('loginScreen').classList.remove('hidden'); });
  }

  // نعرض الدوال للنافذة عشان تعمل أزرار onclick المولّدة
  window.App = {
    viewUser, addBalance, doAddBalance, banPrompt, doBan, setBan,
    wdApprove, wdRejectPrompt, doReject, wdMarkPaid, wdDetails, closeModal,
  };
})();
