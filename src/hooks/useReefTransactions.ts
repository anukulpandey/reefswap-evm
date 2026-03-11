import { useEffect, useState } from 'react';
import { getNetwork } from 'reef-evm-util-lib';
import { formatUnits } from 'viem';
import { useReefState } from '@/contexts/ReefStateContext';
import { contracts } from '@/lib/config';
import { fetchSubgraphAccountSwaps, type SubgraphAccountSwap } from '@/lib/subgraph';

const REEF_DECIMALS = 18;
const REEF_SYMBOL = 'REEF';
const WREEF_SYMBOL = 'WREEF';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SWAP_SEQUENCE_WINDOW_MS = 120_000;

export interface ReefSwapDetails {
  fromAmount: number;
  fromSymbol: string;
  fromTokenAddress: string | null;
  toAmount: number;
  toSymbol: string;
  toTokenAddress: string | null;
  feeAmount: number;
  feeSymbol: string;
}

export interface ReefTransaction {
  id: string;
  txHash: string | null;
  tokenAddress: string | null;
  tokenIconUrl?: string | null;
  isNativeAsset: boolean;
  type: 'sent' | 'received' | 'swap';
  amount: number;
  symbol: string;
  date: string;
  time: string;
  icon: string;
  swapDetails?: ReefSwapDetails;
}

type ExplorerAddressRef = {
  hash?: string | null;
};

type ExplorerTokenTransfer = {
  from?: ExplorerAddressRef | null;
  to?: ExplorerAddressRef | null;
  token?: { symbol?: string | null; decimals?: string | number | null } | null;
  total?: { value?: string | null; decimals?: string | number | null } | null;
  value?: string | null;
};

type ExplorerTransaction = {
  hash: string;
  from?: ExplorerAddressRef | null;
  to?: ExplorerAddressRef | null;
  value?: string | null;
  timestamp?: string | null;
  gas_price?: string | null;
  gas_used?: string | null;
  tx_fee?: string | null;
  transaction_fee?: string | null;
  fee?: { value?: string | null; decimals?: string | number | null } | null;
  token_transfers?: ExplorerTokenTransfer[] | null;
};

type ExplorerTransactionsResponse = {
  items?: ExplorerTransaction[];
};

type ExplorerAddressTokenTransfer = {
  transaction_hash?: string | null;
  from?: ExplorerAddressRef | null;
  to?: ExplorerAddressRef | null;
  total?: { value?: string | null; decimals?: string | number | null } | null;
  token?: {
    symbol?: string | null;
    address_hash?: string | null;
    address?: string | null;
    icon_url?: string | null;
  } | null;
  timestamp?: string | null;
  log_index?: number | null;
  token_type?: string | null;
};

type ExplorerAddressTokenTransfersResponse = {
  items?: ExplorerAddressTokenTransfer[];
};

type MappedTransaction = ReefTransaction & {
  timestampMs: number;
  fromAddress: string | null;
  toAddress: string | null;
};

type NormalizedSubgraphSwap = {
  txHash: string;
  timestampMs: number;
  fromAmount: number;
  fromSymbol: string;
  fromTokenAddress: string | null;
  toAmount: number;
  toSymbol: string;
  toTokenAddress: string | null;
};

