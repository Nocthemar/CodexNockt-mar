// =====================================================================
//  Duel des Couronnes — page jeu-cartes.html
//  - Solo      : contre l'IA « l'Ombre du Codex », avec les cartes du catalogue
//  - En ligne  : contre un ami, dans un salon (connexion Discord obligatoire),
//                chacun avec les cartes de son grimoire
//  Le deck : les vraies cartes (celles du deck du profil d'abord), en plusieurs exemplaires,
//  et les objets que le joueur possède (son inventaire du site) comme cartes de pouvoir :
//  5 cartes au total (voir compositionDeck dans le moteur).
//
//  En ligne, l'hôte (« joueur » pour le moteur) fait tourner les règles et les dés :
//  il envoie chaque événement avec l'état de la partie (sa main et sa pioche masquées).
//  L'invité (« adverse » pour le moteur) voit tout en miroir (miroir()) : ses troupes
//  en bas, et envoie ses actions à l'hôte.
//  Règles : JS/jeu-cartes-moteur.js — Affichage : JS/jeu-cartes-arene.js
//  Sons : JS/jeu-cartes-son.js — Salon : JS/jeu-cartes-ligne.js
// =====================================================================
import { supabase, getMonJoueur, connexionDiscord } from './supabase.js';
import { $, esc, notifier } from './commun.js';
import { chargerDeck } from './cartes.js';
import {
  PV_HEROS, UNITES_PAR_DECK, TAILLE_DECK, JETS, DESTIN,
  uniteDepuisCarte, compositionDeck, construireDeck, melanger, OBJETS, OBJETS_PAR_DECK, objetDepuisNom, creerPartie, debutTour, finTour,
  peutJouer, jouer, ciblesSort, peutAttaquer, ciblesAttaque, attaquer, peutDestin, destin,
  trouver, ai,
} from './jeu-cartes-moteur.js';
import { rendre, animer, banniere, pause, htmlCarte, activerProfondeur, secouer, reduit } from './jeu-cartes-arene.js';
import { jouerSon, basculerMuet, estMuet } from './jeu-cartes-son.js';
import { ouvrirSalon, nouveauCode, codeValide, TAILLE_SALON } from './jeu-cartes-ligne.js';

const NOM_ADVERSAIRE = "L'Ombre du Codex";
const CLE_SALON_EN_ATTENTE = 'duel-salon';   // salon à rejoindre après la connexion Discord

let mode = 'solo';          // onglet de l'accueil : 'solo' | 'ligne'
let role = null;            // pendant un duel en ligne : 'hote' | 'invite' (null en solo)
let moi = null;
let idsProfil = [];         // cartes du deck du profil
let objetsInventaire = [];  // objets possédés par le joueur (cartes de pouvoir)
let objetsJoueur = [];      // objets retenus dans le deck
let unitesCatalogue = [];   // toutes les unités du catalogue (solo)
let unitesGrimoire = null;  // unités du grimoire (en ligne), chargées à la demande
let unitesJoueur = [];      // deck du mode choisi
let salon = null;
let p = null;               // partie en cours (chez l'invité : copie en miroir reçue de l'hôte)
let occupe = false;         // une animation, le tour de l'IA, ou une action envoyée est en cours
let finAffichee = false;
let sel = { monTour: false, attaquant: null, sortIndex: null, cibles: null };

// Seulement les vraies cartes illustrées (pas la carte d'exemple)
const jouable = (c) => c?.image && c.description !== "Carte d'exemple";

// Toutes les actions locales et distantes passent par cette file, une à la fois
let file = Promise.resolve();
const enFile = (fn) => (file = file.then(fn).catch(console.error));


// ---------------------------------------------------------------------
//  Démarrage
// ---------------------------------------------------------------------
async function init() {
  remplirRegles();
  majBoutonSon();
  activerProfondeur();

  const [{ data, error }, joueur] = await Promise.all([
    supabase.from('cards').select('*').eq('is_available', true).order('id'),
    getMonJoueur().catch(() => null),
  ]);
  if (error) {
    $('accueil-deck').innerHTML = '<p class="vide">Impossible de charger les cartes.</p>';
    return;
  }
  moi = joueur;
  unitesCatalogue = (data ?? []).filter(jouable).map(uniteDepuisCarte);
  if (moi) {
    const [deck, inventaire] = await Promise.all([
      chargerDeck(moi.discord_id).catch(() => null),
      supabase.from('inventory').select('item:items(name, kind)').eq('discord_id', moi.discord_id),
    ]);
    idsProfil = (deck?.ids ?? []).filter((id) => id != null);
    objetsInventaire = objetsPossedes(inventaire?.data);
  }

  // Lien d'invitation (?salon=CODE), ou retour de la connexion Discord
  const code = (new URLSearchParams(location.search).get('salon') ?? sessionStorage.getItem(CLE_SALON_EN_ATTENTE) ?? '').toUpperCase();
  if (codeValide(code)) {
    await changerMode('ligne');
    if (moi) {
      sessionStorage.removeItem(CLE_SALON_EN_ATTENTE);
      entrerSalon(code, sessionStorage.getItem(`duel-hote-${code}`) ? 'hote' : 'invite');
    } else {
      sessionStorage.setItem(CLE_SALON_EN_ATTENTE, code);
    }
  } else {
    await changerMode(new URLSearchParams(location.search).get('mode') === 'ligne' ? 'ligne' : 'solo');
  }
}

