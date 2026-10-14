// Calendar navigation is view-local; saved cases are read from shared app state.
function createCalendarView({ document, state, domain }) {
  const { calendarWeek, localDateKey, caseStep, caseTitle } = domain;
  let calendarWeekOf = new Date();
  let calendarSelectedDate = localDateKey(new Date());
  function calendarEventKind(kind, item, dayKey) {
    return kind === 'due' && item.action === 'Follow up with customer' && dayKey <= localDateKey(new Date()) ? 'urgent' : kind;
  }
  function calendarEventDescription(kind, item) {
    return `${item.error ? 'Last known: ' : ''}${kind === 'due' ? `Calculated due: ${caseStep(item.action)} - Not complete`
      : kind === 'reply' ? `Customer replied - respond now; final deadline ${item.due}`
      : kind === 'overdue' ? `${caseStep(item.action)} overdue since ${item.due}`
      : kind === 'prediction' ? 'Forecast only: close step if no reply (CI closure unverified)'
      : item.lastSupportPost.step ? `Observed: ${item.lastSupportPost.step} - Complete (forum post)`
      : `Observed: ${item.lastSupportPost.type} posted (step not confirmed)`}`;
  }
  function calendarChipLabel(kind, item) {
    if (kind === 'reply') return 'Respond now';
    if (kind === 'overdue') return 'Overdue';
    if (kind === 'prediction') return 'Close forecast';
    const step = kind === 'due' ? caseStep(item.action) : item.lastSupportPost.step || 'Post';
    return `${step.replace('Close step (final response)', 'Final response')} ${kind === 'due' ? 'due' : 'posted'}`;
  }
  function renderCalendar() {
    const days = calendarWeek(state.cases, calendarWeekOf);
    const dateOptions = { month: 'short', day: 'numeric' };
    document.getElementById('calendar-range').textContent = `${days[0].date.toLocaleDateString(undefined, dateOptions)} - ${days[6].date.toLocaleDateString(undefined, { ...dateOptions, year: 'numeric' })}`;
    const container = document.getElementById('calendar-days');
    const agenda = document.getElementById('calendar-agenda-list');
    container.replaceChildren();
    agenda.replaceChildren();
    if (!state.cases.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Save a case to see its schedule.';
      container.append(empty);
      document.getElementById('calendar-agenda-heading').textContent = '';
      return;
    }
    if (!days.some((day) => day.key === calendarSelectedDate))
      calendarSelectedDate = days.find((day) => day.key === localDateKey(new Date()))?.key || days[0].key;
    for (const day of days) {
      const row = document.createElement('div');
      row.className = `calendar-day${day.key === localDateKey(new Date()) ? ' today' : ''}${day.key === calendarSelectedDate ? ' selected' : ''}`;
      const date = document.createElement('button');
      date.type = 'button';
      date.className = 'calendar-date';
      date.ariaLabel = `Show ${day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`;
      const weekday = document.createElement('span');
      weekday.textContent = day.date.toLocaleDateString(undefined, { weekday: 'short' });
      const number = document.createElement('time');
      number.dateTime = day.key;
      number.textContent = day.date.getDate();
      date.append(weekday, number);
      date.addEventListener('click', () => {
        calendarSelectedDate = day.key;
        renderCalendar();
      });
      const events = document.createElement('div');
      for (const { kind, item } of day.events) {
        const event = document.createElement('div');
        event.className = `calendar-event ${calendarEventKind(kind, item, day.key)}`;
        const sourceLabel = item.site === 'devcommunity' ? 'Developer Community' : 'Microsoft Learn';
        event.title = `${caseTitle(item)} - ${sourceLabel} - ${calendarEventDescription(kind, item)}`;
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = item.id;
        link.title = caseTitle(item);
        link.ariaLabel = `${caseTitle(item)} - ${calendarEventDescription(kind, item)}`;
        const label = document.createElement('span');
        label.textContent = calendarChipLabel(kind, item);
        const source = document.createElement('span');
        source.className = 'calendar-source';
        source.textContent = item.site ? sourceLabel : '';
        event.append(link, label, source);
        events.append(event);
      }
      row.append(date, events);
      container.append(row);
    }
    const selectedDay = days.find((day) => day.key === calendarSelectedDate);
    document.getElementById('calendar-agenda-heading').textContent = `${selectedDay.date.toLocaleDateString(undefined,
      { weekday: 'long', month: 'short', day: 'numeric' })} - ${selectedDay.events.length} case action(s)`;
    if (!selectedDay.events.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No case actions on this day.';
      agenda.append(empty);
    }
    for (const { kind, item } of selectedDay.events) {
      const event = document.createElement('div');
      event.className = `calendar-agenda-item ${calendarEventKind(kind, item, selectedDay.key)}`;
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = caseTitle(item);
      const detail = document.createElement('p');
      detail.textContent = `${calendarEventDescription(kind, item)}${item.site
        ? ` · Source: ${item.site === 'devcommunity' ? 'Developer Community' : 'Microsoft Learn'}` : ''}`;
      event.append(link, detail);
      agenda.append(event);
    }
  }
  document.getElementById('calendar-previous').addEventListener('click', () => {
    calendarWeekOf = new Date(calendarWeekOf.getFullYear(), calendarWeekOf.getMonth(), calendarWeekOf.getDate() - 7);
    renderCalendar();
  });
  document.getElementById('calendar-current').addEventListener('click', () => {
    calendarWeekOf = new Date();
    calendarSelectedDate = localDateKey(calendarWeekOf);
    renderCalendar();
  });
  document.getElementById('calendar-next').addEventListener('click', () => {
    calendarWeekOf = new Date(calendarWeekOf.getFullYear(), calendarWeekOf.getMonth(), calendarWeekOf.getDate() + 7);
    renderCalendar();
  });
  return { renderCalendar };
}
