import { useEffect, useMemo, useState } from 'react';
import { getNetwork, network$ } from 'reef-evm-util-lib';
import { useReefState } from '@/contexts/ReefStateContext';

const FALLBACK_EXPLORER_URL = 'https://reefscan.com';

const normalizeExplorerUrl = (url?: string | null) => {
  if (!url) return FALLBACK_EXPLORER_URL;
  return url.replace(/\/+$/, '');
};

const getCurrentExplorerUrl = () => {
  try {
    return normalizeExplorerUrl(getNetwork().blockExplorerUrl);
  } catch {
    return FALLBACK_EXPLORER_URL;
  }
};

export function useReefExplorer(address?: string) {
  const { isReefReady } = useReefState();
  const [explorerUrl, setExplorerUrl] = useState(FALLBACK_EXPLORER_URL);

  useEffect(() => {
    if (!isReefReady) return;

    setExplorerUrl(getCurrentExplorerUrl());

    const subscription = network$.subscribe((network) => {
      setExplorerUrl(normalizeExplorerUrl(network?.blockExplorerUrl));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isReefReady]);

  const accountExplorerUrl = useMemo(() => {
    if (!address) return explorerUrl;
    return `${explorerUrl}/account/${address}`;
  }, [address, explorerUrl]);

  return {
    explorerUrl,
    accountExplorerUrl,
  };
}
