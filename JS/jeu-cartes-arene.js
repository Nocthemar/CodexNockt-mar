// =====================================================================
//  Duel des Veines — affichage de l'arène (plateau, d20, chronique)
//  Tout passe par des « événements » (debut, tour, parer, attaque, entree,
//  fin) qui portent une copie de l'état du duel. En solo, ils viennent de
//  cette page ; en ligne, de l'hôte du salon : les deux écrans jouent
//  exactement la même animation.
//  Ce navigateur se voit toujours en bas (côté « joueur »).
// =====================================================================
import { $, esc } from './commun.js';
import { htmlCarte, ouvrirApercu } from './cartes.js';
import { ESSENCE_MAX, EFFETS, affinite, actif, peutUtiliser, veine } from './jeu-cartes-moteur.js';

export const lent = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Onglet caché : pas d'animation (le navigateur y ralentit les minuteries), le duel
// se rattrape d'un coup et l'écran est à jour quand on revient
export const pause = (ms) => (document.hidden
  ? Promise.resolve()
  : new Promise((r) => setTimeout(r, lent ? ms : Math.min(ms, 150))));

// Ce qu'affiche ce navigateur :
//   moi / autre : clés des deux camps dans l'état (« joueur »/« adverse » en solo,
//                 « hote »/« invite » en ligne)
//   joueur / adverse : les deux camps, vus d'ici (en bas / en haut)
//   surChoix : appelé quand on clique sur une attaque ou sur Parer
//   surFin   : appelé à la fin du duel, avec true en cas de victoire
export const vue = {
  moi: 'joueur', autre: 'adverse',
  joueur: null, adverse: null,
  surChoix: null, surFin: null,
};

export function preparerVue(moi, autre) {
  Object.assign(vue, { moi, autre, joueur: null, adverse: null });
}

const cote = (qui) => (qui === vue.moi ? 'joueur' : 'adverse');
function appliquer(etat) {
  vue.joueur = etat[vue.moi];
  vue.adverse = etat[vue.autre];
}


// ---------------------------------------------------------------------
//  Lecture d'un événement
// ---------------------------------------------------------------------
export async function animerEvenement(ev) {
  switch (ev.type) {
    case 'debut': {
      appliquer(ev.etat);
      $('ecran-choix').hidden = true;
      $('fin').hidden = true;
      $('ecran-duel').hidden = false;
      $('journal').innerHTML = '';
      $('de-resultat').textContent = '';
      $('tour').textContent = '';
      afficherCamp('joueur', true);
      afficherCamp('adverse', true);
      afficherActions(false);
      window.scrollTo({ top: 0, behavior: lent ? 'smooth' : 'auto' });
      raconter(`${esc(actif(vue.joueur).carte.name)} et ${esc(actif(vue.adverse).carte.name)} entrent dans l'arène.`, 'grand');
      await pause(700);
      raconter(ev.premier === vue.moi ? 'Le sort te désigne pour ouvrir le duel.' : `Le sort désigne ${esc(vue.adverse.nom)} pour ouvrir le duel.`);
      await pause(600);
      return;
    }

    case 'tour': {
      appliquer(ev.etat);
      const c = cote(ev.qui);
      afficherTour(c === 'joueur' ? 'À toi de jouer' : `Tour de ${vue.adverse.nom}`, c);
      majCamp(c);
      if (ev.passe) {
        afficherActions(false);
        raconter(`${esc(actif(vue[c]).carte.name)} est perdu dans un sommeil sans rêve et passe son tour.`);
        await pause(1100);
        return;
      }
      afficherActions(c === 'joueur');
      return;
    }

    case 'parer': {
      appliquer(ev.etat);
      const c = cote(ev.qui);
      afficherActions(false);
      afficherTour(c === 'joueur' ? 'Tu te mets en garde' : `${vue.adverse.nom} se met en garde`, c);
      raconter(`${esc(actif(vue[c]).carte.name)} se met en garde et rassemble son essence.`);
      animer(c, 'combattant--garde', 700);
      majCamp(c);
      await pause(900);
      return;
    }

    case 'attaque': return animerAttaque(ev);

    case 'entree': {
      appliquer(ev.etat);
      const c = cote(ev.qui);
      afficherCamp(c, true);
      raconter(`${esc(actif(vue[c]).carte.name)} entre dans l'arène.`, 'grand');
      await pause(800);
      return;
    }

    case 'fin': return terminer(ev.gagnant === vue.moi);

    default: return;
  }
}

