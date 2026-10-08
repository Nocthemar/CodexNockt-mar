// =====================================================================
//  Duel des Couronnes — règles du jeu (aucun affichage ici)
//  Faire tomber les 20 PV du héros adverse avant que les siens ne tombent.
//  - 1 énergie de plus par tour (10 au plus), rechargée à chaque tour
//  - 5 emplacements de troupes par camp, 7 cartes en main au plus
//  - Capacités : Garde (doit être attaquée en premier), Charge (attaque dès son arrivée)
//  - Chaque attaque est un jet de d20 (table JETS), le Jet du Destin un second d20 (table DESTIN)
//  Le duel se joue entièrement dans le navigateur, contre l'IA : il ne donne
//  ni pièces ni cartes, donc rien à vérifier côté serveur.
// =====================================================================

export const PV_HEROS = 20;
export const ENERGIE_MAX = 10;
export const PLACES = 5;
export const MAIN_MAX = 7;
export const MAIN_DEPART = 3;
export const COUT_DESTIN = 2;
export const TAILLE_DECK = 5;        // 5 cartes par joueur, pas une de plus (comme le deck du profil)
export const UNITES_PAR_DECK = TAILLE_DECK;

// ---------------------------------------------------------------------
//  Les cartes
// ---------------------------------------------------------------------
// Unités : les cartes du catalogue (table cards). Coût / attaque / vie de base selon la rareté,
// ajustés par le rang (Rang I = le plus fort) et la puissance moyenne des attaques.
const BASE = {
  commune:       { c: 2, a: 2, h: 3 },
  eveillee:      { c: 3, a: 3, h: 4 },
  mythique:      { c: 4, a: 4, h: 5 },
  legendaire:    { c: 5, a: 5, h: 6 },
  transcendante: { c: 6, a: 6, h: 7 },
};
// Capacité donnée par la Veine de la 1re attaque
const VEINES_GARDE = ['forge', 'trone', 'chaine', 'racine'];
const VEINES_CHARGE = ['bete', 'sang', 'maree'];

const puissance = (p) => (p === '∞' ? 120 : Number.isFinite(Number(p)) ? Number(p) : 50);

export function uniteDepuisCarte(carte) {
  const b = BASE[carte.rarity] ?? BASE.commune;
  let { c, a, h } = b;
  if (carte.rank === 1) { a += 1; h += 1; }
  else if (carte.rank === 2) h += 1;

  const attaques = [carte.attack_1, carte.attack_2].filter((x) => x?.nom);
  const moyenne = attaques.length ? attaques.reduce((s, x) => s + puissance(x.puissance), 0) / attaques.length : 50;
  if (moyenne >= 80) { a += 1; h = Math.max(1, h - 1); }
  else if (moyenne <= 35) { a = Math.max(1, a - 1); h += 1; }

  const veine = attaques[0]?.veine ?? null;
  const k = VEINES_GARDE.includes(veine) ? 'guard' : VEINES_CHARGE.includes(veine) ? 'charge' : null;
  return { id: `c${carte.id}`, n: carte.name, c, t: 'u', a, h, k, veine, carte };
}

