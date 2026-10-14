// Owns async request/profile guards and orchestrates storage, reader and views.
function createPopupApp({ document, chrome, state, domain, extractForumThread, views, resolveSupportProfileDetails,
  buildHandoverCase, buildLeaveReport }) {
  const { caseSummary, planAction, caseTitle } = domain;
  const message = document.getElementById('message');
  const threadSection = document.getElementById('thread');
  const activeSite = () => normalizeSupportSite(state.supportSite || 'learn');
  const casesKey = () => profileStorageKey(state.supportAuthorId, activeSite(), 'cases');
  const profileNameKey = () => profileStorageKey(state.supportAuthorId, activeSite(), 'profile-name');
  const activitySyncKey = () => profileStorageKey(state.supportAuthorId, activeSite(), 'activity-sync');
  async function loadAllCases() {
    const profiles = state.supportProfiles || {};
    const sources = ['learn', 'devcommunity'].filter((site) => profiles[site]?.id);
    if (!sources.length && state.supportAuthorId) sources.push(activeSite());
    const keys = sources.map((site) => profileStorageKey(profiles[site]?.id || state.supportAuthorId, site, 'cases'));
    const stored = keys.length ? await chrome.storage.local.get(keys) : {};
    return sources.flatMap((site, index) => (stored[keys[index]] || []).map((item) => ({
      ...item, site: item.site || site
    })));
  }
  const app = { readThread, extractForumThread, loadThread, refreshSavedCases, initialize,
    renderCases: () => casesView.renderCases() };
  const { activateTab } = views.createTabs({ document });
  const { renderThread } = views.createThreadView({ document, state, domain, saveAndRender });
  const { renderCalendar } = views.createCalendarView({ document, state, domain });
  const casesView = views.createCasesView({ document, state, domain, persistCases, renderThread, renderCalendar });
  const renderCases = () => casesView.renderCases();
  const { loadDiscord, loadTeams, loadReminders } = views.createSettingsController({ document, chrome, state,
    resolveSupportProfileDetails, syncProfileCases, loadSettings, loadAllCases, renderCases, renderThread });
  views.createReportController({ document, chrome, state, buildLeaveReport, buildHandoverCase,
    readThread: (url) => app.readThread(url), loadSettings, planAction, scopeThread: domain.scopeThread });

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || state.profileLoading || !state.supportAuthorId) return;
    const site = activeSite();
    const discordStatusKey = profileStorageKey(state.supportAuthorId, site, 'discord-status');
    const teamsStatusKey = profileStorageKey(state.supportAuthorId, site, 'teams-status');
    const syncStatusKey = profileStorageKey(state.supportAuthorId, site, 'activity-sync');
    if (changes[discordStatusKey])
      document.getElementById('discord-status').textContent = changes[discordStatusKey].newValue?.message || '';
    if (changes[teamsStatusKey])
      document.getElementById('teams-status').textContent = changes[teamsStatusKey].newValue?.message || '';
    if (changes[syncStatusKey])
      document.getElementById('activity-sync-status').textContent = changes[syncStatusKey].newValue?.message || '';
    const changedCaseKeys = ['learn', 'devcommunity'].map((site) => {
      const profileId = state.supportProfiles?.[site]?.id || (site === activeSite() ? state.supportAuthorId : '');
      return profileId ? profileStorageKey(profileId, site, 'cases') : null;
    }).filter(Boolean);
    if (changedCaseKeys.some((key) => changes[key])) {
      const threadSite = normalizeSupportSite(state.thread?.site || activeSite());
      const previous = state.cases.find((item) => item.id === state.thread?.id && item.site === threadSite);
      for (const site of ['learn', 'devcommunity']) {
        const profileId = state.supportProfiles?.[site]?.id || (site === activeSite() ? state.supportAuthorId : '');
        if (!profileId) continue;
        const key = profileStorageKey(profileId, site, 'cases');
        if (!changes[key]) continue;
        const updated = (changes[key].newValue || []).map((item) => ({ ...item, site: item.site || site }));
        state.cases = [...state.cases.filter((item) => item.site !== site), ...updated];
      }
      renderCases();
      const current = state.cases.find((item) => item.id === state.thread?.id && item.site === threadSite);
      if (state.thread && !state.refreshingCases && current && JSON.stringify(previous) !== JSON.stringify(current)) {
        if (current.error) message.textContent = `Last known thread data · Refresh failed: ${current.error}`;
        else loadThread(state.thread.url, null, false);
      } else if (state.thread && !state.profileLoading) renderThread();
    }
  });
  async function syncProfileCases() {
    const site = 'learn';
    const profileId = state.supportProfiles?.learn?.id;
    const status = document.getElementById('activity-sync-status');
    if (!profileId) {
      status.textContent = activeSite() === 'devcommunity'
        ? 'Developer Community threads are added manually. Save a Learn profile to discover Q&A activity.'
        : 'Save a Microsoft Learn profile link to discover recent Q&A activity.';
      return;
    }
    const key = profileStorageKey(profileId, site, 'profile-name');
    const activityKey = profileStorageKey(profileId, site, 'activity-sync');
    const stored = await chrome.storage.local.get([key, activityKey]);
    if (profileId !== state.supportProfiles?.learn?.id) return;
    status.textContent = stored[activityKey]?.message ||
      (stored[key] ? 'Checking recent Microsoft Learn activity...' : 'Save a Learn profile link to discover Q&A activity.');
    if (!stored[key]) return;
    try {
      const result = await chrome.runtime.sendMessage({ target: 'forum-discovery', profileId, site });
      if (result?.error) throw new Error(result.error);
      if (profileId !== state.supportProfiles?.learn?.id) return;
      status.textContent = result?.message || 'Profile activity checked.';
      state.cases = await loadAllCases();
      renderCases();
    } catch (error) {
      if (profileId === state.supportProfiles?.learn?.id) status.textContent = `Profile activity check failed: ${error.message}`;
    }
  }
  function validateUrl(value) {
    const url = new URL(value);
    const learnThread = url.hostname === 'learn.microsoft.com' &&
      /^\/[a-z]{2}-[a-z]{2}\/answers\/questions\/\d+(?:\/|$)/i.test(url.pathname);
    const communityThread = url.hostname === 'developercommunity.visualstudio.com' &&
      /^\/t\/(?:[^/]+\/)?\d+(?:\/|$)/i.test(url.pathname);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || (!learnThread && !communityThread))
      throw new Error('Use a Microsoft Learn Q&A or Developer Community thread link.');
    return url;
  }
  async function loadSettings(id, profileId = state.supportAuthorId, sourceSite = activeSite()) {
    const site = normalizeSupportSite(sourceSite);
    const scopedKey = threadStorageKey(profileId, site, id);
    const legacyKey = threadStorageKey(profileId, 'learn', id);
    const saved = await chrome.storage.local.get([scopedKey, legacyKey]);
    const current = saved[scopedKey];
    const legacy = saved[legacyKey];
    return { supportAuthorId: profileId, supportSite: site, actions: { ...(current?.actions || (!current && legacy?.supportAuthorId === profileId ? legacy.actions : {}) || {}) } };
  }
  async function saveAndRender(valueThread = state.thread, valueSettings = state.settings) {
    if (state.profileLoading || valueThread !== state.thread || valueSettings !== state.settings || valueSettings.supportAuthorId !== state.supportAuthorId) return;
    const site = normalizeSupportSite(valueSettings.supportSite || activeSite());
    const profileId = state.supportProfiles?.[site]?.id || state.supportAuthorId;
    const summary = caseSummary(valueThread, planAction(valueThread, valueSettings), new Date().toISOString(), profileId, valueSettings.actions);
    await persistCases({ type: 'correct', id: valueThread.id, summary,
      expected: state.cases.find((item) => item.id === valueThread.id && item.site === site), settings: valueSettings, site });
    if (valueThread === state.thread && valueSettings === state.settings) renderThread();
  }
  async function readThread(value, activeTab = null) {
    const url = validateUrl(value);
    let result;
    if (url.hostname === 'developercommunity.visualstudio.com') {
      const response = await chrome.runtime.sendMessage({ target: 'forum-thread-read', url: url.href });
      if (!response || response.error) throw new Error(response?.error || 'Developer Community reader is unavailable.');
      result = response.thread;
    } else if (activeTab !== null) {
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
    let url;
    try { url = validateUrl(value); }
    catch (error) { message.textContent = error.message; return; }
    const site = url.hostname === 'developercommunity.visualstudio.com' ? 'devcommunity' : 'learn';
    const profileId = state.supportProfiles?.[site]?.id || (site === activeSite() ? state.supportAuthorId : '');
    if (!profileId) {
      message.textContent = `Save your ${site === 'learn' ? 'Microsoft Learn' : 'Developer Community'} profile before opening this thread.`;
      return;
    }
    const expected = state.cases.find((item) => item.site === site &&
      (item.url === value || item.id === state.thread?.id && state.thread.url === value));
    try {
      message.textContent = 'Reading thread...';
      state.supportAuthorId = profileId;
      state.supportSite = site;
      await chrome.storage.local.set({ supportAuthorId: profileId, supportSite: site });
      const loaded = await app.readThread(value, activeTab);
      const loadedSettings = await loadSettings(loaded.id, profileId, site);
      if (request !== state.threadRequest || profileId !== state.supportAuthorId || state.profileLoading) return;
      state.thread = { ...loaded, site };
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
    const target = change.site || change.summary?.site || change.expected?.site ||
      state.cases.find((item) => item.id === change.id)?.site || activeSite();
    const site = normalizeSupportSite(target);
    const profileId = state.supportProfiles?.[site]?.id || (site === activeSite() ? state.supportAuthorId : '');
    if (!profileId) throw new Error(`Save the ${site === 'learn' ? 'Microsoft Learn' : 'Developer Community'} profile first.`);
    const result = await chrome.runtime.sendMessage({ target: 'forum-case-store', profileId, site, ...change });
    if (!result || result.error) throw new Error(result?.error || 'Case storage is unavailable.');
    if (!state.profileLoading) {
      state.cases = await loadAllCases();
      renderCases();
    }
    return result;
  }
  async function updateSavedCase(expected) {
    const { thread, settings, supportAuthorId } = state;
    const site = normalizeSupportSite(settings.supportSite || activeSite());
    const profileId = state.supportProfiles?.[site]?.id || supportAuthorId;
    const summary = caseSummary(thread, planAction(thread, settings), new Date().toISOString(), profileId, settings.actions);
    await persistCases({ type: 'update', id: thread.id, expected, summary, thread, site });
  }
  document.getElementById('url-form').addEventListener('submit', (event) => {
    event.preventDefault();
    loadThread(document.getElementById('thread-url').value);
  });
  document.getElementById('save-case').addEventListener('click', async () => {
    const { profileLoading, supportAuthorId, thread, settings, cases } = state;
    const site = activeSite();
    if (profileLoading || !supportAuthorId || !thread || cases.some((item) => item.id === thread.id && item.site === site)) return;
    const profileId = state.supportProfiles?.[site]?.id || supportAuthorId;
    const summary = caseSummary(thread, planAction(thread, settings), new Date().toISOString(), profileId, settings.actions);
    await persistCases({ type: 'add', id: thread.id, summary, thread, site });
    renderThread();
  });
  document.getElementById('refresh-thread').addEventListener('click', () => {
    if (state.thread) return loadThread(state.thread.url);
  });
  async function refreshSavedCases(failedOnly = false) {
    if (state.refreshingCases || state.profileLoading || !state.cases.length) return;
    const selected = state.cases.filter((item) => !failedOnly || item.error);
    if (!selected.length) return;
    state.refreshingCases = true;
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
        const site = normalizeSupportSite(saved.site || 'learn');
        const profileId = state.supportProfiles?.[site]?.id || (site === activeSite() ? state.supportAuthorId : '');
        if (!profileId) { skipped++; continue; }
        message.textContent = `Checking ${index + 1}/${selected.length} · ${caseTitle(saved)}`;
        try {
          const updated = await app.readThread(saved.url);
          if (updated.id !== saved.id) throw new Error('The link redirected to a different Q&A case.');
          const savedSettings = await loadSettings(updated.id, profileId, site);
          if (state.thread?.id === updated.id && state.thread?.site === site && request === state.threadRequest && !state.profileLoading) {
            state.thread = updated;
            state.settings = savedSettings;
            renderThread();
          }
          const summary = caseSummary(updated, planAction(updated, savedSettings), new Date().toISOString(), profileId, savedSettings.actions);
          const result = await persistCases({ type: 'update', id: saved.id, expected: saved, summary, thread: updated, site });
          if (result.applied) succeeded++;
          else skipped++;
        } catch (error) {
          const result = await persistCases({ type: 'update', id: saved.id, expected: saved,
            summary: { ...saved, error: error.message }, site });
          if (result.applied) failed++;
          else skipped++;
        }
        progress.value = index + 1;
      }
      message.textContent = `Checked ${selected.length} case(s): ${succeeded} updated, ${failed} failed${skipped ? `, ${skipped} skipped (removed, changed, or missing profile)` : ''}.` +
        (failed ? ' Open My Cases to view errors or retry failed cases.' : '');
    } catch (error) {
      message.textContent = `Refresh interrupted: ${error.message}`;
    } finally {
      progress.hidden = true;
      state.refreshingCases = false;
      renderCases();
    }
  }
  document.getElementById('refresh-cases').addEventListener('click', () => refreshSavedCases());
  document.getElementById('retry-cases').addEventListener('click', () => refreshSavedCases(true));
  async function initialize() {
    const stored = await chrome.storage.local.get(['supportAuthorId', 'supportSite', 'supportProfiles']);
    if (state.profileLoading) return;
    state.supportProfiles = { ...(stored.supportProfiles || {}) };
    if (stored.supportAuthorId && !state.supportProfiles.learn && !state.supportProfiles.devcommunity) {
      state.supportProfiles.learn = { id: stored.supportAuthorId, username: stored[`profile-name-${stored.supportAuthorId}`] || '' };
    }
    state.supportAuthorId = stored.supportAuthorId || state.supportProfiles.learn?.id || state.supportProfiles.devcommunity?.id || '';
    const fallbackSite = stored.supportSite || (state.supportProfiles.devcommunity && !state.supportProfiles.learn ? 'devcommunity' : 'learn');
    state.supportSite = normalizeSupportSite(fallbackSite);
    document.getElementById('profile-input').value = state.supportProfiles.learn?.id || state.supportAuthorId || '';
    document.getElementById('profile-input-devcommunity').value = state.supportProfiles.devcommunity?.id || '';
    const profileLabel = state.supportProfiles.learn?.id || state.supportProfiles.devcommunity?.id || state.supportAuthorId || 'Not set';
    document.getElementById('profile-label').textContent = profileLabel;
    document.getElementById('profile-section').open = !state.supportAuthorId;
    if (!state.supportAuthorId) activateTab('settings');
    state.cases = await loadAllCases();
    await loadReminders();
    await loadDiscord();
    await loadTeams();
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
