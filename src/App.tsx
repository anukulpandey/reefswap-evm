import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
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
import BuyReefButton from './components/BuyReefButton';
import { defaultTokens, nativeReef, type TokenOption } from './lib/tokens';
import { formatDisplayAmount, getErrorMessage, normalizeInput, shortAddress } from './lib/utils';

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

type AppRoute = 'tokens' | 'swap' | 'pools' | 'create-token';

const isWrapPairSelection = (a: TokenOption, b: TokenOption): boolean =>
  (a.isNative && b.address === contracts.wrappedReef) || (b.isNative && a.address === contracts.wrappedReef);

const NAV_ROUTES: { route: AppRoute; label: string; path: string }[] = [
  { route: 'tokens', label: 'Tokens', path: '/' },
  { route: 'swap', label: 'Swap', path: '/swap' },
  { route: 'pools', label: 'Pools', path: '/pools' },
  { route: 'create-token', label: 'Creator', path: '/create-token' },
];

const ROUTE_ALIAS: Record<string, AppRoute> = {
  '': 'tokens',
  tokens: 'tokens',
  dashboard: 'tokens',
  swap: 'swap',
  pools: 'pools',
  creator: 'create-token',
  'create-token': 'create-token',
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
  const [assetTab, setAssetTab] = useState<'tokens' | 'nfts'>('tokens');
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => {
    if (typeof window === 'undefined') return 'tokens';
    return resolveRouteFromLocation(window.location);
  });
  const [creatorTokenName, setCreatorTokenName] = useState('');
  const [creatorSymbol, setCreatorSymbol] = useState('');
  const [creatorSupply, setCreatorSupply] = useState('');
  const [creatorBurnable, setCreatorBurnable] = useState(true);
  const [creatorMintable, setCreatorMintable] = useState(true);
  const [creatorIcon, setCreatorIcon] = useState('');
  const [creatorConfirmOpen, setCreatorConfirmOpen] = useState(false);
  const [connectionInfoOpen, setConnectionInfoOpen] = useState(false);
  const [creatorStatus, setCreatorStatus] = useState('');

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
    if (balanceIn <= 0n || percent <= 0) {
      setAmountInText(percent === 0 ? '0' : '');
      return;
    }

    const raw = (balanceIn * BigInt(percent)) / 100n;
    setAmountInText(trimDecimalString(formatUnits(raw, tokenIn.decimals)));
  };

  const setSlippagePreset = (value: string) => {
    setSlippageText(value);
  };

  const setSlippageFromSlider = (position: number) => {
    const percentage = Math.max(0, Math.min(20, position / 5));
    setSlippageText(trimDecimalString(percentage.toFixed(1)));
  };

  const handleCreatorIconUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      setCreatorIcon(value);
    };
    reader.readAsDataURL(file);
  };

  const confirmCreatorDraft = () => {
    setCreatorConfirmOpen(false);
    setCreatorStatus('Token draft confirmed. Wire this form to your deploy script to publish on-chain.');
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
  const walletReefBalanceNumber = Number(formatUnits(walletNativeBalance, nativeReef.decimals));
  const formattedWalletReefBalance = formatDisplayAmount(walletNativeBalance, nativeReef.decimals, 2);
  const formattedWalletReefUsd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(walletReefBalanceNumber * REEF_USD_PRICE);
  const formattedReefUsdPrice = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  }).format(REEF_USD_PRICE);
  const formattedReefTokenAmount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(walletReefBalanceNumber);
  const formattedReefTokenUsdValue = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(walletReefBalanceNumber * REEF_USD_PRICE);
  const amountSliderValue = useMemo(() => {
    if (balanceIn <= 0n || parsedAmountIn <= 0n) return 0;
    const percent = Number((parsedAmountIn * 10_000n) / balanceIn) / 100;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }, [balanceIn, parsedAmountIn]);
  const slippageSliderValue = useMemo(() => {
    const mapped = Math.round(clampedSlippage * 5);
    return Math.max(0, Math.min(100, mapped));
  }, [clampedSlippage]);
  const creatorValidationMsg = useMemo(() => {
    if (!creatorTokenName.trim()) return 'Set token name';
    if (!creatorSymbol.trim()) return 'Set token symbol';
    if (!creatorSupply.trim()) return 'Set initial supply';
    const parsedSupply = Number(creatorSupply);
    if (!Number.isInteger(parsedSupply) || parsedSupply <= 0) {
      return 'Initial supply must be a positive whole number';
    }
    return '';
  }, [creatorSupply, creatorSymbol, creatorTokenName]);
  const creatorSymbolUpper = creatorSymbol.trim().toUpperCase();
  const creatorSupplyFormatted = creatorSupply ? Uik.utils.formatHumanAmount(creatorSupply) : '0';
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

  const homeAssetPanelView = (
    <aside className="asset-panel panel-card">
      <div className="asset-tabs">
        <button
          type="button"
          className={`asset-tab ${assetTab === 'tokens' ? 'active' : ''}`}
          onClick={() => setAssetTab('tokens')}
        >
          Tokens
        </button>
        <button
          type="button"
          className={`asset-tab ${assetTab === 'nfts' ? 'active' : ''}`}
          onClick={() => setAssetTab('nfts')}
        >
          NFTs
        </button>
      </div>

      {assetTab === 'tokens' ? (
        <div className="token-list token-list--home">
          <article className="token-row token-row--home">
            <div className="token-row__left">
              <div className="token-badge token-badge--reef">
                <Uik.ReefIcon className="token-badge__icon" />
              </div>
              <div className="token-row__meta">
                <strong>REEF</strong>
                <small>{formattedReefUsdPrice}</small>
              </div>
            </div>
            <div className="token-row__right">
              <div className="token-row__amount">
                <strong>{formattedReefTokenUsdValue}</strong>
                <small>{formattedReefTokenAmount} REEF</small>
              </div>
              <button type="button" className="send-btn" onClick={() => navigateRoute('swap')}>
                Send
              </button>
            </div>
          </article>
        </div>
      ) : (
        <div className="nft-empty">
          <p>Your wallet doesn't own any NFTs.</p>
        </div>
      )}
    </aside>
  );

  const activityCardView = (
    <section className="panel-card activity-card">
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
    <section className="swap-stage">
      <article className="swap-modal swap-modal--pro">
        <div className="modal-head">
          <h2>Swap</h2>
          <div className="modal-actions">
            <button
              type="button"
              className="swap-info-btn"
              onClick={() => setConnectionInfoOpen(true)}
              aria-label="Open connection details"
            >
              i
            </button>
            <button type="button" className="close-btn" onClick={() => setAmountInText('')} aria-label="Reset input">
              ×
            </button>
          </div>
        </div>

        <div className="swap-box">
          <div className="field-grid">
            <TokenSelect label="From" value={tokenIn} options={tokens} onChange={setTokenIn} />
            <label className="amount-field">
              <span>Amount</span>
              <input
                value={amountInText}
                onChange={(event) => setAmountInText(normalizeInput(event.target.value))}
                inputMode="decimal"
                placeholder="0.0"
              />
              <small>Balance: {formattedBalanceIn} {tokenIn.symbol}</small>
            </label>
          </div>

          <div className="swap-slider-group">
            <div className="swap-slider-group__head">
              <span>Amount preset</span>
              <strong>{amountSliderValue}%</strong>
            </div>
            <Uik.Slider
              value={amountSliderValue}
              steps={25}
              helpers={AMOUNT_SLIDER_HELPERS}
              tooltip={`${amountSliderValue}%`}
              onChange={(position: number) => setAmountByPercent(position)}
            />
            <div className="preset-strip">
              {AMOUNT_PRESETS.map((percent) => (
                <button
                  key={percent}
                  type="button"
                  className="preset-button"
                  onClick={() => setAmountByPercent(percent)}
                >
                  {percent}%
                </button>
              ))}
            </div>
          </div>

          <div className="amount-controls">
            <button type="button" className="icon-switch" onClick={onSwitchTokens} aria-label="Switch tokens">
              ↕
            </button>
          </div>

          <div className="field-grid">
            <TokenSelect label="To" value={tokenOut} options={tokens} onChange={setTokenOut} />
            <label className="amount-field">
              <span>Estimated Output</span>
              <input value={amountOutText} readOnly placeholder="0.0" />
              <small>Balance: {formattedBalanceOut} {tokenOut.symbol}</small>
            </label>
          </div>

          <div className="detail-box">
            <div>
              <span>Rate</span>
              <strong>{detailsRate}</strong>
            </div>
            <div>
              <span>Fee</span>
              <strong>{isWrapPair ? '0%' : '0.30%'}</strong>
            </div>
            <div>
              <span>Slippage</span>
              <strong>{clampedSlippage.toFixed(1)}%</strong>
            </div>
            <div>
              <span>Quote</span>
              <strong>{isWrapPair ? '1:1 wrap quote' : isQuoting ? 'Fetching...' : quoteError || 'Ready'}</strong>
            </div>
          </div>

          <div className="slippage-block">
            <div className="slippage-row">
              <label>
                <span>Slippage tolerance</span>
                <input
                  value={slippageText}
                  onChange={(event) => setSlippageText(normalizeInput(event.target.value))}
                  inputMode="decimal"
                />
              </label>
              <strong>{clampedSlippage.toFixed(1)}%</strong>
            </div>
            <Uik.Slider
              value={slippageSliderValue}
              steps={1}
              helpers={SLIPPAGE_SLIDER_HELPERS}
              tooltip={`${clampedSlippage.toFixed(1)}%`}
              onChange={setSlippageFromSlider}
            />
            <div className="preset-strip">
              {SLIPPAGE_PRESETS.map((preset) => (
                <button key={preset} type="button" className="preset-button" onClick={() => setSlippagePreset(preset)}>
                  {preset}%
                </button>
              ))}
            </div>
          </div>

          <div className="import-token">
            <input
              placeholder="Import token by contract address"
              value={importAddress}
              onChange={(event) => setImportAddress(event.target.value)}
            />
            <button type="button" className="secondary" onClick={importToken}>
              Import
            </button>
          </div>

          {importError ? <p className="error">{importError}</p> : null}

          <div className="meta-grid">
            <div>
              <span>Route</span>
              <strong>{routeLabel || '-'}</strong>
            </div>
            <div>
              <span>Minimum Received</span>
              <strong>{minOut > 0n ? `${formatDisplayAmount(minOut, tokenOut.decimals, 8)} ${tokenOut.symbol}` : '-'}</strong>
            </div>
            <div>
              <span>First Hop Pair</span>
              <strong>{isWrapPair ? 'Not required' : firstHopPair ? shortAddress(firstHopPair) : 'Not found yet'}</strong>
            </div>
            <div>
              <span>Quote Status</span>
              <strong>{isWrapPair ? 'Ready' : isQuoting ? 'Fetching...' : quoteError || 'Ready'}</strong>
            </div>
          </div>

          {isWrongChain ? (
            <button type="button" className="swap-primary-btn" onClick={switchToReef} disabled={isSwitching}>
              {isSwitching ? 'Switching...' : 'Switch To Reef Chain'}
            </button>
          ) : requiresApproval ? (
            <button
              type="button"
              className="swap-primary-btn"
              onClick={approve}
              disabled={isApproving || hasInsufficientBalance || parsedAmountIn <= 0n}
            >
              {isApproving ? 'Approving...' : `Approve ${tokenIn.symbol}`}
            </button>
          ) : (
            <button type="button" className="swap-primary-btn" onClick={swap} disabled={!canSwap || isSwapping || isRefreshing}>
              {swapButtonLabel}
            </button>
          )}

          {statusMessage ? <p className="status">{statusMessage}</p> : null}
          {actionError ? <p className="error">{actionError}</p> : null}
        </div>
      </article>
    </section>
  );

  const tokensRouteView = (
    <>
      <section className="portfolio-row portfolio-row--home">
        <div className="portfolio-summary">
          <div className="portfolio-label-wrap">
            <p className="portfolio-label">Balance</p>
            <span className="portfolio-eye">◌</span>
          </div>
          <h2>{formattedWalletReefUsd}</h2>
        </div>

        <BuyReefButton onClick={() => navigateRoute('swap')} />
      </section>

      <section className="dashboard-grid dashboard-grid--tokens">
        {homeAssetPanelView}
        <aside className="activity-panel">
          {activityCardView}
        </aside>
      </section>
    </>
  );

  const swapRouteView = (
    <>
      <section className="dashboard-grid dashboard-grid--swap-route">
        {swapStageView}
        <aside className="activity-panel">
          {activityCardView}
        </aside>
      </section>
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

  const creatorRouteView = (
    <>
      <section className="creator">
        <div className="creator__form panel-card">
          <div className="creator__header">
            <h2>Create your token</h2>
            <p>Create a Reef token draft with the same Creator UX from reef-app.</p>
          </div>
          <label className="creator-icon-upload">
            <input type="file" accept="image/*" onChange={handleCreatorIconUpload} />
            {creatorIcon ? <img src={creatorIcon} alt="Token icon" /> : <span>Upload icon</span>}
          </label>

          <Uik.Form>
            <div className="creator__form-main">
              <Uik.Input
                label="Token name"
                placeholder="MyToken"
                value={creatorTokenName}
                maxLength={42}
                onInput={(event) => setCreatorTokenName((event.target as HTMLInputElement).value)}
              />

              <Uik.Input
                className="creator__token-symbol-input"
                label="Token symbol"
                placeholder="MTK"
                value={creatorSymbol}
                maxLength={12}
                onInput={(event) => setCreatorSymbol((event.target as HTMLInputElement).value)}
              />
            </div>

            <Uik.Input
              label="Initial supply"
              placeholder="0"
              value={creatorSupply}
              min={1}
              onInput={(event) => setCreatorSupply((event.target as HTMLInputElement).value.replace(/[^0-9]/g, ''))}
            />

            <div className="creator__form-bottom">
              <Uik.Toggle
                label="Burnable"
                onText="Yes"
                offText="No"
                value={creatorBurnable}
                onChange={() => setCreatorBurnable((current) => !current)}
              />
              <Uik.Toggle
                label="Mintable"
                onText="Yes"
                offText="No"
                value={creatorMintable}
                onChange={() => setCreatorMintable((current) => !current)}
              />
            </div>
          </Uik.Form>
        </div>

        <div className="creator__preview panel-card">
          <p className="creator__preview-title">Token preview</p>
          <div className="creator__preview-token">
            <div className="creator__preview-token-image">
              {creatorIcon ? <img src={creatorIcon} alt="Token icon preview" /> : <Uik.ReefIcon />}
            </div>
            <div className="creator__preview-token-info">
              <div className="creator__preview-token-name">{creatorTokenName || 'Token name'}</div>
              <div className="creator__preview-token-symbol">{creatorSymbolUpper || 'TOKEN'}</div>
            </div>
            <div className="creator__preview-token-supply">{creatorSupplyFormatted}</div>
          </div>
          <div className={`creator__preview-info ${!creatorBurnable ? 'creator__preview-info--disabled' : ''}`}>
            <strong>{creatorBurnable ? 'Burnable enabled' : 'Burnable disabled'}</strong>
            <span>Existing tokens {creatorBurnable ? 'can' : 'cannot'} be destroyed.</span>
          </div>
          <div className={`creator__preview-info ${!creatorMintable ? 'creator__preview-info--disabled' : ''}`}>
            <strong>{creatorMintable ? 'Mintable enabled' : 'Mintable disabled'}</strong>
            <span>New tokens {creatorMintable ? 'can' : 'cannot'} be created later.</span>
          </div>
          <Uik.Button
            fill={!creatorValidationMsg}
            disabled={!!creatorValidationMsg}
            text="Create token"
            size="large"
            onClick={() => setCreatorConfirmOpen(true)}
          />
          {creatorValidationMsg ? <p className="error">{creatorValidationMsg}</p> : null}
          {creatorStatus ? <p className="status">{creatorStatus}</p> : null}
        </div>
      </section>

      <Uik.Modal
        className="confirm-token"
        title="Confirm your token"
        isOpen={creatorConfirmOpen}
        onClose={() => setCreatorConfirmOpen(false)}
        footer={(
          <Uik.Button
            text="Create token"
            fill
            size="large"
            disabled={!!creatorValidationMsg}
            onClick={confirmCreatorDraft}
          />
        )}
      >
        <div className="confirm-token-summary">
          <div className="confirm-token-summary-item">
            <span>Token name</span>
            <strong>{creatorTokenName || '-'}</strong>
          </div>
          <div className="confirm-token-summary-item">
            <span>Token symbol</span>
            <strong>{creatorSymbolUpper || '-'}</strong>
          </div>
          <div className="confirm-token-summary-item">
            <span>Initial supply</span>
            <strong>{creatorSupplyFormatted}</strong>
          </div>
          <div className="confirm-token-summary-item">
            <span>Burnable</span>
            <strong>{creatorBurnable ? 'Yes' : 'No'}</strong>
          </div>
          <div className="confirm-token-summary-item">
            <span>Mintable</span>
            <strong>{creatorMintable ? 'Yes' : 'No'}</strong>
          </div>
        </div>
      </Uik.Modal>
    </>
  );

  const poolsRouteView = (
    <section className="panel-card route-placeholder">
      <h2>Pools</h2>
      <p>Pool list and liquidity actions can be wired next with your deployed Factory + Router addresses.</p>
      <button type="button" className="wallet-connect-btn" onClick={() => navigateRoute('swap')}>
        Open Swap
      </button>
    </section>
  );

  return (
    <div className="app-shell">
      <header className="nav-content navigation d-flex d-flex-space-between">
        <div className="navigation__wrapper">
          <div className="navigation__left">
            <button type="button" className="logo-btn" onClick={() => navigateRoute('tokens')}>
              <Uik.ReefLogo className="navigation__logo" />
              <span className="navigation__logo-suffix">swap</span>
            </button>
            <nav className="d-flex justify-content-end d-flex-vert-center">
              <ul className="navigation_menu-items">
                {NAV_ROUTES.map((item) => (
                  <li
                    key={item.route}
                    className={`navigation_menu-items_menu-item ${activeRoute === item.route ? 'navigation_menu-items_menu-item--active' : ''}`}
                  >
                    <button type="button" className="navigation_menu-items_menu-item_link" onClick={() => navigateRoute(item.route)}>
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <nav className="navigation__right d-flex d-flex-vert-center">
            <span className="network-chip">Reef ({reefChain.id})</span>
            {isConnected ? (
              <>
                <div className="nav-account">
                  <div className="nav-account_balance">
                    <Uik.ReefIcon className="nav-account_icon" />
                    {formattedWalletReefBalance} REEF
                  </div>
                </div>
                <button type="button" className="btn nav-account_button" onClick={() => disconnect()}>
                  Disconnect
                </button>
                <button
                  type="button"
                  className="wallet-pill wallet-pill--account"
                  onClick={isWrongChain ? switchToReef : undefined}
                  disabled={isWrongChain && isSwitching}
                >
                  {isWrongChain ? (isSwitching ? 'Switching...' : 'Switch Network') : `Account  ${shortAddress(address)}`}
                </button>
              </>
            ) : (
              <button type="button" className="wallet-connect-btn" onClick={connectWallet} disabled={isConnecting}>
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="dashboard-content">
        {isConnected ? (
          activeRoute === 'tokens' ? (
            tokensRouteView
          ) : activeRoute === 'swap' ? (
            swapRouteView
          ) : activeRoute === 'create-token' ? (
            creatorRouteView
          ) : (
            poolsRouteView
          )
        ) : (
          <section className="connect-state-card">
            <div className="connect-state-orb connect-state-orb-left" />
            <div className="connect-state-orb connect-state-orb-right" />
            <div className="connect-state-content">
              <div className="connect-state-icon">
                <Uik.ReefIcon />
              </div>
              <h2>Connect to Reefswap</h2>
              <p>Connect MetaMask to view balances, activity, and swap tokens on Reef chain.</p>
              <div className="connect-state-badges">
                <span>Secure</span>
                <span>Non-custodial</span>
                <span>Mainnet ready</span>
              </div>
              <button type="button" className="connect-state-btn" onClick={connectWallet} disabled={isConnecting}>
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
              {statusMessage ? <p className="status">{statusMessage}</p> : null}
              {actionError ? <p className="error">{actionError}</p> : null}
            </div>
            <Uik.Bubbles className="connect-state-bubbles" />
          </section>
        )}
      </main>
      {!isConnected ? (
        <footer className="unlogged-footer">
          <button
            type="button"
            className="add-metamask-btn"
            onClick={async () => {
              setActionError('');
              try {
                await addReefChain();
                setStatusMessage('Reef chain added to MetaMask.');
              } catch (error) {
                setActionError(getErrorMessage(error));
              }
            }}
          >
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"
              alt=""
              className="metamask-logo"
            />
            Add to MetaMask
          </button>
        </footer>
      ) : null}
    </div>
  );
};

export default App;
