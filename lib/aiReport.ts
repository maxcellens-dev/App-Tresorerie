/**
 * Parse une réponse des Conseils IA en un rapport STRUCTURÉ, rendu ensuite en cartes (components/AiReport).
 *
 * Deux couches, cumulatives — aucune info perdue :
 *  1) Un bloc de SYNTHÈSE optionnel en tête, émis par les prompts d'analyse :
 *        ##RELYKA
 *        verdict: <une phrase>
 *        score: 68                       (bilan global uniquement)
 *        tag: Bonne direction
 *        signal: Sécurité | good | Matelas ≈ 4,2 mois
 *        signal: Trésorerie | watch | Fin de mois +90 €
 *        action: Suspendre les versements | Priorité immédiate
 *        ##END
 *  2) Le CORPS riche habituel : des sections titrées en gras avec emoji
 *     (`**🎯 Ce qui ressort**`, `**💸 À optimiser**`, …) → chacune devient une carte de section.
 *
 * Tolérant : si le bloc ##RELYKA manque (chat, anciens messages), on rend quand même les sections ;
 * s'il n'y a ni bloc ni section (réponse courte), `structured` = false → le caller retombe sur AiRichText.
 */

export type SignalStatus = 'good' | 'watch' | 'over';
export interface ReportSignal { label: string; status: SignalStatus; detail?: string }
export interface ReportAction { title: string; meta?: string; primary?: boolean }
export interface ReportSummary { verdict?: string; score?: number; tag?: string; signals: ReportSignal[]; actions: ReportAction[] }
export interface ReportSection { emoji: string; title: string; body: string }
export interface AiReport { summary: ReportSummary | null; intro: string; sections: ReportSection[]; structured: boolean }

const STATUS_ALIASES: Record<string, SignalStatus> = {
  good: 'good', ok: 'good', vert: 'good', green: 'good',
  watch: 'watch', warn: 'watch', warning: 'watch', orange: 'watch', amber: 'watch', surveiller: 'watch',
  over: 'over', bad: 'over', red: 'over', rouge: 'over', danger: 'over', depasse: 'over',
};

/** Sépare un emoji/symbole de tête du reste du titre. */
function splitEmoji(title: string): { emoji: string; title: string } {
  const t = title.trim();
  const m = t.match(/^([^0-9A-Za-zÀ-ÿ]+)\s*(.*)$/);
  if (m && m[1].trim() && m[2].trim()) return { emoji: m[1].trim(), title: m[2].trim() };
  return { emoji: '', title: t };
}

function normStatus(raw: string | undefined): SignalStatus {
  const k = (raw ?? '').trim().toLowerCase();
  return STATUS_ALIASES[k] ?? 'watch';
}

function parseHeaderBlock(block: string): ReportSummary {
  const summary: ReportSummary = { signals: [], actions: [] };
  block.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(/^(verdict|score|tag|signal|action)\s*:?\s*(.*)$/i);
    if (!m) return;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (!val) return;
    if (key === 'verdict') summary.verdict = val;
    else if (key === 'tag') summary.tag = val;
    else if (key === 'score') { const n = parseInt(val.replace(/[^0-9]/g, ''), 10); if (!Number.isNaN(n)) summary.score = Math.max(0, Math.min(100, n)); }
    else if (key === 'signal') {
      const [label, status, detail] = val.split('|').map((p) => p.trim());
      if (label) summary.signals.push({ label, status: normStatus(status), detail: detail || undefined });
    } else if (key === 'action') {
      const [title, meta, prio] = val.split('|').map((p) => p.trim());
      if (title) summary.actions.push({ title, meta: meta || undefined, primary: /p1|1|prio/i.test(prio ?? '') });
    }
  });
  // Première action = prioritaire par défaut si aucune marquée.
  if (summary.actions.length && !summary.actions.some((a) => a.primary)) summary.actions[0].primary = true;
  const has = summary.verdict || summary.score != null || summary.signals.length || summary.actions.length;
  return has ? summary : { signals: [], actions: [] };
}

export function parseAiReport(text: string): AiReport {
  const raw = String(text ?? '');
  let body = raw;
  let summary: ReportSummary | null = null;

  // 1) Bloc de synthèse ##RELYKA … ##END (ou ##/RELYKA, ou jusqu'à la 1ʳᵉ section si non fermé).
  const start = body.search(/##\s*RELYKA/i);
  if (start >= 0) {
    const after = body.slice(start).replace(/^##\s*RELYKA[^\n]*\n?/i, '');
    const endMatch = after.match(/##\s*(?:END|\/\s*RELYKA)/i);
    let blockText: string;
    if (endMatch && endMatch.index != null) {
      blockText = after.slice(0, endMatch.index);
      body = (body.slice(0, start) + after.slice(endMatch.index).replace(/^##\s*(?:END|\/\s*RELYKA)[^\n]*\n?/i, '')).trim();
    } else {
      // Pas de fermeture explicite : le bloc va jusqu'à la 1ʳᵉ ligne de section en gras.
      const secIdx = after.search(/\n\s*\*\*/);
      blockText = secIdx >= 0 ? after.slice(0, secIdx) : after;
      body = (body.slice(0, start) + (secIdx >= 0 ? after.slice(secIdx) : '')).trim();
    }
    const parsed = parseHeaderBlock(blockText);
    if (parsed.verdict || parsed.score != null || parsed.signals.length || parsed.actions.length) summary = parsed;
  }

  // 2) Sections titrées (**emoji Titre**) + intro éventuelle avant la 1ʳᵉ section.
  const lines = body.split('\n');
  const introLines: string[] = [];
  const sections: ReportSection[] = [];
  let cur: ReportSection | null = null;
  for (const line of lines) {
    const t = line.trim();
    const h = t.match(/^\*\*(.+?)\*\*\s*[—:\-–]?\s*(.*)$/);
    // Titre de section = ligne entièrement en gras (rien après) OU commençant par un emoji.
    const isHeading = !!h && (() => { const { emoji } = splitEmoji(h[1]); return !!emoji || !h[2].trim(); })();
    if (isHeading && h) {
      if (cur) sections.push(cur);
      const { emoji, title } = splitEmoji(h[1]);
      cur = { emoji, title, body: h[2].trim() };
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + line;
    } else {
      introLines.push(line);
    }
  }
  if (cur) sections.push(cur);
  sections.forEach((s) => { s.body = s.body.trim(); });

  const intro = introLines.join('\n').trim();
  const structured = !!summary || sections.length >= 1;
  return { summary, intro, sections, structured };
}

/** Couleur + libellé d'un statut de signal, à partir de la palette de thème (c). */
export function signalMeta(status: SignalStatus, c: any): { color: string; label: string } {
  if (status === 'good') return { color: c.success, label: 'OK' };
  if (status === 'over') return { color: c.danger, label: 'Dépassé' };
  return { color: c.warning, label: 'À surveiller' };
}

/** Couleur d'une bande de score (0-100). */
export function scoreColor(score: number, c: any): string {
  if (score >= 70) return c.success;
  if (score >= 45) return c.warning;
  return c.danger;
}
