// =====================================================================
//  Duel des Veines — règles du jeu (aucun affichage ici)
//  Les statistiques viennent des cartes du catalogue (table cards) :
//    - points de vie  : rareté + rang
//    - attaques       : attack_1 / attack_2 (Veine, puissance)
//  Le duel se joue entièrement dans le navigateur, contre l'IA : il ne
//  donne ni pièces ni cartes, donc rien à vérifier côté serveur.
// =====================================================================
import { VEINES } from './cartes.js';

export const TAILLE_MAIN = 3;
export const ESSENCE_MAX = 6;

const PV_RARETE = { commune: 70, eveillee: 95, mythique: 115, legendaire: 135, transcendante: 160 };
const BONUS_RANG = { 1: 20, 2: 15, 3: 10, 4: 5 };   // Rang I = le plus puissant
const PUISSANCE_INFINIE = 160;                       // puissance « ∞ » (Maître du Jeu)
const FACTEUR_DEGATS = 0.75;                         // dégâts = puissance × 0,75

// Roue des Veines : chaque Veine domine celle qui la suit (×1,3)
// et craint celle qui la précède (×0,8). La roue boucle : le Tombeau domine le Sang.
export const ROUE = ['sang', 'bete', 'racine', 'maree', 'forge', 'chaine',
                     'trone', 'regard', 'ombre', 'reve', 'esprit', 'tombeau'];

export function affinite(veineAttaque, veineCible) {
  const a = ROUE.indexOf(veineAttaque);
  const d = ROUE.indexOf(veineCible);
  if (a < 0 || d < 0) return 1;
  if ((a + 1) % ROUE.length === d) return 1.3;
  if ((d + 1) % ROUE.length === a) return 0.8;
  return 1;
}

// Effet propre à chaque Veine, déclenché quand l'attaque touche
export const EFFETS = {
  sang:    ['Saignée',      'Soigne le lanceur de 30 % des dégâts infligés.'],
  bete:    ['Sauvagerie',   'Coup critique dès 18 au d20.'],
  racine:  ['Régénération', 'Le lanceur récupère 10 PV.'],
  maree:   ['Reflux',       'Rend 1 essence au lanceur.'],
  forge:   ['Armure',       'Le lanceur gagne un bouclier de 15.'],
  chaine:  ['Entrave',      'La cible ne pourra pas utiliser sa 2e attaque au prochain tour.'],
  trone:   ['Autorité',     'La prochaine attaque de la cible perd 25 % de sa force.'],
  regard:  ['Clairvoyance', 'Ne rate jamais : un 1 au d20 compte comme un 2.'],
  ombre:   ['Voile',        'La prochaine attaque reçue par le lanceur perd 30 %.'],
  reve:    ['Sommeil',      '20 % de chances que la cible passe son prochain tour.'],
  esprit:  ['Lucidité',     'Ignore la parade de la cible.'],
  tombeau: ['Murmure',      'Vole 1 essence à l\'adversaire.'],
  destin:  ['Fortune',      'Lance deux d20 et garde le meilleur.'],
};

const borner = (n, min, max) => Math.max(min, Math.min(max, n));

function valeurPuissance(p) {
  if (p === '∞') return PUISSANCE_INFINIE;
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? n : 40;
}

function creerAttaque(a, index) {
  const p = valeurPuissance(a.puissance);
  // 1re attaque : 1 essence (2 si elle est très puissante) ; 2e attaque : selon sa puissance (5 pour « ∞ »)
  const cout = index === 0
    ? (p >= 100 ? 2 : 1)
    : (p >= PUISSANCE_INFINIE ? 5 : borner(Math.round(p / 40), 1, 4));
  return {
    nom: a.nom,
    effet: a.effet ?? '',
    veine: a.veine ?? null,
    puissance: a.puissance ?? '—',
    base: Math.round(p * FACTEUR_DEGATS),
    cout,
  };
}

export function creerCombattant(carte) {
  const rarete = PV_RARETE[carte.rarity] ? carte.rarity : 'commune';
  const pvMax = PV_RARETE[rarete] + (BONUS_RANG[carte.rank] ?? 0);
  let attaques = [carte.attack_1, carte.attack_2].filter((a) => a?.nom).map(creerAttaque);
  if (!attaques.length) attaques = [creerAttaque({ nom: 'Frappe', puissance: 40 }, 0)];
  return {
    carte,
    pv: pvMax,
    pvMax,
    veine: attaques[0].veine,   // Veine « défensive » de la carte : celle de sa 1re attaque
    attaques,
    statuts: {},                // garde, voile, bouclier, sommeil, affaibli, entrave
  };
}

export function creerCamp(nom, cartes) {
  return { nom, combattants: cartes.map(creerCombattant), actif: 0, essence: 0 };
}

export const actif = (camp) => camp.combattants[camp.actif];
export const vaincu = (camp) => camp.combattants.every((c) => c.pv <= 0);

// Début du tour : +1 essence. Une carte endormie passe son tour.
export function debutTour(camp) {
  camp.essence = Math.min(ESSENCE_MAX, camp.essence + 1);
  const c = actif(camp);
  if (c.statuts.sommeil) {
    delete c.statuts.sommeil;
    return { passe: true };
  }
  return { passe: false };
}

export function peutUtiliser(camp, index) {
  const c = actif(camp);
  const att = c.attaques[index];
  if (!att) return false;
  if (index === 1 && c.statuts.entrave) return false;
  return camp.essence >= att.cout;
}

