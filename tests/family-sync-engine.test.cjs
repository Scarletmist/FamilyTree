const test = require('node:test');
const assert = require('node:assert/strict');
const SyncEngine = require('../src/assets/family-sync-engine.js');

function harness({ local, state, remoteMeta, remoteData, conflictChoice = 'cancel' }) {
  const calls = [];
  let currentLocal = structuredClone(local);
  let currentState = { ...state };
  let currentRemote = remoteMeta ? { ...remoteMeta } : null;
  const repository = {
    read: async () => structuredClone(currentLocal),
    getSyncState: async () => ({ ...currentState }),
    isPristine: data => data.people.length === 0 && (!data.familyName || data.familyName === '我的家族'),
    markCloudSynced: async (remote, expectedVersion) => {
      calls.push(['mark', remote, expectedVersion]);
      currentState = { ...currentState, fileId: remote.fileId, remoteVersion: remote.remoteVersion, dirty: false };
    },
    replaceFromCloud: async (data, remote, expectedVersion) => {
      calls.push(['replace', data, remote, expectedVersion]);
      currentLocal = { data: structuredClone(data), version: 'downloaded-version' };
      currentState = { ...currentState, fileId: remote.fileId, remoteVersion: remote.remoteVersion, dirty: false };
    }
  };
  const remote = {
    find: async () => currentRemote ? { ...currentRemote } : null,
    create: async data => {
      calls.push(['create', data]);
      currentRemote = { id: 'drive-1', version: '1' };
      return { ...currentRemote };
    },
    update: async (id, data) => {
      calls.push(['update', id, data]);
      currentRemote = { id, version: String(Number(currentRemote?.version || 0) + 1) };
      return { ...currentRemote };
    },
    download: async meta => {
      calls.push(['download', meta]);
      return structuredClone(remoteData);
    }
  };
  const statuses = [];
  const engine = SyncEngine.create({
    repository,
    remote,
    isOnline: () => true,
    onStatus: (...args) => statuses.push(args),
    resolveConflict: async () => conflictChoice
  });
  return { engine, calls, statuses, repository, remote, setLocal: value => { currentLocal = value; } };
}

const empty = { schemaVersion: 2, familyName: '我的家族', people: [] };
const filled = { schemaVersion: 2, familyName: '測試', people: [{ id: 'A' }] };

test('creates a remote replica when Drive has no family file', async () => {
  const h = harness({
    local: { data: filled, version: 'local-1' },
    state: { fileId: null, remoteVersion: null, dirty: true },
    remoteMeta: null
  });
  const result = await h.engine.sync();
  assert.equal(result.outcome, 'created');
  assert.equal(h.calls[0][0], 'create');
  assert.equal(h.calls.at(-1)[0], 'mark');
});

test('downloads an existing remote family into a pristine local store', async () => {
  const h = harness({
    local: { data: empty, version: 'empty' },
    state: { fileId: null, remoteVersion: null, dirty: false },
    remoteMeta: { id: 'drive-1', version: '7' },
    remoteData: filled
  });
  const result = await h.engine.sync();
  assert.equal(result.outcome, 'downloaded');
  assert.deepEqual(h.calls.map(call => call[0]), ['download', 'replace']);
});

test('uploads local dirty data when the known remote version is unchanged', async () => {
  const h = harness({
    local: { data: filled, version: 'local-2' },
    state: { fileId: 'drive-1', remoteVersion: '7', dirty: true },
    remoteMeta: { id: 'drive-1', version: '7' }
  });
  const result = await h.engine.sync();
  assert.equal(result.outcome, 'uploaded');
  assert.deepEqual(h.calls.map(call => call[0]), ['update', 'mark']);
});

test('manual location corrections survive both upload and download without being projected into auto geocodes', async () => {
  const override = { source:'map', location:'關帝廟', lat:24.8, lon:120.96, displayName:'地圖指定位置', updatedAt:1 };
  const data = { ...filled, people:[{ ...filled.people[0], location:'關帝廟', locationOverride:override }] };
  const upload = harness({ local:{ data, version:'manual-edit' }, state:{ fileId:'drive-1', remoteVersion:'7', dirty:true }, remoteMeta:{ id:'drive-1', version:'7' } });
  await upload.engine.sync();
  assert.deepEqual(upload.calls.find(call=>call[0]==='update')[2],data);
  const download = harness({ local:{ data:empty, version:'empty' }, state:{ fileId:null, remoteVersion:null, dirty:false }, remoteMeta:{ id:'drive-1', version:'8' }, remoteData:data });
  await download.engine.sync();
  assert.deepEqual(download.calls.find(call=>call[0]==='replace')[1],data);
});

test('non-interactive sync reports a conflict without choosing a winner', async () => {
  const h = harness({
    local: { data: filled, version: 'local-3' },
    state: { fileId: 'drive-1', remoteVersion: '7', dirty: true },
    remoteMeta: { id: 'drive-1', version: '8' },
    remoteData: empty
  });
  const result = await h.engine.sync({ interactive: false });
  assert.equal(result.outcome, 'conflict');
  assert.equal(h.calls.length, 0);
  assert.equal(h.statuses.at(-1)[0], 'conflict');
});

test('interactive conflict rechecks versions before applying the user choice', async () => {
  const h = harness({
    local: { data: filled, version: 'local-4' },
    state: { fileId: 'drive-1', remoteVersion: '7', dirty: true },
    remoteMeta: { id: 'drive-1', version: '8' },
    remoteData: empty,
    conflictChoice: 'local'
  });
  const result = await h.engine.sync({ interactive: true });
  assert.equal(result.outcome, 'uploaded');
  assert.deepEqual(h.calls.map(call => call[0]), ['download', 'update', 'mark']);
});
