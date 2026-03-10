import { ArrowUpRight, ArrowDownLeft, ExternalLink, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import UiKit from '@reef-chain/ui-kit';
import { useBalanceVisibility } from '@/contexts/BalanceVisibilityContext';
import { useAccount } from 'wagmi';
import { useReefTransactions } from '@/hooks/useReefTransactions';
import { useReefExplorer } from '@/hooks/useReefExplorer';

const ActivityPanel = () => {
  const { showBalances } = useBalanceVisibility();
  const { address } = useAccount();
  const { transactions, isLoading } = useReefTransactions(address);
  const { explorerUrl } = useReefExplorer(address);
  const txExplorerUrl = (hash: string) => `${explorerUrl}/tx/${encodeURIComponent(hash)}`;

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
          transactions.map((tx, index) => (
            <div key={tx.id}>
              <a
                href={txExplorerUrl(tx.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <div
                  className={`flex cursor-pointer items-center justify-between px-6 py-5 transition-colors hover:bg-[#f3f4f7] ${
                    index === 0 ? 'rounded-t-3xl' : ''
                  } ${index === transactions.length - 1 ? 'rounded-b-3xl' : ''}`}
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
                      tx.symbol === 'REEF' ? (
                        <UiKit.ReefIcon className="h-5 w-5 text-[#b08ac8]/70" />
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#e9e1f3] text-[10px] font-bold text-[#7a3bbd]">
                          {tx.symbol.slice(0, 1)}
                        </span>
                      )
                    )}
                  </div>
                </div>
              </a>
              {index < transactions.length - 1 && (
                <div className="mx-6 h-px bg-[#ebe6f4]" />
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

export default ActivityPanel;
