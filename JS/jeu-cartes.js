// =====================================================================
//  Duel des Veines — page jeu-cartes.html
//  - Solo   : 3 cartes du catalogue contre l'IA « l'Ombre du Codex »
//  - En ligne : 3 cartes de son grimoire contre un ami, dans un salon
//    (connexion Discord obligatoire, voir JS/jeu-cartes-ligne.js)
//  Règles : JS/jeu-cartes-moteur.js — Affichage : JS/jeu-cartes-arene.js
// =====================================================================
import { supabase, getMonJoueur, connexionDiscord } from './supabase.js';
import { $, esc, notifier } from './commun.js';
import { htmlCarte, chargerDeck } from './cartes.js';
import {
  TAILLE_MAIN, ROUE, creerCamp, debutTour, peutUtiliser,
  attaquer, parer, remplacer, choixIA, veine,
} from './jeu-cartes-moteur.js';
import { vue, preparerVue, animerEvenement, afficherFin, pause } from './jeu-cartes-arene.js';
import { ouvrirSalon, nouveauCode, codeValide, TAILLE_SALON } from './jeu-cartes-ligne.js';

const NOM_ADVERSAIRE = "L'Ombre du Codex";
const CLE_SALON_EN_ATTENTE = 'duel-salon';   // salon à rejoindre après la connexion Discord

let mode = 'solo';
let moi = null;              // ligne "players" du joueur connecté (ou null)
let deckIds = [];            // cartes du deck du profil, présélectionnées
let catalogue = [];          // cartes jouables en solo
let collection = null;       // cartes du grimoire (en ligne), chargées à la demande
let selection = [];          // ids choisis, dans l'ordre
let partie = null;           // duel en cours (solo ou hôte) : { etat, fini }
let salon = null;            // salon en ligne ouvert
let fileAnimations = Promise.resolve();   // en ligne : chaque écran joue les événements un par un, à son rythme

// Seulement les vraies cartes illustrées (pas la carte d'exemple)
const jouable = (c) => c?.image && c.description !== "Carte d'exemple";
const reserveCartes = () => (mode === 'solo' ? catalogue : (collection ?? []));
const requis = () => Math.min(TAILLE_MAIN, reserveCartes().length);


// ---------------------------------------------------------------------
//  Démarrage
// ---------------------------------------------------------------------
async function init() {
  $('roue').innerHTML = ROUE.map((v) => `<span title="${esc(veine(v)[0])}">${veine(v)[1]}</span>`).join('<i>›</i>') + '<i>›</i>' + `<span>${veine(ROUE[0])[1]}</span>`;

  const [{ data, error }, joueur] = await Promise.all([
    supabase.from('cards').select('*').eq('is_available', true).order('id'),
    getMonJoueur().catch(() => null),
  ]);
  if (error) {
    $('choix-cartes').innerHTML = '<p class="vide">Impossible de charger les cartes.</p>';
    return;
  }
  catalogue = (data ?? []).filter(jouable);
  moi = joueur;

  if (moi) {
    const deck = await chargerDeck(moi.discord_id).catch(() => null);
    deckIds = (deck?.ids ?? []).filter((id) => id != null);
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
    await changerMode('solo');
  }
}


// ---------------------------------------------------------------------
//  Mode de jeu
// ---------------------------------------------------------------------
async function changerMode(nouveau) {
  mode = nouveau;
  document.querySelectorAll('.mode').forEach((b) => {
    const actif = b.dataset.mode === mode;
    b.classList.toggle('est-actif', actif);
    b.setAttribute('aria-selected', actif);
  });
  $('panneau-ligne').hidden = mode !== 'ligne';

  if (mode === 'ligne' && moi && !collection) {
    // Le grimoire : lisible seulement par son propriétaire (RLS de player_cards)
    const { data } = await supabase.from('player_cards').select('card:cards(*)').eq('discord_id', moi.discord_id);
    collection = (data ?? []).map((l) => l.card).filter(jouable).sort((a, b) => a.id - b.id);
  }

  // Le deck du profil est présélectionné, s'il fait partie des cartes disponibles
  const ids = new Set(reserveCartes().map((c) => c.id));
  selection = deckIds.filter((id) => ids.has(id)).slice(0, TAILLE_MAIN);

  majPanneauLigne();
  afficherChoix();
}

