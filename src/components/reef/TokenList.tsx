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

const ITEMS_PER_PAGE = 10;
type PageItem = number | 'ellipsis';

interface TokenListProps {
  onSwap?: () => void;
  onSwapToken?: (token: TokenOption) => void;
  isTokenSwappable?: (token: TokenOption) => boolean;
  tokenOptions: TokenOption[];
  wrappedTokenAddress?: `0x${string}` | null;
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

const TokenList = ({
  onSwap,
  onSwapToken,
  isTokenSwappable,
  tokenOptions,
  wrappedTokenAddress,
}: TokenListProps) => {
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [balancesByTokenKey, setBalancesByTokenKey] = useState<Record<string, number>>({});
  const [isTokenBalancesLoading, setIsTokenBalancesLoading] = useState(false);
  const [page, setPage] = useState(1);
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
    return Array.from(unique.values());
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

        const entries: Array<readonly [string, number]> = [];
        portfolioTokenOptions.forEach((token) => {
          if (token.isNative) {
            entries.push([tokenKey(token), nativeBalance] as const);
          }
        });

        const erc20Tokens = portfolioTokenOptions.filter((token) => !token.isNative && Boolean(token.address));
        const batchSize = 75;
        for (let index = 0; index < erc20Tokens.length; index += batchSize) {
          const chunk = erc20Tokens.slice(index, index + batchSize);
          try {
            const chunkResults = await publicClient.multicall({
              allowFailure: true,
              contracts: chunk.map((token) => ({
                address: token.address as `0x${string}`,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address],
              })),
            });

            const successCount = chunkResults.filter((result) => result.status === 'success').length;
            if (successCount === 0) {
              throw new Error('Multicall returned no successful balanceOf results.');
            }

            chunk.forEach((token, resultIndex) => {
              const result = chunkResults[resultIndex];
              if (result.status === 'success') {
                entries.push([tokenKey(token), toFinite(formatUnits(result.result, token.decimals))] as const);
              } else {
                entries.push([tokenKey(token), 0] as const);
              }
            });
          } catch {
            const fallbackResults = await Promise.all(
              chunk.map(async (token) => {
                try {
                  const raw = await publicClient.readContract({
                    address: token.address as `0x${string}`,
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
            fallbackResults.forEach((entry) => entries.push(entry));
          }
        }

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
        const resolvedWrappedAddress = wrappedTokenAddress || contracts.wrappedReef;
        const isReefLike = token.isNative || sameAddress(token.address, resolvedWrappedAddress);
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
    [balancesByTokenKey, change24h, portfolioTokenOptions, reefBalance, reefPrice, wrappedTokenAddress],
  );

  const tokenOptionById = useMemo(() => {
    const byId = new Map<string, TokenOption>();
    portfolioTokenOptions.forEach((token) => {
      byId.set(tokenKey(token), token);
    });
    return byId;
  }, [portfolioTokenOptions]);

  const visibleTokens = useMemo(() => {
    const sorted = [...tokens].sort((a, b) => (b.usdValue - a.usdValue) || (b.balance - a.balance) || a.symbol.localeCompare(b.symbol));
    const withBalance = sorted.filter((token) => token.balance > 0);
    if (withBalance.length > 0) return withBalance;
    return sorted.slice(0, 12);
  }, [tokens]);
  const totalPages = Math.max(1, Math.ceil(visibleTokens.length / ITEMS_PER_PAGE));
  const pagedTokens = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return visibleTokens.slice(start, start + ITEMS_PER_PAGE);
  }, [page, visibleTokens]);
  const paginationItems = useMemo<PageItem[]>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
    if (page <= 3) {
      pages.add(2);
      pages.add(3);
    }
    if (page >= totalPages - 2) {
      pages.add(totalPages - 1);
      pages.add(totalPages - 2);
    }

    const sorted = Array.from(pages)
      .filter((value) => value >= 1 && value <= totalPages)
      .sort((a, b) => a - b);

    const output: PageItem[] = [];
    sorted.forEach((value, index) => {
      if (index === 0) {
        output.push(value);
        return;
      }

      const previous = sorted[index - 1];
      if (value - previous > 1) {
        output.push('ellipsis');
      }
      output.push(value);
    });

    return output;
  }, [page, totalPages]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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
          {pagedTokens.map((token) => (
            (() => {
              const tokenOption = tokenOptionById.get(token.id);
              const canSwapThisToken = Boolean(
                tokenOption &&
                (isTokenSwappable ? isTokenSwappable(tokenOption) : (onSwapToken || onSwap)),
              );

              return (
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
                      {onSwap || onSwapToken ? (
                        <UiKit.Button
                          text="Swap"
                          icon={faArrowsRotate}
                          size="small"
                          disabled={!canSwapThisToken}
                          onClick={() => {
                            if (!canSwapThisToken || !tokenOption) return;
                            if (onSwapToken) {
                              onSwapToken(tokenOption);
                              return;
                            }
                            onSwap?.();
                          }}
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
              );
            })()
          ))}
          {pagedTokens.length === 0 ? (
            <div className="rounded-2xl bg-white px-4 py-6 text-sm text-[#8e899c] shadow-sm border border-[#ebe6f4] w-[92%]">
              No tokens available for this wallet yet.
            </div>
          ) : null}
        </div>
      </Card>

      {visibleTokens.length > ITEMS_PER_PAGE ? (
        <div className="mt-4 flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className="h-8 min-w-8 rounded-[10px] bg-[#e2dcea] px-2.5 text-sm font-semibold text-[#4a4260] disabled:opacity-45"
          >
            ‹
          </button>
          {paginationItems.map((item, index) => {
            if (item === 'ellipsis') {
              return (
                <span
                  key={`ellipsis-${index}`}
                  className="inline-flex h-8 min-w-8 items-center justify-center rounded-[10px] bg-transparent px-1 text-sm font-semibold text-[#8e899c]"
                >
                  ...
                </span>
              );
            }

            const isActive = item === page;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setPage(item)}
                className={`h-8 min-w-8 rounded-[10px] px-2.5 text-sm font-semibold ${
                  isActive
                    ? 'bg-gradient-to-r from-[#a93185] to-[#7a32b4] text-white'
                    : 'bg-[#e2dcea] text-[#4a4260]'
                }`}
              >
                {item}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page === totalPages}
            className="h-8 min-w-8 rounded-[10px] bg-[#e2dcea] px-2.5 text-sm font-semibold text-[#4a4260] disabled:opacity-45"
          >
            ›
          </button>
        </div>
      ) : null}

      <SendModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        token={selectedToken}
      />
    </>
  );
};

export default TokenList;
