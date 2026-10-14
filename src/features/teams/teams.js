function normalizeSupportSite(site = 'learn') {
  const value = String(site || 'learn').trim().toLowerCase();
  if (!value || value === 'learn' || value === 'microsoft learn' || value === 'microsoftlearn') return 'learn';
  if (['devcommunity', 'devcomm', 'developer community', 'developercommunity', 'developercommunity.visualstudio.com'].includes(value)) return 'devcommunity';
  return 'learn';
}

function profileStorageKey(profileId, site = 'learn', name = 'cases') {
  const targetSite = normalizeSupportSite(site);
  const value = String(profileId || '').trim();
  if (!value) return `${name}-${targetSite}`;
  return targetSite === 'learn' ? `${name}-${value}` : `${name}-${targetSite}-${value}`;
}

function validateTeamsWebhook(value) {
  try {
    const url = new URL(String(value).trim());
    const host = url.hostname.toLowerCase();
    const microsoftHost = host.endsWith('.logic.azure.com') || host.endsWith('.api.powerplatform.com');
    const workflowPath = /(?:^|\/)workflows\/[a-f0-9-]+\/triggers\/[^/]+\/paths\/invoke\/?$/i.test(url.pathname);
    if (url.protocol !== 'https:' || !microsoftHost || !workflowPath || url.port ||
        url.username || url.password || url.hash || !url.searchParams.get('sig')) throw new Error();
    return url.href;
  } catch { throw new Error('Paste the webhook URL from your Teams Workflows "Send webhook alerts to a chat" workflow.'); }
}

function teamsCard(title, lines, link = '') {
  const card = { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.2',
    body: [{ type: 'TextBlock', text: title, weight: 'Bolder', wrap: true },
      ...lines.map((text) => ({ type: 'TextBlock', text, wrap: true }))] };
  if (link) card.actions = [{ type: 'Action.OpenUrl', title: 'Open thread', url: link }];
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }] };
}

function teamsThreadLink(thread, entryId) {
  try {
    const url = new URL(thread.url);
    const learnThread = url.hostname === 'learn.microsoft.com' &&
      /^\/[a-z]{2}-[a-z]{2}\/answers\/questions\/\d+(?:\/|$)/i.test(url.pathname);
    const communityThread = url.hostname === 'developercommunity.visualstudio.com' &&
      /^\/t\/(?:[^/]+\/)?\d+(?:\/|$)/i.test(url.pathname);
    if (url.protocol === 'https:' && (learnThread || communityThread))
      return `${url.origin}${url.pathname}#${encodeURIComponent(entryId)}`;
  } catch {}
  return '';
}

