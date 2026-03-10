export interface Token {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  iconUrl?: string | null;
  price: number;
  priceChange: number;
  balance: number;
  usdValue: number;
  address?: `0x${string}` | null;
  decimals?: number;
  isNative?: boolean;
}