// Sorts du Codex (les cartes du catalogue n'ont pas encore de sorts)
//   fx : unit (dégâts à une unité adverse), face (dégâts au héros adverse), heal (soin du héros),
//        buff (+v/+v à une de tes unités), draw (pioche v cartes), aoe (v dégâts à toutes les unités adverses)
export const SORTS = [
  { id: 's-forge',  n: 'Étincelle de la Forge', c: 1, t: 's', fx: 'unit', v: 2, veine: 'forge',  d: 'Inflige 2 dégâts à une unité adverse.' },
  { id: 's-ombre',  n: "Morsure de l'Ombre",    c: 2, t: 's', fx: 'face', v: 3, veine: 'ombre',  d: 'Inflige 3 dégâts au héros adverse.' },
  { id: 's-racine', n: 'Sève de la Racine',     c: 2, t: 's', fx: 'heal', v: 5, veine: 'racine', d: 'Rend 5 PV à ton héros.' },
  { id: 's-trone',  n: 'Serment du Trône',      c: 2, t: 's', fx: 'buff', v: 2, veine: 'trone',  d: 'Donne +2/+2 à une de tes unités.' },
  { id: 's-regard', n: 'Vision du Regard',      c: 3, t: 's', fx: 'draw', v: 2, veine: 'regard', d: 'Pioche 2 cartes.' },
  { id: 's-sang',   n: 'Saignée',               c: 4, t: 's', fx: 'unit', v: 5, veine: 'sang',   d: 'Inflige 5 dégâts à une unité adverse.' },
  { id: 's-maree',  n: 'Raz-de-Marée',          c: 5, t: 's', fx: 'aoe',  v: 2, veine: 'maree',  d: 'Inflige 2 dégâts à toutes les unités adverses.' },
];

// Troupes du Codex : unités génériques (illustration low poly). Les deux premières servent
// d'ajouts bon marché au deck (AJOUTS_CODEX) ; toutes servent si le joueur n'a aucune carte
export const TROUPES = [
  { id: 't-ecuyer',     n: 'Écuyer de la Couronne', c: 1, t: 'u', a: 1, h: 2, k: null,     veine: 'trone',  icone: 'epee' },
  { id: 't-garde',      n: 'Garde du Pont',         c: 2, t: 'u', a: 1, h: 4, k: 'guard',  veine: 'forge',  icone: 'bouclier' },
  { id: 't-archer',     n: 'Archer des Remparts',   c: 2, t: 'u', a: 2, h: 2, k: null,     veine: 'regard', icone: 'arc' },
  { id: 't-loup',       n: 'Loup des Cendres',      c: 2, t: 'u', a: 3, h: 1, k: 'charge', veine: 'ombre',  icone: 'croc' },
  { id: 't-chevalier',  n: 'Chevalier errant',      c: 3, t: 'u', a: 3, h: 3, k: null,     veine: 'trone',  icone: 'epee' },
  { id: 't-cavalier',   n: 'Cavalier de la Marche', c: 3, t: 'u', a: 3, h: 2, k: 'charge', veine: 'maree',  icone: 'lance' },
  { id: 't-sentinelle', n: 'Sentinelle de pierre',  c: 4, t: 'u', a: 2, h: 6, k: 'guard',  veine: 'racine', icone: 'bouclier' },
  { id: 't-lancier',    n: 'Lancier des Ruines',    c: 4, t: 'u', a: 4, h: 4, k: null,     veine: 'sang',   icone: 'lance' },
];

// Renfort du Jet du Destin
export const MILICIEN = { id: 'milicien', n: 'Milicien de la Couronne', c: 1, t: 'u', a: 2, h: 2, k: null, veine: null, icone: 'epee' };

// ---------------------------------------------------------------------
//  Le deck : les vraies cartes du joueur, en plusieurs exemplaires
//  (assez pour une vingtaine de cartes), et au plus 4 cartes du Codex
//  bon marché pour jouer dès les premiers tours. Plus le joueur a de cartes,
//  moins il y a d'ajouts : aucun à partir de 12 cartes.
// ---------------------------------------------------------------------
export const AJOUTS_CODEX = [TROUPES[0], TROUPES[1], SORTS[0], SORTS[1]];   // Écuyer, Garde du Pont, Étincelle, Morsure

