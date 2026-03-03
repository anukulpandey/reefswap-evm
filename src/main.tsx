import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import App from './App';
import { wagmiConfig } from './lib/wagmi';
import { ReefStateProvider } from './contexts/ReefStateContext';
import { BalanceVisibilityProvider } from './contexts/BalanceVisibilityContext';
import './index.css';
import './styles.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <ReefStateProvider>
        <BalanceVisibilityProvider>
          <App />
        </BalanceVisibilityProvider>
      </ReefStateProvider>
    </QueryClientProvider>
  </WagmiProvider>,
);
