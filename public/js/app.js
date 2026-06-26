(function(){
  const token = localStorage.getItem('ff_token');
  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['x-ff-token'] = token;
    return h;
  }
  async function api(path, body){
    const opts = { headers: headers(), method: body ? 'POST' : 'GET' };
    if (body) opts.body = JSON.stringify(body||{});
    return fetch('/api'+path, opts).then(async r => {
      const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!r.ok) throw new Error(data.error || data.details || ('HTTP '+r.status));
      return data;
    });
  }
  function authenticate() {
    const t = localStorage.getItem('ff_token');
    if (!t) { location.href='/login'; return null; }
    return t;
  }

  async function init(){
    const hash = location.hash || '#/browse';
    if (hash === '#/register') { await loadAuth('register'); return; }
    authenticate();
    if (hash.startsWith('#/browse')) await loadBrowse();
    else if (hash.startsWith('#/listings/create')) await loadCreate();
    else if (hash.startsWith('#/deals')) await loadDeals();
    else await loadBrowse();
  }

  async function loadAuth(mode){
    const title = document.getElementById('authTitle');
    const phoneInput = document.getElementById('authPhone');
    const switchText = document.getElementById('authSwitchText');
    const switchLink = document.getElementById('authSwitchLink');
    const form = document.getElementById('authForm');
    if (title) title.textContent = mode === 'register' ? 'Register' : 'Login';
    if (phoneInput) phoneInput.style.display = mode === 'register' ? '' : 'none';
    if (switchText) switchText.textContent = mode === 'register' ? 'Have an account?' : 'No account?';
    if (switchLink) switchLink.textContent = mode === 'register' ? 'Login' : 'Register';
    if (switchLink) switchLink.href = mode === 'register' ? '#/login' : '#/register';
    form.onsubmit = async (e) => {
      e.preventDefault();
      const username = document.getElementById('authUsername').value;
      const password = document.getElementById('authPassword').value;
      const phone = document.getElementById('authPhone').value || '';
      const full_name = username;
      try {
        const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
        const body = mode === 'register' ? { username, phone, password, full_name } : { username, password };
        const res = await api(endpoint, body);
        localStorage.setItem('ff_token', res.token);
        location.hash = '#/browse';
      } catch (err) { alert(err.message || err); }
    };
  }

  async function loadBrowse(){
    try {
      const data = await api('/listings');
      const box = document.getElementById('listGrid');
      if (!box) return;
      box.innerHTML = (data||[]).map(x=>`<div class="card"><div style="font-weight:800">${x.title}</div><div class="text-sec">${x.platform} • ${x.seller_email||'Unknown'}</div><div style="color:var(--success);font-weight:800">₦${Number(x.price_kobo/100).toFixed(2)}</div><div><span class="badge">${x.status}</span></div></div>`).join('') || '<div class="text-sec">No listings</div>';
    } catch (e) { const box=document.getElementById('listGrid'); if(box) box.textContent=(e&&e.message)||'error'; }
  }
  async function loadCreate(){
    const form = document.querySelector('form'); if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const body = {
          title: document.getElementById('listTitle').value,
          platform: document.getElementById('listPlatform').value,
          description: document.getElementById('listDescription').value,
          price_kobo: Number(document.getElementById('listPrice').value) * 100,
          evidence_urls: (document.getElementById('listEvidence').value||'').split('\n').filter(Boolean),
          account_details: {demo:'true'}
        };
        const res = await api('/listings', body);
        alert(res.error ? res.error : 'Listing created');
        location.hash='#/browse';
      } catch (err) { alert('Error: '+(err.message||err)); }
    };
  }
  async function loadDeals(){
    try {
      const data = await api('/user/deals');
      const box = document.getElementById('dealList');
      if (!box) return;
      box.innerHTML = (data||[]).map(d=>`<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><div><strong>${d.title||('Deal '+d.id)}</strong><br><span class="text-sec">${d.platform||''}</span></div><div><span class="badge">${d.status}</span></div></div><div>₦${Number(d.price_kobo||0).toLocaleString()}</div></div>`).join('') || '<div class="text-sec">No deals</div>';
    } catch (e) { const box=document.getElementById('dealList'); if(box) box.textContent=(e&&e.message)||'error'; }
  }
  window.addEventListener('hashchange', init); init();
})();
