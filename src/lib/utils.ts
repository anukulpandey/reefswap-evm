import { formatUnits } from 'viem';

export const shortAddress = (address?: string): string => {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const formatDisplayAmount = (value: bigint, decimals: number, maxFractionDigits = 6): string => {
  const asNumber = Number(formatUnits(value, decimals));
  if (!Number.isFinite(asNumber)) return '0';

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFractionDigits,
  }).format(asNumber);
};

export const normalizeInput = (value: string): string => {
  if (value === '') return '';
  if (!/^\d*\.?\d*$/.test(value)) return '';
  return value;
};

export const getErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('shortMessage' in error && typeof error.shortMessage === 'string') return error.shortMessage;
    if ('message' in error && typeof error.message === 'string') return error.message;
  }
  return 'Unexpected wallet or contract error.';
};