// Objets possédés par le joueur (table inventory) qui existent comme cartes de pouvoir
function objetsPossedes(lignes) {
  return (lignes ?? []).map(({ item }) => item && objetDepuisNom(item.name)).filter(Boolean);
}

// ---------------------------------------------------------------------
//  Accueil : solo ou en ligne
// ---------------------------------------------------------------------
async function changerMode(nouveau) {
  mode = nouveau;
  choix = null;            // chaque mode a son propre deck choisi
  editionDeck = false;
  document.querySelectorAll('.mode').forEach((b) => {
    const actif = b.dataset.mode === mode;
    b.classList.toggle('est-actif', actif);
    b.setAttribute('aria-selected', String(actif));
  });
  $('panneau-ligne').hidden = mode !== 'ligne';
  $('btn-jouer').hidden = mode !== 'solo';

  if (mode === 'ligne' && moi && !unitesGrimoire) {
    // Le grimoire : lisible seulement par son propriétaire (RLS de player_cards)
    const { data } = await supabase.from('player_cards').select('card:cards(*)').eq('discord_id', moi.discord_id);
    const vues = new Set();
    unitesGrimoire = (data ?? []).map((l) => l.card).filter((c) => jouable(c) && !vues.has(c.id) && vues.add(c.id)).map(uniteDepuisCarte);
  }
  afficherDeck();
  majPanneauLigne();
}

// Vraies cartes d'un deck : celles du deck du profil d'abord, puis les autres au hasard
function deckDepuis(unites) {
  const duProfil = idsProfil.map((id) => unites.find((u) => u.carte.id === id)).filter(Boolean);
  const reste = melanger(unites.filter((u) => !duProfil.includes(u)));
  return { unites: [...duProfil, ...reste].slice(0, UNITES_PAR_DECK), duProfil: duProfil.length };
}


// ---------------------------------------------------------------------
//  Choix du deck : le joueur choisit ses 5 cartes parmi ses personnages
//  et ses objets de pouvoir. Choix retenu dans le navigateur, par mode.
// ---------------------------------------------------------------------
const CLE_CHOIX = (m) => `duel-couronnes-deck-${m}`;
const cleCarte = (c) => (c.carte ? `u${c.carte.id}` : c.id);
let choix = null;            // clés des cartes choisies pour le mode en cours
let editionDeck = false;     // panneau « Choisir mes cartes » ouvert

// Cartes disponibles dans le mode en cours (un seul exemplaire de chaque objet)
function reserve() {
  const unites = mode === 'ligne' ? (unitesGrimoire ?? []) : unitesCatalogue;
  const objets = [...new Map(objetsInventaire.map((o) => [o.id, o])).values()];
  return { unites, objets, toutes: [...unites, ...objets] };
}
// Objets permis : OBJETS_PAR_DECK, ou plus s'il manque des personnages (même règle que le moteur)
const maxObjets = (nbUnites) => Math.max(OBJETS_PAR_DECK, TAILLE_DECK - nbUnites);

function lireChoix() {
  try { return JSON.parse(localStorage.getItem(CLE_CHOIX(mode)) ?? 'null'); } catch { return null; }
}
function garderChoix() {
  try { localStorage.setItem(CLE_CHOIX(mode), JSON.stringify(choix)); } catch { /* stockage indisponible */ }
}

// Cartes choisies, dans l'ordre, en respectant les limites (cartes disparues ignorées)
function cartesChoisies() {
  const { unites, toutes } = reserve();
  const cartes = [];
  let nbObjets = 0;
  for (const cle of choix ?? []) {
    const c = toutes.find((x) => cleCarte(x) === cle);
    if (!c || cartes.includes(c) || cartes.length >= TAILLE_DECK) continue;
    if (c.t !== 'u' && nbObjets >= maxObjets(unites.length)) continue;
    if (c.t !== 'u') nbObjets++;
    cartes.push(c);
  }
  return cartes;
}

