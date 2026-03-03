import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FaPaperPlane } from 'react-icons/fa';
import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { type Token } from '@/lib/mockData';
import { useState } from 'react';
import UiKit from '@reef-chain/ui-kit';
import SendModal from './SendModal';
import { useBalanceVisibility } from '@/contexts/BalanceVisibilityContext';
import { useAccount } from 'wagmi';
import { useReefBalance } from '@/hooks/useReefBalance';
import { useReefPrice } from '@/hooks/useReefPrice';

interface TokenListProps {
  onSwap?: () => void;
}

const TokenList = ({ onSwap }: TokenListProps) => {
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const { showBalances } = useBalanceVisibility();
  const { address } = useAccount();
  const { balance: reefBalance, isLoading: isBalanceLoading } = useReefBalance(address);
  const { price: reefPrice, change24h } = useReefPrice();

  const tokens: Token[] = [
    {
      id: '1',
      name: 'Reef',
      symbol: 'REEF',
      icon: 'reef',
      price: reefPrice,
      priceChange: change24h,
      balance: reefBalance,
      usdValue: reefBalance * reefPrice,
    },
  ];

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
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm border border-[#ebe6f4] w-[92%]"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 flex items-center justify-center">
                  {token.icon === 'reef' ? (
                    <UiKit.ReefIcon className="h-10 w-10 text-[#7a3bbd]" />
                  ) : (
                    <span className="text-lg">{token.icon}</span>
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
                  {isBalanceLoading && token.symbol === 'REEF' ? (
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
                        {showBalances ? `${formatNumber(token.balance)} ${token.symbol}` : '••••••'}
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