// ---------------------------------------------------------------------
//  Cartes de pouvoir : les objets de l'Équipement (img/Equipement), effets tirés
//  de leur description dans le Codex. Un joueur a ceux qu'il possède (table inventory).
//    heal : soin du héros (v)        ready : une unité alliée peut attaquer à nouveau
//    rage : +v attaque / -1 vie       talisman : +v au prochain jet de d20
//    coffre : pioche 1 et +1 énergie  jeton : la prochaine carte coûte v de moins
// ---------------------------------------------------------------------
export const OBJETS = [
  { id: 'o-potion',   n: 'Potion de soin',          c: 1, t: 's', fx: 'heal',     v: 4, image: 'img/Equipement/Potion de soin.webp',          d: 'Rend 4 PV à ton héros.' },
  { id: 'o-trousse',  n: 'Trousse de soins',        c: 3, t: 's', fx: 'heal',     v: 8, image: 'img/Equipement/Trousse de soins.webp',        d: 'Rend 8 PV à ton héros.' },
  { id: 'o-endu',     n: "Tonique d'endurance",     c: 2, t: 's', fx: 'ready',    v: 1, image: 'img/Equipement/Tonique d’endurance.webp',     d: 'Une de tes unités peut attaquer une fois de plus ce tour.' },
  { id: 'o-rage',     n: 'Tonique de rage',         c: 2, t: 's', fx: 'rage',     v: 3, image: 'img/Equipement/Tonique de rage.webp',         d: 'Une de tes unités gagne +3 attaque mais perd 1 vie.' },
  { id: 'o-talisman', n: 'Talisman du Dé',          c: 1, t: 's', fx: 'talisman', v: 5, image: 'img/Equipement/Talisman du Dé.webp',          d: '+5 à ton prochain jet de d20.' },
  { id: 'o-coffre',   n: "Nécessaire d'aventurier", c: 1, t: 's', fx: 'coffre',   v: 1, image: 'img/Equipement/Nécessaire d’aventurier.webp', d: 'Ouvre un coffre : pioche 1 carte et regagne 1 énergie.' },
  { id: 'o-jeton',    n: 'Jeton du marchand',       c: 0, t: 's', fx: 'jeton',    v: 2, image: 'img/Equipement/Jeton du marchand.webp',       d: 'Ta prochaine carte coûte 2 de moins.' },
];
export const OBJETS_PAR_DECK = 2;   // objets au plus parmi les 5 cartes (s'il y a assez de personnages)

// Retrouve un objet à partir d'un nom d'inventaire (« Tonique d’endurance », « potion de soin »…)
const cleObjet = (nom) => String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").trim().toLowerCase();
export const objetDepuisNom = (nom) => OBJETS.find((o) => cleObjet(o.n) === cleObjet(nom)) ?? null;

// Deck de TAILLE_DECK cartes au plus, chacune en un seul exemplaire :
// OBJETS_PAR_DECK objets au plus, le reste en personnages (plus d'objets s'il manque des personnages).
// Aucune carte du tout : 5 Troupes du Codex pour pouvoir jouer quand même.
export function compositionDeck(unites, objets = []) {
  const objs = [...new Map(objets.filter(Boolean).map((o) => [o.id, o])).values()];
  if (!unites.length && !objs.length) return { cartes: TROUPES.slice(0, TAILLE_DECK), unites: TROUPES.slice(0, TAILLE_DECK), objets: [] };
  const nbObjets = Math.min(objs.length, Math.max(OBJETS_PAR_DECK, TAILLE_DECK - unites.length));
  const o = objs.slice(0, nbObjets);
  const u = unites.slice(0, TAILLE_DECK - o.length);
  return { cartes: [...u, ...o], unites: u, objets: o };
}

export function construireDeck(unites, objets = []) {
  return melanger(compositionDeck(unites, objets).cartes);
}

// Coût réel d'une carte (le Jeton du marchand réduit la suivante)
export const coutDe = (camp, carte) => (carte.fx === 'jeton' ? carte.c : Math.max(0, carte.c - (camp.reduction ?? 0)));

export function melanger(liste) {
  const l = [...liste];
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}


// ---------------------------------------------------------------------
//  Les dés
// ---------------------------------------------------------------------
export const d20 = () => 1 + Math.floor(Math.random() * 20);

