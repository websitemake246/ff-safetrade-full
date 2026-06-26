(function(){
  const token = localStorage.getItem('ff_token');
  if (!token) return (location.href='/login');
  async function api(path, body){
    const headers = { 'Content-Type': 'application/json', 'x-ff-token': token };
    const opts = { headers, method: body ? 'POST' : 'GET' };
    if (body) opts.body = JSON.stringify(body||{});
    return fetch('/api'+path, opts).then(async r => { const data = await r.json().catch(()=>({})); if (!r.ok) throw new Error(data.error||data.details||('HTTP '+r.status)); return data; });
  }
  async function init(){
    const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
    try { const coins = await api('/user/coins'); set('myCoins', Number((coins&&coins.coins)||0).toLocaleString()); } catch {}
    try { const listings = await api('/listings/mine/my-listings'); const box=document.getElementById('listings'); if(box) box.innerHTML=(listings||[]).map(x=>`<div class=""><div style="font-weight:800">${x.title}</div><div class="text-sec">${x.platform||''} • ${x.status||''}</div><div>₦${Number(x.price_kobo/100).toFixed(2)}</div></div>`).join('') || '<div class="text-sec">No listings</div>'; } catch {}
    try { const deals = await api('/user/deals'); const dBox=document.getElementById('deals'); if(dBox) dBox.innerHTML=(deals||[]).map(d=>`<div class=""><div class="row" style="justify-content:space-between;"><b>${d.title||('Deal '+d.id)}</b><span class="badge">${d.status}</span></div><div>₦${Number(d.price_kobo||0).toLocaleString()}</div></div>`).join('') || '<div class="text-sec">No deals</div>'; } catch {}
  }
  init();
})();
