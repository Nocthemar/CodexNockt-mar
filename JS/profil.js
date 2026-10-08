// =====================================================================
//  Page profil
//  profil.html           -> mon profil (avec pièces, inventaire, historique)
//  profil.html?id=12345  -> profil public d'un autre joueur (ID Discord)
// =====================================================================
import { supabase, connexionDiscord, getMonJoueur, SITE_ROOT } from './supabase.js';
import { $, esc, couleur, LIBELLES, SOURCES } from './commun.js';
import { chargerDeck, Deck, activerGlisser, htmlCarte } from './cartes.js';

// Le joueur + ses cosmétiques équipés, en une seule requête
const SELECT_JOUEUR = `
  *,
  banner:items!players_banner_item_id_fkey(*),
  title:items!players_title_item_id_fkey(*),
  theme:items!players_theme_item_id_fkey(*)
`;

const COSMETIQUES = ['banner', 'title', 'theme'];


async function init() {
  const idVisite = new URLSearchParams(location.search).get('id');
  const moi = await getMonJoueur();
  const discordId = idVisite || moi?.discord_id;

  // Personne de connecté et pas de profil demandé
  if (!discordId) {
    $('chargement').hidden = true;
    $('non-connecte').hidden = false;
    $('btn-connexion').addEventListener('click', connexionDiscord);
    return;
  }

  const { data: joueur, error } = await supabase
    .from('players')
    .select(SELECT_JOUEUR)
    .eq('discord_id', discordId)
    .maybeSingle();

  if (error || !joueur) {
    $('chargement').textContent = 'Joueur introuvable.';
    return;
  }

  const estMoi = moi?.discord_id === discordId;

  afficherEntete(joueur);
  await Promise.all([afficherPerso(discordId), afficherDeck(discordId, estMoi)]);

  // Partie privée : seulement sur mon propre profil
  if (estMoi) {
    $('prive').hidden = false;
    $('bourse').hidden = false;
    await Promise.all([
      afficherSolde(discordId),
      afficherInventaire(discordId, joueur),
      afficherHistorique(discordId),
    ]);
  }

  $('chargement').hidden = true;
  $('profil').hidden = false;
}


function afficherEntete(j) {
  document.title = `${j.username ?? 'Joueur'} — Nocthémar`;
  $('pseudo').textContent = j.username ?? 'Joueur inconnu';
  $('titre').textContent = j.title?.payload?.text ?? '';

  if (j.avatar_url) $('avatar').src = j.avatar_url;
  else $('avatar').hidden = true;

  if (j.banner?.payload?.image) {
    $('banniere').style.backgroundImage = `url("${new URL(j.banner.payload.image, SITE_ROOT)}")`;
    // Proportions de l'image (payload.ratio, ex : "2172 / 724") : le cadre prend la forme de
    // l'image pour qu'elle s'affiche en entier. Fixé avant l'affichage, donc sans décalage (CLS).
    const ratio = j.banner.payload.ratio;
    if (/^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(ratio ?? '')) {
      $('banniere').parentElement.style.aspectRatio = ratio;
    }
  }
  const accent = couleur(j.theme?.payload?.accent);
  if (accent) {
    document.documentElement.style.setProperty('--accent', accent);
    // Thème à une seule couleur : accent2 reprend accent
    document.documentElement.style.setProperty('--accent2', couleur(j.theme.payload.accent2) ?? accent);
  }
}


// Le format de "data" est décidé par le bot : ces listes servent juste à
// reconnaître les clés connues pour les mettre en valeur. Tout le reste
// (clés inconnues) s'affiche quand même, dans une zone générique en bas.
const CLE_CA = 'CA';
const CLES_JAUGES = ['PV', 'XP'];
const ATTRIBUTS = [
  ['AGI', 'Agilité'], ['FOR', 'Force'], ['CON', 'Constitution'],
  ['PER', 'Perception'], ['ESP', 'Esprit'], ['CHA', 'Charisme'],
];
const CLES_IDENTITE = ['RACE', 'GENRE', 'NIVEAU', 'VEINE'];
const LIBELLES_IDENTITE = { RACE: 'Race', GENRE: 'Genre', NIVEAU: 'Niveau', VEINE: 'Veine' };

