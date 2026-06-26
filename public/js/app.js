(function(){
  const token = localStorage.getItem('ff_token');
  function api(path, body){
    const opts = { headers: {} };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (body) { Object.assign(opts.headers, {'Content-Type':'application/json'}); opts.method='POST'; opts.body=JSON.stringify(body||{}); }
    return fetch('/api'+path, opts).then(r=>r.json());
  }
  async function init(){
    const hash = location.hash || '#/browse';
    if (hash.startsWith('#/browse')) await loadBrowse();
    else if (hash.startsWith('#/listings/create')) await loadCreate();
    else if (hash.startsWith('#/deals')) await loadDeals();
    else if (hash.startsWith('#/coins')) await loadCoins();
  }
  async function loadBrowse(){
    const data = await api('/listings');
    const box = document.getElementById('listGrid'); if (!box) return;
    box.innerHTML = (data||[]).map(x=>`<div class="card"><div style="font-weight:800">${x.title}</div><div class="text-sec">${x.platform} • ${x.seller_email}</div><div style="color:var(--success);font-weight:800">₦${Number(x.price_kobo/100).toFixed(2)}</div><div><span class="badge">${x.status}</span></div></div>`).join('') || '<div class="text-sec">No listings</div>';
  }
  async function loadCreate(){
    const form = document.querySelector('form'); if (!form) return;
    form.onsubmit = async (e)=>{
      e.preventDefault();
      const title = document.getElementById('listTitle').value;
      const price = Number(document.getElementById('listPrice').value)*100;
      const body = { title, platform: document.getElementById('listPlatform').value, description: document.getElementById('listDescription').value, price_kobo: price, evidence_urls: (document.getElementById('listEvidence').value||'').split('\n').filter(Boolean), account_details: {demo:'true'} };
      const res = await api('/listings', body);
      alert(res.error ? res.error : 'Listing created');
      location.hash='#/browse';
    };
  }
  async function loadDeals(){
    const data = await api('/user/deals');
    const box = document.getElementById('dealList'); if (!box) return;
    box.innerHTML = (data||[]).map(d=>`<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><div><strong>${d.title||('Deal '+d.id)}</strong><br><span class="text-sec">${d.platform||''}</span></div><div><span class="badge">${d.status}</span></div></div><div>₦${Number(d.price_kobo||0).toLocaleString()}</div></div>`).join('') || '<div class="text-sec">No deals</div>';
  }
  async function loadCoins(){
    const data = await api('/user/coins');
    const el = document.getElementById('coinBalance'); if (el) el.textContent = Number(data.coins||0).toLocaleString();
  }
  window.addEventListener('hashchange', init);
  init();
})();