function afficherDeck() {
  if (mode === 'ligne' && !moi) {
    $('accueil-deck-titre').textContent = 'Ton deck';
    $('accueil-deck').innerHTML = '<p class="vide">Connecte-toi avec Discord pour jouer avec les cartes de ton grimoire.</p>';
    $('choix-deck').hidden = true;
    return;
  }
  const { unites, objets, toutes } = reserve();

  // Rien du tout : 5 Troupes du Codex, pas de choix possible
  if (!toutes.length) {
    const compo = compositionDeck([], []);
    unitesJoueur = compo.unites;
    objetsJoueur = [];
    $('accueil-deck-titre').textContent = 'Ton grimoire est vide : tu joueras avec 5 Troupes du Codex';
    $('accueil-deck').innerHTML = compo.cartes.map((c) => htmlCarte(c)).join('');
    $('choix-deck').hidden = true;
    $('btn-jouer').disabled = false;
    return;
  }

  // Premier passage : le choix retenu, sinon le deck proposé d'office
  if (!choix) {
    choix = lireChoix();
    if (!Array.isArray(choix)) choix = compositionDeck(deckDepuis(unites).unites, objets).cartes.map(cleCarte);
  }
  const cartes = cartesChoisies();
  unitesJoueur = cartes.filter((c) => c.t === 'u');
  objetsJoueur = cartes.filter((c) => c.t !== 'u');

  const parties = [];
  if (unitesJoueur.length) parties.push(`${unitesJoueur.length} personnage${unitesJoueur.length > 1 ? 's' : ''}`);
  if (objetsJoueur.length) parties.push(`${objetsJoueur.length} objet${objetsJoueur.length > 1 ? 's' : ''}`);
  $('accueil-deck-titre').textContent = `Ton deck (${cartes.length} / ${TAILLE_DECK} cartes)${parties.length ? ` : ${parties.join(' et ')}` : ''}`;

  // Les 5 places du deck (un clic sur une carte la retire, en mode choix)
  const places = Array.from({ length: TAILLE_DECK }, (_, i) => cartes[i]
    ? `<span class="deck-place" data-cle="${esc(cleCarte(cartes[i]))}">${htmlCarte(cartes[i])}</span>`
    : '<span class="deck-place deck-place--vide" aria-hidden="true">+</span>');
  $('accueil-deck').innerHTML = places.join('')
    + `<button type="button" class="btn-dc deck-modifier${editionDeck ? ' btn-dc--ambre' : ''}" id="btn-choisir">${editionDeck ? 'Valider mon deck' : 'Choisir mes cartes'}</button>`
    + (moi && !objets.length ? '<p class="accueil__note">Tu n\'as aucun objet : les objets que tu possèdes (Potion de soin, Tonique de rage…) deviennent des cartes de pouvoir. On les trouve à la <a href="boutique.html">boutique</a>.</p>' : '');
  $('accueil-deck').classList.toggle('est-en-edition', editionDeck);

  afficherChoix(unites, objets, cartes);

  // Il faut au moins un personnage (s'il y en a) pour pouvoir jouer
  const valide = cartes.length > 0 && (unitesJoueur.length > 0 || !unites.length);
  $('btn-jouer').disabled = !valide;
  $('btn-pret').disabled = !valide && !salon?.presence.pret;
  $('accueil-deck-titre').classList.toggle('est-invalide', !valide);
  if (!valide) $('accueil-deck-titre').textContent += ' : ajoute au moins un personnage';
  if (salon && !salon.presence.pret) salon.annoncer({ cartes: idsDeck(), objets: idsObjets() });
}

// Panneau de choix : toutes les cartes disponibles, celles du deck en surbrillance
function afficherChoix(unites, objets, cartes) {
  const zone = $('choix-deck');
  zone.hidden = !editionDeck;
  if (!editionDeck) return;
  const plein = cartes.length >= TAILLE_DECK;
  const objetsPleins = cartes.filter((c) => c.t !== 'u').length >= maxObjets(unites.length);
  const groupe = (titre, liste, bloque) => !liste.length ? '' : `
    <div class="choix-deck__groupe">
      <h3 class="choix-deck__titre">${titre} <span>${liste.length}</span></h3>
      <div class="choix-deck__cartes">${liste.map((c) => {
        const dedans = cartes.includes(c);
        return `<span class="deck-place${!dedans && (plein || bloque) ? ' est-bloquee' : ''}" data-cle="${esc(cleCarte(c))}">${htmlCarte(c, { choisie: dedans })}</span>`;
      }).join('')}</div>
    </div>`;
  zone.innerHTML = `
    <p class="choix-deck__aide">Clique une carte pour l'ajouter ou la retirer : ${TAILLE_DECK} cartes au plus, dont ${maxObjets(unites.length)} objets au plus.</p>
    ${groupe(mode === 'ligne' ? 'Personnages de ton grimoire' : 'Personnages', unites, false)}
    ${groupe('Objets de pouvoir', objets, objetsPleins)}`;
}

function basculerCarte(cle) {
  const { unites, toutes } = reserve();
  const c = toutes.find((x) => cleCarte(x) === cle);
  if (!c) return;
  const actuelles = cartesChoisies();
  if (actuelles.includes(c)) {
    choix = actuelles.filter((x) => x !== c).map(cleCarte);
  } else if (actuelles.length >= TAILLE_DECK) {
    return notifier(`Ton deck est plein (${TAILLE_DECK} cartes) : retire d'abord une carte.`, 'erreur');
  } else if (c.t !== 'u' && actuelles.filter((x) => x.t !== 'u').length >= maxObjets(unites.length)) {
    return notifier(`${maxObjets(unites.length)} objets au plus dans le deck.`, 'erreur');
  } else {
    choix = [...actuelles.map(cleCarte), cle];
  }
  jouerSon('clic');
  garderChoix();
  afficherDeck();
}

$('accueil-deck').addEventListener('click', (e) => {
  if (e.target.closest('#btn-choisir')) {
    if (salon?.presence.pret) return notifier('Tu es prêt : clique « Je ne suis plus prêt » pour changer ton deck.', 'erreur');
    editionDeck = !editionDeck;
    afficherDeck();
    if (editionDeck) $('choix-deck').scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'nearest' });
    return;
  }
  const place = e.target.closest('.deck-place[data-cle]');
  if (place && editionDeck) basculerCarte(place.dataset.cle);
});
$('choix-deck').addEventListener('click', (e) => {
  const place = e.target.closest('.deck-place[data-cle]');
  if (place) basculerCarte(place.dataset.cle);
});

const idsDeck = () => unitesJoueur.filter((u) => u.carte).map((u) => u.carte.id);
const idsObjets = () => objetsJoueur.map((o) => o.id);

document.querySelector('.modes').addEventListener('click', (e) => {
  const b = e.target.closest('.mode');
  if (!b || b.dataset.mode === mode) return;
  if (salon) return notifier('Quitte d\'abord le salon pour jouer en solo.', 'erreur');
  changerMode(b.dataset.mode);
});


