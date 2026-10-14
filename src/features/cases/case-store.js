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

function threadStorageKey(profileId, site = 'learn', id = '') {
  const targetSite = normalizeSupportSite(site);
  const value = String(profileId || '').trim();
  if (!value) return targetSite === 'learn' ? `thread-${id}` : `thread-${targetSite}-${id}`;
  if (!id) return targetSite === 'learn' ? `thread-${value}` : `thread-${targetSite}-${value}`;
  return targetSite === 'learn' ? `thread-${value}-${id}` : `thread-${targetSite}-${value}-${id}`;
}

function createCaseStore(storage) {
  let pending = Promise.resolve();
  return (change) => {
    const operation = pending.then(async () => {
      const { profileId, type, id, summary, expected, settings, source, site } = change;
      const selectedSite = normalizeSupportSite(site || 'learn');
      const key = profileStorageKey(profileId, selectedSite, 'cases');
      const ignoredKey = profileStorageKey(profileId, selectedSite, 'ignored-cases');
      const stored = await storage.get(key);
      const cases = stored[key] || [];
      const current = cases.find((item) => item.id === id);
      let next = cases;
      let applied = false;
      if (type === 'add' && !current) {
        const ignored = (await storage.get(ignoredKey))[ignoredKey] || [];
        if (source !== 'activity' || !ignored.includes(id)) {
          next = [...cases, summary];
          applied = true;
          if (source !== 'activity' && ignored.includes(id))
            await storage.set({ [ignoredKey]: ignored.filter((item) => item !== id) });
        }
      } else if (type === 'remove' && current) {
        next = cases.filter((item) => item.id !== id);
        applied = true;
        const ignored = (await storage.get(ignoredKey))[ignoredKey] || [];
        if (!ignored.includes(id)) await storage.set({ [ignoredKey]: [...ignored, id] });
      } else if (type === 'update' || type === 'correct') {
        if (type === 'correct') await storage.set({ [threadStorageKey(profileId, selectedSite, id)]: settings });
        const comparable = current && expected?.site && !current.site ? { ...current, site: selectedSite } : current;
        if (comparable && JSON.stringify(comparable) === JSON.stringify(expected)) {
          next = cases.map((item) => item.id === id ? summary : item);
          applied = true;
        }
      }
      if (applied) await storage.set({ [key]: next });
      return { cases: next, applied };
    });
    pending = operation.catch(() => {});
    return operation;
  };
}
if (typeof module !== 'undefined') module.exports = { createCaseStore };
