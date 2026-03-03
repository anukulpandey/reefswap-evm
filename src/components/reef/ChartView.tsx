import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import Uik from '@reef-chain/ui-kit';
import { ExternalLink } from 'lucide-react';
import { useReefPriceHistory, type Timeframe } from '@/hooks/useReefPriceHistory';
import { useReefPrice } from '@/hooks/useReefPrice';
import { contracts } from '@/lib/config';

const POOL_ADDRESS = '0x3D37D5452BDeA164666291890D2830A82be141E1';
const WREEF_ADDRESS = contracts.wrappedReef;

const TIMEFRAMES: Timeframe[] = ['1h', '1D', '1W', '1M'];
const CHART_TABS = ['Price', 'Volume'] as const;
type ChartTab = typeof CHART_TABS[number];

const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 4 }).format(n);

const LWChartComponent = ({
  candles,
  tab,
  timeframe,
}: {
  candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
  tab: ChartTab;
  timeframe: Timeframe;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || !candles.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      height: 300,
      layout: {
        textColor: '#898e9c',
        fontSize: 12,
        background: { type: 'solid' as const, color: '#eeebf6' },
      },
      rightPriceScale: { borderColor: '#b7becf' },
      timeScale: {
        borderColor: '#b7becf',
        timeVisible: timeframe === '1h' || timeframe === '1D',
      },
      crosshair: {
        vertLine: { color: '#a328ab', labelBackgroundColor: '#a328ab' },
        horzLine: { color: '#a328ab', labelBackgroundColor: '#a328ab' },
      },
      grid: {
        vertLines: { color: '#d8dce6' },
        horzLines: { color: '#d8dce6' },
      },
    });

    chartRef.current = chart;

    if (tab === 'Price') {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#35c47c',
        downColor: '#e73644',
        borderVisible: false,
        wickUpColor: '#35c47c',
        wickDownColor: '#e73644',
      });
      series.setData(
        candles.map((c) => ({
          time: c.time as number,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
    } else {
      const upSeries = chart.addSeries(HistogramSeries, { color: '#35c47c' });
      const downSeries = chart.addSeries(HistogramSeries, { color: '#e73644' });
      const upData: { time: number; value: number }[] = [];
      const downData: { time: number; value: number }[] = [];
      candles.forEach((c, i) => {
        const prev = candles[i - 1];
        const item = { time: c.time as number, value: c.volume };
        if (!prev || c.close >= prev.close) upData.push(item);
        else downData.push(item);
      });
      upSeries.setData(upData);
      downSeries.setData(downData);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, tab, timeframe]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: 300 }} />
  );
};

interface ChartViewProps {
  onNavigate: (route: string) => void;
}

const ChartView = ({ onNavigate }: ChartViewProps) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [tab, setTab] = useState<ChartTab>('Price');
  const { candles, isLoading } = useReefPriceHistory(timeframe);
  const { price: reefPrice, change24h } = useReefPrice();

  const lastCandle = candles[candles.length - 1];
  const priceChangeColor = change24h >= 0 ? 'text-[#35c47c]' : 'text-[#e73644]';

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => onNavigate('swap')}
          className="text-sm text-[#8e899c] hover:text-[#5d3bad] transition-colors"
        >
          ← Back to Swap
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart card */}
        <div className="lg:col-span-2">
          <Uik.Card>
            {/* Pool header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#a93185] to-[#5d3bad] flex items-center justify-center z-10">
                    <Uik.ReefIcon className="h-5 w-5 text-white" />
                  </div>
                  <div className="w-9 h-9 rounded-full bg-[#e0d8f0] flex items-center justify-center border-2 border-white">
                    <Uik.ReefSign className="h-4 w-4 text-[#7a3bbd]" />
                  </div>
                </div>
                <div>
                  <p className="text-base font-semibold text-[var(--text)]">REEF / WREEF</p>
                  <p className="text-xs text-[var(--text-light)]">0.3% fee · Reefswap</p>
                </div>
              </div>
              <a
                href={`https://reefscan.com/contract/${POOL_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-[#b13c8e] hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                View on Reefscan
              </a>
            </div>

            {/* Price display */}
            <div className="mb-4">
              <p className="text-3xl font-bold text-[var(--text)]">
                {lastCandle ? formatUsd(lastCandle.close) : formatUsd(reefPrice)}
              </p>
              <p className={`text-sm font-medium mt-0.5 ${priceChangeColor}`}>
                {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}% (24h)
              </p>
            </div>

            {/* Chart type + timeframe tabs */}
            <div className="flex items-center justify-between mb-3">
              <Uik.Tabs
                value={tab}
                onChange={(v) => setTab(v as ChartTab)}
                options={CHART_TABS.map((t) => ({ value: t, text: t }))}
              />
              <Uik.Tabs
                value={timeframe}
                onChange={(v) => setTimeframe(v as Timeframe)}
                options={TIMEFRAMES.map((t) => ({ value: t, text: t }))}
              />
            </div>

            {/* Chart */}
            {isLoading && !candles.length ? (
              <div className="flex items-center justify-center" style={{ height: 300 }}>
                <Uik.Loading />
              </div>
            ) : (
              <LWChartComponent candles={candles} tab={tab} timeframe={timeframe} />
            )}

            <p className="text-xs text-[#898e9c] mt-2 text-right">
              Price data: REEF/USDT via Gate.io ·{' '}
              <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="hover:underline">
                Chart by TradingView
              </a>
            </p>
          </Uik.Card>
        </div>

        {/* Pool stats + actions */}
        <div className="space-y-4">
          {/* Pool stats */}
          <Uik.Card>
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text)' }}>Pool Info</h3>
            <div className="space-y-3">
              {[
                { label: 'Pool address', value: `${POOL_ADDRESS.slice(0, 8)}…${POOL_ADDRESS.slice(-6)}` },
                { label: 'Token 1', value: 'REEF (native)' },
                { label: 'Token 2', value: `WREEF (${WREEF_ADDRESS.slice(0, 6)}…)` },
                { label: 'Fee tier', value: '0.3%' },
              ].map((item) => (
                <div key={item.label} className="flex justify-between items-center">
                  <span className="text-sm" style={{ color: 'var(--text-light)' }}>{item.label}</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{item.value}</span>
                </div>
              ))}
            </div>
          </Uik.Card>

          {/* Actions */}
          <Uik.Card>
            <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--text)' }}>Actions</h3>
            <div className="space-y-2">
              <Uik.Button
                text="Trade REEF → WREEF"
                fill
                size="large"
                className="w-full"
                onClick={() => onNavigate('swap')}
              />
              <Uik.Button
                text="Add Liquidity"
                size="large"
                className="w-full"
                onClick={() => onNavigate('pools')}
              />
            </div>
          </Uik.Card>
        </div>
      </div>
    </div>
  );
};

export default ChartView;