// ---------------------------------------------------------------------
//  Partie : déroulé commun (solo et hôte)
// ---------------------------------------------------------------------
const avatars = () => ({ joueur: moi?.avatar_url ?? null, adverse: role ? salon?.adversaire?.avatar ?? null : null });
const afficher = () => rendre(p, sel, avatars());
const nomAdverse = () => p.camps.adverse.nom;

function montrerPlateau() {
  finAffichee = false;
  sel = { monTour: false, attaquant: null, sortIndex: null, cibles: null };
  $('fin').hidden = true;
  $('ecran-accueil').hidden = true;
  $('ecran-duel').hidden = false;
  document.body.classList.add('en-duel');   // le duel prend tout l'écran (CSS/jeu-cartes.css)
  scrollTo(0, 0);
  afficher();
}

function nouvellePartieSolo() {
  role = null;
  const deckAdverse = construireDeck(melanger(unitesCatalogue), melanger(OBJETS).slice(0, OBJETS_PAR_DECK));
  const premier = Math.random() < 0.5 ? 'joueur' : 'adverse';
  p = creerPartie(construireDeck(unitesJoueur, objetsJoueur), deckAdverse, moi?.username ?? 'Toi', NOM_ADVERSAIRE, premier);
  montrerPlateau();
  enFile(commencerTour);
}

// Début de tour (solo / hôte) : le moteur, puis l'affichage
async function commencerTour() {
  const ev = debutTour(p);
  diffuser(ev);
  await afficherTour(ev);
  if (p.fini) return terminer();
  if (p.actif === 'adverse' && !role) await tourIA();
}

// Affichage d'un début de tour (commun aux trois rôles)
async function afficherTour(ev) {
  occupe = true;
  const monTour = p.actif === 'joueur';
  if (monTour && ev.pioche.piochees.length) jouerSon('pioche');
  sel = { monTour: false, attaquant: null, sortIndex: null, cibles: null };
  afficher();
  await banniere(monTour ? 'À toi de jouer' : `Tour de ${nomAdverse()}`, `Tour ${p.tour}`, monTour ? 'banniere--moi' : '');
  if (monTour && ev.pioche.brulees.length) await banniere('Main pleine', `${ev.pioche.brulees[0].n} est brûlée.`);
  if (ev.fatigue) {
    afficher();
    await banniere('Fatigue', `Pioche vide : ${monTour ? 'ton héros' : nomAdverse()} perd ${ev.fatigue} PV.`, 'banniere--malediction');
  }
  deverrouiller();
}

function deverrouiller() {
  occupe = false;
  sel = { monTour: p.actif === 'joueur' && !p.fini, attaquant: null, sortIndex: null, cibles: null };
  majConsigne();
  afficher();
}

async function tourIA() {
  for (let i = 0; i < 30 && !p.fini; i++) {
    await pause(650);
    const a = ai(p, 'adverse');
    if (!a) break;
    await appliquer('adverse', a);
  }
  if (p.fini) return terminer();
  await pause(400);
  finTour(p);
  await commencerTour();
}

// Applique une action au moteur (solo / hôte), l'envoie à l'invité, puis l'anime
async function appliquer(qui, a) {
  let ev = null;
  if (a.type === 'jouer') ev = jouer(p, qui, a.index, a.cible ?? null);
  else if (a.type === 'attaque') ev = attaquer(p, qui, a.uid, a.cible);
  else if (a.type === 'destin') ev = destin(p, qui);
  if (!ev) return false;
  diffuser(ev);
  await executer(ev);
  return true;
}

// Anime un événement du moteur, puis redessine le plateau
async function executer(ev) {
  await animer(ev);
  afficher();
  if (ev.type === 'pose') await animer({ ...ev, type: 'apres-pose' });
  if (ev.type === 'destin' && ev.uid) await animer({ type: 'apres-pose', uid: ev.uid, carte: { n: 'Milicien de la Couronne' } });
}

