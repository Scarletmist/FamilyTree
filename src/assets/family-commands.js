/* Pure family mutations shared by the browser store and the local development server. */
(function (root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./family-model.js') : root.FamilyModel;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyCommands = api;
})(globalThis, function (Model) {
  'use strict';

  function commandError(message, status = 400, code = 'INVALID_COMMAND') {
    return Object.assign(new Error(message), { status, code });
  }

  function memberInput(input, id) {
    const person = {
      id,
      name: input?.name,
      location: input?.location,
      position: input?.position,
      gender: input?.gender,
      siblingOrder: input?.siblingOrder,
      relationships: input?.relationships
    };
    if (input?.discipleOrder !== undefined) person.discipleOrder = input.discipleOrder;
    if (input?.notes !== undefined) person.notes = input.notes;
    if (input?.mapHidden !== undefined) person.mapHidden = input.mapHidden;
    if (input?.geocode !== undefined) person.geocode = input.geocode;
    if (input?.locationOverride !== undefined) person.locationOverride = input.locationOverride;
    Model.validateMember(person);
    person.name = person.name.trim();
    person.location = person.location.trim();
    person.position = person.position.trim();
    const Location = typeof module === 'object' && module.exports ? require('./family-location.js') : globalThis.FamilyLocation;
    if (!Location.eligible(person) || !Location.current(person)) delete person.geocode;
    if (!Location.eligible(person) || !Location.overrideCurrent(person)) delete person.locationOverride;
    return person;
  }

  function addMember(data, command) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.requestId || '') || !command.member) {
      throw commandError('新增資料格式不正確。');
    }
    const person = memberInput(command.member, 'p-' + command.requestId);
    const existing = data.people.find(item => item.id === person.id);
    if (existing) {
      const original = { ...existing }; delete original.inferredRelationships;
      if (JSON.stringify(original) === JSON.stringify(person)) {
        return { data, unchanged: true, memberId: person.id, label: `新增成員「${person.name}」` };
      }
      throw commandError('此筆新增已儲存，請重新開啟新增表單。', 409, 'ALREADY_SAVED');
    }
    const next = { ...data, people: data.people.concat(person) };
    Model.build(next);
    return { data: next, memberId: person.id, label: `新增成員「${person.name}」` };
  }

  function updateMember(data, command) {
    if (typeof command.id !== 'string' || !data.people.some(person => person.id === command.id)) {
      throw commandError('找不到要修改的成員，請更新資料。', 404, 'MEMBER_NOT_FOUND');
    }
    const person = memberInput(command.member, command.id);
    const next = Model.replaceMember(data, person);
    return { data: next, memberId: command.id, label: `更新成員「${person.name}」` };
  }

  function updateFamilyName(data, command) {
    if (!Object.hasOwn(command, 'familyName') || command.familyName === undefined) throw commandError('請填寫家族名稱。');
    const familyName = Model.normalizeFamilyName(command.familyName);
    if (data.familyName === familyName) return { data, unchanged: true, label: '修改家族名稱' };
    return { data: { ...data, familyName }, label: '修改家族名稱' };
  }

  function updateIntermediateIgnore(data, command) {
    if (typeof command.planId !== 'string' || !command.planId || command.planId.length > 500 || typeof command.ignored !== 'boolean') {
      throw commandError('待補項目設定格式不正確。');
    }
    const allPlans = Model.intermediatePlans(data, { includeIgnored: true });
    const ignored = new Set(Model.ignoredIntermediatePlanIds(data));
    const target = allPlans.find(plan => plan.id === command.planId);
    if (command.ignored && !target) throw commandError('此待補項目已不存在，請更新資料後再試。', 409, 'PLAN_NOT_FOUND');
    const slotIds = target ? allPlans.filter(plan => plan.slotId === target.slotId).map(plan => plan.id) : [command.planId];
    slotIds.forEach(id => command.ignored ? ignored.add(id) : ignored.delete(id));
    return {
      data: { ...data, ignoredIntermediatePlans: [...ignored].sort() },
      label: command.ignored ? '忽略待補親屬' : '恢復待補親屬'
    };
  }

  function manageFamily(data, command) {
    const body = { ...command };
    delete body.type;
    delete body.expectedVersion;
    delete body.version;
    const next = Model.manageFamily(data, body);
    return { data: next, label: body.action === 'merge' ? '合併成員' : '修改排行群組' };
  }

  function importFamily(data, command) {
    Model.build(command.data);
    return { data: command.data, label: '匯入族譜', backupBeforeImport: true };
  }

  function applyRaw(data, command) {
    if (!data || !command || typeof command.type !== 'string') throw commandError('不支援的族譜操作。', 400, 'INVALID_COMMAND');
    switch (command.type) {
      case 'refreshKinship': return { data, unchanged: true, metadataOnly: true, label: '補齊已知親屬關係' };
      case 'claimLocationLookup': {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(command.deviceId || '')) throw commandError('背景定位裝置格式不正確。');
        if (data.locationLookupDeviceId === command.deviceId || (data.locationLookupDeviceId && !command.takeOver)) return { data, unchanged: true, metadataOnly: true };
        return { data: { ...data, locationLookupDeviceId: command.deviceId }, metadataOnly: true };
      }
      case 'updateLocations': {
        const Location = typeof module === 'object' && module.exports ? require('./family-location.js') : globalThis.FamilyLocation;
        if (!Location.valid(command.result) || Location.normalize(command.query) !== Location.normalize(command.result.query)) throw commandError('定位結果不正確。');
        let changed = false;
        const people = data.people.map(person => {
          if (!Location.eligible(person) || Location.overrideCurrent(person) || Location.normalize(person.location) !== Location.normalize(command.query) || Location.current(person)) return person;
          changed = true;
          return { ...person, geocode: { ...command.result, query: person.location.trim() } };
        });
        return { data: changed ? { ...data, people } : data, unchanged: !changed, metadataOnly: true };
      }
      case 'resetLocation': {
        const person = data.people.find(p => p.id === command.id);
        if (!person) throw commandError('成員已不存在。');
        const Location = typeof module === 'object' && module.exports ? require('./family-location.js') : globalThis.FamilyLocation;
        const people = data.people.map(p => { if (Location.overrideCurrent(p) || Location.normalize(p.location) !== Location.normalize(person.location)) return p; const next = { ...p }; delete next.geocode; return next; });
        return { data: { ...data, people }, metadataOnly: true };
      }
      case 'setLocationOverride':
      case 'clearLocationOverride': {
        const Location = typeof module === 'object' && module.exports ? require('./family-location.js') : globalThis.FamilyLocation;
        const person = data.people.find(p => p.id === command.id);
        if (!person) throw commandError('成員已不存在，請重新開啟地點修正。', 404);
        if (!Location.eligible(person)) throw commandError('私人住址或未填所在地的成員不能指定地圖位置。');
        if (typeof command.expectedLocation !== 'string' || Location.normalize(command.expectedLocation) !== Location.normalize(person.location)
          || !Object.hasOwn(command, 'expectedOverride') || !Model.sameJsonData(command.expectedOverride, person.locationOverride || null)) {
          throw commandError('所在地或修正位置已更新，請關閉後重新開啟地點修正。', 409, 'STALE_LOCATION');
        }
        const next = { ...person };
        if (command.type === 'setLocationOverride') {
          if (!Location.validOverride(command.override) || Location.normalize(command.override.location) !== Location.normalize(person.location)) throw commandError('修正位置格式不正確。');
          if (command.applyToSameLocation !== undefined && typeof command.applyToSameLocation !== 'boolean') throw commandError('地點套用範圍格式不正確。');
          if (command.applyToSameLocation) {
            const related = data.people.filter(p => p.id !== person.id && Location.eligible(p) && Location.normalize(p.location) === Location.normalize(person.location));
            const expected = command.expectedRelatedMembers;
            if (!Array.isArray(expected) || expected.length !== related.length || new Set(expected.map(p => p?.id)).size !== expected.length
              || related.some(p => !expected.some(e => e?.id === p.id && typeof e.expectedLocation === 'string'
                && Location.normalize(e.expectedLocation) === Location.normalize(p.location) && Object.hasOwn(e, 'expectedOverride')
                && Model.sameJsonData(e.expectedOverride, p.locationOverride || null)))) {
              throw commandError('相同所在地的成員或修正位置已更新，請關閉後重新開啟地點修正。', 409, 'STALE_LOCATION');
            }
            const ids = new Set([person.id, ...related.map(p => p.id)]);
            return { data: { ...data, people:data.people.map(p => ids.has(p.id)
              ? { ...p, locationOverride:{ ...command.override, location:p.location.trim() } } : p) }, memberId:person.id,
              label:`修正「${person.location.trim()}」的 ${ids.size} 位成員地點` };
          }
          next.locationOverride = { ...command.override, location: person.location.trim() };
        } else {
          if (!person.locationOverride) return { data, unchanged: true };
          delete next.locationOverride;
          delete next.geocode;
        }
        return { data: { ...data, people: data.people.map(p => p.id === person.id ? next : p) },
          memberId: person.id, label: command.type === 'setLocationOverride' ? `修正「${person.name}」的地點` : `恢復「${person.name}」的自動定位` };
      }
      case 'addMember': return addMember(data, command);
      case 'updateMember': return updateMember(data, command);
      case 'updateFamilyName': return updateFamilyName(data, command);
      case 'updateIntermediateIgnore': return updateIntermediateIgnore(data, command);
      case 'manageFamily': return manageFamily(data, command);
      case 'importFamily': return importFamily(data, command);
      default: throw commandError('不支援的族譜操作。', 400, 'INVALID_COMMAND');
    }
  }

  function apply(data, command) {
    const change = applyRaw(data, command);
    const completed = Model.completeKinship(change.data);
    return { ...change, data: completed, unchanged: Boolean(change.unchanged && completed === change.data) };
  }
  return { apply, memberInput, commandError };
});
