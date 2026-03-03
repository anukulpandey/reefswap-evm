import { useEffect, useState } from 'react';

export type Timeframe = '1h' | '1D' | '1W' | '1M';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const INTERVAL_MAP: Record<Timeframe, { interval: string; limit: number }> = {
  '1h': { interval: '1m', limit: 60 },
  '1D': { interval: '1h', limit: 24 },
  '1W': { interval: '4h', limit: 42 },
  '1M': { interval: '1d', limit: 30 },
};

export const useReefPriceHistory = (timeframe: Timeframe) => {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { interval, limit } = INTERVAL_MAP[timeframe];

    const fetch_ = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/gateio/api/v4/spot/candlesticks?currency_pair=REEF_USDT&interval=${interval}&limit=${limit}`,
        );
        if (!res.ok) throw new Error('fetch failed');
        // Gate.io format: [timestamp, volume, close, high, low, open, bool]
        const raw: string[][] = await res.json();
        if (cancelled) return;
        const data: Candle[] = raw.map((c) => ({
          time: Number(c[0]),
          open: parseFloat(c[5]),
          high: parseFloat(c[3]),
          low: parseFloat(c[4]),
          close: parseFloat(c[2]),
          volume: parseFloat(c[1]),
        }));
        setCandles(data);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetch_();
    return () => { cancelled = true; };
  }, [timeframe]);

  return { candles, isLoading };
};
