import { computeTresoRows } from '../lib/finance/tresoProjection';

/**
 * Filtre par compte courant de l'onglet « Trésorerie » de la Projection.
 *
 * Le filtre agit en NARROWANT la liste des comptes passée à `computeTresoRows` — c'est elle qui
 * détermine à la fois le solde de départ (somme des comptes courants) et les flux retenus.
 *
 * Le piège, verrouillé ici : il ne faut retirer QUE des comptes COURANTS. Les comptes d'épargne et
 * d'investissement doivent rester dans la liste même s'ils ne sont pas « sélectionnés », car le
 * moteur s'en sert pour reconnaître un virement « courant → épargne » et le classer dans la ligne
 * « Autre (épargne, invest, projets) ». Les enlever ne filtrait pas cette ligne : elle disparaissait,
 * et le solde prévu devenait faux.
 */

const NOW = new Date(2026, 6, 15); // 15 juillet 2026

const A = { id: 'ca', type: 'checking', balance: 1000 };  // compte courant A
const B = { id: 'cb', type: 'checking', balance: 400 };   // compte courant B
const EP = { id: 'ep', type: 'savings', balance: 5000 };  // épargne
const ALL = [A, B, EP];

/** Reproduit exactement ce que fait l'écran : on ne retire que des comptes COURANTS. */
const applyFilter = (accounts: any[], selectedIds: string[]) => {
  if (selectedIds.length === 0) return accounts;           // liste vide = « Tous »
  const keep = new Set(selectedIds);
  return accounts.filter((a) => a.type !== 'checking' || keep.has(a.id));
};

const run = (accounts: any[], transactions: any[]) =>
  computeTresoRows({
    transactions, accounts, overridesMap: {},
    variableMonthly: 0, variableRemaining: 0, monthsCount: 1, now: NOW,
  });

const tx = (o: any) => ({ id: 'x', is_draft: false, is_recurring: false, ...o });
const surA = tx({ id: 'a1', account_id: 'ca', amount: -100, date: '2026-07-20' });
const surB = tx({ id: 'b1', account_id: 'cb', amount: -70, date: '2026-07-21' });
const versEpargne = tx({ id: 'v1', account_id: 'ca', amount: -200, date: '2026-07-22', linked_account_id: 'ep' });

describe('filtre par compte courant — trésorerie simplifiée', () => {
  it('sans filtre, additionne tous les comptes courants', () => {
    const [m] = run(applyFilter(ALL, []), [surA, surB]);
    expect(m.startBalance).toBe(1400);   // 1000 + 400
    expect(m.expense).toBe(170);         // 100 + 70
  });

  it('un seul compte sélectionné : solde de départ et dépenses de ce compte uniquement', () => {
    const [m] = run(applyFilter(ALL, ['ca']), [surA, surB]);
    expect(m.startBalance).toBe(1000);
    expect(m.expense).toBe(100);         // la dépense du compte B est écartée
  });

  it('l’autre compte donne bien l’autre moitié', () => {
    const [m] = run(applyFilter(ALL, ['cb']), [surA, surB]);
    expect(m.startBalance).toBe(400);
    expect(m.expense).toBe(70);
  });

  it('les deux comptes sélectionnés = même résultat que « Tous »', () => {
    const [filtre] = run(applyFilter(ALL, ['ca', 'cb']), [surA, surB]);
    const [tous] = run(applyFilter(ALL, []), [surA, surB]);
    expect(filtre.startBalance).toBe(tous.startBalance);
    expect(filtre.expense).toBe(tous.expense);
    expect(filtre.balance).toBe(tous.balance);
  });

  /* LE point de régression : le compte d'épargne n'est pas « sélectionné », mais il doit rester
     dans la liste, sinon le virement vers l'épargne cesse d'être reconnu comme tel. */
  it('un virement vers l’épargne reste classé en « Autre », même en filtrant sur un compte', () => {
    const [m] = run(applyFilter(ALL, ['ca']), [versEpargne]);
    expect(m.other).toBe(-200);
    expect(m.expense).toBe(0);           // ce n'est pas une dépense : c'est un déplacement
    expect(m.balance).toBe(800);         // 1000 − 200
  });

  it('le virement suit son compte : filtrer sur B l’exclut', () => {
    const [m] = run(applyFilter(ALL, ['cb']), [versEpargne]);
    expect(m.other).toBe(0);
    expect(m.balance).toBe(400);
  });

  it('une sélection qui ne désigne plus aucun compte existant ne vide pas la prévision', () => {
    // L'écran recoupe la sélection avec les comptes réellement disponibles AVANT de filtrer :
    // une sélection périmée retombe donc sur « Tous », jamais sur « aucun compte ».
    const available = new Set(ALL.filter((a) => a.type === 'checking').map((a) => a.id));
    const sanitized = ['compte-supprime'].filter((id) => available.has(id));
    const [m] = run(applyFilter(ALL, sanitized), [surA, surB]);
    expect(m.startBalance).toBe(1400);
  });
});
