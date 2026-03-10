import { DEFAULT_TOKEN_ICONS } from './defaultTokenIcons';

const REEF_IPFS_GATEWAY = 'https://reef.infura-ipfs.io/ipfs/';
const REEF_ADDRESS = '0x0000000000000000000000000000000001000000';
const REEF_TOKEN_ICON_URL = 'https://s2.coinmarketcap.com/static/img/coins/64x64/6951.png';

const normalizeAddress = (address?: string | null): string => (address || '').trim().toLowerCase();

// Matches the checksum logic used by react-lib.
const getHashSumLastNr = (address: string): number => {
  const summ = address
    .split('')
    .reduce((sum, ch) => {
      const nr = parseInt(ch, 10);
      if (!Number.isNaN(nr)) {
        return sum + nr;
      }
      return sum;
    }, 0)
    .toString(10);

  return parseInt(summ.substring(summ.length - 1), 10);
};

// Matches react-lib fallback icon behavior.
export const getIconUrl = (tokenAddress = ''): string => {
  const normalizedTokenAddress = normalizeAddress(tokenAddress);
  if (normalizedTokenAddress === normalizeAddress(REEF_ADDRESS)) {
    return REEF_TOKEN_ICON_URL;
  }

  const checkSum = getHashSumLastNr(normalizedTokenAddress);
  const nr = checkSum > -1 && checkSum < 10 ? checkSum : checkSum % 10;
  const svg = DEFAULT_TOKEN_ICONS[nr] || DEFAULT_TOKEN_ICONS[0];
  return `data:image/svg+xml;base64,${btoa(svg)}`;
};

export const resolveIpfsUrl = (iconUrl?: string | null): string | null => {
  if (!iconUrl) return null;
  const normalized = iconUrl.trim();
  if (!normalized) return null;

  if (normalized.startsWith('ipfs://')) {
    const hash = normalized.replace(/^ipfs:\/\//, '').replace(/^ipfs\//, '');
    return hash ? `${REEF_IPFS_GATEWAY}${hash}` : null;
  }

  if (normalized.includes('cloudflare-ipfs.com')) {
    return normalized.replace('cloudflare-ipfs.com', 'reef.infura-ipfs.io');
  }

  return normalized;
};

export const resolveTokenIconUrl = (params: {
  address?: string | null;
  symbol?: string | null;
  iconUrl?: string | null;
}): string => {
  const resolvedUrl = resolveIpfsUrl(params.iconUrl);
  if (resolvedUrl) return resolvedUrl;

  const tokenAddress = params.address
    || (params.symbol?.trim().toUpperCase() === 'REEF' ? REEF_ADDRESS : params.symbol || '');
  return getIconUrl(tokenAddress);
};