async function terminer(raison = '') {
  if (finAffichee) return;
  finAffichee = true;
  occupe = true;
  sel = { monTour: false, attaquant: null, sortIndex: null, cibles: null };
  afficher();
  await pause(600);
  const gagne = p.fini === 'joueur';
  jouerSon(gagne ? 'fanfare' : 'tonnerre');
  const s = p.camps.joueur.stats;
  $('fin-sur').textContent = gagne ? 'La couronne est à toi' : `${nomAdverse()} l'emporte`;
  $('fin-titre').textContent = gagne ? 'Victoire' : 'Défaite';
  $('fin-titre').className = `fin__titre ${gagne ? 'fin__titre--victoire' : 'fin__titre--defaite'}`;
  $('fin-texte').textContent = raison || (gagne
    ? `Le héros adverse est tombé au tour ${p.tour}.`
    : `Ton héros est tombé au tour ${p.tour}. Le destin n'était pas de ton côté.`);
  $('fin-stats').innerHTML = [
    ['Jets de d20', s.jets], ['Critiques', s.critiques], ['Échecs critiques', s.echecs],
    ['Cartes jouées', s.cartes], ['Dégâts infligés', s.degats], ['Jets du Destin', s.destins],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('btn-rejouer').textContent = role ? 'Revanche' : 'Rejouer';
  $('lien-profil').hidden = !!role;
  $('btn-quitter-fin').hidden = !role;
  $('fin').hidden = false;
  $('btn-rejouer').focus();
}


// ---------------------------------------------------------------------
//  Actions du joueur de cet écran
// ---------------------------------------------------------------------
function annuler() {
  sel = { ...sel, attaquant: null, sortIndex: null, cibles: null };
  majConsigne();
  afficher();
}

function majConsigne() {
  let t = '';
  if (p && !sel.monTour && !p.fini && role && p.actif === 'adverse') t = `${nomAdverse()} joue…`;
  else if (!sel.monTour) t = '';
  else if (sel.attaquant) t = 'Choisis la cible de ton attaque (Échap pour annuler).';
  else if (sel.sortIndex != null) t = 'Choisis la cible du sort (Échap pour annuler).';
  else t = 'Joue une carte, attaque avec une unité prête, ou finis ton tour.';
  $('consigne').textContent = t;
}

// Une action du joueur : appliquée ici (solo / hôte) ou envoyée à l'hôte (invité)
function agir(a) {
  if (occupe || !sel.monTour) return;
  occupe = true;
  sel = { monTour: false, attaquant: null, sortIndex: null, cibles: null };
  afficher();
  if (role === 'invite') return envoyerChoix(a);
  enFile(async () => {
    if (a.type === 'fin') {
      finTour(p);
      await commencerTour();
      return;
    }
    await appliquer('joueur', a);
    if (p.fini) return terminer();
    deverrouiller();
  });
}

// Carte de la main
$('main-joueur').addEventListener('click', (e) => {
  const b = e.target.closest('.dc-carte[data-index]');
  if (!b || occupe || !sel.monTour) return;
  const i = Number(b.dataset.index);
  if (!peutJouer(p, 'joueur', i)) { secouer(b); jouerSon('clic'); return; }
  const carte = p.camps.joueur.main[i];
  const cibles = carte.t === 's' ? ciblesSort(p, 'joueur', carte) : null;
  if (!cibles) return agir({ type: 'jouer', index: i });
  if (sel.sortIndex === i) return annuler();
  sel = { ...sel, attaquant: null, sortIndex: i, cibles };
  majConsigne();
  afficher();
});

// Unités et héros : choisir un attaquant, ou une cible
$('scene-table').addEventListener('click', (e) => {
  if (occupe || !sel.monTour) return;
  const unite = e.target.closest('.dc-unite');
  const heros = e.target.closest('.dc-heros');
  if (!unite && !heros) return;
  const cible = unite ? { camp: unite.dataset.camp, uid: Number(unite.dataset.uid) } : { camp: heros.dataset.heros, heros: true };

  // Une sélection attend sa cible
  if (sel.cibles?.some((c) => c.camp === cible.camp && (c.heros ? cible.heros : c.uid === cible.uid))) {
    if (sel.sortIndex != null) return agir({ type: 'jouer', index: sel.sortIndex, cible });
    if (sel.attaquant) return agir({ type: 'attaque', uid: sel.attaquant, cible });
  }
  // Une de mes unités prêtes : elle devient l'attaquant
  if (unite && cible.camp === 'joueur' && sel.sortIndex == null) {
    const u = trouver(p.camps.joueur, cible.uid);
    if (sel.attaquant === u.uid) return annuler();
    if (!peutAttaquer(u)) { secouer(unite); return; }
    sel = { ...sel, attaquant: u.uid, sortIndex: null, cibles: ciblesAttaque(p, 'joueur') };
    jouerSon('clic');
    majConsigne();
    afficher();
    return;
  }
  // Cible impossible (une Garde protège, par exemple)
  if (sel.cibles) { secouer(unite ?? heros); jouerSon('clic'); }
});

const finirTour = () => agir({ type: 'fin' });
function lancerDestin() {
  if (!p || !peutDestin(p, 'joueur')) return;
  agir({ type: 'destin' });
}

$('btn-fin').addEventListener('click', finirTour);
$('btn-destin').addEventListener('click', lancerDestin);
$('btn-jouer').addEventListener('click', nouvellePartieSolo);
$('btn-rejouer').addEventListener('click', () => {
  if (!role) return nouvellePartieSolo();
  revenirAuSalon();   // revanche : retour au salon, on se redéclare prêt
});
$('btn-quitter-fin').addEventListener('click', () => quitterSalon());
$('btn-abandon').addEventListener('click', () => {
  if (!p || p.fini || !confirm('Abandonner le duel ?')) return;
  if (role === 'invite') {
    salon?.envoyer('choix', { pid: invite.pid, id: crypto.randomUUID(), n: invite.dernier, a: { type: 'abandon' } });
    return;
  }
  enFile(async () => {
    p.fini = 'adverse';
    diffuser({ type: 'abandon', qui: 'joueur' });
    await terminer('Tu as abandonné le duel.');
  });
});

// Raccourcis : Espace pour finir le tour, D pour le Destin, Échap pour annuler
document.addEventListener('keydown', (e) => {
  if ($('ecran-duel').hidden || !$('fin').hidden || $('regles').open) return;
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); finirTour(); }
  else if (e.key === 'd' || e.key === 'D') lancerDestin();
  else if (e.key === 'Escape' && (sel.attaquant || sel.sortIndex != null)) annuler();
});


// ---------------------------------------------------------------------
//  En ligne : le salon
// ---------------------------------------------------------------------
function majPanneauLigne() {
  if (mode !== 'ligne') return;
  $('ligne-connexion').hidden = !!moi;
  $('ligne-accueil').hidden = !moi || !!salon;
  $('ligne-salon').hidden = !salon;
}