// Jet d'attaque : la table se modifie ici sans toucher au reste
export const JETS = [
  { min: 1,  max: 1,  q: 'echec',    label: 'Échec critique', degats: () => 0,         texte: "0 dégât, et l'arme se brise (attaque divisée par 2 pour de bon)." },
  { min: 2,  max: 5,  q: 'faible',   label: 'Coup faible',    degats: (a) => Math.floor(a / 2), texte: 'Dégâts divisés par 2.' },
  { min: 6,  max: 14, q: 'normal',   label: 'Coup normal',    degats: (a) => a,         texte: 'Dégâts normaux.' },
  { min: 15, max: 19, q: 'solide',   label: 'Coup solide',    degats: (a) => a + 1,     texte: '+1 dégât.' },
  { min: 20, max: 20, q: 'critique', label: 'Critique !',     degats: (a) => a * 2,     texte: 'Dégâts doublés.' },
];
export const rollInfo = (de) => JETS.find((j) => de >= j.min && de <= j.max);

// Jet du Destin
export const DESTIN = [
  { min: 1,  max: 4,  q: 'malediction', label: 'Malédiction', texte: 'Ton héros subit 3 dégâts.' },
  { min: 5,  max: 8,  q: 'soin',        label: 'Soin',        texte: 'Ton héros récupère 4 PV.' },
  { min: 9,  max: 12, q: 'pioche',      label: 'Pioche',      texte: 'Tu pioches 2 cartes.' },
  { min: 13, max: 16, q: 'renfort',     label: 'Renfort',     texte: 'Un Milicien de la Couronne (2/2) rejoint tes rangs.' },
  { min: 17, max: 19, q: 'benediction', label: 'Bénédiction', texte: 'Tes unités gagnent +1/+1.' },
  { min: 20, max: 20, q: 'grace',       label: 'Grâce divine', texte: 'Tes unités gagnent +2/+2.' },
];
export const destinInfo = (de) => DESTIN.find((j) => de >= j.min && de <= j.max);


// ---------------------------------------------------------------------
//  La partie
// ---------------------------------------------------------------------
let compteur = 0;
const instancier = (def) => ({
  uid: ++compteur, def, n: def.n, a: def.a, h: def.h, hMax: def.h, k: def.k,
  prete: def.k === 'charge', aAttaque: false, brisee: false,
});

function creerCamp(nom, deck) {
  return {
    nom, pv: PV_HEROS, pvMax: PV_HEROS,
    energie: 0, energieMax: 0, destinUtilise: false,
    deck, main: [], terrain: Array(PLACES).fill(null),
    stats: { jets: 0, critiques: 0, echecs: 0, cartes: 0, degats: 0, destins: 0 },
  };
}

export const autre = (qui) => (qui === 'joueur' ? 'adverse' : 'joueur');

export function creerPartie(deckJoueur, deckAdverse, nomJoueur, nomAdverse, premier) {
  const p = {
    camps: { joueur: creerCamp(nomJoueur, deckJoueur), adverse: creerCamp(nomAdverse, deckAdverse) },
    actif: premier, tour: 0, fini: null,
    jets: [],   // historique des derniers jets (affichage)
  };
  piocher(p.camps[premier], MAIN_DEPART);
  piocher(p.camps[autre(premier)], MAIN_DEPART + 1);   // le second joueur a une carte de plus
  return p;
}

// Pioche : une main pleine brûle la carte piochée
export function piocher(camp, n = 1) {
  const res = { piochees: [], brulees: [] };
  for (let i = 0; i < n && camp.deck.length; i++) {
    const carte = camp.deck.shift();
    if (camp.main.length >= MAIN_MAX) res.brulees.push(carte);
    else { camp.main.push(carte); res.piochees.push(carte); }
  }
  return res;
}

