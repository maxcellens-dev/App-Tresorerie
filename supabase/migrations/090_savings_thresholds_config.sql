-- 090 — Seuils d'épargne + libellés associés (Critique / À renforcer / Saine / Confortable),
-- configurables en admin (globaux, en EUR base — convertis ensuite dans la devise de référence).
-- Stockés dans le singleton app_config.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS savings_config JSONB DEFAULT '{
    "min": 5000,
    "optimal": 10000,
    "comfort": 20000,
    "label_critical": "Critique",
    "label_low": "À renforcer",
    "label_healthy": "Saine",
    "label_comfort": "Confortable"
  }'::jsonb;
