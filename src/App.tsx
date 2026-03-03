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
import { defaultTokens, nativeReef, tokenKey, type TokenOption } from './lib/tokens';
import { formatDisplayAmount, getErrorMessage, normalizeInput, shortAddress } from './lib/utils';

const MAX_APPROVAL = (2n ** 256n) - 1n;
const DEFAULT_SLIPPAGE = '1.0';
const TX_DEADLINE_SECONDS = 60 * 20;
const AMOUNT_PRESETS = [0, 25, 50, 100] as const;
const SLIPPAGE_PRESETS = ['0.3', '0.8', '1.0', '2.0'] as const;
type AppRoute = 'tokens' | 'swap' | 'pools' | 'creator';

const isWrapPairSelection = (a: TokenOption, b: TokenOption): boolean =>
  (a.isNative && b.address === contracts.wrappedReef) || (b.isNative && a.address === contracts.wrappedReef);

const NAV_ROUTES: AppRoute[] = ['tokens', 'swap', 'pools', 'creator'];

const resolveRoute = (value: string | null | undefined): AppRoute => {
  if (!value) return 'tokens';
  return NAV_ROUTES.includes(value as AppRoute) ? (value as AppRoute) : 'tokens';
};

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
    const fromHash = window.location.hash.replace(/^#\/?/, '').split('/')[0];
    const fromPath = window.location.pathname.replace(/^\/+/, '').split('/')[0];
    return resolveRoute(fromHash || fromPath);
  });

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
      const fromHash = window.location.hash.replace(/^#\/?/, '').split('/')[0];
      const fromPath = window.location.pathname.replace(/^\/+/, '').split('/')[0];
      setActiveRoute(resolveRoute(fromHash || fromPath));
    };

    window.addEventListener('hashchange', syncFromLocation);
    return () => window.removeEventListener('hashchange', syncFromLocation);
  }, []);

  const navigateRoute = (route: AppRoute) => {
    setActiveRoute(route);
    const nextHash = `#/${route}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
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
  const formattedWalletReefBalance = formatDisplayAmount(walletNativeBalance, nativeReef.decimals, 3);
  const formattedWalletReefUsd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(formatUnits(walletNativeBalance, nativeReef.decimals)) * 0.0001);
  const dashboardTokens = useMemo(() => {
    const reef = tokens.find((token) => token.symbol === 'REEF');
    const wreef = tokens.find((token) => token.symbol === 'WREEF');
    return [reef, wreef].filter((token): token is TokenOption => !!token);
  }, [tokens]);
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

  const assetPanelView = (
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
        <ul className="token-list">
          {dashboardTokens.map((token) => {
            const key = tokenKey(token);
            const inSelected = key === tokenKey(tokenIn);
            const outSelected = key === tokenKey(tokenOut);
            const tokenBalance = inSelected
              ? balanceIn
              : outSelected
                ? balanceOut
                : 0n;

            return (
              <li key={`left-${key}`} className="token-row">
                <span className="token-badge">{token.symbol.slice(0, 1)}</span>
                <div className="token-row__meta">
                  <strong>{token.symbol}</strong>
                  <small>{token.name}</small>
                </div>
                <div className="token-row__amount">
                  <strong>{formatDisplayAmount(tokenBalance, token.decimals, 4)}</strong>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="nft-empty">Your wallet does not hold NFTs.</div>
      )}
    </aside>
  );

  const activityCardView = (
    <section className="panel-card activity-card">
      <div className="activity-head">
        <h3>Activity</h3>
        <a href={reefChain.blockExplorers.default.url} target="_blank" rel="noreferrer">
          Open Explorer
        </a>
      </div>
      <ul className="activity-list">
        <li>
          <strong>Sent REEF</strong>
          <span>-11</span>
        </li>
        <li>
          <strong>Received PRLS</strong>
          <span>+9.2449</span>
        </li>
        <li>
          <strong>Sent REEF</strong>
          <span>-2000</span>
        </li>
        {lastTxHash ? (
          <li>
            <strong>Latest Tx</strong>
            <span>{shortAddress(lastTxHash)}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );

  const connectionCardView = (
    <section className="panel-card info-card">
      <h3>Connection</h3>
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
    </section>
  );

  const swapStageView = (
    <section className="swap-stage">
      <article className="swap-modal">
        <div className="modal-head">
          <h2>Swap</h2>
          <button type="button" className="close-btn" onClick={() => setAmountInText('')} aria-label="Reset input">
            ×
          </button>
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

          <div className="amount-controls">
            <button type="button" className="icon-switch" onClick={onSwitchTokens} aria-label="Switch tokens">
              ↕
            </button>
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
                <span>Slippage (%)</span>
                <input
                  value={slippageText}
                  onChange={(event) => setSlippageText(normalizeInput(event.target.value))}
                  inputMode="decimal"
                />
              </label>
              <strong>{clampedSlippage.toFixed(1)}%</strong>
            </div>
            <input
              className="slippage-range"
              type="range"
              min="0"
              max="20"
              step="0.1"
              value={clampedSlippage}
              onChange={(event) => setSlippageText(event.target.value)}
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
            <button type="button" onClick={switchToReef} disabled={isSwitching}>
              {isSwitching ? 'Switching...' : 'Switch To Reef Chain'}
            </button>
          ) : requiresApproval ? (
            <button type="button" onClick={approve} disabled={isApproving || hasInsufficientBalance || parsedAmountIn <= 0n}>
              {isApproving ? 'Approving...' : `Approve ${tokenIn.symbol}`}
            </button>
          ) : (
            <button type="button" onClick={swap} disabled={!canSwap || isSwapping || isRefreshing}>
              {swapButtonLabel}
            </button>
          )}

          {statusMessage ? <p className="status">{statusMessage}</p> : null}
          {actionError ? <p className="error">{actionError}</p> : null}
          {lastTxHash ? (
            <a
              className="tx-link"
              href={`${reefChain.blockExplorers.default.url}/tx/${lastTxHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View Transaction: {shortAddress(lastTxHash)}
            </a>
          ) : null}
        </div>
      </article>
    </section>
  );

  const tokensRouteView = (
    <>
      <section className="portfolio-row">
        <div className="portfolio-summary">
          <p className="portfolio-label">Total</p>
          <h2>{formattedWalletReefUsd}</h2>
          <div className="portfolio-splits">
            <div>
              <span>Available</span>
              <strong>{formattedWalletReefUsd}</strong>
            </div>
            <div>
              <span>Staked</span>
              <strong>$0.00</strong>
            </div>
          </div>
        </div>

        <button type="button" className="buy-reef-btn">
          <Uik.ReefSign className="buy-reef-btn__icon" />
          <span className="buy-reef-btn__text">Buy Reef</span>
          <Uik.Bubbles />
        </button>
      </section>

      <section className="dashboard-grid dashboard-grid--tokens">
        {assetPanelView}
        <aside className="activity-panel">
          {activityCardView}
          {connectionCardView}
        </aside>
      </section>
    </>
  );

  const swapRouteView = (
    <section className="dashboard-grid dashboard-grid--swap">
      {assetPanelView}
      {swapStageView}
      <aside className="activity-panel">
        {activityCardView}
        {connectionCardView}
      </aside>
    </section>
  );

  const routePlaceholderTitle = activeRoute === 'pools' ? 'Pools' : 'Creator';
  const routePlaceholderView = (
    <section className="panel-card route-placeholder">
      <h2>{routePlaceholderTitle}</h2>
      <p>{routePlaceholderTitle} view is not wired yet in this build.</p>
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
                <li className={`navigation_menu-items_menu-item ${activeRoute === 'tokens' ? 'navigation_menu-items_menu-item--active' : ''}`}>
                  <button type="button" className="navigation_menu-items_menu-item_link" onClick={() => navigateRoute('tokens')}>Tokens</button>
                </li>
                <li className={`navigation_menu-items_menu-item ${activeRoute === 'swap' ? 'navigation_menu-items_menu-item--active' : ''}`}>
                  <button type="button" className="navigation_menu-items_menu-item_link" onClick={() => navigateRoute('swap')}>Swap</button>
                </li>
                <li className={`navigation_menu-items_menu-item ${activeRoute === 'pools' ? 'navigation_menu-items_menu-item--active' : ''}`}>
                  <button type="button" className="navigation_menu-items_menu-item_link" onClick={() => navigateRoute('pools')}>Pools</button>
                </li>
                <li className={`navigation_menu-items_menu-item ${activeRoute === 'creator' ? 'navigation_menu-items_menu-item--active' : ''}`}>
                  <button type="button" className="navigation_menu-items_menu-item_link" onClick={() => navigateRoute('creator')}>Creator</button>
                </li>
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
                  <button type="button" className="btn nav-account_button" onClick={() => disconnect()}>
                    Disconnect
                  </button>
                </div>
                <button
                  type="button"
                  className="wallet-pill"
                  onClick={isWrongChain ? switchToReef : undefined}
                  disabled={isWrongChain && isSwitching}
                >
                  {isWrongChain ? (isSwitching ? 'Switching...' : 'Switch Network') : shortAddress(address)}
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
          ) : (
            routePlaceholderView
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
