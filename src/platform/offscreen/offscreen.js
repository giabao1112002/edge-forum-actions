chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'forum-parser') return;
  if (message.type === 'icon') {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.fillStyle = '#155bb6';
    context.fillRect(0, 0, 96, 96);
    context.fillStyle = '#ffffff';
    context.font = 'bold 68px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('F', 48, 51);
    respond({ iconUrl: canvas.toDataURL('image/png') });
    return;
  }
  if (message.type !== 'read') return;
  (async () => {
    const url = new URL(message.url);
    if (url.protocol !== 'https:') throw new Error('Thread links must use HTTPS.');
    const communityMatch = url.hostname === 'developercommunity.visualstudio.com' &&
      url.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/i);
    if (communityMatch) {
      const endpoint = `https://sendvsfeedback2.azurewebsites.net/api/detailsV3/rootPost?id=${communityMatch[1]}`;
      const response = await fetch(endpoint, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Developer Community request failed (${response.status}).`);
      const data = await response.json();
      const thread = extractDeveloperCommunityThread(data, url.href);
      if (!thread.entries.length) throw new Error('No dated Developer Community activity found.');
      return thread;
    }
    if (url.hostname !== 'learn.microsoft.com' ||
        !/^\/[a-z]{2}-[a-z]{2}\/answers\/questions\/\d+(?:\/|$)/i.test(url.pathname))
      throw new Error('Invalid Microsoft Q&A or Developer Community thread link.');
    const response = await fetch(url.href, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Thread request failed (${response.status}).`);
    const thread = extractForumThread(new DOMParser().parseFromString(await response.text(), 'text/html'), response.url);
    if (!thread.entries.length) throw new Error('No dated thread activity found.');
    return thread;
  })().then((thread) => respond({ thread }), (error) => respond({ error: error.message }));
  return true;
});
