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
import { formatUnits, getAddress, isAddress, parseUnits, type Address } from 'viem';
import { erc20Abi, reefswapFactoryAbi, reefswapRouterAbi, wrappedReefAbi } from './lib/abi';
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

const isWrapPairSelection = (a: TokenOption, b: TokenOption): boolean =>
  (a.isNative && b.address === contracts.wrappedReef) || (b.isNative && a.address === contracts.wrappedReef);

const NAV_ROUTES: { route: AppRoute; label: string; path: string }[] = [
  { route: 'tokens', label: 'Tokens', path: '/' },
  { route: 'swap', label: 'Swap', path: '/swap' },
  { route: 'pools', label: 'Pools', path: '/pools' },
  { route: 'create-token', label: 'Creator', path: '/create-token' },
  { route: 'chart', label: 'Chart', path: '/chart' },
  { route: 'pool-detail', label: 'Pool Detail', path: '/pool/reef-flpr' },
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

const normalizeRouteSegment = (value: string | null | undefined): string =>
  (value || '').replace(/^#\/?/, '').replace(/^\/+/, '').split('/')[0].trim().toLowerCase();

const resolveRoute = (value: string | null | undefined): AppRoute => {
  const segment = normalizeRouteSegment(value);
  return ROUTE_ALIAS[segment] || 'tokens';
};

const resolveRouteFromLocation = (location: Pick<Location, 'pathname' | 'hash'>): AppRoute => {
  const hashSegment = normalizeRouteSegment(location.hash);
  if (hashSegment) return resolveRoute(hashSegment);
  return resolveRoute(location.pathname);
};

const routePath = (route: AppRoute): string => NAV_ROUTES.find((item) => item.route === route)?.path || '/';

const trimDecimalString = (value: string): string => {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
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

const TokensView = ({ onSwap }: { onSwap?: () => void }) => {
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
          <AssetTabs onSwap={onSwap} />
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
  const [routerWrappedTokenSource, setRouterWrappedTokenSource] = useState<'loading' | 'router' | 'fallback'>('loading');
  const [firstHopPair, setFirstHopPair] = useState<Address | null>(null);

  const [isQuoting, setIsQuoting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);

  const [quoteError, setQuoteError] = useState('');
  const [actionError, setActionError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [lastTxHash, setLastTxHash] = useState<Address | null>(null);

  const [importAddress, setImportAddress] = useState('');
  const [importError, setImportError] = useState('');
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => {
    if (typeof window === 'undefined') return 'tokens';
    return resolveRouteFromLocation(window.location);
  });
  const [connectionInfoOpen, setConnectionInfoOpen] = useState(false);

  const isWrongChain = isConnected && chainId !== reefChain.id;
  const isWrapPair = useMemo(() => isWrapPairSelection(tokenIn, tokenOut), [tokenIn, tokenOut]);

  const swapPath = useMemo(() => {
    if (isWrapPair) return [] as Address[];

    const inputAddress = tokenIn.isNative ? contracts.wrappedReef : tokenIn.address;
    const outputAddress = tokenOut.isNative ? contracts.wrappedReef : tokenOut.address;

    if (!inputAddress || !outputAddress) return [] as Address[];
    if (inputAddress === outputAddress) return [] as Address[];

    if (!tokenIn.isNative && !tokenOut.isNative) {
      if (inputAddress === contracts.wrappedReef || outputAddress === contracts.wrappedReef) {
        return [inputAddress, outputAddress];
      }
      return [inputAddress, contracts.wrappedReef, outputAddress];
    }

    return [inputAddress, outputAddress];
  }, [isWrapPair, tokenIn, tokenOut]);

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
          (addressPart === contracts.wrappedReef ? 'WREEF' : shortAddress(addressPart)),
      )
      .join(' -> ');
  }, [isWrapPair, swapPath, tokenIn.symbol, tokenOut.symbol, tokens]);

  const refreshChainState = useCallback(async () => {
    if (!publicClient || !address) {
      setBalanceIn(0n);
      setBalanceOut(0n);
      setWalletNativeBalance(0n);
      setAllowance(0n);
      setFirstHopPair(null);
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

        return publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        });
      };

      const [inputBalance, outputBalance] = await Promise.all([readTokenBalance(tokenIn), readTokenBalance(tokenOut)]);
      setBalanceIn(inputBalance);
      setBalanceOut(outputBalance);

      if (isWrapPair || tokenIn.isNative || !tokenIn.address) {
        setAllowance(MAX_APPROVAL);
      } else {
        const allowanceValue = await publicClient.readContract({
          address: tokenIn.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, contracts.router],
        });
        setAllowance(allowanceValue);
      }

      if (!isWrapPair && swapPath.length >= 2) {
        const pair = await publicClient.readContract({
          address: contracts.factory,
          abi: reefswapFactoryAbi,
          functionName: 'getPair',
          args: [swapPath[0], swapPath[1]],
        });
        if (pair === '0x0000000000000000000000000000000000000000') {
          setFirstHopPair(null);
        } else {
          setFirstHopPair(pair);
        }
      } else {
        setFirstHopPair(null);
      }
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [address, isWrapPair, publicClient, swapPath, tokenIn, tokenOut]);

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
    refreshChainState().catch(() => {
      // no-op
    });
  }, [refreshChainState]);

  useEffect(() => {
    if (parsedAmountIn <= 0n) {
      setAmountOutText('');
      setQuotedOutRaw(0n);
      setQuoteError('');
      return;
    }

    if (isWrapPair) {
      setAmountOutText(formatDisplayAmount(parsedAmountIn, tokenOut.decimals, 8));
      setQuotedOutRaw(parsedAmountIn);
      setQuoteError('');
      setIsQuoting(false);
      return;
    }

    if (!publicClient || swapPath.length < 2) {
      setAmountOutText('');
      setQuotedOutRaw(0n);
      setQuoteError('');
      return;
    }

    setIsQuoting(true);
    setQuoteError('');

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
        })
        .catch(() => {
          setQuotedOutRaw(0n);
          setAmountOutText('');
          setQuoteError('No route found on router for this pair and amount.');
        })
        .finally(() => setIsQuoting(false));
    }, 450);

    return () => clearTimeout(timer);
  }, [isWrapPair, parsedAmountIn, publicClient, swapPath, tokenOut.decimals]);

  useEffect(() => {
    const syncFromLocation = () => {
      setActiveRoute(resolveRouteFromLocation(window.location));
    };

    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, []);

  const navigateRoute = (route: AppRoute) => {
    const nextPath = routePath(route);
    setActiveRoute(route);
    if (window.location.pathname !== nextPath || window.location.hash) {
      window.history.pushState(null, '', nextPath);
    }
  };

  const connectWallet = async () => {
    setActionError('');
    setStatusMessage('');

    const connector = connectors.find((item) => item.id === 'metaMask') || connectors[0];
    if (!connector) {
      setActionError('No injected wallet connector found. Install MetaMask first.');
      return;
    }

    try {
      await connectAsync({ connector });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  const addReefChain = async (): Promise<boolean> => {
    if (!window.ethereum) {
      setActionError('MetaMask extension not found in browser.');
      return false;
    }

    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [addEthereumChainParams],
    });

    return true;
  };

  const switchToReef = async () => {
    setActionError('');
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

      setActionError(getErrorMessage(error));
    }
  };

  const approve = async () => {
    if (!walletClient || !publicClient || !address || tokenIn.isNative || !tokenIn.address) return;

    setActionError('');
    setStatusMessage('Submitting approval...');
    setIsApproving(true);

    try {
      const hash = await walletClient.writeContract({
        account: address,
        chain: reefChain,
        address: tokenIn.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contracts.router, MAX_APPROVAL],
      });

      setLastTxHash(hash);
      setStatusMessage('Approval submitted. Waiting for confirmation...');
      await publicClient.waitForTransactionReceipt({ hash });
      setStatusMessage('Approval confirmed.');
      await refreshChainState();
    } catch (error) {
      setActionError(getErrorMessage(error));
      setStatusMessage('');
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

    const actionLabel = isWrapPair ? (tokenIn.isNative ? 'Wrap' : 'Unwrap') : 'Swap';

    setActionError('');
    setStatusMessage(`Submitting ${actionLabel.toLowerCase()}...`);
    setIsSwapping(true);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);

    try {
      let hash: Address;

      if (isWrapPair && tokenIn.isNative) {
        hash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: contracts.wrappedReef,
          abi: wrappedReefAbi,
          functionName: 'deposit',
          args: [],
          value: parsedAmountIn,
        });
      } else if (isWrapPair) {
        hash = await walletClient.writeContract({
          account: address,
          chain: reefChain,
          address: contracts.wrappedReef,
          abi: wrappedReefAbi,
          functionName: 'withdraw',
          args: [parsedAmountIn],
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
      setStatusMessage(`${actionLabel} submitted. Waiting for confirmation...`);
      await publicClient.waitForTransactionReceipt({ hash });
      setStatusMessage(`${actionLabel} confirmed.`);
      setAmountInText('');
      setAmountOutText('');
      setQuotedOutRaw(0n);
      await refreshChainState();
    } catch (error) {
      setActionError(getErrorMessage(error));
      setStatusMessage('');
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
        ? tokenIn.isNative
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
        backgroundColor: 'rgba(242, 240, 248, 0.85)',
        backdropFilter: 'blur(8px)',
        paddingTop: 80,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 24, fontWeight: 600, color: 'var(--text-light)', textAlign: 'right', width: 130, minWidth: 0 }}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 24, fontWeight: 600, color: 'var(--text-light)', textAlign: 'right', width: 130, minWidth: 0 }}
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

        {statusMessage ? <p style={{ color: 'var(--success)', fontSize: 12, marginTop: 8, textAlign: 'center' }}>{statusMessage}</p> : null}
        {actionError ? <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8, textAlign: 'center' }}>{actionError}</p> : null}
      </div>
    </div>
  );

  const tokensRouteView = <TokensView onSwap={() => navigateRoute('swap')} />;

  const swapRouteView = (
    <>
      <div style={{ pointerEvents: 'none', userSelect: 'none', opacity: 0.45, filter: 'blur(2px)' }}>
        <TokensView />
      </div>
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
          </ul>
          {routerWrappedTokenSource === 'fallback' ? (
            <p className="note">Router `WETH()` call failed on this RPC; using configured WrappedREEF fallback.</p>
          ) : null}
        </div>
      </Uik.Modal>
    </>
  );

  const creatorRouteView = <CreatorPage />;

  const REEF_WREEF_POOL = '0x3D37D5452BDeA164666291890D2830A82be141E1';

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
            {/* REEF-WREEF pool row */}
            <div
              className="px-6 py-4 grid grid-cols-5 items-center hover:bg-[#f8f5ff] transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => navigateRoute('pool-detail')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigateRoute('pool-detail');
                }
              }}
            >
              <div className="col-span-2 flex items-center gap-3">
                <div className="flex -space-x-2">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#a93185] to-[#5d3bad] flex items-center justify-center z-10 shadow-sm">
                    <Uik.ReefIcon className="h-5 w-5 text-white" />
                  </div>
                  <div className="w-9 h-9 rounded-full bg-[#e0d8f0] flex items-center justify-center border-2 border-white shadow-sm">
                    <Uik.ReefSign className="h-4 w-4 text-[#7a3bbd]" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#1b1530]">REEF / WREEF</p>
                  <p className="text-xs text-[#8e899c]">{REEF_WREEF_POOL.slice(0, 6)}…{REEF_WREEF_POOL.slice(-4)}</p>
                </div>
              </div>
              <span className="text-sm font-medium text-right text-[#5d3bad]">0.3%</span>
              <span className="text-sm font-medium text-right text-[#1b1530]">—</span>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
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
                { label: 'Active Pairs', value: '1' },
                { label: '24h Volume', value: '—' },
                { label: 'Total Value Locked', value: '—' },
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
    </div>
  );

  const chartRouteView = <ChartView onNavigate={navigateRoute} />;
  const poolDetailRouteView = <PoolDetailPage />;

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
              setActionError('');
              try {
                await addReefChain();
              } catch (error) {
                setActionError(getErrorMessage(error));
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
