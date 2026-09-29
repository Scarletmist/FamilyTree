/* Browser backup of the complete JSON. Keep cookies small enough for request headers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyStorage = api;
})(globalThis, function () {
  'use strict';
  function create(env, validate) {
    // Cookies ignore ports; isolate different local servers explicitly.
    const key = 'family-backup-v1-' + (env.location.port || 'default');
    const maxAge = 365 * 24 * 60 * 60;
    const cookieValue = () => env.document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(key + '='))?.slice(key.length + 1);
    const cookie = value => { env.document.cookie = key + '=' + value + '; Path=/; Max-Age=' + maxAge + '; SameSite=Strict' + (env.location.protocol === 'https:' ? '; Secure' : ''); };
    function save(payload) {
      try {
        validate(payload.data);
        const text = JSON.stringify({ data: payload.data, version: payload.version, savedAt: Date.now() });
        const encoded = encodeURIComponent(text);
        if (encoded.length <= 3500) {
          try {
            cookie(encoded);
            if (cookieValue() === encoded) {
              try { env.localStorage.removeItem(key); } catch {}
              return 'cookie';
            }
          } catch {}
        }
        env.localStorage.setItem(key, text);
        // A small marker replaces any outdated JSON cookie.
        try { cookie('localStorage'); } catch {}
        return 'localStorage';
      } catch { return null; }
    }
    function read() {
      const candidates = [];
      try { const value = cookieValue(); if (value && value !== 'localStorage') candidates.push(decodeURIComponent(value)); } catch {}
      try { candidates.push(env.localStorage.getItem(key)); } catch {}
      const valid = [];
      for (const text of candidates) {
        try {
          const payload = JSON.parse(text);
          if (!payload || typeof payload.version !== 'string' || !Number.isFinite(payload.savedAt) || Date.now() - payload.savedAt > maxAge * 1000) continue;
          validate(payload.data);
          valid.push(payload);
        } catch {}
      }
      return valid.sort((a, b) => b.savedAt - a.savedAt)[0] || null;
    }
    return { save, read };
  }
  return { create };
});
