function createCaseStore(storage) {
  let pending = Promise.resolve();
  return (change) => {
    const operation = pending.then(async () => {
      const { profileId, type, id, summary, expected, settings } = change;
      const key = `cases-${profileId}`;
      const stored = await storage.get(key);
      const cases = stored[key] || [];
      const current = cases.find((item) => item.id === id);
      let next = cases;
      let applied = false;
      if (type === 'add' && !current) {
        next = [...cases, summary];
        applied = true;
      } else if (type === 'remove' && current) {
        next = cases.filter((item) => item.id !== id);
        applied = true;
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
