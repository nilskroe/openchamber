/**
 * Shared model formatting utilities for tokens, costs, and knowledge dates.
 */

export const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

export const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
});

/**
 * Format token counts using Intl compact notation (e.g., 1.5K, 2.3M).
 * Handles null/undefined values gracefully.
 */
export const formatTokens = (value?: number | null): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (value === 0) return '0';
  const formatted = COMPACT_NUMBER_FORMATTER.format(value);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
};

/**
 * Format token counts using simple K/M suffixes (e.g., 1.5K, 2.3M).
 * For use when the value is always a number.
 */
export const formatTokensCompact = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toFixed(1).replace(/\.0$/, '');
};

/**
 * Format a cost value as USD currency.
 */
export const formatCost = (value?: number | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return CURRENCY_FORMATTER.format(value);
};

/**
 * Format a knowledge cutoff date string (YYYY-MM) to human-readable form (e.g., "Jan 2024").
 */
export const formatKnowledge = (knowledge?: string): string => {
  if (!knowledge) return '—';
  const match = knowledge.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number.parseInt(match[1], 10);
    const monthIndex = Number.parseInt(match[2], 10) - 1;
    const knowledgeDate = new Date(Date.UTC(year, monthIndex, 1));
    if (!Number.isNaN(knowledgeDate.getTime())) {
      return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(knowledgeDate);
    }
  }
  return knowledge;
};
