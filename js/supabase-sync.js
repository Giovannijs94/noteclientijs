/**
 * Sync Note Clienti ↔ Supabase (progetto privato dell'utente)
 * Tabella attesa: note_clienti_sync (id text PK, data jsonb, updated_at timestamptz)
 */
(function (global) {
  'use strict';

  var KEYS = {
    url: 'note_clienti_supabase_url',
    key: 'note_clienti_supabase_key',
    rowId: 'note_clienti_supabase_row'
  };

  function loadConfig() {
    try {
      return {
        url: (localStorage.getItem(KEYS.url) || '').replace(/\/+$/, ''),
        key: localStorage.getItem(KEYS.key) || '',
        rowId: localStorage.getItem(KEYS.rowId) || 'main'
      };
    } catch (e) {
      return { url: '', key: '', rowId: 'main' };
    }
  }

  function saveConfig(cfg) {
    cfg = cfg || {};
    try {
      if (cfg.url != null) localStorage.setItem(KEYS.url, String(cfg.url).replace(/\/+$/, ''));
      if (cfg.key != null) localStorage.setItem(KEYS.key, String(cfg.key));
      if (cfg.rowId != null) localStorage.setItem(KEYS.rowId, String(cfg.rowId || 'main'));
    } catch (e) {}
  }

  function clearConfig() {
    try {
      localStorage.removeItem(KEYS.url);
      localStorage.removeItem(KEYS.key);
    } catch (e) {}
  }

  function isConfigured() {
    var c = loadConfig();
    return !!(c.url && c.key);
  }

  function headers(cfg) {
    return {
      'apikey': cfg.key,
      'Authorization': 'Bearer ' + cfg.key,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  function restBase(cfg) {
    return cfg.url + '/rest/v1/note_clienti_sync';
  }

  /**
   * payload: oggetto completo backup { clients, models, spedizioni, ordini, ... }
   */
  async function pushPayload(payload) {
    var cfg = loadConfig();
    if (!cfg.url || !cfg.key) throw new Error('Supabase non configurato (URL e chiave anon)');
    var body = {
      id: cfg.rowId || 'main',
      data: payload,
      updated_at: new Date().toISOString()
    };
    var res = await fetch(restBase(cfg) + '?on_conflict=id', {
      method: 'POST',
      headers: Object.assign({}, headers(cfg), {
        'Prefer': 'resolution=merge-duplicates,return=representation'
      }),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var t = '';
      try { t = await res.text(); } catch (e) {}
      throw new Error('Upload fallito (' + res.status + '): ' + String(t).slice(0, 240));
    }
    var rows = [];
    try { rows = await res.json(); } catch (e) {}
    return (rows && rows[0]) || body;
  }

  async function pullPayload() {
    var cfg = loadConfig();
    if (!cfg.url || !cfg.key) throw new Error('Supabase non configurato (URL e chiave anon)');
    var q = restBase(cfg) + '?id=eq.' + encodeURIComponent(cfg.rowId || 'main') + '&select=id,data,updated_at';
    var res = await fetch(q, {
      method: 'GET',
      headers: headers(cfg)
    });
    if (!res.ok) {
      var t = '';
      try { t = await res.text(); } catch (e) {}
      throw new Error('Download fallito (' + res.status + '): ' + String(t).slice(0, 240));
    }
    var rows = await res.json();
    if (!rows || !rows.length) throw new Error('Nessun dato sul cloud (carica prima un backup da un dispositivo)');
    return rows[0];
  }

  global.NoteClientiSupabase = {
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    isConfigured: isConfigured,
    pushPayload: pushPayload,
    pullPayload: pullPayload,
    setupSql:
      '-- Esegui nell\'SQL Editor di Supabase:\n' +
      'create table if not exists note_clienti_sync (\n' +
      '  id text primary key,\n' +
      '  data jsonb not null,\n' +
      '  updated_at timestamptz default now()\n' +
      ');\n' +
      'alter table note_clienti_sync enable row level security;\n' +
      '-- Policy semplice per uso interno (solo chi ha URL+chiave del TUO progetto):\n' +
      'create policy \"note_clienti_sync_all\" on note_clienti_sync\n' +
      '  for all using (true) with check (true);\n'
  };
})(typeof window !== 'undefined' ? window : this);
