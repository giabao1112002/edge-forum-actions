function createSettingsController({ document, chrome, state, parseSupportProfile, loadSettings, casesKey, renderCases, renderThread }) {
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
  async function loadReminders() {
    reminderInput.disabled = !state.supportAuthorId;
    reminderInput.checked = state.supportAuthorId ? !!(await chrome.storage.local.get(`reminders-${state.supportAuthorId}`))[`reminders-${state.supportAuthorId}`] : false;
  }
  reminderInput.addEventListener('change', async () => {
    if (state.supportAuthorId) await chrome.storage.local.set({ [`reminders-${state.supportAuthorId}`]: reminderInput.checked });
  });
  document.getElementById('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const nextId = parseSupportProfile(document.getElementById('profile-input').value);
      if (state.profileLoading) return;
      state.profileLoading = true;
      ++state.threadRequest;
      document.getElementById('thread').hidden = true;
      document.getElementById('save-case').disabled = true;
      state.supportAuthorId = nextId;
      await chrome.storage.local.set({ supportAuthorId: nextId });
      await loadReminders();
      await loadDiscord();
      document.getElementById('profile-label').textContent = nextId;
      document.getElementById('profile-section').open = false;
      state.cases = (await chrome.storage.local.get(casesKey()))[casesKey()] || [];
      if (state.thread) state.settings = await loadSettings(state.thread.id, nextId);
      state.profileLoading = false;
      renderCases();
      if (state.thread) renderThread();
      document.getElementById('message').textContent = 'Support profile saved on this device.';
    } catch (error) {
      state.profileLoading = false;
      document.getElementById('message').textContent = error.message;
    }
  });
  return { loadDiscord, loadReminders };
}