const toBigIntSafe = (value: unknown): bigint => {
  if (typeof value !== 'string' || value.trim() === '') return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const toFiniteNumber = (value: bigint, decimals: number): number => {
  const normalized = Number.parseFloat(formatUnits(value, decimals));
  return Number.isFinite(normalized) ? normalized : 0;
};

const normalizeTokenSymbol = (symbol: string | null | undefined): string => {
  const normalized = String(symbol || 'TOKEN').toUpperCase();
  return normalized === WREEF_SYMBOL ? REEF_SYMBOL : normalized;
};

const isReefSymbol = (symbol: string | null | undefined): boolean => {
  const normalized = normalizeTokenSymbol(symbol);
  return normalized === REEF_SYMBOL;
};

const parseDecimals = (value: string | number | null | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const resolveTransactionFee = (tx: ExplorerTransaction): number => {
  const feeRaw = toBigIntSafe(tx.fee?.value ?? tx.tx_fee ?? tx.transaction_fee);
  if (feeRaw > 0n) {
    const feeDecimals = parseDecimals(tx.fee?.decimals, REEF_DECIMALS);
    return toFiniteNumber(feeRaw, feeDecimals);
  }

  const gasPrice = toBigIntSafe(tx.gas_price);
  const gasUsed = toBigIntSafe(tx.gas_used);
  if (gasPrice > 0n && gasUsed > 0n) {
    return toFiniteNumber(gasPrice * gasUsed, REEF_DECIMALS);
  }

  return 0;
};

const toTimestamp = (value: string | null | undefined): number => {
  if (!value) return Date.now();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const toDisplayDate = (timestampMs: number): { date: string; time: string } => {
  const ts = new Date(timestampMs);
  return {
    date: ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
  };
};

const toLowerAddress = (value: string | null | undefined): string | null => (
  value ? value.toLowerCase() : null
);

const isAmountRoughlyEqual = (a: number, b: number): boolean => {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * 0.0001;
};

const toNumberSafe = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toSubgraphTimestampMs = (value: string | null | undefined): number => {
  const numeric = toNumberSafe(value);
  if (numeric > 0) {
    if (numeric > 10_000_000_000) return numeric;
    return numeric * 1000;
  }
  return toTimestamp(value);
};

const normalizeSubgraphSwap = (swap: SubgraphAccountSwap): NormalizedSubgraphSwap | null => {
  const txHash = swap.transaction?.id;
  if (!txHash) return null;

  const amount0In = toNumberSafe(swap.amount0In);
  const amount1In = toNumberSafe(swap.amount1In);
  const amount0Out = toNumberSafe(swap.amount0Out);
  const amount1Out = toNumberSafe(swap.amount1Out);

  let fromAmount = 0;
  let fromSymbol = '';
  let fromTokenAddress: string | null = null;
  let toAmount = 0;
  let toSymbol = '';
  let toTokenAddress: string | null = null;

  if (amount0In > 0 && amount1Out > 0) {
    fromAmount = amount0In;
    fromSymbol = normalizeTokenSymbol(swap.pair.token0.symbol);
    fromTokenAddress = swap.pair.token0.id || null;
    toAmount = amount1Out;
    toSymbol = normalizeTokenSymbol(swap.pair.token1.symbol);
    toTokenAddress = swap.pair.token1.id || null;
  } else if (amount1In > 0 && amount0Out > 0) {
    fromAmount = amount1In;
    fromSymbol = normalizeTokenSymbol(swap.pair.token1.symbol);
    fromTokenAddress = swap.pair.token1.id || null;
    toAmount = amount0Out;
    toSymbol = normalizeTokenSymbol(swap.pair.token0.symbol);
    toTokenAddress = swap.pair.token0.id || null;
  } else {
    const fallbackIn = amount0In > 0
      ? { amount: amount0In, symbol: normalizeTokenSymbol(swap.pair.token0.symbol), address: swap.pair.token0.id || null }
      : { amount: amount1In, symbol: normalizeTokenSymbol(swap.pair.token1.symbol), address: swap.pair.token1.id || null };
    const fallbackOut = amount0Out > 0
      ? { amount: amount0Out, symbol: normalizeTokenSymbol(swap.pair.token0.symbol), address: swap.pair.token0.id || null }
      : { amount: amount1Out, symbol: normalizeTokenSymbol(swap.pair.token1.symbol), address: swap.pair.token1.id || null };

    fromAmount = fallbackIn.amount;
    fromSymbol = fallbackIn.symbol;
    fromTokenAddress = fallbackIn.address;
    toAmount = fallbackOut.amount;
    toSymbol = fallbackOut.symbol;
    toTokenAddress = fallbackOut.address;
  }

  if (fromAmount <= 0 || toAmount <= 0 || !fromSymbol || !toSymbol || fromSymbol === toSymbol) {
    return null;
  }

  return {
    txHash,
    timestampMs: toSubgraphTimestampMs(swap.timestamp),
    fromAmount,
    fromSymbol,
    fromTokenAddress,
    toAmount,
    toSymbol,
    toTokenAddress,
  };
};

export function useReefTransactions(address: string | undefined) {
  const { isReefReady, selectedNetwork } = useReefState();
  const [transactions, setTransactions] = useState<ReefTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!address || !isReefReady) return;

    let cancelled = false;

    const fetchTransactions = async () => {
      setIsLoading(true);
      try {
        const blockExplorerUrl = getNetwork().blockExplorerUrl;
        const [txRes, tokenTransferRes, subgraphSwaps] = await Promise.all([
          fetch(`${blockExplorerUrl}/api/v2/addresses/${address}/transactions`, {
            headers: { accept: 'application/json' },
          }),
          fetch(`${blockExplorerUrl}/api/v2/addresses/${address}/token-transfers`, {
            headers: { accept: 'application/json' },
          }),
          fetchSubgraphAccountSwaps(address, 120).catch((subgraphError) => {
            console.warn('Failed to fetch subgraph account swaps, continuing with explorer data:', subgraphError);
            return [];
          }),
        ]);

        const txData = txRes.ok
          ? (await txRes.json() as ExplorerTransactionsResponse)
          : ({ items: [] } as ExplorerTransactionsResponse);
        const tokenTransfersData = tokenTransferRes.ok
          ? (await tokenTransferRes.json() as ExplorerAddressTokenTransfersResponse)
          : ({ items: [] } as ExplorerAddressTokenTransfersResponse);

        if (cancelled) return;

        const lowerAddress = address.toLowerCase();
        const txMetaByHash = new Map<string, { timestampMs: number; feeAmount: number }>();
        (txData.items || []).forEach((tx) => {
          if (!tx.hash) return;
          txMetaByHash.set(tx.hash.toLowerCase(), {
            timestampMs: toTimestamp(tx.timestamp),
            feeAmount: resolveTransactionFee(tx),
          });
        });

        const nativeTransactions: MappedTransaction[] = (txData.items || [])
          .map((tx) => {
            const valueRaw = toBigIntSafe(tx.value);
            if (valueRaw <= 0n) return null;

            const isSent = tx.from?.hash?.toLowerCase() === lowerAddress;
            const timestampMs = toTimestamp(tx.timestamp);
            const { date, time } = toDisplayDate(timestampMs);

            return {
              id: `native:${tx.hash}`,
              txHash: tx.hash,
              tokenAddress: null,
              tokenIconUrl: null,
              isNativeAsset: true,
              type: isSent ? 'sent' : 'received',
              amount: toFiniteNumber(valueRaw, REEF_DECIMALS),
              symbol: REEF_SYMBOL,
              date,
              time,
              icon: 'reef',
              timestampMs,
              fromAddress: tx.from?.hash || null,
              toAddress: tx.to?.hash || null,
            } satisfies MappedTransaction;
          })
          .filter((tx): tx is MappedTransaction => tx !== null);

        const erc20Transfers: MappedTransaction[] = (tokenTransfersData.items || [])
          .map((transfer, index) => {
            if (transfer.token_type && transfer.token_type !== 'ERC-20') return null;

            const fromLower = transfer.from?.hash?.toLowerCase();
            const toLower = transfer.to?.hash?.toLowerCase();
            if (fromLower !== lowerAddress && toLower !== lowerAddress) return null;

            const decimals = parseDecimals(transfer.total?.decimals, REEF_DECIMALS);
            const amountRaw = toBigIntSafe(transfer.total?.value);
            const amount = toFiniteNumber(amountRaw, decimals);
            if (amount <= 0) return null;

            const symbol = normalizeTokenSymbol(transfer.token?.symbol);
            const timestampMs = toTimestamp(transfer.timestamp);
            const { date, time } = toDisplayDate(timestampMs);

            return {
              id: `erc20:${transfer.transaction_hash || 'unknown'}:${String(transfer.log_index ?? index)}`,
              txHash: transfer.transaction_hash || null,
              tokenAddress: transfer.token?.address_hash || transfer.token?.address || null,
              tokenIconUrl: transfer.token?.icon_url || null,
              isNativeAsset: false,
              type: fromLower === lowerAddress ? 'sent' : 'received',
              amount,
              symbol,
              date,
              time,
              icon: symbol.charAt(0),
              timestampMs,
              fromAddress: transfer.from?.hash || null,
              toAddress: transfer.to?.hash || null,
            } satisfies MappedTransaction;
          })
          .filter((tx): tx is MappedTransaction => tx !== null);

        const sortedRaw = [...erc20Transfers, ...nativeTransactions]
          .sort((a, b) => b.timestampMs - a.timestampMs);

        const consumedIds = new Set<string>();
        const mergedWithSwaps: MappedTransaction[] = [];
        const wrappedReefAddress = contracts.wrappedReef.toLowerCase();
        const txEntriesByHash = new Map<string, MappedTransaction[]>();
        sortedRaw.forEach((tx) => {
          const txHash = tx.txHash?.toLowerCase();
          if (!txHash) return;
          const existing = txEntriesByHash.get(txHash);
          if (existing) {
            existing.push(tx);
          } else {
            txEntriesByHash.set(txHash, [tx]);
          }
        });

        const normalizedSubgraphSwaps = subgraphSwaps
          .map(normalizeSubgraphSwap)
          .filter((swap): swap is NormalizedSubgraphSwap => swap !== null)
          .sort((a, b) => b.timestampMs - a.timestampMs);

        normalizedSubgraphSwaps.forEach((swap) => {
          const txHashLower = swap.txHash.toLowerCase();
          const relatedHashes = new Set<string>([txHashLower]);

          const directEntries = txEntriesByHash.get(txHashLower) || [];
          directEntries.forEach((entry) => consumedIds.add(entry.id));

          const consumeWrapLegs = (amount: number) => {
            for (const candidate of sortedRaw) {
              if (consumedIds.has(candidate.id)) continue;
              if (!isReefSymbol(candidate.symbol)) continue;

              const deltaMs = Math.abs(candidate.timestampMs - swap.timestampMs);
              if (deltaMs > SWAP_SEQUENCE_WINDOW_MS) continue;
              if (!isAmountRoughlyEqual(candidate.amount, amount)) continue;

              const candidateFrom = toLowerAddress(candidate.fromAddress);
              const candidateTo = toLowerAddress(candidate.toAddress);
              const isNativeWrap = candidate.isNativeAsset && candidate.type === 'sent' && candidateTo === wrappedReefAddress;
              const isMintWrap = candidate.type === 'received' && candidateFrom === ZERO_ADDRESS;
              const isWreefTransfer = candidate.type === 'sent' && candidateTo === wrappedReefAddress;

              if (isNativeWrap || isMintWrap || isWreefTransfer) {
                consumedIds.add(candidate.id);
                if (candidate.txHash) relatedHashes.add(candidate.txHash.toLowerCase());
              }
            }
          };

          if (isReefSymbol(swap.fromSymbol)) {
            consumeWrapLegs(swap.fromAmount);
          }
          if (isReefSymbol(swap.toSymbol)) {
            consumeWrapLegs(swap.toAmount);
          }

          const feeAmount = Array.from(relatedHashes).reduce((sum, hash) => (
            sum + (txMetaByHash.get(hash)?.feeAmount || 0)
          ), 0);
          const { date, time } = toDisplayDate(swap.timestampMs);

          mergedWithSwaps.push({
            id: `swap:${swap.txHash.toLowerCase()}`,
            txHash: swap.txHash,
            tokenAddress: swap.toTokenAddress,
            tokenIconUrl: null,
            isNativeAsset: false,
            type: 'swap',
            amount: swap.toAmount,
            symbol: swap.toSymbol,
            date,
            time,
            icon: 'swap',
            swapDetails: {
              fromAmount: swap.fromAmount,
              fromSymbol: swap.fromSymbol,
              fromTokenAddress: swap.fromTokenAddress,
              toAmount: swap.toAmount,
              toSymbol: swap.toSymbol,
              toTokenAddress: swap.toTokenAddress,
              feeAmount,
              feeSymbol: REEF_SYMBOL,
            },
            timestampMs: swap.timestampMs,
            fromAddress: null,
            toAddress: null,
          });
        });

        sortedRaw.forEach((tx) => {
          if (consumedIds.has(tx.id)) return;
          mergedWithSwaps.push(tx);
        });

        const merged = mergedWithSwaps
          .sort((a, b) => b.timestampMs - a.timestampMs)
          .slice(0, 80)
          .map(({ timestampMs: _timestampMs, fromAddress: _fromAddress, toAddress: _toAddress, ...tx }) => tx);

        setTransactions(merged);
      } catch (err) {
        console.error('Failed to fetch reef transactions:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchTransactions();
    const interval = setInterval(fetchTransactions, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, isReefReady, selectedNetwork]);

  return { transactions, isLoading };
}
