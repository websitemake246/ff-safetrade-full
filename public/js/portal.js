(function(){
  const token = localStorage.getItem('ff_token');
  if (!token) return (location.href='/login');
  function api(path, body){ return fetch('/api'+path,{method: body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body: body?JSON.stringify(body||{}):undefined}).then(r=>r.json()); }

  async function load(){
    const coins = await api('/user/coins');
    document.getElementById('myCoins').textContent = Number(coins.coins||0).toLocaleString();
    const listings = await api('/listings/mine/my-listings');
    document.getElementById('listings').innerHTML = listings.map(x=>`<div class="card" style="padding:14px);margin:8px 0;">
      <div style="font-weight:800">${x.title}</div>
      <div class="text-muted">${x.platform} • ${x.status}</div>
      <div>₦${Number(x.price_kobo/100).toFixed(2)}</div>
    </div>`).join('') || '<div class="text-muted">No listings</div>';

    const deals = await api('/user/deals');
    document.getElementById('deals').innerHTML = deals.map(d=>`<div class="card" style="padding:14px);margin:8px 0;">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div><strong>${d.title||('Deal '+d.id)}</strong><br><span class="text-muted">${d.platform||''}</span></div>
        <div><span class="badge">${d.status}</span></div>
      </div>
      <div>₦${Number(d.price_kobo||0).toLocaleString()}</div>
    </div>`).join('') || '<div class="text-muted">No deals</div>';
  }
  load();
})();
