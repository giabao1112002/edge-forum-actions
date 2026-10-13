function createCaseStore(storage) {
  let pending = Promise.resolve();
  return (change) => {
    const operation = pending.then(async () => {
      const { profileId, type, id, summary, expected, settings, source } = change;
      const key = `cases-${profileId}`;
      const ignoredKey = `ignored-cases-${profileId}`;
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
        if (type === 'correct') await storage.set({ [`thread-${profileId}-${id}`]: settings });
        if (current && JSON.stringify(current) === JSON.stringify(expected)) {
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
