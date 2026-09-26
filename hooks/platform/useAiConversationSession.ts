import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

/** Session mémoire uniquement : cette clé est exclue de la liste de persistance du cache. */
export function useAiConversationSession(profileId: string | undefined) {
  const client = useQueryClient();
  const { data = null } = useQuery<string | null>({
    queryKey: ['ai_conversation_session', profileId],
    queryFn: async () => null,
    initialData: null,
    enabled: false,
    gcTime: Infinity,
    staleTime: Infinity,
  });
  const select = useCallback((id: string | null) => {
    if (profileId) client.setQueryData(['ai_conversation_session', profileId], id);
  }, [client, profileId]);
  return [data, select] as const;
}
