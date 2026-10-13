function parseSupportProfile(value) {
  const input = value.trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(input)) return input.toLowerCase();
  let url;
  try { url = new URL(input); } catch { throw new Error('Paste your Microsoft Learn profile link or its user ID.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'learn.microsoft.com' ||
      !/^\/(?:[a-z]{2}-[a-z]{2}\/)?users\//i.test(url.pathname) || !uuid.test(url.searchParams.get('userid') || ''))
    throw new Error('Use a Microsoft Learn user link containing ?userid=..., or its user ID.');
  return url.searchParams.get('userid').toLowerCase();
}
if (typeof module !== 'undefined') module.exports = { parseSupportProfile };
