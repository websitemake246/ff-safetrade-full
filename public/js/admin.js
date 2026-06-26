(function(){
  const token = localStorage.getItem('ff_token');
  if (!token) return (location.href='/login');
  async function api(path, body){
    const headers = { 'Content-Type': 'application/json', 'x-ff-token': token };
    const opts = { headers, method: body ? 'POST' : 'GET' };
    if (body) opts.body = JSON.stringify(body||{});
    return fetch('/api/admin'+path, opts).then(async r => { const data = await r.json().catch(()=>({})); if (!r.ok) throw new Error(data.error||data.details||('HTTP '+r.status)); return data; });
  }
  async function init(){
    let dash;
    try { dash = await api('/dashboard'); } catch (e) { document.body.innerHTML='<main class="container"><div class="card"><h1>Admin load failed</h1><pre>'+((e&&e.message)||e)+'</pre></div></main>'; return; }
    const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
    set('sUsers', dash.users);
    set('sListings', dash.listings.total);
    set('sDeals', dash.deals.total);
    set('sDisputed', dash.deals.disputed||0);
    set('sVolume', (Number(dash.volume_kobo||0)/100).toFixed(2));
    set('sRevenue', Number(dash.revenue_naira||0).toFixed(2));
    set('rTotalUsers', dash.users);
    set('rOpenListings', dash.listings.open);
    set('rPendingPayment', dash.deals.pending_payment||0);
    set('rActiveDeals', dash.deals.active||0);
  }
  async function sendCoins(){
    const out = document.getElementById('coinResult');
    if (!out) return;
    out.textContent = 'Sending...';
    try {
      const res = await api('/transfer-coins', { to_email: document.getElementById('toEmail').value, amount: Number(document.getElementById('coinAmount').value) });
      out.textContent = res.error ? 'Error: '+res.error : 'Sent. New balance: '+res.new_coins;
    } catch (e){ out.textContent = 'Error: '+(e.message||e); }
  }
  const btn = document.getElementById('sendCoinsBtn'); if (btn) btn.onclick = sendCoins;
  init();
})();
