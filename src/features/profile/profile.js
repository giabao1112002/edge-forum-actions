const supportProfileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeSupportSite(site = 'learn') {
  const value = String(site || 'learn').trim().toLowerCase();
  if (!value) return 'learn';
  const map = {
    learn: 'learn',
    'microsoft learn': 'learn',
    'microsoftlearn': 'learn',
    devcommunity: 'devcommunity',
    devcomm: 'devcommunity',
    'developer community': 'devcommunity',
    'developercommunity': 'devcommunity',
    'developercommunity.visualstudio.com': 'devcommunity'
  };
  return map[value] || 'learn';
}

function profileStorageKey(profileId, site = 'learn', name = 'cases') {
  const normalizedSite = normalizeSupportSite(site);
  const value = String(profileId || '').trim();
  if (!value) return `${name}-${normalizedSite}`;
  return normalizedSite === 'learn' ? `${name}-${value}` : `${name}-${normalizedSite}-${value}`;
}

function threadStorageKey(profileId, site = 'learn', id = '') {
  const normalizedSite = normalizeSupportSite(site);
  const value = String(profileId || '').trim();
  if (!value) return normalizedSite === 'learn' ? `thread-${id}` : `thread-${normalizedSite}-${id}`;
  if (!id) return normalizedSite === 'learn' ? `thread-${value}` : `thread-${normalizedSite}-${value}`;
  return normalizedSite === 'learn' ? `thread-${value}-${id}` : `thread-${normalizedSite}-${value}-${id}`;
}

function supportProfileInput(value, siteHint = 'learn') {
  const input = String(value).trim();
  if (!input) throw new Error('Paste your Microsoft Learn or Developer Community profile link or its user ID.');
  const site = normalizeSupportSite(siteHint);
  if (supportProfileIdPattern.test(input)) return { site, id: input.toLowerCase() };
  let url;
  try { url = new URL(input); } catch { throw new Error('Paste your Microsoft Learn or Developer Community profile link or its user ID.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new Error('Use a Microsoft Learn or Developer Community profile link or user ID.');
  }
  if (url.hostname === 'learn.microsoft.com') {
    const path = url.pathname.match(/^\/(?:[a-z]{2}-[a-z]{2}\/)?users\/([a-z0-9][a-z0-9._-]*)\/?$/i);
    if (!path) throw new Error('Use a Microsoft Learn user profile link or its user ID.');
    const id = url.searchParams.get('userid');
    if (id !== null && !supportProfileIdPattern.test(id))
      throw new Error('The profile link has an invalid user ID.');
    return { site: 'learn', id: id?.toLowerCase() || null, username: path[1] };
  }
  if (url.hostname === 'developercommunity.visualstudio.com') {
    const path = url.pathname.match(/^\/(?:[a-z]{2}-[a-z]{2}\/)?user\/(\d+)(?:\/|$)/i);
    if (!path) throw new Error('Use a Developer Community user profile link or its user ID.');
    return { site: 'devcommunity', id: path[1], username: path[1] };
  }
  throw new Error('Use a Microsoft Learn or Developer Community profile link or user ID.');
}

function parseSupportProfile(value) {
  const profile = supportProfileInput(value);
  if (!profile.id) throw new Error('This profile link has no user ID. Look it up online before saving.');
  return profile.id;
}

async function resolveSupportProfileDetails(value, request, siteHint = 'learn') {
  const profile = supportProfileInput(value, siteHint);
  if (profile.id) return { id: profile.id, username: profile.username };
  const endpoint = `https://learn.microsoft.com/api/profiles/${encodeURIComponent(profile.username)}`;
  const fetchFn = request || globalThis.fetch;
  const AbortSignalRef = globalThis.AbortSignal || AbortSignal;
  let response;
  try {
    response = await fetchFn(endpoint, { credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: AbortSignalRef.timeout(10000) });
  } catch {
    throw new Error('Could not reach Microsoft Learn to look up this profile. Try again while online.');
  }
  if (!response.ok) throw new Error(`Microsoft Learn profile lookup failed (HTTP ${response.status}). Check the link.`);
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Microsoft Learn returned an unreadable profile.'); }
  if (typeof data?.userId !== 'string' || !supportProfileIdPattern.test(data.userId))
    throw new Error('Microsoft Learn did not return a valid user ID for this profile.');
  return { id: data.userId.toLowerCase(), username: profile.username };
}

async function resolveSupportProfile(value, request) {
  return (await resolveSupportProfileDetails(value, request)).id;
}

if (typeof module !== 'undefined') module.exports = {
  normalizeSupportSite,
  profileStorageKey,
  threadStorageKey,
  parseSupportProfile,
  resolveSupportProfile,
  resolveSupportProfileDetails
};