export function debutTour(p) {
  const camp = p.camps[p.actif];
  if (p.actif === 'joueur' || p.tour === 0) p.tour += 1;
  camp.energieMax = Math.min(ENERGIE_MAX, camp.energieMax + 1);
  camp.energie = camp.energieMax;
  camp.destinUtilise = false;
  camp.terrain.forEach((u) => { if (u) { u.prete = true; u.aAttaque = false; } });
  const ev = { type: 'tour', qui: p.actif, pioche: piocher(camp, 1) };
  // Fatigue : pioche vide, le héros perd 1 PV, puis 2, puis 3… à chaque début de tour
  // (sinon, une fois toutes les cartes jouées, la partie pourrait ne jamais finir)
  if (!camp.deck.length && !ev.pioche.piochees.length && !ev.pioche.brulees.length) {
    camp.fatigue = (camp.fatigue ?? 0) + 1;
    camp.pv -= camp.fatigue;
    ev.fatigue = camp.fatigue;
    nettoyer(p);
  }
  return ev;
}

export function finTour(p) {
  p.actif = autre(p.actif);
}

export const unites = (camp) => camp.terrain.filter(Boolean);
export const trouver = (camp, uid) => camp.terrain.find((u) => u?.uid === uid) ?? null;
const placeLibre = (camp) => camp.terrain.findIndex((u) => !u);

// Une carte peut-elle être jouée (énergie, place, cible) ?
export function peutJouer(p, qui, index) {
  const camp = p.camps[qui];
  const carte = camp.main[index];
  if (!carte || p.fini || p.actif !== qui || coutDe(camp, carte) > camp.energie) return false;
  if (carte.t === 'u') return placeLibre(camp) >= 0;
  if (carte.fx === 'unit') return unites(p.camps[autre(qui)]).length > 0;
  if (carte.fx === 'buff' || carte.fx === 'rage') return unites(camp).length > 0;
  if (carte.fx === 'ready') return unites(camp).some((u) => u.aAttaque && u.a > 0);
  return true;
}

// Cibles d'un sort : null si le sort n'en demande pas
export function ciblesSort(p, qui, carte) {
  if (carte.fx === 'unit') return unites(p.camps[autre(qui)]).map((u) => ({ camp: autre(qui), uid: u.uid }));
  if (carte.fx === 'buff' || carte.fx === 'rage') return unites(p.camps[qui]).map((u) => ({ camp: qui, uid: u.uid }));
  if (carte.fx === 'ready') return unites(p.camps[qui]).filter((u) => u.aAttaque && u.a > 0).map((u) => ({ camp: qui, uid: u.uid }));
  return null;
}

// Cibles d'une attaque : les unités en Garde d'abord, sinon toutes les unités et le héros
export function ciblesAttaque(p, qui) {
  const adv = autre(qui);
  const ennemis = unites(p.camps[adv]);
  const gardes = ennemis.filter((u) => u.k === 'guard');
  const liste = (gardes.length ? gardes : ennemis).map((u) => ({ camp: adv, uid: u.uid }));
  if (!gardes.length) liste.push({ camp: adv, heros: true });
  return liste;
}

export const peutAttaquer = (u) => !!u && u.prete && !u.aAttaque && u.a > 0;
const memeCible = (a, b) => a.camp === b.camp && (a.heros ? b.heros : a.uid === b.uid);

// Retire les unités tombées et vérifie la fin de partie
function nettoyer(p) {
  const morts = [];
  for (const qui of ['joueur', 'adverse']) {
    const camp = p.camps[qui];
    camp.terrain = camp.terrain.map((u) => {
      if (u && u.h <= 0) { morts.push(u.uid); return null; }
      return u;
    });
  }
  if (p.camps.joueur.pv <= 0) p.fini = 'adverse';
  else if (p.camps.adverse.pv <= 0) p.fini = 'joueur';
  return morts;
}

