function createTabs({ document }) {
  const tabs = [
    ['thread', 'panel-thread'], ['today', 'today-section'], ['cases', 'saved-section'],
    ['calendar', 'calendar-section'], ['settings', 'panel-settings']
  ];
  function activateTab(name, focus = false) {
    for (const [tabName, panelId] of tabs) {
      const selected = tabName === name;
      const tab = document.getElementById(`tab-${tabName}`);
      tab.ariaSelected = String(selected);
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(panelId).hidden = !selected;
      if (selected && focus) tab.focus();
    }
  }
  for (const [index, [name]] of tabs.entries()) {
    const tab = document.getElementById(`tab-${name}`);
    tab.addEventListener('click', () => activateTab(name));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      activateTab(tabs[next][0], true);
    });
  }
  activateTab('thread');
  return { activateTab };
}
