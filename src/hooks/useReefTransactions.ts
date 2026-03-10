import { useEffect, useState } from 'react';
import { getNetwork } from 'reef-evm-util-lib';
import { formatUnits } from 'viem';
import { useReefState } from '@/contexts/ReefStateContext';

const REEF_DECIMALS = 18;

export interface ReefTransaction {
  id: string;
  txHash: string | null;
  tokenAddress: string | null;
  tokenIconUrl?: string | null;
  isNativeAsset: boolean;
  type: 'sent' | 'received';
  amount: number;
  symbol: string;
  date: string;
  time: string;
  icon: string;
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
        const [txRes, tokenTransferRes] = await Promise.all([
          fetch(`${blockExplorerUrl}/api/v2/addresses/${address}/transactions`, {
            headers: { accept: 'application/json' },
          }),
          fetch(`${blockExplorerUrl}/api/v2/addresses/${address}/token-transfers`, {
            headers: { accept: 'application/json' },
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
              symbol: 'REEF',
              date,
              time,
              icon: 'reef',
              timestampMs,
            } satisfies MappedTransaction;
          })
          .filter((tx): tx is MappedTransaction => tx !== null);

        const erc20Transfers: MappedTransaction[] = (tokenTransfersData.items || [])
          .map((transfer, index) => {
            if (transfer.token_type && transfer.token_type !== 'ERC-20') return null;

            const fromLower = transfer.from?.hash?.toLowerCase();
            const toLower = transfer.to?.hash?.toLowerCase();
            if (fromLower !== lowerAddress && toLower !== lowerAddress) return null;

            const decimalsParsed = Number.parseInt(String(transfer.total?.decimals ?? REEF_DECIMALS), 10);
            const decimals = Number.isInteger(decimalsParsed) && decimalsParsed >= 0 ? decimalsParsed : REEF_DECIMALS;
            const amountRaw = toBigIntSafe(transfer.total?.value);
            const amount = toFiniteNumber(amountRaw, decimals);
            if (amount <= 0) return null;

            const symbol = String(transfer.token?.symbol || 'TOKEN').toUpperCase();
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
            } satisfies MappedTransaction;
          })
          .filter((tx): tx is MappedTransaction => tx !== null);

        const merged = [...erc20Transfers, ...nativeTransactions]
          .sort((a, b) => b.timestampMs - a.timestampMs)
          .slice(0, 80)
          .map(({ timestampMs: _timestampMs, ...tx }) => tx);

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
