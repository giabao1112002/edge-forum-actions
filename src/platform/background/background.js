importScripts('../../core/engine.js', '../../features/cases/dashboard.js',
  '../../features/cases/case-store.js', '../../features/profile/profile.js',
  '../../features/profile/activity.js', '../../features/discord/discord.js', '../../features/teams/teams.js');

const alarmName = 'check-saved-cases';
const changeCase = createCaseStore(chrome.storage.local);
const discord = createDiscordNotifier(chrome.storage.local, (...args) => fetch(...args), scopeThread);
const teams = createTeamsNotifier(chrome.storage.local, (...args) => fetch(...args), scopeThread);
let creatingParser;
let refreshing;
let discovering;
let discoveringSource;

function configuredProfileId(stored, site) {
  return stored.supportProfiles?.[site]?.id ||
    (normalizeSupportSite(stored.supportSite || 'learn') === site ? stored.supportAuthorId : '');
}

async function profileIsConfigured(profileId, site) {
  const stored = await chrome.storage.local.get(['supportAuthorId', 'supportSite', 'supportProfiles']);
  return configuredProfileId(stored, site) === profileId;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.target === 'forum-discovery') {
    if (typeof message.profileId !== 'string') return;
    discoverSavedCases(message.profileId, message.site).then(respond, (error) => respond({ error: error.message }));
    return true;
  }
  if (message.target === 'forum-thread-read') {
    if (typeof message.url !== 'string') return;
    parserMessage('read', message.url).then(respond, (error) => respond({ error: error.message }));
    return true;
  }
  if (message.target === 'forum-discord' || message.target === 'forum-teams') {
    if (typeof message.profileId !== 'string') return;
    const notifier = message.target === 'forum-teams' ? teams : discord;
    const task = message.type === 'configure' ? notifier.configure(message.profileId, message.settings)
      : message.type === 'test' ? notifier.test(message.profileId) : null;
    if (!task) return;
    task.then(respond, (error) => respond({ error: error.message }));
    return true;
  }
  if (message.target !== 'forum-case-store') return;
  if (!['add', 'remove', 'update', 'correct'].includes(message.type) ||
      typeof message.profileId !== 'string' || typeof message.id !== 'string') return;
  changeCase(message).then(async (result) => {
    if (message.thread && ['add', 'update'].includes(message.type))
      await Promise.allSettled([discord.observe(message.profileId, message.thread, message.summary, message.site),
        teams.observe(message.profileId, message.thread, message.site)]);
    respond(result);
  }, () => respond({ error: 'Case storage could not be updated.' }));
  return true;
});

async function ensureParser() {
  if (!creatingParser) {
    creatingParser = (async () => {
      const url = chrome.runtime.getURL('src/platform/offscreen/offscreen.html');
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
      if (!contexts.length) await chrome.offscreen.createDocument({ url: 'src/platform/offscreen/offscreen.html',
        reasons: ['DOM_PARSER'], justification: 'Read saved Q&A threads to calculate action reminders.' });
    })().finally(() => { creatingParser = null; });
  }
  await creatingParser;
}

async function parserMessage(type, url) {
  await ensureParser();
  const answer = await chrome.runtime.sendMessage({ target: 'forum-parser', type, url });
  if (answer?.error) throw new Error(answer.error);
  if (!answer) throw new Error('Thread parser is unavailable.');
  return answer;
}

async function updateBadge() {
  const stored = await chrome.storage.local.get(['supportAuthorId', 'supportSite', 'supportProfiles']);
  const sites = ['learn', 'devcommunity'].filter((site) => configuredProfileId(stored, site));
  const keys = sites.map((site) => profileStorageKey(configuredProfileId(stored, site), site, 'cases'));
  const saved = keys.length ? await chrome.storage.local.get(keys) : {};
  const cases = keys.flatMap((key) => saved[key] || []);
  const attention = cases.filter((item) => item.due && ['reply', 'urgent', 'today', 'overdue'].includes(todayActivity(item)));
  await chrome.action.setBadgeText({ text: attention.length ? String(attention.length) : '' });
  await chrome.action.setTitle({ title: attention.length ? `${attention.length} saved case(s) need action (last known status)` : 'Forum Action Planner' });
  if (attention.length) await chrome.action.setBadgeBackgroundColor({ color: attention.some((item) =>
    ['urgent', 'overdue'].includes(todayActivity(item))) ? '#d76154' : '#b37400' });
}

