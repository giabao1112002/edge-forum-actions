function extractForumThread(page = document, pageUrl = location.href) {
  const url = new URL(pageUrl);
  const match = url.pathname.match(/^\/[a-z]{2}-[a-z]{2}\/answers\/questions\/(\d+)(?:\/|$)/i);
  if (url.hostname !== 'learn.microsoft.com' || !match) throw new Error('Enter a Microsoft Learn Q&A question URL.');
  const questionId = match[1];
  const entries = [];
  function add(node, type) {
    const timestamp = node.querySelector('local-time[datetime], time[datetime]')?.getAttribute('datetime');
    const date = Date.parse(timestamp || '');
    if (!Number.isFinite(date)) return;
    const author = node.querySelector('[data-test-id="content-author"][data-id]');
    const answerContainer = type === 'comment' ? node.closest?.('[id^="answer-"]') : null;
    const parentAnswerId = /^answer-\d+$/.test(answerContainer?.id || '') ? answerContainer.id : null;
    const content = (node.querySelector('.content')?.textContent || '').replace(/\s+/g, ' ').trim();
    entries.push({ id: node.id, type, parentAnswerId, authorId: author?.getAttribute('data-id') || '',
      author: author?.querySelector('.profile-url')?.textContent?.trim() || 'Unknown',
      timestamp: new Date(date).toISOString(),
      content, excerpt: content.slice(0, 170) });
  }
  const question = page.getElementById(`question-${questionId}`);
  if (question) add(question, 'question');
  else {
    const timestamp = page.querySelector('meta[name="createdAt"]')?.content;
    if (timestamp && Number.isFinite(Date.parse(timestamp))) entries.push({ id: `question-${questionId}`, type: 'question',
      authorId: page.querySelector('meta[name="authorId"]')?.content || '', author: 'Question author',
      timestamp: new Date(timestamp).toISOString(), content: '', excerpt: '' });
  }
  page.querySelectorAll('[id^="answer-"], li[id^="comment-"]').forEach((node) => {
    if (/^answer-\d+$/.test(node.id) || /^comment-\d+$/.test(node.id))
      add(node, node.id.startsWith('answer-') ? 'answer' : 'comment');
  });
  const acceptedCard = Array.from(page.querySelectorAll('article')).find((card) =>
    card.textContent.includes('Answer accepted by question author') && card.querySelector('[id^="answer-"]'));
  const acceptedAnswerId = acceptedCard?.querySelector('[id^="answer-"]')?.id || null;
  return { id: questionId, url: `${url.origin}${url.pathname}`, title: page.querySelector('h1')?.textContent?.trim() || 'Q&A thread',
    entries: entries.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)),
    acceptedAnswerId,
    hasMorePages: Number(page.querySelector('meta[name="pageCount"]')?.content || 1) > 1 };
}
if (typeof module !== 'undefined') module.exports = { extractForumThread };