// Libellé à gauche du d20 : à qui le tour, ou ce qui est en train de se passer
function afficherTour(texte, c) {
  $('tour').textContent = texte;
  $('tour').classList.toggle('arene__tour--adverse', c !== 'joueur');
}

async function animerAttaque({ qui, r, etat }) {
  const c = cote(qui);
  const cCible = c === 'joueur' ? 'adverse' : 'joueur';
  afficherActions(false);
  afficherTour(c === 'joueur' ? 'Ton attaque' : `Attaque de ${vue.adverse.nom}`, c);

  // D'abord l'essence dépensée, puis le d20, puis les dégâts
  vue[c].essence = etat[qui].essence;
  majCamp(c);
  await lancerDe(r.de, r.qualite);
  animer(c, `combattant--elan-${c}`, 500);
  await pause(260);

  appliquer(etat);
  const lanceur = actif(vue[c]);
  const cible = actif(vue[cCible]);
  const [nomVeine, icone] = veine(r.attaque.veine);
  let phrase = `${esc(lanceur.carte.name)} lance <em>${icone} ${esc(r.attaque.nom)}</em>`;

  if (r.qualite === 'echec') {
    majCamp(c);
    raconter(`${phrase}… et manque sa cible.`, 'echec');
    flotter(cCible, 'Raté', 'rate');
    await pause(900);
    return;
  }

  animer(cCible, 'combattant--touche', 500);
  flotter(cCible, `−${r.degats}`, r.qualite === 'critique' ? 'critique' : '');
  if (r.soin) setTimeout(() => flotter(c, `+${r.soin}`, 'soin'), 300);
  majCamp(c);
  majCamp(cCible);

  const notes = [];
  if (r.qualite === 'critique') notes.push('coup critique !');
  if (r.affinite > 1) notes.push(`la ${esc(nomVeine)} domine`);
  if (r.affinite < 1) notes.push('peu efficace');
  if (r.absorbe) notes.push(`${r.absorbe} absorbés par le bouclier`);
  phrase += ` : <strong>${r.degats} dégâts</strong>${notes.length ? ` (${notes.join(', ')})` : ''}.`;
  if (r.effet) phrase += ` ${esc(lanceur.carte.name)} ${r.effet}.`;
  raconter(phrase, r.qualite === 'critique' ? 'critique' : '');
  await pause(1000);

  if (r.ko) {
    raconter(`${esc(cible.carte.name)} s'effondre.`, 'ko');
    animer(cCible, 'combattant--ko', 900);
    await pause(950);
  }
}


// ---------------------------------------------------------------------
//  Plateau
// ---------------------------------------------------------------------
function afficherCamp(c, entree = false) {
  const camp = vue[c];
  const combattant = actif(camp);
  // Une rangée : réserve | carte en jeu | panneau (camp, carte, PV, essence)
  $(`camp-${c}`).innerHTML = `
    <div class="reserve" data-reserve></div>
    <div class="combattant${entree ? ' combattant--entree' : ''}" data-combattant>
      ${htmlCarte(combattant.carte)}
      <div class="combattant__statuts" data-statuts></div>
    </div>
    <div class="camp__infos">
      <span class="camp__nom">${esc(camp.nom)}${c === 'joueur' && camp.nom !== 'Toi' ? ' <small>(toi)</small>' : ''}</span>
      <h3 class="camp__carte">${esc(combattant.carte.name)}</h3>
      <div class="pv">
        <div class="pv__barre"><span data-pv-barre></span></div>
        <span class="pv__texte" data-pv-texte></span>
      </div>
      <span class="essence" data-essence></span>
    </div>`;
  majCamp(c);
}

