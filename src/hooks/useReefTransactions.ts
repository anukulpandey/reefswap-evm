import { useEffect, useState } from 'react';
import { getNetwork } from 'reef-evm-util-lib';
import { formatUnits } from 'viem';
import { useReefState } from '@/contexts/ReefStateContext';

const REEF_DECIMALS = 18;

export interface ReefTransaction {
  id: string;
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
        const res = await fetch(
          `${blockExplorerUrl}/api/v2/addresses/${address}/transactions`,
          { headers: { accept: 'application/json' } },
        );
        const data = await res.json() as ExplorerTransactionsResponse;
        if (cancelled) return;

        const lowerAddress = address.toLowerCase();
        const mapped: ReefTransaction[] = (data.items || []).map((tx) => {
          const nativeIsSent = tx.from?.hash?.toLowerCase() === lowerAddress;
          const nativeValue = toBigIntSafe(tx.value);

          let type: ReefTransaction['type'] = nativeIsSent ? 'sent' : 'received';
          let symbol = 'REEF';
          let amount = toFiniteNumber(nativeValue, REEF_DECIMALS);

          const transfer = tx.token_transfers?.find((item) => {
            const transferFrom = item.from?.hash?.toLowerCase();
            const transferTo = item.to?.hash?.toLowerCase();
            return transferFrom === lowerAddress || transferTo === lowerAddress;
          });

          if (transfer) {
            const transferFrom = transfer.from?.hash?.toLowerCase();
            const transferTo = transfer.to?.hash?.toLowerCase();
            const transferIsSent = transferFrom === lowerAddress && transferTo !== lowerAddress;
            type = transferIsSent ? 'sent' : 'received';

            const tokenDecimals = Number.parseInt(
              String(transfer.total?.decimals ?? transfer.token?.decimals ?? REEF_DECIMALS),
              10,
            );
            const decimals = Number.isInteger(tokenDecimals) && tokenDecimals >= 0 ? tokenDecimals : REEF_DECIMALS;

            const transferRaw = toBigIntSafe(transfer.total?.value ?? transfer.value);
            const transferAmount = toFiniteNumber(transferRaw, decimals);
            if (transferAmount > 0) {
              amount = transferAmount;
              symbol = String(transfer.token?.symbol || 'TOKEN').toUpperCase();
            }
          }

          if (amount <= 0) return null;

          const timestamp = tx.timestamp ? new Date(tx.timestamp) : new Date();
          const safeDate = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;

          return {
            id: tx.hash,
            type,
            amount,
            symbol,
            date: safeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            time: safeDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            icon: symbol === 'REEF' ? 'reef' : symbol.charAt(0),
          } satisfies ReefTransaction;
        }).filter((tx): tx is ReefTransaction => tx !== null);

        setTransactions(mapped);
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
