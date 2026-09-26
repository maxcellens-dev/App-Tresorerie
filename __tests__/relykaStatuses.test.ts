import { computeRelykaBreakdown, relykaZeroHero, relykaTone, buildRelykaBaseMessage } from '../lib/finance/pilotageView';
import { displayRelyka } from '../lib/finance/currency';

function breakdown(raw: number, margin = 100, reserved = 200) {
  return computeRelykaBreakdown({ cashflow_trough: raw + margin + reserved, safety_margin_amount: margin } as any,
    { reservationsTotal: reserved, preEpargneTotal: 0, preInvestTotal: 0 });
}
it.each([[0.01,1],[0.49,1],[1.4,1],[1.5,2],[4.27,4],[9,9],[9.9,10],[10,10],[212,210]])('affiche %s en %s euros', (raw, expected) => {
  expect(displayRelyka(raw)).toBe(expected);
  expect(relykaZeroHero(breakdown(raw))).toBeNull();
});
it.each([[0,'Relyka consommé'],[-99,'Relyka consommé'],[-100,'Relyka consommé'],[-100.01,'Relyka placé'],[-299,'Relyka placé'],[-300,'Relyka placé'],[-300.01,'Relyka dépassé'],[-350,'Relyka dépassé']])('statut pour %s', (raw, word) => {
  const b = breakdown(raw as number);
  expect(relykaZeroHero(b)?.word).toBe(word);
  expect(buildRelykaBaseMessage(b,false).text).toBe(relykaZeroHero(b)?.sub);
});
it('affiche le conservé total et le dépassement brut', () => {
  expect(relykaZeroHero(breakdown(-299))?.sub).toBe('Tu as conservé 200 € ce mois-ci.');
  expect(relykaZeroHero(breakdown(-350))?.sub).toBe('Tu as dépensé 350 € de plus que ton Relyka ce mois-ci.');
  expect(relykaZeroHero(breakdown(0))?.sub).toBe('Tu as utilisé tout ton surplus du mois.');
});
it('exclut épargne, investissement et cumuls du seuil placé', () => {
  const b = computeRelykaBreakdown({ cashflow_trough: 499, safety_margin_amount: 100, monthly_reserve_planned: 20,
    month_savings_total: 900, month_invest_total: 900 } as any,
    { reservationsTotal: 30, preEpargneTotal: 200, preInvestTotal: 300 });
  expect(b.resteDisponibleBrut).toBe(-151);
  expect(relykaTone(b)).toBe('negative');
});
it('sans marge ni réservé : zéro consommé, négatif dépassé', () => {
  expect(relykaZeroHero(breakdown(0,0,0))?.word).toBe('Relyka consommé');
  expect(relykaZeroHero(breakdown(-0.01,0,0))?.word).toBe('Relyka dépassé');
});
