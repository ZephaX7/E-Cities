// chatbot.js - floating AI conversational assistant (silent ticket creation)
(function(){
  const metaApi = document.querySelector('meta[name="api-base"]');
  const API_BASE = (metaApi && metaApi.content) ? metaApi.content.replace(/\/$/, '') : 'http://localhost:3000';

  function getUser(){ try{return JSON.parse(localStorage.getItem('ecities_user'));}catch(e){return null;} }

  let conversationHistory = [];

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
        <div class="chatbot-hint">Posez votre question, l'assistant vous aide instantanément.</div>
        <div class="chatbot-messages" id="cbMessages"></div>
      </div>
      <div class="chatbot-input">
        <input id="cbUserMsg" type="text" placeholder="Votre message..." />
        <button class="btn" id="cbSend">Envoyer</button>
      </div>
      <div class="chatbot-err" id="cbErr"></div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    const closeBtn = panel.querySelector('.chatbot-close');
    const sendBtn = panel.querySelector('#cbSend');
    const msgBox = panel.querySelector('#cbMessages');
    const errBox = panel.querySelector('#cbErr');
    const inputEl = panel.querySelector('#cbUserMsg');

    function toggle(){
      panel.classList.toggle('open');
      if(panel.classList.contains('open')){
        inputEl.focus();
        if(conversationHistory.length === 0){
          addMessage('Bonjour ! Comment puis-je vous aider aujourd\'hui ?', 'bot');
        }
      }
    }
    btn.addEventListener('click', toggle);
    closeBtn.addEventListener('click', toggle);

    function addMessage(text, from){
      const el = document.createElement('div');
      el.className = 'cb-msg ' + (from === 'bot' ? 'bot' : 'user');
      el.textContent = text;
      msgBox.appendChild(el);
      msgBox.scrollTop = msgBox.scrollHeight;
      if(from === 'user') conversationHistory.push({ role: 'user', content: text });
      else if(from === 'bot') conversationHistory.push({ role: 'assistant', content: text });
    }

    async function send(){
      const msg = inputEl.value.trim();
      errBox.textContent = '';
      if(!msg){ errBox.textContent = 'Message vide'; return; }
      inputEl.value = '';
      addMessage(msg, 'user');
      const thinking = document.createElement('div');
      thinking.className = 'cb-msg bot';
      thinking.textContent = '...';
      msgBox.appendChild(thinking);
      msgBox.scrollTop = msgBox.scrollHeight;
      try{
        const user = getUser();
        const res = await fetch(API_BASE + '/ai/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: user && user.username, message: msg, history: conversationHistory.slice(-10) }) });
        msgBox.removeChild(thinking);
        if(!res.ok){ addMessage('Erreur serveur.', 'bot'); return; }
        const data = await res.json();
        addMessage(data.reply || 'Pas de réponse.', 'bot');
      }catch(err){
        console.error('chat error', err);
        msgBox.removeChild(thinking);
        addMessage('Impossible de contacter le serveur.', 'bot');
      }
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI); else createUI();
})();