$('btn-connexion').addEventListener('click', () => connexionDiscord());

$('btn-creer').addEventListener('click', () => {
  const code = nouveauCode();
  sessionStorage.setItem(`duel-hote-${code}`, '1');
  entrerSalon(code, 'hote');
});

$('form-rejoindre').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code-salon').value.trim().toUpperCase();
  if (!codeValide(code)) return notifier('Ce code n\'est pas valide : cinq lettres ou chiffres.', 'erreur');
  entrerSalon(code, sessionStorage.getItem(`duel-hote-${code}`) ? 'hote' : 'invite');
});
$('code-salon').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

function entrerSalon(code, r) {
  salon = ouvrirSalon(code, {
    discord_id: moi.discord_id,
    nom: moi.username ?? 'Aventurier',
    avatar: moi.avatar_url ?? null,
    role: r,
  }, {
    surPresence,
    surMessage,
    surErreur: (texte) => { $('salon-etat').textContent = texte; },
  });
  salon.role = r;
  salon.adversaire = null;
  salon.annoncer({ cartes: idsDeck(), objets: idsObjets() });

  // Le lien de la page devient le lien d'invitation (?salon=CODE)
  history.replaceState(null, '', `${location.pathname}?salon=${code}`);
  $('salon-code').textContent = code;
  $('salon-etat').textContent = 'Connexion au salon…';
  majPanneauLigne();
  majBoutonPret();
  afficherJoueurs([]);
}

async function quitterSalon() {
  if (!salon) return;
  const s = salon;
  salon = null;
  role = null;
  p = null;
  sessionStorage.removeItem(`duel-hote-${s.code}`);
  history.replaceState(null, '', location.pathname);
  await s.fermer();
  revenirAccueil();
  majPanneauLigne();
}

function revenirAccueil() {
  $('fin').hidden = true;
  $('ecran-duel').hidden = true;
  $('ecran-accueil').hidden = false;
  document.body.classList.remove('en-duel');
}

function revenirAuSalon() {
  role = null;
  p = null;
  revenirAccueil();
  majBoutonPret();
  surPresence(salon?.liste() ?? []);
}

$('btn-quitter').addEventListener('click', () => quitterSalon());
$('btn-copier').addEventListener('click', async () => {
  const lien = `${location.origin}${location.pathname}?salon=${salon.code}`;
  try {
    await navigator.clipboard.writeText(lien);
    notifier('Lien du salon copié : envoie-le à ton ami.');
  } catch {
    prompt('Copie ce lien et envoie-le à ton ami :', lien);
  }
});

function majBoutonPret() {
  if (!salon) return;
  $('btn-pret').textContent = salon.presence.pret ? 'Je ne suis plus prêt' : 'Je suis prêt';
  $('btn-pret').classList.toggle('btn-dc--ambre', !salon.presence.pret);
}

$('btn-pret').addEventListener('click', async () => {
  if (!salon) return;
  await salon.annoncer({ pret: !salon.presence.pret, cartes: idsDeck(), objets: idsObjets() });
  majBoutonPret();
  surPresence(salon.liste());
});

function surPresence(liste) {
  if (!salon) return;
  // Salon de deux : les deux premiers arrivés jouent, les suivants repartent
  const dedans = liste.slice(0, TAILLE_SALON);
  if (liste.length > TAILLE_SALON && !dedans.some((x) => x.cle === salon.cle)) {
    notifier('Ce salon est complet.', 'erreur');
    quitterSalon();
    return;
  }
  const moiDedans = dedans.find((x) => x.cle === salon.cle);
  const adversaire = dedans.find((x) => x.cle !== salon.cle) ?? null;
  const avant = salon.adversaire;
  salon.adversaire = adversaire;
  afficherJoueurs(dedans);

  const etat = $('salon-etat');
  if (!moiDedans) etat.textContent = 'Connexion au salon…';
  else if (adversaire && adversaire.role === salon.role) etat.textContent = salon.role === 'invite'
    ? 'L\'hôte a quitté ce salon : l\'un de vous doit en créer un nouveau.'
    : 'Ce salon a deux hôtes (onglet dupliqué ?) : créez un nouveau salon.';
  else if (!adversaire) etat.textContent = salon.role === 'hote'
    ? 'En attente de ton adversaire… Copie le lien du salon et envoie-le-lui.'
    : 'L\'hôte n\'est pas (ou plus) dans ce salon. Attends-le, ou crée ton propre salon.';
  else if (!salon.presence.pret) etat.textContent = 'Vérifie ton deck, puis déclare-toi prêt.';
  else if (!adversaire.pret) etat.textContent = `En attente de ${adversaire.nom}…`;
  else etat.textContent = 'Le duel commence !';

  // L'adversaire a quitté le salon en plein duel
  if (avant && !adversaire && role && p && !p.fini) {
    p.fini = 'joueur';
    terminer(`${avant.nom} a quitté le duel.`);
    return;
  }

  // L'hôte lance le duel quand les deux joueurs sont prêts
  if (salon.role === 'hote' && !role && salon.presence.pret && adversaire?.pret && adversaire.role === 'invite') {
    commencerEnLigne(adversaire);
  }
}

