# Forum Action Planner (prototype)

An Edge Manifest V3 popup for reviewing Microsoft Learn Q&A threads. Paste a thread URL or open a Q&A question and click the extension. It reads the question, answers, comments, authors and timestamps, then calculates the next step from the supplied flowcharts. It does **not** post, strike, close threads, or access SharePoint/Insider/CI.

## Install

1. Open `edge://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `edge-forum-actions` folder.
3. Open **My support profile** in the popup and paste a profile link copied from your own Q&A answer (containing `?userid=...`), or its user ID. Save it once per browser. Every teammate uses their own profile; there is no Brian-specific ID in the code.
4. Open a Microsoft Learn Q&A question and click the extension icon, or paste a question link into the popup. The stage and due date are calculated automatically. If you post a reply while the popup stays open, click **Refresh thread** to reread the page without a cached copy. **Refresh cases** also updates the current thread card when it is saved. Only if a classification is wrong, expand **View activity or correct an action** and change it.
5. Click **Save to My Cases** to pin a thread. The dashboard groups cases by next action: **Strike cases**, **Close cases (last response due)**, **Customer follow-up**, **Flow complete / accepted (verify CI)**, and **Needs review**. Saved links are reread automatically each time you open the popup; keep it open until checking finishes. **Refresh cases** checks them again on demand. Until a check finishes, summaries are based on the last check (date urgency recalculates locally). “Close cases” means the final response is due, not that CI closure is confirmed. To remove a case, click **Remove**, then **Confirm removal**; **Cancel** leaves it saved. Removal stops reminders for that case but preserves action corrections.
6. The extension checks saved links approximately every **5 minutes** while Edge runs, even with the popup closed. This is polling, not a live push feed: detection can take until the next successful check, plus the time needed to read the saved threads. Browser scheduling, sleep, network failures, and Microsoft Learn availability can delay updates beyond five minutes. Requests bypass the browser cache, time out after 30 seconds per thread, and background checks do not overlap. When a saved summary changes, an open popup rereads its displayed saved thread. A badge shows the number of saved cases needing action: due today, overdue, **or awaiting your follow-up to a customer reply**, even with notifications off. The badge turns red when a follow-up reaches its final deadline or an action is overdue. Enable **Desktop reminders** in My Cases if you want a notification when an automatic check finds such cases. Each case/action is notified at most once a day; clicking the notification opens the case list. Notifications are off by default and depend on Edge running, network access, and your system notification settings. Failed checks keep the last-known badge count but do not trigger desktop notifications.
7. **Today** at the top of My Cases lists customer replies awaiting your response **as soon as they are detected**, even before the one-business-day final deadline. A pending follow-up on its deadline is shown in red; overdue work stays red. Strikes and final responses due today or overdue also appear. It shows today's observed support posts alongside pending actions; when neither applies, it says no action is scheduled today. The list updates when saved cases refresh.
   Today labels a pending step **Not complete** and a recognized answer, strike, or final response posted today **Complete**. It can show both if a strike was posted today and a different action is already due. An unrecognized comment is shown as **step not confirmed**, not falsely classified as a strike. **Close step - Complete** means the final forum response was posted; CI closure is never inferred.
8. Use **Calendar** for a Monday-Sunday grid styled like a compact Outlook week view. Navigate with the arrows or **Today**. Choose a day to see full case titles and details below the grid, or click a case number to open its thread. Colors separate calculated due dates, customer replies, observed forum posts, and conditional close-step forecasts. A new customer reply appears as **Respond now** even before the follow-up deadline; overdue work is carried to the current day. The forecast is not confirmation of CI closure. Cases update on the next successful refresh; no Outlook sign-in, calendar permission, or server is needed. The data remains local to this browser.

## Discord notifications

Create a private Discord text channel, open **Edit Channel → Integrations → Webhooks**, and copy its webhook URL. Reload the extension after updating (it now requests access to `discord.com`). In **Settings → Discord notifications**, paste the URL, enable **Send new CX replies to Discord**, and save. **Send test notification** sends a connection test only when you click it, without case data; it uses the saved webhook. Set the Discord channel's notifications to **All Messages** if desired and check mobile/system notification permissions.

Only saved cases for the active support profile are monitored. The first complete read of each case after enabling establishes a baseline and sends nothing for existing replies. Later successful reads, both manual and background, identify new question-author posts after your first answer in your own conversation. Other users' posts, replies under other answers, edits to existing post IDs, accepted-answer changes, and deadline-only changes do not generate Discord messages. Multi-page threads or relevant unidentified authors defer detection until a complete identifiable read is available.

Messages contain case ID, the current saved action/deadline, and a direct reply link. Reply excerpts (up to 170 characters) are off by default and require explicit opt-in; messages never request mass mentions. Do not enable excerpts unless your workplace permits sharing that content with Discord. All messages go through Discord; no Azure or private backend is used. Gmail sending is not included.

Settings, seen reply IDs and last sending status are stored locally per support profile under `discord-`, `discord-seen-` and `discord-status-` keys. The webhook URL is a secret and local storage is not encrypted: do not share it, include it in logs/screenshots or distribute a shared webhook with the extension. Clear the URL, uncheck enabled, and save to remove the saved secret. Changing the webhook or toggling enabled resets baselines; replies received before the next baseline are not notified.

Sending failures are shown in Settings separately from thread refresh errors. Unsent reply IDs are retried when they are observed on a later successful check; HTTP 429 imposes a retry window. Successful batches are recorded to suppress repeat sends across refreshes/restarts. Delivery is not exactly-once: a timeout after Discord accepted a message, or a restart before its success was saved, can produce a duplicate. Reads/sends are bounded by timeouts and Discord availability/rate limits. Edge must run; there is no automatic working-hours, weekend or leave pause yet. Turn Discord off when you do not want messages (this does not change business deadlines or stop case polling).

## Leave report

In **My Cases**, run **Refresh cases** and wait for it to finish, then expand **Leave report**. Select the first and last day of your planned leave (inclusive); for one day, use the same date in both fields. Click **Download HTML report** and open the downloaded file in Edge. Use the browser's Print dialog if you want to save a PDF.

The report includes every saved case for the currently selected support profile, grouped into work due before leave, during leave, after leave, cases needing review/no calculated deadline, and completed/accepted cases requiring separate CI verification. Each row includes its thread link, next action, calculated deadline, last successful check timestamp (UTC), and handover notes. Pending customer replies are marked as needing a response now, even if their final deadline is later. Close-step forecasts appear in a separate table with their assumptions, not as confirmed deadlines or closure.

Export uses the latest summaries available in the popup; it does not automatically fetch the threads. Failed checks are marked **LAST KNOWN**, and never-checked cases are identified. The report is a snapshot: subsequent replies may change the schedule. Selecting leave dates does not change business rules, move deadlines, pause background monitoring, or send email. Report generation is local and requires no backend or extra browser permissions. Review the report before sharing it: it contains your support profile ID and case information. Export is unavailable while a popup refresh or profile transition is in progress.

## Rules and limitations

- First response: first strike after **3 business days**, last quality response **2 business days** after the strike if unanswered.
- Ongoing investigation: first strike after **2 business days**, second strike **2 business days** later, then last quality response if unanswered.
- Only while the **next action is a strike**, the popup shows a **predicted close day**: first-response branch = first strike date + 2 business days; ongoing branch = second strike date (2 business days after the first strike). If the next action is the last quality response, only its due date and the posted strike dates appear. The prediction assumes no customer reply and that every intervening step happens on schedule. It is not confirmation that the thread or CI case is closed.
- If you have already posted a strike in the current unanswered cycle, the result card shows its **actual posted date** (Strike 1, Strike 2) alongside the next deadline and any predicted close day. These dates come from thread timestamps, not the predicted schedule; a customer reply starts a new strike cycle.
- Customer response resets the strikes; follow up within **1 business day**. A later support comment at least **2 business days** after the first strike (first-response branch), or a comment after **2 strikes** (ongoing branch), is inferred to be the final follow-up. The planner then shows **Strike flow complete — verify CI closure** with no further strike deadline. This is not proof the case was closed: verify the qualified closure note and CI state separately.
- When the public page marks your answer as accepted by the question author, the popup shows **Your answer was accepted** and no strike deadline. This does not verify whether the case was closed in CI; check that separately. Accepted answers are sometimes wrapped in a `div` instead of an answer list item.
- The planner identifies the question author from the thread and your support profile from **My support profile**. Only your posts and the question author's posts in your conversation count; a customer comment under someone else's answer is excluded, even if posted after your answer. Corrections and dashboard cases are kept separately for each saved profile.
- With no customer reply after your first answer, the first-response branch applies. If the customer replied and you replied afterward, the ongoing-investigation branch applies. A customer reply awaiting your response triggers the one-business-day follow-up. Your first comment after a customer reply counts as your response; later unanswered comments count as strikes by default. The first answer is the starting point for the timeline.
- Comment classification is a best-effort inference from authors, post order and dates, not proof a comment is a strike or final response. Use the optional correction for ordinary comments or exceptions. The planner cannot determine scope, issue resolution, CI notes, or PM timing from a public thread. "Strike" means a forum comment here, not a separate private-message action.
- Dates use the computer's local timezone and skip weekends only; **holidays and internal policies are not included**. A multi-page thread blocks automated deadlines. Always verify the full thread and your CI/TA records before acting.
- The result separates **observed** strike posts from **calculated** action dates and **predicted** closure dates. **Why this date?** links to the actual thread posts used by the rule, so you can check the evidence. Comments and answers in **View activity** also link to their source posts.
- The extension stores your profile ID, corrections, and dashboard summaries on this device with `chrome.storage.local`; it does not store full case content in the dashboard. It fetches Microsoft Learn Q&A pages to read a thread or refresh saved cases, but does not contact SharePoint, Insider, CI, or other services. If a refresh fails, the last known summary remains visibly marked as such.

## Contributor architecture

Load the **repository root** (`edge-forum-actions`), not `src/`: the root `manifest.json` points to the nested popup and service worker. There is no install/build step, package dependency, framework, or backend. After changing files, reload the unpacked extension in Edge.

```text
manifest.json                         MV3 permissions and entrypoints
src/
  core/engine.js                      Pure business-day planner and conversation rules
  features/
    threads/extractor.js              Public Q&A DOM extraction (also injected into active tabs)
    profile/profile.js                Support-profile validation
    cases/dashboard.js                Pure summaries, categories, Today and week calculations
    cases/case-store.js               Serialized, optimistic-concurrency storage mutations
    discord/discord.js                Webhook validation, baselines, retries and delivery
    reports/report.js                 Pure HTML leave-report generation
  platform/
    background/background.js          MV3 worker, 5-minute alarm, badge/reminders and message routing
    offscreen/offscreen.html           DOM-parser document entrypoint
    offscreen/offscreen.js             Fetch/parse requests and reminder icon generation
  ui/popup/
    popup.html, popup.css              Existing top tabbar, panels and visual styles
    popup.js                          Composition root and shared state creation
    app-controller.js                 Thread reads, request guards and saved-case refresh orchestration
    thread-view.js                    Result, evidence and correction controls
    cases-view.js                     Grouped My Cases, removal confirmation and Today rendering
    calendar-view.js                  Week navigation, event chips and selected-day agenda
    tabs.js                           Accessible click/keyboard panel navigation
    settings-controller.js            Profile transition, reminder and Discord settings
    report-controller.js              Leave dates and local HTML download
 tests/                               Node regression and structural/smoke checks
