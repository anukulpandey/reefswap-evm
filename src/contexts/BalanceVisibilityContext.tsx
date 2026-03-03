import { createContext, useContext, useMemo, useState } from 'react';

type BalanceVisibilityContextValue = {
  showBalances: boolean;
  toggleBalances: () => void;
};

const BalanceVisibilityContext = createContext<BalanceVisibilityContextValue | null>(null);

export const BalanceVisibilityProvider = ({ children }: { children: React.ReactNode }) => {
  const [showBalances, setShowBalances] = useState(true);

  const value = useMemo(
    () => ({
      showBalances,
      toggleBalances: () => setShowBalances((current) => !current),
    }),
    [showBalances],
  );

  return (
    <BalanceVisibilityContext.Provider value={value}>
      {children}
    </BalanceVisibilityContext.Provider>
  );
};

export const useBalanceVisibility = () => {
  const context = useContext(BalanceVisibilityContext);
  if (!context) {
    throw new Error('useBalanceVisibility must be used within BalanceVisibilityProvider');
  }
  return context;
};
