/* BYO Player: "Add to Home Screen" onboarding logic. UI-free and reusable.
 *
 *   PwaInstall.getState()      -> { platform, installed, flow, canPrompt, prompted, safari }
 *        flow: 'none'         nothing to show (installed, or desktop with no install offer)
 *              'ios-safari'   show the 3-step Share > Add to Home Screen > Add sheet
 *              'ios-other'    iPhone/iPad but not Safari: show only "open this link in Safari"
 *              'native'       the browser offered a real install prompt (Android Chrome, desktop Chrome/Edge)
 *              'manual'       Android without a stored prompt: short manual help
 *   PwaInstall.subscribe(fn)   -> unsubscribe fn. Called whenever the state changes
 *   PwaInstall.promptInstall() -> Promise<'accepted'|'dismissed'|'unavailable'>   (native flow)
 *   PwaInstall.shouldAutoShow()-> true once, for the iOS sheet: iOS + not installed + not shown or dismissed before
 *   PwaInstall.markPrompted(v) / hasPrompted() / reset()                       (localStorage 'byoplayer_a2hs_prompted')
 *
 * Load it early (in <head>): 'beforeinstallprompt' can fire before the page is ready.
 * React: const s = PwaInstall.useState(React)  (returns the live state object).
 */
(function (root) {
  'use strict';
  var KEY = 'byoplayer_a2hs_prompted';
  var ua = function () { return (root.navigator && root.navigator.userAgent) || ''; };

  function store(v) {
    try { if (v === undefined) return root.localStorage.getItem(KEY); if (v === null) root.localStorage.removeItem(KEY); else root.localStorage.setItem(KEY, String(v)); } catch (e) {}
    return null;
  }

  // ---- detection ----
  function isIOS() {   // iPhone, iPod, iPad, and iPadOS (which reports itself as a Mac with a touch screen)
    var u = ua();
    return /iP(hone|od|ad)/.test(u) || (/Macintosh/.test(u) && (root.navigator.maxTouchPoints > 1 || 'ontouchend' in root.document));
  }
  function isAndroid() { return /Android/i.test(ua()); }
  // Safari proper: every iOS browser is WebKit, so exclude the others by their tokens
  function isSafariIOS() {
    var u = ua();
    if (!isIOS()) return false;
    if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok/.test(u)) return false;
    return /Safari\//.test(u) || /Version\/[\d.]+.*Mobile/.test(u);
  }
  function isInstalled() {
    try { if (root.navigator.standalone === true) return true; } catch (e) {}
    try { if (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) return true; } catch (e) {}
    return false;
  }
  function platform() { return isIOS() ? 'ios' : isAndroid() ? 'android' : 'desktop'; }

  // ---- native install (Android Chrome, desktop Chrome/Edge) ----
  var deferred = null, subs = [], lastOutcome = null;
  function emit() { var s = getState(); subs.slice().forEach(function (f) { try { f(s); } catch (e) {} }); }

  function getState() {
    var p = platform(), installed = isInstalled(), prompted = store() || '';
    var flow = 'none';
    if (!installed) {
      if (p === 'ios') flow = isSafariIOS() ? 'ios-safari' : 'ios-other';
      else if (deferred) flow = 'native';
      else if (p === 'android' && prompted !== 'installed') flow = 'manual';
    }
    return { platform: p, installed: installed, flow: flow, canPrompt: !!deferred, prompted: !!prompted, safari: isSafariIOS(), outcome: lastOutcome };
  }

  function promptInstall() {
    var e = deferred;
    if (!e) return Promise.resolve('unavailable');
    deferred = null;   // an event can be used once
    try { e.prompt(); } catch (err) { emit(); return Promise.resolve('unavailable'); }
    return Promise.resolve(e.userChoice).then(function (r) {
      var out = (r && r.outcome) || 'dismissed';
      lastOutcome = out;
      try { console.log('[pwa] install prompt ' + out); } catch (_) {}
      if (out === 'accepted') store('installed');   // dismissed: leave the button, the user may change their mind
      emit();
      return out;
    }, function () { emit(); return 'dismissed'; });
  }

  function init() {
    if (init.done) return; init.done = true;
    root.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferred = e;
      if (store() === 'installed') store(null);   // the browser only offers install when the app is not installed (it was removed)
      emit();
    });
    root.addEventListener('appinstalled', function () {
      deferred = null; lastOutcome = 'installed'; store('installed');
      try { console.log('[pwa] app installed'); } catch (_) {}
      emit();
    });
    try { var mq = root.matchMedia('(display-mode: standalone)'); (mq.addEventListener || mq.addListener).call(mq, 'change', emit); } catch (e) {}
  }
  init();

  var api = {
    detect: function () { return { platform: platform(), isIOS: isIOS(), isAndroid: isAndroid(), isSafariIOS: isSafariIOS(), installed: isInstalled() }; },
    getState: getState,
    subscribe: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
    promptInstall: promptInstall,
    hasPrompted: function () { return !!store(); },
    markPrompted: function (v) { store(v == null ? 'dismissed' : v); emit(); },
    // the iOS sheet opens by itself only on the first visit that is eligible
    shouldAutoShow: function () { var s = getState(); return (s.flow === 'ios-safari' || s.flow === 'ios-other') && !s.prompted; },
    reset: function () { store(null); emit(); },
    useState: function (React) {   // optional React hook wrapper
      var st = React.useState(getState()); React.useEffect(function () { return api.subscribe(st[1]); }, []); return st[0];
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PwaInstall = api;
})(typeof window !== 'undefined' ? window : this);