function createTeamsNotifier(storage, request, scope) {
  let pending = Promise.resolve();
  const enqueue = (task) => {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  };
  async function send(webhook, card) {
    try {
      const response = await request(validateTeamsWebhook(webhook), { method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify(card) });
      if (response.status === 429) {
        const seconds = Number(response.headers?.get?.('Retry-After'));
        const error = new Error('Teams rate limit reached. Retry on a later check.');
        error.retryAt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 300) * 1000;
        throw error;
      }
      if (!response.ok) throw new Error(`Teams Workflow request failed (HTTP ${response.status}). Check the workflow run history and chat permissions.`);
    } catch (error) {
      if (error.retryAt || /^Teams Workflow request failed/.test(error.message)) throw error;
      throw new Error('Teams Workflow could not be reached. Check the connection and workflow; retry on a later check.');
    }
  }
  return {
    configure: (profileId, settings) => enqueue(async () => {
      const site = normalizeSupportSite((await storage.get('supportSite')).supportSite || 'learn');
      const webhook = settings.webhook ? validateTeamsWebhook(settings.webhook) : '';
      if (settings.enabled && !webhook) throw new Error('Enter a Teams Workflow webhook before enabling Teams.');
      const key = profileStorageKey(profileId, site, 'teams');
      const old = (await storage.get(key))[key];
      const config = { enabled: !!settings.enabled, webhook };
      const reset = !old || old.webhook !== webhook || old.enabled !== config.enabled;
      await storage.set({ [key]: config, [profileStorageKey(profileId, site, 'teams-status')]: { message: config.enabled
        ? 'Enabled. The first check establishes a baseline; old replies and accepted answers will not be sent.' : 'Teams is off.' },
      ...(reset ? { [profileStorageKey(profileId, site, 'teams-seen')]: {}, [profileStorageKey(profileId, site, 'teams-accepted')]: {} } : {}) });
      return { ok: true };
    }),
    test: (profileId) => enqueue(async () => {
      const site = normalizeSupportSite((await storage.get('supportSite')).supportSite || 'learn');
      const configKey = profileStorageKey(profileId, site, 'teams');
      const statusKey = profileStorageKey(profileId, site, 'teams-status');
      const config = (await storage.get(configKey))[configKey];
      if (!config?.webhook) throw new Error('Save a Teams Workflow webhook first.');
      try {
        await send(config.webhook, teamsCard('Test notification', ['Forum Action Planner is connected. No case data is included.']));
        await storage.set({ [statusKey]: { message: 'Workflow accepted the test request. Check the chat and run history.', sentAt: new Date().toISOString() } });
        return { ok: true };
      } catch (error) {
        await storage.set({ [statusKey]: { message: error.message, retryAt: error.retryAt || null } });
        throw error;
      }
    }),
    observe: (profileId, thread, sourceSite) => enqueue(async () => {
      const site = normalizeSupportSite(sourceSite || (await storage.get('supportSite')).supportSite || 'learn');
      const configKey = profileStorageKey(profileId, site, 'teams');
      const seenKey = profileStorageKey(profileId, site, 'teams-seen');
      const acceptedKey = profileStorageKey(profileId, site, 'teams-accepted');
      const statusKey = profileStorageKey(profileId, site, 'teams-status');
      const casesKey = profileStorageKey(profileId, site, 'cases');
      const stored = await storage.get(['supportAuthorId', 'supportSite', 'supportProfiles', configKey, seenKey, acceptedKey, statusKey, casesKey]);
      const config = stored[configKey];
      const configuredId = stored.supportProfiles?.[site]?.id ||
        (normalizeSupportSite(stored.supportSite || 'learn') === site ? stored.supportAuthorId : '');
      if (!config?.enabled || configuredId !== profileId ||
          !(stored[casesKey] || []).some((item) => item.id === thread.id)) return;
      const acceptedAnswer = thread.entries.find((entry) => entry.type === 'answer' &&
        entry.id === thread.acceptedAnswerId && entry.authorId === profileId);
      const acceptedHistory = stored[acceptedKey] || {};
      if (!Object.hasOwn(acceptedHistory, thread.id)) {
        acceptedHistory[thread.id] = acceptedAnswer ? [acceptedAnswer.id] : [];
        await storage.set({ [acceptedKey]: acceptedHistory });
      } else if (acceptedAnswer && !acceptedHistory[thread.id].includes(acceptedAnswer.id)) {
        if (stored[statusKey]?.retryAt > Date.now()) return;
        const current = await storage.get(['supportAuthorId', 'supportSite', 'supportProfiles', configKey, casesKey]);
        const currentId = current.supportProfiles?.[site]?.id ||
          (normalizeSupportSite(current.supportSite || 'learn') === site ? current.supportAuthorId : '');
        const savedCase = (current[casesKey] || []).find((item) => item.id === thread.id);
        if (currentId !== profileId || !current[configKey]?.enabled ||
            current[configKey].webhook !== config.webhook || !savedCase || savedCase.error) return;
        try {
          await send(config.webhook, teamsCard(`Your answer was accepted · Case ${thread.id}`,
            ['The question author accepted your answer. Verify CI closure separately.'],
            teamsThreadLink(thread, acceptedAnswer.id)));
          acceptedHistory[thread.id] = [...acceptedHistory[thread.id], acceptedAnswer.id];
          await storage.set({ [acceptedKey]: acceptedHistory, [statusKey]: {
            message: 'Workflow accepted the answer-acceptance notification. Check the chat and run history.',
            sentAt: new Date().toISOString() } });
        } catch (error) {
          await storage.set({ [statusKey]: { message: error.message, retryAt: error.retryAt || null } });
          return;
        }
      }
      if (thread.hasMorePages) return;
      const scoped = scope(thread, profileId);
      const customer = scoped.entries.find((item) => item.type === 'question')?.authorId;
      const firstAnswer = scoped.entries.find((item) => item.type === 'answer' && item.authorId === profileId);
      if (!customer || !firstAnswer || scoped.hasUnidentifiedAuthors) return;
      const replies = scoped.entries.filter((item) => item.type !== 'question' && item.authorId === customer &&
        Date.parse(item.timestamp) > Date.parse(firstAnswer.timestamp));
      const history = stored[seenKey] || {};
      if (!Object.hasOwn(history, thread.id)) {
        history[thread.id] = replies.map((item) => item.id);
        await storage.set({ [seenKey]: history });
        return;
      }
      if (stored[statusKey]?.retryAt > Date.now()) return;
      const fresh = [...new Map(replies.filter((item) => !history[thread.id].includes(item.id))
        .map((item) => [item.id, item])).values()];
      for (let index = 0; index < fresh.length; index += 10) {
        const current = await storage.get(['supportAuthorId', 'supportSite', 'supportProfiles', configKey, casesKey]);
        const currentId = current.supportProfiles?.[site]?.id ||
          (normalizeSupportSite(current.supportSite || 'learn') === site ? current.supportAuthorId : '');
        const savedCase = (current[casesKey] || []).find((item) => item.id === thread.id);
        if (currentId !== profileId || !current[configKey]?.enabled || current[configKey].webhook !== config.webhook ||
            !savedCase || savedCase.error) return;
        const batch = fresh.slice(index, index + 10);
        const link = teamsThreadLink(thread, batch[0].id);
        const card = teamsCard(`Customer replied · Case ${thread.id}`,
          [`${batch.length} new customer reply${batch.length === 1 ? '' : 's'} detected. Open the thread to read.`,
            `Next action: ${String(savedCase.action).slice(0, 120)}`, `Deadline: ${savedCase.due || 'Not calculated'}`], link);
        try {
          await send(config.webhook, card);
          history[thread.id] = [...new Set([...history[thread.id], ...batch.map((item) => item.id)])];
          await storage.set({ [seenKey]: history, [statusKey]: { message: 'Workflow accepted the reply notification. Check the chat and run history.', sentAt: new Date().toISOString() } });
        } catch (error) {
          await storage.set({ [statusKey]: { message: error.message, retryAt: error.retryAt || null } });
          return;
        }
      }
    })
  };
}

if (typeof module !== 'undefined') module.exports = { validateTeamsWebhook, teamsCard, createTeamsNotifier };
