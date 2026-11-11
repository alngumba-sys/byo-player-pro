#!/usr/bin/env python3
"""Build the web version of BYO Player (iPhone / browsers) into byo-pairing/phone/app/.

It is the same page as the Android app (byo-android-tv/app/src/main/assets/index.html, made by build.py),
plus what a home-screen web app needs: a manifest, icons, iPhone meta tags, the phone layout switch and the
"Add BYO Player to your Home Screen" sheet. Run build.py first, then this.
"""
import json, os, shutil
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'byo-android-tv/app/src/main/assets')
OUT = os.path.join(ROOT, 'byo-pairing/phone/app')
os.makedirs(OUT, exist_ok=True)

# ---------- icons: the BYO play mark, drawn sharp at every size ----------
def icon(size, pad=0.0):
    S = size * 4
    im = Image.new('RGB', (S, S), (8, 13, 22))
    glow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(glow).ellipse([S * 0.18, S * 0.18, S * 0.82, S * 0.82], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.12))
    im = Image.composite(Image.new('RGB', (S, S), (16, 64, 84)), im, glow)
    d = ImageDraw.Draw(im)
    k = 1 - pad * 2
    cx, cy, r = S / 2 + S * 0.035 * k, S / 2, S * 0.27 * k
    pts = [(cx - r * 0.8, cy - r), (cx + r * 0.95, cy), (cx - r * 0.8, cy + r)]
    w = int(S * 0.075 * k)
    d.line(pts + [pts[0]], fill=(1, 237, 253), width=w, joint='curve')
    for p in pts:
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=(1, 237, 253))
    return im.resize((size, size), Image.LANCZOS)

icon(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, pad=0.1).save(os.path.join(OUT, 'icon-maskable-512.png'))

