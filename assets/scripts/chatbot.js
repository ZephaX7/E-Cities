// chatbot.js - floating AI conversational assistant (silent ticket creation)
(function(){
  const metaApi = document.querySelector('meta[name="api-base"]');
  const API_BASE = (metaApi && metaApi.content) ? metaApi.content.replace(/\/$/, '') : 'http://localhost:3000';

  function getUser(){ try{return JSON.parse(localStorage.getItem('ecities_user'));}catch(e){return null;} }

  // Load conversation from localStorage
  function loadHistory(){
    try{
      const saved = localStorage.getItem('ecities_chat_history');
      return saved ? JSON.parse(saved) : [];
    }catch(e){ return []; }
  }

  function saveHistory(history){
    try{ localStorage.setItem('ecities_chat_history', JSON.stringify(history)); }catch(e){}
  }

  let conversationHistory = loadHistory();
  let currentTicketId = null;
  let pollInterval = null;

  function createUI(){
    if(document.getElementById('aiChatLauncher')) return;

    const btn = document.createElement('button');
    btn.id = 'aiChatLauncher';
    btn.className = 'chatbot-btn';
    btn.type = 'button';
    btn.title = 'Assistant E-cities';
    btn.innerHTML = '🤖<span class="chatbot-badge" id="cbBadge" style="display:none"></span>';

    const panel = document.createElement('div');
    panel.id = 'aiChatPanel';
    panel.className = 'chatbot-panel';
    panel.innerHTML = `
      <div class="chatbot-header">
        <div class="chatbot-title">Assistant E-cities</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn ghost" id="cbReset" type="button">Nouveau chat</button>
          <button class="chatbot-close" aria-label="Fermer">✕</button>
        </div>
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
    const resetBtn = panel.querySelector('#cbReset');
    const sendBtn = panel.querySelector('#cbSend');
    const msgBox = panel.querySelector('#cbMessages');
    const errBox = panel.querySelector('#cbErr');
    const inputEl = panel.querySelector('#cbUserMsg');

    // Restore previous messages
    function restoreMessages(){
      conversationHistory.forEach(h => {
        const el = document.createElement('div');
        el.className = 'cb-msg ' + (h.role === 'user' ? 'user' : 'bot');
        
        if(h.role !== 'user'){
          const label = document.createElement('div');
          label.className = 'cb-msg-label';
          label.textContent = h.sender || (h.role === 'admin' ? 'Admin' : 'IA');
          el.appendChild(label);
        }
        
        const content = document.createElement('div');
        content.textContent = h.content;
        el.appendChild(content);
        
        msgBox.appendChild(el);
      });
      msgBox.scrollTop = msgBox.scrollHeight;
    }

    function resetChat(){
      conversationHistory = [];
      saveHistory(conversationHistory);
      msgBox.innerHTML = '';
      addMessage('Bonjour ! Comment puis-je vous aider aujourd\'hui ?', 'bot');
    }

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
    resetBtn.addEventListener('click', ()=>{ resetChat(); inputEl.focus(); });

    function addMessage(text, from, sender = null){
      const el = document.createElement('div');
      el.className = 'cb-msg ' + (from === 'bot' ? 'bot' : 'user');
      
      // Add sender label for bot messages
      if(from === 'bot' || from === 'admin'){
        const label = document.createElement('div');
        label.className = 'cb-msg-label';
        label.textContent = sender || (from === 'admin' ? 'Admin' : 'IA');
        el.appendChild(label);
      }
      
      const content = document.createElement('div');
      content.textContent = text;
      el.appendChild(content);
      
      msgBox.appendChild(el);
      msgBox.scrollTop = msgBox.scrollHeight;
      
      if(from === 'user') conversationHistory.push({ role: 'user', content: text });
      else if(from === 'bot' || from === 'admin') conversationHistory.push({ role: from === 'admin' ? 'admin' : 'assistant', content: text, sender });
      saveHistory(conversationHistory);
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
        // Handle moderation bans
        if(res.status === 429){
          const data = await res.json().catch(()=>({ reply:'Accès temporairement bloqué.' }));
          errBox.textContent = data.reply || 'Accès temporairement bloqué.';
          addMessage(data.reply || 'Accès temporairement bloqué.', 'bot', 'IA');
          return;
        }

        if(!res.ok){ addMessage('Erreur serveur.', 'bot'); return; }
        const data = await res.json();
        errBox.textContent = ''; // Clear any previous warnings
        addMessage(data.reply || 'Pas de réponse.', 'bot', 'IA');
        
        // Store ticket ID and start polling for admin replies
        if(data.ticketId){
          currentTicketId = data.ticketId;
          startPolling();
        }
      }catch(err){
        console.error('chat error', err);
        msgBox.removeChild(thinking);
        addMessage('Impossible de contacter le serveur.', 'bot');
      }
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } });

    // Poll for admin replies
    let lastReplyCount = 0;
    async function checkAdminReplies(){
      if(!currentTicketId) return;
      try{
        const user = getUser();
        if(!user || !user.username) return;
        const res = await fetch(API_BASE + '/tickets/' + currentTicketId + '?username=' + encodeURIComponent(user.username));
        if(!res.ok) return;
        const data = await res.json();
        const adminReplies = (data.replies || []).filter(r => r.sender_role === 'Admin');
        
        if(adminReplies.length > lastReplyCount){
          // New admin reply(ies)
          const newReplies = adminReplies.slice(lastReplyCount);
          newReplies.forEach(reply => {
            addMessage(reply.message, 'admin', 'Admin');
          });
          lastReplyCount = adminReplies.length;
          
          // Show notification badge if panel is closed
          const panel = document.getElementById('aiChatPanel');
          const badge = document.getElementById('cbBadge');
          if(panel && !panel.classList.contains('open') && badge){
            badge.style.display = 'block';
            badge.textContent = newReplies.length;
          }
        }
      }catch(err){
        console.error('poll error', err);
      }
    }

    function startPolling(){
      if(pollInterval) return; // Already polling
      pollInterval = setInterval(checkAdminReplies, 5000); // Check every 5 seconds
    }

    function stopPolling(){
      if(pollInterval){
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }

    // Clear badge when opening panel
    btn.addEventListener('click', () => {
      const badge = document.getElementById('cbBadge');
      if(badge) badge.style.display = 'none';
    });

    // Restore messages on load
    restoreMessages();
    
    // Start polling if we have a ticket
    if(currentTicketId) startPolling();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI); else createUI();
})();
