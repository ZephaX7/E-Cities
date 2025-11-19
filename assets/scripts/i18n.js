// Shared i18n for index and projects pages
const I18N = (function(){
  const translations = {
    fr: {
      title: "Façonnons ensemble la ville de demain",
      lead: "E-Cities connecte les citoyens et les autorités locales pour créer des villes plus intelligentes et plus durables.",
      cta: "Participez au changement",
      'about-title': "À propos",
      'about-text': "E-Cities est une plateforme innovante qui revolutionne la participation citoyenne en facilitant le dialogue entre les habitants et les autorites locales. Grace a des outils interactifs, les citoyens peuvent proposer des idees, partager leurs avis et explorer des projets urbains en 3D. Accessible en francais et en anglais, notre site mise sur une navigation intuitive, enrichie par des animations et des icones dynamiques pour une experience immersive.",
      'impact-title': "Impact du projet",
      'impact-text': "Nous croyons en une ville plus intelligente et connectee, ou chaque citoyen peut contribuer activement aux decisions urbaines. En integrant des solutions numeriques avancees et une approche collaborative, nous permettons aux habitants de jouer un role cle dans l'amelioration de leur environnement. Notre mission : rendre la ville plus accessible, interactive et adaptee aux besoins de chacun.",
      'mission-title': "Notre Mission",
      'card1-title': "Participation Citoyenne",
      'card1-text': "Partagez vos idées et votez pour les projets qui vous tiennent à cœur",
      'card2-title': "Visualisation 3D",
      'card2-text': "Explorez les projets urbains grâce à nos modélisations 3D interactives",
      'card3-title': "Communication Directe",
      'card3-text': "Dialoguez directement avec vos élus et les services municipaux",
      'contact-title': "Contactez-nous",
      'label-name': "Nom",
      'label-email': "Email",
      'label-message': "Message",
      'submit-btn': "Envoyer",
      // projects page
      'projects-title': "Projets Citoyens",
      'projects-lead': "Découvrez les projets en cours portés par les citoyens et la municipalité. Chaque projet indique une date de fin estimée et des images d'avancement.",
      'projects-section-title': "Projets en cours",
    },
    en: {
      title: "Let's shape the city of tomorrow together",
      lead: "E-Cities connects citizens and local authorities to create smarter, more sustainable cities.",
      cta: "Join the change",
      'about-title': "About",
      'about-text': "E-Cities is an innovative platform that transforms citizen participation by facilitating dialogue between residents and local authorities. With interactive tools, citizens can propose ideas, share feedback, and explore urban projects in 3D. Available in French and English, our site emphasizes intuitive navigation enhanced by animations and dynamic icons for an immersive experience.",
      'impact-title': "Project Impact",
      'impact-text': "We believe in a smarter, more connected city where every citizen can actively contribute to urban decisions. By integrating advanced digital solutions and a collaborative approach, we empower residents to play a key role in improving their environment. Our mission: make the city more accessible, interactive and adapted to everyone's needs.",
      'mission-title': "Our Mission",
      'card1-title': "Citizen Participation",
      'card1-text': "Share your ideas and vote for the projects you care about",
      'card2-title': "3D Visualization",
      'card2-text': "Explore urban projects through our interactive 3D models",
      'card3-title': "Direct Communication",
      'card3-text': "Speak directly with your elected officials and municipal services",
      'contact-title': "Contact us",
      'label-name': "Name",
      'label-email': "Email",
      'label-message': "Message",
      'submit-btn': "Send",
      // projects page
      'projects-title': "Citizen Projects",
      'projects-lead': "Discover ongoing projects led by citizens and the municipality. Each project shows an estimated end date and progress images.",
      'projects-section-title': "Active projects",
    }
  };

  let lang = localStorage.getItem('ecities_lang') || 'fr';

  function setText(id, text){
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = text;
  }

  function apply(){
    const map = translations[lang] || translations.fr;
    document.documentElement.lang = lang;
    // common elements
    setText('title', map.title);
    setText('lead', map.lead);
    setText('cta', map.cta);
    setText('about-title', map['about-title']);
    setText('about-text', map['about-text']);
    setText('impact-title', map['impact-title']);
    setText('impact-text', map['impact-text']);
    setText('mission-title', map['mission-title']);
    setText('card1-title', map['card1-title']);
    setText('card1-text', map['card1-text']);
    setText('card2-title', map['card2-title']);
    setText('card2-text', map['card2-text']);
    setText('card3-title', map['card3-title']);
    setText('card3-text', map['card3-text']);
    setText('contact-title', map['contact-title']);
    // labels and placeholders
    const ln = document.getElementById('label-name');
    if(ln && ln.firstChild) ln.firstChild.textContent = map['label-name'] + ' ';
    const le = document.getElementById('label-email');
    if(le && le.firstChild) le.firstChild.textContent = map['label-email'] + ' ';
    const lm = document.getElementById('label-message');
    if(lm && lm.firstChild) lm.firstChild.textContent = map['label-message'] + ' ';
    const inpName = document.getElementById('input-name'); if(inpName) inpName.placeholder = (lang==='fr') ? 'Votre nom' : 'Your name';
    const inpEmail = document.getElementById('input-email'); if(inpEmail) inpEmail.placeholder = (lang==='fr') ? 'adresse@mail.com' : 'you@domain.com';
    const inpMsg = document.getElementById('input-message'); if(inpMsg) inpMsg.placeholder = (lang==='fr') ? 'Votre message' : 'Your message';
    setText('submit-btn', map['submit-btn']);

    // projects page
    setText('projects-title', map['projects-title']);
    setText('projects-lead', map['projects-lead']);
    setText('projects-section-title', map['projects-section-title']);

    // update lang button if present
    const lb = document.getElementById('langBtn');
    if(lb){ lb.textContent = lang.toUpperCase(); lb.setAttribute('aria-pressed', (lang === 'en').toString()); }
  }

  function toggle(){
    lang = (lang === 'fr') ? 'en' : 'fr';
    localStorage.setItem('ecities_lang', lang);
    apply();
  }

  function init(){
    // attach to lang button
    const lb = document.getElementById('langBtn');
    if(lb){ lb.addEventListener('click', toggle); }

    // form submit message
    const form = document.getElementById('contactForm');
    if(form){
      form.addEventListener('submit', function(e){ e.preventDefault(); alert((lang === 'fr') ? 'Merci — message simulé (formulaire non relié).' : 'Thanks — message simulated (form not connected).'); });
    }

    apply();
  }

  // auto init on DOMContentLoaded
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { apply, toggle };
})();

// expose for debugging
window.EcitiesI18n = I18N;