async function notifyDueCases(profileId, cases, sourceSite = 'learn') {
  const site = normalizeSupportSite(sourceSite);
  const reminderKey = profileStorageKey(profileId, site, 'reminders');
  const notifiedKey = profileStorageKey(profileId, site, 'notified');
  const { [reminderKey]: enabled, [notifiedKey]: history } =
    await chrome.storage.local.get([reminderKey, notifiedKey]);
  if (!enabled) return;
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const due = cases.filter((item) => !item.error && item.due &&
    ['reply', 'urgent', 'today', 'overdue'].includes(todayActivity(item, now)));
  const alerted = history?.day === day ? history.keys || [] : [];
  let fresh = due.filter((item) => !alerted.includes(`${item.id}:${item.action}:${item.due}`));
  if (!fresh.length) return;
  const { iconUrl } = await parserMessage('icon');
  const current = await chrome.storage.local.get(['supportAuthorId', 'supportSite', 'supportProfiles',
    profileStorageKey(profileId, site, 'cases'), reminderKey]);
  if (configuredProfileId(current, site) !== profileId || !current[reminderKey]) return;
  fresh = fresh.filter((item) => (current[profileStorageKey(profileId, site, 'cases')] || []).some((saved) =>
    saved.id === item.id && !saved.error && saved.action === item.action && saved.due === item.due));
  if (!fresh.length) return;
  const notificationId = site === 'learn' ? `forum-due-${profileId}` : `forum-due-${site}-${profileId}`;
  await chrome.notifications.create(notificationId, {
    type: 'basic', iconUrl, title: `${fresh.length} case(s) need action`,
    message: fresh.slice(0, 2).map((item) => `${caseTitle(item)}: ${item.action}`).join('\n') +
      (fresh.length > 2 ? `\nAnd ${fresh.length - 2} more. Open My Cases to review.` : '')
  });
  await chrome.storage.local.set({ [notifiedKey]: {
    day, keys: [...alerted, ...fresh.map((item) => `${item.id}:${item.action}:${item.due}`)]
  } });
}