function afficherJoueurs(dedans) {
  const places = [0, 1].map((i) => dedans[i] ?? null);
  $('salon-joueurs').innerHTML = places.map((x) => {
    if (!x) return `
      <div class="salon__joueur salon__joueur--vide">
        <span class="salon__avatar" aria-hidden="true">?</span>
        <span class="salon__nom">En attente d'un adversaire…</span>
      </div>`;
    const c = x.cle === salon.cle;
    return `
      <div class="salon__joueur${x.pret ? ' est-pret' : ''}">
        ${x.avatar ? `<img class="salon__avatar" src="${esc(x.avatar)}" alt="">` : '<span class="salon__avatar" aria-hidden="true">✦</span>'}
        <span class="salon__nom">${esc(x.nom)}${c ? ' <small>(toi)</small>' : ''}</span>
        <span class="salon__role">${x.role === 'hote' ? 'Hôte' : 'Invité'}</span>
        <span class="salon__pret">${x.pret ? 'Prêt' : 'Prépare son deck…'}</span>
      </div>`;
  }).join('');
}


// ---------------------------------------------------------------------
//  En ligne : l'hôte fait tourner la partie
// ---------------------------------------------------------------------
const hote = { pid: null, n: 0, historique: [], choixVus: new Set() };

// Copie allégée (fiches des cartes réduites à l'image et la rareté)
const alleger = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'carte' && v ? { id: v.id, image: v.image, rarity: v.rarity } : v)));

// État envoyé à l'invité : la main et la pioche de l'hôte sont masquées
function etatPourInvite() {
  const e = alleger(p);
  e.camps.joueur.main = e.camps.joueur.main.map(() => ({ cache: true }));
  e.camps.joueur.deck = e.camps.joueur.deck.map(() => 0);
  e.camps.adverse.deck = e.camps.adverse.deck.map(() => 0);
  return e;
}
function evenementPourInvite(ev) {
  const e = alleger(ev);
  if (e.qui === 'joueur' && e.pioche) e.pioche.piochees = e.pioche.piochees.map(() => ({ cache: true }));
  return e;
}

// Envoie un événement du moteur à l'invité (rien en solo)
function diffuser(ev) {
  if (role !== 'hote' || !salon) return;
  const msg = { pid: hote.pid, n: ++hote.n, ev: evenementPourInvite(ev), etat: etatPourInvite() };
  hote.historique.push(msg);
  salon.envoyer('jeu', msg);
}

async function commencerEnLigne(adversaire) {
  role = 'hote';   // réserve la place tout de suite (pas de double lancement)
  // Les cartes de l'invité sont relues dans le catalogue public
  const ids = (adversaire.cartes ?? []).filter(Number.isInteger).slice(0, UNITES_PAR_DECK);
  const { data } = ids.length ? await supabase.from('cards').select('*').in('id', ids) : { data: [] };
  const sesUnites = ids.map((id) => (data ?? []).find((c) => c.id === id)).filter(jouable).map(uniteDepuisCarte);

  await salon.annoncer({ pret: false });
  majBoutonPret();
  Object.assign(hote, { pid: crypto.randomUUID(), n: 0, historique: [], choixVus: new Set() });
  const premier = Math.random() < 0.5 ? 'joueur' : 'adverse';
  // Objets de l'invité : seulement des objets connus (le moteur refait la limite de 5 cartes)
  const sesObjets = (adversaire.objets ?? []).map((id) => OBJETS.find((o) => o.id === id)).filter(Boolean);
  p = creerPartie(construireDeck(unitesJoueur, objetsJoueur), construireDeck(sesUnites, sesObjets), salon.presence.nom, adversaire.nom, premier);
  montrerPlateau();
  diffuser({ type: 'debut' });
  enFile(commencerTour);
}

// Action reçue de l'invité (dans son sens à lui : retournée en miroir)
function traiterChoix(c) {
  if (c.pid !== hote.pid || !c.id || hote.choixVus.has(c.id) || !p || p.fini) return;
  // Action périmée ou hors de son tour (l'abandon, lui, est possible à tout moment)
  if (c.a?.type !== 'abandon' && (c.n !== hote.n || p.actif !== 'adverse')) return;
  hote.choixVus.add(c.id);
  const a = miroir(c.a);
  enFile(async () => {
    if (a.type === 'fin') { finTour(p); await commencerTour(); return; }
    if (a.type === 'abandon') {
      p.fini = 'joueur';
      diffuser({ type: 'abandon', qui: 'adverse' });
      await terminer(`${nomAdverse()} a abandonné le duel.`);
      return;
    }
    // Action refusée par le moteur : on renvoie l'état pour débloquer l'invité
    if (!(await appliquer('adverse', a))) diffuser({ type: 'refus', qui: 'adverse' });
    if (p.fini) await terminer();
  });
}


// ---------------------------------------------------------------------
//  En ligne : l'invité rejoue les événements de l'hôte
// ---------------------------------------------------------------------
const invite = { pid: null, dernier: 0, activite: 0, choixEnvoye: null };

// Le plateau vu de l'autre côté : « joueur » et « adverse » échangés partout
const ECHANGE = { joueur: 'adverse', adverse: 'joueur' };
function miroir(x) {
  if (Array.isArray(x)) return x.map(miroir);
  if (!x || typeof x !== 'object') return x;
  const o = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === 'camps' && v) o.camps = { joueur: miroir(v.adverse), adverse: miroir(v.joueur) };
    else if (['qui', 'camp', 'actif', 'fini'].includes(k) && ECHANGE[v]) o[k] = ECHANGE[v];
    else o[k] = miroir(v);
  }
  return o;
}

