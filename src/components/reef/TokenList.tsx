import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FaPaperPlane } from 'react-icons/fa';
import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { type Token } from '@/lib/mockData';
import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import UiKit from '@reef-chain/ui-kit';
import SendModal from './SendModal';
import { useBalanceVisibility } from '@/contexts/BalanceVisibilityContext';
import { useAccount, usePublicClient } from 'wagmi';
import { useReefBalance } from '@/hooks/useReefBalance';
import { useReefPrice } from '@/hooks/useReefPrice';
import { formatUnits } from 'viem';
import { erc20Abi } from '@/lib/abi';
import { contracts, reefChain } from '@/lib/config';
import { tokenKey, type TokenOption } from '@/lib/tokens';
import { resolveTokenIconUrl } from '@/lib/tokenIcons';

interface TokenListProps {
  onSwap?: () => void;
  tokenOptions: TokenOption[];
}

const toFinite = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sameAddress = (a?: string | null, b?: string | null): boolean =>
  String(a || '').toLowerCase() === String(b || '').toLowerCase();

const applyFallbackTokenIcon = (img: HTMLImageElement, address?: string | null, symbol?: string | null) => {
  if (img.dataset.fallbackApplied === 'true') return;
  img.dataset.fallbackApplied = 'true';
  img.src = resolveTokenIconUrl({ address, symbol, iconUrl: null });
};

const handleTokenIconError = (event: SyntheticEvent<HTMLImageElement>, address?: string | null, symbol?: string | null) => {
  applyFallbackTokenIcon(event.currentTarget, address, symbol);
};

