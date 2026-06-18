/**
 * Police du nom de l'app (titre/logo), configurable en admin (Style Editor).
 * Repli sur « Arial Rounded MT Bold » si rien n'est défini.
 */
import { useStyleConfig } from './useStyleConfig';

export function useAppNameFont(): string {
  const { data } = useStyleConfig();
  const f = data?.app_name_font?.trim();
  return f && f.length > 0 ? f : 'Arial Rounded MT Bold';
}