function majCamp(c) {
  const camp = vue[c];
  const combattant = actif(camp);
  const zone = $(`camp-${c}`);

  const essence = zone.querySelector('[data-essence]');
  essence.innerHTML = Array.from({ length: ESSENCE_MAX }, (_, i) => `<i class="${i < camp.essence ? 'plein' : ''}"></i>`).join('');
  essence.title = `Essence : ${camp.essence} / ${ESSENCE_MAX}`;
  essence.setAttribute('aria-label', essence.title);

  const ratio = combattant.pv / combattant.pvMax;
  const barre = zone.querySelector('[data-pv-barre]');
  barre.style.width = `${ratio * 100}%`;
  barre.parentElement.classList.toggle('pv__barre--bas', ratio <= 0.3);
  zone.querySelector('[data-pv-texte]').textContent = `${combattant.pv} / ${combattant.pvMax} PV`;

  const s = combattant.statuts;
  const statuts = [];
  if (s.garde)    statuts.push(['🛡️', 'En garde : la prochaine attaque reçue est divisée par deux']);
  if (s.bouclier) statuts.push(['⚒️', `Bouclier : ${s.bouclier}`]);
  if (s.voile)    statuts.push(['🌑', 'Voile d\'ombre : la prochaine attaque reçue perd 30 %']);
  if (s.sommeil)  statuts.push(['🌙', 'Endormi : passera son prochain tour']);
  if (s.affaibli) statuts.push(['👑', 'Soumis : sa prochaine attaque perd 25 %']);
  if (s.entrave)  statuts.push(['⛓️', 'Entravé : 2e attaque impossible au prochain tour']);
  zone.querySelector('[data-statuts]').innerHTML = statuts.map(([i, t]) => `<span title="${esc(t)}">${i}</span>`).join('');

  zone.querySelector('[data-reserve]').innerHTML = camp.combattants.map((x, i) => `
    <div class="reserve__carte${i === camp.actif ? ' est-active' : ''}${x.pv <= 0 ? ' est-ko' : ''}"
      title="${esc(x.carte.name)} — ${x.pv} / ${x.pvMax} PV">
      ${htmlCarte(x.carte)}
    </div>`).join('');
}

export function afficherActions(actives = false) {
  if (!vue.joueur || !vue.adverse) return;
  const camp = vue.joueur;
  const c = actif(camp);
  const cible = actif(vue.adverse);

  const boutons = c.attaques.map((att, i) => {
    const [nomVeine, icone] = veine(att.veine);
    const [nomEffet, texteEffet] = EFFETS[att.veine] ?? [];
    const aff = affinite(att.veine, cible.veine);
    const bloquee = c.statuts.entrave && i === 1;
    const possible = actives && peutUtiliser(camp, i);
    const info = [att.effet, nomEffet ? `${nomEffet} (${nomVeine}) : ${texteEffet}` : '', bloquee ? 'Entravée ce tour-ci.' : ''].filter(Boolean).join('\n');
    return `
      <button type="button" class="action" data-action="${i}" ${possible ? '' : 'disabled'} title="${esc(info)}">
        <span class="action__icone">${icone}</span>
        <span class="action__texte">
          <span class="action__nom">${esc(att.nom)}</span>
          <span class="action__detail">
            ≈ ${att.base} dégâts
            ${aff > 1 ? '<span class="action__aff action__aff--fort">Domine</span>' : ''}
            ${aff < 1 ? '<span class="action__aff action__aff--faible">Faible</span>' : ''}
            ${nomEffet ? `· ${esc(nomEffet)}` : ''}
          </span>
        </span>
        <span class="action__cout" aria-label="Coût : ${att.cout} essence">${'<i></i>'.repeat(att.cout)}</span>
      </button>`;
  }).join('');

  $('actions').innerHTML = `${boutons}
    <button type="button" class="action action--parer" data-action="parer" ${actives ? '' : 'disabled'}
      title="Divise par deux la prochaine attaque reçue et rapporte 1 essence de plus.">
      <span class="action__icone">🛡️</span>
      <span class="action__texte">
        <span class="action__nom">Parer</span>
        <span class="action__detail">Garde · +1 essence</span>
      </span>
    </button>`;
  $('actions').classList.toggle('actions--attente', !actives);
}

