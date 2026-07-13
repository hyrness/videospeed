/**
 * Site pattern matching utilities.
 *
 * Shared matching engine used by siteRules (structured array) and the legacy
 * blacklist (newline-separated string).  Pure ES module — no DOM dependencies.
 */

const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;
const escapeRegExp = (str) => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

/**
 * Compile a pattern string into a RegExp.
 *
 * Supports three forms:
 *   1. Regex notation:  /pattern/flags
 *   2. Domain literal:  youtube.com  →  /(^|\.|\/\/)youtube\.com(\/|:|$)/
 *   3. Substring:       any other string  →  escaped literal match
 *
 * @param {string} raw - Pattern string (trimmed)
 * @returns {RegExp|null} Compiled regex, or null if invalid
 */
function compilePattern(raw) {
  const pattern = raw.replace(regStrip, '');
  if (pattern.length === 0) {
    return null;
  }

  if (pattern.startsWith('/')) {
    try {
      const parts = pattern.split('/');
      if (parts.length < 3) {
        return null;
      }

      const hasFlags = regEndsWithFlags.test(pattern);
      const flags = hasFlags ? parts.pop() : '';
      const regex = parts.slice(1, hasFlags ? undefined : -1).join('/');

      if (!regex) {
        return null;
      }
      return new RegExp(regex, flags);
    } catch {
      return null;
    }
  }

  const escaped = escapeRegExp(pattern);
  const looksLikeDomain = pattern.includes('.') && !pattern.includes('/');

  if (looksLikeDomain) {
    return new RegExp(`(^|\\.|//)${escaped}(\\/|:|$)`);
  }
  return new RegExp(escaped);
}

/**
 * Match URL(s) against an array of site rule objects.
 * Returns the first rule whose pattern matches any of the URLs, or null.
 * Rule order decides priority — each rule is tested against every URL
 * before moving to the next rule.
 *
 * @param {Array<{pattern: string}>} rules - Rule objects (must have a `pattern` field)
 * @param {string|string[]} hrefs - URL(s) to test (e.g. frame href + ancestor origins)
 * @returns {Object|null} First matching rule, or null
 */
export function matchSiteRule(rules, hrefs) {
  if (!rules || !rules.length) {
    return null;
  }

  const urls = Array.isArray(hrefs) ? hrefs : [hrefs];

  for (const rule of rules) {
    const regexp = compilePattern(rule.pattern || '');
    if (regexp && urls.some((url) => regexp.test(url))) {
      return rule;
    }
  }

  return null;
}

/**
 * Backward-compatible wrapper: check a legacy newline-separated blacklist string.
 *
 * @param {string} blacklist - Newline-separated pattern string
 * @param {string} href - URL to test
 * @returns {boolean} true if any pattern matches
 */
// Expose on window.VSC for page-context consumers (settings.js).
window.VSC = window.VSC || {};
window.VSC.matchSiteRule = matchSiteRule;

export function isBlacklisted(blacklist, href) {
  if (!blacklist) {
    return false;
  }

  const rules = blacklist
    .split('\n')
    .map((line) => ({ pattern: line.replace(regStrip, '') }))
    .filter((r) => r.pattern.length > 0);

  return matchSiteRule(rules, href) !== null;
}
