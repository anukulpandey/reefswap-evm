import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import { faArrowUpFromBracket, faArrowsRotate, faCoins, faRightLeft } from '@fortawesome/free-solid-svg-icons';
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { formatUnits, getAddress, isAddress, parseUnits, type Address } from 'viem';
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  LineSeries,
  LineType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type SubgraphPair, type SubgraphSwap } from '@/lib/subgraph';
import { erc20Abi, reefswapPairAbi, reefswapRouterAbi, wrappedReefAbi } from '@/lib/abi';
import { contracts, reefChain } from '@/lib/config';
import { useReefPrice } from '@/hooks/useReefPrice';
import { useSubgraphPairTransactions } from '@/hooks/useSubgraph';
import { resolveTokenIconUrl } from '@/lib/tokenIcons';
import { formatDisplayAmount, getErrorMessage, normalizeInput, shortAddress } from '@/lib/utils';
import './pool-detail.css';

type ActionTab = 'trade' | 'stake' | 'unstake';
type ChartTab = 'price' | 'liquidity' | 'volume' | 'fees';
type ChartStyle = 'candles' | 'area' | 'line';
type Timeframe = '1h' | '1D' | '1W' | '1M';

type PoolDetailPageProps = {
  pair: SubgraphPair | null;
  wrappedTokenAddress: Address;
  mode?: 'full' | 'chart';
};

type ChartPoint = {
  time: number;
  value: number;
};

type AggregationMode = 'last' | 'sum';
type TradeToken = {
  symbol: string;
  decimals: number;
  address: Address | null;
  icon: string;
  isCanonicalReef: boolean;
};

type PoolTransactionTab = 'All' | 'Swap' | 'Mint' | 'Burn';

type PoolTransactionEntry = {
  id: string;
  type: Exclude<PoolTransactionTab, 'All'>;
  timestamp: number;
  txHash: string;
  description: string;
  token0Amount: number;
  token1Amount: number;
};

const CHART_SAMPLE_SIZE = 1000;
const SWAP_FEE_RATE = 0.003;
const REEF_USD_FALLBACK = 0.000073;
const MAX_APPROVAL = (2n ** 256n) - 1n;
const TX_DEADLINE_SECONDS = 60 * 20;
const AMOUNT_SLIDER_HELPERS = [
  { position: 0, text: '0%' },
  { position: 25 },
  { position: 50, text: '50%' },
  { position: 75 },
  { position: 100, text: '100%' },
];

const SLIPPAGE_SLIDER_HELPERS = [
  { position: 0, text: '0%' },
  { position: 25 },
  { position: 50, text: '10%' },
  { position: 75 },
  { position: 100, text: '20%' },
];

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

const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  String(a || '').toLowerCase() === String(b || '').toLowerCase();

const isUserRejectionError = (error: unknown): boolean => {
  const code = (error as { code?: number; cause?: { code?: number } })?.code
    ?? (error as { cause?: { code?: number } })?.cause?.code;
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return code === 4001 || message.includes('user rejected') || message.includes('user denied');
};

const trimDecimalString = (value: string): string => {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
};

