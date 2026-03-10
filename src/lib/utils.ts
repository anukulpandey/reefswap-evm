import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatUnits } from 'viem';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

const pickString = (value: unknown): string => (typeof value === 'string' ? value : '');

const findNestedMessage = (value: unknown, depth = 0): string => {
  if (!value || depth > 4 || typeof value !== 'object') return '';
  const maybe = value as Record<string, unknown>;
  const direct = pickString(maybe.shortMessage) || pickString(maybe.reason) || pickString(maybe.message);
  if (direct) return direct;
  return (
    findNestedMessage(maybe.data, depth + 1)
    || findNestedMessage(maybe.error, depth + 1)
    || findNestedMessage(maybe.cause, depth + 1)
  );
};

export const getErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybe = error as Record<string, unknown>;
    const shortMessage = pickString(maybe.shortMessage);
    const message = pickString(maybe.message);
    const nestedMessage = (
      findNestedMessage(maybe.data)
      || findNestedMessage(maybe.error)
      || findNestedMessage(maybe.cause)
    );

    if (shortMessage) return shortMessage;
    if (message && nestedMessage && nestedMessage !== message) return `${message} ${nestedMessage}`;
    if (message) return message;
    if (nestedMessage) return nestedMessage;
  }
  return 'Unexpected wallet or contract error.';
};
