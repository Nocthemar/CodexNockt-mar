// --- Recherche du Codex ---
(function(){
  const toggle = document.getElementById('searchToggle');
  const panel = document.getElementById('searchPanel');
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  if(!toggle || !panel || !input || !results) return;

  const PAGES = [
    {name:"Accueil", path:"index.html", tag:"Codex"},
    {name:"Pouvoirs", path:"categories/Pouvoirs.html", tag:"Catégorie"},
    {name:"Les Veines", path:"categories/Les_Veines.html", tag:"Pouvoirs"},
    {name:"Combat", path:"categories/Combat.html", tag:"Catégorie"},
    {name:"Bestiaire", path:"categories/Bestiaire.html", tag:"Catégorie"},
    {name:"Terrestres", path:"Bestiaire/Terrestres.html", tag:"Bestiaire",
      keywords:["Mange-cœur","Goule","Géant des os","Ours caveur","Élan noir","Chacal rouge","Sanglier","Géant des Collines","Slime","Lombre","Élan","Lièvre des landes","Lueurine","Renard","Blaireau","Hérisson","Écureuil","Chevreuil","Cerf","Mouton","Chèvre","Vache","Cochon","Âne","Chat","Chien","Cheval"]},
    {name:"Volants", path:"Bestiaire/Volants.html", tag:"Bestiaire",
      keywords:["Wyverne","Aigle géant","Oie","Aigle royal","Corbeau","Cigogne","Héron","Canard","Moineau","Hirondelle","Chouette","Pie","Pigeon","Poulet"]},
    {name:"Aquatiques", path:"Bestiaire/Aquatiques.html", tag:"Bestiaire",
      keywords:["Megalodon","Dos-de-vase","Grenouille cloche","Dauphin","Phoque","Poisson","Méduse","Huître","Carpe","Truite","Anguille","Écrevisse","Tortue de rivière","Loutre"]},
    {name:"Petites créatures & insectes", path:"Bestiaire/Insectes.html", tag:"Bestiaire",
      keywords:["Mouches de charogne","Abeille","Papillon","Libellule","Coccinelle","Luciole","Escargot","Araignée","Ver de terre"]},
    {name:"Personnages", path:"categories/Personnages.html", tag:"Catégorie"},
    {name:"Équipement", path:"categories/Equipement.html", tag:"Catégorie"},
    {name:"Factions", path:"categories/Factions.html", tag:"Catégorie"},
    {name:"Lore", path:"categories/Lore.html", tag:"Catégorie"},
    {name:"Cartes", path:"categories/Cartes.html", tag:"Catégorie"},
    {name:"Commerce", path:"categories/Commerce.html", tag:"Catégorie"},
    {name:"Politique", path:"categories/Politique.html", tag:"Catégorie"},
    {name:"Règles du JDR", path:"categories/Regles.html", tag:"Catégorie"},
    {name:"Duel des Couronnes", path:"jeu-cartes.html", tag:"Jeu de cartes", keywords:["Jeu de cartes","Duel"]},
    {name:"Mode Histoire", path:"histoire.html", tag:"Jeu de cartes", keywords:["Campagne","Pravorn","Boss"]},
    {name:"Sang", path:"Rang%20des%20Pouvoirs/Sang.html", tag:"Rang de Veine"},
    {name:"Trône", path:"Rang%20des%20Pouvoirs/Trone.html", tag:"Rang de Veine"},
    {name:"Regard", path:"Rang%20des%20Pouvoirs/Regard.html", tag:"Rang de Veine"},
    {name:"Rêve", path:"Rang%20des%20Pouvoirs/Reve.html", tag:"Rang de Veine"},
    {name:"Tombeau", path:"Rang%20des%20Pouvoirs/Tombeau.html", tag:"Rang de Veine"},
    {name:"Bête", path:"Rang%20des%20Pouvoirs/Bete.html", tag:"Rang de Veine"},
    {name:"Forge", path:"Rang%20des%20Pouvoirs/Forge.html", tag:"Rang de Veine"},
    {name:"Marée", path:"Rang%20des%20Pouvoirs/Maree.html", tag:"Rang de Veine"},
    {name:"Racine", path:"Rang%20des%20Pouvoirs/Racine.html", tag:"Rang de Veine"},
    {name:"Esprit", path:"Rang%20des%20Pouvoirs/Esprit.html", tag:"Rang de Veine"},
    {name:"Ombre", path:"Rang%20des%20Pouvoirs/Ombre.html", tag:"Rang de Veine"},
    {name:"Chaîne", path:"Rang%20des%20Pouvoirs/Chaine.html", tag:"Rang de Veine"},
    {name:"Maître du Jeu", path:"Personnages/Maitre_du_jeu.html", tag:"Personnage"},
    {name:"Dalek", path:"Personnages/Dalek.html", tag:"Personnage"},
    {name:"Kaéliss", path:"Personnages/Kaeliss.html", tag:"Personnage"},
    {name:"Seigneur des Marais", path:"Personnages/Seigneur_des_Marais.html", tag:"Personnage"},
    {name:"Monde", path:"Monde/Monde.html", tag:"Monde"}
  ];

  // Calcule le préfixe relatif (racine ou "../") selon la profondeur de la page courante
  const brandHref = document.querySelector('.topbar .brand')?.getAttribute('href') || 'index.html';
  const base = brandHref.replace(/index\.html$/, '');

  function norm(s){
    return s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  }

  let currentMatches = [];
  let selIndex = -1;

  function updateSel(){
    const items = results.querySelectorAll('.search-item');
    items.forEach((el, i) => el.classList.toggle('sel', i === selIndex));
    const selEl = items[selIndex];
    if(selEl) selEl.scrollIntoView({block:'nearest'});
  }

  function go(m){
    window.location.href = base + m.path;
  }

  function render(matches, query){
    currentMatches = matches;
    selIndex = matches.length ? 0 : -1;
    results.innerHTML = '';
    if(!query){
      results.innerHTML = '<div class="search-hint">Tapez le nom d’une Veine, d’un lieu, d’un personnage…</div>';
      return;
    }
    if(!matches.length){
      // textContent : le texte tapé n'est jamais interprété comme du HTML
      const vide = document.createElement('div');
      vide.className = 'search-empty';
      vide.textContent = 'Aucun résultat pour « ' + query + ' ».';
      results.appendChild(vide);
      return;
    }
    matches.forEach((m, i) => {
      const item = document.createElement('div');
      item.className = 'search-item' + (i === 0 ? ' sel' : '');
      const subtitle = m.matched ? m.tag + ' — ' + m.matched : m.tag;
      item.innerHTML = '<span class="sr-name">'+m.name+'</span><span class="sr-path">'+subtitle+'</span>';
      item.addEventListener('click', () => go(m));
      results.appendChild(item);
    });
  }

  function search(q){
    const nq = norm(q.trim());
    if(!nq){ render([], ''); return; }
    const matches = [];
    PAGES.forEach(p => {
      if(norm(p.name).includes(nq) || norm(p.tag).includes(nq)){
        matches.push(p);
        return;
      }
      const hit = (p.keywords || []).find(k => norm(k).includes(nq));
      if(hit) matches.push(Object.assign({}, p, {matched: hit}));
    });
    render(matches, q.trim());
  }

  function openPanel(){
    panel.classList.add('open');
    toggle.classList.add('active');
    render([], '');
    input.focus();
  }
  function closePanel(){
    panel.classList.remove('open');
    toggle.classList.remove('active');
    input.value = '';
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if(panel.classList.contains('open')) closePanel();
    else openPanel();
  });

  input.addEventListener('input', () => search(input.value));

  input.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){ closePanel(); return; }
    if(!currentMatches.length) return;
    if(e.key === 'ArrowDown'){
      e.preventDefault();
      selIndex = (selIndex + 1) % currentMatches.length;
      updateSel();
    } else if(e.key === 'ArrowUp'){
      e.preventDefault();
      selIndex = (selIndex - 1 + currentMatches.length) % currentMatches.length;
      updateSel();
    } else if(e.key === 'Enter'){
      e.preventDefault();
      if(selIndex >= 0) go(currentMatches[selIndex]);
    }
  });

  document.addEventListener('click', (e) => {
    if(panel.classList.contains('open') && !panel.contains(e.target) && e.target !== toggle){
      closePanel();
    }
  });
})();
