import { useEffect, useMemo, useRef, useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import { ArrowLeftRight } from 'lucide-react';
import { faArrowsRotate, faRightLeft } from '@fortawesome/free-solid-svg-icons';
import {
  AreaSeries,
  HistogramSeries,
  LineStyle,
  LineType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type SubgraphPair, type SubgraphSwap } from '@/lib/subgraph';
import { useSubgraphPairTransactions } from '@/hooks/useSubgraph';
import { resolveTokenIconUrl } from '@/lib/tokenIcons';
import './pool-detail.css';

type ActionTab = 'trade' | 'stake' | 'unstake';
type ChartTab = 'price' | 'liquidity' | 'volume' | 'fees';
type Timeframe = '1h' | '1D' | '1W' | '1M';

type PoolDetailPageProps = {
  pair: SubgraphPair | null;
};

type ChartPoint = {
  time: number;
  value: number;
};

type AggregationMode = 'last' | 'sum';

const CHART_SAMPLE_SIZE = 500;
const SWAP_FEE_RATE = 0.003;

const TIMEFRAME_LOOKBACK_SECONDS: Record<Timeframe, number> = {
  '1h': 60 * 60,
  '1D': 24 * 60 * 60,
  '1W': 7 * 24 * 60 * 60,
  '1M': 30 * 24 * 60 * 60,
};

const TIMEFRAME_BUCKET_SECONDS: Record<Timeframe, number> = {
  '1h': 2 * 60,
  '1D': 15 * 60,
  '1W': 2 * 60 * 60,
  '1M': 6 * 60 * 60,
};

const asNumber = (value: string | number | null | undefined): number => {
  const parsed = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const asTimestamp = (value: string | number | null | undefined): number => {
  const timestamp = Math.trunc(asNumber(value));
  return timestamp > 0 ? timestamp : 0;
};

const formatUsd = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value))
);

const formatTokenAmount = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(asNumber(value))
);

const formatRate = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(asNumber(value))
);

const formatCompact = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(asNumber(value))
);

const deriveSwapPrice = (swap: SubgraphSwap): number => {
  const token0Delta = Math.max(asNumber(swap.amount0In), asNumber(swap.amount0Out));
  const token1Delta = Math.max(asNumber(swap.amount1In), asNumber(swap.amount1Out));
  if (token0Delta <= 0 || token1Delta <= 0) return 0;
  return token1Delta / token0Delta;
};

const formatAxisValue = (chartTab: ChartTab, value: number): string => {
  if (chartTab === 'price') {
    const decimals = Math.abs(value) < 0.01 ? 6 : (Math.abs(value) < 1 ? 4 : 2);
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const aggregatePointsByBucket = (points: ChartPoint[], bucketSeconds: number, mode: AggregationMode): ChartPoint[] => {
  if (!points.length) return [];

  const buckets = new Map<number, { last: number; sum: number }>();
  for (const point of points) {
    const bucketTime = Math.trunc(point.time / bucketSeconds) * bucketSeconds;
    const previous = buckets.get(bucketTime);
    if (!previous) {
      buckets.set(bucketTime, { last: point.value, sum: point.value });
      continue;
    }
    previous.last = point.value;
    previous.sum += point.value;
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, values]) => ({ time, value: mode === 'sum' ? values.sum : values.last }));
};

const fillMissingBuckets = (points: ChartPoint[], bucketSeconds: number, mode: AggregationMode): ChartPoint[] => {
  if (!points.length) return [];

  const bucketMap = new Map<number, number>();
  points.forEach((point) => bucketMap.set(point.time, point.value));

  const start = points[0].time;
  const end = points[points.length - 1].time;
  let carryValue = points[0].value;
  const filled: ChartPoint[] = [];

  for (let cursor = start; cursor <= end; cursor += bucketSeconds) {
    if (bucketMap.has(cursor)) {
      carryValue = bucketMap.get(cursor) as number;
      filled.push({ time: cursor, value: carryValue });
      continue;
    }
    filled.push({ time: cursor, value: mode === 'sum' ? 0 : carryValue });
  }

  return filled;
};