// Joue une carte de la main. cible : { camp, uid } pour les sorts qui en demandent une
export function jouer(p, qui, index, cible = null) {
  if (!peutJouer(p, qui, index)) return null;
  const camp = p.camps[qui];
  const carte = camp.main[index];
  const cibles = carte.t === 's' ? ciblesSort(p, qui, carte) : null;
  if (cibles && !cibles.some((c) => cible && memeCible(c, cible))) return null;

  camp.main.splice(index, 1);
  camp.energie -= coutDe(camp, carte);
  if (carte.fx !== 'jeton') camp.reduction = 0;   // la réduction du Jeton ne sert qu'une fois
  camp.stats.cartes += 1;
  const ev = { type: carte.t === 'u' ? 'pose' : 'sort', qui, carte, cible };

  if (carte.t === 'u') {
    const place = placeLibre(camp);
    const u = instancier(carte);
    camp.terrain[place] = u;
    ev.uid = u.uid;
    ev.place = place;
    return ev;
  }
  cast(p, qui, carte, cible, ev);
  ev.morts = nettoyer(p);
  return ev;
}

// Effet d'un sort
function cast(p, qui, carte, cible, ev) {
  const camp = p.camps[qui];
  const adverse = p.camps[autre(qui)];
  ev.touches = [];   // [{ camp, uid | heros, valeur, soin }]
  switch (carte.fx) {
    case 'unit': {
      const u = trouver(adverse, cible.uid);
      u.h -= carte.v;
      camp.stats.degats += carte.v;
      ev.touches.push({ camp: autre(qui), uid: u.uid, valeur: carte.v });
      break;
    }
    case 'face':
      adverse.pv -= carte.v;
      camp.stats.degats += carte.v;
      ev.touches.push({ camp: autre(qui), heros: true, valeur: carte.v });
      break;
    case 'heal': {
      const avant = camp.pv;
      camp.pv = Math.min(camp.pvMax, camp.pv + carte.v);
      ev.touches.push({ camp: qui, heros: true, valeur: camp.pv - avant, soin: true });
      break;
    }
    case 'buff': {
      const u = trouver(camp, cible.uid);
      u.a += carte.v; u.h += carte.v; u.hMax += carte.v;
      ev.touches.push({ camp: qui, uid: u.uid, valeur: carte.v, buff: true });
      break;
    }
    case 'draw':
      ev.pioche = piocher(camp, carte.v);
      break;
    case 'ready': {
      const u = trouver(camp, cible.uid);
      u.aAttaque = false;
      u.prete = true;
      ev.touches.push({ camp: qui, uid: u.uid, texte: 'Encore une attaque !', buff: true });
      break;
    }
    case 'rage': {
      const u = trouver(camp, cible.uid);
      u.a += carte.v;
      u.h = Math.max(1, u.h - 1);
      ev.touches.push({ camp: qui, uid: u.uid, texte: `+${carte.v} attaque`, buff: true });
      break;
    }
    case 'talisman':
      camp.bonusDe = (camp.bonusDe ?? 0) + carte.v;
      ev.touches.push({ camp: qui, heros: true, texte: `+${carte.v} au prochain d20`, buff: true });
      break;
    case 'coffre':
      ev.pioche = piocher(camp, 1);
      camp.energie = Math.min(ENERGIE_MAX, camp.energie + 1);
      ev.touches.push({ camp: qui, heros: true, texte: '+1 énergie', buff: true });
      break;
    case 'jeton':
      camp.reduction = (camp.reduction ?? 0) + carte.v;
      ev.touches.push({ camp: qui, heros: true, texte: `Prochaine carte -${carte.v}`, buff: true });
      break;
    case 'aoe':
      unites(adverse).forEach((u) => {
        u.h -= carte.v;
        camp.stats.degats += carte.v;
        ev.touches.push({ camp: autre(qui), uid: u.uid, valeur: carte.v });
      });
      break;
    default: break;
  }
}

