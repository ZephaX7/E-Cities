// chatbot.js - floating AI triage assistant
(function(){
  const metaApi = document.querySelector('meta[name="api-base"]');
  const API_BASE = (metaApi && metaApi.content) ? metaApi.content.replace(/\/$/, '') : 'http://localhost:3000';

  function getUser(){ try{return JSON.parse(localStorage.getItem('ecities_user'));}catch(e){return null;} }

  function createUI(){
    if(document.getElementById('aiChatLauncher')) return;

    const btn = document.createElement('button');
    btn.id = 'aiChatLauncher';
    btn.className = 'chatbot-btn';
    btn.type = 'button';
    btn.title = 'Assistant E-cities';
    btn.innerHTML = '🤖';

    const panel = document.createElement('div');
    panel.id = 'aiChatPanel';
    panel.className = 'chatbot-panel';
    panel.innerHTML = `
      <div class="chatbot-header">
        <div class="chatbot-title">Assistant E-cities</div>
        <button class="chatbot-close" aria-label="Fermer">✕</button>
      </div>
      <div class="chatbot-body">
        <div class="chatbot-hint">Expliquez votre problème, l'IA pré-classe le ticket.</div>
        <div class="chatbot-messages" id="cbMessages"></div>
      </div>
      <div class="chatbot-input">
        <input id="cbTitle" type="text" placeholder="Titre du ticket" />
        <textarea id="cbContent" rows="3" placeholder="Décrivez le problème"></textarea>
        <button class="btn" id="cbSend">Demander un tri</button>
        <div class="chatbot-err" id="cbErr"></div>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    const closeBtn = panel.querySelector('.chatbot-close');
    const sendBtn = panel.querySelector('#cbSend');
    const msgBox = panel.querySelector('#cbMessages');
    const errBox = panel.querySelector('#cbErr');
    const titleInput = panel.querySelector('#cbTitle');
    const contentInput = panel.querySelector('#cbContent');

    function toggle(){ panel.classList.toggle('open'); if(panel.classList.contains('open')) titleInput.focus(); }
    btn.addEventListener('click', toggle);
    closeBtn.addEventListener('click', toggle);

    function addMessage(text, from){
      const el = document.createElement('div');
      el.className = 'cb-msg ' + (from === 'bot' ? 'bot' : 'user');
      el.textContent = text;
      msgBox.appendChild(el);
      msgBox.scrollTop = msgBox.scrollHeight;
    }

    async function send(){
      const title = titleInput.value.trim();
      const content = contentInput.value.trim();
      errBox.textContent = '';
      if(!title || !content){ errBox.textContent = 'Merci de compléter un titre et un message.'; return; }
      addMessage(title + ' — ' + content, 'user');
      addMessage('Analyse en cours...', 'bot');
      try{
        const user = getUser();
        const res = await fetch(API_BASE + '/ai/triage', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user && user.username, title, content }) });
        const data = await res.json();
        msgBox.removeChild(msgBox.lastChild); // remove "Analyse en cours..."
        if(!res.ok || !data.triage){
          addMessage('Impossible de trier pour le moment.', 'bot');
          return;
        }
        const t = data.triage;
        const next = Array.isArray(t.next_actions) ? '\n- ' + t.next_actions.join('\n- ') : '';
        const msg = `Catégorie: ${t.category || 'N/A'}\nPriorité: ${t.priority || 'N/A'}\nRésumé: ${t.summary || ''}${next ? '\nActions:' + next : ''}`;
        addMessage(msg, 'bot');
      }catch(err){
        console.error('ai triage', err);
        msgBox.removeChild(msgBox.lastChild);
        addMessage('Erreur lors de la requête IA.', 'bot');
      }
    }

    sendBtn.addEventListener('click', send);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI); else createUI();
})();
