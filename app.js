// Sarasota Home Show kiosk: one iPad, two franchises.
// Talks to the Apps Script web app described in API.md. When the network is
// down it routes with OfflineRouting (rules 1-3) and queues submissions.
(function () {
  'use strict';

  // ── Settings ──
  var params = new URLSearchParams(location.search);
  var API_URL = params.get('api') || CONFIG.API_URL;
  var API_READY = !!API_URL && API_URL.indexOf('REPLACE') !== 0;
  var PLACES_KEY = params.get('placeskey') || CONFIG.PLACES_KEY;
  var PLACES_ON = params.get('places') !== 'off' && !!PLACES_KEY && PLACES_KEY.indexOf('REPLACE') !== 0;
  var IDLE_SECONDS = Number(params.get('idle')) || CONFIG.IDLE_SECONDS || 90;
  var IDLE_COUNTDOWN = Number(params.get('idlecount')) || 10;
  // Apps Script can take ~17 s on a cold start (~2.5 s warm). Waiting longer is
  // safe: a retried submit with the same lead id is ignored by the server.
  var TIMEOUT_MS = 25000;
  var RETRY_MS = 30000;

  var LS = { queue: 'bbbss_queue', all: 'bbbss_all', config: 'bbbss_config', pinHash: 'bbbss_pin_hash' };

  var DEFAULT_CONFIG = {
    franchises: {
      tampa: { name: 'Bumble Bee Blinds of Tampa', phone: '(813) 599-8175', promo: 'BB185' },
      venice: { name: 'Bumble Bee Blinds of Wellen Park', phone: '(941) 398-0648', promo: 'BB176' }
    },
    slots: ['9 AM - 12 PM', '12 PM - 3 PM', '3 PM - 6 PM', '6 PM - 9 PM'],
    showDates: ['2026-09-11', '2026-09-12', '2026-09-13'],
    daysAhead: 30,
    maxPerDay: 2
  };
  var SLOT_NOTES = { '9 AM - 12 PM': 'Morning', '12 PM - 3 PM': 'Midday', '3 PM - 6 PM': 'Afternoon', '6 PM - 9 PM': 'Evening' };

  // [value sent to the Sheet, description, SVG icon body]
  var PRODUCTS = [
    ['Shutters', 'Plantation & composite', '<rect x="6" y="4" width="36" height="40" rx="2"/><line x1="10" y1="12" x2="38" y2="12"/><line x1="10" y1="20" x2="38" y2="20"/><line x1="10" y1="28" x2="38" y2="28"/><line x1="10" y1="36" x2="38" y2="36"/><line x1="24" y1="4" x2="24" y2="44"/>'],
    ['Cellular Shades', 'Honeycomb insulation', '<rect x="6" y="2" width="36" height="6" rx="1"/><path d="M10 14 L18 8 L26 14 L34 8 L38 11"/><path d="M10 14 L18 20 L26 14 L34 20 L38 17"/><path d="M10 22 L18 28 L26 22 L34 28 L38 25"/><path d="M10 30 L18 36 L26 30 L34 36 L38 33"/><line x1="10" y1="8" x2="10" y2="36"/><line x1="38" y1="8" x2="38" y2="36"/>'],
    ['Roller Shades', 'Solar, blackout & more', '<rect x="8" y="4" width="32" height="8" rx="4"/><rect x="10" y="12" width="28" height="28" rx="1"/><circle cx="24" cy="43" r="2"/>'],
    ['Roman Shades', 'Elegant fabric folds', '<rect x="6" y="2" width="36" height="6" rx="1"/><line x1="6" y1="8" x2="6" y2="44"/><line x1="42" y1="8" x2="42" y2="44"/><path d="M6 18 Q24 14 42 18"/><path d="M6 28 Q24 24 42 28"/><path d="M6 38 Q24 32 42 38"/><line x1="6" y1="44" x2="42" y2="44"/>'],
    ['Drapery', 'Custom drapes & curtains', '<line x1="4" y1="4" x2="44" y2="4"/><path d="M8 4 Q6 24 10 44"/><path d="M16 4 Q12 20 14 44"/><path d="M8 4 Q12 16 16 4"/><path d="M32 4 Q36 20 34 44"/><path d="M40 4 Q42 24 38 44"/><path d="M32 4 Q36 16 40 4"/>'],
    ['Outdoor Shades', 'Lanai & patio', '<circle cx="38" cy="10" r="5"/><rect x="4" y="6" width="28" height="4" rx="1"/><rect x="6" y="10" width="24" height="32" rx="1"/><line x1="6" y1="18" x2="30" y2="18"/><line x1="6" y1="26" x2="30" y2="26"/><line x1="6" y1="34" x2="30" y2="34"/>'],
    ['Motorization', 'Smart home & voice', '<rect x="12" y="6" width="24" height="36" rx="4"/><circle cx="24" cy="36" r="2"/><path d="M20 20 L24 16 L28 20"/><path d="M20 26 L24 22 L28 26"/><path d="M6 16 Q2 24 6 32"/><path d="M42 16 Q46 24 42 32"/>'],
    ['Sheer Shades', 'Light filtering views', '<rect x="8" y="4" width="32" height="6" rx="2"/><rect x="10" y="10" width="28" height="32" rx="1" stroke-dasharray="4 3"/><line x1="10" y1="18" x2="38" y2="18" stroke-dasharray="4 3"/><line x1="10" y1="26" x2="38" y2="26" stroke-dasharray="4 3"/><line x1="10" y1="34" x2="38" y2="34" stroke-dasharray="4 3"/>'],
    ['Banded Shades', 'Dual-layer control', '<rect x="8" y="4" width="32" height="6" rx="2"/><line x1="8" y1="10" x2="8" y2="42"/><line x1="40" y1="10" x2="40" y2="42"/><rect x="10" y="12" width="28" height="6" rx="1"/><rect x="10" y="22" width="28" height="6" rx="1"/><rect x="10" y="32" width="28" height="6" rx="1"/>'],
    ['Smart Drapes', 'Motorized curtains', '<line x1="4" y1="4" x2="44" y2="4"/><path d="M8 4 Q10 24 12 44"/><path d="M20 4 Q18 20 20 44"/><path d="M28 4 Q30 20 28 44"/><path d="M40 4 Q38 24 36 44"/><path d="M32 14 Q36 10 40 14"/>'],
    ['Natural Woven Shades', 'Bamboo & organic', '<rect x="8" y="4" width="32" height="6" rx="2"/><path d="M10 14 H38 M10 20 H38 M10 26 H38 M10 32 H38 M10 38 H38"/><path d="M14 10 V42 M22 10 V42 M30 10 V42 M38 10 V42"/>'],
    ['Not Sure - Need Help', 'I\'d like expert guidance', '<circle cx="24" cy="24" r="18"/><path d="M18 18 Q18 12 24 12 Q30 12 30 18 Q30 22 24 24 L24 28"/><circle cx="24" cy="34" r="2" fill="currentColor"/>']
  ];
  var CARD_LABELS = { 'Natural Woven Shades': 'Natural Woven', 'Not Sure - Need Help': 'Not Sure Yet' };
  var TIMELINES = ['Right Away', 'Within 1 Month', '1-3 Months', 'Other'];

  // ── State ──
  var config = loadJSON(LS.config) || DEFAULT_CONFIG;
  var online = true;
  var s = freshState();
  var adminPin = null;

  function freshState() {
    return {
      type: null, products: {}, timeline: '', skipZip: false,
      addressVerified: false, lat: null, lng: null,
      routed: null, offlineRoute: null, offlineBooking: false,
      availability: {}, date: null, time: null
    };
  }

  // ── Helpers ──
  function $(id) { return document.getElementById(id); }
  function loadJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function saveJSON(key, v) { localStorage.setItem(key, JSON.stringify(v)); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseYmd(str) { var p = str.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function prettyDate(str) {
    return parseYmd(str).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  // Slots are stored as '3 PM - 6 PM', but the designer arrives at the start
  // time and the visit runs 2-3 hours, so customers only ever see '3 PM'.
  function arrival(label) { return String(label || '').split(' - ')[0]; }
  function brand(fr) { return (config.franchises && config.franchises[fr]) || DEFAULT_CONFIG.franchises[fr]; }
  function shortName(fr) { return fr === 'tampa' ? 'Tampa' : 'Venice'; }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function busy(on, text) {
    $('busyText').textContent = text || 'One moment…';
    $('busy').classList.toggle('on', !!on);
  }

  // ── Network ──
  // Throws on network failure/timeout (= offline). Server-side errors come back
  // as {ok:false, error} and are returned, not thrown.
  function api(payload, query) {
    if (!API_READY) return Promise.reject(new Error('NO_API'));
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    var req = query
      ? fetch(API_URL + (API_URL.indexOf('?') === -1 ? '?' : '&') + query, { redirect: 'follow', signal: ctrl.signal })
      : fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow', signal: ctrl.signal });
    return req.then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      setOnline(true);
      return data;
    }, function (err) {
      setOnline(false);
      throw err;
    }).finally(function () { clearTimeout(timer); });
  }

  function setOnline(v) { online = v; renderStatus(); }

  function renderStatus() {
    var q = (loadJSON(LS.queue) || []).length;
    var pill = $('statusPill');
    pill.classList.remove('offline', 'queued');
    var text;
    if (!API_READY) { text = 'Not connected'; pill.classList.add('offline'); }
    else if (!online || navigator.onLine === false) { text = 'Offline'; pill.classList.add('offline'); }
    else text = 'Online';
    if (q) { text += ' · ' + q + ' queued'; if (!pill.classList.contains('offline')) pill.classList.add('queued'); }
    $('statusText').textContent = text;
  }

  function loadConfig() {
    return api(null, 'action=config').then(function (c) {
      if (c && c.ok) { config = c; saveJSON(LS.config, c); }
    }).catch(function () { /* keep cached config */ });
  }

  // ── Queue ──
  function recordAll(entry) {
    var all = loadJSON(LS.all) || [];
    all.push(entry);
    saveJSON(LS.all, all);
  }
  function updateAll(id, patch) {
    var all = loadJSON(LS.all) || [];
    all.forEach(function (e) { if (e.payload.id === id) Object.assign(e, patch); });
    saveJSON(LS.all, all);
  }
  function enqueue(payload) {
    var q = loadJSON(LS.queue) || [];
    q.push(payload);
    saveJSON(LS.queue, q);
    renderStatus();
  }

  var flushing = false;
  function flushQueue() {
    if (flushing || !API_READY) return Promise.resolve();
    var q = loadJSON(LS.queue) || [];
    if (!q.length) { renderStatus(); return Promise.resolve(); }
    flushing = true;
    var item = q[0];
    return api(item).then(function (res) {
      var rest = (loadJSON(LS.queue) || []).filter(function (p) { return p.id !== item.id; });
      saveJSON(LS.queue, rest);
      if (res && res.ok) updateAll(item.id, { status: 'sent', franchise: res.franchise, serverStatus: res.status });
      else updateAll(item.id, { status: 'rejected: ' + (res && res.error), error: res && res.message });
      flushing = false;
      renderStatus();
      return flushQueue();
    }, function () {
      flushing = false;
      renderStatus();
    });
  }

  // ── Screens ──
  var STEP_COUNT = { booking: 3, later: 2 };
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('active'); });
    $('screen-' + id).classList.add('active');
    $('gear').style.display = id === 'welcome' ? '' : 'none';
    window.scrollTo(0, 0);
    var step = { info: 1, products: 2, slots: 3 }[id];
    if (step) {
      var html = '';
      for (var i = 1; i <= STEP_COUNT[s.type]; i++) html += '<span class="' + (i <= step ? 'on' : '') + '"></span>';
      ['stepsInfo', 'stepsProducts', 'stepsSlots'].forEach(function (sid) { $(sid).innerHTML = html; });
    }
  }

  function start(type) {
    resetForm();
    s.type = type;
    var booking = type === 'booking';
    $('emailOpt').style.display = booking ? 'none' : '';
    $('infoSub').textContent = booking
      ? 'So your local designer can confirm your visit'
      : 'We\'ll send your discount code and follow up when you\'re ready';
    $('btnSkipZip').style.display = booking ? 'none' : '';
    $('timelineBlock').style.display = booking ? 'none' : '';
    $('btnProductsNext').textContent = booking ? 'See available times →' : 'Get my discount code →';
    setSkipZip(false);
    showScreen('info');
  }

  function resetForm() {
    ['fname', 'lname', 'phone', 'email', 'street', 'city', 'zip', 'zip2', 'otherTimeline', 'notes'].forEach(function (id) { $(id).value = ''; });
    document.querySelectorAll('.has-error').forEach(function (el) { el.classList.remove('has-error'); });
    document.querySelectorAll('.card.selected').forEach(function (el) { el.classList.remove('selected'); });
    $('f-otherTimeline').style.display = 'none';
    $('verified').classList.remove('on');
    hideSuggest();
    s = freshState();
  }

  function goWelcome() {
    resetForm();
    closeAdmin();
    showScreen('welcome');
  }

  // ── Info screen ──
  function setSkipZip(on) {
    s.skipZip = on;
    $('addrFull').style.display = on ? 'none' : '';
    $('addrZipOnly').style.display = on ? '' : 'none';
    $('btnSkipZip').textContent = on ? 'Use my full address instead' : 'Skip — just use my zip';
    if (on) $('zip2').value = $('zip').value;
    else if ($('zip2').value) $('zip').value = $('zip2').value;
  }

  function fieldError(id, bad) { $('f-' + id).classList.toggle('has-error', !!bad); return !bad; }

  function validateInfo() {
    var booking = s.type === 'booking';
    var ok = true;
    var email = $('email').value.trim();
    var zip = s.skipZip ? $('zip2').value.trim() : $('zip').value.trim();
    ok = fieldError('fname', !$('fname').value.trim()) && ok;
    ok = fieldError('lname', !$('lname').value.trim()) && ok;
    ok = fieldError('phone', digits($('phone').value).length !== 10) && ok;
    var emailBad = booking ? !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) : (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email));
    ok = fieldError('email', emailBad) && ok;
    if (s.skipZip) {
      ok = fieldError('zip2', !/^\d{5}$/.test(zip)) && ok;
    } else {
      ok = fieldError('zip', !/^\d{5}$/.test(zip)) && ok;
      ok = fieldError('street', booking && !$('street').value.trim()) && ok;
      ok = fieldError('city', booking && !$('city').value.trim()) && ok;
    }
    if (!ok) {
      var first = document.querySelector('#screen-info .has-error');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return ok;
  }

  function leadFields() {
    var zip = s.skipZip ? $('zip2').value.trim() : $('zip').value.trim();
    var verified = !s.skipZip && s.addressVerified;
    return {
      fname: $('fname').value.trim(),
      lname: $('lname').value.trim(),
      phone: digits($('phone').value),
      email: $('email').value.trim(),
      street: s.skipZip ? '' : $('street').value.trim(),
      city: s.skipZip ? '' : $('city').value.trim(),
      zip: zip,
      lat: verified ? s.lat : null,
      lng: verified ? s.lng : null,
      addressVerified: verified
    };
  }

  // ── Products / timeline ──
  function buildCards() {
    $('productGrid').innerHTML = PRODUCTS.map(function (p) {
      return '<button type="button" class="card" data-product="' + esc(p[0]) + '">' +
        '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' + p[2] + '</svg>' +
        '<div class="c-name">' + esc(CARD_LABELS[p[0]] || p[0]) + '</div>' +
        '<div class="c-desc">' + esc(p[1]) + '</div></button>';
    }).join('');
    $('timelineGrid').innerHTML = TIMELINES.map(function (t) {
      return '<button type="button" class="card" data-timeline="' + esc(t) + '">' + esc(t === '1-3 Months' ? '1 – 3 Months' : t) + '</button>';
    }).join('');
    $('productGrid').addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      card.classList.toggle('selected');
      var name = card.dataset.product;
      if (s.products[name]) delete s.products[name]; else s.products[name] = true;
    });
    $('timelineGrid').addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      document.querySelectorAll('#timelineGrid .card').forEach(function (c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      s.timeline = card.dataset.timeline;
      var other = s.timeline === 'Other';
      $('f-otherTimeline').style.display = other ? '' : 'none';
      if (other) $('otherTimeline').focus();
    });
  }

  function productsNext() {
    if (!Object.keys(s.products).length) { toast('Please pick at least one product (or "Not Sure Yet")'); return; }
    if (s.type === 'later') {
      if (!s.timeline) { toast('Please pick your timeline'); return; }
      if (s.timeline === 'Other' && !$('otherTimeline').value.trim()) { toast('Please tell us your timeline'); return; }
      submitLater();
    } else {
      routeBooking();
    }
  }

  function timelineValue() {
    if (s.type !== 'later') return '';
    return s.timeline === 'Other' ? 'Other: ' + $('otherTimeline').value.trim() : s.timeline;
  }

  function basePayload() {
    var f = leadFields();
    return Object.assign({
      action: 'submit', id: uuid(), createdAt: new Date().toISOString(), type: s.type,
      products: Object.keys(s.products), timeline: timelineValue(), notes: '',
      date: '', time: '', routed: null, offline: false, offlineRoute: null
    }, f);
  }

  function localRoute(f) {
    return OfflineRouting.routeOffline(f.zip, f.lat, f.lng, f.addressVerified);
  }

  // ── Later lead ──
  function submitLater() {
    var payload = basePayload();
    busy(true, 'Saving…');
    api(payload).then(function (res) {
      busy(false);
      if (res && res.ok) {
        recordAll({ payload: payload, status: 'sent', franchise: res.franchise, at: payload.createdAt });
        showThanks({ franchise: res.franchise, status: res.status });
      } else {
        queueOffline(payload, res && res.error);
      }
    }, function () {
      busy(false);
      queueOffline(payload);
    });
  }

  // Server unreachable (or a server error): route locally, queue, still thank them.
  function queueOffline(payload, serverError) {
    var r = localRoute(payload);
    payload.offline = true;
    payload.offlineRoute = { franchise: r.franchise, reason: r.reason, flags: r.flags };
    enqueue(payload);
    recordAll({ payload: payload, status: 'queued', franchise: r.franchise, at: payload.createdAt, error: serverError || '' });
    showThanks({ franchise: r.franchise, status: payload.type === 'booking' ? 'QUEUED_BOOKING' : 'QUEUED' });
  }

  // ── Booking ──
  function routeBooking() {
    var f = leadFields();
    busy(true, 'Finding your local designer…');
    api({ action: 'route', type: 'booking', zip: f.zip, lat: f.lat, lng: f.lng, addressVerified: f.addressVerified })
      .then(function (res) {
        busy(false);
        if (res && res.ok) {
          s.routed = { franchise: res.franchise, reason: res.reason, flags: res.flags || [], countsTowardSplit: !!res.countsTowardSplit };
          s.offlineBooking = false;
          s.availability = res.availability || {};
          openSlots(res.franchise);
        } else {
          offlineBooking(f);
        }
      }, function () {
        busy(false);
        offlineBooking(f);
      });
  }

  function offlineBooking(f) {
    var r = localRoute(f);
    s.routed = null;
    s.offlineRoute = { franchise: r.franchise, reason: r.reason, flags: r.flags };
    s.offlineBooking = true;
    s.availability = {};
    windowDates().forEach(function (d) {
      s.availability[d] = config.showDates.indexOf(d) !== -1 ? [] : config.slots.slice();
    });
    openSlots(r.franchise);
  }

  function windowDates() {
    var out = [];
    var d = new Date();
    for (var i = 1; i <= (config.daysAhead || 30); i++) {
      out.push(ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)));
    }
    return out;
  }

  function openSlots(franchise) {
    s.date = null; s.time = null;
    $('designerName').textContent = brand(franchise).name;
    $('offlineBanner').classList.toggle('on', s.offlineBooking);
    renderDates();
    renderSlots();
    showScreen('slots');
  }

  function renderDates() {
    $('dateGrid').innerHTML = windowDates().map(function (d) {
      var open = (s.availability[d] || []).length > 0;
      var dt = parseYmd(d);
      var isShow = config.showDates.indexOf(d) !== -1;
      return '<button type="button" class="date' + (s.date === d ? ' selected' : '') + '" data-date="' + d + '"' + (open ? '' : ' disabled') + '>' +
        '<span class="dw">' + dt.toLocaleDateString('en-US', { weekday: 'short' }) + '</span>' +
        '<span class="dd">' + dt.getDate() + '</span>' +
        (open ? '<span class="dm">' + dt.toLocaleDateString('en-US', { month: 'short' }) + '</span>'
          : '<span class="dx">' + (isShow ? 'Show' : 'Full') + '</span>') +
        '</button>';
    }).join('');
  }

  function renderSlots() {
    var has = !!s.date;
    $('slotBlock').style.display = has ? '' : 'none';
    $('slotHint').style.display = has ? 'none' : '';
    $('btnConfirm').disabled = !(s.date && s.time);
    if (!has) return;
    $('slotTitle').textContent = 'Pick a time on ' + prettyDate(s.date);
    var open = s.availability[s.date] || [];
    $('slotGrid').innerHTML = config.slots.map(function (label) {
      var ok = open.indexOf(label) !== -1;
      return '<button type="button" class="slot' + (s.time === label ? ' selected' : '') + '" data-slot="' + esc(label) + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="sl">' + esc(arrival(label)) + '</span>' +
        '<span class="sn">' + (ok ? SLOT_NOTES[label] || '' : 'Booked') + '</span></button>';
    }).join('');
  }

  function confirmBooking() {
    // Disable first, before either branch, so a double-tap can't queue the same
    // appointment twice under two different lead ids. renderSlots() re-enables it.
    if (!s.date || !s.time || $('btnConfirm').disabled) return;
    $('btnConfirm').disabled = true;
    var payload = basePayload();
    payload.date = s.date;
    payload.time = s.time;
    payload.notes = $('notes').value.trim();
    if (s.offlineBooking) {
      queueBooking(payload, s.offlineRoute);
      return;
    }
    payload.routed = s.routed;
    busy(true, 'Booking your appointment…');
    api(payload).then(function (res) {
      busy(false);
      if (res && res.ok) {
        recordAll({ payload: payload, status: 'sent', franchise: res.franchise, at: payload.createdAt });
        showThanks({ franchise: res.franchise, status: res.status, date: payload.date, time: payload.time });
      } else if (res && /^(SLOT_TAKEN|DAY_FULL|DATE_BLOCKED)$/.test(res.error)) {
        toast('That time was just taken — please pick another');
        if (res.availability) s.availability = res.availability;
        else if (s.availability[s.date]) s.availability[s.date] = s.availability[s.date].filter(function (t) { return t !== s.time; });
        if (!(s.availability[s.date] || []).length) s.date = null;
        s.time = null;
        renderDates();
        renderSlots();
      } else {
        queueBooking(payload, s.routed);
      }
    }, function () {
      busy(false);
      queueBooking(payload, s.routed);
    });
  }

  // A queued booking is always sent with offline:true, so if its slot is gone by
  // the time it syncs the server records it as NEEDS CALLBACK instead of dropping it.
  function queueBooking(payload, route) {
    payload.offline = true;
    if (s.routed) payload.routed = s.routed;
    var r = route || localRoute(payload);
    payload.offlineRoute = { franchise: r.franchise, reason: r.reason, flags: r.flags || [] };
    enqueue(payload);
    recordAll({ payload: payload, status: 'queued', franchise: r.franchise, at: payload.createdAt });
    showThanks({ franchise: r.franchise, status: 'QUEUED_BOOKING', date: payload.date, time: payload.time });
  }

  // ── Thank you ──
  function showThanks(o) {
    var b = brand(o.franchise);
    var booked = o.status === 'CONFIRMED' || o.status === 'DUPLICATE' && o.date;
    var pending = o.status === 'QUEUED_BOOKING' || o.status === 'NEEDS_CALLBACK';
    $('thanksTitle').textContent = booked ? 'You\'re booked!' : pending ? 'Thank you! We\'ll call to confirm your time' : 'You\'re all set!';
    if (o.date) {
      $('apptBox').style.display = '';
      $('apptBox').innerHTML = '<strong>' + esc(prettyDate(o.date)) + '</strong>' + esc('Designer arrives at ' + arrival(o.time)) +
        (pending ? '<br><span style="color:var(--muted);font-size:17px">Requested time — we\'ll confirm by phone</span>'
          : '<br><span style="color:var(--muted);font-size:17px">Plan on 2–3 hours if we\'re measuring and quoting</span>');
    } else {
      $('apptBox').style.display = 'none';
    }
    $('promoCode').textContent = b.promo;
    $('promoDetail').textContent = o.date ? 'Your show discount is applied to this consultation' : 'Mention this code when you book your FREE in-home consultation';
    $('whoText').innerHTML = 'Your local designer is <strong>' + esc(b.name) + '</strong><br>Questions? Call <strong>' + esc(b.phone) + '</strong>';
    showScreen('thanks');
  }

  // ── Places autocomplete ──
  var places = null, sessionToken = null, suggestTimer = null, suggestSeq = 0, suggestions = [];

  function initPlaces() {
    if (!PLACES_ON) return;
    window.gm_authFailure = function () { places = null; hideSuggest(); };
    try {
      /* eslint-disable */
      (function (g) { var h, a, k, p = 'The Google Maps JavaScript API', c = 'google', l = 'importLibrary', q = '__ib__', m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(), u = function () { return h || (h = new Promise(function (f, n) { a = m.createElement('script'); e.set('libraries', Array.from(r) + ''); for (k in g) e.set(k.replace(/[A-Z]/g, function (t) { return '_' + t[0].toLowerCase(); }), g[k]); e.set('callback', c + '.maps.' + q); a.src = 'https://maps.' + c + 'apis.com/maps/api/js?' + e; d[q] = f; a.onerror = function () { h = n(Error(p + ' could not load.')); }; m.head.append(a); })); }; d[l] ? console.warn(p + ' only loads once.') : d[l] = function (f) { var n = Array.prototype.slice.call(arguments, 1); r.add(f); return u().then(function () { return d[l].apply(d, [f].concat(n)); }); }; })({ key: PLACES_KEY, v: 'weekly' });
      /* eslint-enable */
      google.maps.importLibrary('places').then(function (lib) {
        places = lib;
        sessionToken = new places.AutocompleteSessionToken();
      }, function () { places = null; });
    } catch (e) { places = null; }
  }

  function hideSuggest() { $('suggest').classList.remove('on'); $('suggest').innerHTML = ''; suggestions = []; }

  function onStreetInput() {
    s.addressVerified = false;
    $('verified').classList.remove('on');
    clearTimeout(suggestTimer);
    var text = $('street').value.trim();
    if (!places || !online || text.length < 3) { hideSuggest(); return; }
    suggestTimer = setTimeout(function () { fetchSuggestions(text); }, 250);
  }

  function fetchSuggestions(text) {
    var seq = ++suggestSeq;
    places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: text,
      sessionToken: sessionToken,
      includedRegionCodes: ['us'],
      locationBias: { center: { lat: 27.2, lng: -82.45 }, radius: 50000 }
    }).then(function (res) {
      if (seq !== suggestSeq) return;
      suggestions = (res.suggestions || []).filter(function (x) { return x.placePrediction; }).slice(0, 5);
      if (!suggestions.length) { hideSuggest(); return; }
      $('suggest').innerHTML = suggestions.map(function (x, i) {
        var p = x.placePrediction;
        var main = p.mainText ? p.mainText.text : p.text.text;
        var sub = p.secondaryText ? p.secondaryText.text : '';
        return '<button type="button" data-i="' + i + '"><span class="s-main">' + esc(main) + '</span><span class="s-sub">' + esc(sub) + '</span></button>';
      }).join('') + '<div class="s-foot">Powered by Google</div>';
      $('suggest').classList.add('on');
    }, function () { hideSuggest(); });
  }

  function pickSuggestion(i) {
    var x = suggestions[i];
    if (!x) return;
    hideSuggest();
    var place = x.placePrediction.toPlace();
    place.fetchFields({ fields: ['addressComponents', 'location', 'formattedAddress'] }).then(function () {
      var comp = {};
      (place.addressComponents || []).forEach(function (c) {
        (c.types || []).forEach(function (t) { if (!comp[t]) comp[t] = c; });
      });
      var num = comp.street_number ? comp.street_number.longText : '';
      var road = comp.route ? comp.route.shortText : '';
      var sub = comp.subpremise ? ' #' + comp.subpremise.longText : '';
      var city = comp.locality || comp.sublocality || comp.postal_town || comp.administrative_area_level_3 || comp.neighborhood;
      $('street').value = ((num + ' ' + road).trim() + sub) || (place.formattedAddress || '').split(',')[0];
      $('city').value = city ? city.longText : '';
      $('zip').value = comp.postal_code ? comp.postal_code.longText : $('zip').value;
      s.lat = place.location ? place.location.lat() : null;
      s.lng = place.location ? place.location.lng() : null;
      s.addressVerified = s.lat !== null && !!$('zip').value;
      $('verified').classList.toggle('on', s.addressVerified);
      ['street', 'city', 'zip'].forEach(function (id) { $('f-' + id).classList.remove('has-error'); });
      sessionToken = new places.AutocompleteSessionToken();
    }, function () {
      toast('Couldn\'t look up that address — please type it in');
      sessionToken = new places.AutocompleteSessionToken();
    });
  }

  // ── Idle reset ──
  var lastActivity = Date.now(), idleShown = false, idleLeft = 0;
  function activity() {
    lastActivity = Date.now();
    lastTouch = lastActivity;
    if (idleShown) hideIdle();
  }
  function hideIdle() { idleShown = false; $('idle').classList.remove('on'); }
  function idleTick() {
    var onWelcome = $('screen-welcome').classList.contains('active') && !$('admin').classList.contains('on') &&
      !$('pinOverlay').classList.contains('on');
    if (onWelcome || $('busy').classList.contains('on')) { lastActivity = Date.now(); return; }
    if (!idleShown && Date.now() - lastActivity >= IDLE_SECONDS * 1000) {
      idleShown = true;
      idleLeft = IDLE_COUNTDOWN;
      $('idleCount').textContent = idleLeft;
      $('idle').classList.add('on');
    } else if (idleShown) {
      idleLeft--;
      $('idleCount').textContent = Math.max(idleLeft, 0);
      if (idleLeft <= 0) { hideIdle(); hidePin(); goWelcome(); }
    }
  }

  // ── Auto-update ──
  // tools/bump_version.py bumps APP_VERSION, the ?v= asset tags and version.json
  // together on every publish. When version.json moves ahead, reload onto a
  // fresh URL (so Safari can't serve the cached page), but only while the
  // kiosk sits untouched on the welcome screen, never mid-customer.
  var APP_VERSION = '5';
  var VERSION_CHECK_MS = (Number(params.get('vcheck')) || 180) * 1000;
  var RELOAD_AFTER_IDLE_MS = (Number(params.get('vidle')) || 20) * 1000;
  var lastTouch = Date.now(), pendingVersion = null;
  function checkVersion() {
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { if (v && v.version && String(v.version) !== APP_VERSION) pendingVersion = String(v.version); })
      .catch(function () { /* offline: try again next time */ });
  }
  function maybeReload() {
    if (!pendingVersion || flushing) return;
    var idle = $('screen-welcome').classList.contains('active') && !$('admin').classList.contains('on') &&
      !$('pinOverlay').classList.contains('on') && !$('busy').classList.contains('on') &&
      Date.now() - lastTouch >= RELOAD_AFTER_IDLE_MS;
    if (!idle) return;
    // Try each new version once per session, so a stale CDN copy can't cause a reload loop.
    if (sessionStorage.getItem('bbbss_reloaded_to') === pendingVersion) return;
    sessionStorage.setItem('bbbss_reloaded_to', pendingVersion);
    params.set('v', pendingVersion);
    location.replace(location.pathname + '?' + params.toString());
  }

  // ── Admin: PIN ──
  var pinEntry = '';
  function sha256(text) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode('bbbss:' + text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function buildPinPad() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Cancel', '0', 'Clear'];
    $('pinPad').innerHTML = keys.map(function (k) {
      return '<button type="button" data-k="' + k + '"' + (k.length > 1 ? ' class="muted"' : '') + '>' + k + '</button>';
    }).join('');
    $('pinPad').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var k = b.dataset.k;
      if (k === 'Cancel') { hidePin(); return; }
      if (k === 'Clear') { pinEntry = ''; renderPin(); return; }
      if (pinEntry.length < 4) pinEntry += k;
      renderPin();
      if (pinEntry.length === 4) checkPin(pinEntry);
    });
  }
  function renderPin() {
    document.querySelectorAll('#pinDots span').forEach(function (el, i) { el.classList.toggle('on', i < pinEntry.length); });
  }
  function showPin() { pinEntry = ''; renderPin(); $('pinError').textContent = ''; $('pinOverlay').classList.add('on'); }
  function hidePin() { $('pinOverlay').classList.remove('on'); pinEntry = ''; }
  function pinFail(msg) {
    $('pinError').textContent = msg;
    var d = $('pinDialog');
    d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
    pinEntry = ''; renderPin();
  }
  function checkPin(pin) {
    $('pinError').textContent = 'Checking…';
    api({ action: 'admin', op: 'verify', pin: pin }).then(function (res) {
      if (res && res.ok) {
        sha256(pin).then(function (h) { if (h) localStorage.setItem(LS.pinHash, h); });
        adminPin = pin; hidePin(); openAdmin();
      } else pinFail('Wrong PIN');
    }, function () {
      sha256(pin).then(function (h) {
        var stored = localStorage.getItem(LS.pinHash);
        if (h && stored && h === stored) { adminPin = pin; hidePin(); openAdmin(); }
        else pinFail(stored ? 'Wrong PIN' : 'Offline — PIN can\'t be checked yet');
      });
    });
  }

  // ── Admin: panel ──
  function openAdmin() {
    $('admin').classList.add('on');
    renderAdminConn();
    loadAdmin();
  }
  function closeAdmin() { $('admin').classList.remove('on'); adminPin = null; }
  function adminCall(extra) { return api(Object.assign({ action: 'admin', pin: adminPin }, extra)); }

  function renderAdminConn() {
    var q = (loadJSON(LS.queue) || []).length;
    var all = (loadJSON(LS.all) || []).length;
    $('adminConn').textContent = (online ? '🟢 Online' : '🔴 Offline') + ' · ' + q + ' waiting to send · ' + all + ' saved on this iPad';
    var rejected = (loadJSON(LS.all) || []).filter(function (e) { return /^rejected/.test(e.status); }).length;
    $('adminQueueNote').textContent = rejected ? rejected + ' submission(s) were rejected by the server — they are still in the CSV export.' : '';
  }

  function loadAdmin() {
    ['tallyBox', 'recentBox', 'blocksBox'].forEach(function (id) { $(id).innerHTML = '<div class="empty">Loading…</div>'; });
    adminCall({ op: 'tally' }).then(renderTally, adminOffline('tallyBox'));
    adminCall({ op: 'recent' }).then(renderRecent, adminOffline('recentBox'));
    adminCall({ op: 'blocks' }).then(renderBlocks, adminOffline('blocksBox'));
  }
  function adminOffline(box) {
    return function () { $(box).innerHTML = '<div class="empty">Offline — not available right now.</div>'; renderAdminConn(); };
  }

  function renderTally(res) {
    if (!res || !res.ok) { $('tallyBox').innerHTML = '<div class="empty">' + esc(res && res.message || 'Error') + '</div>'; return; }
    var t = res.tally, a = res.splitActive || {};
    $('setGap').value = res.settings.gap;
    $('setMiles').value = res.settings.maxExtraMiles;
    function line(type, label) {
      var ahead = a[type];
      return '<tr><td>' + label + '</td><td>' + t[type].tampa + '</td><td>' + t[type].venice + '</td><td>' +
        (ahead ? '<span class="split-on">Split ON — ' + shortName(ahead) + ' ahead</span>' : 'Balanced') + '</td></tr>';
    }
    var moved = (res.moved || []).length;
    $('tallyBox').innerHTML = '<table class="tally"><tr><th></th><th>Tampa</th><th>Venice</th><th>Status</th></tr>' +
      line('booking', 'Bookings') + line('later', 'Discount-code leads') + '</table>' +
      '<div class="note">Territory leads are never counted. ' + moved + ' lead(s) moved so far.</div>' +
      '<div class="tally-actions"><button type="button" class="a-btn ghost-danger" data-reset-tally>Reset balance to 0</button></div>';
  }

  // Test leads before doors open shouldn't tip the even split: zero the counts.
  function askResetTally() {
    var box = $('tallyBox');
    if (box.querySelector('.confirm-row')) return;
    var div = document.createElement('div');
    div.className = 'confirm-row';
    div.innerHTML = '<span style="flex:1">Start the even split from zero? Leads stay in the Sheet; they just stop counting toward the balance.</span>' +
      '<button type="button" class="a-btn danger" data-confirm-reset>Reset balance</button>' +
      '<button type="button" class="a-btn ghost" data-cancel-reset>Cancel</button>';
    box.appendChild(div);
  }

  function doResetTally() {
    busy(true, 'Resetting balance…');
    adminCall({ op: 'resetTally' }).then(function (res) {
      busy(false);
      if (res && res.ok) { toast('Balance reset'); renderTally(res); }
      else toast('Could not reset: ' + (res && res.message || 'error'));
    }, function () { busy(false); toast('Offline — try again when connected'); });
  }

  var recentLeads = [];
  function renderRecent(res) {
    if (!res || !res.ok) { $('recentBox').innerHTML = '<div class="empty">' + esc(res && res.message || 'Error') + '</div>'; return; }
    recentLeads = res.leads || [];
    if (!recentLeads.length) { $('recentBox').innerHTML = '<div class="empty">No leads yet.</div>'; return; }
    $('recentBox').innerHTML = recentLeads.map(function (l, i) {
      var to = l.franchise === 'tampa' ? 'venice' : 'tampa';
      var flags = (l.flags || []).map(function (f) { return '<span class="badge flag">' + esc(f) + '</span>'; }).join(' ');
      return '<div class="lead" data-i="' + i + '"><div class="l-main">' +
        '<div class="l-name">' + esc(l.name) + ' <span class="badge ' + l.franchise + '">' + shortName(l.franchise) + '</span></div>' +
        '<div class="l-meta">' + (l.type === 'booking' ? '📅 ' + esc(l.date) + ' ' + esc(l.time) : '🎟️ Discount code') +
        ' · ' + esc(l.zip) + ' · ' + esc(l.reason) + (l.status && l.status !== 'New' ? ' · <strong>' + esc(l.status) + '</strong>' : '') + '</div>' +
        (flags ? '<div class="l-meta">' + flags + '</div>' : '') +
        '</div><button type="button" class="a-btn ghost" data-move="' + i + '">Move to ' + shortName(to) + '</button>' +
        '<button type="button" class="a-btn ghost-danger" data-del="' + i + '">Delete</button></div>';
    }).join('');
  }

  function askMove(i) {
    var row = document.querySelector('.lead[data-i="' + i + '"]');
    if (!row || row.querySelector('.confirm-row')) return;
    var l = recentLeads[i];
    var to = l.franchise === 'tampa' ? 'venice' : 'tampa';
    var div = document.createElement('div');
    div.className = 'confirm-row';
    div.innerHTML = '<span style="flex:1">Move ' + esc(l.name) + ' to ' + shortName(to) + '?</span>' +
      '<button type="button" class="a-btn danger" data-confirm-move="' + i + '">Yes, move</button>' +
      '<button type="button" class="a-btn ghost" data-cancel-move>Cancel</button>';
    row.appendChild(div);
  }

  function doMove(i) {
    var l = recentLeads[i];
    var to = l.franchise === 'tampa' ? 'venice' : 'tampa';
    busy(true, 'Moving lead…');
    adminCall({ op: 'move', id: l.id, to: to }).then(function (res) {
      busy(false);
      if (res && res.ok) { toast(l.name + ' moved to ' + shortName(to)); loadAdmin(); }
      else toast('Could not move: ' + (res && res.message || 'error'));
    }, function () { busy(false); toast('Offline — try again when connected'); });
  }

  function askDelete(i) {
    var row = document.querySelector('.lead[data-i="' + i + '"]');
    if (!row || row.querySelector('.confirm-row')) return;
    var div = document.createElement('div');
    div.className = 'confirm-row';
    div.innerHTML = '<span style="flex:1">Delete ' + esc(recentLeads[i].name) + '? This removes the lead from the Sheet and frees its time slot.</span>' +
      '<button type="button" class="a-btn danger" data-confirm-del="' + i + '">Delete lead</button>' +
      '<button type="button" class="a-btn ghost" data-cancel-move>Cancel</button>';
    row.appendChild(div);
  }

  function doDelete(i) {
    var l = recentLeads[i];
    busy(true, 'Deleting lead…');
    adminCall({ op: 'delete', id: l.id }).then(function (res) {
      busy(false);
      if (res && res.ok) { toast('Lead deleted'); loadAdmin(); }
      else toast('Could not delete: ' + (res && res.message || 'error'));
    }, function () { busy(false); toast('Offline — try again when connected'); });
  }

  function renderBlocks(res) {
    if (!res || !res.ok) { $('blocksBox').innerHTML = '<div class="empty">' + esc(res && res.message || 'Error') + '</div>'; return; }
    var list = res.blocks || [];
    $('blocksBox').innerHTML = list.length ? list.map(function (b, i) {
      return '<div class="lead"><div class="l-main"><div class="l-name"><span class="badge ' + esc(b.franchise) + '">' + shortName(b.franchise) + '</span> ' +
        esc(b.date) + ' · ' + esc(b.slot === 'ALL' ? 'All day' : b.slot) + '</div>' +
        (b.reason ? '<div class="l-meta">' + esc(b.reason) + '</div>' : '') + '</div>' +
        '<button type="button" class="a-btn ghost" data-unblock=\'' + esc(JSON.stringify({ franchise: b.franchise, date: b.date, slot: b.slot })) + '\'>Remove</button></div>';
    }).join('') : '<div class="empty">No blocked times. (Tampa also blocks from ServiceTitan automatically.)</div>';
  }

  function addBlock() {
    var date = $('blkDate').value;
    if (!date) { toast('Pick a date to block'); return; }
    adminCall({ op: 'block', franchise: $('blkFr').value, date: date, slot: $('blkSlot').value, reason: $('blkReason').value.trim() })
      .then(function (res) {
        if (res && res.ok) { toast('Blocked'); $('blkReason').value = ''; adminCall({ op: 'blocks' }).then(renderBlocks); }
        else toast('Could not block: ' + (res && res.message || 'error'));
      }, function () { toast('Offline — try again when connected'); });
  }

  function saveSettings() {
    var gap = parseInt($('setGap').value, 10), miles = parseFloat($('setMiles').value);
    if (!(gap >= 1) || !(miles >= 0)) { toast('Gap must be 1 or more; miles 0 or more'); return; }
    adminCall({ op: 'settings', gap: gap, maxExtraMiles: miles }).then(function (res) {
      if (res && res.ok) { toast('Settings saved'); adminCall({ op: 'tally' }).then(renderTally); }
      else toast('Could not save: ' + (res && res.message || 'error'));
    }, function () { toast('Offline — try again when connected'); });
  }

  function exportCSV() {
    var all = loadJSON(LS.all) || [];
    if (!all.length) { toast('Nothing saved on this iPad yet'); return; }
    var cols = ['createdAt', 'type', 'fname', 'lname', 'phone', 'email', 'street', 'city', 'zip', 'addressVerified', 'products', 'timeline', 'date', 'time', 'notes'];
    var head = cols.concat(['franchise', 'status', 'id']);
    var rows = all.map(function (e) {
      var p = e.payload;
      return cols.map(function (c) { return Array.isArray(p[c]) ? p[c].join('; ') : p[c]; })
        .concat([e.franchise, e.status, p.id]);
    });
    var csv = [head].concat(rows).map(function (r) {
      return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'sarasota-show-leads-' + ymd(new Date()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    toast('CSV exported (' + all.length + ' rows)');
  }

  // ── Wiring ──
  function phoneFormat(e) {
    var v = digits(e.target.value).slice(0, 10);
    if (v.length > 6) v = '(' + v.slice(0, 3) + ') ' + v.slice(3, 6) + '-' + v.slice(6);
    else if (v.length > 3) v = '(' + v.slice(0, 3) + ') ' + v.slice(3);
    else if (v.length) v = '(' + v;
    e.target.value = v;
  }
  function zipFormat(e) {
    e.target.value = digits(e.target.value).slice(0, 5);
    if (e.target.id === 'zip') { s.addressVerified = false; $('verified').classList.remove('on'); }
  }

  function wire() {
    $('btnBook').addEventListener('click', function () { start('booking'); });
    $('btnLater').addEventListener('click', function () { start('later'); });
    document.querySelectorAll('[data-back]').forEach(function (b) {
      b.addEventListener('click', function () {
        var to = b.dataset.back;
        if (to === 'welcome') goWelcome(); else showScreen(to);
      });
    });
    $('btnSkipZip').addEventListener('click', function () { setSkipZip(!s.skipZip); });
    $('btnInfoNext').addEventListener('click', function () { if (validateInfo()) showScreen('products'); });
    $('btnProductsNext').addEventListener('click', productsNext);
    $('btnConfirm').addEventListener('click', confirmBooking);
    $('btnNextGuest').addEventListener('click', goWelcome);
    $('phone').addEventListener('input', phoneFormat);
    $('zip').addEventListener('input', zipFormat);
    $('zip2').addEventListener('input', zipFormat);
    $('city').addEventListener('input', function () { s.addressVerified = false; $('verified').classList.remove('on'); });
    $('street').addEventListener('input', onStreetInput);
    $('street').addEventListener('blur', function () { setTimeout(hideSuggest, 250); });
    $('suggest').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('suggest').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (b) pickSuggestion(+b.dataset.i);
    });
    ['fname', 'lname', 'phone', 'email', 'street', 'city', 'zip', 'zip2'].forEach(function (id) {
      $(id).addEventListener('input', function () { $('f-' + id).classList.remove('has-error'); });
    });

    $('dateGrid').addEventListener('click', function (e) {
      var b = e.target.closest('.date');
      if (!b || b.disabled) return;
      s.date = b.dataset.date; s.time = null;
      renderDates(); renderSlots();
      $('slotBlock').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('slotGrid').addEventListener('click', function (e) {
      var b = e.target.closest('.slot');
      if (!b || b.disabled) return;
      s.time = b.dataset.slot;
      renderSlots();
    });

    $('btnStillHere').addEventListener('click', function () { activity(); });
    $('gear').addEventListener('click', showPin);
    $('btnAdminClose').addEventListener('click', closeAdmin);
    $('btnRetry').addEventListener('click', function () {
      flushQueue().then(function () { renderAdminConn(); loadAdmin(); toast('Sync attempted'); });
    });
    $('btnExport').addEventListener('click', exportCSV);
    $('btnSaveSettings').addEventListener('click', saveSettings);
    $('btnAddBlock').addEventListener('click', addBlock);
    $('blkSlot').innerHTML = '<option value="ALL">All day</option>' + config.slots.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    $('recentBox').addEventListener('click', function (e) {
      var m = e.target.closest('[data-move]'), c = e.target.closest('[data-confirm-move]'), x = e.target.closest('[data-cancel-move]');
      var d = e.target.closest('[data-del]'), cd = e.target.closest('[data-confirm-del]');
      if (c) doMove(+c.dataset.confirmMove);
      else if (cd) doDelete(+cd.dataset.confirmDel);
      else if (x) x.closest('.confirm-row').remove();
      else if (m) askMove(+m.dataset.move);
      else if (d) askDelete(+d.dataset.del);
    });
    $('tallyBox').addEventListener('click', function (e) {
      if (e.target.closest('[data-confirm-reset]')) doResetTally();
      else if (e.target.closest('[data-cancel-reset]')) e.target.closest('.confirm-row').remove();
      else if (e.target.closest('[data-reset-tally]')) askResetTally();
    });
    $('blocksBox').addEventListener('click', function (e) {
      var b = e.target.closest('[data-unblock]');
      if (!b) return;
      adminCall(Object.assign({ op: 'unblock' }, JSON.parse(b.dataset.unblock))).then(function (res) {
        if (res && res.ok) adminCall({ op: 'blocks' }).then(renderBlocks);
        else toast('Could not remove: ' + (res && res.message || 'error'));
      }, function () { toast('Offline — try again when connected'); });
    });

    ['pointerdown', 'keydown', 'input', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, activity, { passive: true, capture: true });
    });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    window.addEventListener('online', function () { setOnline(true); flushQueue(); });
    window.addEventListener('offline', function () { setOnline(false); });
  }

  // ── Boot ──
  buildCards();
  buildPinPad();
  wire();
  renderStatus();
  initPlaces();
  loadConfig().then(flushQueue);
  setInterval(flushQueue, RETRY_MS);
  // Keep the Apps Script warm so a customer never waits through a ~17 s cold start.
  setInterval(loadConfig, 4 * 60 * 1000);
  setInterval(idleTick, 1000);
  checkVersion();
  setInterval(checkVersion, VERSION_CHECK_MS);
  setInterval(maybeReload, 2000);
})();
