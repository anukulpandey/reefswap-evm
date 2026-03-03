import { Coins, RefreshCcw } from 'lucide-react';
import { FaPaperPlane } from 'react-icons/fa';
import { type Token } from '@/lib/mockData';
import { useState } from 'react';
import UiKit from '@reef-chain/ui-kit';
import SendModal from './SendModal';
import { useBalanceVisibility } from '@/contexts/BalanceVisibilityContext';
import { useAccount } from 'wagmi';
import { useReefBalance } from '@/hooks/useReefBalance';
import { useReefPrice } from '@/hooks/useReefPrice';
import './token-list.css';

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

  const formatUsd = (value: number) => (
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  );

  const formatTokenPrice = (value: number) => (
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(value)
  );

  const formatTokenBalance = (value: number) => (
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(value)
  );

  return (
    <>
      <div className="token-card-list">
        {tokens.map((token) => (
          <div key={token.id} className="token-card">
            <div className="token-card__left">
              <div className="token-card__icon-wrap">
                {token.icon === 'reef' ? (
                  <UiKit.ReefIcon className="token-card__icon" />
                ) : (
                  <span className="token-card__fallback-icon">{token.icon}</span>
                )}
              </div>
              <div className="token-card__meta">
                <p className="token-card__symbol">{token.symbol}</p>
                <p className="token-card__price">{formatTokenPrice(token.price)}</p>
              </div>
            </div>

            <div className="token-card__right">
              <div className="token-card__amount">
                {isBalanceLoading && token.symbol === 'REEF' ? (
                  <div className="token-card__loading">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} style={{ animation: `bounce-dot 1s ease-in-out ${i * 0.15}s infinite` }} />
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="token-card__usd">{showBalances ? `US$${formatUsd(token.usdValue)}` : 'US$••••••'}</p>
                    <p className="token-card__balance">
                      {showBalances ? `${formatTokenBalance(token.balance)} ${token.symbol}` : '••••••'}
                    </p>
                  </>
                )}
              </div>

              <span className="token-card__coins-wrap" aria-hidden>
                <Coins className="token-card__coins-icon" />
              </span>

              <div className="token-card__actions">
                {onSwap && (
                  <UiKit.Button fill={false} className="token-card__swap-btn" onClick={onSwap}>
                    <RefreshCcw className="token-card__btn-icon" />
                    <span>Swap</span>
                  </UiKit.Button>
                )}
                <UiKit.Button fill className="token-card__send-btn" onClick={() => handleSend(token)}>
                  <FaPaperPlane className="token-card__btn-icon" />
                  <span>Send</span>
                </UiKit.Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <SendModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        token={selectedToken}
      />
    </>
  );
};

export default TokenList;