document.querySelector('.modes').addEventListener('click', (e) => {
  const bouton = e.target.closest('.mode');
  if (!bouton || bouton.dataset.mode === mode) return;
  if (salon) return notifier('Quitte d\'abord le salon pour jouer en solo.', 'erreur');
  changerMode(bouton.dataset.mode);
});


// ---------------------------------------------------------------------
//  Choix des cartes (catalogue en solo, grimoire en ligne)
// ---------------------------------------------------------------------
function afficherChoix() {
  const enLigne = mode === 'ligne';
  const section = $('section-choix');
  section.hidden = enLigne && !salon;
  if (section.hidden) return;

  const pret = enLigne && salon?.presence.pret;
  $('choix-titre').textContent = enLigne ? 'Choisis tes cartes' : 'Compose ta main';
  $('choix-aide').textContent = enLigne
    ? 'Seulement les cartes de ton grimoire. La première choisie ouvrira le duel.'
    : 'Touche trois cartes : la première choisie ouvrira le duel.';

  const zone = $('choix-cartes');
  const cartes = reserveCartes();
  if (!cartes.length) {
    zone.innerHTML = enLigne
      ? '<p class="vide">Ton grimoire est vide : il te faut au moins une carte pour défier un ami. Les cartes s\'obtiennent à la boutique, lors d\'événements ou en récompense.</p>'
      : '<p class="vide">Aucune carte n\'est encore en circulation.</p>';
  } else {
    zone.innerHTML = cartes.map((c) => {
      const rang = selection.indexOf(c.id);
      return `
        <div role="button" tabindex="0" class="choix__carte${rang >= 0 ? ' est-choisie' : ''}" data-id="${c.id}"
          aria-pressed="${rang >= 0}" aria-label="${esc(c.name)}">
          ${htmlCarte(c)}
          ${rang >= 0 ? `<span class="choix__ordre">${rang + 1}</span>` : ''}
          <span class="choix__stats">${statsCourtes(c)}</span>
        </div>`;
    }).join('');
  }
  zone.classList.toggle('choix__cartes--verrouille', !!pret);

  $('choix-compte').textContent = `${selection.length} / ${requis() || TAILLE_MAIN}`;
  const complet = requis() > 0 && selection.length === requis();
  const bouton = $('btn-duel');
  if (enLigne) {
    bouton.textContent = pret ? 'Je ne suis plus prêt' : 'Je suis prêt';
    bouton.disabled = !pret && !complet;
  } else {
    bouton.textContent = 'Engager le duel';
    bouton.disabled = !complet;
  }
}

function statsCourtes(carte) {
  const c = creerCamp('', [carte]).combattants[0];
  const icones = [...new Set(c.attaques.map((a) => veine(a.veine)[1]))].join(' ');
  return `${icones} · ${c.pvMax} PV`;
}

function basculerChoix(bouton, auClavier = false) {
  if (mode === 'ligne' && salon?.presence.pret) return;   // déjà prêt : choix figé
  const id = Number(bouton.dataset.id);
  const i = selection.indexOf(id);
  if (i >= 0) selection.splice(i, 1);
  else if (selection.length < TAILLE_MAIN) selection.push(id);
  else { selection.shift(); selection.push(id); }   // main pleine : la plus ancienne laisse sa place
  afficherChoix();
  if (auClavier) $('choix-cartes').querySelector(`[data-id="${id}"]`)?.focus();
}