// Attaque d'une unité : jet de d20 ; une unité attaquée riposte avec son attaque (sans jet)
export function attaquer(p, qui, uid, cible) {
  const camp = p.camps[qui];
  const adverse = p.camps[autre(qui)];
  const u = trouver(camp, uid);
  if (!peutAttaquer(u) || p.actif !== qui || p.fini) return null;
  if (!ciblesAttaque(p, qui).some((c) => memeCible(c, cible))) return null;

  let de = d20();
  if (camp.bonusDe) { de = Math.min(20, de + camp.bonusDe); camp.bonusDe = 0; }
  const info = rollInfo(de);
  camp.stats.jets += 1;
  if (info.q === 'critique') camp.stats.critiques += 1;
  if (info.q === 'echec') camp.stats.echecs += 1;

  const degats = info.degats(u.a);
  u.aAttaque = true;
  const ev = { type: 'attaque', qui, uid, cible, de, info, degats, riposte: 0, brise: false };

  if (info.q === 'echec') {
    u.a = Math.floor(u.a / 2);
    u.brisee = true;
    ev.brise = true;
  }
  if (cible.heros) {
    adverse.pv -= degats;
  } else {
    const t = trouver(adverse, cible.uid);
    t.h -= degats;
    ev.riposte = t.a;
    u.h -= t.a;
  }
  camp.stats.degats += degats;
  p.jets.unshift({ qui, de, q: info.q, label: info.label, quoi: `${u.n} attaque` });
  p.jets.length = Math.min(p.jets.length, 8);
  ev.morts = nettoyer(p);
  return ev;
}

// Jet du Destin : 2 énergie, une fois par tour
export const peutDestin = (p, qui) => p.actif === qui && !p.fini
  && !p.camps[qui].destinUtilise && p.camps[qui].energie >= COUT_DESTIN;

export function destin(p, qui) {
  if (!peutDestin(p, qui)) return null;
  const camp = p.camps[qui];
  camp.energie -= COUT_DESTIN;
  camp.destinUtilise = true;
  camp.stats.destins += 1;
  camp.stats.jets += 1;

  let de = d20();
  if (camp.bonusDe) { de = Math.min(20, de + camp.bonusDe); camp.bonusDe = 0; }
  const info = destinInfo(de);
  if (de === 20) camp.stats.critiques += 1;
  if (de === 1) camp.stats.echecs += 1;
  const ev = { type: 'destin', qui, de, info, touches: [] };

  switch (info.q) {
    case 'malediction':
      camp.pv -= 3;
      ev.touches.push({ camp: qui, heros: true, valeur: 3 });
      break;
    case 'soin': {
      const avant = camp.pv;
      camp.pv = Math.min(camp.pvMax, camp.pv + 4);
      ev.touches.push({ camp: qui, heros: true, valeur: camp.pv - avant, soin: true });
      break;
    }
    case 'pioche':
      ev.pioche = piocher(camp, 2);
      break;
    case 'renfort': {
      const place = placeLibre(camp);
      if (place >= 0) {
        const u = instancier(MILICIEN);
        camp.terrain[place] = u;
        ev.uid = u.uid;
      } else ev.complet = true;
      break;
    }
    case 'benediction':
    case 'grace': {
      const bonus = info.q === 'grace' ? 2 : 1;
      unites(camp).forEach((u) => {
        u.a += bonus; u.h += bonus; u.hMax += bonus;
        ev.touches.push({ camp: qui, uid: u.uid, valeur: bonus, buff: true });
      });
      break;
    }
    default: break;
  }
  p.jets.unshift({ qui, de, q: info.q, label: info.label, quoi: 'Jet du Destin', destin: true });
  p.jets.length = Math.min(p.jets.length, 8);
  ev.morts = nettoyer(p);
  return ev;
}


