const test = require('node:test');
const assert = require('node:assert/strict');
const { extractForumThread } = require('../src/features/threads/extractor');

test('extracts question metadata and answer/comment activity in chronological order', () => {
  const author = (id, name) => ({ getAttribute: () => id, querySelector: () => ({ textContent: name }) });
  const node = (id, type, userId, name, date) => ({ id, closest: () => null, querySelector: (selector) => {
    if (selector.startsWith('local-time')) return { getAttribute: () => date };
    if (selector.startsWith('[data-test-id')) return author(userId, name);
    if (selector === '.content') return { textContent: `  ${type}   message ` };
    return null;
  } });
  const answer = node('answer-1', 'answer', 'support', 'Engineer', '2026-09-28T12:00:00Z');
  const comment = node('comment-2', 'comment', 'customer', 'Customer', '2026-09-29T12:00:00Z');
  const page = {
    getElementById: () => null,
    querySelector: (selector) => {
      if (selector.includes('createdAt')) return { content: '2026-09-25T12:00:00Z' };
      if (selector.includes('authorId')) return { content: 'customer' };
      if (selector.includes('pageCount')) return { content: '1' };
      if (selector === 'h1') return { textContent: 'Sample thread' };
      return null;
    },
    querySelectorAll: (selector) => selector === 'article' ? [] : [comment, answer]
  };
  const result = extractForumThread(page, 'https://learn.microsoft.com/en-us/answers/questions/1234/sample');
  assert.deepEqual(result.entries.map((entry) => entry.id), ['question-1234', 'answer-1', 'comment-2']);
  assert.equal(result.entries[2].authorId, 'customer');
  assert.equal(result.entries[1].excerpt, 'answer message');
  assert.equal(result.entries[1].content, 'answer message');
  assert.equal(result.entries[2].parentAnswerId, null);
  assert.throws(() => extractForumThread(page, 'https://example.com/en-us/answers/questions/1234'), /Microsoft Learn/);
});

test('keeps full thread text in memory for handover while retaining short notification excerpts', () => {
  const content = 'Customer question. '.repeat(25);
  const question = { id: 'question-1234', querySelector: (selector) =>
    selector.startsWith('local-time') ? { getAttribute: () => '2026-10-12T09:00:00Z' } :
      selector.startsWith('[data-test-id') ? { getAttribute: () => 'customer', querySelector: () => ({ textContent: 'Customer' }) } :
        selector === '.content' ? { textContent: content } : null };
  const page = { getElementById: () => question,
    querySelector: (selector) => selector === 'h1' ? { textContent: 'Question' } : null,
    querySelectorAll: () => [] };
  const result = extractForumThread(page, 'https://learn.microsoft.com/en-us/answers/questions/1234/test');
  assert.equal(result.entries[0].content, content.trim());
  assert.equal(result.entries[0].excerpt.length, 170);
});

test('identifies the parent answer of a customer comment', () => {
  const question = { id: 'question-6018708', type: 'question', authorId: 'customer', timestamp: '2026-09-29T03:59:32Z' };
  const comment = { id: 'comment-2831922', closest: () => ({ id: 'answer-12979027' }), querySelector: (selector) => {
    if (selector.startsWith('local-time')) return { getAttribute: () => '2026-09-29T06:42:54Z' };
    if (selector.startsWith('[data-test-id')) return { getAttribute: () => 'customer', querySelector: () => ({ textContent: 'Customer' }) };
    return null;
  } };
  const page = {
    getElementById: () => null,
    querySelector: (selector) => selector.includes('createdAt') ? { content: question.timestamp } :
      selector.includes('authorId') ? { content: question.authorId } : null,
    querySelectorAll: (selector) => selector === 'article' ? [] : [comment]
  };
  const result = extractForumThread(page, 'https://learn.microsoft.com/en-us/answers/questions/6018708/compare-the-similarity-of-2-given-addresses');
  assert.equal(result.entries[1].parentAnswerId, 'answer-12979027');
});

test('finds accepted answer even when it is a div rather than a list item', () => {
  const acceptedAnswer = { id: 'answer-12969131', querySelector: (selector) => {
    if (selector.startsWith('local-time')) return { getAttribute: () => '2026-09-22T04:37:43Z' };
    if (selector.startsWith('[data-test-id')) return { getAttribute: () => 'brian', querySelector: () => ({ textContent: 'Brian' }) };
    if (selector === '.content') return { textContent: 'A proposed fix' };
    return null;
  } };
  const acceptedCard = { textContent: 'Answer accepted by question author', querySelector: () => acceptedAnswer };
  const page = {
    getElementById: () => null,
    querySelector: (selector) => {
      if (selector.includes('createdAt')) return { content: '2026-09-21T12:00:00Z' };
      if (selector.includes('authorId')) return { content: 'customer' };
      return null;
    },
    querySelectorAll: (selector) => selector === 'article' ? [acceptedCard] : [acceptedAnswer]
  };
  const result = extractForumThread(page, 'https://learn.microsoft.com/en-us/answers/questions/6010432/example');
  assert.equal(result.acceptedAnswerId, 'answer-12969131');
  assert.equal(result.entries.find((entry) => entry.id === result.acceptedAnswerId).authorId, 'brian');
});
