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
    Model.validateMember(person);
    person.name = person.name.trim();
    person.location = person.location.trim();
    person.position = person.position.trim();
    return person;
  }

  function addMember(data, command) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.requestId || '') || !command.member) {
      throw commandError('新增資料格式不正確。');
    }
    const person = memberInput(command.member, 'p-' + command.requestId);
    const existing = data.people.find(item => item.id === person.id);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(person)) {
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

  function apply(data, command) {
    if (!data || !command || typeof command.type !== 'string') throw commandError('不支援的族譜操作。', 400, 'INVALID_COMMAND');
    switch (command.type) {
      case 'addMember': return addMember(data, command);
      case 'updateMember': return updateMember(data, command);
      case 'updateFamilyName': return updateFamilyName(data, command);
      case 'updateIntermediateIgnore': return updateIntermediateIgnore(data, command);
      case 'manageFamily': return manageFamily(data, command);
      case 'importFamily': return importFamily(data, command);
      default: throw commandError('不支援的族譜操作。', 400, 'INVALID_COMMAND');
    }
  }

  return { apply, memberInput, commandError };
});
