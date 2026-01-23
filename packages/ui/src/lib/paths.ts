/**
 * Shared path normalization utilities.
 * Centralizes the repeated pattern of backslash→forward-slash conversion
 * and trailing-slash stripping used across the codebase.
 */

/**
 * Normalizes a path string: replaces backslashes with forward slashes
 * and removes trailing slashes (preserving root "/").
 */
export const normalizePath = (value: string): string => {
  if (!value) return '';
  const replaced = value.replace(/\\/g, '/');
  if (replaced === '/') return '/';
  return replaced.replace(/\/+$/, '');
};

/**
 * Nullable variant: trims whitespace, returns null for empty/null/undefined,
 * otherwise normalizes the path.
 */
export const normalizePathOrNull = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizePath(trimmed);
};

/**
 * Joins two path segments, normalizing both and stripping
 * leading/trailing slashes from the segment.
 */
export const joinPath = (base: string, segment: string): string => {
  const normalizedBase = normalizePath(base);
  const cleanSegment = segment.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalizedBase || normalizedBase === '/') {
    return `/${cleanSegment}`;
  }
  return `${normalizedBase}/${cleanSegment}`;
};
