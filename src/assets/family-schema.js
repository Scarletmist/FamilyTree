/* Data schema version, independent of browser storage and domain validation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilySchema = api;
})(globalThis, function () {
  'use strict';
  const CURRENT_VERSION = 3;
  function validate(data) {
    if (!data || ![2, CURRENT_VERSION].includes(data.schemaVersion) || !Array.isArray(data.people)) {
      throw new Error('族譜 JSON 格式不正確，支援資料版本 2 與 3。');
    }
    if (data.schemaVersion === 2 && (data.recycleBin !== undefined || data.people.some(p => p?.archive !== undefined))) {
      throw new Error('封存與回收資料須使用族譜資料版本 3。');
    }
  }
  function migrate(data) {
    validate(data);
    return data.schemaVersion === CURRENT_VERSION ? data : { ...data, schemaVersion: CURRENT_VERSION };
  }
  return { CURRENT_VERSION, validate, migrate };
});
