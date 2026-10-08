// =====================================================================
//  Panneau MJ
//  Toutes les modifications passent par des fonctions SQL "mj_..." qui
//  vérifient côté serveur que la personne connectée est MJ.
//  Cacher cette page ne suffirait pas : c'est la base qui protège.
// =====================================================================
import { supabase, getMonJoueur, SITE_ROOT } from './supabase.js';
import { $, esc, LIBELLES as LIBELLES_COMMUNS, SOURCES, notifier } from './commun.js';

const LIBELLES = { ...LIBELLES_COMMUNS, rp: 'Objet RP' };
const BOUTIQUES = { daily: 'Du marchand', fun: 'Profil' };

const dateCourte = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

let moi = null;
let joueurs = [];      // [{ discord_id, username, avatar_url, is_mj, solde }]
let items = [];        // catalogue complet
let selection = null;  // discord_id du joueur ouvert
let ongletActif = 'joueurs';


// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
async function init() {
  moi = await getMonJoueur();
  $('chargement').hidden = true;

  if (!moi || !moi.is_mj) {
    $('refus').hidden = false;
    $('refus-texte').textContent = moi
      ? "Cette page est réservée aux Maîtres du Jeu."
      : "Connecte-toi avec Discord (compte MJ) pour accéder au panneau.";
    return;
  }

  $('panneau').hidden = false;
  await Promise.all([chargerJoueurs(), chargerItems()]);
  afficherListeJoueurs();
  remplirFiltreJournal();
}


// Appel d'une fonction SQL avec gestion d'erreur et message
async function rpc(nom, params, succes) {
  const { data, error } = await supabase.rpc(nom, params);
  if (error) {
    notifier(error.message, 'erreur');
    return false;
  }
  if (succes) notifier(succes);
  return data ?? true;
}

// Recharge ce qui est affiché après une modification
async function rafraichir() {
  await Promise.all([chargerJoueurs(), chargerItems()]);
  afficherListeJoueurs();
  if (selection) await afficherFicheJoueur(selection);
  if (ongletActif === 'journal') await afficherJournal();
  if (ongletActif === 'objets') await afficherObjets();
}


// ---------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------
document.querySelectorAll('.onglet').forEach((bouton) => {
  bouton.addEventListener('click', async () => {
    ongletActif = bouton.dataset.onglet;
    document.querySelectorAll('.onglet').forEach((b) => b.classList.toggle('actif', b === bouton));
    document.querySelectorAll('.onglet-contenu').forEach((s) => {
      s.hidden = s.id !== `onglet-${ongletActif}`;
    });
    if (ongletActif === 'journal') await afficherJournal();
    if (ongletActif === 'objets') await afficherObjets();
  });
});


// ---------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------
async function chargerJoueurs() {
  const { data, error } = await supabase
    .from('players')
    .select('discord_id, username, avatar_url, is_mj, wallet:wallets(balance)')
    .order('username');

  if (error) {
    notifier('Impossible de charger les joueurs : ' + error.message, 'erreur');
    return;
  }
  joueurs = data.map((j) => {
    const w = Array.isArray(j.wallet) ? j.wallet[0] : j.wallet;
    return { ...j, solde: w?.balance ?? 0 };
  });
}

async function chargerItems() {
  const { data } = await supabase.from('items').select('*').order('shop').order('price');
  items = data ?? [];
}

const nomJoueur = (id) => joueurs.find((j) => j.discord_id === id)?.username ?? id;


// ---------------------------------------------------------------------
// Onglet Joueurs
// ---------------------------------------------------------------------
function afficherListeJoueurs() {
  const filtre = $('recherche').value.trim().toLowerCase();
  const liste = joueurs.filter((j) => (j.username ?? '').toLowerCase().includes(filtre));

  $('liste-joueurs').innerHTML = liste.length
    ? liste.map((j) => `
        <li class="joueur${j.discord_id === selection ? ' joueur--actif' : ''}" data-action="ouvrir" data-id="${esc(j.discord_id)}">
          ${j.avatar_url ? `<img src="${esc(j.avatar_url)}" alt="">` : '<span class="avatar-vide"></span>'}
          <span class="joueur__nom">${esc(j.username ?? 'Sans pseudo')}${j.is_mj ? ' <span class="badge-mj">MJ</span>' : ''}</span>
          <strong>${j.solde}</strong>
        </li>`).join('')
    : '<p class="vide">Aucun joueur.</p>';
}

