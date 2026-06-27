(function() {
  // State
  let token = localStorage.getItem('ff_token');
  let user = null;
  let currentSection = 'browse';

  // DOM Elements
  const sections = {
    hero: document.getElementById('heroSection'),
    stats: document.getElementById('statsSection'),
    auth: document.getElementById('authSection'),
    sell: document.getElementById('sellSection'),
    browse: document.getElementById('browseSection'),
    myListings: document.getElementById('myListingsSection'),
    deals: document.getElementById('dealsSection'),
    profile: document.getElementById('profileSection')
  };

  const navActions = document.getElementById('navActions');
  const listGrid = document.getElementById('listGrid');
  const myListGrid = document.getElementById('myListGrid');
  const dealList = document.getElementById('dealList');
  const authForm = document.getElementById('authForm');
  const createForm = document.getElementById('createForm');
  const profileForm = document.getElementById('profileForm');
  const authTitle = document.getElementById('authTitle');
  const authSwitchText = document.getElementById('authSwitchText');
  const authSwitchLink = document.getElementById('authSwitchLink');
  const authEmailGroup = document.getElementById('authEmailGroup');
  const authPhoneGroup = document.getElementById('authPhoneGroup');
  const authNameGroup = document.getElementById('authNameGroup');

  // Modal elements
  const dealModal = document.getElementById('dealModal');
  const dealModalBody = document.getElementById('dealModalBody');
  const dealModalFooter = document.getElementById('dealModalFooter');
  const closeDealModal = document.getElementById('closeDealModal');
  const credModal = document.getElementById('credModal');
  const credModalBody = document.getElementById('credModalBody');
  const credModalFooter = document.getElementById('credModalFooter');
  const closeCredModal = document.getElementById('closeCredModal');
  const disputeModal = document.getElementById('disputeModal');
  const disputeModalBody = document.getElementById('disputeModalBody');
  const disputeModalFooter = document.getElementById('disputeModalFooter');
  const closeDisputeModal = document.getElementById('closeDisputeModal');

  // API helpers
  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['x-ff-token'] = token;
    return h;
  }

  async function api(path, options = {}) {
    const opts = { headers: headers(), ...options };
    if (opts.body && typeof opts.body === 'object') opts.body = JSON.stringify(opts.body);
    const res = await fetch('/api' + path, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || data.details || ('HTTP ' + res.status));
    return data;
  }

  // Toast notifications
  function toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    let borderColor = 'var(--accent)';
    if (type === 'error') borderColor = 'var(--error)';
    else if (type === 'success') borderColor = 'var(--success)';
    el.style.cssText = `
      background: linear-gradient(135deg, rgba(20,24,55,0.98), rgba(12,15,38,0.95));
      border: 1px solid ` + borderColor + `;
      border-radius: 10px;
      padding: 12px 16px;
      color: var(--text);
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      animation: slideIn 0.3s ease;
      max-width: 320px;
    `;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { el.style.animation = 'slideOut 0.3s ease'; setTimeout(() => el.remove(), 300); }, 4000);
  }

  // Auth state
  function isLoggedIn() { return !!token; }

  function updateAuthUI() {
    if (isLoggedIn()) {
      navActions.innerHTML = `
        <a href="#/sell" class="btn btn-ghost btn-sm">+ Sell</a>
        <a href="#/profile" class="btn btn-primary btn-sm">Profile</a>
        <button id="logoutBtn" class="btn btn-ghost btn-sm">Logout</button>
      `;
      document.getElementById('logoutBtn').onclick = logout;
    } else {
      navActions.innerHTML = `
        <a href="#/login" class="btn btn-ghost btn-sm">Login</a>
        <a href="#/register" class="btn btn-primary btn-sm">Register</a>
      `;
    }
  }

  async function logout() {
    token = null;
    user = null;
    localStorage.removeItem('ff_token');
    updateAuthUI();
    showSection('browse');
    toast('Logged out');
  }

  async function loadMe() {
    try {
      const data = await api('/auth/me');
      user = data.user;
      updateAuthUI();
      loadStats();
    } catch (e) {
      token = null;
      localStorage.removeItem('ff_token');
      updateAuthUI();
    }
  }

  // Section management
  function showSection(name) {
    Object.values(sections).forEach(s => { if (s) s.style.display = 'none'; });
    currentSection = name;
    
    const protectedPaths = ['sell', 'deals', 'profile', 'myListings'];
    
    if (protectedPaths.includes(name) && !isLoggedIn()) {
      location.hash = '#/login';
      return;
    }

    if (sections[name]) sections[name].style.display = 'block';
    if (sections.hero) sections.hero.style.display = name === 'browse' ? 'block' : 'none';
    if (sections.stats) sections.stats.style.display = isLoggedIn() ? 'block' : 'none';

    // Load section data
    if (name === 'browse') loadBrowse();
    else if (name === 'sell') {}
    else if (name === 'myListings') loadMyListings();
    else if (name === 'deals') loadDeals();
    else if (name === 'profile') loadProfile();

    // Update tabs
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tabMap = { browse: 'browse', sell: 'sell', myListings: 'browse', deals: 'deals', profile: 'profile' };
    const activeTab = document.querySelector('.tab[data-tab="' + tabMap[name] + '"]');
    if (activeTab) activeTab.classList.add('active');
  }

  // Auth forms
  function showAuth(mode) {
    if (authTitle) authTitle.textContent = mode === 'register' ? 'Register' : 'Login';
    if (authEmailGroup) authEmailGroup.style.display = mode === 'register' ? 'block' : 'none';
    if (authPhoneGroup) authPhoneGroup.style.display = mode === 'register' ? 'block' : 'none';
    if (authNameGroup) authNameGroup.style.display = mode === 'register' ? 'block' : 'none';
    if (authSwitchText) authSwitchText.textContent = mode === 'register' ? 'Have an account?' : 'No account?';
    if (authSwitchLink) authSwitchLink.textContent = mode === 'register' ? 'Login' : 'Register';
    if (authSwitchLink) authSwitchLink.href = mode === 'register' ? '#/login' : '#/register';
  }

  authForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('authUsername').value;
    const password = document.getElementById('authPassword').value;
    const email = document.getElementById('authEmail').value;
    const phone = document.getElementById('authPhone').value;
    const full_name = document.getElementById('authName').value || username;
    
    const isRegister = authTitle.textContent === 'Register';
    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const body = isRegister ? { username, email, phone, password, full_name } : { username, password };
      const res = await api(endpoint, { method: 'POST', body });
      token = res.token;
      user = res.user;
      localStorage.setItem('ff_token', token);
      updateAuthUI();
      showSection('browse');
      toast(isRegister ? 'Registered successfully!' : 'Logged in!');
    } catch (err) {
      toast(err.message || 'Auth failed', 'error');
    }
  };

  // Browse listings
  async function loadBrowse() {
    try {
      const data = await api('/listings');
      if (listGrid) {
        listGrid.innerHTML = (data || []).map(l => `
          <div class="listing-card">
            <div class="listing-title">${escapeHtml(l.title)}</div>
            <div class="listing-meta">
              <span>${escapeHtml(l.platform)}</span>
              <span>${escapeHtml(l.seller_name || 'Unknown')}</span>
              ${l.seller_verification_status === 'verified' ? '<span style="color:var(--success);">Verified</span>' : ''}
            </div>
            <div class="listing-price">N${(l.price_kobo / 100).toLocaleString()}</div>
            <div class="deal-actions" style="margin-top: 12px;">
              <button class="btn btn-primary btn-sm" onclick="viewListing(' + l.id + ')">View</button>
              ' + (isLoggedIn() ? '<button class="btn btn-ghost btn-sm" onclick="startDeal(' + l.id + ')">Buy Now</button>' : '') + '
            </div>
          </div>
        `).join('') || '<div class="text-sec" style="text-align:center;padding:40px;">No listings available</div>';
      }
    } catch (e) {
      if (listGrid) listGrid.textContent = e.message || 'Error loading listings';
    }
  }

  // My listings
  async function loadMyListings() {
    if (!isLoggedIn()) return;
    try {
      const data = await api('/listings/mine');
      if (myListGrid) {
        myListGrid.innerHTML = (data || []).map(l => `
          <div class="listing-card">
            <div class="listing-title">${escapeHtml(l.title)}</div>
            <div class="listing-meta">
              <span>${escapeHtml(l.platform)}</span>
              <span class="badge status-' + l.status + '">' + l.status + '</span>
              <span>Views: ' + (l.view_count || 0) + '</span>
            </div>
            <div class="listing-price">N' + (l.price_kobo / 100).toLocaleString() + '</div>
            <div class="deal-actions" style="margin-top: 12px;">
              <button class="btn btn-ghost btn-sm" onclick="editListing(' + l.id + ')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteListing(' + l.id + ')">Delete</button>
            </div>
          </div>
        `).join('') || '<div class="text-sec" style="text-align:center;padding:40px;">No listings yet</div>';
      }
    } catch (e) {
      if (myListGrid) myListGrid.textContent = e.message || 'Error';
    }
  }

  // Create listing
  createForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        title: document.getElementById('listTitle').value,
        platform: document.getElementById('listPlatform').value,
        description: document.getElementById('listDescription').value,
        price_kobo: Number(document.getElementById('listPrice').value) * 100,
        evidence_urls: (document.getElementById('listEvidence').value || '').split('\\n').filter(Boolean)
      };
      await api('/listings', { method: 'POST', body });
      toast('Listing created!');
      createForm.reset();
      showSection('myListings');
    } catch (err) {
      toast(err.message || 'Failed to create listing', 'error');
    }
  };

  // Deals
  async function loadDeals() {
    if (!isLoggedIn()) return;
    try {
      const data = await api('/deals/my');
      if (dealList) {
        dealList.innerHTML = (data || []).map(d => `
          <div class="deal-card">
            <div class="deal-header">
              <div class="deal-title">${escapeHtml(d.title || 'Deal #' + d.id.slice(0,8))}</div>
              <span class="badge status-' + d.status + '">' + d.status.replace(/_/g, ' ') + '</span>
            </div>
            <div class="deal-body">
              <div><strong>Platform:</strong> ${escapeHtml(d.platform)}</div>
              <div><strong>Amount:</strong> N' + (d.amount_kobo / 100).toLocaleString() + '</div>
              <div><strong>Fee:</strong> N' + (d.middleman_fee_kobo / 100).toLocaleString() + '</div>
              <div><strong>Total:</strong> N' + ((d.amount_kobo + d.middleman_fee_kobo) / 100).toLocaleString() + '</div>
            </div>
            <div class="deal-actions">
              ' + dealActionButtons(d) + '
            </div>
          </div>
        `).join('') || '<div class="text-sec" style="text-align:center;padding:40px;">No deals yet</div>';
      }
    } catch (e) {
      if (dealList) dealList.textContent = e.message || 'Error loading deals';
    }
  }

  function dealActionButtons(deal) {
    const isBuyer = user && deal.buyer_id === user.id;
    const isSeller = user && deal.seller_id === user.id;
    
    if (deal.status === 'pending_payment' && isBuyer) {
      return '<button class="btn btn-primary btn-sm" onclick="payDeal(\'' + deal.id + '\')">Pay Now</button>';
    }
    if (deal.status === 'payment_confirmed' && isSeller) {
      return '<button class="btn btn-primary btn-sm" onclick="uploadCredentials(\'' + deal.id + '\')">Upload Credentials</button>';
    }
    if (deal.status === 'verified' && isBuyer) {
      return '<button class="btn btn-primary btn-sm" onclick="viewCredentials(\'' + deal.id + '\')">View Credentials</button>' +
             '<button class="btn btn-primary btn-sm" onclick="confirmDeal(\'' + deal.id + '\')">Confirm & Complete</button>' +
             '<button class="btn btn-danger btn-sm" onclick="openDispute(\'' + deal.id + '\')">Dispute</button>';
    }
    if (deal.status === 'completed') {
      return '<span class="text-sec">Completed</span>';
    }
    if (deal.status === 'disputed') {
      return '<button class="btn btn-ghost btn-sm" onclick="viewDispute(\'' + deal.id + '\')">View Dispute</button>';
    }
    return '<span class="text-sec">Waiting for ' + (isBuyer ? 'seller' : 'buyer') + '...</span>';
  }

  // Deal actions
  window.startDeal = async function(listingId) {
    try {
      const res = await api('/deals', { method: 'POST', body: { listing_id: listingId } });
      toast('Deal created! Complete payment.');
      showSection('deals');
    } catch (err) { toast(err.message || 'Failed', 'error'); }
  };

  window.payDeal = async function(dealId) {
    const ref = prompt('Enter Paystack reference (or leave blank for manual):');
    try {
      await api('/deals/' + dealId + '/pay', { method: 'POST', body: { paystack_ref: ref || '' } });
      toast('Payment confirmed!');
      loadDeals();
    } catch (err) { toast(err.message || 'Payment failed', 'error'); }
  };

  window.uploadCredentials = function(dealId) {
    openCredModal(dealId, true);
  };

  window.viewCredentials = function(dealId) {
    openCredModal(dealId, false);
  };

  async function openCredModal(dealId, isSeller) {
    try {
      const data = await api('/deals/' + dealId + '/credentials');
      const creds = data.credentials || {};
      
      credModalBody.innerHTML = '<div class="credential-box">' +
        '<div class="credential-row"><span class="credential-label">Free Fire Email/Phone</span><span class="credential-value">' + escapeHtml(creds.ff_email || 'Not provided') + '</span></div>' +
        '<div class="credential-row"><span class="credential-label">Free Fire Password</span><span class="credential-value">' + escapeHtml(creds.ff_password || 'Not provided') + '</span></div>' +
        '<div class="credential-row"><span class="credential-label">Free Fire UID</span><span class="credential-value">' + escapeHtml(creds.ff_uid || 'Not provided') + '</span></div>' +
        '<div class="credential-row"><span class="credential-label">Seller Notes</span><span class="credential-value">' + escapeHtml(creds.notes || 'None') + '</span></div>' +
        '</div>';
      
      if (isSeller) {
        credModalFooter.innerHTML = '<button class="btn btn-ghost" onclick="closeCredModal.click()">Close</button>';
      } else {
        credModalFooter.innerHTML = '<button class="btn btn-danger btn-sm" onclick="openDispute(\'' + dealId + '\'); closeCredModal.click();">Raise Dispute</button>' +
          '<button class="btn btn-primary" onclick="confirmDeal(\'' + dealId + '\'); closeCredModal.click();">Confirm Working</button>';
      }
      credModal.style.display = 'flex';
    } catch (err) { toast(err.message || 'Failed to load credentials', 'error'); }
  }

  window.confirmDeal = async function(dealId) {
    try {
      await api('/deals/' + dealId + '/confirm', { method: 'POST' });
      toast('Deal completed! Payout initiated.');
      loadDeals();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
  };

  window.openDispute = function(dealId) {
    const reason = prompt('Describe the issue (min 10 chars):');
    if (reason && reason.length >= 10) {
      api('/deals/' + dealId + '/dispute', { method: 'POST', body: { reason } })
        .then(() => { toast('Dispute raised'); loadDeals(); })
        .catch(err => toast(err.message || 'Failed', 'error'));
    } else if (reason) {
      toast('Reason too short', 'error');
    }
  };

  // Profile
  async function loadProfile() {
    if (!isLoggedIn()) return;
    try {
      const data = await api('/user/profile');
      const u = data.user;
      document.getElementById('profileUsername').value = u.username;
      document.getElementById('profileEmail').value = u.email || '';
      document.getElementById('profilePhone').value = u.phone || '';
      document.getElementById('profileName').value = u.full_name || '';
      document.getElementById('profileBankName').value = u.bank_name || '';
      document.getElementById('profileAccountNumber').value = u.account_number || '';
      document.getElementById('profileAccountName').value = u.account_name || '';
    } catch (err) { toast(err.message || 'Failed to load profile', 'error'); }
  }

  profileForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        phone: document.getElementById('profilePhone').value,
        full_name: document.getElementById('profileName').value,
        bank_name: document.getElementById('profileBankName').value,
        account_number: document.getElementById('profileAccountNumber').value,
        account_name: document.getElementById('profileAccountName').value
      };
      await api('/user/profile', { method: 'PUT', body });
      toast('Profile updated!');
      user = { ...user, ...body };
    } catch (err) { toast(err.message || 'Failed', 'error'); }
  };

  // Stats
  async function loadStats() {
    if (!isLoggedIn() || user?.role !== 'admin') {
      if (sections.stats) sections.stats.style.display = 'none';
      return;
    }
    try {
      const data = await api('/admin/stats');
      document.getElementById('statUsers').textContent = data.totalUsers;
      document.getElementById('statDeals').textContent = data.totalDeals;
      document.getElementById('statListings').textContent = data.openListings;
      document.getElementById('statFees').textContent = (data.feesCollected / 100).toLocaleString();
      if (sections.stats) sections.stats.style.display = 'grid';
    } catch (e) {
      if (sections.stats) sections.stats.style.display = 'none';
    }
  }

  // Hash routing
  function route() {
    const hash = location.hash.slice(1) || '#/browse';
    if (hash === '#/login') { showAuth('login'); showSection('auth'); }
    else if (hash === '#/register') { showAuth('register'); showSection('auth'); }
    else if (hash === '#/browse') showSection('browse');
    else if (hash === '#/sell') showSection('sell');
    else if (hash === '#/mylistings') showSection('myListings');
    else if (hash === '#/deals') showSection('deals');
    else if (hash === '#/profile') showSection('profile');
    else showSection('browse');
  }

  // Modal handlers
  closeDealModal.onclick = function() { dealModal.style.display = 'none'; };
  closeCredModal.onclick = function() { credModal.style.display = 'none'; };
  closeDisputeModal.onclick = function() { disputeModal.style.display = 'none'; };
  [dealModal, credModal, disputeModal].forEach(function(m) {
    m.onclick = function(e) { if (e.target === m) m.style.display = 'none'; };
  });

  // Utility
  function escapeHtml(text) {
    if (!text) return '';
    const map = {"&": "&", "<": "<", ">": ">", '"': '"', "'": "'"};
    return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  // Initialize
  window.addEventListener('hashchange', route);
  window.addEventListener('load', async function() {
    if (token) await loadMe();
    route();
    updateAuthUI();
  });

  // Expose for inline handlers
  window.viewListing = function(id) { toast('View listing ' + id); };
  window.editListing = function(id) { toast('Edit listing ' + id); };
  window.deleteListing = async function(id) {
    if (confirm('Delete this listing?')) {
      try {
        await api('/listings/' + id, { method: 'DELETE' });
        toast('Deleted');
        loadMyListings();
      } catch (err) { toast(err.message || 'Failed', 'error'); }
    }
  };
  window.viewDispute = function(id) { toast('View dispute ' + id); };
})();

// Add slide animations
var style = document.createElement('style');
style.textContent = '@keyframes slideIn { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } } @keyframes slideOut { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100%); } }';
document.head.appendChild(style);