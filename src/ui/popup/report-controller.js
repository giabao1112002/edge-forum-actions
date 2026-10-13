function createReportController({ document, state, buildLeaveReport }) {
  document.getElementById('report-start').addEventListener('change', () => {
    const start = document.getElementById('report-start').value;
    const end = document.getElementById('report-end');
    end.min = start;
    if (!end.value || end.value < start) end.value = start;
  });
  document.getElementById('report-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const status = document.getElementById('report-status');
    const { refreshingCases, profileLoading, supportAuthorId, cases } = state;
    if (refreshingCases || profileLoading || !supportAuthorId || !cases.length) {
      status.textContent = 'Save a case and wait for refresh/profile changes to finish before exporting.';
      return;
    }
    try {
      const start = document.getElementById('report-start').value;
      const end = document.getElementById('report-end').value;
      const html = buildLeaveReport(cases, supportAuthorId, start, end);
      const download = document.createElement('a');
      download.href = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      download.download = `leave-report-${start}-to-${end}.html`;
      document.body.append(download);
      try { download.click(); } finally { download.remove(); }
      status.textContent = 'HTML report download requested. Open it in Edge to read or print / save as PDF.';
    } catch (error) { status.textContent = error.message; }
  });
}
