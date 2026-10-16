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

function validateDiscordWebhook(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password ||
        !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.search || url.hash) throw new Error();
    return url.href;
  } catch { throw new Error('Use a Discord webhook URL from Channel Settings → Integrations → Webhooks.'); }
}

function createDiscordNotifier(storage, request, scope) {
  let pending = Promise.resolve();
  const enqueue = (task) => {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  };
  async function send(webhook, embeds) {
    try {
      const url = new URL(validateDiscordWebhook(webhook));
      url.searchParams.set('wait', 'true');
      const response = await request(url.href, { method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ username: 'Forum Action Planner', allowed_mentions: { parse: [] }, embeds }) });
      if (response.status === 429) {
        const body = await response.json().catch(() => ({}));
        const seconds = Number(body.retry_after);
        const error = new Error('Discord rate limit reached. Retry on a later check.');
        error.retryAt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 300) * 1000;
        throw error;
      }
      if (!response.ok) throw new Error(`Discord request failed (HTTP ${response.status}). Check the webhook and channel permissions.`);
    } catch (error) {
      if (error.retryAt || /^Discord request failed/.test(error.message)) throw error;
      throw new Error('Discord could not be reached. Check your connection and webhook; retry on a later check.');
    }
  }
  return {
    configure: (profileId, settings) => enqueue(async () => {
      const site = normalizeSupportSite((await storage.get('supportSite')).supportSite || 'learn');
      const webhook = settings.webhook ? validateDiscordWebhook(settings.webhook) : '';
      if (settings.enabled && !webhook) throw new Error('Enter a webhook before enabling Discord.');
      const key = profileStorageKey(profileId, site, 'discord');
      const old = (await storage.get(key))[key];
      const config = { enabled: !!settings.enabled, webhook, includeExcerpt: !!settings.includeExcerpt };
      const reset = !old || old.webhook !== webhook || old.enabled !== config.enabled;
      await storage.set({ [key]: config, [profileStorageKey(profileId, site, 'discord-status')]: { message: config.enabled
        ? 'Enabled. The first complete check of each case establishes a baseline; old replies will not be sent.' : 'Discord is off.' },
      ...(reset ? { [profileStorageKey(profileId, site, 'discord-seen')]: {} } : {}) });
      return { ok: true };
    }),
    test: (profileId) => enqueue(async () => {
      const site = normalizeSupportSite((await storage.get('supportSite')).supportSite || 'learn');
      const configKey = profileStorageKey(profileId, site, 'discord');
      const statusKey = profileStorageKey(profileId, site, 'discord-status');
      const config = (await storage.get(configKey))[configKey];
      if (!config?.webhook) throw new Error('Save a webhook first.');
      const previous = (await storage.get(statusKey))[statusKey];
      if (previous?.retryAt > Date.now()) throw new Error('Discord rate limit is active. Try again later.');
      try {
        await send(config.webhook, [{ title: 'Test notification', description: 'Forum Action Planner is connected. No case data is included.' }]);
        await storage.set({ [statusKey]: { message: 'Test notification sent.', sentAt: new Date().toISOString() } });
        return { ok: true };
      } catch (error) {
        await storage.set({ [statusKey]: { message: error.message, retryAt: error.retryAt || null } });
        throw error;
      }
    }),
    observe: (profileId, thread, summary, sourceSite) => enqueue(async () => {
      const site = normalizeSupportSite(sourceSite || (await storage.get('supportSite')).supportSite || 'learn');
      const configKey = profileStorageKey(profileId, site, 'discord');
      const seenKey = profileStorageKey(profileId, site, 'discord-seen');
      const statusKey = profileStorageKey(profileId, site, 'discord-status');
      const casesKey = profileStorageKey(profileId, site, 'cases');
      const stored = await storage.get(['supportAuthorId', 'supportSite', 'supportProfiles', configKey, seenKey, statusKey, casesKey]);
      const config = stored[configKey];
      const configuredId = stored.supportProfiles?.[site]?.id ||
        (normalizeSupportSite(stored.supportSite || 'learn') === site ? stored.supportAuthorId : '');
      if (!config?.enabled || configuredId !== profileId || thread.hasMorePages ||
          !(stored[casesKey] || []).some((item) => item.id === thread.id)) return;
      const scoped = scope(thread, profileId);
      const customer = scoped.entries.find((item) => item.type === 'question')?.authorId;
      const firstAnswer = scoped.entries.find((item) => item.type === 'answer' && item.authorId === profileId);
      if (!customer || !firstAnswer || scoped.hasUnidentifiedAuthors) return;
      const replies = scoped.entries.filter((item) => item.type !== 'question' &&
        (item.customerReply || item.authorId === customer) &&
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
        const embeds = batch.map((item) => ({ title: `CX replied · Case ${thread.id}`,
          url: `${thread.url}#${encodeURIComponent(item.id)}`,
          description: current[configKey].includeExcerpt ? String(item.excerpt || '(No excerpt available)').slice(0, 170) : 'A new customer reply was detected. Open the link to read it.',
          fields: [{ name: 'Next action', value: String(savedCase.action).slice(0, 1024) },
            { name: 'Final deadline', value: savedCase.due || 'Not calculated' }], timestamp: item.timestamp }));
        try {
          await send(config.webhook, embeds);
          history[thread.id] = [...new Set([...history[thread.id], ...batch.map((item) => item.id)])];
          await storage.set({ [seenKey]: history, [statusKey]: { message: 'Customer reply notification sent.', sentAt: new Date().toISOString() } });
        } catch (error) {
          await storage.set({ [statusKey]: { message: error.message, retryAt: error.retryAt || null } });
          return;
        }
      }
    })
  };
}
if (typeof module !== 'undefined') module.exports = { validateDiscordWebhook, createDiscordNotifier };
