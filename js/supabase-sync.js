/**
 * Sync Note Clienti ↔ Supabase + auto-sync
 * Tabella: public.note_clienti_sync (id text PK, data jsonb, updated_at timestamptz)
 */
(function (global) {
  'use strict';

  var KEYS = {
    url: 'note_clienti_supabase_url',
    key: 'note_clienti_supabase_key',
    rowId: 'note_clienti_supabase_row',
    auto: 'note_clienti_supabase_auto',
    lastPush: 'note_clienti_supabase_last_push',
    lastPull: 'note_clienti_supabase_last_pull'
  };

  var _pushTimer = null;
  var _pushing = false;
  var _payloadProvider = null;

  function normalizeUrl(raw) {
    var u = String(raw || '').trim();
    u = u.replace(/[\r\n\t]/g, '').replace(/\s+/g, '');
    u = u.replace(/^['"]|['"]$/g, '');
    u = u.replace(/\/+$/, '');
    u = u.replace(/\/rest\/v1.*$/i, '');
    u = u.replace(/\/+$/, '');
    if (/supabase\.com\/dashboard/i.test(u)) {
      throw new Error('URL dashboard non valido. Usa Project URL: https://CODICE.supabase.co');
    }
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  function loadConfig() {
    try {
      var url = '';
      try { url = normalizeUrl(localStorage.getItem(KEYS.url) || ''); }
      catch (e) { url = String(localStorage.getItem(KEYS.url) || '').replace(/\/+$/, ''); }
      return {
        url: url,
        key: String(localStorage.getItem(KEYS.key) || '').trim().replace(/^['"]|['"]$/g, ''),
        rowId: (localStorage.getItem(KEYS.rowId) || 'main').trim() || 'main',
        auto: localStorage.getItem(KEYS.auto) === '1'
      };
    } catch (e) {
      return { url: '', key: '', rowId: 'main', auto: false };
    }
  }

  function saveConfig(cfg) {
    cfg = cfg || {};
    try {
      if (cfg.url != null) localStorage.setItem(KEYS.url, normalizeUrl(cfg.url));
      if (cfg.key != null) localStorage.setItem(KEYS.key, String(cfg.key).trim().replace(/^['"]|['"]$/g, ''));
      if (cfg.rowId != null) localStorage.setItem(KEYS.rowId, String(cfg.rowId || 'main').trim() || 'main');
      if (cfg.auto != null) localStorage.setItem(KEYS.auto, cfg.auto ? '1' : '0');
    } catch (e) {
      if (e && e.message) throw e;
    }
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

  function isAutoEnabled() {
    return loadConfig().auto === true;
  }

  function headers(cfg, prefer) {
    var h = {
      'apikey': cfg.key,
      'Authorization': 'Bearer ' + cfg.key,
      'Content-Type': 'application/json'
    };
    if (prefer) h['Prefer'] = prefer;
    return h;
  }

  function tableUrl(cfg) {
    return normalizeUrl(cfg.url) + '/rest/v1/note_clienti_sync';
  }

  function friendlyHttpError(status, body, action, requestUrl) {
    var msg = String(body || '');
    var base =
      action + ' fallito (' + status + ')\n' +
      'URL usato: ' + (requestUrl || '—') + '\n\n';
    if (status === 404 || /PGRST125|Invalid path/i.test(msg)) {
      return base +
        'La API non trova la tabella.\n' +
        '• Project URL deve essere https://xxxxx.supabase.co\n' +
        '• Esegui lo script SQL completo\n' +
        'Dettaglio: ' + msg.slice(0, 180);
    }
    if (status === 401 || status === 403) {
      return base + 'Permesso negato. Verifica chiave anon e GRANT/RLS.\n' + msg.slice(0, 180);
    }
    return base + msg.slice(0, 280);
  }

  async function testConnection() {
    var cfg = loadConfig();
    if (!cfg.url || !cfg.key) throw new Error('Configura prima URL e chiave, poi Salva.');
    var url = tableUrl(cfg) + '?select=id&limit=1';
    var res = await fetch(url, { method: 'GET', headers: headers(cfg) });
    var t = '';
    try { t = await res.text(); } catch (e) {}
    if (!res.ok) throw new Error(friendlyHttpError(res.status, t, 'Test', url));
    var rows = [];
    try { rows = JSON.parse(t); } catch (e) {}
    return {
      ok: true,
      url: url,
      projectUrl: cfg.url,
      rows: Array.isArray(rows) ? rows.length : 0,
      message: 'Connessione OK. Tabella raggiungibile (righe: ' + (Array.isArray(rows) ? rows.length : 0) + '). Auto-sync: ' + (cfg.auto ? 'ON' : 'OFF')
    };
  }

  async function pushPayload(payload) {
    var cfg = loadConfig();
    if (!cfg.url || !cfg.key) throw new Error('Supabase non configurato (URL e chiave anon)');

    var body = {
      id: cfg.rowId || 'main',
      data: payload,
      updated_at: new Date().toISOString()
    };

    var urlUpsert = tableUrl(cfg) + '?on_conflict=id';
    var res = await fetch(urlUpsert, {
      method: 'POST',
      headers: headers(cfg, 'resolution=merge-duplicates,return=representation'),
      body: JSON.stringify(body)
    });
    if (res.ok) {
      try { localStorage.setItem(KEYS.lastPush, body.updated_at); localStorage.setItem(KEYS.lastPull, body.updated_at); } catch (e) {}
      var rows = [];
      try { rows = await res.json(); } catch (e) {}
      return (rows && rows[0]) || body;
    }
    var errText = '';
    try { errText = await res.text(); } catch (e) {}

    var urlInsert = tableUrl(cfg);
    var res2 = await fetch(urlInsert, {
      method: 'POST',
      headers: headers(cfg, 'return=representation'),
      body: JSON.stringify(body)
    });
    if (res2.ok) {
      try { localStorage.setItem(KEYS.lastPush, body.updated_at); localStorage.setItem(KEYS.lastPull, body.updated_at); } catch (e) {}
      var rows2 = [];
      try { rows2 = await res2.json(); } catch (e) {}
      return (rows2 && rows2[0]) || body;
    }

    var urlPatch = tableUrl(cfg) + '?id=eq.' + encodeURIComponent(cfg.rowId || 'main');
    var res3 = await fetch(urlPatch, {
      method: 'PATCH',
      headers: headers(cfg, 'return=representation'),
      body: JSON.stringify({ data: payload, updated_at: body.updated_at })
    });
    if (res3.ok) {
      try { localStorage.setItem(KEYS.lastPush, body.updated_at); localStorage.setItem(KEYS.lastPull, body.updated_at); } catch (e) {}
      var rows3 = [];
      try { rows3 = await res3.json(); } catch (e) {}
      return (rows3 && rows3[0]) || body;
    }
    var t3 = '';
    try { t3 = await res3.text(); } catch (e) {}
    throw new Error(friendlyHttpError(res3.status || res.status, t3 || errText, 'Upload', urlUpsert));
  }

  async function pullPayload() {
    var cfg = loadConfig();
    if (!cfg.url || !cfg.key) throw new Error('Supabase non configurato (URL e chiave anon)');
    var q = tableUrl(cfg) + '?id=eq.' + encodeURIComponent(cfg.rowId || 'main') + '&select=id,data,updated_at';
    var res = await fetch(q, { method: 'GET', headers: headers(cfg) });
    if (!res.ok) {
      var t = '';
      try { t = await res.text(); } catch (e) {}
      throw new Error(friendlyHttpError(res.status, t, 'Download', q));
    }
    var rows = await res.json();
    if (!rows || !rows.length) throw new Error('Nessun dato sul cloud (carica prima da un dispositivo).');
    return rows[0];
  }

  /** Registra una funzione che restituisce il payload backup corrente */
  function setPayloadProvider(fn) {
    _payloadProvider = typeof fn === 'function' ? fn : null;
  }

  /**
   * Dopo ogni salvataggio locale: se auto-sync ON, carica sul cloud dopo debounce.
   * delayMs default 4000
   */
  function scheduleAutoPush(delayMs) {
    if (!isConfigured() || !isAutoEnabled()) return;
    if (typeof _payloadProvider !== 'function') return;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(function () {
      runAutoPush();
    }, typeof delayMs === 'number' ? delayMs : 2000);
  }

  async function runAutoPush() {
    if (!isConfigured() || !isAutoEnabled()) return;
    if (_pushing) return;
    if (typeof _payloadProvider !== 'function') return;
    _pushing = true;
    try {
      var payload = _payloadProvider();
      if (!payload) return;
      await pushPayload(payload);
      try {
        if (typeof global.dispatchEvent === 'function') {
          global.dispatchEvent(new CustomEvent('note-clienti-cloud-pushed', { detail: { at: new Date().toISOString() } }));
        }
      } catch (e) {}
    } catch (err) {
      console.warn('[auto-sync push]', err);
    } finally {
      _pushing = false;
    }
  }

  /**
   * All'apertura app: se cloud più recente dell'ultimo pull/push locale, scarica.
   * applyFn(data) deve applicare i dati in locale.
   * silent: se true non chiede conferma (default false → chiede)
   */

  async function fetchCloudRow() {
    var cfg = loadConfig();
    if (!cfg.url || !cfg.key) throw new Error('Supabase non configurato');
    var q = tableUrl(cfg) + '?id=eq.' + encodeURIComponent(cfg.rowId || 'main') + '&select=id,data,updated_at';
    var res = await fetch(q, { method: 'GET', headers: headers(cfg), cache: 'no-store' });
    if (!res.ok) {
      var t = '';
      try { t = await res.text(); } catch (e) {}
      throw new Error(friendlyHttpError(res.status, t, 'Download', q));
    }
    var rows = await res.json();
    if (!rows || !rows.length) return null;
    return rows[0];
  }

  async function autoPullIfNewer(applyFn, opts) {
    opts = opts || {};
    if (!isConfigured() || !isAutoEnabled()) return { skipped: true, reason: 'auto off' };
    if (typeof applyFn !== 'function') return { skipped: true, reason: 'no apply' };
    try {
      var row = await fetchCloudRow();
      if (!row) return { skipped: true, reason: 'cloud vuoto' };

      var cloudStamp = String(row.updated_at || '');
      var lastSeen = '';
      try { lastSeen = localStorage.getItem(KEYS.lastPull) || ''; } catch (e) {}

      // se abbiamo già applicato esattamente questo aggiornamento cloud, salta
      if (cloudStamp && lastSeen && cloudStamp === lastSeen) {
        return { skipped: true, reason: 'già applicato' };
      }

      // se lastSeen è più recente del cloud (clock skew minimo), salta
      var cloudAt = cloudStamp ? Date.parse(cloudStamp) : 0;
      var seenAt = lastSeen ? Date.parse(lastSeen) : 0;
      if (cloudAt && seenAt && cloudAt <= seenAt) {
        return { skipped: true, reason: 'locale uguale/più nuovo' };
      }

      if (!opts.silent) {
        var ok = confirm(
          'Cloud più aggiornato trovato.
Aggiornato: ' + (row.updated_at || '—') +
          '

Scaricare ora i dati sul dispositivo?'
        );
        if (!ok) return { skipped: true, reason: 'rifiutato' };
      }

      applyFn(row.data);
      try { localStorage.setItem(KEYS.lastPull, cloudStamp || new Date().toISOString()); } catch (e) {}
      return { ok: true, updated_at: row.updated_at };
    } catch (err) {
      console.warn('[auto-sync pull]', err);
      return { error: err && err.message ? err.message : String(err) };
    }
  }

  var _liveTimer = null;
  var _liveApplyFn = null;
  var _liveRunning = false;
  var _liveOnApplied = null;

  /**
   * Durante l'uso: controlla spesso il cloud + quando l'app torna visibile.
   * Default: ogni 20 secondi.
   */
  function startAutoSyncLoop(applyFn, opts) {
    opts = opts || {};
    _liveApplyFn = typeof applyFn === 'function' ? applyFn : null;
    _liveOnApplied = typeof opts.onApplied === 'function' ? opts.onApplied : null;
    var intervalMs = typeof opts.intervalMs === 'number' ? opts.intervalMs : 20000;

    function tick(reason) {
      if (!isConfigured() || !isAutoEnabled()) return;
      if (!_liveApplyFn) return;
      if (_liveRunning) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      _liveRunning = true;
      autoPullIfNewer(function (data) {
        try {
          _liveApplyFn(data);
          if (_liveOnApplied) _liveOnApplied(data);
        } catch (e) { console.warn(e); }
      }, { silent: true }).then(function (r) {
        if (r && r.ok) console.log('[auto-sync live]', reason || 'tick', r.updated_at);
      }).finally(function () {
        _liveRunning = false;
      });
    }

    if (_liveTimer) clearInterval(_liveTimer);
    _liveTimer = setInterval(function () { tick('interval'); }, intervalMs);

    function onVis() {
      if (document.visibilityState === 'visible') tick('visible');
    }
    function onFocus() { tick('focus'); }
    function onOnline() { tick('online'); }

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    // controlli rapidi all'avvio
    setTimeout(function () { tick('t3s'); }, 3000);
    setTimeout(function () { tick('t8s'); }, 8000);

    return function stop() {
      if (_liveTimer) clearInterval(_liveTimer);
      _liveTimer = null;
    };
  }

  global.NoteClientiSupabase = {

    loadConfig: loadConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    isConfigured: isConfigured,
    isAutoEnabled: isAutoEnabled,
    pushPayload: pushPayload,
    pullPayload: pullPayload,
    testConnection: testConnection,
    normalizeUrl: normalizeUrl,
    setPayloadProvider: setPayloadProvider,
    scheduleAutoPush: scheduleAutoPush,
    runAutoPush: runAutoPush,
    autoPullIfNewer: autoPullIfNewer,
    startAutoSyncLoop: startAutoSyncLoop,
    setupSql:
      '-- SQL Editor → Run\n' +
      'create table if not exists public.note_clienti_sync (\n' +
      '  id text primary key,\n' +
      '  data jsonb not null,\n' +
      '  updated_at timestamptz default now()\n' +
      ');\n\n' +
      'alter table public.note_clienti_sync enable row level security;\n\n' +
      'drop policy if exists \"note_clienti_sync_all\" on public.note_clienti_sync;\n' +
      'create policy \"note_clienti_sync_all\" on public.note_clienti_sync\n' +
      '  for all to anon, authenticated using (true) with check (true);\n\n' +
      'grant usage on schema public to anon, authenticated;\n' +
      'grant select, insert, update, delete on table public.note_clienti_sync to anon, authenticated;\n\n' +
      'notify pgrst, \'reload schema\';\n'
  };
})(typeof window !== 'undefined' ? window : this);