const slicePointsForTimeframe = (
  points: ChartPoint[],
  timeframe: Timeframe,
  preserveContinuity: boolean,
): ChartPoint[] => {
  if (!points.length) return [];

  const lookback = TIMEFRAME_LOOKBACK_SECONDS[timeframe];
  const latestTime = points[points.length - 1]?.time ?? Math.trunc(Date.now() / 1000);
  const endTime = Math.max(Math.trunc(Date.now() / 1000), latestTime);
  const startTime = endTime - lookback;

  const inRange = points.filter((point) => point.time >= startTime && point.time <= endTime);
  if (!preserveContinuity) {
    return [
      { time: startTime, value: 0 },
      ...inRange,
      { time: endTime, value: 0 },
    ].sort((a, b) => a.time - b.time);
  }

  const withContinuity = [...inRange];
  const previousPoint = [...points].reverse().find((point) => point.time < startTime);
  if (previousPoint && (withContinuity.length === 0 || withContinuity[0].time > startTime)) {
    withContinuity.unshift({ time: startTime, value: previousPoint.value });
  }

  if (!withContinuity.length) {
    const fallbackValue = points[points.length - 1]?.value ?? 0;
    return [
      { time: startTime, value: fallbackValue },
      { time: endTime, value: fallbackValue },
    ];
  }

  const lastValue = withContinuity[withContinuity.length - 1]?.value ?? 0;
  if (withContinuity[withContinuity.length - 1]?.time < endTime) {
    withContinuity.push({ time: endTime, value: lastValue });
  }
  return withContinuity;
};

const formatChartValue = (
  tab: ChartTab,
  value: number,
  token0Symbol: string,
  token1Symbol: string,
): string => {
  if (tab === 'price') return `${formatRate(value)} ${token1Symbol} / ${token0Symbol}`;
  return formatUsd(value);
};

const tabLabelByValue: Record<ChartTab, string> = {
  price: 'Price',
  liquidity: 'Liquidity',
  volume: 'Volume',
  fees: 'Fees',
};

type PoolSeriesChartProps = {
  points: ChartPoint[];
  chartTab: ChartTab;
  timeframe: Timeframe;
};

const PoolSeriesChart = ({ points, chartTab, timeframe }: PoolSeriesChartProps): JSX.Element => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !points.length) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 560,
      layout: {
        background: { type: 'solid', color: '#ece9f4' },
        textColor: '#7f7a92',
        fontSize: 14,
      },
      grid: {
        vertLines: { color: '#cfd0de' },
        horzLines: { color: '#cfd0de' },
      },
      crosshair: {
        vertLine: { color: '#a52ec0', labelBackgroundColor: '#a52ec0', style: LineStyle.Dashed, width: 1 },
        horzLine: { color: '#a52ec0', labelBackgroundColor: '#a52ec0', style: LineStyle.Dashed, width: 1 },
      },
      leftPriceScale: { visible: false },
      rightPriceScale: {
        borderColor: '#b9bdd2',
        minimumWidth: 90,
        scaleMargins: { top: 0.08, bottom: 0.06 },
      },
      timeScale: {
        borderColor: '#b9bdd2',
        timeVisible: timeframe === '1h' || timeframe === '1D',
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: timeframe === '1h' ? 18 : 16,
        minBarSpacing: 8,
        fixRightEdge: false,
      },
    });
    chartRef.current = chart;

    const seriesData = points.map((point) => ({
      time: point.time as UTCTimestamp,
      value: point.value,
    }));

    if (chartTab === 'volume' || chartTab === 'fees') {
      const histogramSeries = chart.addSeries(HistogramSeries, {
        color: chartTab === 'fees' ? '#d248a3' : '#7f44bf',
        priceFormat: {
          type: 'custom',
          formatter: (value: number) => formatAxisValue(chartTab, value),
          minMove: 0.01,
        },
        lastValueVisible: true,
        priceLineVisible: false,
      });
      histogramSeries.setData(seriesData.map((item, index) => {
        const previous = seriesData[index - 1];
        const isDown = Boolean(previous) && item.value < previous.value;
        return {
          ...item,
          color: isDown
            ? (chartTab === 'fees' ? '#c43d9a' : '#6a3ab3')
            : (chartTab === 'fees' ? '#e45db7' : '#9f63d7'),
        };
      }));
    } else {
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: '#ac35c1',
        lineWidth: 3,
        lineType: LineType.WithSteps,
        topColor: 'rgba(172, 53, 193, 0.30)',
        bottomColor: 'rgba(172, 53, 193, 0.06)',
        priceFormat: {
          type: 'custom',
          formatter: (value: number) => formatAxisValue(chartTab, value),
          minMove: chartTab === 'price' ? 0.000001 : 0.01,
        },
        lastValueVisible: true,
        priceLineVisible: true,
        priceLineColor: '#a52ec0',
        priceLineStyle: LineStyle.Dotted,
        priceLineWidth: 2,
      });
      areaSeries.setData(seriesData);
    }

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [chartTab, timeframe, points]);

  return <div className="pool-detail-chart__canvas" ref={chartContainerRef} />;
};

