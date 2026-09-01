-- ============================================================================
-- 219 — ÉTAT DES LIEUX : suppression du signal « Jamais dans le rouge ».
--
-- Une série de mois sans découvert ne disait ni un montant, ni où on en est : elle se contentait
-- de féliciter. Le signal est retiré du code (lib/pulse/pulseEngine) ; on nettoie ici la config
-- STOCKÉE pour que l'écran admin ne le propose plus et que la sélection de chaque profil reste
-- exacte.
--
-- Le code sait déjà ignorer un signal inconnu (`resolvePulseConfig` filtre sur PULSE_SIGNAL_IDS) :
-- cette migration n'est donc pas bloquante, elle évite juste une config qui traîne.
--
-- On préserve l'ORDRE choisi par l'admin : on retire l'élément, on ne réécrit pas la liste.
-- ============================================================================

UPDATE public.app_config
SET pulse = jsonb_set(
  pulse,
  '{signalsByProfile}',
  (
    SELECT COALESCE(jsonb_object_agg(profil.key, kept.list), '{}'::jsonb)
    FROM jsonb_each(pulse -> 'signalsByProfile') AS profil(key, value)
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(sig.value ORDER BY sig.ord), '[]'::jsonb) AS list
      FROM jsonb_array_elements(profil.value) WITH ORDINALITY AS sig(value, ord)
      WHERE sig.value <> '"no_overdraft"'::jsonb
    ) AS kept
  )
)
WHERE id = 'default'
  AND pulse -> 'signalsByProfile' IS NOT NULL
  AND pulse::text LIKE '%no_overdraft%';
