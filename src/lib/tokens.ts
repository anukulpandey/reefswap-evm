import { getAddress, isAddress, type Address } from 'viem';
import { contracts } from './config';

export type TokenOption = {
  symbol: string;
  name: string;
  decimals: number;
  address: Address | null;
  isNative: boolean;
};

export const nativeReef: TokenOption = {
  symbol: 'REEF',
  name: 'Reef',
  decimals: 18,
  address: null,
  isNative: true,
};

const wrappedReef: TokenOption = {
  symbol: 'WREEF',
  name: 'Wrapped Reef',
  decimals: 18,
  address: contracts.wrappedReef,
  isNative: false,
};

const parseEnvTokenList = (): TokenOption[] => {
  const raw = import.meta.env.VITE_TOKEN_LIST;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Array<{
      symbol: string;
      name: string;
      decimals: number;
      address: string;
    }>;

    return parsed
      .filter((token) => token?.symbol && token?.name && Number.isInteger(token?.decimals) && isAddress(token?.address))
      .map((token) => ({
        symbol: token.symbol.toUpperCase(),
        name: token.name,
        decimals: token.decimals,
        address: getAddress(token.address),
        isNative: false,
      }));
  } catch {
    return [];
  }
};

export const defaultTokens: TokenOption[] = [nativeReef, wrappedReef, ...parseEnvTokenList()];

export const tokenKey = (token: TokenOption): string => (token.isNative ? 'native' : token.address || 'unknown');
