import { useEffect, useState } from 'react';
import { getNetwork } from 'reef-evm-util-lib';
import { getAddress, isAddress, type Address } from 'viem';
import { useReefState } from '@/contexts/ReefStateContext';
import { type TokenOption } from '@/lib/tokens';

type BlockscoutV2TokenBalanceItem = {
  value?: string | null;
  token?: {
    address?: string | null;
    address_hash?: string | null;
    symbol?: string | null;
    name?: string | null;
    decimals?: string | number | null;
    icon_url?: string | null;
    type?: string | null;
  } | null;
};

type BlockscoutV2TokenBalancesResponseObject = {
  items?: BlockscoutV2TokenBalanceItem[] | null;
  next_page_params?: Record<string, unknown> | null;
};
type BlockscoutV2TokenBalancesResponse =
  | BlockscoutV2TokenBalancesResponseObject
  | BlockscoutV2TokenBalanceItem[];

type BlockscoutLegacyTokenItem = {
  contractAddress?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenDecimal?: string | number | null;
  balance?: string | null;
  iconUrl?: string | null;
};

type BlockscoutLegacyResponse = {
  status?: string;
  message?: string;
  result?: BlockscoutLegacyTokenItem[] | null;
};

const normalizeExplorerUrl = (url?: string | null): string => String(url || '').trim().replace(/\/+$/, '');

const parsePositiveBigInt = (value: unknown): bigint => {
  if (typeof value !== 'string' || value.trim() === '') return 0n;
  try {
    const normalized = BigInt(value);
    return normalized > 0n ? normalized : 0n;
  } catch {
    return 0n;
  }
};

const parseDecimals = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? '18'), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) return 18;
  return parsed;
};

const toV2Items = (payload: BlockscoutV2TokenBalancesResponse): BlockscoutV2TokenBalanceItem[] => {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
};

const toV2NextPageParams = (
  payload: BlockscoutV2TokenBalancesResponse,
): Record<string, string> | null => {
  if (Array.isArray(payload)) return null;
  if (!payload?.next_page_params || typeof payload.next_page_params !== 'object') return null;

  const result: Record<string, string> = {};
  Object.entries(payload.next_page_params).forEach(([key, value]) => {
    if (value === null || typeof value === 'undefined') return;
    result[key] = String(value);
  });
  return Object.keys(result).length ? result : null;
};

const parseBlockscoutV2Tokens = (items: BlockscoutV2TokenBalanceItem[]): TokenOption[] => {
  const byAddress = new Map<string, TokenOption>();

  items.forEach((item) => {
    const token = item?.token;
    const tokenType = String(token?.type || 'ERC-20').toUpperCase();
    if (!tokenType.includes('ERC-20')) return;

    const rawBalance = parsePositiveBigInt(item?.value);
    if (rawBalance <= 0n) return;

    const addressValue = token?.address_hash || token?.address || '';
    if (!isAddress(addressValue)) return;

    const normalizedAddress = getAddress(addressValue);
    const symbol = String(token?.symbol || 'TOKEN').trim().toUpperCase();
    const fallbackName = `Token ${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}`;
    const name = String(token?.name || fallbackName).trim();

    byAddress.set(normalizedAddress.toLowerCase(), {
      symbol,
      name,
      decimals: parseDecimals(token?.decimals),
      address: normalizedAddress,
      isNative: false,
      iconUrl: token?.icon_url || null,
    });
  });

  return Array.from(byAddress.values());
};

const parseBlockscoutLegacyTokens = (payload: BlockscoutLegacyResponse): TokenOption[] => {
  const items = Array.isArray(payload?.result) ? payload.result : [];
  const byAddress = new Map<string, TokenOption>();

  items.forEach((item) => {
    const rawBalance = parsePositiveBigInt(item?.balance);
    if (rawBalance <= 0n) return;

    const addressValue = String(item?.contractAddress || '').trim();
    if (!isAddress(addressValue)) return;

    const normalizedAddress = getAddress(addressValue);
    const symbol = String(item?.tokenSymbol || 'TOKEN').trim().toUpperCase();
    const fallbackName = `Token ${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}`;
    const name = String(item?.tokenName || fallbackName).trim();

    byAddress.set(normalizedAddress.toLowerCase(), {
      symbol,
      name,
      decimals: parseDecimals(item?.tokenDecimal),
      address: normalizedAddress,
      isNative: false,
      iconUrl: item?.iconUrl || null,
    });
  });

  return Array.from(byAddress.values());
};

const fetchWalletTokensFromExplorer = async (explorerUrl: string, address: Address): Promise<TokenOption[]> => {
  const collectedV2Items: BlockscoutV2TokenBalanceItem[] = [];
  let nextPageParams: Record<string, string> | null = null;
  let hasV2Response = false;
  let page = 0;

  while (page < 25) {
    const query = nextPageParams
      ? `?${new URLSearchParams(nextPageParams).toString()}`
      : '';
    const v2Res = await fetch(`${explorerUrl}/api/v2/addresses/${address}/token-balances${query}`, {
      headers: { accept: 'application/json' },
    });
    if (!v2Res.ok) break;

    hasV2Response = true;
    const payload = await v2Res.json() as BlockscoutV2TokenBalancesResponse;
    const pageItems = toV2Items(payload);
    if (pageItems.length) collectedV2Items.push(...pageItems);
    nextPageParams = toV2NextPageParams(payload);
    if (!nextPageParams) break;
    page += 1;
  }

  if (hasV2Response) {
    const parsedV2 = parseBlockscoutV2Tokens(collectedV2Items);
    if (parsedV2.length > 0) return parsedV2;
  }

  const legacyRes = await fetch(`${explorerUrl}/api?module=account&action=tokenlist&address=${address}`, {
    headers: { accept: 'application/json' },
  });
  if (legacyRes.ok) {
    const payload = await legacyRes.json() as BlockscoutLegacyResponse;
    return parseBlockscoutLegacyTokens(payload);
  }

  return [];
};

export function useReefWalletTokens(address: string | undefined) {
  const { isReefReady, selectedNetwork } = useReefState();
  const [tokens, setTokens] = useState<TokenOption[]>([]);

  useEffect(() => {
    if (!address || !isAddress(address) || !isReefReady) {
      setTokens([]);
      return;
    }

    let cancelled = false;
    const normalizedAddress = getAddress(address);

    const fetchTokens = async () => {
      try {
        const explorerUrl = normalizeExplorerUrl(getNetwork().blockExplorerUrl);
        if (!explorerUrl) {
          if (!cancelled) setTokens([]);
          return;
        }

        const walletTokens = await fetchWalletTokensFromExplorer(explorerUrl, normalizedAddress);
        if (!cancelled) setTokens(walletTokens);
      } catch {
        if (!cancelled) setTokens([]);
      }
    };

    fetchTokens();
    const interval = setInterval(fetchTokens, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, isReefReady, selectedNetwork]);

  return { tokens };
}
