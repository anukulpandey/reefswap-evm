import { useState, useEffect } from 'react';

interface ReefPriceResponse {
  currency_pair: string;
  last: string;
  lowest_ask: string;
  highest_bid: string;
  change_percentage: string;
  base_volume: string;
  quote_volume: string;
  high_24h: string;
  low_24h: string;
}

export function useReefPrice() {
  const [price, setPrice] = useState<number>(0);
  const [change24h, setChange24h] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchPrice = async () => {
      try {
        const res = await fetch('/api/gateio/api/v4/spot/tickers?currency_pair=REEF_USDT');
        if (!res.ok) return;
        const arr: ReefPriceResponse[] = await res.json();
        const data = arr[0];
        if (!data) return;
        if (cancelled) return;
        setPrice(parseFloat(data.last));
        setChange24h(parseFloat(data.change_percentage));
        setIsLoading(false);
      } catch {
        // silently retry on next interval
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 60_000); // refresh every 60s

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { price, change24h, isLoading };
}
