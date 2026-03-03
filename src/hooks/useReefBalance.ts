import { useEffect, useState } from 'react';
import { getNetwork } from 'reef-evm-util-lib';
import { useReefState } from '@/contexts/ReefStateContext';

const REEF_DECIMALS = 18;
const DEFAULT_REEF_RPC_URL = '/api/reef-rpc';
const REEF_RPC_URL = import.meta.env.VITE_REEF_RPC_URL || DEFAULT_REEF_RPC_URL;

type JsonRpcResponse<T> = {
  result?: T;
  error?: { message?: string };
};

const getRpcUrl = () => {
  try {
    const networkRpcUrl = getNetwork().evmRpcUrl;
    if (!networkRpcUrl) return REEF_RPC_URL;
    // Keep localhost calls behind Vite proxy to avoid browser CORS preflight failures.
    if (networkRpcUrl.includes('localhost')) return REEF_RPC_URL;
    return networkRpcUrl;
  } catch {
    return REEF_RPC_URL;
  }
};

async function getRpcBalance(address: string): Promise<bigint> {
  const response = await fetch(getRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcResponse<string>;
  if (payload.error) {
    throw new Error(payload.error.message || 'RPC returned an error');
  }
  if (!payload.result) {
    throw new Error('RPC response did not include a balance result');
  }

  return BigInt(payload.result);
}

export function useReefBalance(address: string | undefined) {
  const { isReefReady, selectedNetwork } = useReefState();
  const [balance, setBalance] = useState<number>(0);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (!address || !isReefReady) return;

    let cancelled = false;
    setHasFetched(false);

    const fetchBalance = async () => {
      try {
        const weiBalance = await getRpcBalance(address);
        if (!cancelled) {
          setBalance(Number(weiBalance) / 10 ** REEF_DECIMALS);
          setHasFetched(true);
        }
      } catch (err) {
        console.error('Failed to fetch reef balance:', err);
        if (!cancelled) {
          setHasFetched(true);
        }
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, isReefReady, selectedNetwork]);

  const isLoading = !!address && !hasFetched;

  return { balance, isLoading };
}