$('choix-cartes').addEventListener('click', (e) => {
  const bouton = e.target.closest('.choix__carte');
  if (bouton) basculerChoix(bouton);
});
$('choix-cartes').addEventListener('keydown', (e) => {
  const bouton = e.target.closest('.choix__carte');
  if (!bouton || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  basculerChoix(bouton, true);
});

$('btn-duel').addEventListener('click', () => {
  if (mode === 'solo') return commencerSolo();
  basculerPret();
});

function retourAuChoix() {
  partie = null;
  vue.surChoix = null;
  $('fin').hidden = true;
  $('ecran-duel').hidden = true;
  $('ecran-choix').hidden = false;
  afficherChoix();
}


// ---------------------------------------------------------------------
//  Déroulé d'un duel (solo, ou en ligne chez l'hôte)
//  emettre(ev) : joue l'événement ici (et l'envoie à l'invité en ligne)
//  choixDe(qui) : attend l'action du camp qui joue
// ---------------------------------------------------------------------
async function deroulerDuel(etat, premier, { emettre, choixDe }) {
  const p = { etat, fini: false };
  partie = p;
  const copie = () => structuredClone(p.etat);
  const [a, b] = Object.keys(etat);
  const autreDe = (qui) => (qui === a ? b : a);

  await emettre({ type: 'debut', etat: copie(), premier });
  let qui = premier;
  while (!p.fini && partie === p) {
    const camp = etat[qui];
    const adverse = etat[autreDe(qui)];

    const { passe } = debutTour(camp);
    await emettre({ type: 'tour', qui, passe, etat: copie() });
    if (!passe) {
      let choix = await choixDe(qui, camp, adverse);
      if (partie !== p) return;   // duel abandonné pendant l'attente
      if (choix !== 'parer' && !peutUtiliser(camp, Number(choix))) choix = 'parer';

      if (choix === 'parer') {
        parer(camp);
        await emettre({ type: 'parer', qui, etat: copie() });
      } else {
        const r = attaquer(camp, adverse, Number(choix));
        await emettre({ type: 'attaque', qui, r, etat: copie() });
        if (r.ko) {
          if (!remplacer(adverse)) {
            p.fini = true;
            await emettre({ type: 'fin', gagnant: qui });
            return;
          }
          await emettre({ type: 'entree', qui: autreDe(qui), etat: copie() });
        }
      }
    }
    qui = autreDe(qui);
  }
}

// Le joueur de ce navigateur clique sur une action
const attendreClic = () => new Promise((r) => {
  vue.surChoix = (choix) => { vue.surChoix = null; r(choix); };
});


// ---------------------------------------------------------------------
//  Solo
// ---------------------------------------------------------------------
function tirerAdversaire() {
  const pioche = [...catalogue].sort(() => Math.random() - 0.5);
  // Peu de cartes en circulation : l'Ombre peut aussi jouer les mêmes cartes que toi
  return Array.from({ length: TAILLE_MAIN }, (_, i) => pioche[i % pioche.length]);
}

function commencerSolo() {
  const mesCartes = selection.map((id) => catalogue.find((c) => c.id === id));
  preparerVue('joueur', 'adverse');
  reglerFin('solo');
  const etat = { joueur: creerCamp('Toi', mesCartes), adverse: creerCamp(NOM_ADVERSAIRE, tirerAdversaire()) };
  deroulerDuel(etat, Math.random() < 0.5 ? 'joueur' : 'adverse', {
    emettre: animerEvenement,
    choixDe: async (qui, camp, adverse) => {
      if (qui === 'joueur') return attendreClic();
      await pause(1000);
      return choixIA(camp, adverse);
    },
  });
}


// ---------------------------------------------------------------------
//  En ligne : salon
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

function entrerSalon(code, role) {
  salon = ouvrirSalon(code, {
    discord_id: moi.discord_id,
    nom: moi.username ?? 'Aventurier',
    avatar: moi.avatar_url ?? null,
    role,
  }, {
    surPresence,
    surMessage,
    surErreur: (texte) => { $('salon-etat').textContent = texte; },
  });
  salon.role = role;
  salon.adversaire = null;

  // Le lien de la page devient le lien d'invitation (?salon=CODE)
  history.replaceState(null, '', `${location.pathname}?salon=${code}`);
  $('salon-code').textContent = code;
  $('salon-etat').textContent = 'Connexion au salon…';
  majPanneauLigne();
  afficherChoix();
  afficherJoueurs([]);
}

async function quitterSalon() {
  if (!salon) return;
  const s = salon;
  salon = null;
  partie = null;
  vue.surChoix = null;
  sessionStorage.removeItem(`duel-hote-${s.code}`);
  history.replaceState(null, '', location.pathname);
  await s.fermer();
  retourAuChoix();
  majPanneauLigne();
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

async function basculerPret() {
  if (!salon) return;
  const pret = !salon.presence.pret;
  await salon.annoncer({ pret, cartes: pret ? [...selection] : [] });
  afficherChoix();
  surPresence(salon.liste());
}

function surPresence(liste) {
  if (!salon) return;
  // Salon de deux : les deux premiers arrivés jouent, les suivants repartent
  const dedans = liste.slice(0, TAILLE_SALON);
  if (liste.length > TAILLE_SALON && !dedans.some((p) => p.cle === salon.cle)) {
    notifier('Ce salon est complet.', 'erreur');
    quitterSalon();
    return;
  }

  const moiDansSalon = dedans.find((p) => p.cle === salon.cle);
  const adversaire = dedans.find((p) => p.cle !== salon.cle) ?? null;
  const avant = salon.adversaire;
  salon.adversaire = adversaire;
  afficherJoueurs(dedans);

  const etat = $('salon-etat');
  if (!moiDansSalon) etat.textContent = 'Connexion au salon…';
  else if (adversaire && adversaire.role === salon.role) etat.textContent = salon.role === 'invite'
    ? 'L\'hôte a quitté ce salon : l\'un de vous doit en créer un nouveau.'
    : 'Ce salon a deux hôtes (onglet dupliqué ?) : créez un nouveau salon.';
  else if (!adversaire) etat.textContent = salon.role === 'hote'
    ? 'En attente de ton adversaire… Copie le lien du salon et envoie-le-lui.'
    : 'L\'hôte n\'est pas (ou plus) dans ce salon. Attends-le, ou crée ton propre salon.';
  else if (!salon.presence.pret) etat.textContent = 'Choisis tes cartes, puis déclare-toi prêt.';
  else if (!adversaire.pret) etat.textContent = `En attente de ${adversaire.nom}…`;
  else etat.textContent = 'Le duel commence !';

  // L'adversaire a quitté le salon en plein duel
  if (avant && !adversaire && !$('ecran-duel').hidden && $('fin').hidden) {
    partie = null;
    vue.surChoix = null;
    $('fin-sur').textContent = 'Duel interrompu';
    $('fin-titre').textContent = 'Abandon';
    $('fin-texte').textContent = `${avant.nom} a quitté le duel.`;
    reglerFin('ligne');
    afficherFin('abandon');
    return;
  }

  // L'hôte lance le duel quand les deux joueurs sont prêts
  if (salon.role === 'hote' && !partie && salon.presence.pret && adversaire?.pret && adversaire.role === 'invite') {
    commencerEnLigne(adversaire);
  }
}

function afficherJoueurs(dedans) {
  const places = [0, 1].map((i) => dedans[i] ?? null);
  $('salon-joueurs').innerHTML = places.map((p) => {
    if (!p) return `
      <div class="salon__joueur salon__joueur--vide">
        <span class="salon__avatar" aria-hidden="true">?</span>
        <span class="salon__nom">En attente d'un adversaire…</span>
      </div>`;
    const c = p.cle === salon.cle;
    return `
      <div class="salon__joueur${p.pret ? ' est-pret' : ''}">
        ${p.avatar ? `<img class="salon__avatar" src="${esc(p.avatar)}" alt="">` : '<span class="salon__avatar" aria-hidden="true">✦</span>'}
        <span class="salon__nom">${esc(p.nom)}${c ? ' <small>(toi)</small>' : ''}</span>
        <span class="salon__role">${p.role === 'hote' ? 'Hôte' : 'Invité'}</span>
        <span class="salon__pret">${p.pret ? 'Prêt' : 'Choisit ses cartes…'}</span>
      </div>`;
  }).join('');
}

// --- Hôte : fait tourner le duel et envoie chaque événement à l'invité ---
async function commencerEnLigne(adversaire) {
  partie = { fini: false };   // réserve la place tout de suite (pas de double lancement)
  const mesCartes = salon.presence.cartes.map((id) => collection.find((c) => c.id === id)).filter(Boolean);

  // Les statistiques des cartes de l'invité sont relues dans le catalogue public
  const { data } = await supabase.from('cards').select('*').in('id', adversaire.cartes);
  const sesCartes = adversaire.cartes.map((id) => (data ?? []).find((c) => c.id === id)).filter(Boolean);
  if (!mesCartes.length || !sesCartes.length) {
    partie = null;
    return notifier('Impossible de lancer le duel : cartes introuvables.', 'erreur');
  }

  await salon.annoncer({ pret: false });
  preparerVue('hote', 'invite');
  reglerFin('ligne');

  // Chaque événement porte l'identifiant du duel (pid) et un numéro (n) :
  // l'invité repère un message perdu et le redemande (voir surMessage et veilleInvite)
  const s = salon;
  const duel = { pid: crypto.randomUUID(), n: 0, historique: [], attente: null };
  s.duelHote = duel;

  const etat = { hote: creerCamp(s.presence.nom, mesCartes), invite: creerCamp(adversaire.nom, sesCartes) };
  // Les règles avancent sans attendre les animations : si l'onglet de l'hôte passe
  // en arrière-plan, le duel continue pour l'invité
  deroulerDuel(etat, Math.random() < 0.5 ? 'hote' : 'invite', {
    emettre: (ev) => {
      ev.pid = duel.pid;
      ev.n = ++duel.n;
      duel.historique.push(ev);
      if (salon === s) s.envoyer('jeu', ev);
      jouerEnFile(ev);
    },
    // L'action de l'invité doit répondre au dernier événement envoyé (son « tour »)
    choixDe: (qui) => (qui === 'hote'
      ? attendreClic()
      : new Promise((r) => { duel.attente = { n: duel.n, r }; })),
  });
}

// --- Messages reçus ---
// Invité : où il en est du duel de l'hôte
const invite = { pid: null, dernier: 0, activite: 0, choixEnvoye: null };

function surMessage(evenement, contenu) {
  if (!salon) return;

  if (salon.role === 'hote') {
    const duel = salon.duelHote;
    if (!duel || contenu.pid !== duel.pid) return;
    // Action de l'invité : acceptée une seule fois, et seulement pour le tour attendu
    if (evenement === 'choix' && duel.attente?.n === contenu.n) {
      const { r } = duel.attente;
      duel.attente = null;
      r(contenu.action);
    }
    // L'invité a manqué des messages : on les renvoie dans l'ordre
    if (evenement === 'renvoi') {
      duel.historique.filter((ev) => ev.n >= contenu.depuis).forEach((ev) => salon.envoyer('jeu', ev));
    }
    return;
  }

  if (evenement !== 'jeu') return;
  // L'invité rejoue les événements de l'hôte, dans l'ordre, sans trou ni doublon.
  // Nouveau duel (même si son tout premier message s'est perdu) : on repart de zéro
  if (contenu.pid !== invite.pid) Object.assign(invite, { pid: contenu.pid, dernier: 0, choixEnvoye: null });
  if (contenu.n <= invite.dernier) return;   // déjà reçu
  if (contenu.n > invite.dernier + 1) {
    // Il manque un message : on redemande tout depuis le trou
    salon.envoyer('renvoi', { depuis: invite.dernier + 1, pid: invite.pid });
    return;
  }
  if (contenu.type === 'debut') {
    preparerVue('invite', 'hote');
    reglerFin('ligne');
    vue.surChoix = (choix) => {
      invite.choixEnvoye = { action: choix, n: invite.dernier };
      invite.activite = Date.now();
      salon?.envoyer('choix', { action: choix, n: invite.dernier, pid: invite.pid });
    };
    salon.annoncer({ pret: false });
  }
  invite.dernier = contenu.n;
  invite.activite = Date.now();
  if (invite.choixEnvoye && contenu.n > invite.choixEnvoye.n) invite.choixEnvoye = null;   // l'hôte a bien reçu le coup
  jouerEnFile(contenu);
}

// Veille de l'invité : si rien ne bouge depuis un moment alors que ce n'est pas à lui
// de jouer (connexion coupée un instant, message perdu…), il relance l'hôte
const SILENCE_MAX = 5000;
setInterval(() => {
  if (!salon || salon.role !== 'invite' || !invite.pid) return;
  if ($('ecran-duel').hidden || !$('fin').hidden) return;                    // pas de duel en cours
  if (document.querySelector('#actions .action:not(:disabled)')) return;     // c'est à lui de jouer
  if (Date.now() - invite.activite < SILENCE_MAX) return;
  invite.activite = Date.now();
  if (invite.choixEnvoye) salon.envoyer('choix', { ...invite.choixEnvoye, pid: invite.pid });
  salon.envoyer('renvoi', { depuis: invite.dernier + 1, pid: invite.pid });
}, 1000);

function jouerEnFile(ev) {
  fileAnimations = fileAnimations
    .then(() => animerEvenement(ev))
    .catch(console.error)
    .finally(() => { invite.activite = Date.now(); });
}


// ---------------------------------------------------------------------
//  Fin du duel : les boutons dépendent du mode
// ---------------------------------------------------------------------
function reglerFin(m) {
  $('btn-rejouer').textContent = m === 'solo' ? 'Rejouer' : 'Revanche';
  $('btn-changer').textContent = m === 'solo' ? 'Changer de main' : 'Quitter le salon';
}

$('btn-rejouer').addEventListener('click', () => {
  if (mode === 'solo') return commencerSolo();
  retourAuChoix();   // revanche : retour au salon, on se redéclare prêt
  surPresence(salon?.liste() ?? []);
});
$('btn-changer').addEventListener('click', () => {
  if (mode === 'solo') return retourAuChoix();
  quitterSalon();
});

init();
