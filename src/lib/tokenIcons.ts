const REEF_IPFS_GATEWAY = 'https://reef.infura-ipfs.io/ipfs/';

const FALLBACK_PALETTES: Array<{ from: string; to: string; accent: string; text: string }> = [
  { from: '#B275FF', to: '#6920FC', accent: '#40FFFF', text: '#FFFFFF' },
  { from: '#40FFFF', to: '#006064', accent: '#C6FF00', text: '#012639' },
  { from: '#F8A8FF', to: '#FF4081', accent: '#FFFF8D', text: '#1E0135' },
  { from: '#A8FFFF', to: '#1E0135', accent: '#C6FF00', text: '#FFFFFF' },
  { from: '#FFFBF8', to: '#FF4081', accent: '#00B8D4', text: '#1E0135' },
  { from: '#C6FF00', to: '#012639', accent: '#FF4081', text: '#1E0135' },
  { from: '#FF80AB', to: '#5D3BAD', accent: '#18FFFF', text: '#FFFFFF' },
  { from: '#A93185', to: '#5D3BAD', accent: '#E9E1F3', text: '#FFFFFF' },
  { from: '#8BD3FF', to: '#3C4FA1', accent: '#FFE082', text: '#FFFFFF' },
  { from: '#C8E6C9', to: '#2E7D32', accent: '#A5D6A7', text: '#FFFFFF' },
];

const hashSeed = (seed: string): number => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const sanitizeLabel = (raw: string): string => {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return clean.slice(0, 2) || '?';
};

export const resolveIpfsUrl = (iconUrl?: string | null): string | null => {
  if (!iconUrl) return null;
  const normalized = iconUrl.trim();
  if (!normalized) return null;

  if (normalized.startsWith('ipfs://')) {
    const hash = normalized.replace(/^ipfs:\/\//, '').replace(/^ipfs\//, '');
    return hash ? `${REEF_IPFS_GATEWAY}${hash}` : null;
  }

  if (normalized.includes('cloudflare-ipfs.com/ipfs/')) {
    return normalized.replace('cloudflare-ipfs.com/ipfs/', 'reef.infura-ipfs.io/ipfs/');
  }

  return normalized;
};

export const createTokenFallbackIcon = (seedValue: string, labelValue?: string): string => {
  const seed = seedValue || 'token';
  const hash = hashSeed(seed);
  const palette = FALLBACK_PALETTES[hash % FALLBACK_PALETTES.length];
  const label = sanitizeLabel(labelValue || seed);

  const circleX = 72 + (hash % 120);
  const circleY = 80 + ((hash >> 3) % 120);
  const circleSize = 34 + ((hash >> 5) % 26);
  const ringX = 180 - ((hash >> 7) % 90);
  const ringY = 185 - ((hash >> 9) % 90);
  const ringSize = 22 + ((hash >> 11) % 20);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.from}" />
      <stop offset="1" stop-color="${palette.to}" />
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="60" fill="url(#g)" />
  <circle cx="${circleX % 120}" cy="${circleY % 120}" r="${circleSize}" fill="${palette.accent}" fill-opacity="0.22" />
  <circle cx="${ringX % 120}" cy="${ringY % 120}" r="${ringSize}" stroke="${palette.accent}" stroke-opacity="0.45" stroke-width="4" />
  <text x="60" y="66" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="${palette.text}">
    ${label}
  </text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const resolveTokenIconUrl = (params: {
  address?: string | null;
  symbol?: string | null;
  iconUrl?: string | null;
}): string => {
  const resolvedUrl = resolveIpfsUrl(params.iconUrl);
  if (resolvedUrl) return resolvedUrl;

  const seed = params.address || params.symbol || 'token';
  return createTokenFallbackIcon(seed, params.symbol || params.address || 'T');
};

