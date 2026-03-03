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
import { getAddress, isAddress, parseUnits, type Address } from 'viem';
import { erc20Abi, reefswapFactoryAbi, reefswapRouterAbi, wrappedReefAbi } from './lib/abi';
import { contracts, reefChain } from './lib/config';
import TokenSelect from './components/TokenSelect';
import { defaultTokens, nativeReef, type TokenOption } from './lib/tokens';
import { formatDisplayAmount, getErrorMessage, normalizeInput, shortAddress } from './lib/utils';

const MAX_APPROVAL = (2n ** 256n) - 1n;
const DEFAULT_SLIPPAGE = '1.0';
const TX_DEADLINE_SECONDS = 60 * 20;

const isWrapPairSelection = (a: TokenOption, b: TokenOption): boolean =>
  (a.isNative && b.address === contracts.wrappedReef) || (b.isNative && a.address === contracts.wrappedReef);

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
      setAllowance(0n);
      setFirstHopPair(null);
      return;
    }

    setIsRefreshing(true);

    try {
      const readTokenBalance = async (token: TokenOption): Promise<bigint> => {
        if (token.isNative) {
          return publicClient.getBalance({ address });
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

  const switchToReef = async () => {
    setActionError('');
    try {
      await switchChainAsync({ chainId: reefChain.id });
    } catch (error) {
      const code = (error as { cause?: { code?: number }; code?: number })?.code ||
        (error as { cause?: { code?: number } })?.cause?.code;

      if (code === 4902 && window.ethereum) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [addEthereumChainParams],
        });
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

  const canSwap =
    isConnected &&
    !isWrongChain &&
    parsedAmountIn > 0n &&
    quotedOutRaw > 0n &&
    !hasInsufficientBalance &&
    !quoteError;
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

  return (
    <div className="page">
      <header className="app-header">
        <div className="brand">
          <Uik.ReefLogo />
          <div>
            <h1>Reefswap</h1>
            <p>Uniswap-style swap on Reef chain</p>
          </div>
        </div>

        <div className="wallet-controls">
          {isConnected ? (
            <>
              <span className="address-pill">{shortAddress(address)}</span>
              <button type="button" className="secondary" onClick={() => disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" onClick={connectWallet} disabled={isConnecting}>
              {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        <section className="swap-card">
          <div className="swap-head">
            <h2>Swap</h2>
            <div className="chip">Chain: Reef ({reefChain.id})</div>
          </div>

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

          <button type="button" className="swap-switch" onClick={onSwitchTokens}>
            Switch
          </button>

          <div className="field-grid">
            <TokenSelect label="To" value={tokenOut} options={tokens} onChange={setTokenOut} />
            <label className="amount-field">
              <span>Estimated Output</span>
              <input value={amountOutText} readOnly placeholder="0.0" />
              <small>Balance: {formattedBalanceOut} {tokenOut.symbol}</small>
            </label>
          </div>

          <label className="slippage">
            <span>Slippage (%)</span>
            <input
              value={slippageText}
              onChange={(event) => setSlippageText(normalizeInput(event.target.value))}
              inputMode="decimal"
            />
          </label>

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
              <strong>{isWrapPair ? 'Not required (direct wrap)' : firstHopPair ? shortAddress(firstHopPair) : 'Not found yet'}</strong>
            </div>
            <div>
              <span>Quote Status</span>
              <strong>{isWrapPair ? '1:1 wrap quote' : isQuoting ? 'Fetching...' : quoteError || 'Ready'}</strong>
            </div>
          </div>

          {isWrongChain ? (
            <button type="button" onClick={switchToReef} disabled={isSwitching}>
              {isSwitching ? 'Switching...' : 'Switch To Reef Chain'}
            </button>
          ) : !isConnected ? (
            <button type="button" onClick={connectWallet} disabled={isConnecting}>
              {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
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
        </section>

        <aside className="info-card">
          <h3>Deployment Config</h3>
          <ul>
            <li>
              <span>Router02</span>
              <code>{contracts.router}</code>
            </li>
            <li>
              <span>Factory</span>
              <code>{contracts.factory}</code>
            </li>
            <li>
              <span>WrappedREEF</span>
              <code>{contracts.wrappedReef}</code>
            </li>
          </ul>
          <hr />
          <h3>Connection</h3>
          <ul>
            <li>
              <span>RPC</span>
              <code>{reefChain.rpcUrls.default.http[0]}</code>
            </li>
            <li>
              <span>Explorer</span>
              <code>{reefChain.blockExplorers.default.url}</code>
            </li>
            <li>
              <span>Router WETH()</span>
              <code>{routerWrappedTokenSource === 'loading' ? 'Checking...' : routerWrappedToken}</code>
            </li>
          </ul>
          <div className="note">
            Uses `swapExactETHForTokens`, `swapExactTokensForETH`, and `swapExactTokensForTokens`.
            {routerWrappedTokenSource === 'fallback' ? ' Router `WETH()` read failed on this RPC, using configured WrappedREEF instead.' : ''}
          </div>
        </aside>
      </main>
    </div>
  );
};

export default App;