const d20 = () => 1 + Math.floor(Math.random() * 20);

function qualite(de, veine) {
  const seuilCritique = veine === 'bete' ? 18 : 20;
  if (de === 1) return ['echec', 0];
  if (de >= seuilCritique) return ['critique', 1.5];
  if (de >= 16) return ['fort', 1.25];
  if (de <= 5) return ['effleure', 0.75];
  return ['normal', 1];
}

// Résout une attaque et renvoie tout ce qu'il faut pour l'animer et la raconter
export function attaquer(campAtt, campDef, index) {
  const lanceur = actif(campAtt);
  const cible = actif(campDef);
  const att = lanceur.attaques[index];
  campAtt.essence -= att.cout;
  delete lanceur.statuts.entrave;

  let de = d20();
  if (att.veine === 'destin') de = Math.max(de, d20());
  if (att.veine === 'regard' && de === 1) de = 2;

  const [q, multQualite] = qualite(de, att.veine);
  const aff = affinite(att.veine, cible.veine);
  let mult = multQualite * aff;
  if (lanceur.statuts.affaibli) { mult *= 0.75; delete lanceur.statuts.affaibli; }

  const r = { attaque: att, de, qualite: q, affinite: aff, degats: 0, absorbe: 0, soin: 0, effet: null, ko: false };
  if (q === 'echec') return r;

  let degats = Math.round(att.base * mult);
  if (cible.statuts.garde) {
    if (att.veine !== 'esprit') degats = Math.round(degats / 2);
    delete cible.statuts.garde;
  }
  if (cible.statuts.voile) { degats = Math.round(degats * 0.7); delete cible.statuts.voile; }
  if (cible.statuts.bouclier) {
    r.absorbe = Math.min(cible.statuts.bouclier, degats);
    cible.statuts.bouclier -= r.absorbe;
    if (!cible.statuts.bouclier) delete cible.statuts.bouclier;
    degats -= r.absorbe;
  }
  cible.pv = Math.max(0, cible.pv - degats);
  r.degats = degats;
  r.ko = cible.pv === 0;

  // Effet de la Veine
  const soigner = (n) => {
    const avant = lanceur.pv;
    lanceur.pv = Math.min(lanceur.pvMax, lanceur.pv + n);
    r.soin = lanceur.pv - avant;
  };
  switch (att.veine) {
    case 'sang':    soigner(Math.round(degats * 0.3)); if (r.soin) r.effet = `récupère ${r.soin} PV`; break;
    case 'racine':  soigner(10); if (r.soin) r.effet = `récupère ${r.soin} PV`; break;
    case 'maree':   campAtt.essence = Math.min(ESSENCE_MAX, campAtt.essence + 1); r.effet = 'regagne 1 essence'; break;
    case 'forge':   lanceur.statuts.bouclier = (lanceur.statuts.bouclier ?? 0) + 15; r.effet = 'se couvre d\'un bouclier de 15'; break;
    case 'ombre':   lanceur.statuts.voile = true; r.effet = 's\'enveloppe d\'un voile d\'ombre'; break;
    case 'tombeau':
      if (campDef.essence > 0) { campDef.essence -= 1; campAtt.essence = Math.min(ESSENCE_MAX, campAtt.essence + 1); r.effet = 'vole 1 essence'; }
      break;
    case 'chaine':  if (!r.ko) { cible.statuts.entrave = true; r.effet = 'entrave la cible'; } break;
    case 'trone':   if (!r.ko) { cible.statuts.affaibli = true; r.effet = 'fait plier la cible'; } break;
    case 'reve':    if (!r.ko && Math.random() < 0.2) { cible.statuts.sommeil = true; r.effet = 'plonge la cible dans le sommeil'; } break;
    default: break;
  }
  return r;
}

// Parer : la prochaine attaque reçue est divisée par deux, et +1 essence
export function parer(camp) {
  const c = actif(camp);
  c.statuts.garde = true;
  delete c.statuts.entrave;
  camp.essence = Math.min(ESSENCE_MAX, camp.essence + 1);
}

// Après un KO : la carte suivante encore debout entre en jeu (false s'il n'en reste aucune)
export function remplacer(camp) {
  const suivant = camp.combattants.findIndex((c) => c.pv > 0);
  if (suivant < 0) return false;
  camp.actif = suivant;
  return true;
}

// IA : prend l'attaque qui fait le plus mal ; parfois pare pour garder de l'essence
export function choixIA(campIA, campJoueur) {
  const moi = actif(campIA);
  const cible = actif(campJoueur);
  const valeur = (att) => att.base * affinite(att.veine, cible.veine);

  const possibles = moi.attaques.map((att, i) => ({ i, v: valeur(att) })).filter(({ i }) => peutUtiliser(campIA, i));
  if (!possibles.length) return 'parer';

  // Coup de grâce possible avec l'attaque la moins chère : on le prend
  const achevable = possibles.find(({ v }) => v >= cible.pv);
  if (achevable) return achevable.i;

  // La 2e attaque sera prête au prochain tour : on pare une fois sur trois pour l'attendre
  const grosse = moi.attaques[1];
  if (grosse && !peutUtiliser(campIA, 1) && campIA.essence + 2 >= grosse.cout && Math.random() < 0.35) return 'parer';

  return possibles.sort((a, b) => b.v - a.v)[0].i;
}

// Nom et icône d'une Veine (pour l'affichage)
export const veine = (v) => VEINES[v] ?? ['Sans Veine', '✦'];
