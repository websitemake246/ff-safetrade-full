(function(){
  const token = localStorage.getItem('ff_token');
  function api(path, body){ return fetch('/api/admin'+path,{method:body?'POST':'GET', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: body?JSON.stringify(body):undefined}).then(r=>r.json()); }
  async function init(){
    const dash = await api('/dashboard');
    const users = await api('/users');
    set('sUsers', dash.users);
    set('sListings', dash.listings.total);
    set('sDeals', dash.deals.total);
    set('sDisputed', dash.deals.disputed);
    set('sVolume', (Number(dash.volume_kobo||0)/100).toFixed(2));
    set('sRevenue', Number(dash.revenue_naira||0).toFixed(2));
    set('rTotalUsers', dash.users);
    set('rOpenListings', dash.listings.open);
    set('rPendingPayment', dash.deals.pending_payment);
    set('rActiveDeals', dash.deals.active);
  }
  function set(id,v){ const el=document.getElementById(id); if (el) el.textContent=v; }
  async function sendCoins(){
    const out = document.getElementById('coinResult');
    out.textContent = 'Sending...';
    const res = await api('/transfer-coins', { to_email: document.getElementById('toEmail').value, amount: Number(document.getElementById('coinAmount').value) });
    out.textContent = res.error ? 'Error: '+res.error : 'Sent. New balance: '+res.new_coins;
  }
  const btn = document.getElementById('sendCoinsBtn'); if (btn) btn.onclick = sendCoins;
  init();
})();
