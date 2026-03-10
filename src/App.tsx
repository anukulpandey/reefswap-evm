import { useCallback, useEffect, useMemo, useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from 'wagmi';
import { Coins, Search, Upload } from 'lucide-react';
import { formatUnits, getAddress, isAddress, parseUnits, type Address } from 'viem';
import { erc20Abi, reefswapPairAbi, reefswapRouterAbi, wrappedReefAbi } from './lib/abi';
import { contracts, reefChain } from './lib/config';
import TokenSelect from './components/TokenSelect';
import { defaultTokens, nativeReef, type TokenOption } from './lib/tokens';
import { formatDisplayAmount, getErrorMessage, normalizeInput, shortAddress } from './lib/utils';
import AppHeader from './components/reef/AppHeader';
import PortfolioSummary from './components/reef/PortfolioSummary';
import AssetTabs from './components/reef/AssetTabs';
import ActivityPanel from './components/reef/ActivityPanel';
import CreatorPage from './components/reef/creator/CreatorPage';
import ChartView from './components/reef/ChartView';
import PoolDetailPage from './components/reef/PoolDetailPage';
import { useReefBalance } from './hooks/useReefBalance';
import { useReefPrice } from './hooks/useReefPrice';
import { useSubgraphFactory, useSubgraphPairs, useSubgraphTokens } from './hooks/useSubgraph';
import { type SubgraphPair } from './lib/subgraph';

const MAX_APPROVAL = (2n ** 256n) - 1n;
const DEFAULT_SLIPPAGE = '1.0';
const TX_DEADLINE_SECONDS = 60 * 20;
const AMOUNT_PRESETS = [0, 25, 50, 100] as const;
const SLIPPAGE_PRESETS = ['0.3', '0.8', '1.0', '2.0'] as const;
const REEF_USD_PRICE = 0.000073;
const AMOUNT_SLIDER_HELPERS = [
  { position: 0, text: '0%' },
  { position: 25, text: '25%' },
  { position: 50, text: '50%' },
  { position: 100, text: '100%' },
];
const SLIPPAGE_SLIDER_HELPERS = [
  { position: 0, text: '0%' },
  { position: 50, text: '10%' },
  { position: 100, text: '20%' },
];

type AppRoute = 'tokens' | 'swap' | 'pools' | 'create-token' | 'chart' | 'pool-detail';

const isWrapPairSelection = (a: TokenOption, b: TokenOption, wrappedTokenAddress: Address): boolean =>
  (a.isNative && sameAddress(b.address, wrappedTokenAddress)) || (b.isNative && sameAddress(a.address, wrappedTokenAddress));

const NAV_ROUTES: { route: AppRoute; label: string; path: string }[] = [
  { route: 'tokens', label: 'Tokens', path: '/' },
  { route: 'swap', label: 'Swap', path: '/swap' },
  { route: 'pools', label: 'Pools', path: '/pools' },
  { route: 'create-token', label: 'Creator', path: '/create-token' },
  { route: 'chart', label: 'Chart', path: '/chart' },
  { route: 'pool-detail', label: 'Pool Detail', path: '/pool' },
];

const ROUTE_ALIAS: Record<string, AppRoute> = {
  '': 'tokens',
  tokens: 'tokens',
  dashboard: 'tokens',
  swap: 'swap',
  pools: 'pools',
  creator: 'create-token',
  'create-token': 'create-token',
  chart: 'chart',
  pool: 'pool-detail',
  'pool-detail': 'pool-detail',
};

const normalizePathSegments = (value: string | null | undefined): string[] =>
  (value || '')
    .replace(/^#\/?/, '')
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

const parseRouteLocation = (location: Pick<Location, 'pathname' | 'hash'>): {
  route: AppRoute;
  poolRef: string | null;
} => {
  const hashSegments = normalizePathSegments(location.hash);
  const pathSegments = normalizePathSegments(location.pathname);
  const segments = hashSegments.length ? hashSegments : pathSegments;
  const routeSegment = segments[0] || '';
  const route = ROUTE_ALIAS[routeSegment] || 'tokens';
  const poolRef = route === 'pool-detail' && segments[1] ? decodeURIComponent(segments[1]) : null;
  return { route, poolRef };
};

const resolveRoute = (value: string | null | undefined): AppRoute => {
  const segment = normalizePathSegments(value)[0] || '';
  return ROUTE_ALIAS[segment] || 'tokens';
};

const resolveRouteFromLocation = (location: Pick<Location, 'pathname' | 'hash'>): AppRoute => {
  return parseRouteLocation(location).route;
};

const resolvePoolIdFromRef = (poolRef: string | null | undefined, pairs: SubgraphPair[]): string | null => {
  if (!poolRef) return null;
  const normalizedRef = poolRef.toLowerCase();

  const byId = pairs.find((pair) => pair.id.toLowerCase() === normalizedRef);
  if (byId) return byId.id;

  const bySymbolSlug = pairs.find((pair) => `${pair.token0.symbol}-${pair.token1.symbol}`.toLowerCase() === normalizedRef);
  if (bySymbolSlug) return bySymbolSlug.id;

  const byReverseSymbolSlug = pairs.find((pair) => `${pair.token1.symbol}-${pair.token0.symbol}`.toLowerCase() === normalizedRef);
  if (byReverseSymbolSlug) return byReverseSymbolSlug.id;

  return null;
};

const routePath = (route: AppRoute, poolId?: string | null): string => {
  if (route === 'pool-detail') {
    const normalizedPoolId = String(poolId || '').trim().toLowerCase();
    return normalizedPoolId ? `/pool/${encodeURIComponent(normalizedPoolId)}` : '/pool';
  }
  return NAV_ROUTES.find((item) => item.route === route)?.path || '/';
};

const trimDecimalString = (value: string): string => {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
};

const asNumber = (value: string | number | null | undefined): number => {
  const parsed = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatUsd = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value))
);

const formatCompactUsd = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
    notation: 'compact',
  }).format(asNumber(value))
);

const formatTokenCount = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(asNumber(value))
);

const dedupeTokenKey = (token: TokenOption): string => (
  token.isNative ? 'native' : (token.address || token.symbol).toLowerCase()
);

const sameAddress = (a: Address | string | null | undefined, b: Address | string | null | undefined): boolean =>
  String(a || '').toLowerCase() === String(b || '').toLowerCase();

