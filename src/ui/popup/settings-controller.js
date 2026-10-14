function createSettingsController({ document, chrome, state, resolveSupportProfileDetails, syncProfileCases, loadSettings, casesKey, renderCases, renderThread }) {
  const reminderInput = document.getElementById('desktop-reminders');
  async function loadDiscord() {
    const profileId = state.supportAuthorId;
    const stored = await chrome.storage.local.get([`discord-${profileId}`, `discord-status-${profileId}`]);
    if (profileId !== state.supportAuthorId) return;
    const config = stored[`discord-${profileId}`];
    document.getElementById('discord-webhook').value = config?.webhook || '';
    document.getElementById('discord-enabled').checked = !!config?.enabled;
    document.getElementById('discord-excerpt').checked = !!config?.includeExcerpt;
    document.getElementById('discord-save').disabled = !profileId;
    document.getElementById('discord-test').disabled = !profileId || !config?.webhook;
    document.getElementById('discord-status').textContent = stored[`discord-status-${profileId}`]?.message || 'Discord is not configured.';
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
    const stored = await chrome.storage.local.get([`teams-${profileId}`, `teams-status-${profileId}`]);
    if (profileId !== state.supportAuthorId) return;
    const config = stored[`teams-${profileId}`];
    document.getElementById('teams-webhook').value = config?.webhook || '';
    document.getElementById('teams-enabled').checked = !!config?.enabled;
    document.getElementById('teams-save').disabled = !profileId;
    document.getElementById('teams-test').disabled = !profileId || !config?.webhook;
    document.getElementById('teams-status').textContent = stored[`teams-status-${profileId}`]?.message || 'Teams is not configured.';
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
    reminderInput.disabled = !state.supportAuthorId;
    reminderInput.checked = state.supportAuthorId ? !!(await chrome.storage.local.get(`reminders-${state.supportAuthorId}`))[`reminders-${state.supportAuthorId}`] : false;
  }
  reminderInput.addEventListener('change', async () => {
    if (state.supportAuthorId) await chrome.storage.local.set({ [`reminders-${state.supportAuthorId}`]: reminderInput.checked });
  });
  document.getElementById('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.profileLoading) return;
    try {
      state.profileLoading = true;
      document.getElementById('message').textContent = 'Checking Microsoft Learn profile...';
      const profile = await resolveSupportProfileDetails(document.getElementById('profile-input').value);
      const nextId = profile.id;
      ++state.threadRequest;
      document.getElementById('thread').hidden = true;
      document.getElementById('save-case').disabled = true;
      state.supportAuthorId = nextId;
      await chrome.storage.local.set({ supportAuthorId: nextId,
        ...(profile.username ? { [`profile-name-${nextId}`]: profile.username } : {}) });
      await loadReminders();
      await loadDiscord();
      await loadTeams();
      document.getElementById('profile-label').textContent = nextId;
      document.getElementById('profile-section').open = false;
      state.cases = (await chrome.storage.local.get(casesKey()))[casesKey()] || [];
      if (state.thread) state.settings = await loadSettings(state.thread.id, nextId);
      state.profileLoading = false;
      renderCases();
      if (state.thread) renderThread();
      document.getElementById('message').textContent = 'Support profile saved on this device.';
      await syncProfileCases();
    } catch (error) {
      state.profileLoading = false;
      document.getElementById('message').textContent = error.message;
    }
  });
  return { loadDiscord, loadTeams, loadReminders };
}
