/* Browser application state and semantic commands. Persistence details stay behind FamilyRepository. */
(function () {
  'use strict';
  const repository = window.FamilyRepository;
  let snapshot = null;
  let graph = null;

  function adopt(payload, source = 'application') {
    if (!payload || typeof payload.version !== 'string') throw new Error('族譜狀態格式不正確。');
    graph = FamilyDisplayProjection.project(FamilyModel.build(payload.data));
    snapshot = payload;
    window.dispatchEvent(new CustomEvent('familyappchange', { detail: { snapshot, graph, source } }));
    return snapshot;
  }

  async function load() {
    return adopt(await repository.load(), 'load');
  }

  async function run(method, ...args) {
    return adopt(await repository[method](...args), 'local');
  }

  const api = {
    snapshot: () => snapshot,
    graph: () => graph,
    adopt,
    load,
    addMember: input => run('addMember', input),
    updateMember: (id, input) => run('updateMember', id, input),
    updateFamilyName: input => run('updateFamilyName', input),
    updateIntermediateIgnore: input => run('updateIntermediateIgnore', input),
    manageFamily: input => run('manageFamily', input),
    importFamily: input => run('importFamily', input),
    async undo(expectedVersion) {
      const result = await repository.undo(expectedVersion);
      adopt(result, 'undo');
      return result;
    },
    exportData: () => repository.exportData(),
    async locationCommand(command) {
      const result = await repository.locationCommand(command);
      // Its repository event updates open forms; keep the source distinct from user edits.
      return adopt(result, 'geocode');
    }
  };
  window.FamilyApp = api;
})();
