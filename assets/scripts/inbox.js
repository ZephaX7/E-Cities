// inbox.js - shared inbox button + modal across pages
(function(){
  const metaApi = document.querySelector('meta[name="api-base"]');
  const API_BASE = (metaApi && metaApi.content) ? metaApi.content.replace(/\/$/, '') : 'http://localhost:3000';

  const btn = document.getElementById('inboxBtn');
  const badge = document.getElementById('inboxBadge');
  if(!btn || !badge) return;

  function getUser(){ try{return JSON.parse(localStorage.getItem('ecities_user'));}catch(e){return null;} }

  function showNotice(message, type='info'){
    let el = document.getElementById('inboxBanner');
    if(!el){
      el = document.createElement('div');
      el.id = 'inboxBanner';
      el.className = 'page-banner info';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.remove('error','info');
    el.classList.add(type === 'error' ? 'error' : 'info');
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(()=>{ el.classList.remove('show'); }, 4000);
  }

  function createModal(contentHtml){
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-card"><div class="modal-body">${contentHtml}</div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) overlay.remove(); });
    return overlay;
  }

  function escapeText(str){ return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

  async function updateBadge(){
    const user = getUser();
    if(!user || !user.username){ badge.style.display = 'none'; return; }
    try{
      const res = await fetch(API_BASE + '/inbox/count?username=' + encodeURIComponent(user.username));
      if(!res.ok) return;
      const data = await res.json();
      const count = data.unread || 0;
      if(count > 0){ badge.textContent = count; badge.style.display = 'inline-flex'; }
      else { badge.style.display = 'none'; }
    }catch(err){ console.error('inbox badge', err); }
  }

  async function openInbox(){
    const user = getUser();
    if(!user || !user.username){ showNotice('Connectez-vous pour voir vos réponses.', 'info'); return; }
    try{
      const res = await fetch(API_BASE + '/inbox?username=' + encodeURIComponent(user.username));
      if(!res.ok){ showNotice('Erreur lors du chargement de la boîte de réception.', 'error'); return; }
      const data = await res.json();
      const replies = data.replies || [];
      const items = replies.length === 0
        ? '<div style="color:#cfcfcf">Aucune réponse pour le moment.</div>'
        : replies.map(r => `
            <div class="inbox-item ${r.is_read ? '' : 'unread'}" data-id="${r.id}">
              <div class="modal-title" style="font-size:1rem;">${escapeText(r.ticket_title)}</div>
              <div class="modal-meta">${new Date(r.created_at).toLocaleString()}</div>
              <div class="inbox-msg">${escapeText(r.message)}</div>
            </div>
          `).join('');

      const modal = createModal(`
        <div class="modal-header">
          <div class="modal-title">Réponses aux tickets</div>
          <button class="btn small ghost" id="closeInbox">Fermer</button>
        </div>
        <div style="max-height:70vh;overflow:auto" id="inboxList">${items}</div>
      `);
      const closeBtn = modal.querySelector('#closeInbox');
      if(closeBtn) closeBtn.addEventListener('click', ()=>modal.remove());

      modal.querySelectorAll('.inbox-item').forEach(el => {
        el.addEventListener('click', async ()=>{
          const rid = el.getAttribute('data-id');
          try{
            const rres = await fetch(API_BASE + '/inbox/' + encodeURIComponent(rid) + '/read', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user.username }) });
            if(rres.ok){ el.classList.remove('unread'); updateBadge(); }
          }catch(err){ console.error('mark read', err); }
        });
      });
    }catch(err){ console.error('open inbox', err); showNotice('Erreur lors de l\'ouverture de la boîte.', 'error'); }
  }

  btn.addEventListener('click', openInbox);

  function onReady(){ updateBadge(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();

  window.EcitiesInbox = { updateBadge, openInbox };
})();