const TokenList = ({ onSwap, tokenOptions }: TokenListProps) => {
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [balancesByTokenKey, setBalancesByTokenKey] = useState<Record<string, number>>({});
  const [isTokenBalancesLoading, setIsTokenBalancesLoading] = useState(false);
  const { showBalances } = useBalanceVisibility();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: reefChain.id });
  const { balance: reefBalance, isLoading: isBalanceLoading } = useReefBalance(address);
  const { price: reefPrice, change24h } = useReefPrice();

  const portfolioTokenOptions = useMemo(() => {
    const unique = new Map<string, TokenOption>();
    tokenOptions.forEach((token) => {
      unique.set(tokenKey(token), token);
    });
    return Array.from(unique.values()).slice(0, 60);
  }, [tokenOptions]);

  useEffect(() => {
    if (!address || !publicClient) {
      setBalancesByTokenKey({});
      setIsTokenBalancesLoading(false);
      return;
    }

    let cancelled = false;

    const fetchBalances = async () => {
      setIsTokenBalancesLoading(true);
      try {
        const nativeRaw = await publicClient.getBalance({ address });
        const nativeBalance = toFinite(formatUnits(nativeRaw, 18));

        const entries = await Promise.all(
          portfolioTokenOptions.map(async (token) => {
            if (token.isNative) return [tokenKey(token), nativeBalance] as const;
            if (!token.address) return [tokenKey(token), 0] as const;

            try {
              const raw = await publicClient.readContract({
                address: token.address,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address],
              });
              return [tokenKey(token), toFinite(formatUnits(raw, token.decimals))] as const;
            } catch {
              return [tokenKey(token), 0] as const;
            }
          }),
        );

        if (cancelled) return;
        setBalancesByTokenKey(Object.fromEntries(entries));
      } catch {
        if (!cancelled) {
          setBalancesByTokenKey({});
        }
      } finally {
        if (!cancelled) {
          setIsTokenBalancesLoading(false);
        }
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 20_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, portfolioTokenOptions, publicClient]);

  const tokens: Token[] = useMemo(
    () =>
      portfolioTokenOptions.map((token) => {
        const key = tokenKey(token);
        const chainBalance = balancesByTokenKey[key];
        const balance = token.isNative ? reefBalance : (chainBalance ?? 0);
        const isReefLike = token.isNative || sameAddress(token.address, contracts.wrappedReef);
        const price = isReefLike ? reefPrice : 0;

        return {
          id: key,
          name: token.name,
          symbol: token.symbol,
          icon: token.isNative ? 'reef' : token.symbol.charAt(0),
          iconUrl: token.iconUrl || null,
          price,
          priceChange: isReefLike ? change24h : 0,
          balance,
          usdValue: balance * price,
          address: token.address,
          decimals: token.decimals,
          isNative: token.isNative,
        } satisfies Token;
      }),
    [balancesByTokenKey, change24h, portfolioTokenOptions, reefBalance, reefPrice],
  );

  const visibleTokens = useMemo(() => {
    const sorted = [...tokens].sort((a, b) => (b.usdValue - a.usdValue) || (b.balance - a.balance) || a.symbol.localeCompare(b.symbol));
    const withBalance = sorted.filter((token) => token.balance > 0);
    if (withBalance.length > 0) return withBalance;
    return sorted.slice(0, 12);
  }, [tokens]);

  const handleSend = (token: Token) => {
    setSelectedToken(token);
    setSendModalOpen(true);
  };

  const formatNumber = (value: number) => (
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  );

  const formatTokenBalance = (value: number) => (
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    }).format(value)
  );

  const formatPrice = (value: number) => (
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }).format(value)
  );

  return (
    <>
      <Card className="bg-transparent rounded-2xl shadow-none border-0 overflow-hidden">
        <div className="space-y-2">
          {visibleTokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm border border-[#ebe6f4] w-[92%]"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 flex items-center justify-center">
                  {token.isNative ? (
                    <UiKit.ReefIcon className="h-10 w-10 text-[#7a3bbd]" />
                  ) : (
                    <img
                      src={resolveTokenIconUrl({ address: token.address, symbol: token.symbol, iconUrl: token.iconUrl })}
                      alt={`${token.symbol} icon`}
                      className="h-10 w-10 rounded-full object-cover"
                      onError={(event) => handleTokenIconError(event, token.address, token.symbol)}
                    />
                  )}
                </div>
                <div>
                  <div className="text-lg font-semibold text-[#1b1530] uppercase">{token.symbol}</div>
                  <div className="text-base font-medium text-[#1b1530]">
                    {formatPrice(token.price)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-5">
                <div className="text-right">
                  {(isBalanceLoading || isTokenBalancesLoading) && balancesByTokenKey[token.id] === undefined ? (
                    <div className="flex items-center gap-1 justify-end">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#a93185] to-[#5d3bad]"
                          style={{ animation: `bounce-dot 1s ease-in-out ${i * 0.15}s infinite` }}
                        />
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className="text-xl font-semibold bg-gradient-to-r from-[#a93185] to-[#5d3bad] bg-clip-text text-transparent">
                        {showBalances ? `$${formatNumber(token.usdValue)}` : '••••••'}
                      </p>
                      <p className="text-sm font-medium text-[#1b1530]">
                        {showBalances ? `${formatTokenBalance(token.balance)} ${token.symbol}` : '••••••'}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {onSwap ? (
                    <UiKit.Button
                      text="Swap"
                      icon={faArrowsRotate}
                      size="small"
                      onClick={onSwap}
                      className="h-9 rounded-[12px] px-6"
                    />
                  ) : null}
                  <Button
                    size="sm"
                    className="rounded-[12px] px-6 py-5 text-white bg-[#8f2fb4] shadow-md hover:bg-[#7d29a0] gap-2"
                    onClick={() => handleSend(token)}
                  >
                    <FaPaperPlane className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {visibleTokens.length === 0 ? (
            <div className="rounded-2xl bg-white px-4 py-6 text-sm text-[#8e899c] shadow-sm border border-[#ebe6f4] w-[92%]">
              No tokens available for this wallet yet.
            </div>
          ) : null}
        </div>
      </Card>

      <SendModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        token={selectedToken}
      />
    </>
  );
};

export default TokenList;
