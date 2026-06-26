(function(){
  const base = '';
  function get(path){ return fetch(base+path, {headers:{Authorization:'Bearer '+localStorage.getItem('ff_token')}}).then(r=>{if(r.status===401){location.href='/login';throw new Error('unauth');} if(!r.ok) throw new Error('http '+r.status); return r.json();}); }
  function post(path, body){ return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('ff_token')},body:JSON.stringify(body||{})}).then(r=>r.json()); }

  async function boot(){
    const hash = location.hash || '#/browse';
    if (hash.startsWith('#/browse')) await loadBrowse();
    else if (hash.startsWith('#/listings/create')) await loadCreate();
    else if (hash.startsWith('#/deals')) await loadDeals();
  }

  async function loadBrowse(){
    const res = await get('/api/listings');
    const grid = document.getElementById('listingsGrid');
    if (!grid) return;
    grid.innerHTML = res.map(x=>`<div class="card" style="padding:14px;">
      <div style="font-weight:800">${x.title}</div>
      <div class="text-muted">${x.platform} • ${x.seller_email}</div>
      <div style="font-weight:800;color:var(--success)">₦${Number(x.price_kobo/100).toFixed(2)}</div>
      <div style="font-size:12px" class="text-muted">Status: ${x.status}</div>
    </div>`).join('') || '<div class="text-muted">No listings</div>';
  }

  async function loadCreate(){
    const form = document.querySelector('form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        title: document.getElementById('listTitle').value,
        platform: document.getElementById('listPlatform').value,
        description: document.getElementById('listDescription').value,
        price_kobo: Number(document.getElementById('listPrice').value) * 100,
        evidence_urls: document.getElementById('listEvidence').value.split('\n').filter(Boolean),
        account_details: {}
      };
      const data = await post('/api/listings', body);
      alert('Listing created: ' + data.id);
      location.hash = '#/browse';
    };
  }

  async function loadDeals(){
    const data = await get('/api/user/deals');
    const box = document.getElementById('dealsList');
    if (!box) return;
    box.innerHTML = data.map(d=>`<div class="card" style="padding:14px);margin:8px 0;">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div><strong>${d.title||('Deal '+d.id)}</strong><br><span class="text-muted">${d.platform||''}</span></div>
        <div><span class="badge">${d.status}</span></div>
      </div>
      <div style="margin-top:8px;">₦${Number(d.price_kobo||0).toLocaleString()}</div>
    </div>`).join('') || '<div class="text-muted">No deals</div>';
  }

  window.addEventListener('hashchange', boot);
  boot();
})();
