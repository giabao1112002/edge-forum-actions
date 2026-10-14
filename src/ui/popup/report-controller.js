function createReportController({ document, chrome, state, buildLeaveReport, buildHandoverCase,
  readThread, loadSettings, planAction, scopeThread }) {
  let exporting = false;
  const status = document.getElementById('report-status');
  const button = document.getElementById('export-report');
  document.getElementById('report-start').addEventListener('change', () => {
    const start = document.getElementById('report-start').value;
    const end = document.getElementById('report-end');
    end.min = start;
    if (!end.value || end.value < start) end.value = start;
  });
  async function profileDisplayName(profileId) {
    const key = `profile-name-${profileId}`;
    const slug = (await chrome.storage.local.get(key))[key];
    if (!slug || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return '';
    try {
      const response = await fetch(`https://learn.microsoft.com/api/profiles/${encodeURIComponent(slug)}`,
        { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) return '';
      const profile = await response.json();
      return profile.userId?.toLowerCase() === profileId && typeof profile.displayName === 'string'
        ? profile.displayName.trim() : '';
    } catch { return ''; }
  }
  document.getElementById('report-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const { refreshingCases, profileLoading, supportAuthorId, cases } = state;
    if (exporting || refreshingCases || profileLoading || !supportAuthorId || !cases.length) {
      status.textContent = 'Save a case and wait for refresh/profile changes to finish before exporting.';
      return;
    }
    const start = document.getElementById('report-start').value;
    const end = document.getElementById('report-end').value;
    try {
      buildLeaveReport([], supportAuthorId, start, end);
      exporting = true;
      state.exportingReport = true;
      button.disabled = true;
      const ownerFallback = await profileDisplayName(supportAuthorId);
      const records = new Array(cases.length);
      let next = 0;
      let finished = 0;
      const worker = async () => {
        while (next < cases.length) {
          const index = next++;
          const saved = cases[index];
          if (state.supportAuthorId !== supportAuthorId || state.profileLoading)
            throw new Error('Support profile changed during export. Start the report again.');
          try {
            const thread = await readThread(saved.url);
            if (thread.id !== saved.id) throw new Error('The link redirected to a different Q&A case.');
            const settings = await loadSettings(thread.id, supportAuthorId);
            const result = planAction(thread, settings);
            records[index] = buildHandoverCase(thread, result, supportAuthorId, scopeThread, ownerFallback);
          } catch (error) {
            records[index] = { ...saved, ownerName: ownerFallback || 'Name unavailable',
              status: 'Last known action; thread could not be verified',
              nextStep: `${saved.action} by ${saved.due || 'the calculated deadline'}; verify the live thread first.`,
              sourceError: error.message };
          }
          finished++;
          status.textContent = `Reading threads for handover: ${finished}/${cases.length}...`;
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, cases.length) }, () => worker()));
      if (state.supportAuthorId !== supportAuthorId || state.profileLoading)
        throw new Error('Support profile changed during export. Start the report again.');
      const html = buildLeaveReport(records, supportAuthorId, start, end);
      const download = document.createElement('a');
      download.href = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      download.download = `leave-report-${start}-to-${end}.html`;
      document.body.append(download);
      try { download.click(); } finally { download.remove(); }
      status.textContent = 'Handover report downloaded. Review it against the live threads before sharing.';
    } catch (error) { status.textContent = error.message; }
    finally {
      exporting = false;
      state.exportingReport = false;
      button.disabled = state.refreshingCases || state.profileLoading || !state.supportAuthorId || !state.cases.length;
    }
  });
}
