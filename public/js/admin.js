(async function(){
  const token = localStorage.getItem('ff_token');
  if (!token) return (location.href='/login');
  function api(path, body){ return fetch('/api/admin'+path,{method: body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body: body?JSON.stringify(body):undefined}).then(r=>r.json()); }

  async function load(){
    const dash = await api('/dashboard');
    const users = await api('/users');

    const s = (id,v)=>document.getElementById(id); if(!s('sUsers')) return;
    s('sUsers').textContent = dash.users;
    s('sListings').textContent = dash.listings.total;
    s('sDeals').textContent = dash.deals.total;
    s('sDisputed').textContent = dash.deals.disputed;
    s('sVolume').textContent = (Number(dash.volume_kobo||0)/100).toFixed(2);
    s('sRevenue').textContent = Number(dash.revenue_naira||0).toFixed(2);

    s('rTotalUsers').textContent = dash.users;
    s('rOpenListings').textContent = dash.listings.open;
    s('rPendingPayment').textContent = dash.deals.pending_payment;
    s('rActiveDeals').textContent = dash.deals.active;
  }

  async function sendCoins(){
    const out = document.getElementById('coinResult');
    out.textContent = 'Sending...';
    const res = await api('/transfer-coins', { to_email: document.getElementById('toEmail').value, amount: Number(document.getElementById('coinAmount').value) });
    out.textContent = res.error ? 'Error: '+res.error : 'Sent. New balance: '+res.new_coins;
  }

  const btn = document.getElementById('sendCoinsBtn');
  if (btn) btn.onclick = sendCoins;
  load();
})();