function envoyerChoix(a) {
  invite.choixEnvoye = { pid: invite.pid, id: crypto.randomUUID(), n: invite.dernier, a };
  invite.activite = Date.now();
  majConsigne();
  salon?.envoyer('choix', invite.choixEnvoye);
}

function surMessage(evenement, contenu) {
  if (!salon) return;
  if (salon.role === 'hote') {
    if (evenement === 'choix') traiterChoix(contenu);
    // L'invité a manqué des messages : on les renvoie dans l'ordre
    if (evenement === 'renvoi' && contenu.pid === hote.pid) {
      hote.historique.filter((m) => m.n >= contenu.depuis).forEach((m) => salon.envoyer('jeu', m));
    }
    return;
  }
  if (evenement !== 'jeu') return;
  // Les événements sont rejoués dans l'ordre, sans trou ni doublon.
  // Nouveau duel (même si son tout premier message s'est perdu) : on repart de zéro
  if (contenu.pid !== invite.pid) Object.assign(invite, { pid: contenu.pid, dernier: 0, choixEnvoye: null });
  if (contenu.n <= invite.dernier) return;
  if (contenu.n > invite.dernier + 1) {
    salon.envoyer('renvoi', { depuis: invite.dernier + 1, pid: invite.pid });
    return;
  }
  invite.dernier = contenu.n;
  invite.activite = Date.now();
  invite.choixEnvoye = null;   // l'hôte a avancé : l'action envoyée a été traitée
  enFile(() => jouerMessage(contenu));
}

async function jouerMessage(m) {
  const ev = miroir(m.ev);
  const etat = miroir(m.etat);
  if (ev.type === 'debut') {
    role = 'invite';
    p = etat;
    await salon?.annoncer({ pret: false });
    majBoutonPret();
    montrerPlateau();
  } else if (!p || role !== 'invite') {
    return;   // duel quitté
  } else if (ev.type === 'tour') {
    p = etat;
    await afficherTour(ev);
  } else if (ev.type === 'abandon' || ev.type === 'refus') {
    p = etat;
  } else {
    await animer(ev);
    p = etat;
    afficher();
    if (ev.type === 'pose') await animer({ ...ev, type: 'apres-pose' });
    if (ev.type === 'destin' && ev.uid) await animer({ type: 'apres-pose', uid: ev.uid, carte: { n: 'Milicien de la Couronne' } });
  }
  invite.activite = Date.now();
  if (p.fini) {
    const raison = ev.type === 'abandon'
      ? (ev.qui === 'joueur' ? 'Tu as abandonné le duel.' : `${nomAdverse()} a abandonné le duel.`)
      : '';
    return terminer(raison);
  }
  if (ev.type !== 'debut') deverrouiller();
  else afficher();
}

// Veille de l'invité : si rien ne bouge depuis un moment alors qu'il attend l'hôte
// (connexion coupée un instant, message perdu…), il renvoie son action et redemande la suite
const SILENCE_MAX = 5000;
setInterval(() => {
  if (!salon || role !== 'invite' || !invite.pid || !p || p.fini) return;
  if (sel.monTour) return;   // c'est à lui de jouer
  if (Date.now() - invite.activite < SILENCE_MAX) return;
  invite.activite = Date.now();
  if (invite.choixEnvoye) salon.envoyer('choix', invite.choixEnvoye);
  salon.envoyer('renvoi', { depuis: invite.dernier + 1, pid: invite.pid });
}, 1000);


// ---------------------------------------------------------------------
//  Plein écran (comme un jeu) : le navigateur cache aussi ses propres barres
// ---------------------------------------------------------------------
$('btn-plein-ecran').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { notifier("Le plein écran n'est pas disponible sur ce navigateur.", 'erreur'); }
});
document.addEventListener('fullscreenchange', () => {
  $('btn-plein-ecran').classList.toggle('est-actif', !!document.fullscreenElement);
  $('btn-plein-ecran').title = document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran';
});


// ---------------------------------------------------------------------
//  Son et règles
// ---------------------------------------------------------------------
function majBoutonSon() {
  const m = estMuet();
  $('btn-son').setAttribute('aria-pressed', String(m));
  $('btn-son').title = m ? 'Activer le son' : 'Couper le son';
  $('btn-son').classList.toggle('est-muet', m);
}
$('btn-son').addEventListener('click', () => { basculerMuet(); majBoutonSon(); jouerSon('clic'); });

function remplirRegles() {
  $('regles-jets').innerHTML = JETS.map((j) => `<li><b>${j.min === j.max ? j.min : `${j.min}–${j.max}`}</b> ${esc(j.label.replace(' !', ''))} : ${esc(j.texte)}</li>`).join('');
  $('regles-destin').innerHTML = DESTIN.map((j) => `<li><b>${j.min === j.max ? j.min : `${j.min}–${j.max}`}</b> ${esc(j.label)} : ${esc(j.texte)}</li>`).join('');
  $('regles-pv').textContent = PV_HEROS;
}
document.querySelectorAll('[data-ouvrir-regles]').forEach((b) => b.addEventListener('click', () => $('regles').showModal()));
$('regles-fermer').addEventListener('click', () => $('regles').close());
$('regles').addEventListener('click', (e) => { if (e.target === $('regles')) $('regles').close(); });

if (reduit) document.documentElement.classList.add('anim-reduites');
init();
