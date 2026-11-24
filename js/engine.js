/**
 * JS Insegne Digitali — Motore condiviso (desktop + mobile)
 * Stesse chiavi localStorage → stessi dati su entrambe le interfacce
 */
(function (global) {
  'use strict';

  const KEYS = {
    clients: 'note_clienti_data',
    models: 'note_clienti_modelli',
    spedizioni: 'note_clienti_spedizioni',
    ordini: 'note_clienti_ordini',
    geo: 'note_clienti_geo_cache',
    prepGroup: 'note_clienti_prep_group',
    lastBackup: 'note_clienti_last_backup',
    auth: 'note_clienti_auth'
  };

  let clients = [];
  let savedModels = [];
  let savedSpedizioni = [];
  let ordini = [];
  const listeners = [];

  function safeParse(raw, fallback) {
    try {
      if (raw == null || raw === '') return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function uid() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function toUpper(s) {
    return String(s || '').trim().toLocaleUpperCase('it-IT');
  }

  function load() {
    clients = safeParse(localStorage.getItem(KEYS.clients), []);
    if (!Array.isArray(clients)) clients = [];
    savedModels = safeParse(localStorage.getItem(KEYS.models), ['LCD TOUCH']);
    if (!Array.isArray(savedModels)) savedModels = [];
    savedSpedizioni = safeParse(localStorage.getItem(KEYS.spedizioni), []);
    if (!Array.isArray(savedSpedizioni)) savedSpedizioni = [];
    ordini = safeParse(localStorage.getItem(KEYS.ordini), []);
    if (!Array.isArray(ordini)) ordini = [];
    emit();
    return getState();
  }

  function save() {
    try { localStorage.setItem(KEYS.clients, JSON.stringify(clients)); } catch (e) {}
    try { localStorage.setItem(KEYS.models, JSON.stringify(savedModels)); } catch (e) {}
    try { localStorage.setItem(KEYS.spedizioni, JSON.stringify(savedSpedizioni)); } catch (e) {}
    try { localStorage.setItem(KEYS.ordini, JSON.stringify(ordini)); } catch (e) {}
    try { localStorage.setItem('note_clienti_planning_dirty_at', String(Date.now())); } catch (e) {}
    emit();
  }

  function emit() {
    const snap = getState();
    listeners.forEach(function (fn) {
      try { fn(snap); } catch (e) {}
    });
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function getState() {
    return {
      clients: clients.slice(),
      models: savedModels.slice(),
      spedizioni: savedSpedizioni.slice(),
      ordini: ordini.slice()
    };
  }

  function isInPrep(c) {
    if (!c || c.installato || c.standby) return false;
    return c.inPrep === true || c.inPrep === 'true';
  }

  function isNote(c) {
    if (!c || c.installato || c.standby) return false;
    return !isInPrep(c);
  }

  function isStandby(c) {
    return !!(c && (c.standby === true || c.standby === 'true') && !c.installato);
  }

  function isInstallato(c) {
    return !!(c && c.installato);
  }

  function findClient(id) {
    const sid = String(id);
    return clients.find(function (c) { return String(c.id) === sid; }) || null;
  }

  function sectionOf(c) {
    if (isInstallato(c)) return 'installati';
    if (isStandby(c)) return 'standby';
    if (isInPrep(c)) return 'prep';
    return 'note';
  }

  function getBySection(section) {
    return clients.filter(function (c) {
      return sectionOf(c) === section;
    });
  }

  function searchClients(query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return clients.slice();
    const words = q.split(/\s+/).filter(Boolean);
    return clients.filter(function (c) {
      const blob = [
        c.nome, c.localita, c.tappa, c.spedizione, c.confOrdine,
        c.montaggio, c.provincia, c.regione,
        (c.modelli || []).map(function (m) { return (m && m.nome) || m; }).join(' ')
      ].join(' ').toLowerCase();
      return words.every(function (w) { return blob.indexOf(w) >= 0; });
    });
  }

  function updateClient(id, patch) {
    const c = findClient(id);
    if (!c) return null;
    Object.keys(patch || {}).forEach(function (k) {
      c[k] = patch[k];
    });
    save();
    return c;
  }

  function deleteClient(id) {
    const sid = String(id);
    const before = clients.length;
    clients = clients.filter(function (c) { return String(c.id) !== sid; });
    if (clients.length !== before) save();
    return clients.length !== before;
  }

  function moveToNote(id, opts) {
    opts = opts || {};
    const c = findClient(id);
    if (!c) return null;
    c.inPrep = false;
    c.installato = false;
    c.standby = false;
    if (opts.spedizione) {
      c.spedizione = toUpper(opts.spedizione);
      c.tappa = '';
      if (opts.gruppo) c.spedizioneGruppo = toUpper(opts.gruppo);
      rememberSpedizione(c.spedizione);
    } else if (opts.tappa) {
      c.tappa = toUpper(opts.tappa);
      c.spedizione = '';
      c.spedizioneGruppo = '';
    }
    if (opts.data) c.data = opts.data;
    save();
    return c;
  }

  function moveToPrep(id) {
    const c = findClient(id);
    if (!c) return null;
    c.inPrep = true;
    c.installato = false;
    c.standby = false;
    save();
    return c;
  }

  function markStandby(id) {
    const c = findClient(id);
    if (!c) return null;
    c.standby = true;
    c.installato = false;
    c.inPrep = false;
    save();
    return c;
  }

  function unmarkStandby(id) {
    const c = findClient(id);
    if (!c) return null;
    c.standby = false;
    c.inPrep = true;
    save();
    return c;
  }

  function markInstallato(id) {
    const c = findClient(id);
    if (!c) return null;
    c.installato = true;
    c.standby = false;
    c.inPrep = false;
    save();
    return c;
  }

  function rememberSpedizione(name) {
    const n = toUpper(name);
    if (!n || n === 'CLIENTE STESSO') return;
    if (!savedSpedizioni.some(function (s) { return toUpper(s) === n; })) {
      savedSpedizioni.push(n);
      savedSpedizioni.sort(function (a, b) { return a.localeCompare(b, 'it'); });
    }
  }

  function daysUntil(scadenza) {
    const s = String(scadenza || '').trim();
    let iso = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s;
    else if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(s)) {
      const p = s.split(/[\/.\-]/);
      const y = p[2].length === 2 ? ('20' + p[2]) : p[2];
      iso = y + '-' + String(p[1]).padStart(2, '0') + '-' + String(p[0]).padStart(2, '0');
    } else return null;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.round((new Date(iso + 'T12:00:00') - today) / 86400000);
  }

  function formatScadenza(s) {
    s = String(s || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const p = s.split('-');
      return p[2] + '/' + p[1] + '/' + p[0];
    }
    return s || '—';
  }

  function modelsLabel(c) {
    return (c.modelli || []).map(function (m) {
      return ((m && m.nome) || m || '') + (m && m.qta ? (' ×' + m.qta) : '');
    }).filter(Boolean).join(', ') || '—';
  }

  function cleanAddress(addr) {
    let s = String(addr || '').trim();
    // rimuovi code LED Manager tipiche
    s = s.replace(/\s*contratto\b[\s\S]*$/i, '');
    s = s.replace(/\s*calendarizzato\b[\s\S]*$/i, '');
    s = s.replace(/\s*assegnato\b[\s\S]*$/i, '');
    return s.trim();
  }

  function stats() {
    return {
      total: clients.length,
      prep: getBySection('prep').length,
      note: getBySection('note').length,
      standby: getBySection('standby').length,
      installati: getBySection('installati').length,
      ordini: ordini.length
    };
  }

  function exportBackup() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      clients: clients,
      models: savedModels,
      savedModels: savedModels,
      spedizioni: savedSpedizioni,
      savedSpedizioni: savedSpedizioni,
      ordini: ordini,
      data: clients
    };
  }

  function importFromBackup(data) {
    if (!data || typeof data !== 'object') throw new Error('File non valido');
    // formati supportati: array diretto, {clients}, {data}, backup desktop completo
    let list = null;
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data.clients)) list = data.clients;
    else if (Array.isArray(data.data)) list = data.data;
    else if (data.note_clienti_data && Array.isArray(data.note_clienti_data)) list = data.note_clienti_data;
    if (!list) throw new Error('Nel file non ci sono clienti riconoscibili');

    clients = list;

    if (Array.isArray(data.models)) savedModels = data.models;
    else if (Array.isArray(data.savedModels)) savedModels = data.savedModels;
    else if (Array.isArray(data.modelli)) savedModels = data.modelli;

    if (Array.isArray(data.spedizioni)) savedSpedizioni = data.spedizioni;
    else if (Array.isArray(data.savedSpedizioni)) savedSpedizioni = data.savedSpedizioni;

    if (Array.isArray(data.ordini)) ordini = data.ordini;

    // se il backup desktop ha messo tutto in localStorage-like keys
    try {
      if (data.localStorage && typeof data.localStorage === 'object') {
        const ls = data.localStorage;
        if (ls.note_clienti_data) {
          const parsed = typeof ls.note_clienti_data === 'string' ? JSON.parse(ls.note_clienti_data) : ls.note_clienti_data;
          if (Array.isArray(parsed)) clients = parsed;
        }
        if (ls.note_clienti_modelli) {
          const parsed = typeof ls.note_clienti_modelli === 'string' ? JSON.parse(ls.note_clienti_modelli) : ls.note_clienti_modelli;
          if (Array.isArray(parsed)) savedModels = parsed;
        }
        if (ls.note_clienti_spedizioni) {
          const parsed = typeof ls.note_clienti_spedizioni === 'string' ? JSON.parse(ls.note_clienti_spedizioni) : ls.note_clienti_spedizioni;
          if (Array.isArray(parsed)) savedSpedizioni = parsed;
        }
        if (ls.note_clienti_ordini) {
          const parsed = typeof ls.note_clienti_ordini === 'string' ? JSON.parse(ls.note_clienti_ordini) : ls.note_clienti_ordini;
          if (Array.isArray(parsed)) ordini = parsed;
        }
      }
    } catch (e) {}

    save();
    try { localStorage.setItem('note_clienti_last_backup', new Date().toISOString()); } catch (e) {}
    return {
      clients: clients.length,
      models: savedModels.length,
      spedizioni: savedSpedizioni.length,
      ordini: ordini.length
    };
  }

  const Engine = {
    KEYS: KEYS,
    load: load,
    save: save,
    onChange: onChange,
    getState: getState,
    getClients: function () { return clients.slice(); },
    getOrdini: function () { return ordini.slice(); },
    getModels: function () { return savedModels.slice(); },
    getSpedizioni: function () { return savedSpedizioni.slice(); },
    findClient: findClient,
    sectionOf: sectionOf,
    isInPrep: isInPrep,
    isNote: isNote,
    isStandby: isStandby,
    isInstallato: isInstallato,
    getBySection: getBySection,
    searchClients: searchClients,
    updateClient: updateClient,
    deleteClient: deleteClient,
    moveToNote: moveToNote,
    moveToPrep: moveToPrep,
    markStandby: markStandby,
    unmarkStandby: unmarkStandby,
    markInstallato: markInstallato,
    daysUntil: daysUntil,
    formatScadenza: formatScadenza,
    modelsLabel: modelsLabel,
    cleanAddress: cleanAddress,
    stats: stats,
    exportBackup: exportBackup,
    importFromBackup: importFromBackup,
    toUpper: toUpper
  };

  global.AppEngine = Engine;
})(typeof window !== 'undefined' ? window : this);
