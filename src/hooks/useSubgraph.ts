import { useQuery } from '@tanstack/react-query';
import {
  fetchSubgraphFactory,
  fetchSubgraphPairTransactions,
  fetchSubgraphPairs,
  fetchSubgraphTokens,
} from '@/lib/subgraph';

const DEFAULT_STALE_TIME_MS = 15_000;

export const useSubgraphPairs = (first = 100) => useQuery({
  queryKey: ['subgraph', 'pairs', first],
  queryFn: () => fetchSubgraphPairs(first),
  staleTime: DEFAULT_STALE_TIME_MS,
  refetchInterval: 20_000,
});

export const useSubgraphTokens = (first = 200) => useQuery({
  queryKey: ['subgraph', 'tokens', first],
  queryFn: () => fetchSubgraphTokens(first),
  staleTime: DEFAULT_STALE_TIME_MS,
  refetchInterval: 30_000,
});

export const useSubgraphFactory = () => useQuery({
  queryKey: ['subgraph', 'factory'],
  queryFn: fetchSubgraphFactory,
  staleTime: DEFAULT_STALE_TIME_MS,
  refetchInterval: 30_000,
});

export const useSubgraphPairTransactions = (pairId: string | null | undefined, first = 20) => useQuery({
  queryKey: ['subgraph', 'pair-transactions', pairId?.toLowerCase(), first],
  queryFn: () => fetchSubgraphPairTransactions(pairId as string, first),
  enabled: Boolean(pairId),
  staleTime: DEFAULT_STALE_TIME_MS,
  refetchInterval: 15_000,
});

