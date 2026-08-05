/**
 * Modèles d'e-mail (admin) — socle du code + modèles éditables en base (migration 167).
 *
 * Fusion, même principe que les catégories de base (migration 106) :
 *   • les modèles de `_shared/emailTemplate.ts` partent avec le code → une base neuve n'est jamais
 *     vide, et personne ne peut se retrouver sans point de départ ;
 *   • une ligne de `email_templates` dont l'`id` reprend celui d'un modèle du socle le REMPLACE ;
 *   • une ligne avec un id libre est un modèle CUSTOM ;
 *   • supprimer la ligne d'un modèle du socle le RESTAURE dans sa version d'origine (au lieu de le
 *     faire disparaître — c'est ce qu'on veut d'un « réinitialiser »).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { EMAIL_TEMPLATES, type EmailTemplate } from '../supabase/functions/_shared/emailTemplate';

export interface AdminEmailTemplate extends EmailTemplate {
  /** Vient du code (non supprimable, seulement réinitialisable). */
  builtin: boolean;
  /** Une ligne existe en base pour cet id (modèle custom, ou socle modifié). */
  overridden: boolean;
  sort_order?: number;
}

const KEY = ['email_templates'];

const BUILTIN_IDS = new Set(EMAIL_TEMPLATES.map((t) => t.id));

export function useEmailTemplates() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AdminEmailTemplate[]> => {
      let rows: any[] = [];
      if (supabase) {
        const { data, error } = await supabase.from('email_templates').select('*').order('sort_order').order('created_at');
        /* Migration 167 pas encore appliquée → on n'échoue PAS : l'écran doit rester utilisable avec
           les modèles du socle. Toute autre erreur remonte (on ne masque pas une panne réelle). */
        if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(error.message);
        rows = data ?? [];
      }
      const byId = new Map(rows.map((r) => [r.id, r]));

      const merged: AdminEmailTemplate[] = EMAIL_TEMPLATES.map((t) => {
        const o = byId.get(t.id);
        return o
          ? { id: t.id, label: o.label, hint: o.hint, subject: o.subject, body: o.body, builtin: true, overridden: true, sort_order: o.sort_order }
          : { ...t, builtin: true, overridden: false };
      });
      for (const r of rows) {
        if (BUILTIN_IDS.has(r.id)) continue;
        merged.push({ id: r.id, label: r.label, hint: r.hint, subject: r.subject, body: r.body, builtin: false, overridden: true, sort_order: r.sort_order });
      }
      return merged;
    },
    staleTime: 60 * 1000,
  });
}

export interface EmailTemplateInput {
  id: string; label: string; hint?: string; subject: string; body: string;
}

/** Crée ou met à jour un modèle. Modifier un modèle du socle crée sa ligne de remplacement. */
export function useSaveEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: EmailTemplateInput) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from('email_templates').upsert({
        id: t.id,
        label: t.label.trim() || 'Sans nom',
        hint: (t.hint ?? '').trim(),
        subject: t.subject,
        body: t.body,
        created_by: auth?.user?.id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * Supprime la ligne d'un modèle. Sur un modèle du socle, c'est une RÉINITIALISATION (il réapparaît
 * dans sa version d'origine) ; sur un modèle custom, une suppression définitive.
 */
export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('email_templates').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Identifiant de modèle : lisible, stable, et qui n'écrase jamais un modèle existant. */
export function makeTemplateId(label: string, existing: string[]): string {
  const base = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'modele';
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
