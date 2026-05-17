/**
 * Hostname utilities shared between popup, settings, and content bridge.
 *
 * The "domain" scope for popup speed overrides keys by this normalized hostname
 * so that www.example.com and example.com share state.
 */

/**
 * Extract the hostname from a URL string and strip a leading `www.`.
 * Returns null for non-http(s) URLs or invalid input — callers should treat
 * a null hostname as "domain scope not applicable here" (e.g. chrome://).
 *
 * @param {string} href
 * @returns {string|null}
 */
export function normalizeHostname(href) {
  if (typeof href !== 'string' || href.length === 0) {
    return null;
  }
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  const host = url.hostname;
  if (!host) {
    return null;
  }
  return host.replace(/^www\./, '');
}

/**
 * Look up a domain-scoped speed override.
 *
 * @param {Object|undefined} domainSpeeds - Map of hostname → speed
 * @param {string|null} hostname
 * @returns {number|null} The override if present and finite, else null
 */
export function getDomainSpeed(domainSpeeds, hostname) {
  if (!domainSpeeds || !hostname) {
    return null;
  }
  const value = domainSpeeds[hostname];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}
