(function(){
  function ensureFooter(){
    const text = '© 2025 E-Cities — Tous droits réservés.';
    const container = document.createElement('div');
    container.className = 'container center';
    container.textContent = text;

    let footer = document.querySelector('footer.footer');
    if(!footer){
      footer = document.createElement('footer');
      footer.className = 'footer';
      footer.appendChild(container);
      // Prefer appending after <main>, else at end of body
      const main = document.querySelector('main');
      if(main && main.parentNode){ main.parentNode.appendChild(footer); }
      else { document.body.appendChild(footer); }
      return;
    }
    // If footer exists, append the line only if not already present
    const already = Array.from(footer.querySelectorAll('.container, div')).some(el => (el.textContent||'').includes('© 2025 E-Cities'));
    if(!already){ footer.appendChild(container); }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureFooter); else ensureFooter();
})();