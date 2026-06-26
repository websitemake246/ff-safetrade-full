(function(){
  const token = localStorage.getItem('ff_token');
  function api(path, body){ return fetch('/api'+path,{method:body?'POST':'GET', headers:{'Content-Type':'application/json', Authorization: 'Bearer '+token}, body: body?JSON.stringify(body||{}):undefined}).then(r=>r.json()); }
  async function init(){
    const coins = await api('/user/coins');
    set('myCoins', Number(coins.coins||0).toLocaleString());
    const listings = await api('/listings/mine/my-listings');
    const lBox = document.getElementById('listings');
    if (lBox) lBox.innerHTML = (listings||[]).map(x=>`<div class="card"><div style="font-weight:800">${x.title}</div><div class="text-sec">${x.platform} • ${x.status}</div><div>₦${Number(x.price_kobo/100).toFixed(2)}</div></div>`).join('') || '<div class="text-sec">No listings</div>';
    const deals = await api('/user/deals');
    const dBox = document.getElementById('deals');
    if (dBox) dBox.innerHTML = (deals||[]).map(d=>`<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><div><strong>${d.title||('Deal '+d.id)}</strong><br><span class="text-sec">${d.platform||''}</span></div><div><span class="badge">${d.status}</span></div></div><div>₦${Number(d.price_kobo||0).toLocaleString()}</div></div>`).join('') || '<div class="text-sec">No deals</div>';
  }
  function set(id,v){ const el=document.getElementById(id); if(el) el.textContent=v; }
  init();
})();
