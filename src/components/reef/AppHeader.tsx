import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { metaMask } from 'wagmi/connectors';
import { useState } from 'react';
import AccountModal from './AccountModal';
import UiKit from '@reef-chain/ui-kit';
import { useBalanceVisibility } from '@/contexts/BalanceVisibilityContext';
import { useReefBalance } from '@/hooks/useReefBalance';

type AppRoute = 'tokens' | 'swap' | 'pools' | 'create-token' | 'chart';

const NAV_ROUTES: { route: AppRoute; label: string }[] = [
  { route: 'tokens', label: 'Tokens' },
  { route: 'swap', label: 'Swap' },
  { route: 'pools', label: 'Pools' },
  { route: 'create-token', label: 'Creator' },
  { route: 'chart', label: 'Chart' },
];

interface AppHeaderProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

const AppHeader = ({ activeRoute, onNavigate }: AppHeaderProps) => {
  const { address, isConnected, connector } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const { showBalances } = useBalanceVisibility();
  const { balance, isLoading: isBalanceLoading } = useReefBalance(address);

  const formattedBalance = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(balance);

  return (
    <>
      <header className="flex items-center justify-between px-6 py-3 bg-[#f2f0f8] border-b border-border relative z-50">
        {/* Left side - Logo and Nav */}
        <div className="flex items-center gap-8">
          <button
            type="button"
            className="flex items-center gap-1 bg-transparent border-0 p-0"
            onClick={() => onNavigate('tokens')}
          >
            <UiKit.ReefLogo />
            <span className="text-sm font-semibold text-[#7f7991] -ml-1">swap</span>
          </button>

          <nav className="flex items-center gap-6">
            {NAV_ROUTES.map((item) => (
              <button
                key={item.route}
                type="button"
                onClick={() => onNavigate(item.route)}
                className={`text-base font-semibold leading-none transition-colors ${
                  activeRoute === item.route
                    ? 'bg-gradient-to-r from-[#a93185] to-[#5d3bad] bg-clip-text text-transparent'
                    : 'text-[#7f7991] hover:text-[#5d3bad]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right side - Wallet info */}
        <div className="flex items-center gap-4">
          {isConnected ? (
            <>
              {/* Balance display */}
              <div className="flex items-center gap-3 rounded-full bg-[#f1edf8] px-5 py-3 shadow-sm">
                <UiKit.ReefIcon className="h-7 w-7 text-[#7a3bbd]" />
                {isBalanceLoading ? (
                  <div className="flex items-center gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#a93185] to-[#5d3bad]"
                        style={{ animation: `bounce-dot 1s ease-in-out ${i * 0.15}s infinite` }}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="bg-gradient-to-r from-[#a93185] to-[#5d3bad] bg-clip-text text-base font-semibold tracking-tight text-transparent">
                    {showBalances ? formattedBalance : '••••••'}
                  </span>
                )}
              </div>

              {/* Account selector */}
              <Button
                variant="ghost"
                className="flex items-center gap-2 bg-muted rounded-full px-4 py-2 h-auto hover:bg-muted/80"
                onClick={() => setShowAccountModal(true)}
              >
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-reef-purple to-reef-pink" />
                <span className="text-sm font-medium text-foreground">Account</span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </Button>
            </>
          ) : (
            <Button
              onClick={() => connect({ connector: metaMask() })}
              className="bg-gradient-to-r from-[#a93185] to-[#5d3bad] text-white rounded-[12px] px-6 hover:scale-105 hover:shadow-lg hover:brightness-110 active:scale-95 transition-all duration-200 ease-out"
            >
              Connect Wallet
            </Button>
          )}
        </div>
      </header>

      <AccountModal
        isOpen={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        address={address}
        walletName={connector?.name}
        onLogout={disconnect}
      />
    </>
  );
};

export default AppHeader;