// Bouton d'attaque ou de parade
$('actions').addEventListener('click', (e) => {
  const bouton = e.target.closest('[data-action]');
  if (!bouton || bouton.disabled || !vue.surChoix) return;
  const choix = bouton.dataset.action === 'parer' ? 'parer' : Number(bouton.dataset.action);
  afficherActions(false);
  // Dit tout de suite que le coup est parti (en ligne, la réponse de l'hôte prend un instant)
  afficherTour(choix === 'parer' ? 'Tu te mets en garde…' : 'Ton coup part…', 'joueur');
  vue.surChoix(choix);
});

// Loupe sur n'importe quelle carte de l'arène
$('ecran-duel').addEventListener('click', (e) => {
  const el = e.target.closest('.carte-jeu');
  if (!el || !vue.joueur) return;
  const id = Number(el.dataset.carte);
  const carte = [...vue.joueur.combattants, ...vue.adverse.combattants].find((x) => x.carte.id === id)?.carte;
  ouvrirApercu(carte);
});


// ---------------------------------------------------------------------
//  d20, animations, chronique
// ---------------------------------------------------------------------
async function lancerDe(valeur, q) {
  const de = $('de');
  const face = $('de-face');
  const resultat = $('de-resultat');
  de.className = 'de de--roule';
  resultat.textContent = '';
  for (let i = 0; i < (lent ? 10 : 1); i++) {
    face.textContent = 1 + Math.floor(Math.random() * 20);
    await pause(55);
  }
  face.textContent = valeur;
  de.className = `de de--${q}`;
  resultat.textContent = { echec: 'Échec', effleure: 'Coup effleuré', normal: 'Touché', fort: 'Coup puissant', critique: 'Critique !' }[q];
  resultat.className = `de__resultat de__resultat--${q}`;
  await pause(350);
}

function animer(c, classe, duree) {
  const el = $(`camp-${c}`).querySelector('[data-combattant]');
  if (!el) return;
  el.classList.remove(classe);
  void el.offsetWidth;   // relance l'animation si la classe était déjà là
  el.classList.add(classe);
  setTimeout(() => el.classList.remove(classe), duree);
}

function flotter(c, texte, type) {
  const el = $(`camp-${c}`).querySelector('[data-combattant]');
  if (!el) return;
  const n = document.createElement('span');
  n.className = `flottant${type ? ` flottant--${type}` : ''}`;
  n.textContent = texte;
  el.appendChild(n);
  setTimeout(() => n.remove(), 1400);
}

export function raconter(html, type = '') {
  const li = document.createElement('li');
  if (type) li.className = `journal--${type}`;
  li.innerHTML = html;
  const journal = $('journal');
  journal.prepend(li);
  while (journal.children.length > 40) journal.lastElementChild.remove();
}


// ---------------------------------------------------------------------
//  Fin du duel (les boutons sont réglés par la page selon le mode)
// ---------------------------------------------------------------------
function terminer(victoire) {
  afficherActions(false);
  $('tour').textContent = victoire ? 'Victoire' : 'Défaite';
  const gagnant = victoire ? vue.joueur : vue.adverse;
  const survivants = gagnant.combattants.filter((c) => c.pv > 0).length;
  const cartes = `${survivants} carte${survivants > 1 ? 's' : ''} encore debout`;

  $('fin-sur').textContent = victoire ? 'Le Codex retiendra ton nom' : `${vue.adverse.nom} l'emporte`;
  $('fin-titre').textContent = victoire ? 'Victoire' : 'Défaite';
  $('fin-texte').textContent = victoire
    ? `Tu remportes le duel avec ${cartes}.`
    : `${vue.adverse.nom} triomphe avec ${cartes}. Change de main, ou tente à nouveau le destin.`;
  afficherFin(victoire ? 'victoire' : 'defaite');
  vue.surFin?.(victoire);
}

export function afficherFin(type) {
  $('fin').className = `fin fin--${type}`;
  $('fin').hidden = false;
  $('btn-rejouer').focus();
}
