// Composition root: factories receive explicit interfaces, never each other's globals.
const state = { supportAuthorId: '', thread: undefined, settings: undefined, cases: [],
  refreshingCases: false, profileLoading: false, threadRequest: 0 };
const domain = { planAction, scopeThread, inferProcessStage, inferPostAction, caseSummary,
  caseTitle, caseStatus, caseCategory, caseStep, postedToday, todayActivity, sortCases, localDateKey, calendarWeek };
const app = createPopupApp({ document, chrome, state, domain, extractForumThread,
  views: { createTabs, createThreadView, createCasesView, createCalendarView,
    createSettingsController, createReportController }, resolveSupportProfileDetails, buildHandoverCase, buildLeaveReport });
app.initialize().catch((error) => { document.getElementById('message').textContent = error.message; });
