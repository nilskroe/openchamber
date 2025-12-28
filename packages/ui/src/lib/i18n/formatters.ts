import { getCurrentLanguage } from './config';

// Get current language, fallback to en-US
const getLocale = () => getCurrentLanguage();

/**
 * Format a number according to the current locale.
 */
export const formatNumber = (
  value: number,
  options?: Intl.NumberFormatOptions
): string => {
  return new Intl.NumberFormat(getLocale(), options).format(value);
};

/**
 * Format a number in compact notation (e.g., 1.2K, 3.4M).
 */
export const formatCompactNumber = (value: number): string => {
  return new Intl.NumberFormat(getLocale(), {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);
};

/**
 * Format a currency value.
 */
export const formatCurrency = (
  value: number,
  currency: string = 'USD'
): string => {
  return new Intl.NumberFormat(getLocale(), {
    style: 'currency',
    currency,
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
  }).format(value);
};

/**
 * Format a date according to the current locale.
 */
export const formatDate = (
  date: Date | number | string,
  options?: Intl.DateTimeFormatOptions
): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(getLocale(), options).format(d);
};

/**
 * Format a date as short format (e.g., "Dec 28, 2024").
 */
export const formatShortDate = (date: Date | number | string): string => {
  return formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Format as month and year (e.g., "Dec 2024").
 */
export const formatMonthYear = (date: Date | number | string): string => {
  return formatDate(date, { month: 'short', year: 'numeric' });
};

/**
 * Format as relative time (e.g., "2 hours ago", "yesterday").
 */
export const formatRelativeTime = (date: Date | number): string => {
  const now = Date.now();
  const timestamp = typeof date === 'number' ? date : date.getTime();
  const diffMs = now - timestamp;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });

  if (diffDays > 0) return rtf.format(-diffDays, 'day');
  if (diffHours > 0) return rtf.format(-diffHours, 'hour');
  if (diffMins > 0) return rtf.format(-diffMins, 'minute');
  return rtf.format(-diffSecs, 'second');
};

/**
 * Format file size in human-readable format.
 */
export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${formatNumber(size, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
};

/**
 * Format a percentage value.
 */
export const formatPercent = (
  value: number,
  options?: Intl.NumberFormatOptions
): string => {
  return new Intl.NumberFormat(getLocale(), {
    style: 'percent',
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
};