$('recherche').addEventListener('input', afficherListeJoueurs);

async function afficherFicheJoueur(id) {
  selection = id;
  afficherListeJoueurs();

  const j = joueurs.find((x) => x.discord_id === id);
  if (!j) {
    $('fiche-joueur').innerHTML = '<p class="vide">Joueur introuvable.</p>';
    return;
  }

  const [{ data: inv }, { data: tx }] = await Promise.all([
    supabase.from('inventory').select('quantity, item:items(*)').eq('discord_id', id).order('acquired_at', { ascending: false }),
    supabase.from('transactions').select('*').eq('discord_id', id).order('created_at', { ascending: false }).limit(30),
  ]);

  const estMoi = id === moi.discord_id;

  $('fiche-joueur').innerHTML = `
    <div class="fiche-entete">
      ${j.avatar_url ? `<img src="${esc(j.avatar_url)}" alt="">` : ''}
      <div>
        <h2>${esc(j.username ?? 'Sans pseudo')}${j.is_mj ? ' <span class="badge-mj">MJ</span>' : ''}</h2>
        <a href="profil.html?id=${encodeURIComponent(id)}" target="_blank">Voir le profil public ↗</a>
      </div>
      <div class="fiche-solde"><strong>${j.solde}</strong> pièces</div>
    </div>

    <h3>Pièces</h3>
    <form id="form-pieces" class="ligne-form">
      <input name="montant" class="champ champ--court" type="number" min="1" placeholder="Montant" required>
      <input name="raison" class="champ" type="text" placeholder="Raison (quête, session, event…)" required>
      <button type="submit" class="btn-petit" value="donner">Donner</button>
      <button type="submit" class="btn-petit btn-petit--rouge" value="retirer">Retirer</button>
    </form>
    <form id="form-solde" class="ligne-form">
      <input name="solde" class="champ champ--court" type="number" min="0" placeholder="Nouveau solde" required>
      <button type="submit" class="btn-petit">Fixer le solde</button>
    </form>

    <h3>Inventaire</h3>
    <ul class="liste">
      ${inv?.length ? inv.map(({ quantity, item }) => `
        <li>
          <div>
            <span class="petit-type">${esc(LIBELLES[item.kind] ?? item.kind)}</span>
            <strong>${esc(item.name)}</strong>${quantity > 1 ? ` <span class="doux">×${quantity}</span>` : ''}
          </div>
          <div class="actions">
            <button type="button" class="btn-lien" data-action="retirer-objet" data-item="${item.id}">Retirer</button>
            <button type="button" class="btn-lien" data-action="rembourser-objet" data-item="${item.id}" title="Retire l'objet et rend ${item.price} pièces">Retirer + rembourser</button>
          </div>
        </li>`).join('') : '<p class="vide">Inventaire vide.</p>'}
    </ul>
    <form id="form-offrir" class="ligne-form">
      <select name="objet" class="champ" required>
        ${items.map((it) => `<option value="${it.id}">${esc(it.name)} (${BOUTIQUES[it.shop]})</option>`).join('')}
      </select>
      <button type="submit" class="btn-petit">Offrir</button>
    </form>

    <h3>Historique</h3>
    <ul class="liste">${tx?.length ? tx.map((t) => ligneTransaction(t, false)).join('') : '<p class="vide">Aucune transaction.</p>'}</ul>

    <h3 class="zone-danger-titre">Zone sensible</h3>
    <div class="zone-danger">
      ${estMoi ? '' : `<button type="button" class="btn-petit" data-action="basculer-mj">${j.is_mj ? 'Retirer le rôle MJ' : 'Nommer MJ'}</button>`}
      <button type="button" class="btn-petit btn-petit--rouge" data-action="reset">Réinitialiser le joueur</button>
    </div>
  `;
}


// ---------------------------------------------------------------------
// Onglet Journal
// ---------------------------------------------------------------------
function remplirFiltreJournal() {
  $('filtre-journal').innerHTML = '<option value="">Tous les joueurs</option>' +
    joueurs.map((j) => `<option value="${esc(j.discord_id)}">${esc(j.username ?? j.discord_id)}</option>`).join('');
}

