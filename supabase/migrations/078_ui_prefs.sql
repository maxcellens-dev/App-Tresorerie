-- Préférences UI + état "masquages de recommandations" stockés CÔTÉ COMPTE (et non plus en local
-- par appareil). Évite que ces états divergent d'un appareil/écran à l'autre.
--   ui_prefs = {
--     pilotage_tips_enabled?: boolean,
--     calculator_enabled?: boolean,
--     reco_dismissals?: { month: 'YYYY-MM', ignored: { <recoType>: number }, completed: string[] }
--   }
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
