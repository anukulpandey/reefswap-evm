import { reefSubgraphUrl } from './config';

type GraphQLError = {
  message: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
};

export type SubgraphToken = {
  id: string;
  symbol: string;
  name: string;
  decimals: string;
  tradeVolumeUSD: string;
  totalLiquidity: string;
  txCount: string;
  derivedETH: string;
};

export type SubgraphPair = {
  id: string;
  createdAtBlockNumber: string;
  createdAtTimestamp: string;
  token0: Pick<SubgraphToken, 'id' | 'symbol' | 'name' | 'decimals'>;
  token1: Pick<SubgraphToken, 'id' | 'symbol' | 'name' | 'decimals'>;
  reserve0: string;
  reserve1: string;
  reserveUSD: string;
  volumeUSD: string;
  txCount: string;
  token0Price: string;
  token1Price: string;
};

export type SubgraphFactory = {
  id: string;
  pairCount: number;
  totalVolumeUSD: string;
  totalLiquidityUSD: string;
  txCount: string;
};

export type SubgraphSwap = {
  id: string;
  timestamp: string;
  amount0In: string;
  amount1In: string;
  amount0Out: string;
  amount1Out: string;
  amountUSD: string;
  transaction: {
    id: string;
  };
};

export type SubgraphMintBurn = {
  id: string;
  timestamp: string;
  amount0: string | null;
  amount1: string | null;
  amountUSD: string | null;
  transaction: {
    id: string;
  };
};

const SUBGRAPH_PAIRS_QUERY = `
  query PairsOverview($first: Int!) {
    pairs(first: $first, orderBy: createdAtBlockNumber, orderDirection: desc) {
      id
      createdAtBlockNumber
      createdAtTimestamp
      token0 { id symbol name decimals }
      token1 { id symbol name decimals }
      reserve0
      reserve1
      reserveUSD
      volumeUSD
      txCount
      token0Price
      token1Price
    }
  }
`;

const SUBGRAPH_TOKENS_QUERY = `
  query TokensOverview($first: Int!) {
    tokens(first: $first, orderBy: totalLiquidity, orderDirection: desc) {
      id
      symbol
      name
      decimals
      tradeVolumeUSD
      totalLiquidity
      txCount
      derivedETH
    }
  }
`;

const SUBGRAPH_FACTORY_QUERY = `
  query FactoryOverview {
    uniswapFactories(first: 1) {
      id
      pairCount
      totalVolumeUSD
      totalLiquidityUSD
      txCount
    }
  }
`;

const SUBGRAPH_PAIR_TRANSACTIONS_QUERY = `
  query PairTransactions($pairId: String!, $first: Int!) {
    swaps(first: $first, where: { pair: $pairId }, orderBy: timestamp, orderDirection: desc) {
      id
      timestamp
      amount0In
      amount1In
      amount0Out
      amount1Out
      amountUSD
      transaction { id }
    }
    mints(first: $first, where: { pair: $pairId }, orderBy: timestamp, orderDirection: desc) {
      id
      timestamp
      amount0
      amount1
      amountUSD
      transaction { id }
    }
    burns(first: $first, where: { pair: $pairId }, orderBy: timestamp, orderDirection: desc) {
      id
      timestamp
      amount0
      amount1
      amountUSD
      transaction { id }
    }
  }
`;

const requestSubgraph = async <TData, TVariables extends Record<string, unknown> | undefined = undefined>(
  query: string,
  variables?: TVariables,
): Promise<TData> => {
  const response = await fetch(reefSubgraphUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph request failed (${response.status})`);
  }

  const payload = await response.json() as GraphQLResponse<TData>;
  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || 'Subgraph GraphQL error');
  }
  if (!payload.data) {
    throw new Error('Subgraph returned no data');
  }

  return payload.data;
};

export const fetchSubgraphPairs = async (first = 100): Promise<SubgraphPair[]> => {
  const data = await requestSubgraph<{ pairs: SubgraphPair[] }, { first: number }>(SUBGRAPH_PAIRS_QUERY, { first });
  return data.pairs;
};

export const fetchSubgraphTokens = async (first = 200): Promise<SubgraphToken[]> => {
  const data = await requestSubgraph<{ tokens: SubgraphToken[] }, { first: number }>(SUBGRAPH_TOKENS_QUERY, { first });
  return data.tokens;
};

export const fetchSubgraphFactory = async (): Promise<SubgraphFactory | null> => {
  const data = await requestSubgraph<{ uniswapFactories: SubgraphFactory[] }>(SUBGRAPH_FACTORY_QUERY);
  return data.uniswapFactories[0] || null;
};

export const fetchSubgraphPairTransactions = async (pairId: string, first = 20): Promise<{
  swaps: SubgraphSwap[];
  mints: SubgraphMintBurn[];
  burns: SubgraphMintBurn[];
}> => requestSubgraph<
  {
    swaps: SubgraphSwap[];
    mints: SubgraphMintBurn[];
    burns: SubgraphMintBurn[];
  },
  { pairId: string; first: number }
>(SUBGRAPH_PAIR_TRANSACTIONS_QUERY, { pairId: pairId.toLowerCase(), first });

