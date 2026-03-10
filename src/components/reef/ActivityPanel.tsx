import { ArrowUpRight, ArrowDownLeft, ExternalLink, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import UiKit from '@reef-chain/ui-kit';
import { useBalanceVisibility } from '@/contexts/BalanceVisibilityContext';
import { useAccount } from 'wagmi';
import { useReefTransactions } from '@/hooks/useReefTransactions';
import { useReefExplorer } from '@/hooks/useReefExplorer';
import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { resolveTokenIconUrl } from '@/lib/tokenIcons';

const ITEMS_PER_PAGE = 5;
type PageItem = number | 'ellipsis';

const applyFallbackTokenIcon = (img: HTMLImageElement, address?: string | null, symbol?: string | null) => {
  if (img.dataset.fallbackApplied === 'true') return;
  img.dataset.fallbackApplied = 'true';
  img.src = resolveTokenIconUrl({ address, symbol, iconUrl: null });
};

const handleTokenIconError = (event: SyntheticEvent<HTMLImageElement>, address?: string | null, symbol?: string | null) => {
  applyFallbackTokenIcon(event.currentTarget, address, symbol);
};

const ActivityPanel = () => {
  const { showBalances } = useBalanceVisibility();
  const { address } = useAccount();
  const { transactions, isLoading } = useReefTransactions(address);
  const { explorerUrl } = useReefExplorer(address);
  const [page, setPage] = useState(1);
  const txExplorerUrl = (hash: string) => `${explorerUrl}/tx/${hash}`;

  const formatAmount = (value: number) => {
    const absolute = Math.abs(value);
    if (absolute >= 1_000) {
      return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(value);
    }

    if (absolute > 0 && absolute < 1) {
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }).format(value);
    }

    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const totalPages = Math.max(1, Math.ceil(transactions.length / ITEMS_PER_PAGE));
  const pagedTransactions = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return transactions.slice(start, start + ITEMS_PER_PAGE);
  }, [page, transactions]);
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

  return (
    <Card className="bg-transparent rounded-2xl border-0 p-0 shadow-none">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-[#1b1530]">Activity</h3>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-[#efe7f6] px-5 py-2 text-sm font-semibold text-[#b13c8e]"
        >
          <ExternalLink className="w-4 h-4" />
          Open Explorer
        </a>
      </div>

      <div className="rounded-3xl bg-white shadow-sm border border-[#ebe6f4]">
        {isLoading && transactions.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-[#a8a4b3] animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#8e899c]">
            No transactions yet
          </div>
        ) : (
          pagedTransactions.map((tx, index) => (
            <div key={tx.id}>
              {tx.txHash ? (
                <a
                  href={txExplorerUrl(tx.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <div
                    className={`flex cursor-pointer items-center justify-between px-6 py-5 transition-colors hover:bg-[#f3f4f7] ${
                      index === 0 ? 'rounded-t-3xl' : ''
                    } ${index === pagedTransactions.length - 1 ? 'rounded-b-3xl' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-[#eef0f5] flex items-center justify-center">
                        {tx.type === 'sent' ? (
                          <ArrowUpRight className="w-6 h-6 text-[#a8a4b3]" />
                        ) : (
                          <ArrowDownLeft className="w-6 h-6 text-[#a8a4b3]" />
                        )}
                      </div>
                      <div>
                        <p className="text-base font-semibold text-[#1b1530]">
                          {tx.type === 'sent' ? `Sent ${tx.symbol}` : `Received ${tx.symbol}`}
                        </p>
                        <p className="text-sm font-medium text-[#8e899c]">
                          {tx.date} · {tx.time}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-base font-semibold text-[#a8a4b3]">
                        {showBalances ? `${tx.type === 'sent' ? '-' : '+'}${formatAmount(tx.amount)}` : '••••••'}
                      </span>
                      {showBalances && (
                        tx.isNativeAsset ? (
                          <UiKit.ReefIcon className="h-5 w-5 text-[#b08ac8]/70" />
                        ) : (
                          <img
                            src={resolveTokenIconUrl({
                              address: tx.tokenAddress,
                              symbol: tx.symbol,
                              iconUrl: tx.tokenIconUrl,
                            })}
                            alt={`${tx.symbol} icon`}
                            className="h-5 w-5 rounded-full object-cover"
                            onError={(event) => handleTokenIconError(event, tx.tokenAddress, tx.symbol)}
                          />
                        )
                      )}
                    </div>
                  </div>
                </a>
              ) : (
                <div
                  className={`flex items-center justify-between px-6 py-5 ${
                    index === 0 ? 'rounded-t-3xl' : ''
                  } ${index === pagedTransactions.length - 1 ? 'rounded-b-3xl' : ''}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-[#eef0f5] flex items-center justify-center">
                      {tx.type === 'sent' ? (
                        <ArrowUpRight className="w-6 h-6 text-[#a8a4b3]" />
                      ) : (
                        <ArrowDownLeft className="w-6 h-6 text-[#a8a4b3]" />
                      )}
                    </div>
                    <div>
                      <p className="text-base font-semibold text-[#1b1530]">
                        {tx.type === 'sent' ? `Sent ${tx.symbol}` : `Received ${tx.symbol}`}
                      </p>
                      <p className="text-sm font-medium text-[#8e899c]">
                        {tx.date} · {tx.time}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-[#a8a4b3]">
                      {showBalances ? `${tx.type === 'sent' ? '-' : '+'}${formatAmount(tx.amount)}` : '••••••'}
                    </span>
                    {showBalances && (
                      tx.isNativeAsset ? (
                        <UiKit.ReefIcon className="h-5 w-5 text-[#b08ac8]/70" />
                      ) : (
                        <img
                          src={resolveTokenIconUrl({
                            address: tx.tokenAddress,
                            symbol: tx.symbol,
                            iconUrl: tx.tokenIconUrl,
                          })}
                          alt={`${tx.symbol} icon`}
                          className="h-5 w-5 rounded-full object-cover"
                          onError={(event) => handleTokenIconError(event, tx.tokenAddress, tx.symbol)}
                        />
                      )
                    )}
                  </div>
                </div>
              )}
              {index < pagedTransactions.length - 1 && (
                <div className="mx-6 h-px bg-[#ebe6f4]" />
              )}
            </div>
          ))
        )}
      </div>

      {transactions.length > ITEMS_PER_PAGE ? (
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
    </Card>
  );
};

export default ActivityPanel;