$('filtre-journal').addEventListener('change', afficherJournal);

async function afficherJournal() {
  let requete = supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(200);
  const filtre = $('filtre-journal').value;
  if (filtre) requete = requete.eq('discord_id', filtre);

  const { data, error } = await requete;
  $('journal').innerHTML = error
    ? `<p class="vide">Erreur : ${esc(error.message)}</p>`
    : data.length ? data.map((t) => ligneTransaction(t, true)).join('') : '<p class="vide">Aucune transaction.</p>';
}

function ligneTransaction(t, avecJoueur) {
  const annulable = !t.annulee && !t.annulation_de && t.amount !== 0;
  return `
    <li class="${t.annulee ? 'tx--annulee' : ''}">
      <div>
        <span>${avecJoueur ? `<strong>${esc(nomJoueur(t.discord_id))}</strong> · ` : ''}${esc(t.reason ?? '—')}</span>
        <small class="doux">${dateCourte(t.created_at)} · ${esc(SOURCES[t.source] ?? t.source)}${t.annulee ? ' · annulée' : ''}</small>
      </div>
      <div class="actions">
        <strong class="${t.amount >= 0 ? 'gain' : 'perte'}">${t.amount >= 0 ? '+' : ''}${t.amount}</strong>
        ${annulable ? `<button type="button" class="btn-lien" data-action="annuler-tx" data-id="${t.id}">Annuler</button>` : ''}
      </div>
    </li>`;
}


// ---------------------------------------------------------------------
// Onglet Objets & boutique
// ---------------------------------------------------------------------
async function afficherObjets() {
  // Créneau de 5 h en cours (la boutique du marchand ne change plus par jour)
  const { data: slot } = await supabase.rpc('current_shop_slot');
  const { data: jour } = await supabase
    .from('daily_shop')
    .select('price, stock, item:items(id, name)')
    .eq('slot', slot)
    .order('price');

  $('jour').innerHTML = jour?.length
    ? jour.map(({ price, stock, item }) => `
        <li>
          <div><strong>${esc(item.name)}</strong> <span class="doux">${price} pièces</span></div>
          <div class="actions">
            <input class="champ champ--court" type="number" min="0" value="${stock}" data-stock="${item.id}" aria-label="Stock">
            <button type="button" class="btn-lien" data-action="stock-jour" data-item="${item.id}">Enregistrer</button>
            <button type="button" class="btn-lien" data-action="retirer-jour" data-item="${item.id}">Retirer</button>
          </div>
        </li>`).join('')
    : '<p class="vide">Pas de boutique pour ce créneau. Clique sur « Nouvelle sélection ».</p>';

  const dejaAuJour = new Set((jour ?? []).map((l) => l.item.id));
  const ajoutables = items.filter((it) => it.shop === 'daily' && !dejaAuJour.has(it.id));
  const form = $('form-ajout-jour');
  form.hidden = !ajoutables.length;
  form.elements.namedItem('objet').innerHTML = ajoutables.map((it) => `<option value="${it.id}">${esc(it.name)} (${it.price} pièces)</option>`).join('');

  $('catalogue').innerHTML = items.length
    ? items.map((it) => `
        <li class="${it.is_available ? '' : 'objet--cache'}">
          <div class="objet-catalogue__entete">
            ${it.payload?.image ? `<img class="objet-catalogue__icone" src="${esc(new URL(it.payload.image, SITE_ROOT))}" alt="">` : ''}
            <div>
              <span class="petit-type">${BOUTIQUES[it.shop]} · ${esc(LIBELLES[it.kind] ?? it.kind)}${it.is_available ? '' : ' · hors vente'}</span>
              <strong>${esc(it.name)}</strong> <span class="doux">${it.price} pièces</span>
            </div>
          </div>
          <div class="actions">
            <button type="button" class="btn-lien" data-action="editer-objet" data-item="${it.id}">Modifier</button>
            <button type="button" class="btn-lien" data-action="basculer-vente" data-item="${it.id}">${it.is_available ? 'Retirer de la vente' : 'Remettre en vente'}</button>
          </div>
        </li>`).join('')
    : '<p class="vide">Catalogue vide.</p>';

  $('catalogue').querySelectorAll('.objet-catalogue__icone').forEach((img) => {
    img.addEventListener('error', () => img.remove(), { once: true });
  });
}

