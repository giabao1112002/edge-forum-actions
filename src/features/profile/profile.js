const supportProfileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function supportProfileInput(value) {
  const input = value.trim();
  if (supportProfileIdPattern.test(input)) return { id: input.toLowerCase() };
  let url;
  try { url = new URL(input); } catch { throw new Error('Paste your Microsoft Learn profile link or its user ID.'); }
  const path = url.pathname.match(/^\/(?:[a-z]{2}-[a-z]{2}\/)?users\/([a-z0-9][a-z0-9._-]*)\/?$/i);
  if (url.protocol !== 'https:' || url.hostname !== 'learn.microsoft.com' ||
      url.port || url.username || url.password || !path)
    throw new Error('Use a Microsoft Learn user profile link or its user ID.');
  const id = url.searchParams.get('userid');
  if (id !== null && !supportProfileIdPattern.test(id))
    throw new Error('The profile link has an invalid user ID.');
  return { id: id?.toLowerCase() || null, username: path[1] };
}

function parseSupportProfile(value) {
  const profile = supportProfileInput(value);
  if (!profile.id) throw new Error('This profile link has no user ID. Look it up online before saving.');
  return profile.id;
}

async function resolveSupportProfileDetails(value, request) {
  const profile = supportProfileInput(value);
  if (profile.id) return profile;
  const endpoint = `https://learn.microsoft.com/api/profiles/${encodeURIComponent(profile.username)}`;
  let response;
  try {
    response = await (request || fetch)(endpoint, { credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(10000) });
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

if (typeof module !== 'undefined') module.exports = { parseSupportProfile, resolveSupportProfile, resolveSupportProfileDetails };
