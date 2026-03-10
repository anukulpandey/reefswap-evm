import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import { faArrowUpFromBracket, faArrowsRotate, faCoins, faRightLeft } from '@fortawesome/free-solid-svg-icons';
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { formatUnits, getAddress, isAddress, parseUnits, type Address } from 'viem';
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
import { erc20Abi, reefswapRouterAbi } from '@/lib/abi';
import { contracts, reefChain } from '@/lib/config';
import { useSubgraphPairTransactions } from '@/hooks/useSubgraph';
import { resolveTokenIconUrl } from '@/lib/tokenIcons';
import { formatDisplayAmount, getErrorMessage, normalizeInput, shortAddress } from '@/lib/utils';
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
type TradeToken = {
  symbol: string;
  decimals: number;
  address: Address | null;
  icon: string;
  isCanonicalReef: boolean;
};

const CHART_SAMPLE_SIZE = 500;
const SWAP_FEE_RATE = 0.003;
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
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const publicClient = usePublicClient({ chainId: reefChain.id });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  const [actionTab, setActionTab] = useState<ActionTab>('trade');
  const [chartTab, setChartTab] = useState<ChartTab>('price');
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [isTradeReversed, setIsTradeReversed] = useState(false);
  const [amountInText, setAmountInText] = useState('');
  const [amountOutText, setAmountOutText] = useState('');
  const [slippagePercentage, setSlippagePercentage] = useState(0.8);
  const [stakePercentage, setStakePercentage] = useState(0);
  const [unstakePercentage, setUnstakePercentage] = useState(0);
  const [quotedOutRaw, setQuotedOutRaw] = useState<bigint>(0n);
  const [balanceIn, setBalanceIn] = useState<bigint>(0n);
  const [balanceOut, setBalanceOut] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [lastTxHash, setLastTxHash] = useState<Address | null>(null);

  const {
    data: pairTransactions,
    isLoading: isChartLoading,
    isError: hasChartError,
  } = useSubgraphPairTransactions(pair?.id, CHART_SAMPLE_SIZE);

  const token0Address = pair?.token0.id || null;
  const token1Address = pair?.token1.id || null;
  const token0IsCanonicalReef = sameAddress(token0Address, contracts.wrappedReef);
  const token1IsCanonicalReef = sameAddress(token1Address, contracts.wrappedReef);
  const token0SymbolRaw = pair?.token0.symbol || 'REEF';
  const token1SymbolRaw = pair?.token1.symbol || 'TOKEN';
  const token0Symbol = token0IsCanonicalReef ? 'REEF' : token0SymbolRaw;
  const token1Symbol = token1IsCanonicalReef ? 'REEF' : token1SymbolRaw;
  const token0Decimals = Number.parseInt(pair?.token0.decimals || '18', 10);
  const token1Decimals = Number.parseInt(pair?.token1.decimals || '18', 10);
  const token0SafeDecimals = Number.isInteger(token0Decimals) ? token0Decimals : 18;
  const token1SafeDecimals = Number.isInteger(token1Decimals) ? token1Decimals : 18;
  const token0NormalizedAddress = token0Address && isAddress(token0Address) ? getAddress(token0Address) : null;
  const token1NormalizedAddress = token1Address && isAddress(token1Address) ? getAddress(token1Address) : null;
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
  const isWrongChain = isConnected && chainId !== reefChain.id;
  const hasTradePair = Boolean(inputToken.address && outputToken.address && !sameAddress(inputToken.address, outputToken.address));
  const swapPath = useMemo(() => (
    hasTradePair
      ? [inputToken.address as Address, outputToken.address as Address]
      : [] as Address[]
  ), [hasTradePair, inputToken.address, outputToken.address]);
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
  const requiresApproval = parsedAmountIn > 0n && allowance < parsedAmountIn;
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
  const stakeBalanceToken0 = useMemo(() => {
    if (!tradeToken0.address) return 0n;
    if (inputToken.address && sameAddress(tradeToken0.address, inputToken.address)) return balanceIn;
    if (outputToken.address && sameAddress(tradeToken0.address, outputToken.address)) return balanceOut;
    return 0n;
  }, [balanceIn, balanceOut, inputToken.address, outputToken.address, tradeToken0.address]);
  const stakeBalanceToken1 = useMemo(() => {
    if (!tradeToken1.address) return 0n;
    if (inputToken.address && sameAddress(tradeToken1.address, inputToken.address)) return balanceIn;
    if (outputToken.address && sameAddress(tradeToken1.address, outputToken.address)) return balanceOut;
    return 0n;
  }, [balanceIn, balanceOut, inputToken.address, outputToken.address, tradeToken1.address]);
  const stakeAmountToken0Raw = useMemo(() => {
    if (stakePercentage <= 0 || stakeBalanceToken0 <= 0n) return 0n;
    const basisPoints = BigInt(Math.round(stakePercentage * 100));
    return (stakeBalanceToken0 * basisPoints) / 10_000n;
  }, [stakeBalanceToken0, stakePercentage]);
  const stakeAmountToken0 = useMemo(
    () => trimDecimalString(formatUnits(stakeAmountToken0Raw, tradeToken0.decimals)),
    [stakeAmountToken0Raw, tradeToken0.decimals],
  );
  const stakeAmountToken1 = useMemo(() => {
    const amount0 = asNumber(formatUnits(stakeAmountToken0Raw, tradeToken0.decimals));
    const price = asNumber(pair?.token0Price);
    if (amount0 <= 0 || price <= 0) return '0.0';
    return trimDecimalString((amount0 * price).toFixed(6));
  }, [pair?.token0Price, stakeAmountToken0Raw, tradeToken0.decimals]);
  const stakeTotalUsd = useMemo(() => {
    const usdPerToken0 = reserve0 > 0 ? asNumber(pair?.reserveUSD) / reserve0 : 0;
    const usdPerToken1 = reserve1 > 0 ? asNumber(pair?.reserveUSD) / reserve1 : 0;
    const amount0 = asNumber(stakeAmountToken0);
    const amount1 = asNumber(stakeAmountToken1);
    return Math.max(0, (amount0 * usdPerToken0) + (amount1 * usdPerToken1));
  }, [pair?.reserveUSD, reserve0, reserve1, stakeAmountToken0, stakeAmountToken1]);
  const stakeButtonLabel = stakeAmountToken0Raw > 0n ? 'Stake Now' : `Missing ${tradeToken0.symbol} amount`;
  const stakeFormattedBalanceToken0 = formatDisplayAmount(stakeBalanceToken0, tradeToken0.decimals);
  const stakeFormattedBalanceToken1 = formatDisplayAmount(stakeBalanceToken1, tradeToken1.decimals);
  const formattedStakeTotal = `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(stakeTotalUsd)}`;
  const unstakeValueUsd = 0;
  const formattedUnstakeValue = `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(unstakeValueUsd)}`;

  const clearTradeQuote = useCallback(() => {
    setAmountOutText('');
    setQuotedOutRaw(0n);
    setQuoteError('');
    setQuoteNote('');
    setIsQuoting(false);
  }, []);

  const refreshTradeState = useCallback(async () => {
    if (!publicClient || !address || !inputToken.address || !outputToken.address || !hasTradePair) {
      setBalanceIn(0n);
      setBalanceOut(0n);
      setAllowance(0n);
      return;
    }

    setIsRefreshing(true);
    try {
      const [nextBalanceIn, nextBalanceOut, nextAllowance] = await Promise.all([
        publicClient.readContract({
          address: inputToken.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }).catch(() => 0n),
        publicClient.readContract({
          address: outputToken.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }).catch(() => 0n),
        publicClient.readContract({
          address: inputToken.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, contracts.router],
        }).catch(() => 0n),
      ]);
      setBalanceIn(nextBalanceIn);
      setBalanceOut(nextBalanceOut);
      setAllowance(nextAllowance);
    } finally {
      setIsRefreshing(false);
    }
  }, [address, hasTradePair, inputToken.address, outputToken.address, publicClient]);

  useEffect(() => {
    refreshTradeState().catch(() => {
      setIsRefreshing(false);
    });
  }, [refreshTradeState]);

  useEffect(() => {
    setIsTradeReversed(false);
    setStakePercentage(0);
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
    if (!walletClient || !publicClient || !address || !inputToken.address || !hasTradePair) return;

    setIsApproving(true);
    Uik.notify.info({ message: 'Submitting approval...' });
    try {
      const hash = await walletClient.writeContract({
        account: address,
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
    if (!walletClient || !publicClient || !address || !hasTradePair || parsedAmountIn <= 0n || quotedOutRaw <= 0n) return;

    setIsSwapping(true);
    Uik.notify.info({ message: 'Submitting swap...' });
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);
      const hash = await walletClient.writeContract({
        account: address,
        chain: reefChain,
        address: contracts.router,
        abi: reefswapRouterAbi,
        functionName: 'swapExactTokensForTokens',
        args: [parsedAmountIn, minOut, swapPath, address, deadline],
      });
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
                  <input value={stakeAmountToken0} readOnly />
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
                  onChange={(position: number) => setStakePercentage(position)}
                />
              </div>

              <Uik.Button
                className="uik-pool-actions__cta"
                text={stakeButtonLabel}
                icon={faCoins}
                fill
                disabled
                onClick={() => {}}
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
                text="Insufficient pool balance"
                icon={faArrowUpFromBracket}
                fill
                disabled
                onClick={() => {}}
              />
            </div>
          )}
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