// Formulaire d'objet (création ou modification)
function ouvrirFormObjet(item = null) {
  const p = item?.payload ?? {};
  const form = $('form-objet');
  form.hidden = false;
  form.innerHTML = `
    <h3>${item ? `Modifier « ${esc(item.name)} »` : 'Nouvel objet'}</h3>
    <input type="hidden" name="item_id" value="${item?.id ?? ''}">
    <div class="grille-form">
      <label>Nom <input name="nom" class="champ" required value="${esc(item?.name)}"></label>
      <label>Prix <input name="prix" class="champ" type="number" min="0" required value="${item?.price ?? 50}"></label>
      <label>Boutique
        <select name="boutique" class="champ">
          <option value="daily"${item?.shop === 'daily' ? ' selected' : ''}>Boutique du marchand</option>
          <option value="fun"${item?.shop === 'fun' ? ' selected' : ''}>Boutique du profil</option>
        </select>
      </label>
      <label>Type
        <select name="type" class="champ">
          ${Object.entries(LIBELLES).map(([k, v]) => `<option value="${k}"${(item?.kind ?? 'rp') === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label class="large">Description <textarea name="description" class="champ" rows="2">${esc(item?.description)}</textarea></label>
      <label>Stock min (marchand) <input name="stock_min" class="champ" type="number" min="0" value="${item?.min_stock ?? 1}"></label>
      <label>Stock max (marchand) <input name="stock_max" class="champ" type="number" min="0" value="${item?.max_stock ?? 5}"></label>
      <label>Image (bannière) <input name="image" class="champ" placeholder="img/Bannière/xxx.webp" value="${esc(p.image)}"></label>
      <label>Texte (titre) <input name="texte" class="champ" value="${esc(p.text)}"></label>
      <label>Couleur (thème) <input name="couleur" class="champ" placeholder="#8b1e2d" value="${esc(p.accent)}"></label>
      <label>Couleur 2 (thème, optionnelle) <input name="couleur2" class="champ" placeholder="#d4b537" value="${esc(p.accent2)}"></label>
      <label>ID rôle Discord (optionnel) <input name="role" class="champ" value="${esc(p.discord_role_id)}"></label>
      <label class="case"><input name="en_vente" type="checkbox"${item?.is_available === false ? '' : ' checked'}> En vente</label>
    </div>
    <div class="ligne-form">
      <button type="submit" class="btn-petit">Enregistrer</button>
      <button type="button" class="btn-lien" data-action="fermer-form">Annuler</button>
    </div>`;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ---------------------------------------------------------------------
// Clics (un seul écouteur pour toute la page)
// ---------------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const itemId = Number(el.dataset.item);
  const j = joueurs.find((x) => x.discord_id === selection);

  switch (action) {
    case 'ouvrir':
      await afficherFicheJoueur(el.dataset.id);
      break;

    case 'annuler-tx':
      if (!confirm('Annuler cette transaction ? Le montant inverse sera appliqué.')) return;
      if (await rpc('mj_cancel_transaction', { p_id: Number(el.dataset.id) }, 'Transaction annulée')) await rafraichir();
      break;

    case 'retirer-objet':
    case 'rembourser-objet': {
      const rembourser = action === 'rembourser-objet';
      if (!confirm(rembourser ? 'Retirer cet objet et rembourser son prix ?' : 'Retirer cet objet (sans remboursement) ?')) return;
      if (await rpc('mj_remove_item', { p_discord_id: selection, p_item_id: itemId, p_rembourser: rembourser },
        rembourser ? 'Objet retiré et remboursé' : 'Objet retiré')) await rafraichir();
      break;
    }

    case 'basculer-mj':
      if (!confirm(j.is_mj ? `Retirer le rôle MJ à ${j.username} ?` : `Nommer ${j.username} MJ ? Il aura accès à ce panneau.`)) return;
      if (await rpc('mj_set_mj', { p_discord_id: selection, p_value: !j.is_mj }, 'Rôle mis à jour')) await rafraichir();
      break;

    case 'reset':
      if (!confirm(`Réinitialiser ${j.username} ?\nPièces à 0, inventaire vidé, historique effacé, cosmétiques retirés.`)) return;
      if (prompt(`Pour confirmer, écris : ${j.username}`) !== j.username) return notifier('Réinitialisation annulée', 'erreur');
      if (await rpc('mj_reset_player', { p_discord_id: selection }, `${j.username} a été réinitialisé`)) await rafraichir();
      break;

    case 'regenerer':
      if (!confirm('Tirer une nouvelle sélection ? Celle du créneau en cours sera remplacée (les achats déjà faits restent).')) return;
      if (await rpc('mj_regenerate_daily_shop', {}, 'Nouvelle sélection du marchand')) await afficherObjets();
      break;

    case 'stock-jour': {
      const stock = Number(document.querySelector(`[data-stock="${itemId}"]`).value);
      if (await rpc('mj_set_daily_stock', { p_item_id: itemId, p_stock: stock }, 'Stock mis à jour')) await afficherObjets();
      break;
    }

    case 'retirer-jour':
      if (await rpc('mj_remove_daily_item', { p_item_id: itemId }, 'Retiré de la boutique du marchand')) await afficherObjets();
      break;

    case 'nouvel-objet':
      ouvrirFormObjet();
      break;

    case 'editer-objet':
      ouvrirFormObjet(items.find((it) => it.id === itemId));
      break;

    case 'fermer-form':
      $('form-objet').hidden = true;
      break;

    case 'basculer-vente': {
      const it = items.find((x) => x.id === itemId);
      if (await rpc('mj_toggle_item', { p_item_id: itemId, p_available: !it.is_available },
        it.is_available ? 'Retiré de la vente' : 'Remis en vente')) {
        await chargerItems();
        await afficherObjets();
      }
      break;
    }
  }
});


// ---------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------
document.addEventListener('submit', async (e) => {
  const form = e.target;
  e.preventDefault();

  switch (form.getAttribute('id')) {
    case 'form-pieces': {
      const montant = Number(form.elements.namedItem('montant').value);
      const retirer = e.submitter?.value === 'retirer';
      if (await rpc('mj_give_coins', {
        p_discord_id: selection,
        p_amount: retirer ? -montant : montant,
        p_reason: form.elements.namedItem('raison').value.trim(),
      }, retirer ? `${montant} pièces retirées` : `${montant} pièces données`)) await rafraichir();
      break;
    }

    case 'form-solde':
      if (await rpc('mj_set_balance', {
        p_discord_id: selection,
        p_balance: Number(form.elements.namedItem('solde').value),
        p_reason: 'Ajustement du solde par un MJ',
      }, 'Solde fixé')) await rafraichir();
      break;

    case 'form-offrir':
      if (await rpc('mj_give_item', { p_discord_id: selection, p_item_id: Number(form.elements.namedItem('objet').value) }, 'Objet offert')) await rafraichir();
      break;

    case 'form-ajout-jour':
      if (await rpc('mj_add_daily_item', { p_item_id: Number(form.elements.namedItem('objet').value), p_stock: Number(form.elements.namedItem('stock').value) },
        'Ajouté à la boutique du marchand')) await afficherObjets();
      break;

    case 'form-objet': {
      const champ = (nom) => form.elements.namedItem(nom);
      // On part du payload existant : les clés sans champ ici (emoji, rarete… utilisées par le bot) sont conservées
      const existant = items.find((it) => String(it.id) === champ('item_id').value)?.payload ?? {};
      const payload = { ...existant };
      for (const [nom, cle] of [['image', 'image'], ['texte', 'text'], ['couleur', 'accent'], ['couleur2', 'accent2'], ['role', 'discord_role_id']]) {
        const v = champ(nom).value.trim();
        if (v) payload[cle] = v;
        else delete payload[cle];
      }
      const ok = await rpc('mj_save_item', {
        p_item: {
          id: champ('item_id').value,
          name: champ('nom').value,
          description: champ('description').value,
          price: Number(champ('prix').value),
          shop: champ('boutique').value,
          kind: champ('type').value,
          min_stock: Number(champ('stock_min').value),
          max_stock: Number(champ('stock_max').value),
          is_available: champ('en_vente').checked,
          payload,
        },
      }, 'Objet enregistré');
      if (ok) {
        form.hidden = true;
        await chargerItems();
        await afficherObjets();
      }
      break;
    }
  }
});


init();