// ---------------------------------------------------------------------
//  IA : renvoie la prochaine action de l'Ombre, ou null pour finir le tour
//  { type: 'jouer', index, cible } | { type: 'destin' } | { type: 'attaque', uid, cible }
// ---------------------------------------------------------------------
export function ai(p, qui = 'adverse') {
  const camp = p.camps[qui];
  const adv = p.camps[autre(qui)];
  const ennemis = unites(adv);

  // 1. Victoire immédiate avec un sort sur le héros
  const fatal = camp.main.findIndex((c, i) => c.fx === 'face' && c.v >= adv.pv && peutJouer(p, qui, i));
  if (fatal >= 0) return { type: 'jouer', index: fatal };

  // 2. Cartes, de la plus chère à la moins chère, si elles servent à quelque chose
  const ordre = camp.main.map((c, i) => ({ c, i })).filter(({ i }) => peutJouer(p, qui, i)).sort((x, y) => y.c.c - x.c.c);
  for (const { c, i } of ordre) {
    if (c.t === 'u') return { type: 'jouer', index: i };
    if (c.fx === 'unit') {
      // de préférence une unité qu'il tue, la plus menaçante
      const tues = ennemis.filter((u) => u.h <= c.v).sort((a, b) => b.a - a.a);
      const cible = tues[0] ?? (c.v >= 4 ? [...ennemis].sort((a, b) => b.a - a.a)[0] : null);
      if (cible) return { type: 'jouer', index: i, cible: { camp: autre(qui), uid: cible.uid } };
      continue;
    }
    if (c.fx === 'buff' || c.fx === 'rage') {
      const u = [...unites(camp)].sort((a, b) => (b.a + b.h) - (a.a + a.h))[0];
      return { type: 'jouer', index: i, cible: { camp: qui, uid: u.uid } };
    }
    if (c.fx === 'ready') {
      const u = unites(camp).filter((x) => x.aAttaque && x.a > 0).sort((a, b) => b.a - a.a)[0];
      return { type: 'jouer', index: i, cible: { camp: qui, uid: u.uid } };
    }
    if (c.fx === 'talisman' && (camp.bonusDe || !unites(camp).some(peutAttaquer))) continue;
    if (c.fx === 'jeton' && (camp.reduction || !camp.main.some((x) => x !== c && x.c > camp.energie && x.c - c.v <= camp.energie))) continue;
    if (c.fx === 'aoe' && ennemis.length < 2) continue;
    if (c.fx === 'heal' && camp.pv > PV_HEROS - c.v) continue;
    if (c.fx === 'draw' && camp.main.length > 5) continue;
    return { type: 'jouer', index: i };
  }

  // 3. Le Destin, une fois sur deux s'il reste de l'énergie
  if (peutDestin(p, qui) && camp.pv > 3 && Math.random() < 0.5) return { type: 'destin' };

  // 4. Attaques
  const pretes = unites(camp).filter(peutAttaquer).sort((a, b) => b.a - a.a);
  for (const u of pretes) {
    const cibles = ciblesAttaque(p, qui);
    const unitesCibles = cibles.filter((c) => !c.heros).map((c) => trouver(adv, c.uid));
    const heros = cibles.find((c) => c.heros);
    // Garde : il faut la frapper, la plus fragile d'abord
    if (!heros) {
      const g = unitesCibles.sort((a, b) => a.h - b.h)[0];
      return { type: 'attaque', uid: u.uid, cible: { camp: autre(qui), uid: g.uid } };
    }
    // Échange favorable : tuer une unité dangereuse sans mourir
    const echange = unitesCibles
      .filter((t) => t.h <= u.a && t.a < u.h && t.a >= 2)
      .sort((a, b) => b.a - a.a)[0];
    if (echange && adv.pv > u.a) return { type: 'attaque', uid: u.uid, cible: { camp: autre(qui), uid: echange.uid } };
    return { type: 'attaque', uid: u.uid, cible: heros };
  }
  return null;
}