const getAmountOut = (amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint => {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
};

const initialInputToken = defaultTokens[0];
const initialOutputToken = defaultTokens.find((token) => token.address === contracts.wrappedReef) || defaultTokens[0];

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

const addEthereumChainParams = {
  chainId: `0x${reefChain.id.toString(16)}`,
  chainName: reefChain.name,
  nativeCurrency: reefChain.nativeCurrency,
  rpcUrls: reefChain.rpcUrls.default.http,
  blockExplorerUrls: [reefChain.blockExplorers.default.url],
};

const TokensView = ({
  onSwap,
  tokens,
  wrappedTokenAddress,
}: {
  onSwap?: () => void;
  tokens: TokenOption[];
  wrappedTokenAddress: Address;
}) => {
  const { address } = useAccount();
  const { balance: reefBalance, isLoading: isBalanceLoading } = useReefBalance(address);
  const { price: reefPrice } = useReefPrice();
  const totalUsdValue = reefBalance * reefPrice;

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      <section className="mb-8">
        <PortfolioSummary
          totalBalance={totalUsdValue}
          availableBalance={totalUsdValue}
          stakedBalance={0}
          isLoading={isBalanceLoading}
        />
      </section>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <AssetTabs onSwap={onSwap} tokenOptions={tokens} wrappedTokenAddress={wrappedTokenAddress} />
        </div>
        <div className="lg:col-span-1">
          <ActivityPanel />
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: reefChain.id });
  const { data: walletClient } = useWalletClient();

  const [tokens, setTokens] = useState<TokenOption[]>(defaultTokens);
  const [tokenIn, setTokenIn] = useState<TokenOption>(initialInputToken);
  const [tokenOut, setTokenOut] = useState<TokenOption>(initialOutputToken || nativeReef);

  const [amountInText, setAmountInText] = useState('');
  const [amountOutText, setAmountOutText] = useState('');
  const [quotedOutRaw, setQuotedOutRaw] = useState<bigint>(0n);
  const [slippageText, setSlippageText] = useState(DEFAULT_SLIPPAGE);

  const [balanceIn, setBalanceIn] = useState<bigint>(0n);
  const [balanceOut, setBalanceOut] = useState<bigint>(0n);
  const [walletNativeBalance, setWalletNativeBalance] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [routerWrappedToken, setRouterWrappedToken] = useState<Address>(contracts.wrappedReef);
  const [routerWrappedTokenSource, setRouterWrappedTokenSource] = useState<'loading' | 'router' | 'fallback' | 'subgraph'>('loading');
  const [isWrappedTokenContractMissing, setIsWrappedTokenContractMissing] = useState(false);

  const [isQuoting, setIsQuoting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);

  const [quoteError, setQuoteError] = useState('');
  const [quoteSource, setQuoteSource] = useState<'none' | 'router' | 'pair-fallback'>('none');
  const [quoteNote, setQuoteNote] = useState('');
  const [lastTxHash, setLastTxHash] = useState<Address | null>(null);

  const [importAddress, setImportAddress] = useState('');
  const [importError, setImportError] = useState('');
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => {
    if (typeof window === 'undefined') return 'tokens';
    return resolveRouteFromLocation(window.location);
  });
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return parseRouteLocation(window.location).poolRef;
  });
  const [connectionInfoOpen, setConnectionInfoOpen] = useState(false);

  const {
    data: subgraphPairs = [],
    isLoading: isPoolsLoading,
    isError: hasPoolsError,
  } = useSubgraphPairs(200);
  const { data: subgraphTokens = [] } = useSubgraphTokens(300);
  const { data: subgraphFactory } = useSubgraphFactory();

  const showInfoToast = useCallback((message: string) => {
    Uik.notify.info({ message });
  }, []);

  const showSuccessToast = useCallback((message: string) => {
    Uik.notify.success({ message });
  }, []);

  const showErrorToast = useCallback((message: string) => {
    Uik.notify.danger({ message });
  }, []);

  const wrappedReefAddress = routerWrappedTokenSource === 'loading' ? contracts.wrappedReef : routerWrappedToken;
  const subgraphWrappedTokenAddress = useMemo(() => {
    const candidate = subgraphTokens.find((token) => token.symbol?.toUpperCase() === 'WREEF' && isAddress(token.id));
    return candidate ? getAddress(candidate.id) : null;
  }, [subgraphTokens]);
  const wrappedTokenOption = useMemo<TokenOption>(() => ({
    symbol: 'WREEF',
    name: 'Wrapped Reef',
    decimals: 18,
    address: wrappedReefAddress,
    isNative: false,
  }), [wrappedReefAddress]);

  useEffect(() => {
    if (!subgraphTokens.length) return;

    setTokens((current) => {
      const byKey = new Map<string, TokenOption>();
      current.forEach((token) => {
        byKey.set(dedupeTokenKey(token), token);
      });

      subgraphTokens.forEach((token) => {
        if (!isAddress(token.id)) return;
        const decimals = Number.parseInt(token.decimals, 10);
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return;

        const normalizedToken: TokenOption = {
          symbol: token.symbol.toUpperCase(),
          name: token.name,
          decimals,
          address: getAddress(token.id),
          isNative: false,
        };
        byKey.set(dedupeTokenKey(normalizedToken), normalizedToken);
      });

      const next = Array.from(byKey.values());
      if (next.length === current.length && next.every((token, index) => dedupeTokenKey(token) === dedupeTokenKey(current[index]))) {
        return current;
      }

      return next;
    });
  }, [subgraphTokens]);

  useEffect(() => {
    if (!subgraphPairs.length) {
      setSelectedPoolId(null);
      return;
    }

    setSelectedPoolId((current) => {
      const poolRefFromLocation = typeof window === 'undefined' ? null : parseRouteLocation(window.location).poolRef;
      const resolvedFromLocation = resolvePoolIdFromRef(poolRefFromLocation, subgraphPairs);
      if (resolvedFromLocation) return resolvedFromLocation;

      const resolvedCurrent = resolvePoolIdFromRef(current, subgraphPairs);
      if (resolvedCurrent) return resolvedCurrent;

      return subgraphPairs[0].id;
    });
  }, [subgraphPairs]);

  useEffect(() => {
    if (routerWrappedTokenSource === 'loading') return;

    setTokens((current) => {
      const filtered = current.filter((token) => {
        if (token.isNative || !token.address) return true;
        if (sameAddress(token.address, wrappedReefAddress)) return true;
        return token.symbol !== 'WREEF';
      });

      const hasWrapped = filtered.some((token) => !token.isNative && sameAddress(token.address, wrappedReefAddress));
      if (hasWrapped) return filtered;

      const nativeToken = filtered.find((token) => token.isNative) || nativeReef;
      const rest = filtered.filter((token) => !token.isNative);
      return [nativeToken, wrappedTokenOption, ...rest];
    });

    setTokenIn((current) => {
      if (!current.isNative && current.symbol === 'WREEF' && !sameAddress(current.address, wrappedReefAddress)) {
        return wrappedTokenOption;
      }
      return current;
    });

    setTokenOut((current) => {
      if (!current.isNative && current.symbol === 'WREEF' && !sameAddress(current.address, wrappedReefAddress)) {
        return wrappedTokenOption;
      }
      return current;
    });
  }, [routerWrappedTokenSource, wrappedReefAddress, wrappedTokenOption]);

  const isWrongChain = isConnected && chainId !== reefChain.id;
  const isWrapPair = useMemo(
    () => isWrapPairSelection(tokenIn, tokenOut, wrappedReefAddress),
    [tokenIn, tokenOut, wrappedReefAddress],
  );

  const swapPath = useMemo(() => {
    if (isWrapPair) return [] as Address[];

    const inputAddress = tokenIn.isNative ? wrappedReefAddress : tokenIn.address;
    const outputAddress = tokenOut.isNative ? wrappedReefAddress : tokenOut.address;

    if (!inputAddress || !outputAddress) return [] as Address[];
    if (sameAddress(inputAddress, outputAddress)) return [] as Address[];

    if (!tokenIn.isNative && !tokenOut.isNative) {
      if (sameAddress(inputAddress, wrappedReefAddress) || sameAddress(outputAddress, wrappedReefAddress)) {
        return [inputAddress, outputAddress];
      }
      return [inputAddress, wrappedReefAddress, outputAddress];
    }

    return [inputAddress, outputAddress];
  }, [isWrapPair, tokenIn, tokenOut, wrappedReefAddress]);

  const directPairFromSubgraph = useMemo(() => {
    if (swapPath.length !== 2 || isWrapPair) return null;

    const tokenA = swapPath[0].toLowerCase();
    const tokenB = swapPath[1].toLowerCase();

    return subgraphPairs.find((pair) => {
      const pairToken0 = pair.token0.id.toLowerCase();
      const pairToken1 = pair.token1.id.toLowerCase();
      return (pairToken0 === tokenA && pairToken1 === tokenB) || (pairToken0 === tokenB && pairToken1 === tokenA);
    }) || null;
  }, [isWrapPair, subgraphPairs, swapPath]);

  const directPairAddress = useMemo(() => {
    if (!directPairFromSubgraph || !isAddress(directPairFromSubgraph.id)) return null;
    return getAddress(directPairFromSubgraph.id);
  }, [directPairFromSubgraph]);

  const swapSpender = useMemo(() => (
    quoteSource === 'pair-fallback' && directPairAddress ? directPairAddress : contracts.router
  ), [directPairAddress, quoteSource]);

  const parsedAmountIn = useMemo(() => {
    if (!amountInText) return 0n;
    try {
      return parseUnits(amountInText, tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [amountInText, tokenIn.decimals]);

  const parsedSlippageBps = useMemo(() => {
    const value = Number(slippageText);
    if (!Number.isFinite(value) || value < 0 || value > 50) return 100n;
    return BigInt(Math.round(value * 100));
  }, [slippageText]);

  const minOut = useMemo(() => {
    if (quotedOutRaw <= 0n) return 0n;
    if (isWrapPair) return quotedOutRaw;
    const discount = (quotedOutRaw * parsedSlippageBps) / 10_000n;
    return quotedOutRaw - discount;
  }, [isWrapPair, parsedSlippageBps, quotedOutRaw]);

  const requiresApproval = !isWrapPair && !tokenIn.isNative && parsedAmountIn > 0n && allowance < parsedAmountIn;
  const hasInsufficientBalance = parsedAmountIn > balanceIn;

  const formattedBalanceIn = formatDisplayAmount(balanceIn, tokenIn.decimals);
  const formattedBalanceOut = formatDisplayAmount(balanceOut, tokenOut.decimals);
  const routeLabel = useMemo(() => {
    if (isWrapPair) return `${tokenIn.symbol} -> ${tokenOut.symbol} (1:1 wrap)`;

    return swapPath
          .map(
            (addressPart) =>
              tokens.find((token) => token.address === addressPart)?.symbol ||
          (sameAddress(addressPart, wrappedReefAddress) ? 'WREEF' : shortAddress(addressPart)),
      )
      .join(' -> ');
  }, [isWrapPair, swapPath, tokenIn.symbol, tokenOut.symbol, tokens, wrappedReefAddress]);

  const refreshChainState = useCallback(async () => {
    if (!publicClient || !address) {
      setBalanceIn(0n);
      setBalanceOut(0n);
      setWalletNativeBalance(0n);
      setAllowance(0n);
      return;
    }

    setIsRefreshing(true);

    try {
      const nativeBalance = await publicClient.getBalance({ address });
      setWalletNativeBalance(nativeBalance);

      const readTokenBalance = async (token: TokenOption): Promise<bigint> => {
        if (token.isNative) {
          return nativeBalance;
        }

        if (!token.address) return 0n;

        try {
          return await publicClient.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          });
        } catch {
          return 0n;
        }
      };

      const [inputBalance, outputBalance] = await Promise.all([readTokenBalance(tokenIn), readTokenBalance(tokenOut)]);
      setBalanceIn(inputBalance);
      setBalanceOut(outputBalance);

      if (isWrapPair || tokenIn.isNative || !tokenIn.address) {
        setAllowance(MAX_APPROVAL);
      } else {
        try {
          const allowanceValue = await publicClient.readContract({
            address: tokenIn.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, swapSpender],
          });
          setAllowance(allowanceValue);
        } catch {
          setAllowance(0n);
        }
      }

    } catch (error) {
      showErrorToast(getErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [address, isWrapPair, publicClient, showErrorToast, swapPath, swapSpender, tokenIn, tokenOut]);

  useEffect(() => {
    if (!publicClient) {
      setRouterWrappedTokenSource('fallback');
      setRouterWrappedToken(contracts.wrappedReef);
      return;
    }

    let isActive = true;
    setRouterWrappedTokenSource('loading');
    publicClient
      .readContract({
        address: contracts.router,
        abi: reefswapRouterAbi,
        functionName: 'WETH',
      })
      .then((result) => {
        if (!isActive) return;
        setRouterWrappedToken(result);
        setRouterWrappedTokenSource('router');
      })
      .catch(() => {
        if (!isActive) return;
        setRouterWrappedToken(contracts.wrappedReef);
        setRouterWrappedTokenSource('fallback');
      });

    return () => {
      isActive = false;
    };
  }, [publicClient]);

  useEffect(() => {
    if (!publicClient || routerWrappedTokenSource === 'loading') {
      setIsWrappedTokenContractMissing(false);
      return;
    }

    let isActive = true;

    const validateWrappedToken = async () => {
      try {
        const currentCode = await publicClient.getCode({ address: wrappedReefAddress });
        const hasCurrentCode = Boolean(currentCode && currentCode !== '0x');
        if (!isActive) return;

        if (hasCurrentCode) {
          setIsWrappedTokenContractMissing(false);
          return;
        }

        if (
          subgraphWrappedTokenAddress &&
          !sameAddress(subgraphWrappedTokenAddress, wrappedReefAddress)
        ) {
          const candidateCode = await publicClient.getCode({ address: subgraphWrappedTokenAddress });
          if (!isActive) return;

          if (candidateCode && candidateCode !== '0x') {
            setRouterWrappedToken(subgraphWrappedTokenAddress);
            setRouterWrappedTokenSource('subgraph');
            setIsWrappedTokenContractMissing(false);
            return;
          }
        }

        setIsWrappedTokenContractMissing(true);
      } catch {
        if (!isActive) return;
        setIsWrappedTokenContractMissing(false);
      }
    };

    validateWrappedToken();

    return () => {
      isActive = false;
    };
  }, [publicClient, routerWrappedTokenSource, subgraphWrappedTokenAddress, wrappedReefAddress]);

  useEffect(() => {
    refreshChainState().catch(() => {
      // no-op
    });
  }, [refreshChainState]);

  useEffect(() => {
    if (parsedAmountIn <= 0n) {
      setAmountOutText('');
      setQuotedOutRaw(0n);
      setQuoteError('');
      setQuoteNote('');
      setQuoteSource('none');
      return;
    }

    if (isWrapPair) {
      setAmountOutText(formatDisplayAmount(parsedAmountIn, tokenOut.decimals, 8));
      setQuotedOutRaw(parsedAmountIn);
      setQuoteError('');
      setQuoteNote('');
      setQuoteSource('router');
      setIsQuoting(false);
      return;
    }

    if (!publicClient || swapPath.length < 2) {
      setAmountOutText('');
      setQuotedOutRaw(0n);
      setQuoteError('');
      setQuoteNote('');
      setQuoteSource('none');
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
          setAmountOutText(formatDisplayAmount(output, tokenOut.decimals, 8));
          setQuoteSource('router');
          setQuoteNote('');
        })
        .catch(() => {
          const canUsePairFallback = !tokenIn.isNative && !tokenOut.isNative && swapPath.length === 2 && directPairFromSubgraph;

          if (!canUsePairFallback) {
            setQuotedOutRaw(0n);
            setAmountOutText('');
            setQuoteSource('none');
            setQuoteError('No route found on router for this pair and amount.');
            return;
          }

          try {
            const pair = directPairFromSubgraph;
            if (!pair) throw new Error('pair fallback missing');
            const inputLower = swapPath[0].toLowerCase();
            const pairToken0 = pair.token0.id.toLowerCase();
            const pairToken1 = pair.token1.id.toLowerCase();

            const token0Decimals = Number.parseInt(pair.token0.decimals, 10);
            const token1Decimals = Number.parseInt(pair.token1.decimals, 10);
            if (!Number.isInteger(token0Decimals) || !Number.isInteger(token1Decimals)) {
              throw new Error('invalid token decimals');
            }

            const reserve0Raw = parseUnits(pair.reserve0, token0Decimals);
            const reserve1Raw = parseUnits(pair.reserve1, token1Decimals);

            const reserveIn = inputLower === pairToken0 ? reserve0Raw : reserve1Raw;
            const reserveOut = inputLower === pairToken0 ? reserve1Raw : reserve0Raw;

            const output = getAmountOut(parsedAmountIn, reserveIn, reserveOut);
            if (output <= 0n) {
              throw new Error('insufficient reserve output');
            }

            setQuotedOutRaw(output);
            setAmountOutText(formatDisplayAmount(output, tokenOut.decimals, 8));
            setQuoteError('');
            setQuoteSource('pair-fallback');
            setQuoteNote('Router quote unavailable; using pair reserve fallback.');
          } catch {
            setQuotedOutRaw(0n);
            setAmountOutText('');
            setQuoteSource('none');
            setQuoteError('No route found on router for this pair and amount.');
          }
        })
        .finally(() => setIsQuoting(false));
    }, 450);

    return () => clearTimeout(timer);
  }, [directPairFromSubgraph, isWrapPair, parsedAmountIn, publicClient, swapPath, tokenIn.isNative, tokenOut.decimals, tokenOut.isNative]);

  useEffect(() => {
    const syncFromLocation = () => {
      const { route, poolRef } = parseRouteLocation(window.location);
      setActiveRoute(route);
      if (route === 'pool-detail') {
        setSelectedPoolId(poolRef);
      }
    };

    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, []);

  const navigateRoute = (route: AppRoute, options?: { poolId?: string | null }) => {
    const poolId = route === 'pool-detail' ? (options?.poolId || selectedPoolId) : undefined;
    const nextPath = routePath(route, poolId);
    if (route === 'pool-detail' && poolId) {
      setSelectedPoolId(poolId);
    }
    setActiveRoute(route);
    if (window.location.pathname !== nextPath || window.location.hash) {
      window.history.pushState(null, '', nextPath);
    }
  };

  useEffect(() => {
    if (activeRoute !== 'pool-detail' || !selectedPoolId) return;

    const normalizedPoolId = selectedPoolId.toLowerCase();
    const expectedPath = routePath('pool-detail', normalizedPoolId);
    if (window.location.pathname !== expectedPath || window.location.hash) {
      window.history.replaceState(null, '', expectedPath);
    }
  }, [activeRoute, selectedPoolId]);

  const connectWallet = async () => {
    const connector = connectors.find((item) => item.id === 'metaMask') || connectors[0];
    if (!connector) {
      showErrorToast('No injected wallet connector found. Install MetaMask first.');
      return;
    }

    try {
      await connectAsync({ connector });
    } catch (error) {
      showErrorToast(getErrorMessage(error));
    }
  };

  const addReefChain = async (): Promise<boolean> => {
    if (!window.ethereum) {
      showErrorToast('MetaMask extension not found in browser.');
      return false;
    }

    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [addEthereumChainParams],
    });

    return true;
  };

  const switchToReef = async () => {
    try {
      await switchChainAsync({ chainId: reefChain.id });
    } catch (error) {
      const code = (error as { cause?: { code?: number }; code?: number })?.code ||
        (error as { cause?: { code?: number } })?.cause?.code;

      if (code === 4902 && window.ethereum) {
        const added = await addReefChain();
        if (!added) return;
        await switchChainAsync({ chainId: reefChain.id });
        return;
      }

      showErrorToast(getErrorMessage(error));
    }
  };

  const approve = async () => {
    if (!walletClient || !publicClient || !address || tokenIn.isNative || !tokenIn.address) return;

    showInfoToast('Submitting approval...');
    setIsApproving(true);

    try {
      const hash = await walletClient.writeContract({
        account: address,
        chain: reefChain,
        address: tokenIn.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [swapSpender, MAX_APPROVAL],
      });

      setLastTxHash(hash);
      showInfoToast(`Approval submitted.\nTx: ${shortAddress(hash)}\nWaiting for confirmation...`);
      await publicClient.waitForTransactionReceipt({ hash });
      showSuccessToast('Approval confirmed.');
      await refreshChainState();
    } catch (error) {
      showErrorToast(getErrorMessage(error));
    } finally {
      setIsApproving(false);
    }
  };

  const swap = async () => {
    if (!walletClient || !publicClient || !address || parsedAmountIn <= 0n) {
      return;
    }

    if (!isWrapPair && (quotedOutRaw <= 0n || swapPath.length < 2)) {
      return;
    }

    if (isWrapPair) {
      const wrappedCode = await publicClient.getCode({ address: wrappedReefAddress });
      if (!wrappedCode || wrappedCode === '0x') {
        showErrorToast(`Wrapped token contract not found at ${wrappedReefAddress}. Update VITE_WREEF_ADDRESS or router deployment config.`);
        return;
      }
    }

    const actionLabel = isWrapPair ? (tokenIn.isNative ? 'Wrap' : 'Unwrap') : 'Swap';

    showInfoToast(`Submitting ${actionLabel.toLowerCase()}...`);
    setIsSwapping(true);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);

    try {
      let hash: Address;

      if (isWrapPair && tokenIn.isNative) {
        hash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: wrappedReefAddress,
          abi: wrappedReefAbi,
          functionName: 'deposit',
          args: [],
          value: parsedAmountIn,
        });
      } else if (isWrapPair) {
        hash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: wrappedReefAddress,
          abi: wrappedReefAbi,
          functionName: 'withdraw',
          args: [parsedAmountIn],
        });
      } else if (
        quoteSource === 'pair-fallback' &&
        directPairAddress &&
        directPairFromSubgraph &&
        !tokenIn.isNative &&
        !tokenOut.isNative &&
        swapPath.length === 2
      ) {
        const transferToPairHash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: tokenIn.address as Address,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [directPairAddress, parsedAmountIn],
        });

        showInfoToast(`Input transfer submitted.\nTx: ${shortAddress(transferToPairHash)}\nWaiting for confirmation...`);
        await publicClient.waitForTransactionReceipt({ hash: transferToPairHash });

        const pairToken0 = directPairFromSubgraph.token0.id.toLowerCase();
        const tokenInIsToken0 = pairToken0 === swapPath[0].toLowerCase();
        const desiredOut = quotedOutRaw;
        const amount0Out = tokenInIsToken0 ? 0n : desiredOut;
        const amount1Out = tokenInIsToken0 ? desiredOut : 0n;

        hash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: directPairAddress,
          abi: reefswapPairAbi,
          functionName: 'swap',
          args: [amount0Out, amount1Out, address, '0x'],
        });
      } else if (tokenIn.isNative) {
        hash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: contracts.router,
          abi: reefswapRouterAbi,
          functionName: 'swapExactETHForTokens',
          args: [minOut, swapPath, address, deadline],
          value: parsedAmountIn,
        });
      } else if (tokenOut.isNative) {
        hash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: contracts.router,
          abi: reefswapRouterAbi,
          functionName: 'swapExactTokensForETH',
          args: [parsedAmountIn, minOut, swapPath, address, deadline],
        });
      } else {
        hash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: contracts.router,
          abi: reefswapRouterAbi,
          functionName: 'swapExactTokensForTokens',
          args: [parsedAmountIn, minOut, swapPath, address, deadline],
        });
      }

      setLastTxHash(hash);
      showInfoToast(`${actionLabel} submitted.\nTx: ${shortAddress(hash)}\nWaiting for confirmation...`);
      await publicClient.waitForTransactionReceipt({ hash });
      showSuccessToast(`${actionLabel} confirmed.`);
      setAmountInText('');
      setAmountOutText('');
      setQuotedOutRaw(0n);
      await refreshChainState();
    } catch (error) {
      showErrorToast(getErrorMessage(error));
    } finally {
      setIsSwapping(false);
    }
  };

  const onSwitchTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountInText('');
    setAmountOutText('');
    setQuoteError('');
    setQuoteNote('');
    setQuoteSource('none');
  };

  const importToken = async () => {
    setImportError('');
    if (!publicClient) {
      setImportError('RPC client unavailable.');
      return;
    }

    if (!isAddress(importAddress)) {
      setImportError('Enter a valid ERC20 token address.');
      return;
    }

    const tokenAddress = getAddress(importAddress);

    const existing = tokens.find((token) => token.address === tokenAddress);
    if (existing) {
      setTokenOut(existing);
      setImportAddress('');
      return;
    }

    try {
      const [name, symbol, decimals] = await Promise.all([
        publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'name' }),
        publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'symbol' }),
        publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' }),
      ]);

      const token: TokenOption = {
        name,
        symbol: symbol.toUpperCase(),
        decimals: Number(decimals),
        address: tokenAddress,
        isNative: false,
      };

      setTokens((current) => [...current, token]);
      setTokenOut(token);
      setImportAddress('');
    } catch {
      setImportError('Unable to read ERC20 metadata for that address.');
    }
  };

  const setAmountByPercent = (percent: number) => {
    const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;

    if (balanceIn <= 0n || safePercent <= 0) {
      setAmountInText(safePercent === 0 ? '0' : '');
      return;
    }

    const basisPoints = BigInt(Math.round(safePercent * 100));
    const raw = (balanceIn * basisPoints) / 10_000n;
    setAmountInText(trimDecimalString(formatUnits(raw, tokenIn.decimals)));
  };

  const setSlippagePreset = (value: string) => {
    setSlippageText(value);
  };

  const setSlippageFromSlider = (position: number) => {
    const percentage = Math.max(0, Math.min(20, position / 5));
    setSlippageText(trimDecimalString(percentage.toFixed(1)));
  };

  const canSwap =
    isConnected &&
    !isWrongChain &&
    (!isWrapPair || (!isWrappedTokenContractMissing && routerWrappedTokenSource !== 'loading')) &&
    parsedAmountIn > 0n &&
    quotedOutRaw > 0n &&
    !hasInsufficientBalance &&
    !quoteError;
  const clampedSlippage = useMemo(() => {
    const numeric = Number(slippageText);
    if (!Number.isFinite(numeric)) return Number(DEFAULT_SLIPPAGE);
    return Math.min(20, Math.max(0, numeric));
  }, [slippageText]);
  const detailsRate = isWrapPair
    ? `1 ${tokenIn.symbol} = 1 ${tokenOut.symbol}`
    : routeLabel || '-';
  const amountSliderValue = useMemo(() => {
    if (balanceIn <= 0n || parsedAmountIn <= 0n) return 0;
    const basisPoints = Number((parsedAmountIn * 10_000n) / balanceIn);
    const percent = basisPoints / 100;
    return Math.max(0, Math.min(100, percent));
  }, [balanceIn, parsedAmountIn]);
  const slippageSliderValue = useMemo(() => {
    const mapped = Math.round(clampedSlippage * 5);
    return Math.max(0, Math.min(100, mapped));
  }, [clampedSlippage]);
  const swapButtonLabel = isSwapping
    ? isWrapPair
      ? tokenIn.isNative
        ? 'Wrapping...'
        : 'Unwrapping...'
      : 'Swapping...'
    : hasInsufficientBalance
      ? `Insufficient ${tokenIn.symbol}`
      : isWrapPair
        ? routerWrappedTokenSource === 'loading'
          ? 'Loading Wrapped Token...'
          : isWrappedTokenContractMissing
            ? 'Wrapped Token Unavailable'
            : tokenIn.isNative
              ? 'Wrap Now'
              : 'Unwrap Now'
        : 'Swap Now';

  const activityRows = useMemo(() => {
    const rows = [
      {
        id: 'sent-1',
        title: 'Sent REEF',
        time: 'Mar 2, 2026 · 10:49 PM',
        amount: '-342.00',
        direction: 'up' as const,
        positive: false,
        href: reefChain.blockExplorers.default.url,
      },
      {
        id: 'recv-1',
        title: 'Received PRLS',
        time: 'Mar 2, 2026 · 10:47 PM',
        amount: '+9.2449',
        direction: 'down' as const,
        positive: true,
        href: reefChain.blockExplorers.default.url,
      },
      {
        id: 'sent-2',
        title: 'Sent REEF',
        time: 'Mar 2, 2026 · 10:45 PM',
        amount: '-1.00',
        direction: 'up' as const,
        positive: false,
        href: reefChain.blockExplorers.default.url,
      },
    ];

    if (lastTxHash) {
      rows.unshift({
        id: lastTxHash,
        title: 'Latest Tx',
        time: `${shortAddress(lastTxHash)} · just now`,
        amount: 'View',
        direction: 'up' as const,
        positive: false,
        href: `${reefChain.blockExplorers.default.url}/tx/${lastTxHash}`,
      });
    }

    return rows;
  }, [lastTxHash]);

  const activityCardView = (
    <section className="activity-card">
      <div className="activity-head">
        <h3>Activity</h3>
        <a className="activity-open-link" href={reefChain.blockExplorers.default.url} target="_blank" rel="noreferrer">
          <span className="activity-open-link__icon">↗</span>
          Open Explorer
        </a>
      </div>
      <div className="activity-list-shell">
        <div className="activity-list">
          {activityRows.map((row, index) => (
            <div key={row.id}>
              <a className="activity-item" href={row.href} target="_blank" rel="noreferrer">
                <div className="activity-item__icon">{row.direction === 'up' ? '↗' : '↙'}</div>
                <div className="activity-item__meta">
                  <strong>{row.title}</strong>
                  <span>{row.time}</span>
                </div>
                <div className={`activity-item__amount ${row.positive ? 'positive' : ''}`}>
                  {row.amount}
                  <Uik.ReefIcon className="activity-item__amount-icon" />
                </div>
              </a>
              {index < activityRows.length - 1 ? <div className="activity-divider" /> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const swapStageView = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        backgroundColor: '#ece9f4',
        paddingTop: 96,
        paddingBottom: 24,
        paddingLeft: 16,
        paddingRight: 16,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          marginTop: 16,
          backgroundColor: 'hsl(var(--bg--h, 252), var(--bg--s, 35%), 97%)',
          borderRadius: 24,
          padding: '28px 24px 24px',
          boxShadow: '0 8px 48px rgba(93, 59, 173, 0.18)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Swap</h2>
          <button
            type="button"
            onClick={() => navigateRoute('tokens')}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'hsl(var(--bg--h, 252), var(--bg--s, 25%), 92%)',
              border: 'none', cursor: 'pointer', fontSize: 22,
              color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* FROM token row */}
        <div
          style={{
            background: 'hsl(var(--bg--h, 252), var(--bg--s, 28%), 93%)',
            borderRadius: 16, padding: '16px 20px', marginBottom: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
            <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
              {tokenIn.isNative ? (
                <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Uik.ReefSign style={{ width: 40, height: 40, color: '#7a3bbd' }} />
                </div>
              ) : (
                <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b8699', fontWeight: 700, fontSize: 34, lineHeight: 1 }}>
                  {tokenIn.symbol.charAt(0)}
                </div>
              )}
              <select
                value={tokenIn.isNative ? 'native' : tokenIn.address || ''}
                onChange={(e) => {
                  const tok = tokens.find((t) => (t.isNative ? 'native' : t.address || '') === e.target.value);
                  if (tok) setTokenIn(tok);
                }}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', borderRadius: '50%', width: '100%', height: '100%' }}
              >
                {tokens.map((t) => {
                  const k = t.isNative ? 'native' : t.address || '';
                  return <option key={k} value={k}>{t.symbol}</option>;
                })}
              </select>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', lineHeight: 1.2 }}>{tokenIn.symbol}</div>
              <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 2 }}>{formattedBalanceIn} {tokenIn.symbol}</div>
            </div>
          </div>
          <input
            value={amountInText}
            onChange={(e) => setAmountInText(normalizeInput(e.target.value))}
            inputMode="decimal"
            placeholder="0.0"
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: 24,
              fontWeight: 600,
              color: 'var(--text-light)',
              textAlign: 'right',
              width: 'clamp(160px, 38%, 240px)',
              minWidth: 0,
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        </div>

        {/* Switch button + Amount slider row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0' }}>
          <button
            type="button"
            onClick={onSwitchTokens}
            aria-label="Switch tokens"
            style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #a93185, #5d3bad)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 20, boxShadow: '0 2px 10px rgba(93, 59, 173, 0.4)',
            }}
          >
            ⇄
          </button>
          <div style={{ flex: 1 }}>
            <Uik.Slider
              value={amountSliderValue}
              helpers={AMOUNT_SLIDER_HELPERS}
              tooltip={`${amountSliderValue}%`}
              onChange={(position: number) => setAmountByPercent(position)}
            />
          </div>
        </div>

        {/* TO token row */}
        <div
          style={{
            background: 'hsl(var(--bg--h, 252), var(--bg--s, 28%), 93%)',
            borderRadius: 16, padding: '16px 20px', marginBottom: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
            <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
              <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b8699', fontWeight: 700, fontSize: 34, lineHeight: 1 }}>
                {tokenOut.isNative ? <Uik.ReefSign style={{ width: 40, height: 40, color: '#7a3bbd' }} /> : tokenOut.symbol.charAt(0)}
              </div>
              <select
                value={tokenOut.isNative ? 'native' : tokenOut.address || ''}
                onChange={(e) => {
                  const tok = tokens.find((t) => (t.isNative ? 'native' : t.address || '') === e.target.value);
                  if (tok) setTokenOut(tok);
                }}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', borderRadius: '50%', width: '100%', height: '100%' }}
              >
                {tokens.map((t) => {
                  const k = t.isNative ? 'native' : t.address || '';
                  return <option key={k} value={k}>{t.symbol}</option>;
                })}
              </select>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)', lineHeight: 1.2 }}>{tokenOut.symbol}</div>
              <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 2 }}>{formattedBalanceOut} {tokenOut.symbol}</div>
            </div>
          </div>
          <input
            value={amountOutText}
            readOnly
            placeholder="0.0"
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: 24,
              fontWeight: 600,
              color: 'var(--text-light)',
              textAlign: 'right',
              width: 'clamp(160px, 38%, 240px)',
              minWidth: 0,
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        </div>

        {/* Rate / Fee / Slippage info card */}
        <div
          style={{
            background: 'hsl(var(--bg--h, 252), var(--bg--s, 28%), 93%)',
            borderRadius: 14, padding: '14px 20px', marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 14, color: 'var(--text-light)', marginBottom: 8 }}>Rate</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 14, color: 'var(--text-light)' }}>Fee</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{isWrapPair ? '0 $' : '0.30%'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, color: 'var(--text-light)' }}>Slippage</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{clampedSlippage.toFixed(1)}%</span>
          </div>
        </div>
        {quoteError ? (
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#b24471' }}>{quoteError}</p>
        ) : null}
        {!quoteError && quoteNote ? (
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6a5b8b' }}>{quoteNote}</p>
        ) : null}

        {/* Slippage slider */}
        <div style={{ marginBottom: 20 }}>
          <Uik.Slider
            value={slippageSliderValue}
            steps={1}
            helpers={SLIPPAGE_SLIDER_HELPERS}
            tooltip={`${clampedSlippage.toFixed(1)}%`}
            onChange={setSlippageFromSlider}
          />
        </div>

        {/* Action button */}
        {isWrongChain ? (
          <Uik.Button text={isSwitching ? 'Switching...' : 'Switch To Reef Chain'} fill size="large" disabled={isSwitching} onClick={switchToReef} />
        ) : requiresApproval ? (
          <Uik.Button text={isApproving ? 'Approving...' : `Approve ${tokenIn.symbol}`} fill size="large" disabled={isApproving || hasInsufficientBalance || parsedAmountIn <= 0n} onClick={approve} />
        ) : (
          <Uik.Button text={swapButtonLabel} fill={canSwap} size="large" disabled={!canSwap || isSwapping || isRefreshing} onClick={swap} />
        )}

      </div>
    </div>
  );

  const tokensRouteView = (
    <TokensView
      onSwap={() => navigateRoute('swap')}
      tokens={tokens}
      wrappedTokenAddress={wrappedReefAddress}
    />
  );

  const swapRouteView = (
    <>
      {swapStageView}
      <Uik.Modal
        className="connection-modal"
        title="Connection"
        isOpen={connectionInfoOpen}
        onClose={() => setConnectionInfoOpen(false)}
      >
        <div className="connection-modal-content">
          <ul>
            <li>
              <span>RPC</span>
              <code>{reefChain.rpcUrls.default.http[0]}</code>
            </li>
            <li>
              <span>Router WETH()</span>
              <code>{routerWrappedTokenSource === 'loading' ? 'Checking...' : routerWrappedToken}</code>
            </li>
            <li>
              <span>Router02</span>
              <code>{contracts.router}</code>
            </li>
            <li>
              <span>Swap Spender</span>
              <code>{swapSpender}</code>
            </li>
          </ul>
          {routerWrappedTokenSource === 'fallback' ? (
            <p className="note">Router `WETH()` call failed on this RPC; using configured WrappedREEF fallback.</p>
          ) : null}
          {routerWrappedTokenSource === 'subgraph' ? (
            <p className="note">Configured WrappedREEF had no contract code, switched to subgraph-indexed WrappedREEF.</p>
          ) : null}
          {isWrappedTokenContractMissing ? (
            <p className="note">WrappedREEF address has no deployed contract code on current RPC.</p>
          ) : null}
        </div>
      </Uik.Modal>
    </>
  );

  const creatorRouteView = <CreatorPage />;

  const selectedPool = useMemo(
    () => subgraphPairs.find((pair) => pair.id.toLowerCase() === (selectedPoolId || '').toLowerCase()) || subgraphPairs[0] || null,
    [selectedPoolId, subgraphPairs],
  );

  const poolsRouteView = (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#1b1530]">Liquidity Pools</h1>
        <p className="text-sm text-[#8e899c] mt-1">Add liquidity to earn fees from swaps</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main pools area */}
        <div className="lg:col-span-2 space-y-4">
          {/* All Pools header */}
          <div className="rounded-3xl bg-white shadow-sm border border-[#ebe6f4] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#ebe6f4] flex items-center justify-between">
              <span className="text-base font-semibold text-[#1b1530]">All Pools</span>
              <button
                type="button"
                onClick={() => navigateRoute('swap')}
                className="rounded-full bg-gradient-to-r from-[#a93185] to-[#5d3bad] text-white text-sm font-semibold px-4 py-2 hover:brightness-110 transition-all"
              >
                + New Position
              </button>
            </div>
            {/* Header row */}
            <div className="px-6 py-2 grid grid-cols-5 text-xs font-semibold text-[#8e899c] uppercase tracking-wide border-b border-[#ebe6f4]">
              <span className="col-span-2">Pool</span>
              <span className="text-right">Fee</span>
              <span className="text-right">TVL</span>
              <span className="text-right">Actions</span>
            </div>
            {isPoolsLoading ? (
              <div className="px-6 py-8 text-center text-sm text-[#8e899c]">Loading pools from subgraph...</div>
            ) : hasPoolsError ? (
              <div className="px-6 py-8 text-center text-sm text-[#8e899c]">Could not load pools from subgraph.</div>
            ) : !subgraphPairs.length ? (
              <div className="px-6 py-8 text-center text-sm text-[#8e899c]">No indexed pairs found yet.</div>
            ) : (
              subgraphPairs.map((pair) => (
                <div
                  key={pair.id}
                  className="px-6 py-4 grid grid-cols-5 items-center hover:bg-[#f8f5ff] transition-colors cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    navigateRoute('pool-detail', { poolId: pair.id });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigateRoute('pool-detail', { poolId: pair.id });
                    }
                  }}
                >
                  <div className="col-span-2 flex items-center gap-3">
                    <div className="flex -space-x-2">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#a93185] to-[#5d3bad] flex items-center justify-center z-10 shadow-sm text-white text-sm font-semibold">
                        {pair.token0.symbol === 'REEF' ? <Uik.ReefIcon className="h-5 w-5 text-white" /> : pair.token0.symbol.slice(0, 1)}
                      </div>
                      <div className="w-9 h-9 rounded-full bg-[#e0d8f0] flex items-center justify-center border-2 border-white shadow-sm text-[#7a3bbd] text-sm font-semibold">
                        {pair.token1.symbol.slice(0, 1)}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1b1530]">{pair.token0.symbol} / {pair.token1.symbol}</p>
                      <p className="text-xs text-[#8e899c]">{shortAddress(pair.id)}</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-right text-[#5d3bad]">0.3%</span>
                  <span className="text-sm font-medium text-right text-[#1b1530]">{formatCompactUsd(pair.reserveUSD)}</span>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedPoolId(pair.id);
                        navigateRoute('chart');
                      }}
                      className="rounded-xl bg-[#f1edf8] text-[#7a3bbd] text-xs font-semibold px-3 py-1.5 hover:bg-[#e6dff5] transition-all"
                    >
                      Chart
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigateRoute('swap');
                      }}
                      className="rounded-xl bg-gradient-to-r from-[#a93185] to-[#5d3bad] text-white text-xs font-semibold px-3 py-1.5 hover:brightness-110 transition-all"
                    >
                      Trade
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Your Positions */}
          <div className="rounded-3xl bg-white shadow-sm border border-[#ebe6f4] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#ebe6f4]">
              <span className="text-base font-semibold text-[#1b1530]">Your Positions</span>
            </div>
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-[#8e899c]">No liquidity positions yet. Add liquidity to start earning fees.</p>
            </div>
          </div>
        </div>

        {/* Stats sidebar */}
        <div className="space-y-4">
          <div className="rounded-3xl bg-white shadow-sm border border-[#ebe6f4] p-6">
            <h3 className="text-base font-semibold text-[#1b1530] mb-4">Pool Stats</h3>
            <div className="space-y-3">
              {[
                { label: 'Active Pairs', value: formatTokenCount(subgraphFactory?.pairCount ?? subgraphPairs.length) },
                { label: 'Total Volume', value: formatCompactUsd(subgraphFactory?.totalVolumeUSD) },
                { label: 'Total Value Locked', value: formatCompactUsd(subgraphFactory?.totalLiquidityUSD) },
                { label: 'Indexed Tokens', value: formatTokenCount(subgraphTokens.length) },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-[#8e899c]">{item.label}</span>
                  <span className="text-sm font-semibold text-[#1b1530]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-[#f8f5ff] border border-[#ebe6f4] p-6">
            <p className="text-sm font-semibold text-[#1b1530] mb-1">How Pools Work</p>
            <p className="text-xs text-[#8e899c] leading-relaxed">
              Provide liquidity to earn a share of the 0.3% fee on all trades proportional to your share of the pool.
            </p>
          </div>
        </div>
      </div>

      <section className="mt-6 rounded-[24px] border border-[#e4deef] bg-white px-4 py-3.5 md:px-5 md:py-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[1.45rem] font-semibold leading-none text-[#1f2743] md:text-[1.6rem]">Indexed Pools</h2>
          <div className="flex items-center">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-[16px] border border-[#eadff2] bg-[#f1eaf8] px-4 py-2 text-[0.96rem] font-semibold text-[#b13a8e]"
            >
              <Search className="h-4.5 w-4.5" />
              Search
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="grid grid-cols-[minmax(220px,1.6fr)_minmax(120px,1fr)_minmax(100px,0.8fr)_minmax(100px,0.9fr)_minmax(110px,0.9fr)_minmax(250px,1.2fr)] items-center gap-x-3 px-4 pb-2 text-[0.82rem] font-semibold text-[#202946]">
            <span>Pair</span>
            <span className="text-center">Reserves</span>
            <span className="text-center">TVL</span>
            <span className="text-center">Volume</span>
            <span className="text-center">Tx Count</span>
            <span />
          </div>

          <div className="space-y-2">
            {(subgraphPairs.length ? subgraphPairs : []).map((pool) => (
              <div
                key={pool.id}
                className="grid grid-cols-[minmax(220px,1.6fr)_minmax(120px,1fr)_minmax(100px,0.8fr)_minmax(100px,0.9fr)_minmax(110px,0.9fr)_minmax(250px,1.2fr)] items-center gap-x-3 rounded-[18px] bg-[#ece9f4] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-9 w-[3rem] flex-shrink-0">
                    <span className="absolute left-0 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-[#ab2cc6] to-[#6d35b2] text-white shadow-sm">
                      {pool.token0.symbol === 'REEF' ? <Uik.ReefIcon className="h-4.5 w-4.5" /> : pool.token0.symbol.slice(0, 1)}
                    </span>
                    <span className="absolute left-4 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-[#d4cee3] text-sm font-bold text-[#574a75] shadow-sm">
                      {pool.token1.symbol.slice(0, 1)}
                    </span>
                  </div>
                  <span className="text-[0.95rem] font-semibold text-[#1f2743]">{pool.token0.symbol} / {pool.token1.symbol}</span>
                </div>

                <span className="text-center text-[0.95rem] font-semibold text-[#1f2743]">
                  {asNumber(pool.reserve0).toFixed(2)} / {asNumber(pool.reserve1).toFixed(2)}
                </span>
                <span className="text-center text-[0.95rem] font-semibold text-[#1f2743]">{formatUsd(pool.reserveUSD)}</span>
                <span className="text-center text-[0.95rem] font-semibold text-[#1f2743]">{formatUsd(pool.volumeUSD)}</span>
                <span className="text-center text-[0.95rem] font-semibold text-[#2fad73]">{formatTokenCount(pool.txCount)}</span>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigateRoute('pool-detail', { poolId: pool.id });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#a93185] to-[#5d3bad] px-3.5 py-1.5 text-[0.88rem] font-semibold text-white shadow-sm hover:brightness-110"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateRoute('swap')}
                    className="inline-flex items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#a93185] to-[#6b33b4] px-3.5 py-1.5 text-[0.88rem] font-semibold text-white shadow-sm hover:brightness-110"
                  >
                    <Coins className="h-3.5 w-3.5" />
                    Trade
                  </button>
                </div>
              </div>
            ))}
            {!subgraphPairs.length ? (
              <div className="rounded-[18px] bg-[#ece9f4] px-4 py-6 text-center text-sm text-[#8e899c]">
                No pairs available from subgraph.
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-0.5 rounded-[16px] bg-[#e2dcea] p-1.5">
              <button
                type="button"
                className="h-9 min-w-9 rounded-[10px] bg-gradient-to-r from-[#a93185] to-[#7a32b4] px-3 text-[0.95rem] font-semibold text-white"
              >
                1
              </button>
              <button
                type="button"
                className="h-9 min-w-9 rounded-[10px] px-3 text-[0.95rem] font-semibold text-[#202946]"
              >
                2
              </button>
              <button
                type="button"
                aria-label="Next page"
                className="h-9 min-w-9 rounded-[10px] px-3 text-[1.1rem] font-medium text-[#8f86a5]"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  const chartRouteView = <ChartView onNavigate={navigateRoute} />;
  const poolDetailRouteView = <PoolDetailPage pair={selectedPool} />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader activeRoute={activeRoute} onNavigate={navigateRoute} />

      <main className={activeRoute === 'tokens' || activeRoute === 'pools' || activeRoute === 'chart' || activeRoute === 'swap' || activeRoute === 'pool-detail' ? '' : 'dashboard-content'}>
        {isConnected ? (
          activeRoute === 'tokens' ? (
            tokensRouteView
          ) : activeRoute === 'swap' ? (
            swapRouteView
          ) : activeRoute === 'create-token' ? (
            creatorRouteView
          ) : activeRoute === 'pool-detail' ? (
            poolDetailRouteView
          ) : activeRoute === 'chart' ? (
            chartRouteView
          ) : (
            poolsRouteView
          )
        ) : (
          <div className="relative overflow-hidden rounded-3xl bg-[#f2eff8] px-10 py-16 text-center shadow-sm mt-8">
            <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#a93185]/20 to-[#5d3bad]/20 blur-2xl" />
            <div className="absolute -right-16 -bottom-16 h-64 w-64 rounded-full bg-gradient-to-br from-[#5d3bad]/20 to-[#a93185]/20 blur-2xl" />
            <div className="relative z-10 mx-auto flex max-w-xl flex-col items-center">
              <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/70 shadow-sm overflow-hidden">
                <Uik.ReefIcon className="h-10 w-10 text-[#7a3bbd] relative z-10" />
              </div>
              <h2 className="text-3xl font-semibold text-[#1b1530]">Connect to Reefswap</h2>
              <p className="mt-2 text-base text-[#8e899c]">
                Connect MetaMask to view balances, activity, and swap tokens on Reef chain.
              </p>
              <div className="mt-6 flex items-center gap-3 text-sm text-[#8e899c]">
                <span className="rounded-full bg-white/70 px-3 py-1">Secure</span>
                <span className="rounded-full bg-white/70 px-3 py-1">Non‑custodial</span>
                <span className="rounded-full bg-white/70 px-3 py-1">Mainnet ready</span>
              </div>
            </div>
            <Uik.Bubbles className="absolute inset-0 opacity-60 pointer-events-none" />
          </div>
        )}
      </main>

      {!isConnected && (
        <footer className="fixed bottom-0 left-0 right-0 bg-[#f2f0f8] border-t border-border px-6 py-3">
          <button
            type="button"
            className="rounded-full bg-white/70 text-[#5d3bad] hover:bg-white hover:text-[#5d3bad] hover:scale-105 hover:shadow-md active:scale-95 shadow-sm text-sm font-medium px-4 py-2 transition-all duration-200 ease-out flex items-center gap-1.5"
            onClick={async () => {
              try {
                await addReefChain();
              } catch (error) {
                showErrorToast(getErrorMessage(error));
              }
            }}
          >
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"
              alt=""
              className="h-4 w-4"
            />
            Add to MetaMask
          </button>
        </footer>
      )}
    </div>
  );
};

export default App;
