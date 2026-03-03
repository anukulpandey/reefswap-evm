import { createConfig, http } from 'wagmi';
import { metaMask } from 'wagmi/connectors';
import { reefChain, reefRpcTransportUrl } from './config';

export const wagmiConfig = createConfig({
  chains: [reefChain],
  connectors: [metaMask({ enableAnalytics: false })],
  transports: {
    [reefChain.id]: http(reefRpcTransportUrl),
  },
});