json.dump({
    'name': 'BYO Player', 'short_name': 'BYO Player', 'id': '/app/', 'start_url': '/app/', 'scope': '/app/',
    'display': 'standalone', 'orientation': 'any', 'background_color': '#05070d', 'theme_color': '#05070d',
    'description': 'Watch your own playlist: live TV, movies and series.',
    'icons': [
        {'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
        {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
        {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
    ],
}, open(os.path.join(OUT, 'manifest.webmanifest'), 'w'), indent=2)

# ---------- the page ----------
s = open(os.path.join(ASSETS, 'index.html'), encoding='utf-8').read()

HEAD = '''<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="BYO Player">
<meta name="theme-color" content="#05070d">
<style>html.byo-web .wz-ver{display:none!important}</style>
<script>(function(){ try{
  // Web version on a phone or tablet: use the phone layout the Android app uses.
  if(!window.ByoAndroid){ var d=document.documentElement, ua=navigator.userAgent||'';
    var ios=/iP(hone|od|ad)/.test(ua)||(/Macintosh/.test(ua)&&('ontouchend' in document));
    var touch=('ontouchstart' in window)||navigator.maxTouchPoints>0;
    d.classList.add('byo-web'); if(ios) d.classList.add('ios-web');
    if(touch&&Math.min(screen.width,screen.height)<900) d.classList.add('android-app');
    if(window.navigator.standalone||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)) d.classList.add('web-standalone'); }
}catch(e){} })();</script>
'''
T = '<title>BYO Player Pro</title>'
assert s.count(T) == 1
s = s.replace(T, '<title>BYO Player</title>\n' + HEAD, 1)

SHEET = r'''<style id="ios-install-css">
#ios-install{ position:fixed; inset:0; z-index:100000; display:none; }
#ios-install.on{ display:block; }
#ios-install .ii-dim{ position:absolute; inset:0; background:rgba(2,4,9,.62); }
#ios-install .ii-sheet{ position:absolute; left:0; right:0; bottom:0; background:#121a24; color:#e8eef6; border-radius:22px 22px 0 0;
  padding:26px 22px calc(22px + env(safe-area-inset-bottom)); font-family:inherit; box-shadow:0 -10px 40px rgba(0,0,0,.45); max-height:92vh; overflow:auto; }
#ios-install h2{ margin:0 40px 6px 0; font-size:22px; line-height:1.25; font-weight:800; }
#ios-install .ii-lead{ margin:0 0 20px; color:#a9b4c2; font-size:15px; line-height:1.45; }
#ios-install .ii-x{ position:absolute; top:18px; right:16px; width:36px; height:36px; border:0; border-radius:50%; background:transparent; color:#cfd8e3; font-size:26px; line-height:36px; }
#ios-install ol{ list-style:none; margin:0; padding:0; }
#ios-install li{ display:flex; gap:14px; align-items:flex-start; margin:0 0 18px; }
#ios-install .ii-n{ flex:0 0 34px; height:34px; border-radius:50%; background:#13363d; color:#2fd4e8; font-weight:800; display:flex; align-items:center; justify-content:center; font-size:15px; }
#ios-install .ii-t{ font-weight:700; font-size:16px; display:flex; align-items:center; gap:10px; }
#ios-install .ii-ic{ display:inline-flex; align-items:center; justify-content:center; min-width:30px; height:30px; padding:0 6px; border-radius:8px; background:#1d2733; color:#e8eef6; font-weight:700; font-size:15px; }
#ios-install .ii-or{ color:#7f8b99; font-weight:500; font-size:13px; margin:0 -4px; }
#ios-install .ii-d{ color:#a9b4c2; font-size:14px; margin-top:4px; line-height:1.4; }
#ios-install .ii-note{ background:#2a2410; color:#f3dfa6; border-radius:12px; padding:12px 14px; font-size:14px; line-height:1.4; margin-top:4px; }
#ios-install .ii-later{ display:block; width:100%; margin-top:16px; padding:14px; border:1px solid #2b3846; border-radius:12px; background:transparent; color:#cfd8e3; font-size:15px; font-weight:600; }
#ios-install-pill{ position:fixed; right:12px; bottom:calc(92px + env(safe-area-inset-bottom)); z-index:99999; display:none;
  border:0; color:rgba(200,212,226,.5); background:transparent; opacity:.5; padding:6px 8px; font-weight:500; font-size:13px; font-family:inherit; }
#ios-install-pill b{ display:inline-block; margin-left:8px; font-weight:400; color:rgba(200,212,226,.4); }
#ios-install-pill.on{ display:block; }
</style>
<div id="ios-install" role="dialog" aria-modal="true" aria-labelledby="ii-h">
  <div class="ii-dim"></div>
  <div class="ii-sheet">
    <button class="ii-x" aria-label="Close">&times;</button>
    <h2 id="ii-h">Add BYO Player to your Home Screen</h2>
    <p class="ii-lead">Safari installs apps from the share menu. It takes three taps, and then BYO Player opens full screen like any other app.</p>
    <ol>
      <li><span class="ii-n">1</span><div><div class="ii-t"><span class="ii-ic"><svg width="18" height="20" viewBox="0 0 18 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 13V2M5 5.5 9 2l4 3.5"/><path d="M6 8H3.5A1.5 1.5 0 0 0 2 9.5v7A1.5 1.5 0 0 0 3.5 18h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 14.5 8H12"/></svg></span><span class="ii-or">or</span><span class="ii-ic">&bull;&bull;&bull;</span>Tap Share</div>
        <div class="ii-d">Share is the square with an arrow. On newer iPhones it sits behind the three dots <b>&bull;&bull;&bull;</b> at the bottom right of Safari: tap the dots, then Share.</div></div></li>
      <li><span class="ii-n">2</span><div><div class="ii-t"><span class="ii-ic">+</span>Choose Add to Home Screen</div>
        <div class="ii-d">Scroll down the list to find it. If you only see a few actions, tap <b>View More</b> first.</div></div></li>
      <li><span class="ii-n">3</span><div><div class="ii-t"><span class="ii-ic">Add</span>Tap Add</div>
        <div class="ii-d">BYO Player appears on your Home Screen. Open it from there and set it up.</div></div></li>
    </ol>
    <div class="ii-note" id="ii-note">This only works in Safari. If you are reading this in Chrome or another browser, open the same link in Safari first.</div>
    <button class="ii-later">Not now, use it in the browser</button>
  </div>
</div>
<button id="ios-install-pill">Install app<b aria-label="Hide">&times;</b></button>
<script id="ios-install-js">(function(){ try{
  var d=document.documentElement; if(!d.classList.contains('ios-web')||d.classList.contains('web-standalone')) return;
  var ua=navigator.userAgent||'', other=/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram/.test(ua);
  var sheet=document.getElementById('ios-install'), pill=document.getElementById('ios-install-pill'), note=document.getElementById('ii-note');
  if(other) note.textContent='You are in another browser. Copy this link and open it in Safari to add BYO Player to your Home Screen.';
  function open(){ sheet.classList.add('on'); pill.classList.remove('on'); }
  function close(){ sheet.classList.remove('on'); if(!hid) pill.classList.add('on'); try{ sessionStorage.setItem('byo_ii_seen','1'); }catch(e){} }
  sheet.querySelector('.ii-x').addEventListener('click',close); sheet.querySelector('.ii-later').addEventListener('click',close);
  sheet.querySelector('.ii-dim').addEventListener('click',close);
  var hid=false; try{ hid=sessionStorage.getItem('byo_ii_hide')==='1'; }catch(e){}
  pill.addEventListener('click',function(e){ if(e.target&&e.target.tagName==='B'){ hid=true; pill.classList.remove('on'); try{ sessionStorage.setItem('byo_ii_hide','1'); }catch(_e){} return; } open(); });
  // Settings and activation in Safari stay in Safari: an app added to the Home Screen starts fresh. So the sheet
  // comes first, before anything is set up, and the pill stays for later.
  // The pill stays out of the way while the setup screens (with their own bottom button) are showing.
  setInterval(function(){ try{ var w=document.getElementById('welcome'), pv=document.getElementById('view-player'), busy=(w&&!w.classList.contains('hidden')&&w.offsetParent!==null)||sheet.classList.contains('on')||(pv&&pv.classList.contains('active-view'));
    pill.style.visibility=busy?'hidden':''; }catch(e){} },700);
  var seen=false; try{ seen=sessionStorage.getItem('byo_ii_seen')==='1'; }catch(e){}
  if(seen){ if(!hid) pill.classList.add('on'); } else setTimeout(open, 600);
}catch(e){} })();</script>
'''
# Install app for laptops and Android: the browser's own install prompt where it offers one, short help otherwise.
SHEET += r"""<style id="web-install-css">
#web-install{ position:fixed; right:16px; bottom:calc(12px + env(safe-area-inset-bottom)); z-index:99998; display:none; border:0; background:transparent; color:rgba(200,212,226,.45); font:500 13px/1 Inter,system-ui,sans-serif; padding:8px 10px; cursor:pointer; border-radius:8px; opacity:.5; transition:color .2s, opacity .2s; }
#web-install:hover{ color:rgba(220,232,244,.85); opacity:1; }
#web-install.on{ display:inline-flex; align-items:center; gap:6px; }
#web-install svg{ width:14px; height:14px; }
html.is-playing #web-install{ display:none !important; }
html.android-app #web-install{ bottom:calc(92px + env(safe-area-inset-bottom)); }
html.android-app #wi-help{ bottom:calc(128px + env(safe-area-inset-bottom)); left:16px; max-width:none; }
#wi-help{ position:fixed; right:16px; bottom:48px; z-index:99999; display:none; max-width:320px; background:#121a24; color:#dbe4ee; border:1px solid #233142; border-radius:14px; padding:16px 18px; font:400 14px/1.45 Inter,system-ui,sans-serif; box-shadow:0 12px 40px rgba(0,0,0,.5); }
#wi-help.on{ display:block; }
#wi-help b{ color:#fff; }
#wi-help a{ color:#2fd4e8; }
#wi-help .wi-x{ float:right; margin:-6px -8px 0 8px; background:transparent; border:0; color:#9fb0c0; font-size:20px; cursor:pointer; }
</style>
<button id="web-install" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Install app</button>
<div id="wi-help" role="dialog"><button class="wi-x" aria-label="Close">&times;</button><div id="wi-text"></div></div>
<script>(function(){ try{
  var d=document.documentElement; if(d.classList.contains('ios-web')||d.classList.contains('web-standalone')) return;
  if(window.matchMedia&&matchMedia('(display-mode: standalone)').matches) return;
  if(window.ByoDesktop||/BYODesktop\//.test(navigator.userAgent||'')) return;
  try{ if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function(){}); }catch(e){}
  var btn=document.getElementById('web-install'), help=document.getElementById('wi-help'), txt=document.getElementById('wi-text'), ev=null;
  var ua=navigator.userAgent||'', android=/Android/i.test(ua), safari=/Safari/.test(ua)&&!/Chrome|Chromium|Edg|OPR/.test(ua), firefox=/Firefox/.test(ua);
  window.addEventListener('beforeinstallprompt',function(e){ e.preventDefault(); ev=e; });
  window.addEventListener('appinstalled',function(){ btn.classList.remove('on'); help.classList.remove('on'); });
  btn.classList.add('on');
  help.querySelector('.wi-x').addEventListener('click',function(){ help.classList.remove('on'); });
  btn.addEventListener('click',function(){
    if(ev){ var e=ev; ev=null; e.prompt(); if(e.userChoice) e.userChoice.then(function(r){ if(r&&r.outcome==='accepted') btn.classList.remove('on'); }); return; }
    var apk='<a href="https://byoplayer-pair.netlify.app/tv3247.apk">download the Android app</a>';
    txt.innerHTML = android ? 'In Chrome, tap the <b>three dots</b> at the top right, then <b>Add to Home screen</b> or <b>Install app</b>.<br><br>For the best playback (all movie formats), '+apk+' instead.'
      : safari ? 'In Safari on a Mac, open the <b>File</b> menu (or the Share button) and choose <b>Add to Dock</b>.'
      : firefox ? 'Firefox cannot install apps. Open this page in <b>Chrome</b> or <b>Microsoft Edge</b> and click <b>Install app</b> again.'
      : 'Click the <b>install icon</b> at the right end of the address bar, or open the browser menu (three dots) and choose <b>Cast, save and share</b> then <b>Install page as app</b>.';
    help.classList.toggle('on'); });
}catch(e){} })();</script>
"""
# A Back button on the player for mouse and touch users (there is no remote in a browser). It does what Esc does.
SHEET += r"""<style id="web-back-css">
#web-back{ position:fixed; top:18px; left:18px; z-index:2147483000; display:none; align-items:center; gap:8px; padding:10px 18px 10px 14px; border-radius:999px; border:1px solid rgba(255,255,255,.25); background:rgba(8,12,20,.72); color:#fff; font:600 16px/1 Inter,system-ui,sans-serif; cursor:pointer; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); transition:opacity .25s; }
#web-back:hover{ background:rgba(30,40,58,.9); }
#web-back svg{ width:20px; height:20px; }
html.web-back-on #web-back{ display:inline-flex; }
html.web-back-on.web-back-idle #web-back{ opacity:0; pointer-events:none; }
</style>
<button id="web-back" type="button" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>Back</button>
<script>(function(){ try{
  var b=document.getElementById('web-back'), R=document.documentElement, idle=null;
  function esc(){ ['keydown','keyup'].forEach(function(t){ var e=new KeyboardEvent(t,{key:'Escape',code:'Escape',bubbles:true,cancelable:true}); try{ Object.defineProperty(e,'keyCode',{get:function(){return 27;}}); Object.defineProperty(e,'which',{get:function(){return 27;}}); }catch(_e){} document.dispatchEvent(e); }); }
  b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); esc(); });
  function wake(){ R.classList.remove('web-back-idle'); clearTimeout(idle); idle=setTimeout(function(){ R.classList.add('web-back-idle'); },4000); }
  ['mousemove','touchstart','keydown'].forEach(function(t){ document.addEventListener(t,wake,{passive:true}); });
  setInterval(function(){ try{ var pv=document.getElementById('view-player'), mv=document.getElementById('view-multiview');
    var on=!!((pv&&pv.classList.contains('active-view'))||(mv&&mv.classList.contains('active-view')));
    if(on!==R.classList.contains('web-back-on')){ R.classList.toggle('web-back-on',on); if(on) wake(); }
    var h=document.querySelectorAll('.player-hint,.mvp-hint'); for(var i=0;i<h.length;i++){ if(/BACK/.test(h[i].textContent)) h[i].textContent=h[i].textContent.replace(/BACK/g,'Esc').replace(/UP\/DOWN/g,'↑/↓').replace(/OK/g,'Enter').replace(/D-pad/g,'Arrow keys'); }
  }catch(e){} },400);
}catch(e){} })();</script>
"""
i = s.rfind('</body>')
s = (s[:i] + SHEET + s[i:]) if i >= 0 else (s + SHEET)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(s)
open(os.path.join(OUT, 'sw.js'), 'w').write("// BYO Player: lets the browser install the app. Nothing is cached; every request goes to the network.\nself.addEventListener('install',function(){ self.skipWaiting(); });\nself.addEventListener('activate',function(e){ e.waitUntil(self.clients.claim()); });\nself.addEventListener('fetch',function(){});\n")

shutil.copy(os.path.join(ASSETS, 'hls.min.js'), os.path.join(OUT, 'hls.min.js'))
if os.path.isdir(os.path.join(OUT, 'logos')):
    shutil.rmtree(os.path.join(OUT, 'logos'))
shutil.copytree(os.path.join(ASSETS, 'logos'), os.path.join(OUT, 'logos'))
print('web app written to', OUT, round(len(s) / 1048576, 1), 'MB')