const getAmountOut = (amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint => {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
};

const applySlippage = (amount: bigint, slippageBps: bigint): bigint => {
  if (amount <= 0n) return 0n;
  const cappedSlippage = slippageBps > 10_000n ? 10_000n : slippageBps;
  return amount - ((amount * cappedSlippage) / 10_000n);
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

const formatPoolTransactionTime = (timestamp: number): string => {
  if (!timestamp) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
};

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
  chartStyle: ChartStyle;
  timeframe: Timeframe;
  showCrosshair: boolean;
  showGrid: boolean;
  steppedLine: boolean;
};

const PoolSeriesChart = ({
  points,
  chartTab,
  chartStyle,
  timeframe,
  showCrosshair,
  showGrid,
  steppedLine,
}: PoolSeriesChartProps): JSX.Element => {
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
        vertLines: { color: showGrid ? '#cfd0de' : 'rgba(0, 0, 0, 0)' },
        horzLines: { color: showGrid ? '#cfd0de' : 'rgba(0, 0, 0, 0)' },
      },
      crosshair: {
        vertLine: {
          visible: showCrosshair,
          color: '#a52ec0',
          labelBackgroundColor: '#a52ec0',
          style: LineStyle.Dashed,
          width: 1,
        },
        horzLine: {
          visible: showCrosshair,
          color: '#a52ec0',
          labelBackgroundColor: '#a52ec0',
          style: LineStyle.Dashed,
          width: 1,
        },
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
      if (chartTab === 'price' && chartStyle === 'candles') {
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#34b57f',
          downColor: '#d84a84',
          wickUpColor: '#34b57f',
          wickDownColor: '#d84a84',
          borderVisible: false,
          priceFormat: {
            type: 'custom',
            formatter: (value: number) => formatAxisValue(chartTab, value),
            minMove: 0.000001,
          },
          lastValueVisible: true,
          priceLineVisible: true,
          priceLineColor: '#a52ec0',
          priceLineStyle: LineStyle.Dotted,
          priceLineWidth: 2,
        });

        candleSeries.setData(points.map((point, index) => {
          const previous = points[index - 1];
          const next = points[index + 1];
          const open = previous ? previous.value : point.value;
          const close = point.value;
          const neighbor = next?.value ?? close;
          const high = Math.max(open, close, neighbor);
          const low = Math.min(open, close, neighbor);
          return {
            time: point.time as UTCTimestamp,
            open,
            high,
            low,
            close,
          };
        }));
      } else if (chartStyle === 'line') {
        const lineSeries = chart.addSeries(LineSeries, {
          color: '#ac35c1',
          lineWidth: 3,
          lineType: steppedLine ? LineType.WithSteps : LineType.Simple,
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
        lineSeries.setData(seriesData);
      } else {
        const areaSeries = chart.addSeries(AreaSeries, {
          lineColor: '#ac35c1',
          lineWidth: 3,
          lineType: steppedLine ? LineType.WithSteps : LineType.Simple,
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
  }, [chartStyle, chartTab, points, showCrosshair, showGrid, steppedLine, timeframe]);

  return <div className="pool-detail-chart__canvas" ref={chartContainerRef} />;
};

const PoolDetailPage = ({ pair, wrappedTokenAddress, mode = 'full' }: PoolDetailPageProps): JSX.Element => {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const publicClient = usePublicClient({ chainId: reefChain.id });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const { price: liveReefUsdPrice } = useReefPrice();

  const [actionTab, setActionTab] = useState<ActionTab>('trade');
  const [chartTab, setChartTab] = useState<ChartTab>('price');
  const [chartStyle, setChartStyle] = useState<ChartStyle>('area');
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [steppedLine, setSteppedLine] = useState(true);
  const [isTradeReversed, setIsTradeReversed] = useState(false);
  const [amountInText, setAmountInText] = useState('');
  const [amountOutText, setAmountOutText] = useState('');
  const [slippagePercentage, setSlippagePercentage] = useState(0.8);
  const [stakeAmountToken0Text, setStakeAmountToken0Text] = useState('');
  const [unstakePercentage, setUnstakePercentage] = useState(0);
  const [quotedOutRaw, setQuotedOutRaw] = useState<bigint>(0n);
  const [balanceIn, setBalanceIn] = useState<bigint>(0n);
  const [balanceOut, setBalanceOut] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [token0WalletBalance, setToken0WalletBalance] = useState<bigint>(0n);
  const [token1WalletBalance, setToken1WalletBalance] = useState<bigint>(0n);
  const [token0LiquidityAllowance, setToken0LiquidityAllowance] = useState<bigint>(0n);
  const [token1LiquidityAllowance, setToken1LiquidityAllowance] = useState<bigint>(0n);
  const [lpTokenBalance, setLpTokenBalance] = useState<bigint>(0n);
  const [lpTokenAllowance, setLpTokenAllowance] = useState<bigint>(0n);
  const [lpTotalSupply, setLpTotalSupply] = useState<bigint>(0n);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [isApprovingLiquidity, setIsApprovingLiquidity] = useState(false);
  const [isStaking, setIsStaking] = useState(false);
  const [isApprovingUnstake, setIsApprovingUnstake] = useState(false);
  const [isUnstaking, setIsUnstaking] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [lastTxHash, setLastTxHash] = useState<Address | null>(null);
  const [isTransactionsOpen, setTransactionsOpen] = useState(false);
  const [transactionsTab, setTransactionsTab] = useState<PoolTransactionTab>('All');
  const accountAddress = (address || walletClient?.account?.address || null) as Address | null;

  const {
    data: pairTransactions,
    isLoading: isChartLoading,
    isError: hasChartError,
    refetch: refetchPairTransactions,
  } = useSubgraphPairTransactions(pair?.id, CHART_SAMPLE_SIZE);

  const token0Address = pair?.token0.id || null;
  const token1Address = pair?.token1.id || null;
  const token0SymbolRaw = pair?.token0.symbol || 'REEF';
  const token1SymbolRaw = pair?.token1.symbol || 'TOKEN';
  const token0SymbolUpper = token0SymbolRaw.toUpperCase();
  const token1SymbolUpper = token1SymbolRaw.toUpperCase();
  const token0IsCanonicalReef = sameAddress(token0Address, wrappedTokenAddress) || token0SymbolUpper === 'WREEF' || token0SymbolUpper === 'REEF';
  const token1IsCanonicalReef = sameAddress(token1Address, wrappedTokenAddress) || token1SymbolUpper === 'WREEF' || token1SymbolUpper === 'REEF';
  const token0Symbol = token0IsCanonicalReef ? 'REEF' : token0SymbolRaw;
  const token1Symbol = token1IsCanonicalReef ? 'REEF' : token1SymbolRaw;
  const token0Decimals = Number.parseInt(pair?.token0.decimals || '18', 10);
  const token1Decimals = Number.parseInt(pair?.token1.decimals || '18', 10);
  const token0SafeDecimals = Number.isInteger(token0Decimals) ? token0Decimals : 18;
  const token1SafeDecimals = Number.isInteger(token1Decimals) ? token1Decimals : 18;
  const token0NormalizedAddress = token0Address && isAddress(token0Address) ? getAddress(token0Address) : null;
  const token1NormalizedAddress = token1Address && isAddress(token1Address) ? getAddress(token1Address) : null;
  const pairNormalizedAddress = pair?.id && isAddress(pair.id) ? getAddress(pair.id) : null;
  const token0Icon = resolveTokenIconUrl({ address: token0Address, symbol: token0SymbolRaw, iconUrl: null });
  const token1Icon = resolveTokenIconUrl({ address: token1Address, symbol: token1SymbolRaw, iconUrl: null });
  const tradeToken0: TradeToken = {
    symbol: token0Symbol,
    decimals: token0SafeDecimals,
    address: token0NormalizedAddress,
    icon: token0Icon,
    isCanonicalReef: token0IsCanonicalReef,
  };
  const tradeToken1: TradeToken = {
    symbol: token1Symbol,
    decimals: token1SafeDecimals,
    address: token1NormalizedAddress,
    icon: token1Icon,
    isCanonicalReef: token1IsCanonicalReef,
  };
  const inputToken = isTradeReversed ? tradeToken1 : tradeToken0;
  const outputToken = isTradeReversed ? tradeToken0 : tradeToken1;
  // Pool pair tokens are always ERC20 contracts (including WREEF), so
  // pool trading/liquidity paths should never use native ETH-style methods.
  const inputUsesNativeReef = false;
  const outputUsesNativeReef = false;
  const isWrongChain = isConnected && chainId !== reefChain.id;
  const hasTradePair = Boolean(inputToken.address && outputToken.address && !sameAddress(inputToken.address, outputToken.address));
  const canUseDirectPairSwap = Boolean(
    hasTradePair &&
    pairNormalizedAddress &&
    token0NormalizedAddress &&
    token1NormalizedAddress &&
    inputToken.address,
  );
  const canUseDirectPairBurn = Boolean(
    pairNormalizedAddress &&
    token0NormalizedAddress &&
    token1NormalizedAddress,
  );
  const swapPath = useMemo(() => (
    hasTradePair
      ? [inputToken.address as Address, outputToken.address as Address]
      : [] as Address[]
  ), [hasTradePair, inputToken.address, outputToken.address]);
  const reserve0 = asNumber(pair?.reserve0);
  const reserve1 = asNumber(pair?.reserve1);
  const reserve0Raw = useMemo(() => {
    if (!pair?.reserve0) return 0n;
    try {
      return parseUnits(pair.reserve0, token0SafeDecimals);
    } catch {
      return 0n;
    }
  }, [pair?.reserve0, token0SafeDecimals]);
  const reserve1Raw = useMemo(() => {
    if (!pair?.reserve1) return 0n;
    try {
      return parseUnits(pair.reserve1, token1SafeDecimals);
    } catch {
      return 0n;
    }
  }, [pair?.reserve1, token1SafeDecimals]);
  const reserveTotal = reserve0 + reserve1;
  const token0Weight = reserveTotal > 0 ? (reserve0 / reserveTotal) * 100 : 0;
  const token1Weight = reserveTotal > 0 ? (reserve1 / reserveTotal) * 100 : 0;
  const reefUsdPrice = liveReefUsdPrice > 0 ? liveReefUsdPrice : REEF_USD_FALLBACK;
  const rawReserveUsd = asNumber(pair?.reserveUSD);
  const token0PriceInToken1 = asNumber(pair?.token0Price);
  const token1PriceInToken0 = asNumber(pair?.token1Price);
  const { token0UsdPrice, token1UsdPrice } = useMemo(() => {
    let nextToken0Usd = 0;
    let nextToken1Usd = 0;

    if (token0IsCanonicalReef) {
      nextToken0Usd = reefUsdPrice;
      if (token1PriceInToken0 > 0) {
        nextToken1Usd = token1PriceInToken0 * nextToken0Usd;
      }
    } else if (token1IsCanonicalReef) {
      nextToken1Usd = reefUsdPrice;
      if (token0PriceInToken1 > 0) {
        nextToken0Usd = token0PriceInToken1 * nextToken1Usd;
      }
    }

    if (nextToken0Usd <= 0 || nextToken1Usd <= 0) {
      if (rawReserveUsd > 0 && reserve0 > 0 && reserve1 > 0) {
        if (token0PriceInToken1 > 0) {
          const token1UsdFromTotal = rawReserveUsd / ((reserve0 * token0PriceInToken1) + reserve1);
          if (Number.isFinite(token1UsdFromTotal) && token1UsdFromTotal > 0) {
            nextToken1Usd = token1UsdFromTotal;
            nextToken0Usd = token0PriceInToken1 * token1UsdFromTotal;
          }
        } else if (token1PriceInToken0 > 0) {
          const token0UsdFromTotal = rawReserveUsd / ((reserve1 * token1PriceInToken0) + reserve0);
          if (Number.isFinite(token0UsdFromTotal) && token0UsdFromTotal > 0) {
            nextToken0Usd = token0UsdFromTotal;
            nextToken1Usd = token1PriceInToken0 * token0UsdFromTotal;
          }
        }
      }
    }

    if (nextToken0Usd <= 0 && rawReserveUsd > 0 && reserve0 > 0) {
      nextToken0Usd = rawReserveUsd / (reserve0 + reserve1 || 1);
    }
    if (nextToken1Usd <= 0 && rawReserveUsd > 0 && reserve1 > 0) {
      nextToken1Usd = rawReserveUsd / (reserve0 + reserve1 || 1);
    }

    return {
      token0UsdPrice: Math.max(0, nextToken0Usd),
      token1UsdPrice: Math.max(0, nextToken1Usd),
    };
  }, [
    rawReserveUsd,
    reefUsdPrice,
    reserve0,
    reserve1,
    token0IsCanonicalReef,
    token0PriceInToken1,
    token1IsCanonicalReef,
    token1PriceInToken0,
  ]);
  const effectiveReserveUsd = useMemo(() => {
    if (rawReserveUsd > 0) return rawReserveUsd;
    const estimated = (reserve0 * token0UsdPrice) + (reserve1 * token1UsdPrice);
    return Number.isFinite(estimated) ? Math.max(0, estimated) : 0;
  }, [rawReserveUsd, reserve0, reserve1, token0UsdPrice, token1UsdPrice]);
  const estimateSwapUsd = useCallback((swap: SubgraphSwap): number => {
    const rawUsd = Math.max(0, asNumber(swap.amountUSD));
    if (rawUsd > 0) return rawUsd;
    const token0Delta = Math.max(Math.abs(asNumber(swap.amount0In)), Math.abs(asNumber(swap.amount0Out)));
    const token1Delta = Math.max(Math.abs(asNumber(swap.amount1In)), Math.abs(asNumber(swap.amount1Out)));
    return Math.max(token0Delta * token0UsdPrice, token1Delta * token1UsdPrice, 0);
  }, [token0UsdPrice, token1UsdPrice]);
  const estimateLiquidityEventUsd = useCallback((amountUsd: string | null, amount0: string | null, amount1: string | null): number => {
    const rawUsd = Math.max(0, asNumber(amountUsd));
    if (rawUsd > 0) return rawUsd;
    return Math.max(
      0,
      (Math.abs(asNumber(amount0)) * token0UsdPrice) + (Math.abs(asNumber(amount1)) * token1UsdPrice),
    );
  }, [token0UsdPrice, token1UsdPrice]);
  const totalTransactions = (pairTransactions?.swaps.length || 0) + (pairTransactions?.mints.length || 0) + (pairTransactions?.burns.length || 0);
  const volume24hUsd = useMemo(() => {
    const swaps = pairTransactions?.swaps || [];
    if (!swaps.length) return 0;
    const cutoff = Math.floor(Date.now() / 1000) - 86_400;
    return swaps.reduce((sum, swap) => {
      const timestamp = asTimestamp(swap.timestamp);
      if (timestamp < cutoff) return sum;
      return sum + estimateSwapUsd(swap);
    }, 0);
  }, [estimateSwapUsd, pairTransactions?.swaps]);
  const previous24hVolumeUsd = useMemo(() => {
    const swaps = pairTransactions?.swaps || [];
    if (!swaps.length) return 0;
    const now = Math.floor(Date.now() / 1000);
    const previousStart = now - (2 * 86_400);
    const previousEnd = now - 86_400;
    return swaps.reduce((sum, swap) => {
      const timestamp = asTimestamp(swap.timestamp);
      if (timestamp < previousStart || timestamp >= previousEnd) return sum;
      return sum + estimateSwapUsd(swap);
    }, 0);
  }, [estimateSwapUsd, pairTransactions?.swaps]);
  const volume24hChange = useMemo(() => {
    if (previous24hVolumeUsd <= 0) return 0;
    return ((volume24hUsd - previous24hVolumeUsd) / previous24hVolumeUsd) * 100;
  }, [previous24hVolumeUsd, volume24hUsd]);
  const explorerTxBaseUrl = useMemo(() => {
    const explorerUrl = reefChain.blockExplorers?.default?.url || 'https://reefscan.com';
    return explorerUrl.replace(/\/$/, '');
  }, []);
  const allPoolTransactions = useMemo<PoolTransactionEntry[]>(() => {
    if (!pairTransactions) return [];

    const swaps = pairTransactions.swaps.map((swap) => {
      const amount0In = Math.max(0, asNumber(swap.amount0In));
      const amount0Out = Math.max(0, asNumber(swap.amount0Out));
      const amount1In = Math.max(0, asNumber(swap.amount1In));
      const amount1Out = Math.max(0, asNumber(swap.amount1Out));
      const token0ToToken1 = amount0In > 0 || (amount1Out > 0 && amount0Out === 0);

      return {
        id: swap.id,
        type: 'Swap' as const,
        timestamp: asTimestamp(swap.timestamp),
        txHash: swap.transaction?.id || swap.id,
        description: `Traded ${token0ToToken1 ? token0Symbol : token1Symbol} for ${token0ToToken1 ? token1Symbol : token0Symbol}`,
        token0Amount: Math.max(amount0In, amount0Out),
        token1Amount: Math.max(amount1In, amount1Out),
      };
    });

    const mints = pairTransactions.mints.map((mint) => ({
      id: mint.id,
      type: 'Mint' as const,
      timestamp: asTimestamp(mint.timestamp),
      txHash: mint.transaction?.id || mint.id,
      description: 'Staked',
      token0Amount: Math.abs(asNumber(mint.amount0)),
      token1Amount: Math.abs(asNumber(mint.amount1)),
    }));

    const burns = pairTransactions.burns.map((burn) => ({
      id: burn.id,
      type: 'Burn' as const,
      timestamp: asTimestamp(burn.timestamp),
      txHash: burn.transaction?.id || burn.id,
      description: 'Unstaked',
      token0Amount: Math.abs(asNumber(burn.amount0)),
      token1Amount: Math.abs(asNumber(burn.amount1)),
    }));

    return [...swaps, ...mints, ...burns].sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return b.id.localeCompare(a.id);
    });
  }, [pairTransactions, token0Symbol, token1Symbol]);
  const visiblePoolTransactions = useMemo(() => (
    transactionsTab === 'All'
      ? allPoolTransactions
      : allPoolTransactions.filter((transaction) => transaction.type === transactionsTab)
  ), [allPoolTransactions, transactionsTab]);
  const openPoolTransaction = useCallback((txHash: string) => {
    if (!txHash) return;
    const prefixedHash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
    const txUrl = `${explorerTxBaseUrl}/tx/${encodeURIComponent(prefixedHash)}`;
    window.open(txUrl, '_blank', 'noopener,noreferrer');
  }, [explorerTxBaseUrl]);
  const myLiquidityShare = useMemo(() => {
    if (lpTokenBalance <= 0n || lpTotalSupply <= 0n) return 0;
    return Number((lpTokenBalance * 1_000_000n) / lpTotalSupply) / 1_000_000;
  }, [lpTokenBalance, lpTotalSupply]);
  const myLiquidityUsd = effectiveReserveUsd * myLiquidityShare;
  const myToken0Liquidity = reserve0 * myLiquidityShare;
  const myToken1Liquidity = reserve1 * myLiquidityShare;
  const estimatedPoolFees24hUsd = volume24hUsd * SWAP_FEE_RATE;
  const myFees24hUsdEstimate = estimatedPoolFees24hUsd * myLiquidityShare;

  const poolStatsTokens = [
    {
      symbol: token0Symbol,
      percent: token0Weight.toFixed(2),
      usdPrice: formatUsd(token0UsdPrice),
      ratio: `1 ${token0Symbol} = ${formatRate(pair?.token0Price)} ${token1Symbol}`,
      totalLiquidity: formatTokenAmount(reserve0),
      myLiquidity: `${formatTokenAmount(myToken0Liquidity)} ${token0Symbol}`,
      fees24h: formatUsd(myFees24hUsdEstimate * (token0Weight / 100)),
    },
    {
      symbol: token1Symbol,
      percent: token1Weight.toFixed(2),
      usdPrice: formatUsd(token1UsdPrice),
      ratio: `1 ${token1Symbol} = ${formatRate(pair?.token1Price)} ${token0Symbol}`,
      totalLiquidity: formatTokenAmount(reserve1),
      myLiquidity: `${formatTokenAmount(myToken1Liquidity)} ${token1Symbol}`,
      fees24h: formatUsd(myFees24hUsdEstimate * (token1Weight / 100)),
    },
  ];
  const parsedAmountIn = useMemo(() => {
    if (!amountInText) return 0n;
    try {
      return parseUnits(amountInText, inputToken.decimals);
    } catch {
      return 0n;
    }
  }, [amountInText, inputToken.decimals]);
  const clampedSlippage = useMemo(() => Math.max(0, Math.min(20, slippagePercentage)), [slippagePercentage]);
  const parsedSlippageBps = useMemo(() => BigInt(Math.round(clampedSlippage * 100)), [clampedSlippage]);
  const minOut = useMemo(() => {
    if (quotedOutRaw <= 0n) return 0n;
    const discount = (quotedOutRaw * parsedSlippageBps) / 10_000n;
    return quotedOutRaw - discount;
  }, [parsedSlippageBps, quotedOutRaw]);
  const hasInsufficientBalance = parsedAmountIn > balanceIn;
  const requiresApproval = !canUseDirectPairSwap && !inputUsesNativeReef && parsedAmountIn > 0n && allowance < parsedAmountIn;
  const amountSliderValue = useMemo(() => {
    if (balanceIn <= 0n || parsedAmountIn <= 0n) return 0;
    const basisPoints = Number((parsedAmountIn * 10_000n) / balanceIn);
    return Math.max(0, Math.min(100, basisPoints / 100));
  }, [balanceIn, parsedAmountIn]);
  const tradePercentage = amountSliderValue;
  const slippageSliderValue = Math.max(0, Math.min(100, Math.round(clampedSlippage * 5)));
  const formattedBalanceIn = formatDisplayAmount(balanceIn, inputToken.decimals);
  const formattedBalanceOut = formatDisplayAmount(balanceOut, outputToken.decimals);
  const dynamicRate = useMemo(() => {
    if (parsedAmountIn <= 0n || quotedOutRaw <= 0n) return 0;
    const inValue = asNumber(formatUnits(parsedAmountIn, inputToken.decimals));
    const outValue = asNumber(formatUnits(quotedOutRaw, outputToken.decimals));
    if (inValue <= 0 || outValue <= 0) return 0;
    return outValue / inValue;
  }, [inputToken.decimals, outputToken.decimals, parsedAmountIn, quotedOutRaw]);
  const rateText = dynamicRate > 0
    ? `1 ${inputToken.symbol} = ${formatRate(dynamicRate)} ${outputToken.symbol}`
    : (
      isTradeReversed
        ? `1 ${token1Symbol} = ${formatRate(pair?.token1Price)} ${token0Symbol}`
        : `1 ${token0Symbol} = ${formatRate(pair?.token0Price)} ${token1Symbol}`
    );
  const canSwap = actionTab === 'trade' &&
    isConnected &&
    !isWrongChain &&
    hasTradePair &&
    parsedAmountIn > 0n &&
    quotedOutRaw > 0n &&
    !isQuoting &&
    !isRefreshing &&
    !hasInsufficientBalance &&
    !quoteError;
  const tradeButtonLabel = !isConnected
    ? (isConnecting ? 'Connecting...' : 'Connect Wallet')
    : isWrongChain
      ? (isSwitching ? 'Switching...' : 'Switch To Reef Chain')
      : isSwapping
        ? 'Swapping...'
        : hasInsufficientBalance
          ? `Insufficient ${inputToken.symbol}`
          : requiresApproval
            ? (isApproving ? 'Approving...' : `Approve ${inputToken.symbol}`)
            : quoteError
              ? 'No Route Found'
              : `Swap ${inputToken.symbol}`;
  const stakeBalanceToken0 = token0WalletBalance;
  const stakeBalanceToken1 = token1WalletBalance;
  const stakeAmountToken0Raw = useMemo(() => {
    if (!stakeAmountToken0Text) return 0n;
    try {
      return parseUnits(stakeAmountToken0Text, tradeToken0.decimals);
    } catch {
      return 0n;
    }
  }, [stakeAmountToken0Text, tradeToken0.decimals]);
  const stakeAmountToken1Raw = useMemo(() => {
    if (stakeAmountToken0Raw <= 0n || reserve0Raw <= 0n || reserve1Raw <= 0n) return 0n;
    return (stakeAmountToken0Raw * reserve1Raw) / reserve0Raw;
  }, [reserve0Raw, reserve1Raw, stakeAmountToken0Raw]);
  const stakePercentage = useMemo(() => {
    if (stakeBalanceToken0 <= 0n || stakeAmountToken0Raw <= 0n) return 0;
    const basisPoints = Number((stakeAmountToken0Raw * 10_000n) / stakeBalanceToken0);
    return Math.max(0, Math.min(100, basisPoints / 100));
  }, [stakeAmountToken0Raw, stakeBalanceToken0]);
  const stakeAmountToken1 = trimDecimalString(formatUnits(stakeAmountToken1Raw, tradeToken1.decimals));
  const hasStakeInsufficientToken0 = stakeAmountToken0Raw > stakeBalanceToken0;
  const hasStakeInsufficientToken1 = stakeAmountToken1Raw > stakeBalanceToken1;
  const hasStakeInsufficientBalance = hasStakeInsufficientToken0 || hasStakeInsufficientToken1;
  const stakeApprovalAddress = useMemo<Address | null>(() => {
    if (stakeAmountToken0Raw > 0n && token0LiquidityAllowance < stakeAmountToken0Raw) return token0NormalizedAddress;
    if (stakeAmountToken1Raw > 0n && token1LiquidityAllowance < stakeAmountToken1Raw) return token1NormalizedAddress;
    return null;
  }, [
    stakeAmountToken0Raw,
    stakeAmountToken1Raw,
    token0LiquidityAllowance,
    token0NormalizedAddress,
    token1LiquidityAllowance,
    token1NormalizedAddress,
  ]);
  const stakeApprovalSymbol = stakeApprovalAddress && token0NormalizedAddress && sameAddress(stakeApprovalAddress, token0NormalizedAddress)
    ? tradeToken0.symbol
    : tradeToken1.symbol;
  const stakeTotalUsd = useMemo(() => {
    const amount0 = asNumber(formatUnits(stakeAmountToken0Raw, tradeToken0.decimals));
    const amount1 = asNumber(formatUnits(stakeAmountToken1Raw, tradeToken1.decimals));
    return Math.max(0, (amount0 * token0UsdPrice) + (amount1 * token1UsdPrice));
  }, [stakeAmountToken0Raw, stakeAmountToken1Raw, token0UsdPrice, token1UsdPrice, tradeToken0.decimals, tradeToken1.decimals]);
  const canStake = actionTab === 'stake' &&
    isConnected &&
    !isWrongChain &&
    Boolean(token0NormalizedAddress && token1NormalizedAddress) &&
    stakeAmountToken0Raw > 0n &&
    stakeAmountToken1Raw > 0n &&
    !hasStakeInsufficientBalance &&
    !stakeApprovalAddress &&
    !isRefreshing;
  const stakeButtonLabel = stakeAmountToken0Raw <= 0n
    ? `Missing ${tradeToken0.symbol} amount`
    : stakeApprovalAddress
      ? (isApprovingLiquidity ? `Approving ${stakeApprovalSymbol}...` : `Approve ${stakeApprovalSymbol}`)
    : hasStakeInsufficientBalance
      ? `Insufficient ${hasStakeInsufficientToken0 ? tradeToken0.symbol : tradeToken1.symbol}`
      : (isStaking ? 'Staking...' : 'Stake Now');
  const stakeFormattedBalanceToken0 = formatDisplayAmount(stakeBalanceToken0, tradeToken0.decimals);
  const stakeFormattedBalanceToken1 = formatDisplayAmount(stakeBalanceToken1, tradeToken1.decimals);
  const formattedStakeTotal = `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(stakeTotalUsd)}`;
  const unstakeLiquidityRaw = useMemo(() => {
    if (unstakePercentage <= 0 || lpTokenBalance <= 0n) return 0n;
    const basisPoints = BigInt(Math.round(unstakePercentage * 100));
    return (lpTokenBalance * basisPoints) / 10_000n;
  }, [lpTokenBalance, unstakePercentage]);
  const unstakeAmountToken0Raw = useMemo(() => {
    if (unstakeLiquidityRaw <= 0n || lpTotalSupply <= 0n || reserve0Raw <= 0n) return 0n;
    return (reserve0Raw * unstakeLiquidityRaw) / lpTotalSupply;
  }, [lpTotalSupply, reserve0Raw, unstakeLiquidityRaw]);
  const unstakeAmountToken1Raw = useMemo(() => {
    if (unstakeLiquidityRaw <= 0n || lpTotalSupply <= 0n || reserve1Raw <= 0n) return 0n;
    return (reserve1Raw * unstakeLiquidityRaw) / lpTotalSupply;
  }, [lpTotalSupply, reserve1Raw, unstakeLiquidityRaw]);
  const unstakeAmountToken0 = formatDisplayAmount(unstakeAmountToken0Raw, tradeToken0.decimals, 6);
  const unstakeAmountToken1 = formatDisplayAmount(unstakeAmountToken1Raw, tradeToken1.decimals, 6);
  const unstakeValueUsd = useMemo(() => {
    const amount0 = asNumber(formatUnits(unstakeAmountToken0Raw, tradeToken0.decimals));
    const amount1 = asNumber(formatUnits(unstakeAmountToken1Raw, tradeToken1.decimals));
    return Math.max(0, (amount0 * token0UsdPrice) + (amount1 * token1UsdPrice));
  }, [token0UsdPrice, token1UsdPrice, tradeToken0.decimals, tradeToken1.decimals, unstakeAmountToken0Raw, unstakeAmountToken1Raw]);
  const hasUnstakeInsufficientBalance = unstakeLiquidityRaw > lpTokenBalance;
  const unstakeRequiresApproval = !canUseDirectPairBurn && unstakeLiquidityRaw > 0n && lpTokenAllowance < unstakeLiquidityRaw;
  const canUnstake = actionTab === 'unstake' &&
    isConnected &&
    !isWrongChain &&
    Boolean(token0NormalizedAddress && token1NormalizedAddress && pairNormalizedAddress) &&
    unstakeLiquidityRaw > 0n &&
    !hasUnstakeInsufficientBalance &&
    !unstakeRequiresApproval &&
    !isRefreshing;
  const formattedUnstakeValue = `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(unstakeValueUsd)}`;
  const unstakeButtonLabel = unstakeLiquidityRaw <= 0n
    ? 'Insufficient pool balance'
    : unstakeRequiresApproval
      ? (isApprovingUnstake ? 'Approving LP Token...' : 'Approve LP Token')
      : hasUnstakeInsufficientBalance
        ? 'Insufficient pool balance'
        : (isUnstaking ? 'Unstaking...' : 'Unstake Now');

  const clearTradeQuote = useCallback(() => {
    setAmountOutText('');
    setQuotedOutRaw(0n);
    setQuoteError('');
    setQuoteNote('');
    setIsQuoting(false);
  }, []);

  const refreshTradeState = useCallback(async () => {
    if (!publicClient || !accountAddress) {
      setBalanceIn(0n);
      setBalanceOut(0n);
      setAllowance(0n);
      setToken0WalletBalance(0n);
      setToken1WalletBalance(0n);
      setToken0LiquidityAllowance(0n);
      setToken1LiquidityAllowance(0n);
      setLpTokenBalance(0n);
      setLpTokenAllowance(0n);
      setLpTotalSupply(0n);
      return;
    }

    const readBalance = (tokenAddress: Address | null): Promise<bigint> => (
      tokenAddress
        ? publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [accountAddress],
        }).catch(() => 0n)
        : Promise.resolve(0n)
    );
    const readAllowance = (tokenAddress: Address | null): Promise<bigint> => (
      tokenAddress
        ? publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [accountAddress, contracts.router],
        }).catch(() => 0n)
        : Promise.resolve(0n)
    );
    const readTotalSupply = (tokenAddress: Address | null): Promise<bigint> => (
      tokenAddress
        ? publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'totalSupply',
        }).catch(() => 0n)
        : Promise.resolve(0n)
    );

    setIsRefreshing(true);
    try {
      const nativeBalance = await publicClient.getBalance({ address: accountAddress }).catch(() => 0n);
      const readDisplayTradeBalance = (token: TradeToken): Promise<bigint> => (
        readBalance(token.address).then((erc20Balance) => (
          token.isCanonicalReef ? (erc20Balance + nativeBalance) : erc20Balance
        ))
      );
      const readDisplayStakeBalance = (tokenAddress: Address | null, isCanonicalReefToken: boolean): Promise<bigint> => (
        readBalance(tokenAddress).then((erc20Balance) => (
          isCanonicalReefToken ? (erc20Balance + nativeBalance) : erc20Balance
        ))
      );

      const [nextBalanceIn, nextBalanceOut, nextAllowance, nextToken0Balance, nextToken1Balance, nextToken0Allowance, nextToken1Allowance, nextLpBalance, nextLpAllowance, nextLpTotalSupply] = await Promise.all([
        readDisplayTradeBalance(inputToken),
        readDisplayTradeBalance(outputToken),
        inputUsesNativeReef ? Promise.resolve(MAX_APPROVAL) : readAllowance(inputToken.address),
        readDisplayStakeBalance(token0NormalizedAddress, tradeToken0.isCanonicalReef),
        readDisplayStakeBalance(token1NormalizedAddress, tradeToken1.isCanonicalReef),
        readAllowance(token0NormalizedAddress),
        readAllowance(token1NormalizedAddress),
        readBalance(pairNormalizedAddress),
        readAllowance(pairNormalizedAddress),
        readTotalSupply(pairNormalizedAddress),
      ]);
      setBalanceIn(nextBalanceIn);
      setBalanceOut(nextBalanceOut);
      setAllowance(nextAllowance);
      setToken0WalletBalance(nextToken0Balance);
      setToken1WalletBalance(nextToken1Balance);
      setToken0LiquidityAllowance(nextToken0Allowance);
      setToken1LiquidityAllowance(nextToken1Allowance);
      setLpTokenBalance(nextLpBalance);
      setLpTokenAllowance(nextLpAllowance);
      setLpTotalSupply(nextLpTotalSupply);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    accountAddress,
    inputToken.address,
    inputToken.isCanonicalReef,
    inputUsesNativeReef,
    outputToken.isCanonicalReef,
    outputToken.address,
    outputUsesNativeReef,
    pairNormalizedAddress,
    publicClient,
    tradeToken0.isCanonicalReef,
    tradeToken1.isCanonicalReef,
    token0NormalizedAddress,
    token1NormalizedAddress,
  ]);

  useEffect(() => {
    refreshTradeState().catch(() => {
      setIsRefreshing(false);
    });
  }, [refreshTradeState]);

  useEffect(() => {
    setIsTradeReversed(false);
    setStakeAmountToken0Text('');
    setUnstakePercentage(0);
    clearTradeQuote();
    setAmountInText('');
  }, [clearTradeQuote, pair?.id]);

  useEffect(() => {
    if (actionTab !== 'trade') return;
    if (parsedAmountIn <= 0n) {
      clearTradeQuote();
      return;
    }
    if (!publicClient || !hasTradePair || swapPath.length < 2) {
      clearTradeQuote();
      return;
    }

    setIsQuoting(true);
    setQuoteError('');
    setQuoteNote('');

    const timer = setTimeout(() => {
      publicClient
        .readContract({
          address: contracts.router,
          abi: reefswapRouterAbi,
          functionName: 'getAmountsOut',
          args: [parsedAmountIn, swapPath],
        })
        .then((amounts) => {
          const output = amounts[amounts.length - 1];
          setQuotedOutRaw(output);
          setAmountOutText(formatDisplayAmount(output, outputToken.decimals, 8));
        })
        .catch(() => {
          try {
            if (!pair || !token0NormalizedAddress || !token1NormalizedAddress || !inputToken.address) {
              throw new Error('no fallback pair');
            }
            const reserve0Raw = parseUnits(pair.reserve0, token0SafeDecimals);
            const reserve1Raw = parseUnits(pair.reserve1, token1SafeDecimals);
            const inputIsToken0 = sameAddress(inputToken.address, token0NormalizedAddress);
            const reserveIn = inputIsToken0 ? reserve0Raw : reserve1Raw;
            const reserveOut = inputIsToken0 ? reserve1Raw : reserve0Raw;
            const output = getAmountOut(parsedAmountIn, reserveIn, reserveOut);
            if (output <= 0n) throw new Error('insufficient output');
            setQuotedOutRaw(output);
            setAmountOutText(formatDisplayAmount(output, outputToken.decimals, 8));
            setQuoteNote('Router quote unavailable; using pool reserve fallback.');
            setQuoteError('');
          } catch {
            clearTradeQuote();
            setQuoteError('No route found for this pair and amount.');
          }
        })
        .finally(() => setIsQuoting(false));
    }, 350);

    return () => clearTimeout(timer);
  }, [
    actionTab,
    clearTradeQuote,
    hasTradePair,
    inputToken.address,
    outputToken.decimals,
    pair,
    parsedAmountIn,
    publicClient,
    swapPath,
    token0NormalizedAddress,
    token0SafeDecimals,
    token1NormalizedAddress,
    token1SafeDecimals,
  ]);

  const setAmountByPercent = (percent: number) => {
    const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    if (balanceIn <= 0n || safePercent <= 0) {
      setAmountInText(safePercent === 0 ? '0' : '');
      return;
    }
    const basisPoints = BigInt(Math.round(safePercent * 100));
    const raw = (balanceIn * basisPoints) / 10_000n;
    setAmountInText(trimDecimalString(formatUnits(raw, inputToken.decimals)));
  };

  const setStakeAmountByPercent = (percent: number) => {
    const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    if (stakeBalanceToken0 <= 0n || safePercent <= 0) {
      setStakeAmountToken0Text(safePercent === 0 ? '0' : '');
      return;
    }
    const basisPoints = BigInt(Math.round(safePercent * 100));
    const raw = (stakeBalanceToken0 * basisPoints) / 10_000n;
    setStakeAmountToken0Text(trimDecimalString(formatUnits(raw, tradeToken0.decimals)));
  };

  const onStakeAmountToken0Change = (value: string) => {
    setStakeAmountToken0Text(normalizeInput(value));
  };

  const setSlippageFromSlider = (position: number) => {
    const percentage = Math.max(0, Math.min(20, position / 5));
    setSlippagePercentage(percentage);
  };

  const onSwitchTradeTokens = () => {
    setIsTradeReversed((current) => !current);
    setAmountInText('');
    clearTradeQuote();
  };

  const connectWallet = async () => {
    const connector = connectors.find((item) => item.id === 'metaMask') || connectors[0];
    if (!connector) {
      Uik.notify.danger({ message: 'No injected wallet connector found. Install MetaMask first.' });
      return;
    }
    try {
      await connectAsync({ connector });
    } catch (error) {
      Uik.notify.danger({ message: getErrorMessage(error) });
    }
  };

  const switchToReef = async () => {
    try {
      await switchChainAsync({ chainId: reefChain.id });
    } catch (error) {
      Uik.notify.danger({ message: getErrorMessage(error) });
    }
  };

  const approve = async () => {
    if (!walletClient || !publicClient || !accountAddress || !inputToken.address || !hasTradePair || inputUsesNativeReef) return;

    setIsApproving(true);
    Uik.notify.info({ message: 'Submitting approval...' });
    try {
      const hash = await walletClient.writeContract({
        account: accountAddress,
        chain: reefChain,
        address: inputToken.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contracts.router, MAX_APPROVAL],
      });
      setLastTxHash(hash);
      Uik.notify.info({ message: `Approval submitted. Tx: ${shortAddress(hash)}` });
      await publicClient.waitForTransactionReceipt({ hash });
      Uik.notify.success({ message: 'Approval confirmed.' });
      await refreshTradeState();
    } catch (error) {
      Uik.notify.danger({ message: getErrorMessage(error) });
    } finally {
      setIsApproving(false);
    }
  };

  const swap = async () => {
    if (!walletClient || !publicClient || !accountAddress || !hasTradePair || parsedAmountIn <= 0n || quotedOutRaw <= 0n) return;

    setIsSwapping(true);
    Uik.notify.info({ message: 'Submitting swap...' });
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);
      const executeDirectPairSwap = async (): Promise<Address> => {
        if (!pairNormalizedAddress || !token0NormalizedAddress || !token1NormalizedAddress || !inputToken.address) {
          throw new Error('Direct pair swap is unavailable for this pool.');
        }

        const reserves = await publicClient.readContract({
          address: pairNormalizedAddress,
          abi: reefswapPairAbi,
          functionName: 'getReserves',
        });
        const reserve0 = reserves[0];
        const reserve1 = reserves[1];
        const inputIsToken0 = sameAddress(inputToken.address, token0NormalizedAddress);
        const reserveIn = inputIsToken0 ? reserve0 : reserve1;
        const reserveOut = inputIsToken0 ? reserve1 : reserve0;
        const quotedOut = getAmountOut(parsedAmountIn, reserveIn, reserveOut);
        if (quotedOut <= 0n) {
          throw new Error('No output amount available for this pool.');
        }
        const directOut = applySlippage(quotedOut, parsedSlippageBps);
        const amountOut = directOut > 0n ? directOut : quotedOut;

        const transferHash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: inputToken.address,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [pairNormalizedAddress, parsedAmountIn],
        });
        setLastTxHash(transferHash);
        Uik.notify.info({ message: `Transferred to pair. Tx: ${shortAddress(transferHash)}` });
        await publicClient.waitForTransactionReceipt({ hash: transferHash });

        return walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: pairNormalizedAddress,
          abi: reefswapPairAbi,
          functionName: 'swap',
          args: [
            inputIsToken0 ? 0n : amountOut,
            inputIsToken0 ? amountOut : 0n,
            accountAddress,
            '0x',
          ],
        });
      };

      let hash: Address;
      if (inputToken.isCanonicalReef && inputToken.address) {
        const wrappedBalance = await publicClient.readContract({
          address: inputToken.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [accountAddress],
        }).catch(() => 0n);

        if (wrappedBalance < parsedAmountIn) {
          const wrapAmount = parsedAmountIn - wrappedBalance;
          const wrapHash = await walletClient.writeContract({
            account: accountAddress,
            chain: reefChain,
            address: inputToken.address,
            abi: wrappedReefAbi,
            functionName: 'deposit',
            args: [],
            value: wrapAmount,
          });
          setLastTxHash(wrapHash);
          Uik.notify.info({ message: `Wrapping REEF. Tx: ${shortAddress(wrapHash)}` });
          await publicClient.waitForTransactionReceipt({ hash: wrapHash });
        }
      }

      if (inputUsesNativeReef && !outputUsesNativeReef) {
        hash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: contracts.router,
          abi: reefswapRouterAbi,
          functionName: 'swapExactETHForTokens',
          args: [minOut, swapPath, accountAddress, deadline],
          value: parsedAmountIn,
        });
      } else if (!inputUsesNativeReef && outputUsesNativeReef) {
        hash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: contracts.router,
          abi: reefswapRouterAbi,
          functionName: 'swapExactTokensForETH',
          args: [parsedAmountIn, minOut, swapPath, accountAddress, deadline],
        });
      } else if (canUseDirectPairSwap) {
        hash = await executeDirectPairSwap();
      } else {
        hash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: contracts.router,
          abi: reefswapRouterAbi,
          functionName: 'swapExactTokensForTokens',
          args: [parsedAmountIn, minOut, swapPath, accountAddress, deadline],
        });
      }
      setLastTxHash(hash);
      Uik.notify.info({ message: `Swap submitted. Tx: ${shortAddress(hash)}` });
      await publicClient.waitForTransactionReceipt({ hash });
      Uik.notify.success({ message: 'Swap confirmed.' });
      setAmountInText('');
      clearTradeQuote();
      await refreshTradeState();
    } catch (error) {
      Uik.notify.danger({ message: getErrorMessage(error) });
    } finally {
      setIsSwapping(false);
    }
  };

  const approveLiquidityToken = async () => {
    if (!walletClient || !publicClient || !accountAddress || !stakeApprovalAddress) return;

    setIsApprovingLiquidity(true);
    Uik.notify.info({ message: `Submitting ${stakeApprovalSymbol} approval...` });
    try {
      const hash = await walletClient.writeContract({
        account: accountAddress,
        chain: reefChain,
        address: stakeApprovalAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contracts.router, MAX_APPROVAL],
      });
      setLastTxHash(hash);
      Uik.notify.info({ message: `Approval submitted. Tx: ${shortAddress(hash)}` });
      await publicClient.waitForTransactionReceipt({ hash });
      Uik.notify.success({ message: `${stakeApprovalSymbol} approval confirmed.` });
      await refreshTradeState();
    } catch (error) {
      Uik.notify.danger({ message: getErrorMessage(error) });
    } finally {
      setIsApprovingLiquidity(false);
    }
  };

  const stakeLiquidity = async () => {
    if (
      !walletClient ||
      !publicClient ||
      !accountAddress ||
      !token0NormalizedAddress ||
      !token1NormalizedAddress ||
      stakeAmountToken0Raw <= 0n ||
      stakeAmountToken1Raw <= 0n
    ) {
      return;
    }

    setIsStaking(true);
    Uik.notify.info({ message: 'Submitting add liquidity...' });
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);
      const minAmount0 = applySlippage(stakeAmountToken0Raw, parsedSlippageBps);
      const minAmount1 = applySlippage(stakeAmountToken1Raw, parsedSlippageBps);
      const addLiquidityViaPairMint = async (): Promise<Address> => {
        if (!pairNormalizedAddress) throw new Error('Pair address is unavailable for direct mint.');

        const transfer0Hash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: token0NormalizedAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [pairNormalizedAddress, stakeAmountToken0Raw],
        });
        setLastTxHash(transfer0Hash);
        Uik.notify.info({ message: `Transferred ${tradeToken0.symbol}. Tx: ${shortAddress(transfer0Hash)}` });
        await publicClient.waitForTransactionReceipt({ hash: transfer0Hash });

        const transfer1Hash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: token1NormalizedAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [pairNormalizedAddress, stakeAmountToken1Raw],
        });
        setLastTxHash(transfer1Hash);
        Uik.notify.info({ message: `Transferred ${tradeToken1.symbol}. Tx: ${shortAddress(transfer1Hash)}` });
        await publicClient.waitForTransactionReceipt({ hash: transfer1Hash });

        return walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: pairNormalizedAddress,
          abi: reefswapPairAbi,
          functionName: 'mint',
          args: [accountAddress],
        });
      };

      const ensureWrappedBalance = async (tokenAddress: Address, requiredAmount: bigint) => {
        if (!sameAddress(tokenAddress, wrappedTokenAddress) || requiredAmount <= 0n) return;
        const wrappedBalance = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [accountAddress],
        }).catch(() => 0n);

        if (wrappedBalance >= requiredAmount) return;
        const wrapAmount = requiredAmount - wrappedBalance;
        const wrapHash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: tokenAddress,
          abi: wrappedReefAbi,
          functionName: 'deposit',
          args: [],
          value: wrapAmount,
        });
        setLastTxHash(wrapHash);
        Uik.notify.info({ message: `Wrapping REEF. Tx: ${shortAddress(wrapHash)}` });
        await publicClient.waitForTransactionReceipt({ hash: wrapHash });
      };

      await ensureWrappedBalance(token0NormalizedAddress, stakeAmountToken0Raw);
      await ensureWrappedBalance(token1NormalizedAddress, stakeAmountToken1Raw);

      let hash: Address;
      try {
        hash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: contracts.router,
          abi: reefswapRouterAbi,
          functionName: 'addLiquidity',
          args: [
            token0NormalizedAddress,
            token1NormalizedAddress,
            stakeAmountToken0Raw,
            stakeAmountToken1Raw,
            minAmount0,
            minAmount1,
            accountAddress,
            deadline,
          ],
        });
      } catch (routerAddError) {
        if (isUserRejectionError(routerAddError)) throw routerAddError;
        Uik.notify.info({ message: 'Router add failed. Falling back to direct pair mint...' });
        hash = await addLiquidityViaPairMint();
      }

      setLastTxHash(hash);
      Uik.notify.info({ message: `Liquidity add submitted. Tx: ${shortAddress(hash)}` });
      await publicClient.waitForTransactionReceipt({ hash });
      Uik.notify.success({ message: 'Liquidity added successfully.' });
      setStakeAmountToken0Text('');
      await refreshTradeState();
      await refetchPairTransactions();
    } catch (error) {
      Uik.notify.danger({ message: getErrorMessage(error) });
    } finally {
      setIsStaking(false);
    }
  };

  const approveUnstakeToken = async () => {
    if (!walletClient || !publicClient || !accountAddress || !pairNormalizedAddress) return;

    setIsApprovingUnstake(true);
    Uik.notify.info({ message: 'Submitting LP token approval...' });
    try {
      const hash = await walletClient.writeContract({
        account: accountAddress,
        chain: reefChain,
        address: pairNormalizedAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contracts.router, MAX_APPROVAL],
      });
      setLastTxHash(hash);
      Uik.notify.info({ message: `Approval submitted. Tx: ${shortAddress(hash)}` });
      await publicClient.waitForTransactionReceipt({ hash });
      Uik.notify.success({ message: 'LP approval confirmed.' });
      await refreshTradeState();
    } catch (error) {
      Uik.notify.danger({ message: getErrorMessage(error) });
    } finally {
      setIsApprovingUnstake(false);
    }
  };

  const unstakeLiquidity = async () => {
    if (
      !walletClient ||
      !publicClient ||
      !accountAddress ||
      !token0NormalizedAddress ||
      !token1NormalizedAddress ||
      unstakeLiquidityRaw <= 0n
    ) {
      return;
    }

    setIsUnstaking(true);
    Uik.notify.info({ message: 'Submitting remove liquidity...' });
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);
      const minAmount0 = applySlippage(unstakeAmountToken0Raw, parsedSlippageBps);
      const minAmount1 = applySlippage(unstakeAmountToken1Raw, parsedSlippageBps);
      const removeLiquidityViaPairBurn = async (): Promise<Address> => {
        if (!pairNormalizedAddress) throw new Error('Pair address is unavailable for direct burn.');

        const transferLpHash = await walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: pairNormalizedAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [pairNormalizedAddress, unstakeLiquidityRaw],
        });
        setLastTxHash(transferLpHash);
        Uik.notify.info({ message: `Transferred LP to pair. Tx: ${shortAddress(transferLpHash)}` });
        await publicClient.waitForTransactionReceipt({ hash: transferLpHash });

        return walletClient.writeContract({
          account: accountAddress,
          chain: reefChain,
          address: pairNormalizedAddress,
          abi: reefswapPairAbi,
          functionName: 'burn',
          args: [accountAddress],
        });
      };

      let hash: Address;
      if (canUseDirectPairBurn) {
        hash = await removeLiquidityViaPairBurn();
      } else {
        try {
          hash = await walletClient.writeContract({
            account: accountAddress,
            chain: reefChain,
            address: contracts.router,
            abi: reefswapRouterAbi,
            functionName: 'removeLiquidity',
            args: [
              token0NormalizedAddress,
              token1NormalizedAddress,
              unstakeLiquidityRaw,
              minAmount0,
              minAmount1,
              accountAddress,
              deadline,
            ],
          });
        } catch (routerRemoveError) {
          if (isUserRejectionError(routerRemoveError)) throw routerRemoveError;
          Uik.notify.info({ message: 'Router remove failed. Falling back to direct pair burn...' });
          hash = await removeLiquidityViaPairBurn();
        }
      }

      setLastTxHash(hash);
      Uik.notify.info({ message: `Liquidity remove submitted. Tx: ${shortAddress(hash)}` });
      await publicClient.waitForTransactionReceipt({ hash });
      Uik.notify.success({ message: 'Liquidity removed successfully.' });
      setUnstakePercentage(0);
      await refreshTradeState();
      await refetchPairTransactions();
    } catch (error) {
      Uik.notify.danger({ message: getErrorMessage(error) });
    } finally {
      setIsUnstaking(false);
    }
  };

  const chartPoints = useMemo<ChartPoint[]>(() => {
    if (!pair) return [];

    const reserveUsd = effectiveReserveUsd;
    const swaps = (pairTransactions?.swaps || [])
      .map((swap) => ({
        timestamp: asTimestamp(swap.timestamp),
        amountUsd: estimateSwapUsd(swap),
        price: deriveSwapPrice(swap),
      }))
      .filter((swap) => swap.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    const mints = (pairTransactions?.mints || [])
      .map((mint) => ({
        timestamp: asTimestamp(mint.timestamp),
        amountUsd: estimateLiquidityEventUsd(mint.amountUSD, mint.amount0, mint.amount1),
      }))
      .filter((mint) => mint.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    const burns = (pairTransactions?.burns || [])
      .map((burn) => ({
        timestamp: asTimestamp(burn.timestamp),
        amountUsd: estimateLiquidityEventUsd(burn.amountUSD, burn.amount0, burn.amount1),
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
  }, [chartTab, effectiveReserveUsd, estimateLiquidityEventUsd, estimateSwapUsd, pair, pairTransactions, timeframe]);

  const latestChartPoint = chartPoints[chartPoints.length - 1];
  const latestChartValue = latestChartPoint?.value ?? 0;
  const isChartOnly = mode === 'chart';

  const chartPanel = (
    <div className={`pool-chart ${isChartOnly ? 'pool-chart--chart-only' : ''}`}>
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

        <div className="pool-chart__tools">
          <Uik.Tabs
            value={chartStyle}
            onChange={(value) => setChartStyle(value as ChartStyle)}
            options={[
              { value: 'candles', text: 'Candles' },
              { value: 'area', text: 'Area' },
              { value: 'line', text: 'Line' },
            ]}
            disabled={chartTab !== 'price'}
          />

          <div className="pool-chart__tools-actions">
            <button
              type="button"
              className={`pool-chart__tool-btn ${showCrosshair ? 'is-active' : ''}`}
              onClick={() => setShowCrosshair((current) => !current)}
            >
              Crosshair
            </button>
            <button
              type="button"
              className={`pool-chart__tool-btn ${showGrid ? 'is-active' : ''}`}
              onClick={() => setShowGrid((current) => !current)}
            >
              Grid
            </button>
            <button
              type="button"
              className={`pool-chart__tool-btn ${steppedLine ? 'is-active' : ''}`}
              onClick={() => setSteppedLine((current) => !current)}
            >
              {steppedLine ? 'Stepped' : 'Smooth'}
            </button>
          </div>
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
            <PoolSeriesChart
              points={chartPoints}
              chartTab={chartTab}
              chartStyle={chartStyle}
              timeframe={timeframe}
              showCrosshair={showCrosshair}
              showGrid={showGrid}
              steppedLine={steppedLine}
            />
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
  );

  if (isChartOnly) {
    return (
      <div className="pool pool--chart-only">
        <section className="pool__content pool__content--chart-only">
          {chartPanel}
        </section>
      </div>
    );
  }

  return (
    <div className="pool">
      <section className="pool-stats">
        <div className="pool-stats__wrapper">
          <div className="pool-stats__main">
            <div className="pool-stats__toolbar">
              <div className="pool-stats__pool-select">
                <div className="pool-stats__pool-select-pair">
                  {token0IsCanonicalReef ? (
                    <div className={`pool-stats__pool-select-pair--${Uik.utils.slug(token0Symbol)}`}>
                      <Uik.ReefIcon className="h-full w-full text-white" />
                    </div>
                  ) : (
                    <img
                      src={token0Icon}
                      alt={token0Symbol}
                      className={`pool-stats__pool-select-pair--${Uik.utils.slug(token0Symbol)}`}
                    />
                  )}
                  {token1IsCanonicalReef ? (
                    <div className={`pool-stats__pool-select-pair--${Uik.utils.slug(token1Symbol)}`}>
                      <Uik.ReefIcon className="h-full w-full text-white" />
                    </div>
                  ) : (
                    <img
                      src={token1Icon}
                      alt={token1Symbol}
                      className={`pool-stats__pool-select-pair--${Uik.utils.slug(token1Symbol)}`}
                    />
                  )}
                </div>
                <span className="pool-stats__pool-select-name">{token0Symbol} / {token1Symbol}</span>
              </div>

              <Uik.Button
                className="pool-stats__transactions-btn"
                text="Transactions"
                size="small"
                icon={faRightLeft}
                onClick={() => {
                  setTransactionsTab('All');
                  setTransactionsOpen(true);
                }}
              />
            </div>

            <div className="pool-stats__main-stats">
              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">Total Value Locked</div>
                <div className="pool-stats__main-stat-value">{formatUsd(effectiveReserveUsd)}</div>
              </div>

              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">My Liquidity</div>
                <div className="pool-stats__main-stat-value">{formatUsd(myLiquidityUsd)}</div>
              </div>

              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">24h Volume</div>
                <div className="pool-stats__main-stat-value">
                  <span>{formatUsd(volume24hUsd)}</span>
                  <Uik.Trend
                    type={volume24hChange >= 0 ? 'good' : 'bad'}
                    direction={volume24hChange >= 0 ? 'up' : 'down'}
                    text={`${volume24hChange >= 0 ? '+' : ''}${volume24hChange.toFixed(2)}%`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pool-stats__tokens">
            {poolStatsTokens.map((token) => (
              <article key={token.symbol} className="pool-stats__token">
                <div className="pool-stats__token-info">
                  <div className="pool-stats__token-main">
                    {((token.symbol === token0Symbol) ? token0IsCanonicalReef : token1IsCanonicalReef) ? (
                      <div className={`pool-stats__token-image pool-stats__token-image--${Uik.utils.slug(token.symbol)} pool-stats__token-image--reef`}>
                        <Uik.ReefIcon className="h-full w-full text-white" />
                      </div>
                    ) : (
                      <img
                        src={token.symbol === token0Symbol ? token0Icon : token1Icon}
                        alt={token.symbol}
                        className={`pool-stats__token-image pool-stats__token-image--${Uik.utils.slug(token.symbol)}`}
                      />
                    )}
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

          {actionTab === 'trade' ? (
            <div className="uik-pool-actions__tokens">
              <div className="uik-pool-actions-token">
                <div className="uik-pool-actions-token__token">
                  <div className={`uik-pool-actions-token__image pool-token-avatar ${inputToken.isCanonicalReef ? 'pool-token-avatar--reef' : ''}`}>
                    {inputToken.isCanonicalReef ? (
                      <Uik.ReefIcon className="pool-token-avatar__reef-mark" />
                    ) : (
                      <>
                        {inputToken.icon ? (
                          <img src={inputToken.icon} alt={inputToken.symbol} className="pool-token-avatar__img" />
                        ) : (
                          <span className="pool-token-avatar__fallback">{inputToken.symbol.slice(0, 1)}</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="uik-pool-actions-token__info">
                    <div className="uik-pool-actions-token__symbol">{inputToken.symbol}</div>
                    <div className="uik-pool-actions-token__amount">{formattedBalanceIn} {inputToken.symbol}</div>
                  </div>
                </div>
                <div className="uik-pool-actions-token__value">
                  <input
                    value={amountInText}
                    onChange={(event) => setAmountInText(normalizeInput(event.target.value))}
                    inputMode="decimal"
                    placeholder="0.0"
                  />
                </div>
              </div>

              <div className="pool-actions__switch-slider-row">
                <div className="uik-pool-actions__token-switch">
                  <button type="button" className="uik-pool-actions__token-switch-btn" aria-label="Switch assets" onClick={onSwitchTradeTokens}>
                    <Uik.Icon icon={faArrowsRotate} />
                  </button>
                </div>
                <div className="uik-pool-actions__slider">
                  <Uik.Slider
                    value={tradePercentage}
                    helpers={AMOUNT_SLIDER_HELPERS}
                    tooltip={`${tradePercentage.toFixed(2)}%`}
                    onChange={setAmountByPercent}
                  />
                </div>
              </div>

              <div className="uik-pool-actions-token">
                <div className="uik-pool-actions-token__token">
                  <div className={`uik-pool-actions-token__image pool-token-avatar ${outputToken.isCanonicalReef ? 'pool-token-avatar--reef' : ''}`}>
                    {outputToken.isCanonicalReef ? (
                      <Uik.ReefIcon className="pool-token-avatar__reef-mark" />
                    ) : (
                      <>
                        {outputToken.icon ? (
                          <img src={outputToken.icon} alt={outputToken.symbol} className="pool-token-avatar__img" />
                        ) : (
                          <span className="pool-token-avatar__fallback">{outputToken.symbol.slice(0, 1)}</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="uik-pool-actions-token__info">
                    <div className="uik-pool-actions-token__symbol">{outputToken.symbol}</div>
                    <div className="uik-pool-actions-token__amount">{formattedBalanceOut} {outputToken.symbol}</div>
                  </div>
                </div>
                <div className="uik-pool-actions-token__value">
                  <input value={amountOutText} readOnly placeholder={isQuoting ? '...' : '0.0'} />
                </div>
              </div>

              <div className="uik-pool-actions__summary uik-pool-actions__trade-summary">
                <div className="uik-pool-actions__summary-item">
                  <div className="uik-pool-actions__summary-item-label">Rate</div>
                  <div className="uik-pool-actions__summary-item-value">{rateText}</div>
                </div>
                <div className="uik-pool-actions__summary-item">
                  <div className="uik-pool-actions__summary-item-label">Fee</div>
                  <div className="uik-pool-actions__summary-item-value">0.3%</div>
                </div>
                <div className="uik-pool-actions__summary-item">
                  <div className="uik-pool-actions__summary-item-label">Slippage</div>
                  <div className="uik-pool-actions__summary-item-value">{clampedSlippage.toFixed(1)}%</div>
                </div>
              </div>

              {quoteError ? <p className="pool-actions__quote-error">{quoteError}</p> : null}
              {!quoteError && quoteNote ? <p className="pool-actions__quote-note">{quoteNote}</p> : null}
              {lastTxHash ? <p className="pool-actions__quote-note">Last tx: {shortAddress(lastTxHash)}</p> : null}

              <div className="uik-pool-actions__slider">
                <Uik.Slider
                  value={slippageSliderValue}
                  steps={1}
                  helpers={SLIPPAGE_SLIDER_HELPERS}
                  tooltip={`${clampedSlippage.toFixed(1)}%`}
                  onChange={setSlippageFromSlider}
                />
              </div>

              {!isConnected ? (
                <Uik.Button
                  className="uik-pool-actions__cta"
                  text={tradeButtonLabel}
                  icon={faArrowsRotate}
                  fill
                  disabled={isConnecting}
                  onClick={connectWallet}
                />
              ) : isWrongChain ? (
                <Uik.Button
                  className="uik-pool-actions__cta"
                  text={tradeButtonLabel}
                  fill
                  disabled={isSwitching}
                  onClick={switchToReef}
                />
              ) : requiresApproval ? (
                <Uik.Button
                  className="uik-pool-actions__cta"
                  text={tradeButtonLabel}
                  fill
                  disabled={isApproving || parsedAmountIn <= 0n || hasInsufficientBalance || isRefreshing || !hasTradePair}
                  onClick={approve}
                />
              ) : (
                <Uik.Button
                  className="uik-pool-actions__cta"
                  text={tradeButtonLabel}
                  icon={faArrowsRotate}
                  fill
                  disabled={!canSwap || isSwapping}
                  onClick={swap}
                />
              )}
            </div>
          ) : actionTab === 'stake' ? (
            <div className="uik-pool-actions__tokens">
              <p className="pool-actions__stake-note">
                Earn trading fees on this liquidity pool by staking your tokens into it.
              </p>

              <div className="uik-pool-actions-token">
                <div className="uik-pool-actions-token__token">
                  <div className={`uik-pool-actions-token__image pool-token-avatar ${tradeToken0.isCanonicalReef ? 'pool-token-avatar--reef' : ''}`}>
                    {tradeToken0.isCanonicalReef ? (
                      <Uik.ReefIcon className="pool-token-avatar__reef-mark" />
                    ) : (
                      <>
                        {tradeToken0.icon ? (
                          <img src={tradeToken0.icon} alt={tradeToken0.symbol} className="pool-token-avatar__img" />
                        ) : (
                          <span className="pool-token-avatar__fallback">{tradeToken0.symbol.slice(0, 1)}</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="uik-pool-actions-token__info">
                    <div className="uik-pool-actions-token__symbol">{tradeToken0.symbol}</div>
                    <div className="uik-pool-actions-token__amount">{stakeFormattedBalanceToken0} {tradeToken0.symbol}</div>
                  </div>
                </div>
                <div className="uik-pool-actions-token__value">
                  <input
                    value={stakeAmountToken0Text}
                    onChange={(event) => onStakeAmountToken0Change(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.0"
                  />
                </div>
              </div>

              <div className="uik-pool-actions-token">
                <div className="uik-pool-actions-token__token">
                  <div className={`uik-pool-actions-token__image pool-token-avatar ${tradeToken1.isCanonicalReef ? 'pool-token-avatar--reef' : ''}`}>
                    {tradeToken1.isCanonicalReef ? (
                      <Uik.ReefIcon className="pool-token-avatar__reef-mark" />
                    ) : (
                      <>
                        {tradeToken1.icon ? (
                          <img src={tradeToken1.icon} alt={tradeToken1.symbol} className="pool-token-avatar__img" />
                        ) : (
                          <span className="pool-token-avatar__fallback">{tradeToken1.symbol.slice(0, 1)}</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="uik-pool-actions-token__info">
                    <div className="uik-pool-actions-token__symbol">{tradeToken1.symbol}</div>
                    <div className="uik-pool-actions-token__amount">{stakeFormattedBalanceToken1} {tradeToken1.symbol}</div>
                  </div>
                </div>
                <div className="uik-pool-actions-token__value">
                  <input value={stakeAmountToken1} readOnly />
                </div>
              </div>

              <div className="uik-pool-actions__summary pool-actions__stake-summary">
                <div className={`uik-pool-actions__summary-item ${stakeTotalUsd <= 0 ? 'uik-pool-actions__summary-item--empty' : ''}`}>
                  <div className="uik-pool-actions__summary-item-label">Total</div>
                  <div className="uik-pool-actions__summary-item-value">{formattedStakeTotal}</div>
                </div>
              </div>

              <div className="uik-pool-actions__slider pool-actions__stake-slider">
                <Uik.Slider
                  value={stakePercentage}
                  helpers={AMOUNT_SLIDER_HELPERS}
                  tooltip={`${stakePercentage.toFixed(2)}%`}
                  onChange={setStakeAmountByPercent}
                />
              </div>

              <Uik.Button
                className="uik-pool-actions__cta"
                text={stakeButtonLabel}
                icon={faCoins}
                fill
                disabled={
                  (!isConnected && isConnecting) ||
                  (isConnected && isWrongChain && isSwitching) ||
                  (isConnected && !isWrongChain && !!stakeApprovalAddress && isApprovingLiquidity) ||
                  (isConnected && !isWrongChain && !stakeApprovalAddress && (!canStake || isStaking))
                }
                onClick={() => {
                  if (!isConnected) {
                    connectWallet().catch(() => {});
                    return;
                  }
                  if (isWrongChain) {
                    switchToReef().catch(() => {});
                    return;
                  }
                  if (stakeApprovalAddress) {
                    approveLiquidityToken().catch(() => {});
                    return;
                  }
                  stakeLiquidity().catch(() => {});
                }}
              />
            </div>
          ) : (
            <div className="uik-pool-actions__tokens pool-actions__unstake-section">
              <div className={`uik-pool-actions__withdraw-preview ${unstakeValueUsd <= 0 ? 'uik-pool-actions__withdraw-preview--empty' : ''}`}>
                <div className="uik-pool-actions__withdraw-percentage">
                  <span className="uik-pool-actions__withdraw-percentage-value">{Math.round(unstakePercentage)}</span>
                  <span className="uik-pool-actions__withdraw-percentage-sign">%</span>
                </div>
                <div className="uik-pool-actions__withdraw-value">{formattedUnstakeValue}</div>
                <div className="uik-pool-actions__withdraw-value">
                  {unstakeAmountToken0} {tradeToken0.symbol} / {unstakeAmountToken1} {tradeToken1.symbol}
                </div>
              </div>

              <div className="uik-pool-actions__slider pool-actions__unstake-slider">
                <Uik.Slider
                  value={unstakePercentage}
                  stickyHelpers={false}
                  helpers={AMOUNT_SLIDER_HELPERS}
                  tooltip={`${unstakePercentage.toFixed(0)}%`}
                  onChange={(position: number) => setUnstakePercentage(position)}
                />
              </div>

              <Uik.Button
                className="uik-pool-actions__cta"
                text={unstakeButtonLabel}
                icon={faArrowUpFromBracket}
                fill
                disabled={
                  (!isConnected && isConnecting) ||
                  (isConnected && isWrongChain && isSwitching) ||
                  (isConnected && !isWrongChain && unstakeRequiresApproval && isApprovingUnstake) ||
                  (isConnected && !isWrongChain && !unstakeRequiresApproval && (!canUnstake || isUnstaking))
                }
                onClick={() => {
                  if (!isConnected) {
                    connectWallet().catch(() => {});
                    return;
                  }
                  if (isWrongChain) {
                    switchToReef().catch(() => {});
                    return;
                  }
                  if (unstakeRequiresApproval) {
                    approveUnstakeToken().catch(() => {});
                    return;
                  }
                  unstakeLiquidity().catch(() => {});
                }}
              />
            </div>
          )}
        </div>

        {chartPanel}
      </section>

      <Uik.Modal
        className="pool-transactions-modal"
        title="Transactions"
        isOpen={isTransactionsOpen}
        onClose={() => setTransactionsOpen(false)}
      >
        <div className="pool-transactions-modal__content">
          <Uik.Tabs
            value={transactionsTab}
            options={[
              { value: 'All', text: 'All' },
              { value: 'Swap', text: 'Trade' },
              { value: 'Mint', text: 'Stake' },
              { value: 'Burn', text: 'Unstake' },
            ]}
            onChange={(value) => setTransactionsTab(value as PoolTransactionTab)}
          />

          <div className="pool-transactions-modal__meta">
            {visiblePoolTransactions.length} transaction{visiblePoolTransactions.length === 1 ? '' : 's'}
          </div>

          {isChartLoading ? (
            <div className="pool-transactions-modal__status">
              <Uik.Loading />
            </div>
          ) : hasChartError ? (
            <div className="pool-transactions-modal__status">Could not load transactions from subgraph.</div>
          ) : visiblePoolTransactions.length === 0 ? (
            <div className="pool-transactions-modal__status">No transactions found for this pool.</div>
          ) : (
            <div className="pool-transactions-modal__table-wrap">
              <table className="pool-transactions-modal__table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Tx</th>
                    <th>Time</th>
                    <th>{token0Symbol} Amount</th>
                    <th>{token1Symbol} Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePoolTransactions.map((transaction) => {
                    const transactionIcon = transaction.type === 'Swap'
                      ? faRightLeft
                      : transaction.type === 'Mint'
                        ? faCoins
                        : faArrowUpFromBracket;
                    const transactionClassName = transaction.type === 'Swap'
                      ? 'trade'
                      : transaction.type === 'Mint'
                        ? 'stake'
                        : 'unstake';
                    return (
                      <tr
                        key={transaction.id}
                        onClick={() => openPoolTransaction(transaction.txHash)}
                      >
                        <td>
                          <div className="pool-transactions-modal__type">
                            <Uik.Icon
                              icon={transactionIcon}
                              className={`pool-transactions-modal__type-icon pool-transactions-modal__type-icon--${transactionClassName}`}
                            />
                            <span>{transaction.description}</span>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pool-transactions-modal__tx-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              openPoolTransaction(transaction.txHash);
                            }}
                          >
                            {shortAddress(transaction.txHash)}
                          </button>
                        </td>
                        <td>{formatPoolTransactionTime(transaction.timestamp)}</td>
                        <td className="pool-transactions-modal__amount">{formatTokenAmount(transaction.token0Amount)}</td>
                        <td className="pool-transactions-modal__amount">{formatTokenAmount(transaction.token1Amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Uik.Modal>
    </div>
  );
};

export default PoolDetailPage;
