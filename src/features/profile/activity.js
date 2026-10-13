function activityThreadLinks(feed, profileId, now = new Date()) {
  if (!Array.isArray(feed?.items) || feed.userId?.toLowerCase() !== profileId.toLowerCase())
    throw new Error('Microsoft Learn activity does not match the saved support profile.');
  const cutoff = now.getTime() - 30 * 86400000;
  const links = new Map();
  for (const item of feed.items) {
    if (item.activityType !== 'qnA' || item.userId?.toLowerCase() !== profileId.toLowerCase() ||
        !['answer', 'comment'].includes(item.activityData?.type) ||
        !['answered', 'commented'].includes(item.activityData?.actionVerb)) continue;
    const timestamp = Date.parse(item.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now.getTime()) continue;
    let url;
    try { url = new URL(item.activityData.uri, 'https://learn.microsoft.com'); } catch { continue; }
    const match = url.pathname.match(/^\/[a-z]{2}-[a-z]{2}\/answers\/questions\/(\d+)(?:\/|$)/i);
    if (url.protocol !== 'https:' || url.hostname !== 'learn.microsoft.com' || !match) continue;
    if (!links.has(match[1])) links.set(match[1], { id: match[1], url: `${url.origin}${url.pathname}` });
  }
  return [...links.values()];
}

if (typeof module !== 'undefined') module.exports = { activityThreadLinks };