```

### Dependency boundaries and modification guide

- `core` and the pure feature helpers do not know the popup, Chrome APIs, or each other's UI. The planner is kept unchanged by this refactor. Modify `engine.js` only for an explicitly agreed business-rule change, with engine tests.
- Browser entrypoints still use **classic scripts**: the worker uses relative `importScripts`, and HTML lists dependencies in order. This deliberately preserves MV3 worker/offscreen and self-contained extractor injection compatibility without a build pipeline. Legacy pure helpers expose their existing CommonJS exports to Node tests. The composition root is the only popup file that collects these helpers and factory names from the script environment.
- Popup modules are factory functions with an explicit `{ document, chrome, state, domain, callbacks }` interface (each takes only the fields it needs). They do not call another module's global renderer or read global mutable state. `popup.js` owns the shared state object; `app-controller.js` owns asynchronous read/refresh guards. Views keep only presentation state locally (expanded categories, selected calendar week/day). Factories register their own feature's event handlers and return methods needed by the controller.
- Change result/evidence/correction rendering in `thread-view.js`; list/Today presentation in `cases-view.js`; calendar presentation/navigation in `calendar-view.js`; profile/Discord/reminder controls in `settings-controller.js`; download UX in `report-controller.js`; report content/escaping in `features/reports/report.js`; delivery/deduplication in `features/discord/discord.js`. Update the matching tests rather than changing business rules to accommodate UI changes.
- Background and popup share the serialized case store through `forum-case-store` messages, not independent writes. Discord delivery stays in the worker through `forum-discord`. Offscreen requests use `forum-parser`. DOM parsing stays out of the service worker. `app.readThread` is an explicit replaceable reader interface used by deterministic popup tests; full script loading is also tested without test adapters.
- Storage remains local and profile-scoped. Existing keys are unchanged: `supportAuthorId`, `cases-`, `thread-` (including legacy corrections), `reminders-`, `notified-`, `discord-`, `discord-seen-`, and `discord-status-`. No migration or storage reset is required. Five-minute polling, notification behavior, tabbar and HTML report semantics are unchanged.
- `customer-test-starter/` is a separate pre-existing Java demo, not part of the extension runtime or Node test command. Its files and `.github/` tooling are untouched.

### Verification

From the repository root, using Node.js (verified with Node 24):

```text
node --test tests/*.test.js
```

This runs the original 80 regression cases plus structural/smoke checks. Tests use fake Chrome/DOM/network adapters; they **do not send real Discord messages**. The structural suite checks manifest/HTML/worker references, loads popup scripts in actual HTML order and offscreen scripts in their own context, rejects duplicate legacy entrypoints, and runs `node --check` on every extension/test JavaScript file.

After reloading in Edge, manually open the popup and a Q&A thread, check the top tabs, saved-case refresh, profile switching and a local HTML report download. Automated Node checks cannot verify Edge permissions, real network availability, browser scheduling, desktop notification delivery or pixel layout. Do not click **Send test notification** unless you intend to send a real Discord connection test.
