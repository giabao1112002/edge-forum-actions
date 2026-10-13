// Owns async request/profile guards and orchestrates storage, reader and views.
function createPopupApp({ document, chrome, state, domain, extractForumThread, views, resolveSupportProfileDetails, buildLeaveReport }) {
  const { caseSummary, planAction, caseTitle } = domain;
  const message = document.getElementById('message');
  const threadSection = document.getElementById('thread');
  const casesKey = () => `cases-${state.supportAuthorId}`;
  const app = { readThread, extractForumThread, loadThread, refreshSavedCases, initialize,
    renderCases: () => casesView.renderCases() };
  const { activateTab } = views.createTabs({ document });
  const { renderThread } = views.createThreadView({ document, state, domain, saveAndRender });
  const { renderCalendar } = views.createCalendarView({ document, state, domain });
  const casesView = views.createCasesView({ document, state, domain, persistCases, renderThread, renderCalendar });
  const renderCases = () => casesView.renderCases();
  const { loadDiscord, loadReminders } = views.createSettingsController({ document, chrome, state,
    resolveSupportProfileDetails, syncProfileCases, loadSettings, casesKey, renderCases, renderThread });
  views.createReportController({ document, state, buildLeaveReport });

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || state.profileLoading || !state.supportAuthorId) return;
    if (changes[`discord-status-${state.supportAuthorId}`])
      document.getElementById('discord-status').textContent = changes[`discord-status-${state.supportAuthorId}`].newValue?.message || '';
    if (changes[`activity-sync-${state.supportAuthorId}`])
      document.getElementById('activity-sync-status').textContent = changes[`activity-sync-${state.supportAuthorId}`].newValue?.message || '';
    if (changes[casesKey()]) {
      const previous = state.cases.find((item) => item.id === state.thread?.id);
      state.cases = changes[casesKey()].newValue || [];
      renderCases();
      const current = state.cases.find((item) => item.id === state.thread?.id);
      if (state.thread && !state.refreshingCases && current && JSON.stringify(previous) !== JSON.stringify(current)) {
        if (current.error) message.textContent = `Last known thread data · Refresh failed: ${current.error}`;
        else loadThread(state.thread.url, null, false);
      } else if (state.thread && !state.profileLoading) renderThread();
    }
  });
  async function syncProfileCases() {
    const profileId = state.supportAuthorId;
    const key = `profile-name-${profileId}`;
    const stored = await chrome.storage.local.get([key, `activity-sync-${profileId}`]);
    if (profileId !== state.supportAuthorId) return;
    const status = document.getElementById('activity-sync-status');
    status.textContent = stored[`activity-sync-${profileId}`]?.message ||
      (stored[key] ? 'Checking recent profile activity...' : 'Save a profile link to discover cases automatically.');
    if (!stored[key]) return;
    try {
      const result = await chrome.runtime.sendMessage({ target: 'forum-discovery', profileId });
      if (result?.error) throw new Error(result.error);
      if (profileId !== state.supportAuthorId) return;
      status.textContent = result?.message || 'Profile activity checked.';
      state.cases = (await chrome.storage.local.get(casesKey()))[casesKey()] || [];
      renderCases();
    } catch (error) {
      if (profileId === state.supportAuthorId) status.textContent = `Profile activity check failed: ${error.message}`;
    }
  }
  function validateUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'learn.microsoft.com' ||
        !/^\/[a-z]{2}-[a-z]{2}\/answers\/questions\/\d+(?:\/|$)/i.test(url.pathname)) {
      throw new Error('Use a https://learn.microsoft.com/.../answers/questions/NUMBER link.');
    }
    return url;
  }
  async function loadSettings(id, profileId = state.supportAuthorId) {
    const key = `thread-${profileId}-${id}`;
    const saved = await chrome.storage.local.get([key, `thread-${id}`]);
    const current = saved[key];
    const legacy = saved[`thread-${id}`];
    return { supportAuthorId: profileId, actions: { ...(current?.actions || (!current && legacy?.supportAuthorId === profileId ? legacy.actions : {}) || {}) } };
  }
  async function saveAndRender(valueThread = state.thread, valueSettings = state.settings) {
    if (state.profileLoading || valueThread !== state.thread || valueSettings !== state.settings || valueSettings.supportAuthorId !== state.supportAuthorId) return;
    const summary = caseSummary(valueThread, planAction(valueThread, valueSettings), new Date().toISOString(), state.supportAuthorId, valueSettings.actions);
    await persistCases({ type: 'correct', id: valueThread.id, summary,
      expected: state.cases.find((item) => item.id === valueThread.id), settings: valueSettings });
    if (valueThread === state.thread && valueSettings === state.settings) renderThread();
  }
  async function readThread(value, activeTab = null) {
    const url = validateUrl(value);
    let result;
    if (activeTab !== null) {
      const injected = await chrome.scripting.executeScript({ target: { tabId: activeTab }, func: app.extractForumThread });
      result = injected[0].result;
    } else {
      const response = await fetch(url.href, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Thread request failed (${response.status}).`);
      result = app.extractForumThread(new DOMParser().parseFromString(await response.text(), 'text/html'), response.url);
    }
    if (!result.entries.length) throw new Error('No dated thread activity found. Open the Q&A page in Edge and try again.');
    return result;
  }
  async function loadThread(value, activeTab = null, saveSummary = true) {
    if (state.profileLoading) return;
    const request = ++state.threadRequest;
    const profileId = state.supportAuthorId;
    const expected = state.cases.find((item) => item.url === value || item.id === state.thread?.id && state.thread.url === value);
    try {
      message.textContent = 'Reading thread...';
      const loaded = await app.readThread(value, activeTab);
      const loadedSettings = await loadSettings(loaded.id, profileId);
      if (request !== state.threadRequest || profileId !== state.supportAuthorId || state.profileLoading) return;
      state.thread = loaded;
      state.settings = loadedSettings;
      renderThread();
      if (saveSummary && expected) await updateSavedCase(expected);
      if (request === state.threadRequest && profileId === state.supportAuthorId)
        message.textContent = state.thread.hasMorePages ? 'More pages detected: deadlines are withheld.' : '';
    } catch (error) {
      if (request !== state.threadRequest || profileId !== state.supportAuthorId) return;
      threadSection.hidden = true;
      message.textContent = error.message;
    }
  }
  async function persistCases(change) {
    const profileId = state.supportAuthorId;
    const result = await chrome.runtime.sendMessage({ target: 'forum-case-store', profileId, ...change });
    if (!result || result.error) throw new Error(result?.error || 'Case storage is unavailable.');
    if (profileId === state.supportAuthorId && !state.profileLoading) {
      state.cases = result.cases;
      renderCases();
    }
    return result;
  }
  async function updateSavedCase(expected) {
    const { thread, settings, supportAuthorId } = state;
    const summary = caseSummary(thread, planAction(thread, settings), new Date().toISOString(), supportAuthorId, settings.actions);
    await persistCases({ type: 'update', id: thread.id, expected, summary, thread });
  }
  document.getElementById('url-form').addEventListener('submit', (event) => {
    event.preventDefault();
    loadThread(document.getElementById('thread-url').value);
  });
  document.getElementById('save-case').addEventListener('click', async () => {
    const { profileLoading, supportAuthorId, thread, settings, cases } = state;
    if (profileLoading || !supportAuthorId || !thread || cases.some((item) => item.id === thread.id)) return;
    const summary = caseSummary(thread, planAction(thread, settings), new Date().toISOString(), supportAuthorId, settings.actions);
    await persistCases({ type: 'add', id: thread.id, summary, thread });
    renderThread();
  });
  document.getElementById('refresh-thread').addEventListener('click', () => {
    if (state.thread) return loadThread(state.thread.url);
  });
  async function refreshSavedCases(failedOnly = false) {
    if (state.refreshingCases || state.profileLoading || !state.supportAuthorId || !state.cases.length) return;
    const selected = state.cases.filter((item) => !failedOnly || item.error);
    if (!selected.length) return;
    state.refreshingCases = true;
    const profileId = state.supportAuthorId;
    const request = state.threadRequest;
    const progress = document.getElementById('refresh-progress');
    progress.max = selected.length;
    progress.value = 0;
    progress.hidden = false;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    renderCases();
    try {
      for (const [index, saved] of selected.entries()) {
        if (state.supportAuthorId !== profileId) break;
        message.textContent = `Checking ${index + 1}/${selected.length} · ${caseTitle(saved)}`;
        try {
          const updated = await app.readThread(saved.url);
          if (state.supportAuthorId !== profileId) break;
          if (updated.id !== saved.id) throw new Error('The link redirected to a different Q&A case.');
          const savedSettings = await loadSettings(updated.id);
          if (state.supportAuthorId !== profileId) break;
          if (state.thread?.id === updated.id && request === state.threadRequest && !state.profileLoading) {
            state.thread = updated;
            state.settings = savedSettings;
            renderThread();
          }
          const summary = caseSummary(updated, planAction(updated, savedSettings), new Date().toISOString(), state.supportAuthorId, savedSettings.actions);
          const result = await persistCases({ type: 'update', id: saved.id, expected: saved, summary, thread: updated });
          if (result.applied) succeeded++;
          else skipped++;
        } catch (error) {
          if (state.supportAuthorId !== profileId) break;
          const result = await persistCases({ type: 'update', id: saved.id, expected: saved, summary: { ...saved, error: error.message } });
          if (result.applied) failed++;
          else skipped++;
        }
        progress.value = index + 1;
      }
      if (state.supportAuthorId === profileId) {
        message.textContent = `Checked ${selected.length} case(s): ${succeeded} updated, ${failed} failed${skipped ? `, ${skipped} skipped (removed or changed)` : ''}.` +
          (failed ? ' Open My Cases to view errors or retry failed cases.' : '');
      }
    } catch (error) {
      if (state.supportAuthorId === profileId) message.textContent = `Refresh interrupted: ${error.message}`;
    } finally {
      progress.hidden = true;
      state.refreshingCases = false;
      renderCases();
    }
  }
  document.getElementById('refresh-cases').addEventListener('click', () => refreshSavedCases());
  document.getElementById('retry-cases').addEventListener('click', () => refreshSavedCases(true));
  async function initialize() {
    const stored = await chrome.storage.local.get('supportAuthorId');
    state.supportAuthorId = stored.supportAuthorId || '';
    document.getElementById('profile-input').value = state.supportAuthorId;
    document.getElementById('profile-label').textContent = state.supportAuthorId || 'Not set';
    document.getElementById('profile-section').open = !state.supportAuthorId;
    if (!state.supportAuthorId) activateTab('settings');
    if (state.supportAuthorId) state.cases = (await chrome.storage.local.get(casesKey()))[casesKey()] || [];
    await loadReminders();
    await loadDiscord();
    renderCases();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try { validateUrl(tab.url); await loadThread(tab.url, tab.id); }
      catch { message.textContent = 'Open a Microsoft Q&A thread or paste its link above.'; }
    }
    syncProfileCases().catch((error) => { document.getElementById('activity-sync-status').textContent = error.message; });
    await refreshSavedCases();
  }
  return app;
}
