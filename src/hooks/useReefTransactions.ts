import { useEffect, useState } from 'react';
import { getNetwork } from 'reef-evm-util-lib';
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
        const data = await res.json();
        if (cancelled) return;

        const lowerAddress = address.toLowerCase();
        const mapped: ReefTransaction[] = (data.items || []).map((tx: any) => {
          const isSent = tx.from?.hash?.toLowerCase() === lowerAddress;
          const weiValue = BigInt(tx.value || '0');
          const amount = Number(weiValue) / 10 ** REEF_DECIMALS;
          const ts = new Date(tx.timestamp);

          return {
            id: tx.hash,
            type: isSent ? 'sent' : 'received',
            amount,
            symbol: 'REEF',
            date: ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            time: ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            icon: 'reef',
          } satisfies ReefTransaction;
        });

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
