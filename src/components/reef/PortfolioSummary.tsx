import { Eye, EyeOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useBalanceVisibility } from '@/contexts/BalanceVisibilityContext';
import Uik from '@reef-chain/ui-kit';
import BuyReefButton from './BuyReef';
 
 interface PortfolioSummaryProps {
   totalBalance: number;
   availableBalance: number;
   stakedBalance: number;
   isLoading?: boolean;
 }

 const PortfolioSummary = ({
   totalBalance = 158499.53,
   availableBalance = 158499.53,
   stakedBalance = 0.00,
   isLoading = false,
 }: PortfolioSummaryProps) => {
  const { showBalances, toggleBalances } = useBalanceVisibility();
 
   const formatCurrency = (value: number) => {
     return new Intl.NumberFormat('en-US', {
       style: 'currency',
       currency: 'USD',
       minimumFractionDigits: 2,
     }).format(value);
   };
 
  const hideValue = (value: string) => {
    return showBalances ? value : '••••••';
  };
 
   return (
    <div className="flex items-center gap-6">
      {/* Balance Card */}
      <Card className="flex-1 p-6 bg-transparent rounded-2xl shadow-none border-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg font-semibold text-[#2a2440]">Balance</span>
          <button
            onClick={toggleBalances}
            className="text-[#7d7790] hover:text-[#5f5a70] transition-colors"
          >
            {showBalances ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-1.5 h-10 mt-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-gradient-to-r from-[#a93185] to-[#5d3bad]"
                style={{ animation: `bounce-dot 1s ease-in-out ${i * 0.15}s infinite` }}
              />
            ))}
          </div>
        ) : (
          <Uik.Text
            text={hideValue(formatCurrency(totalBalance))}
            type="headline"
            className="bg-gradient-to-r from-[#a93185] to-[#5d3bad] bg-clip-text text-transparent"
          />
        )}

        <div />
      </Card>

      {/* Buy Reef Card */}
      <BuyReefButton/>
     </div>
   );
 };
 
 export default PortfolioSummary;
