// auth.js - manage account button, login/register modal and calls to backend
(function(){
  // Determine API base from meta tag if present, otherwise default to localhost
  const metaApi = document.querySelector('meta[name="api-base"]');
  const API_BASE = (metaApi && metaApi.content) ? metaApi.content.replace(/\/$/, '') : 'http://localhost:3000';

  function qs(id){ return document.getElementById(id); }

  // create modal HTML once
  function createModal(){
    if(document.getElementById('authOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'authOverlay';
    overlay.className = 'auth-overlay';
    overlay.innerHTML = `
      <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">
          <h3 id="authTitle">Compte</h3>
          <button class="auth-close" id="authClose">✕</button>
        </div>
        <div class="auth-tabs">
          <div class="auth-tab active" data-tab="login" id="tabLogin">Connexion</div>
          <div class="auth-tab" data-tab="register" id="tabRegister">Créer un compte</div>
        </div>
        <div class="auth-body">
          <form id="authForm" class="auth-form" autocomplete="off">
            <label id="label-username-form">Nom de compte <input id="auth-username" type="text" required></label>
            <label id="label-password-form">Mot de passe <input id="auth-password" type="password" required></label>
            <div class="auth-msg" id="authMsg"></div>
            <div class="auth-actions">
              <button type="submit" class="btn" id="authSubmit">Se connecter</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // attach events
    qs('authClose').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) closeModal(); });
    qs('tabLogin').addEventListener('click', ()=>switchTab('login'));
    qs('tabRegister').addEventListener('click', ()=>switchTab('register'));
    qs('authForm').addEventListener('submit', handleSubmit);
    // check username availability on blur when registering
    qs('auth-username').addEventListener('blur', checkUsernameAvailability);
  }

  function openModal(){
    createModal();
    qs('authOverlay').classList.add('open');
    qs('accountBtn').setAttribute('aria-expanded','true');
    // default to login
    switchTab('login');
    qs('auth-username').focus();
  }
  function closeModal(){
    const ov = qs('authOverlay');
    if(ov) ov.classList.remove('open');
    qs('accountBtn').setAttribute('aria-expanded','false');
  }

  function switchTab(tab){
    const loginTab = qs('tabLogin');
    const regTab = qs('tabRegister');
    const submitBtn = qs('authSubmit');
    if(tab === 'login'){
      loginTab.classList.add('active'); regTab.classList.remove('active');
      submitBtn.textContent = localize('cta-login') || 'Se connecter';
    } else {
      loginTab.classList.remove('active'); regTab.classList.add('active');
      submitBtn.textContent = localize('cta-register') || 'Créer un compte';
    }
    qs('authMsg').textContent = '';
  }

  function localize(key){
    // simple mapping to support i18n script texts if present
    try{ if(window.EcitiesI18n){
      if(key==='cta-login') return (localStorage.getItem('ecities_lang')==='en')? 'Login' : 'Se connecter';
      if(key==='cta-register') return (localStorage.getItem('ecities_lang')==='en')? 'Create account' : 'Créer un compte';
    }}catch(e){}
    return null;
  }

  async function handleSubmit(e){
    e.preventDefault();
    const mode = qs('tabRegister').classList.contains('active') ? 'register' : 'login';
    const username = qs('auth-username').value.trim();
    const password = qs('auth-password').value;
    const msgEl = qs('authMsg');
    msgEl.textContent = '';
    if(!username || !password){ msgEl.textContent = (localStorage.getItem('ecities_lang')==='en')? 'Missing fields' : 'Veuillez remplir tous les champs'; return; }

    try{
      const url = API_BASE + (mode === 'register' ? '/register' : '/login');
      const res = await fetch(url, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username,password})
      });
      const data = await res.json();
      if(!res.ok){
        // show banner for important errors
        if(res.status === 401) showBanner(data.error || 'Invalid credentials', 'error');
        if(res.status === 409) showBanner(data.error || 'Username already registered', 'error');
        msgEl.textContent = data.error || 'Erreur';
        return;
      }
      // success
      if(mode === 'register'){
        msgEl.textContent = (localStorage.getItem('ecities_lang')==='en')? 'Registered. You are logged in.' : 'Compte créé. Vous êtes connecté.';
        setUser(data.user || {username});
      } else {
        msgEl.textContent = (localStorage.getItem('ecities_lang')==='en')? 'Login successful' : 'Connexion réussie';
        setUser(data.user || {username});
      }
      updateAccountUI();
      setTimeout(()=>closeModal(),700);
    }catch(err){
      console.error('auth error',err); msgEl.textContent = (localStorage.getItem('ecities_lang')==='en')? 'Network error' : 'Erreur réseau';
      showBanner((localStorage.getItem('ecities_lang')==='en')? 'Network error' : 'Erreur réseau','error');
    }
  }

  function setUser(user){
    localStorage.setItem('ecities_user', JSON.stringify(user));
  }
  function clearUser(){ localStorage.removeItem('ecities_user'); }
  function getUser(){ try{return JSON.parse(localStorage.getItem('ecities_user'));}catch(e){return null;} }

  function updateAccountUI(){
    const btn = qs('accountBtn');
    const user = getUser();
    if(!btn) return;
    if(user && user.username){
      btn.textContent = user.username;
      btn.classList.add('logged');
      btn.title = 'Déconnexion';
    } else {
      btn.textContent = 'Compte';
      btn.classList.remove('logged');
      btn.title = 'Se connecter';
    }
  }

  // bottom banner
  function createBanner(){
    if(document.getElementById('pageBanner')) return;
    const el = document.createElement('div');
    el.id = 'pageBanner';
    el.className = 'page-banner';
    document.body.appendChild(el);
  }

  let bannerTimeout = null;
  function showBanner(message, type='error', ms=5000){
    createBanner();
    const el = document.getElementById('pageBanner');
    el.textContent = message;
    el.classList.remove('error','info');
    el.classList.add(type);
    setTimeout(()=>el.classList.add('show'),10);
    if(bannerTimeout) clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(()=>{ hideBanner(); }, ms);
  }

  function hideBanner(){
    const el = document.getElementById('pageBanner');
    if(!el) return;
    el.classList.remove('show');
    if(bannerTimeout) clearTimeout(bannerTimeout);
  }

  async function checkUsernameAvailability(){
    // only check when register tab is active
    const regActive = qs('tabRegister') && qs('tabRegister').classList.contains('active');
    if(!regActive) return; // do nothing
    const username = qs('auth-username').value.trim();
    if(!username) return;
    try{
      const res = await fetch(API_BASE + '/check-username?username=' + encodeURIComponent(username));
      if(!res.ok) return;
      const data = await res.json();
      const submit = qs('authSubmit');
      if(data.exists){
        showBanner((localStorage.getItem('ecities_lang')==='en')? 'Username already registered' : 'Ce nom de compte est déjà utilisé','error');
        if(submit) submit.disabled = true;
        qs('authMsg').textContent = (localStorage.getItem('ecities_lang')==='en')? 'Username already registered' : "Ce nom de compte est déjà utilisé";
      } else {
        if(submit) submit.disabled = false;
        hideBanner();
        qs('authMsg').textContent = '';
      }
    }catch(err){
      console.error('check username error',err);
    }
  }

  function toggleAccount(){
    const user = getUser();
    if(user){ // show styled logout confirmation dropdown
      createLogoutConfirm();
      showLogoutConfirm();
      return;
    }
    openModal();
  }

  /* --- Logout confirm dropdown --- */
  function createLogoutConfirm(){
    if(document.getElementById('logoutConfirm')) return;
    const el = document.createElement('div');
    el.id = 'logoutConfirm';
    el.className = 'logout-confirm';
    el.innerHTML = `
      <div class="lc-text">${(localStorage.getItem('ecities_lang')==='en')? 'Are you sure you want to log out?' : 'Êtes-vous sûr de vouloir vous déconnecter ?'}</div>
      <div class="lc-actions">
        <button class="btn secondary" id="logoutCancel">${(localStorage.getItem('ecities_lang')==='en')? 'Cancel' : 'Annuler'}</button>
        <button class="btn" id="logoutConfirmBtn">${(localStorage.getItem('ecities_lang')==='en')? 'Log out' : 'Se déconnecter'}</button>
      </div>
    `;
    document.body.appendChild(el);
    // attach handlers
    el.querySelector('#logoutCancel').addEventListener('click', hideLogoutConfirm);
    el.querySelector('#logoutConfirmBtn').addEventListener('click', doLogout);
    // hide when clicking outside
    document.addEventListener('click', (e)=>{
      const btn = qs('accountBtn');
      if(!btn) return;
      const conf = document.getElementById('logoutConfirm');
      if(!conf) return;
      if(conf.contains(e.target) || btn.contains(e.target)) return;
      hideLogoutConfirm();
    });
    // reposition on resize/scroll
    window.addEventListener('resize', hideLogoutConfirm);
    window.addEventListener('scroll', hideLogoutConfirm, true);
  }

  function showLogoutConfirm(){
    const btn = qs('accountBtn');
    const conf = document.getElementById('logoutConfirm');
    if(!btn || !conf) return;
    const rect = btn.getBoundingClientRect();
    // position the dropdown under the button, align right edge and nudge left a bit
    // set top first and temporarily set left so we can measure width
    conf.style.top = (window.scrollY + rect.bottom + 8) + 'px';
    conf.style.left = '0px';
    conf.classList.add('show');
    // measure and align the right edge of the dropdown with the button's right edge,
    // then nudge left to avoid being glued to the page border
    const confW = conf.offsetWidth || 220;
    let left = window.scrollX + rect.right - confW;
    // small extra left padding so it's not flush with the border
    left = left - 6;
    // clamp so it never goes off the left or right edge of viewport
    const minLeft = window.scrollX + 8; // 8px padding from left edge
    const maxLeft = window.scrollX + document.documentElement.clientWidth - confW - 8;
    if(left < minLeft) left = minLeft;
    if(left > maxLeft) left = maxLeft;
    conf.style.left = left + 'px';
  }

  function hideLogoutConfirm(){
    const conf = document.getElementById('logoutConfirm');
    if(!conf) return;
    conf.classList.remove('show');
  }

  function doLogout(){
    clearUser(); updateAccountUI();
    hideLogoutConfirm();
    showBanner((localStorage.getItem('ecities_lang')==='en')? 'Logged out' : 'Déconnecté', 'info', 3000);
  }

  // init: attach to accountBtn
  function init(){
    const btn = qs('accountBtn');
    if(!btn) return;
    btn.addEventListener('click', toggleAccount);
    // ensure modal element exists
    createModal();
    updateAccountUI();
  }

  // expose for debugging
  window.EcitiesAuth = { init, openModal, closeModal, getUser };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
