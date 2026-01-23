/**
 * Shared utilities for parsing and resolving permission rulesets.
 */

export type PermissionAction = 'allow' | 'ask' | 'deny';
export type PermissionRule = { permission: string; pattern: string; action: PermissionAction };

/**
 * Parse an unknown value into a validated PermissionRule array.
 * Returns null if the value is not a valid ruleset.
 */
export const asPermissionRuleset = (value: unknown): PermissionRule[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const rules: PermissionRule[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const candidate = entry as Partial<PermissionRule>;
    if (typeof candidate.permission !== 'string' || typeof candidate.pattern !== 'string' || typeof candidate.action !== 'string') {
      continue;
    }
    if (candidate.action !== 'allow' && candidate.action !== 'ask' && candidate.action !== 'deny') {
      continue;
    }
    rules.push({ permission: candidate.permission, pattern: candidate.pattern, action: candidate.action });
  }
  return rules;
};

/**
 * Resolve the wildcard action for a specific permission from a ruleset.
 * Checks specific permission wildcards first, then falls back to global wildcards.
 */
export const resolveWildcardPermissionAction = (ruleset: unknown, permission: string): PermissionAction | undefined => {
  const rules = asPermissionRuleset(ruleset);
  if (!rules || rules.length === 0) {
    return undefined;
  }

  for (let i = rules.length - 1; i >= 0; i -= 1) {
    const rule = rules[i];
    if (rule.permission === permission && rule.pattern === '*') {
      return rule.action;
    }
  }

  for (let i = rules.length - 1; i >= 0; i -= 1) {
    const rule = rules[i];
    if (rule.permission === '*' && rule.pattern === '*') {
      return rule.action;
    }
  }

  return undefined;
};

/**
 * Build a map of pattern → action for a specific permission from a ruleset.
 * Returns undefined if no rules match the given permission.
 */
export const buildPermissionActionMap = (ruleset: unknown, permission: string): Record<string, PermissionAction | undefined> | undefined => {
  const rules = asPermissionRuleset(ruleset);
  if (!rules || rules.length === 0) {
    return undefined;
  }

  const map: Record<string, PermissionAction | undefined> = {};
  for (const rule of rules) {
    if (rule.permission !== permission) {
      continue;
    }
    map[rule.pattern] = rule.action;
  }

  return Object.keys(map).length > 0 ? map : undefined;
};
