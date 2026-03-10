import { defineChain, getAddress, isAddress, type Address } from 'viem';

const defaults = {
  transportRpcUrl: '/api/reef-rpc',
  walletChainRpcUrl: 'http://localhost:8545',
  subgraphUrl: 'http://localhost:8000/subgraphs/name/uniswap-v2-localhost',
  chainId: 13939,
  explorerUrl: 'https://reefscan.com',
  wrappedReef: '0x1C2415Fd6Bc4dD007D28f050eD892C449734c238',
  factory: '0x3a7984F200a950aEB56C74840b261e60d50A81E4',
  router: '0xc3F98fd71ec21f5D699a2b406317aFebfc90A0F5',
};

const env = import.meta.env;

const chainId = Number(env.VITE_REEF_CHAIN_ID || defaults.chainId);
const walletChainRpcUrl = env.VITE_REEF_CHAIN_RPC_URL || defaults.walletChainRpcUrl;
export const reefRpcTransportUrl = env.VITE_REEF_RPC_URL || defaults.transportRpcUrl;
export const reefSubgraphUrl = env.VITE_SUBGRAPH_URL || defaults.subgraphUrl;

const asAddress = (value: string, label: string): Address => {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${label} address: ${value}`);
  }
  return getAddress(value);
};

export const reefChain = defineChain({
  id: chainId,
  name: 'Reef Mainnet',
  nativeCurrency: {
    name: 'Reef',
    symbol: 'REEF',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [walletChainRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: 'Reefscan',
      url: env.VITE_REEF_EXPLORER_URL || defaults.explorerUrl,
    },
  },
});

export const contracts = {
  wrappedReef: asAddress(env.VITE_WREEF_ADDRESS || defaults.wrappedReef, 'wrapped reef'),
  factory: asAddress(env.VITE_FACTORY_ADDRESS || defaults.factory, 'factory'),
  router: asAddress(env.VITE_ROUTER_ADDRESS || defaults.router, 'router'),
} as const;
