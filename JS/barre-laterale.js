// =====================================================================
//  ESSAI — Barre de navigation latérale (toutes les pages)
//  La barre du haut ne garde que le titre, « Codex de l'univers JDR » et la
//  page en cours ; le reste (accueil, codex, recherche, boutique, retour,
//  compte Discord) passe dans une barre verticale à gauche.
//  Pour annuler l'essai : supprimer ce fichier, CSS/barre-laterale.css,
//  et la ligne <script src=".../JS/barre-laterale.js"> de chaque page.
//
//  À charger APRÈS search.js et AVANT auth.js : les éléments existants
//  (recherche, zone #discord-auth) sont déplacés, pas recréés, donc
//  leurs scripts continuent de fonctionner.
// =====================================================================
(function(){
  const topbar = document.querySelector('.topbar');
  if(!topbar) return;

  const script = document.currentScript;
  const racine = new URL('../', script.src);
  const lien = (chemin) => new URL(chemin, racine).href;

  // Feuille de style de l'essai ; la barre reste invisible tant qu'elle n'est pas chargée
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('../CSS/barre-laterale.css', script.src).href;
  document.head.appendChild(css);

  const ICONES = {
    accueil: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
    codex:   '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    boutique:'<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    cartes:  '<rect x="9.5" y="4" width="10.5" height="15.5" rx="1.2"/><path d="M9.5 7.2L4.6 8.9a1 1 0 0 0-.6 1.3l3.8 10.4a1 1 0 0 0 1.3.6l3.4-1.2"/><path d="M14.75 8.6l2.1 3.15-2.1 3.15-2.1-3.15z"/>',
    retour:  '<path d="M15 5l-7 7 7 7"/>',
  };
  const icone = (nom) => `<span class="rail-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom]}</svg></span>`;

  const page = location.pathname.replace(/\/$/, '/index.html');
  const surAccueil = new URL('index.html', racine).pathname === page;
  const surBoutique = new URL('boutique.html', racine).pathname === page;
  const surJeu = new URL('jeu-cartes.html', racine).pathname === page;

  function item(nom, libelle, href, actif){
    const a = document.createElement('a');
    a.className = 'rail-item' + (actif ? ' is-active' : '');
    a.href = href;
    a.innerHTML = icone(nom) + '<span class="rail-label"></span>';
    a.querySelector('.rail-label').textContent = libelle;
    a.setAttribute('aria-label', libelle);
    if(actif) a.setAttribute('aria-current', 'page');
    return a;
  }

  const rail = document.createElement('nav');
  rail.className = 'rail';
  rail.setAttribute('aria-label', 'Navigation');
  rail.style.visibility = 'hidden';
  css.addEventListener('load', () => { rail.style.visibility = ''; });
  css.addEventListener('error', () => { rail.style.visibility = ''; });

  rail.append(
    item('accueil', 'Accueil', lien('index.html'), surAccueil),
    item('codex', 'Le Codex', lien('index.html#categories'), false),
  );

  // Recherche : on déplace le composant existant et on ajoute un libellé au bouton
  const recherche = topbar.querySelector('.search-wrap');
  if(recherche){
    const bouton = recherche.querySelector('.nav-search');
    bouton.classList.add('rail-item');
    const svg = bouton.querySelector('svg');
    const ico = document.createElement('span');
    ico.className = 'rail-ico';
    svg.replaceWith(ico);
    ico.appendChild(svg);
    bouton.insertAdjacentHTML('beforeend', '<span class="rail-label">Rechercher</span>');
    rail.appendChild(recherche);
  }

  rail.appendChild(item('boutique', 'Boutique', lien('boutique.html'), surBoutique));
  rail.appendChild(item('cartes', 'Duel des Veines', lien('jeu-cartes.html'), surJeu));

  // « ← Catégories », « ← Personnages »… devient un élément Retour
  const retour = topbar.querySelector('.back');
  if(retour){
    rail.appendChild(item('retour', retour.textContent.replace(/^\s*←\s*/, '').trim() || 'Retour', retour.href, false));
    retour.remove();
  }

  const sep = document.createElement('span');
  sep.className = 'rail-sep';
  rail.appendChild(sep);

  // Compte Discord : la zone est déplacée telle quelle (JS/auth.js la remplit ensuite)
  const compte = document.getElementById('discord-auth');
  if(compte) rail.appendChild(compte);

  topbar.querySelector('.nav-links')?.remove();
  topbar.querySelector('.nav-boutique')?.remove();

  // Pages sans fil d'Ariane (accueil, boutique, profil…) : on affiche le nom de la page
  if(!topbar.querySelector('.crumb')){
    const nom = surAccueil ? 'Accueil' : document.title.split(' — ')[0];
    const crumb = document.createElement('span');
    crumb.className = 'crumb';
    crumb.innerHTML = '/ <span class="cur"></span>';
    crumb.querySelector('.cur').textContent = nom;
    (topbar.querySelector('.brand-sub') ?? topbar.querySelector('.brand')).after(crumb);
  }

  document.body.classList.add('has-rail');
  document.body.appendChild(rail);
})();
