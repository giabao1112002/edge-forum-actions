function createSettingsController({ document, chrome, state, resolveSupportProfileDetails, syncProfileCases, loadSettings, loadAllCases, renderCases, renderThread }) {
  const reminderInput = document.getElementById('desktop-reminders');
  const activeSite = () => normalizeSupportSite(state.supportSite || 'learn');
  async function loadDiscord() {
    const profileId = state.supportAuthorId;
    const site = activeSite();
    const configKey = profileStorageKey(profileId, site, 'discord');
    const statusKey = profileStorageKey(profileId, site, 'discord-status');
    const stored = await chrome.storage.local.get([configKey, statusKey]);
    if (profileId !== state.supportAuthorId) return;
    const config = stored[configKey];
    document.getElementById('discord-webhook').value = config?.webhook || '';
    document.getElementById('discord-enabled').checked = !!config?.enabled;
    document.getElementById('discord-excerpt').checked = !!config?.includeExcerpt;
    document.getElementById('discord-save').disabled = !profileId;
    document.getElementById('discord-test').disabled = !profileId || !config?.webhook;
    document.getElementById('discord-status').textContent = stored[statusKey]?.message || 'Discord is not configured.';
  }
  async function discordAction(type) {
    if (!state.supportAuthorId || state.profileLoading) return;
    const profileId = state.supportAuthorId;
    const status = document.getElementById('discord-status');
    document.getElementById('discord-save').disabled = true;
    document.getElementById('discord-test').disabled = true;
    status.textContent = type === 'test' ? 'Sending test notification...' : 'Saving...';
    try {
      const response = await chrome.runtime.sendMessage({ target: 'forum-discord', type, profileId,
        settings: { webhook: document.getElementById('discord-webhook').value,
          enabled: document.getElementById('discord-enabled').checked,
          includeExcerpt: document.getElementById('discord-excerpt').checked } });
      if (!response?.ok) throw new Error(response?.error || 'Discord settings could not be processed.');
      await loadDiscord();
    } catch (error) {
      if (profileId === state.supportAuthorId) {
        await loadDiscord();
        status.textContent = error.message;
      }
    }
  }
  document.getElementById('discord-form').addEventListener('submit', (event) => {
    event.preventDefault();
    return discordAction('configure');
  });
  document.getElementById('discord-test').addEventListener('click', () => discordAction('test'));
  async function loadTeams() {
    const profileId = state.supportAuthorId;
    const site = activeSite();
    const configKey = profileStorageKey(profileId, site, 'teams');
    const statusKey = profileStorageKey(profileId, site, 'teams-status');
    const stored = await chrome.storage.local.get([configKey, statusKey]);
    if (profileId !== state.supportAuthorId) return;
    const config = stored[configKey];
    document.getElementById('teams-webhook').value = config?.webhook || '';
    document.getElementById('teams-enabled').checked = !!config?.enabled;
    document.getElementById('teams-save').disabled = !profileId;
    document.getElementById('teams-test').disabled = !profileId || !config?.webhook;
    document.getElementById('teams-status').textContent = stored[statusKey]?.message || 'Teams is not configured.';
  }
  async function teamsAction(type) {
    if (!state.supportAuthorId || state.profileLoading) return;
    const profileId = state.supportAuthorId;
    const status = document.getElementById('teams-status');
    document.getElementById('teams-save').disabled = true;
    document.getElementById('teams-test').disabled = true;
    status.textContent = type === 'test' ? 'Sending test notification...' : 'Saving...';
    try {
      const response = await chrome.runtime.sendMessage({ target: 'forum-teams', type, profileId,
        settings: { webhook: document.getElementById('teams-webhook').value,
          enabled: document.getElementById('teams-enabled').checked } });
      if (!response?.ok) throw new Error(response?.error || 'Teams settings could not be processed.');
      await loadTeams();
    } catch (error) {
      if (profileId === state.supportAuthorId) {
        await loadTeams();
        status.textContent = error.message;
      }
    }
  }
  document.getElementById('teams-form').addEventListener('submit', (event) => {
    event.preventDefault();
    return teamsAction('configure');
  });
  document.getElementById('teams-test').addEventListener('click', () => teamsAction('test'));
  async function loadReminders() {
    const site = activeSite();
    const reminderKey = profileStorageKey(state.supportAuthorId, site, 'reminders');
    reminderInput.disabled = !state.supportAuthorId;
    const stored = state.supportAuthorId ? await chrome.storage.local.get(reminderKey) : {};
    reminderInput.checked = state.supportAuthorId ? !!stored[reminderKey] : false;
  }
  reminderInput.addEventListener('change', async () => {
    if (state.supportAuthorId) {
      const reminderKey = profileStorageKey(state.supportAuthorId, activeSite(), 'reminders');
      await chrome.storage.local.set({ [reminderKey]: reminderInput.checked });
    }
  });
  async function saveProfileForSite(site, rawInput) {
    if (!rawInput?.trim()) return;
    const inputValue = String(rawInput).trim();
    const nextSite = normalizeSupportSite(site || 'learn');
    state.profileLoading = true;
    document.getElementById('message').textContent = nextSite === 'devcommunity'
      ? 'Checking Developer Community profile...'
      : 'Checking Microsoft Learn profile...';
    try {
      const profile = await resolveSupportProfileDetails(inputValue, globalThis.fetch, nextSite);
      const nextId = profile.id;
      const profiles = { ...(state.supportProfiles || {}) };
      profiles[nextSite] = { id: nextId, username: profile.username || '' };
      state.supportProfiles = profiles;
      state.supportAuthorId = nextId;
      state.supportSite = nextSite;
      await chrome.storage.local.set({
        supportProfiles: profiles,
        supportAuthorId: nextId,
        supportSite: nextSite,
        ...(profile.username ? { [profileStorageKey(nextId, nextSite, 'profile-name')]: profile.username } : {})
      });
      document.getElementById('desktop-reminders').checked = false;
      reminderInput.checked = false;
      await loadReminders();
      await loadDiscord();
      await loadTeams();
      const nextLabel = profiles.learn?.id || profiles.devcommunity?.id || nextId || 'Not set';
      document.getElementById('profile-label').textContent = nextLabel;
      document.getElementById('profile-section').open = false;
      state.cases = await loadAllCases();
      if (state.thread) state.settings = await loadSettings(state.thread.id, nextId);
      document.getElementById('message').textContent = 'Support profile saved on this device.';
      renderCases();
      if (state.thread) renderThread();
      await syncProfileCases();
    } catch (error) {
      document.getElementById('message').textContent = error.message;
      if (!state.supportAuthorId && state.supportProfiles?.learn?.id) {
        state.supportAuthorId = state.supportProfiles.learn.id;
      }
    } finally {
      state.profileLoading = false;
      renderCases();
      if (state.thread) renderThread();
    }
  }

  document.getElementById('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const learnValue = document.getElementById('profile-input')?.value || '';
    const devValue = document.getElementById('profile-input-devcommunity')?.value || '';
    if (learnValue.trim()) await saveProfileForSite('learn', learnValue);
    if (devValue.trim() && devValue.trim() !== learnValue.trim()) await saveProfileForSite('devcommunity', devValue);
  });
  const saveLearnButton = document.getElementById('profile-save-learn');
  if (saveLearnButton) saveLearnButton.addEventListener('click', async () => {
    await saveProfileForSite('learn', document.getElementById('profile-input').value);
  });
  const saveDevButton = document.getElementById('profile-save-devcommunity');
  if (saveDevButton) saveDevButton.addEventListener('click', async () => {
    await saveProfileForSite('devcommunity', document.getElementById('profile-input-devcommunity').value);
  });
  return { loadDiscord, loadTeams, loadReminders };
}
