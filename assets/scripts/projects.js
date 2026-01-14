// projects.js - dynamic projects rendering and admin editor
(function(){
  const metaApi = document.querySelector('meta[name="api-base"]');
  const API_BASE = (metaApi && metaApi.content) ? metaApi.content.replace(/\/$/, '') : 'http://localhost:3000';

  function getUser(){ try{ return JSON.parse(localStorage.getItem('ecities_user')); }catch(e){ return null; } }
  function isAdmin(){ const u = getUser(); return !!(u && (u.role === 'Admin')); }
  function fmtDateISOToFR(d){ if(!d) return '—'; try{ const dt = new Date(d); const dd = String(dt.getDate()).padStart(2,'0'); const mm = String(dt.getMonth()+1).padStart(2,'0'); const yyyy = dt.getFullYear(); return `${dd}/${mm}/${yyyy}`; }catch(e){ return '—'; } }

  async function fetchProjects(){
    try{
      const res = await fetch(API_BASE + '/projects');
      if(!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.projects) ? data.projects : [];
    }catch(err){ console.error('fetchProjects error', err); return []; }
  }

  function renderCards(projects){
    const grid = document.querySelector('.projects-cards');
    if(!grid || !projects || !projects.length) return false;
    const html = projects.map(p => {
      const bg = p.image_url ? `background:url('${p.image_url}') center/cover no-repeat` : "background:#1f2836";
      const end = fmtDateISOToFR(p.end_date);
      const title = escapeHtml(p.title || p.slug);
      const slug = escapeHtml(p.slug);
      return `
        <article class="card project-card" data-project-id="${slug}">
          <div class="project-media" style="height:160px;${bg};border-radius:8px;margin-bottom:1rem"></div>
          <h3>${title}</h3>
          <p style="color:#ddd;margin:.4rem 0">Date de fin estimée : <strong>${end}</strong></p>
          <div class="progress-thumbs" style="display:flex;gap:.6rem;margin-top:.8rem">
            <img src="../../assets/pictures/logo.png" alt="avancement" style="height:48px;border-radius:6px;object-fit:cover">
          </div>
          <div style="margin-top:1rem;display:flex;flex-direction:column;align-items:flex-start;gap:.4rem">
            <div class="vote-info">
              <div class="vote-label">Nombre de votes :</div>
              <div class="vote-count" data-project-id="${slug}">${p.votes || 0}</div>
            </div>
            <button class="btn vote-btn">Voter</button>
            <button class="btn survey-btn" style="display:none;background:#00d9ff;color:#000;font-weight:700" data-project-slug="${slug}">Répondre au sondage</button>
          </div>
        </article>`;
    }).join('');
    grid.innerHTML = html;
    // signal to other scripts that new projects are rendered
    window.dispatchEvent(new CustomEvent('ecities:projects-rendered'));
    
    // Load surveys for each project
    projects.forEach(p => {
      loadSurveyForProject(p.slug);
    });
    
    return true;
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s]));
  }

  async function loadSurveyForProject(slug){
    try{
      const res = await fetch(API_BASE + '/projects/' + encodeURIComponent(slug) + '/survey');
      if(!res.ok) return;
      const survey = await res.json();
      if(!survey) return;
      // Show survey button for this project
      const card = document.querySelector(`.project-card[data-project-id="${escapeHtml(slug)}"]`);
      if(!card) return;
      const surveyBtn = card.querySelector('.survey-btn');
      if(surveyBtn){
        surveyBtn.style.display = '';
        surveyBtn.addEventListener('click', () => openSurveyModal(slug, survey));
      }
    }catch(err){ console.error('loadSurveyForProject error', err); }
  }

  function openSurveyModal(slug, survey){
    const user = getUser();
    if(!user){ 
      try{ window.EcitiesAuth && window.EcitiesAuth.openModal(); }catch(e){ alert('Veuillez vous connecter'); }
      return; 
    }

    const options = Array.isArray(survey.options) ? survey.options : JSON.parse(survey.options || '[]');
    const isClosed = survey.status !== 'open';

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);z-index:2600;padding:16px';
    modal.innerHTML = `
      <div style="background:#0b0b0b;border:1px solid rgba(255,212,0,0.08);border-radius:16px;max-width:480px;width:100%;padding:20px;box-shadow:0 18px 48px rgba(0,0,0,0.6)">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px">
          <div style="color:var(--accent);font-weight:800;font-size:1.1rem">${escapeHtml(survey.question)}</div>
          <button style="background:transparent;border:1px solid rgba(255,212,0,0.2);color:var(--accent);width:32px;height:32px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        ${isClosed ? `<div style="color:#ffaa00;font-size:0.9rem;margin-bottom:12px">Sondage terminé · Résultats affichés</div>` : ''}
        <div id="surveyOptions" style="display:flex;flex-direction:column;gap:8px">
          ${options.map((opt, i) => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid rgba(255,212,0,0.1);border-radius:8px;background:rgba(255,212,0,0.02)">
              <input type="radio" name="survey-response" value="${escapeHtml(opt)}" ${isClosed ? 'disabled' : ''} style="cursor:pointer">
              <span style="color:#e9e9e9">${escapeHtml(opt)}</span>
            </label>
          `).join('')}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn secondary" style="background:transparent;border:1px solid rgba(255,212,0,0.2);color:var(--accent);padding:0.75rem 1.5rem">Annuler</button>
          ${!isClosed ? `<button class="btn primary" style="background:var(--accent);color:#000;font-weight:800;padding:0.75rem 1.5rem">Répondre</button>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('button:nth-of-type(1)');
    closeBtn.addEventListener('click', () => modal.remove());

    modal.addEventListener('click', (e) => { if(e.target === modal) modal.remove(); });

    if(!isClosed){
      const submitBtn = modal.querySelector('.btn.primary');
      submitBtn.addEventListener('click', async () => {
        const selected = modal.querySelector('input[name="survey-response"]:checked');
        if(!selected){ alert('Veuillez choisir une option'); return; }
        try{
          const res = await fetch(API_BASE + '/survey/' + survey.id + '/response', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ userId: user.id, response: selected.value })
          });
          if(!res.ok){ alert('Erreur envoi'); return; }
          alert('Votre réponse a été enregistrée');
          modal.remove();
        }catch(err){ console.error('survey response error', err); alert('Erreur'); }
      });
    }
  }

  function buildAdminPanel(projects){
    if(!isAdmin()) return;
    const section = document.querySelector('section.container.section');
    if(!section) return;
    let panel = document.getElementById('projectsAdminPanel');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'projectsAdminPanel';
      panel.className = 'boxed';
      panel.style.marginBottom = '1rem';
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem">
          <h3>Administration des projets</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <button id="projRefresh" class="btn secondary">Rafraîchir</button>
          </div>
        </div>
        <div id="projAdminMsg" class="auth-msg" style="margin:.5rem 0 1rem 0"></div>
        <form id="projNewForm" class="auth-form" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem;align-items:end">
          <label>Slug <input id="pnew-slug" required placeholder="ex: place-centrale"></label>
          <label>Titre <input id="pnew-title" required></label>
          <label>Fin (YYYY-MM-DD) <input id="pnew-end" placeholder="2026-03-15"></label>
          <label>Image URL <input id="pnew-img" placeholder="https://..."></label>
          <div style="grid-column: span 4;display:flex;gap:.5rem;justify-content:flex-end">
            <button type="submit" class="btn">Ajouter</button>
          </div>
        </form>
        <div id="projList" style="margin-top:1rem"></div>
      `;
      section.insertBefore(panel, section.querySelector('.projects-cards'));
    }
    const list = panel.querySelector('#projList');
    list.innerHTML = (projects || []).map(p => `
      <div class="card" data-slug="${escapeHtml(p.slug)}" style="padding:.8rem;margin:.4rem 0;display:grid;grid-template-columns:2fr 3fr 2fr 2fr auto;gap:.6rem;align-items:center">
        <div><strong>${escapeHtml(p.slug)}</strong></div>
        <div>${escapeHtml(p.title||'')}</div>
        <div>${fmtDateISOToFR(p.end_date)}</div>
        <div>${p.is_active? 'Actif':'Inactif'}</div>
        <div style="display:flex;gap:.4rem;justify-content:flex-end">
          <button class="btn secondary" data-action="edit">Modifier</button>
          <button class="btn secondary" data-action="toggle">${p.is_active? 'Désactiver':'Activer'}</button>
          <button class="btn danger" data-action="delete">Supprimer</button>
        </div>
      </div>
    `).join('');

    // wire actions
    list.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async function(){
        const row = btn.closest('[data-slug]');
        const slug = row.getAttribute('data-slug');
        const action = btn.getAttribute('data-action');
        if(action === 'delete'){
          if(!confirm('Supprimer ce projet et ses votes associés ?')) return;
          await deleteProject(slug);
          await refresh();
        } else if(action === 'toggle'){
          const cur = row.children[3].textContent.includes('Actif');
          await updateProject(slug, { is_active: !cur });
          await refresh();
        } else if(action === 'edit'){
          openEditRow(row, slug);
        }
      });
    });

    const form = panel.querySelector('#projNewForm');
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      const slug = (panel.querySelector('#pnew-slug').value||'').trim();
      const title = (panel.querySelector('#pnew-title').value||'').trim();
      const end = (panel.querySelector('#pnew-end').value||'').trim();
      const img = (panel.querySelector('#pnew-img').value||'').trim();
      if(!slug || !title){ return showMsg('Veuillez saisir slug et titre.', 'error'); }
      if(!/^[a-z0-9-]+$/.test(slug)) return showMsg('Slug invalide. Utilisez uniquement a-z, 0-9 et -', 'error');
      const ok = await createProject({ slug, title, end_date: end || null, image_url: img || null });
      if(ok){
        form.reset();
        await refresh();
        showMsg('Projet ajouté.', 'info');
      }
    });

    panel.querySelector('#projRefresh').addEventListener('click', refresh);

    async function refresh(){
      const projects = await fetchProjects();
      buildAdminPanel(projects);
      renderCards(projects);
    }
    function showMsg(msg, type){ const el = panel.querySelector('#projAdminMsg'); if(!el) return; el.textContent = msg; el.className = 'auth-msg ' + (type||''); }
  }

  function openEditRow(row, slug){
    const cells = row.children;
    const titleCell = cells[1];
    const dateCell = cells[2];
    const actions = cells[4];
    const title = titleCell.textContent.trim();
    const dateText = dateCell.textContent.trim();
    const dateISO = toISO(dateText);
    titleCell.innerHTML = `<input value="${escapeAttr(title)}" style="width:100%">`;
    dateCell.innerHTML = `<input value="${escapeAttr(dateISO || '')}" placeholder="YYYY-MM-DD" style="width:100%">`;
    actions.innerHTML = `
      <button class="btn" data-action="save">Enregistrer</button>
      <button class="btn secondary" data-action="cancel">Annuler</button>
    `;
    actions.querySelector('[data-action="save"]').addEventListener('click', async function(){
      const newTitle = titleCell.querySelector('input').value.trim();
      const newEnd = dateCell.querySelector('input').value.trim();
      await updateProject(slug, { title: newTitle || null, end_date: newEnd ? newEnd : null });
      // trigger refresh by clicking hidden refresh (if exists)
      const r = document.getElementById('projRefresh'); if(r) r.click();
    });
    actions.querySelector('[data-action="cancel"]').addEventListener('click', function(){ const r = document.getElementById('projRefresh'); if(r) r.click(); });
  }

  function toISO(fr){
    if(!fr || fr === '—') return '';
    const m = fr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(!m) return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  function escapeAttr(s){ return String(s).replace(/"/g,'&quot;'); }

  async function createProject(p){
    try{
      const user = getUser();
      const res = await fetch(API_BASE + '/projects', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user && user.username, ...p }) });
      if(!res.ok){ alert('Erreur création projet'); return false; }
      return true;
    }catch(err){ console.error('createProject error', err); return false; }
  }
  async function updateProject(slug, p){
    try{
      const user = getUser();
      const payload = { ...p };
      if(!payload.end_date) payload.end_date = null;
      const res = await fetch(API_BASE + '/projects/' + encodeURIComponent(slug), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user && user.username, ...payload }) });
      if(!res.ok){ alert('Erreur mise à jour'); return false; }
      return true;
    }catch(err){ console.error('updateProject error', err); return false; }
  }
  async function deleteProject(slug){
    try{
      const user = getUser();
      const res = await fetch(API_BASE + '/projects/' + encodeURIComponent(slug), { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user && user.username }) });
      if(!res.ok){ alert('Erreur suppression'); return false; }
      return true;
    }catch(err){ console.error('deleteProject error', err); return false; }
  }

  document.addEventListener('DOMContentLoaded', async function(){
    const projects = await fetchProjects();
    if(projects && projects.length){ renderCards(projects); }
    buildAdminPanel(projects);
  });
})();