// Enlève les accents pour comparer "RÊVE" et "REVE" sans se soucier de la casse
const normaliser = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

const VIDE_RE = /^(—|-|vide|aucun[e]?|n\/a)$/i;

function analyserFraction(val) {
  const m = String(val).match(/^\s*(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const actuel = parseFloat(m[1].replace(',', '.'));
  const max = parseFloat(m[2].replace(',', '.'));
  return { actuel, max, pct: max > 0 ? Math.min(100, Math.max(0, (actuel / max) * 100)) : 0 };
}

async function afficherPerso(discordId) {
  const { data: perso } = await supabase
    .from('characters')
    .select('*')
    .eq('discord_id', discordId)
    .eq('is_active', true)
    .maybeSingle();

  const zone = $('perso');

  if (!perso) {
    zone.innerHTML = `<p class="vide">Aucun personnage actif pour l'instant. La fiche se crée sur Discord, avec le bot.</p>`;
    return;
  }

  const data = perso.data || {};
  const clesRestantes = new Set(Object.keys(data));
  const trouverCle = (nom) => {
    const cle = [...clesRestantes].find((c) => normaliser(c) === normaliser(nom));
    if (cle) clesRestantes.delete(cle);
    return cle;
  };

  // Sous-titre : Race · Genre · Niveau, seulement les infos présentes
  const sousTitre = ['RACE', 'GENRE', 'NIVEAU']
    .map((nom) => {
      const cle = [...clesRestantes].find((c) => normaliser(c) === nom) ?? Object.keys(data).find((c) => normaliser(c) === nom);
      const val = cle ? data[cle] : null;
      return val && !VIDE_RE.test(String(val)) ? (nom === 'NIVEAU' ? `Niveau ${esc(val)}` : esc(val)) : null;
    })
    .filter(Boolean)
    .join(' · ');

  // Jauges : CA en badge, PV/XP en barres si elles ont un format "x / y"
  let jaugesHtml = '';
  const cleCA = trouverCle(CLE_CA);
  if (cleCA) {
    jaugesHtml += `
      <div class="jauge jauge--badge jauge--ca">
        <span class="jauge__label">${esc(cleCA)}</span>
        <span class="jauge__valeur">${esc(data[cleCA])}</span>
      </div>`;
  }
  for (const nom of CLES_JAUGES) {
    const cle = trouverCle(nom);
    if (!cle) continue;
    const val = data[cle];
    const frac = analyserFraction(val);
    if (frac) {
      jaugesHtml += `
        <div class="jauge jauge--barre jauge--${nom.toLowerCase()}">
          <div class="jauge__tete">
            <span class="jauge__label">${esc(cle)}</span>
            <span class="jauge__valeur">${esc(val)}</span>
          </div>
          <div class="jauge__piste"><div class="jauge__remplissage" style="width:${frac.pct}%"></div></div>
        </div>`;
    } else {
      jaugesHtml += `
        <div class="jauge jauge--badge">
          <span class="jauge__label">${esc(cle)}</span>
          <span class="jauge__valeur">${esc(val)}</span>
        </div>`;
    }
  }

  // Attributs : toujours dans le même ordre, avec libellé complet en infobulle
  let attributsHtml = '';
  for (const [nom, libelle] of ATTRIBUTS) {
    const cle = trouverCle(nom);
    if (!cle) continue;
    const val = String(data[cle]);
    const signe = /^\s*-/.test(val) ? 'neg' : /^\s*\+?0+\s*$/.test(val) ? 'neutre' : 'pos';
    attributsHtml += `
      <div class="attribut attribut--${signe}" title="${esc(libelle)}">
        <span class="attribut__valeur">${esc(val)}</span>
        <span class="attribut__label">${esc(nom)}</span>
      </div>`;
  }

  // Identité : Veine (Race, Genre, Niveau sont déjà dans le sous-titre)
  let identiteHtml = '';
  for (const nom of ['VEINE']) {
    const cle = trouverCle(nom);
    if (!cle) continue;
    const val = data[cle];
    const estVide = VIDE_RE.test(String(val));
    identiteHtml += `
      <span class="chip${estVide ? ' chip--vide' : ''}">
        <span class="chip__label">${esc(LIBELLES_IDENTITE[nom])}</span>
        <span class="chip__valeur">${esc(val)}</span>
      </span>`;
  }
  // Retire aussi Race/Genre/Niveau du reliquat, même s'ils n'ont pas de chip dédiée,
  // ainsi qu'un éventuel ancien champ Héritage (l'Héritage de Sang n'existe plus dans l'univers)
  ['RACE', 'GENRE', 'NIVEAU', 'HERITAGE'].forEach(trouverCle);

  // Inventaire : sorti de la grille générique pour s'afficher à côté de la bourse
  const cleInventaire = trouverCle('INVENTAIRE');
  if (cleInventaire) afficherInventairePerso(cleInventaire, data[cleInventaire]);

  // Tout ce qui n'est pas reconnu ci-dessus : affiché tel quel, sans mise en forme spéciale.
  // Une valeur "Objet A, Objet B, Objet C" est éclatée en liste pour rester lisible.
  const autresHtml = [...clesRestantes]
    .map((cle) => {
      const val = data[cle];
      const elements = typeof val === 'string' ? val.split(',').map((v) => v.trim()).filter(Boolean) : [];
      const dd = elements.length > 1
        ? `<dd><ul class="stat__liste">${elements.map((el) => `<li>${esc(el)}</li>`).join('')}</ul></dd>`
        : `<dd>${esc(typeof val === 'object' ? JSON.stringify(val) : val)}</dd>`;
      return `
      <div class="stat">
        <dt>${esc(cle)}</dt>
        ${dd}
      </div>`;
    })
    .join('');

  zone.innerHTML = `
    <div class="perso__entete">
      <h3 class="perso__nom">${esc(perso.name)}</h3>
      ${sousTitre ? `<p class="perso__sous-titre">${sousTitre}</p>` : ''}
    </div>
    ${jaugesHtml ? `<div class="perso__jauges">${jaugesHtml}</div>` : ''}
    ${attributsHtml ? `<div class="perso__attributs">${attributsHtml}</div>` : ''}
    ${identiteHtml ? `<div class="perso__identite">${identiteHtml}</div>` : ''}
    ${autresHtml ? `<dl class="stats stats--autres">${autresHtml}</dl>` : ''}
    ${!jaugesHtml && !attributsHtml && !identiteHtml && !autresHtml ? '<p class="vide">Fiche encore vide.</p>' : ''}`;
}


// Inventaire du personnage : OBJETS_PAR_PAGE objets affichés, un bouton en bas fait défiler les suivants
const OBJETS_PAR_PAGE = 4;

// Objet affiché en image (img/Equipement/<nom>.webp, apostrophe typographique comme les fichiers),
// nom en infobulle. Si l'image n'existe pas, on retombe sur le texte.
function htmlObjetInventaire(nom, choisi) {
  const src = new URL(`img/Equipement/${nom.replace(/'/g, '’')}.webp`, SITE_ROOT);
  return `
    <li>
      <button type="button" class="objet-image${choisi ? ' objet-image--choisi' : ''}" data-objet="${esc(nom)}"
              title="${esc(nom)}" aria-pressed="${choisi}">
        <img src="${esc(src)}" alt="${esc(nom)}" loading="lazy"
             onerror="this.parentElement.classList.add('objet-image--sans');this.remove()">
        <span class="objet-image__nom">${esc(nom)}</span>
      </button>
    </li>`;
}

// Fiches des objets (type, catégorie, prix, description), lues une seule fois sur la page
// Équipement du Codex : une seule source à tenir à jour.
const cleObjet = (nom) => normaliser(nom).replace(/[’']/g, "'");
let fichesObjets;
function chargerFichesObjets() {
  fichesObjets ??= fetch(new URL('categories/Equipement.html', SITE_ROOT))
    .then((r) => (r.ok ? r.text() : ''))
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const fiches = new Map();
      for (const ligne of doc.querySelectorAll('.shop-row')) {
        const nom = ligne.querySelector('.shop-name')?.textContent.trim();
        if (!nom) continue;
        fiches.set(cleObjet(nom), {
          categorie: ligne.closest('section')?.querySelector('.subtitle')?.textContent.trim(),
          type: ligne.querySelector('.shop-tag')?.textContent.trim(),
          prix: ligne.querySelector('.shop-price')?.textContent.trim(),
          description: ligne.querySelector('.shop-desc')?.textContent.trim(),
        });
      }
      return fiches;
    })
    .catch(() => new Map());
  return fichesObjets;
}

function htmlFicheObjet(nom, fiche) {
  const carac = [
    ['Type', fiche?.type],
    ['Catégorie', fiche?.categorie],
    ['Prix', fiche?.prix],
  ].filter(([, v]) => v);
  return `
    <div class="objet-fiche">
      <strong class="objet-fiche__nom">${esc(nom)}</strong>
      ${carac.length ? `<dl class="objet-fiche__carac">${carac.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      <p class="objet-fiche__desc">${fiche?.description ? esc(fiche.description) : 'Aucune description pour cet objet.'}</p>
    </div>`;
}

function afficherInventairePerso(cle, val) {
  const objets = (Array.isArray(val) ? val.map(String) : String(val ?? '').split(','))
    .map((v) => v.trim())
    .filter((v) => v && !VIDE_RE.test(v));

  const zone = $('perso-inventaire');
  zone.hidden = false;

  if (!objets.length) {
    zone.innerHTML = `<dt>${esc(cle)}</dt><dd class="vide">Inventaire vide.</dd>`;
    return;
  }

  const nbPages = Math.ceil(objets.length / OBJETS_PAR_PAGE);
  let page = 0;
  let choisi = null;        // objet dont la fiche est ouverte (un clic l'ouvre, un 2e la ferme)
  let fiches = new Map();

  const rendre = () => {
    const debut = page * OBJETS_PAR_PAGE;
    zone.innerHTML = `
      <dt>${esc(cle)}</dt>
      <dd><ul class="stat__liste stat__liste--images">${objets.slice(debut, debut + OBJETS_PAR_PAGE).map((o) => htmlObjetInventaire(o, o === choisi)).join('')}</ul></dd>
      ${choisi ? htmlFicheObjet(choisi, fiches.get(cleObjet(choisi))) : ''}
      ${nbPages > 1 ? `
        <button type="button" class="btn-petit btn-petit--lien perso__inventaire-suite">
          ${page < nbPages - 1 ? 'Objets suivants ▾' : 'Retour au début ▴'} (${page + 1}/${nbPages})
        </button>` : ''}`;
  };

  zone.onclick = async (e) => {
    const objet = e.target.closest('[data-objet]');
    if (objet) {
      choisi = objet.dataset.objet === choisi ? null : objet.dataset.objet;
      if (choisi) fiches = await chargerFichesObjets();
      rendre();
      return;
    }
    if (!e.target.closest('.perso__inventaire-suite')) return;
    page = (page + 1) % nbPages;
    choisi = null;
    rendre();
  };
  rendre();
}


// Deck de cartes : lecture seule pour les visiteurs ; sur mon profil,
// je peux le renommer, retirer des cartes et les réorganiser en les glissant.
async function afficherDeck(discordId, estMoi) {
  const { nom, ids, cartes } = await chargerDeck(discordId);
  const deck = new Deck($('deck'), { nom, ids, cartes, editable: estMoi, lienAjout: 'collection.html' });

  if (!estMoi) return;
  $('lien-collection').hidden = false;
  afficherDuel(nom, ids.filter((id) => id != null).map((id) => cartes.get(id)));
  activerGlisser($('deck'), {
    poignee: '.deck-emplacement .carte-jeu',
    cible: '.deck-emplacement',
    deposer: (carte, cible) => deck.placer(Number(carte.dataset.carte), Number(cible.dataset.position)),
  });
}


// Encart du Duel des Veines : les 3 premières cartes du deck en éventail
// (dos de carte pour les places vides)
function afficherDuel(nomDeck, cartesDeck) {
  $('duel-deck').textContent = nomDeck;
  const main = cartesDeck.slice(0, 3);
  $('duel-eventail').innerHTML = [0, 1, 2]
    .map((i) => main[i] ? htmlCarte(main[i]) : '<div class="carte-jeu carte-jeu--sans-image"></div>')
    .join('');
  $('duel').hidden = false;
}


async function afficherSolde(discordId) {
  const { data } = await supabase
    .from('wallets')
    .select('balance')
    .eq('discord_id', discordId)
    .maybeSingle();

  const solde = data?.balance ?? 0;
  $('solde').textContent = solde.toLocaleString('fr-FR');
  afficherOrBourse(solde);
}


// Image de la bourse selon le solde : une pièce qui tourne, puis des tas de plus en plus gros.
// Paliers : [solde minimum, image, nombre d'étincelles] ; le dernier palier atteint l'emporte
// (au-delà de 1500 : tas 4). Plus on est riche, plus l'or scintille (et plus son halo brille, cf. CSS).
const PALIERS_OR = [
  [0,    null,           1],   // pièce qui tourne (animation)
  [50,   'tas-1-petit',  2],
  [200,  'tas-2-moyen',  4],
  [500,  'tas-3-grand',  7],
  [1500, 'tas-4-enorme', 12],
];
const SANS_ETINCELLES_JUSQUA = 10;   // de 0 à 10 pièces : pas d'étincelles
const imageOr = (nom) => new URL(`img/OR/pieces/${nom}.png`, SITE_ROOT).href;

// Un tour complet : face -> profil, puis les mêmes images en miroir (le revers de la pièce)
const TOUR_PIECE = [
  ['piece-face', false], ['piece-rotation-1', false], ['piece-rotation-2', false], ['piece-rotation-3', false],
  ['piece-rotation-3', true], ['piece-rotation-2', true], ['piece-rotation-1', true], ['piece-face', true],
  ['piece-rotation-1', false], ['piece-rotation-2', false], ['piece-rotation-3', false],
  ['piece-rotation-3', true], ['piece-rotation-2', true], ['piece-rotation-1', true],
];
const DUREE_IMAGE_PIECE = 280;   // ms par image
let minuteurPiece;

function afficherOrBourse(solde) {
  const img = document.querySelector('#bourse .piece-icone');
  const palier = PALIERS_OR.findLast(([min]) => solde >= min) ?? PALIERS_OR[0];   // solde négatif : pièce
  const [, tas, nbEtincelles] = palier;
  clearInterval(minuteurPiece);
  img.style.transform = '';

  // Bourse vide : une pièce couchée au sol, en noir et blanc
  const vide = solde <= 0;
  img.classList.toggle('piece-icone--vide', vide);

  // Richesse (0 = vide ... 5 = tas 4) : règle le halo doré en CSS, et les étincelles
  $('bourse').dataset.richesse = vide ? 0 : PALIERS_OR.indexOf(palier) + 1;
  afficherEtincelles(img, solde <= SANS_ETINCELLES_JUSQUA ? 0 : nbEtincelles);
  if (vide) {
    img.src = imageOr('piece-couchee-1');
    return;
  }

  if (tas) {
    img.src = imageOr(tas);
    return;
  }

  img.src = imageOr('piece-face');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Précharge les images du tour pour que l'animation ne clignote pas
  for (const nom of new Set(TOUR_PIECE.map(([n]) => n))) new Image().src = imageOr(nom);
  let i = 0;
  minuteurPiece = setInterval(() => {
    i = (i + 1) % TOUR_PIECE.length;
    const [nom, miroir] = TOUR_PIECE[i];
    img.src = imageOr(nom);
    img.style.transform = miroir ? 'scaleX(-1)' : '';
  }, DUREE_IMAGE_PIECE);
}

// Étincelles posées au hasard sur l'or, chacune avec son propre rythme pour ne pas
// scintiller toutes en même temps. Elles occupent la même case que l'image (grid-row 2).
function afficherEtincelles(img, nombre) {
  let zone = img.parentElement.querySelector('.bourse-etincelles');
  if (!zone) {
    zone = document.createElement('span');
    zone.className = 'bourse-etincelles';
    zone.setAttribute('aria-hidden', 'true');
    img.after(zone);
  }
  zone.innerHTML = Array.from({ length: nombre }, () => {
    const x = 20 + Math.random() * 60;         // % de la largeur de l'or
    const y = 10 + Math.random() * 75;         // % de la hauteur
    const taille = 8 + Math.random() * 8;      // px
    const duree = 1.4 + Math.random() * 1.6;   // s
    const delai = -Math.random() * duree;      // déjà en cours au chargement
    return `<span class="etincelle" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--taille:${taille.toFixed(1)}px;animation-duration:${duree.toFixed(2)}s;animation-delay:${delai.toFixed(2)}s"></span>`;
  }).join('');
}


async function afficherInventaire(discordId, joueur) {
  const { data } = await supabase
    .from('inventory')
    .select('quantity, item:items(*)')
    .eq('discord_id', discordId)
    .order('acquired_at', { ascending: false });

  // Les objets "rp" vivent déjà dans l'inventaire du personnage géré par le bot
  const objets = (data ?? []).filter(({ item }) => item.kind !== 'rp');

  const zone = $('inventaire');

  if (!objets.length) {
    zone.innerHTML = `<p class="vide">Aucun cosmétique pour l'instant.</p>`;
    return;
  }

  const equipes = [joueur.banner_item_id, joueur.title_item_id, joueur.theme_item_id];

  zone.innerHTML = objets.map(({ quantity, item }) => {
    let action = '';
    if (COSMETIQUES.includes(item.kind)) {
      action = equipes.includes(item.id)
        ? `<button type="button" class="btn-petit btn-petit--retirer" data-desequiper="${item.kind}">Retirer</button>`
        : `<button type="button" class="btn-petit btn-petit--equiper" data-equiper="${item.id}">Équiper</button>`;
    }
    return `
      <li class="objet">
        <div>
          <span class="objet__type">${esc(LIBELLES[item.kind] ?? item.kind)}</span>
          <strong>${esc(item.name)}</strong>${quantity > 1 ? ` <span class="objet__qte">×${quantity}</span>` : ''}
        </div>
        ${action}
      </li>`;
  }).join('');

  limiterHauteur(zone, 3);
}


// N'affiche que les `n` premiers éléments d'une liste, le reste est accessible en faisant défiler.
// ResizeObserver : la liste est encore cachée au premier rendu, on mesure dès qu'elle devient visible.
function limiterHauteur(liste, n) {
  new ResizeObserver(() => {
    const dernier = liste.children[n - 1];
    liste.style.maxHeight = liste.children.length > n
      ? `${dernier.offsetTop + dernier.offsetHeight}px`
      : '';
  }).observe(liste);
}


async function afficherHistorique(discordId) {
  const { data: lignes } = await supabase
    .from('transactions')
    .select('*')
    .eq('discord_id', discordId)
    .order('created_at', { ascending: false })
    .limit(3);

  const zone = $('historique');

  if (!lignes?.length) {
    zone.innerHTML = `<p class="vide">Aucune transaction pour l'instant.</p>`;
    return;
  }

  zone.innerHTML = lignes.map((t) => `
    <li class="transac">
      <div>
        <span>${esc(t.reason ?? SOURCES[t.source])}</span>
        <small>${new Date(t.created_at).toLocaleDateString('fr-FR')} · ${esc(SOURCES[t.source] ?? t.source)}</small>
      </div>
      <strong class="${t.amount >= 0 ? 'gain' : 'perte'}">${t.amount >= 0 ? '+' : ''}${t.amount}</strong>
    </li>`).join('');
}


// Boutons "Équiper" / "Retirer" (un seul écouteur pour toute la liste)
$('inventaire').addEventListener('click', async (e) => {
  const bouton = e.target.closest('[data-equiper], [data-desequiper]');
  if (!bouton || bouton.disabled) return;

  bouton.disabled = true;
  const { error } = bouton.dataset.equiper
    ? await supabase.rpc('equip_cosmetic', { p_item_id: Number(bouton.dataset.equiper) })
    : await supabase.rpc('unequip_cosmetic', { p_kind: bouton.dataset.desequiper });

  if (error) {
    alert(error.message);
    bouton.disabled = false;
  } else {
    location.reload();
  }
});

init();