async function discoverSavedCases(profileId, sourceSite) {
  const initial = await chrome.storage.local.get('supportSite');
  const site = normalizeSupportSite(sourceSite || initial.supportSite || 'learn');
  const discoverySource = `${site}:${profileId}`;
  if (discovering) {
    if (discoveringSource === discoverySource) return discovering;
    await discovering.catch(() => {});
  }
  discoveringSource = discoverySource;
  discovering = (async () => {
    const profileKey = profileStorageKey(profileId, site, 'profile-name');
    const statusKey = profileStorageKey(profileId, site, 'activity-sync');
    const casesKey = profileStorageKey(profileId, site, 'cases');
    const ignoredKey = profileStorageKey(profileId, site, 'ignored-cases');
    const username = (await chrome.storage.local.get(profileKey))[profileKey];
    if (!username) return { message: 'Save a profile link to discover cases automatically.' };
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(username)) throw new Error('Saved profile name is invalid. Save the profile link again.');
    let added = 0;
    let skipped = 0;
    try {
      const now = new Date();
      const cutoff = now.getTime() - 30 * 86400000;
      const links = new Map();
      let totalPages = 1;
      let partial = false;
      for (let page = 1; page <= totalPages && page <= 20; page++) {
        const url = `https://learn.microsoft.com/api/profiles/${encodeURIComponent(username)}/newactivity?page=${page}&pageSize=30&locale=en-us`;
        const response = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'error',
          signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Profile activity request failed (HTTP ${response.status}).`);
        const feed = await response.json();
        for (const link of activityThreadLinks(feed, profileId, now)) links.set(link.id, link);
        totalPages = Number.isInteger(feed.totalPages) && feed.totalPages > 0 ? feed.totalPages : 1;
        const dates = feed.items.map((item) => Date.parse(item.timestamp)).filter(Number.isFinite);
        if (dates.length && Math.min(...dates) < cutoff) break;
        if (page === 20 && page < totalPages) partial = true;
      }
      for (const link of links.values()) {
        if (!await profileIsConfigured(profileId, site)) break;
        const existing = await chrome.storage.local.get([casesKey, ignoredKey]);
        if ((existing[casesKey] || []).some((item) => item.id === link.id) ||
            (existing[ignoredKey] || []).includes(link.id)) continue;
        try {
          const { thread } = await parserMessage('read', link.url);
          if (thread.id !== link.id || !thread.entries.some((entry) =>
            ['answer', 'comment'].includes(entry.type) && entry.authorId === profileId)) { skipped++; continue; }
          const correctionKey = threadStorageKey(profileId, site, thread.id);
          const legacyKey = threadStorageKey(profileId, 'learn', thread.id);
          const settings = await chrome.storage.local.get([correctionKey, legacyKey]);
          const correction = settings[correctionKey] ||
            (settings[legacyKey]?.supportAuthorId === profileId ? settings[legacyKey] : null);
          const actions = correction?.actions || {};
          const summary = caseSummary(thread, planAction(thread, { supportAuthorId: profileId, actions }),
            new Date().toISOString(), profileId, actions);
          if (!await profileIsConfigured(profileId, site)) break;
          const result = await changeCase({ type: 'add', source: 'activity', profileId, id: link.id, summary, site });
          if (result.applied) added++;
        } catch { skipped++; }
      }
      const message = `Profile activity checked: ${added} new case(s) added${skipped ? `, ${skipped} skipped` : ''}${partial ? '; older activity may be missing' : ''}.`;
      if (await profileIsConfigured(profileId, site))
        await chrome.storage.local.set({ [statusKey]: { message, checkedAt: new Date().toISOString() } });
      return { added, skipped, message };
    } catch (error) {
      if (await profileIsConfigured(profileId, site))
        await chrome.storage.local.set({ [statusKey]: { message: `Profile activity check failed: ${error.message}`,
          checkedAt: new Date().toISOString() } });
      throw error;
    }
  })().finally(() => { discovering = null; discoveringSource = null; });
  return discovering;
}

async function refreshSavedCases() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const stored = await chrome.storage.local.get(['supportAuthorId', 'supportSite', 'supportProfiles']);
    const activeSite = normalizeSupportSite(stored.supportSite || 'learn');
    const sources = ['learn', 'devcommunity'].map((site) => ({ site, profileId: configuredProfileId(stored, site) }))
      .filter((source) => source.profileId);
    if (!sources.length && stored.supportAuthorId) sources.push({ site: activeSite, profileId: stored.supportAuthorId });
    if (!sources.length) return;
    for (const { site, profileId } of sources) {
      if (site === 'learn') await discoverSavedCases(profileId, site).catch(console.error);
      const key = profileStorageKey(profileId, site, 'cases');
      const original = (await chrome.storage.local.get(key))[key] || [];
      const checked = [];
      for (const saved of original) {
        if (!await profileIsConfigured(profileId, site)) break;
        let summary;
        let observedThread;
        try {
          const { thread } = await parserMessage('read', saved.url);
          observedThread = thread;
          if (thread.id !== saved.id) throw new Error('The link redirected to a different forum case.');
          const correctionKey = threadStorageKey(profileId, site, thread.id);
          const legacyKey = threadStorageKey(profileId, 'learn', thread.id);
          const settings = await chrome.storage.local.get([correctionKey, legacyKey]);
          const correction = settings[correctionKey] ||
            (site === 'learn' && settings[legacyKey]?.supportAuthorId === profileId ? settings[legacyKey] : null);
          summary = caseSummary(thread, planAction(thread, { supportAuthorId: profileId, actions: correction?.actions || {} }),
            new Date().toISOString(), profileId, correction?.actions || {});
        } catch (error) {
          summary = { ...saved, error: error.message };
        }
        if (!await profileIsConfigured(profileId, site)) break;
        const result = await changeCase({ type: 'update', profileId, id: saved.id, expected: saved, summary, site });
        if (result.applied) checked.push(summary);
        if (observedThread && !summary.error && observedThread.id === saved.id)
          await Promise.allSettled([discord.observe(profileId, observedThread, summary, site),
            teams.observe(profileId, observedThread, site)]);
      }
      if (await profileIsConfigured(profileId, site)) await notifyDueCases(profileId, checked, site);
    }
    await updateBadge();
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function start() {
  const alarm = await chrome.alarms.get(alarmName);
  if (alarm?.periodInMinutes !== 5) await chrome.alarms.create(alarmName, { periodInMinutes: 5 });
  await updateBadge();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === alarmName) refreshSavedCases().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => refreshSavedCases().catch(console.error));
chrome.runtime.onInstalled.addListener(() => refreshSavedCases().catch(console.error));
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('forum-due-')) chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/popup/popup.html') });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('supportAuthorId' in changes || Object.keys(changes).some((key) => key.startsWith('cases-')))
    updateBadge().catch(console.error);
  if (Object.entries(changes).some(([key, change]) => key.startsWith('reminders-') && change.newValue === true))
    refreshSavedCases().catch(console.error);
});
start().catch(console.error);