const PoolDetailPage = ({ pair }: PoolDetailPageProps): JSX.Element => {
  const [actionTab, setActionTab] = useState<ActionTab>('trade');
  const [chartTab, setChartTab] = useState<ChartTab>('price');
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const {
    data: pairTransactions,
    isLoading: isChartLoading,
    isError: hasChartError,
  } = useSubgraphPairTransactions(pair?.id, CHART_SAMPLE_SIZE);

  const token0Symbol = pair?.token0.symbol || 'REEF';
  const token1Symbol = pair?.token1.symbol || 'TOKEN';
  const token0Address = pair?.token0.id || null;
  const token1Address = pair?.token1.id || null;
  const token0Icon = resolveTokenIconUrl({ address: token0Address, symbol: token0Symbol, iconUrl: null });
  const token1Icon = resolveTokenIconUrl({ address: token1Address, symbol: token1Symbol, iconUrl: null });
  const reserve0 = asNumber(pair?.reserve0);
  const reserve1 = asNumber(pair?.reserve1);
  const reserveTotal = reserve0 + reserve1;
  const token0Weight = reserveTotal > 0 ? (reserve0 / reserveTotal) * 100 : 0;
  const token1Weight = reserveTotal > 0 ? (reserve1 / reserveTotal) * 100 : 0;

  const poolStatsTokens = [
    {
      symbol: token0Symbol,
      percent: token0Weight.toFixed(2),
      usdPrice: formatUsd(asNumber(pair?.reserveUSD) > 0 ? asNumber(pair?.reserveUSD) / Math.max(reserve0, 1) : 0),
      ratio: `1 ${token0Symbol} = ${formatRate(pair?.token0Price)} ${token1Symbol}`,
      totalLiquidity: formatTokenAmount(reserve0),
      myLiquidity: '-',
      fees24h: '-',
    },
    {
      symbol: token1Symbol,
      percent: token1Weight.toFixed(2),
      usdPrice: formatUsd(asNumber(pair?.reserveUSD) > 0 ? asNumber(pair?.reserveUSD) / Math.max(reserve1, 1) : 0),
      ratio: `1 ${token1Symbol} = ${formatRate(pair?.token1Price)} ${token0Symbol}`,
      totalLiquidity: formatTokenAmount(reserve1),
      myLiquidity: '-',
      fees24h: '-',
    },
  ];

  const totalTransactions = (pairTransactions?.swaps.length || 0) + (pairTransactions?.mints.length || 0) + (pairTransactions?.burns.length || 0);
  const txSummaryText = 'Show Transactions';

  const chartPoints = useMemo<ChartPoint[]>(() => {
    if (!pair) return [];

    const reserveUsd = asNumber(pair.reserveUSD);
    const swaps = (pairTransactions?.swaps || [])
      .map((swap) => ({
        timestamp: asTimestamp(swap.timestamp),
        amountUsd: asNumber(swap.amountUSD),
        price: deriveSwapPrice(swap),
      }))
      .filter((swap) => swap.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    const mints = (pairTransactions?.mints || [])
      .map((mint) => ({
        timestamp: asTimestamp(mint.timestamp),
        amountUsd: Math.abs(asNumber(mint.amountUSD)),
      }))
      .filter((mint) => mint.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    const burns = (pairTransactions?.burns || [])
      .map((burn) => ({
        timestamp: asTimestamp(burn.timestamp),
        amountUsd: Math.abs(asNumber(burn.amountUSD)),
      }))
      .filter((burn) => burn.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    const now = Math.trunc(Date.now() / 1000);
    let rawPoints: ChartPoint[] = [];
    let aggregationMode: AggregationMode = 'last';
    let preserveContinuity = true;

    if (chartTab === 'price') {
      rawPoints = swaps
        .filter((swap) => swap.price > 0)
        .map((swap) => ({ time: swap.timestamp, value: swap.price }));
      if (!rawPoints.length) {
        rawPoints = [{ time: now, value: asNumber(pair.token0Price) }];
      }
    } else if (chartTab === 'volume') {
      aggregationMode = 'sum';
      preserveContinuity = false;
      rawPoints = swaps
        .filter((swap) => swap.amountUsd > 0)
        .map((swap) => ({ time: swap.timestamp, value: swap.amountUsd }));
      if (!rawPoints.length) {
        rawPoints = [{ time: now, value: 0 }];
      }
    } else if (chartTab === 'fees') {
      aggregationMode = 'sum';
      preserveContinuity = false;
      rawPoints = swaps
        .filter((swap) => swap.amountUsd > 0)
        .map((swap) => ({ time: swap.timestamp, value: swap.amountUsd * SWAP_FEE_RATE }));
      if (!rawPoints.length) {
        rawPoints = [{ time: now, value: 0 }];
      }
    } else {
      const liquidityDeltas = [
        ...mints.map((mint) => ({ time: mint.timestamp, delta: mint.amountUsd })),
        ...burns.map((burn) => ({ time: burn.timestamp, delta: -burn.amountUsd })),
      ].sort((a, b) => a.time - b.time);
      const totalDelta = liquidityDeltas.reduce((accumulator, event) => accumulator + event.delta, 0);
      let runningLiquidity = Math.max(reserveUsd - totalDelta, 0);

      rawPoints = liquidityDeltas.map((event) => {
        runningLiquidity = Math.max(runningLiquidity + event.delta, 0);
        return { time: event.time, value: runningLiquidity };
      });

      if (!rawPoints.length) {
        rawPoints = [{ time: now, value: reserveUsd }];
      } else if (rawPoints[rawPoints.length - 1]?.time < now) {
        rawPoints.push({ time: now, value: runningLiquidity });
      }
    }

    const timeframePoints = slicePointsForTimeframe(rawPoints, timeframe, preserveContinuity);
    const bucketedPoints = aggregatePointsByBucket(
      timeframePoints,
      TIMEFRAME_BUCKET_SECONDS[timeframe],
      aggregationMode,
    );
    const filledPoints = fillMissingBuckets(bucketedPoints, TIMEFRAME_BUCKET_SECONDS[timeframe], aggregationMode);

    if (filledPoints.length >= 2) return filledPoints;
    if (filledPoints.length === 1) {
      return [
        filledPoints[0],
        { time: filledPoints[0].time + TIMEFRAME_BUCKET_SECONDS[timeframe], value: filledPoints[0].value },
      ];
    }

    return [
      { time: now - TIMEFRAME_BUCKET_SECONDS[timeframe], value: 0 },
      { time: now, value: 0 },
    ];
  }, [pair, pairTransactions, chartTab, timeframe]);

  const latestChartPoint = chartPoints[chartPoints.length - 1];
  const latestChartValue = latestChartPoint?.value ?? 0;

  return (
    <div className="pool">
      <section className="pool-stats">
        <div className="pool-stats__wrapper">
          <div className="pool-stats__main">
            <div className="pool-stats__toolbar">
              <div className="pool-stats__pool-select">
                <div className="pool-stats__pool-select-pair">
                  <img
                    src={token0Icon}
                    alt={token0Symbol}
                    className={`pool-stats__pool-select-pair--${Uik.utils.slug(token0Symbol)}`}
                  />
                  <img
                    src={token1Icon}
                    alt={token1Symbol}
                    className={`pool-stats__pool-select-pair--${Uik.utils.slug(token1Symbol)}`}
                  />
                </div>
                <span className="pool-stats__pool-select-name">{token0Symbol} / {token1Symbol}</span>
              </div>

              <Uik.Button
                className="pool-stats__transactions-btn"
                text={txSummaryText}
                size="small"
                icon={faRightLeft}
                onClick={() => {}}
              />
            </div>

            <div className="pool-stats__main-stats">
              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">Total Value Locked</div>
                <div className="pool-stats__main-stat-value">{formatUsd(pair?.reserveUSD)}</div>
              </div>

              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">My Liquidity</div>
                <div className="pool-stats__main-stat-value">{formatUsd(0)}</div>
              </div>

              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">24h Volume</div>
                <div className="pool-stats__main-stat-value">
                  <span>{formatUsd(pair?.volumeUSD)}</span>
                  <Uik.Trend type="good" direction="up" text={`${totalTransactions > 0 ? '+' : ''}${totalTransactions.toFixed(2)}%`} />
                </div>
              </div>
            </div>
          </div>

          <div className="pool-stats__tokens">
            {poolStatsTokens.map((token) => (
              <article key={token.symbol} className="pool-stats__token">
                <div className="pool-stats__token-info">
                  <div className="pool-stats__token-main">
                    <img
                      src={token.symbol === token0Symbol ? token0Icon : token1Icon}
                      alt={token.symbol}
                      className={`pool-stats__token-image pool-stats__token-image--${Uik.utils.slug(token.symbol)}`}
                    />
                    <div>
                      <div className="pool-stats__token-name">{token.symbol}</div>
                      <div className="pool-stats__token-percentage">{token.percent}%</div>
                    </div>
                  </div>

                  <div>
                    <div className="pool-stats__token-price">{token.usdPrice}</div>
                    <div className="pool-stats__token-value-ratio">{token.ratio}</div>
                  </div>
                </div>

                <div className="pool-stats__token-stats">
                  <div className="pool-stats__token-stat">
                    <div className="pool-stats__token-stat-label">Total Liquidity</div>
                    <div className="pool-stats__token-stat-value">{token.totalLiquidity}</div>
                  </div>
                  <div className="pool-stats__token-stat">
                    <div className="pool-stats__token-stat-label">My Liquidity</div>
                    <div className="pool-stats__token-stat-value">{token.myLiquidity}</div>
                  </div>
                  <div className="pool-stats__token-stat">
                    <div className="pool-stats__token-stat-label">Fees 24h</div>
                    <div className="pool-stats__token-stat-value">{token.fees24h}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pool__content">
        <div className="uik-pool-actions pool-actions">
          <div className="uik-pool-actions__top">
            <Uik.Tabs
              value={actionTab}
              onChange={(value) => setActionTab(value as ActionTab)}
              options={[
                { value: 'trade', text: 'Trade' },
                { value: 'stake', text: 'Stake' },
                { value: 'unstake', text: 'Unstake' },
              ]}
            />
          </div>

          <div className="pool-actions__panel">
            <div className="pool-token-input">
              <div className="pool-token-input__left">
                <span className="pool-icon pool-icon--reef">
                  <Uik.ReefIcon className="pool-icon__reef-mark" />
                </span>
                <div>
                  <p className="pool-token-input__symbol">{token0Symbol}</p>
                  <p className="pool-token-input__balance">{formatTokenAmount(reserve0)} {token0Symbol}</p>
                </div>
              </div>
              <p className="pool-token-input__amount">0.0</p>
            </div>

            <div className="pool-slider-block">
              <button type="button" className="pool-slider-switch-btn" aria-label="Switch assets">
                <ArrowLeftRight size={18} />
              </button>
              <div className="pool-slider-track-wrap">
                <span className="pool-slider-badge">0%</span>
                <div className="pool-slider-track">
                  <span className="pool-slider-track__fill" style={{ width: '2%' }} />
                  {[0, 1, 2, 3, 4].map((dot) => (
                    <span key={dot} className={`pool-slider-track__dot ${dot === 0 ? 'is-active' : ''}`} />
                  ))}
                </div>
                <div className="pool-slider-track__labels">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="pool-token-input">
              <div className="pool-token-input__left">
                <span className="pool-icon pool-icon--flpr">{token1Symbol.slice(0, 1)}</span>
                <div>
                  <p className="pool-token-input__symbol">{token1Symbol}</p>
                  <p className="pool-token-input__balance">{formatTokenAmount(reserve1)} {token1Symbol}</p>
                </div>
              </div>
              <p className="pool-token-input__amount">0.0</p>
            </div>

            <div className="pool-trade-meta">
              <div><span>Rate</span><strong>1 {token0Symbol} = {formatRate(pair?.token0Price)} {token1Symbol}</strong></div>
              <div><span>Fee</span><strong>0.3%</strong></div>
              <div><span>Slippage</span><strong>0.8%</strong></div>
            </div>

            <div className="pool-slider-track-wrap pool-slider-track-wrap--slippage">
              <span className="pool-slider-badge">0.8%</span>
              <div className="pool-slider-track">
                <span className="pool-slider-track__fill" style={{ width: '5%' }} />
                {[0, 1, 2, 3, 4].map((dot) => (
                  <span key={dot} className={`pool-slider-track__dot ${dot === 0 ? 'is-active' : ''}`} />
                ))}
              </div>
            </div>

            <Uik.Button
              className="pool-actions__swap-btn"
              text={`Missing ${token0Symbol} amount`}
              icon={faArrowsRotate}
              disabled
              onClick={() => {}}
            />
          </div>
        </div>

        <div className="pool-chart">
          <Uik.Card>
            <div className="pool-chart__top">
              <Uik.Tabs
                value={chartTab}
                onChange={(value) => setChartTab(value as ChartTab)}
                options={[
                  { value: 'price', text: `${token1Symbol}/${token0Symbol}` },
                  { value: 'liquidity', text: 'Liquidity' },
                  { value: 'volume', text: 'Volume' },
                  { value: 'fees', text: 'Fees' },
                ]}
              />

              <Uik.Tabs
                value={timeframe}
                onChange={(value) => setTimeframe(value as Timeframe)}
                options={[
                  { value: '1h', text: '1h' },
                  { value: '1D', text: '1D' },
                  { value: '1W', text: '1W' },
                  { value: '1M', text: '1M' },
                ]}
              />
            </div>

            <div className="pool-detail-chart">
              {!pair ? (
                <div className="pool-detail-chart__status">Select a pool to load chart data.</div>
              ) : isChartLoading ? (
                <div className="pool-detail-chart__status">
                  <Uik.Loading />
                </div>
              ) : hasChartError ? (
                <div className="pool-detail-chart__status">Could not load chart data from subgraph.</div>
              ) : (
                <PoolSeriesChart points={chartPoints} chartTab={chartTab} timeframe={timeframe} />
              )}
            </div>

            <div className="pool-detail-chart__summary">
              <div className="pool-detail-chart__summary-label">
                <span>{tabLabelByValue[chartTab]} ({timeframe})</span>
                <strong>{formatChartValue(chartTab, latestChartValue, token0Symbol, token1Symbol)}</strong>
              </div>
              <div className="pool-detail-chart__summary-meta">
                {totalTransactions > 0 ? `${formatCompact(totalTransactions)} tx indexed` : 'No transactions indexed yet'}
              </div>
            </div>
          </Uik.Card>
        </div>
      </section>
    </div>
  );
};

export default PoolDetailPage;
