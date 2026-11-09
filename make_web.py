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
#ios-install .ii-d{ color:#a9b4c2; font-size:14px; margin-top:4px; line-height:1.4; }
#ios-install .ii-note{ background:#2a2410; color:#f3dfa6; border-radius:12px; padding:12px 14px; font-size:14px; line-height:1.4; margin-top:4px; }
#ios-install .ii-later{ display:block; width:100%; margin-top:16px; padding:14px; border:1px solid #2b3846; border-radius:12px; background:transparent; color:#cfd8e3; font-size:15px; font-weight:600; }
#ios-install-pill{ position:fixed; right:12px; bottom:calc(92px + env(safe-area-inset-bottom)); z-index:99999; display:none;
  border:1px solid #2fd4e8; color:#2fd4e8; background:rgba(5,7,13,.94); border-radius:999px; padding:9px 14px; font-weight:700; font-size:14px; font-family:inherit; box-shadow:0 6px 20px rgba(0,0,0,.4); }
#ios-install-pill b{ display:inline-block; margin-left:10px; padding-left:10px; border-left:1px solid rgba(47,212,232,.35); font-weight:400; color:#9fb0c0; }
#ios-install-pill.on{ display:block; }
</style>
<div id="ios-install" role="dialog" aria-modal="true" aria-labelledby="ii-h">
  <div class="ii-dim"></div>
  <div class="ii-sheet">
    <button class="ii-x" aria-label="Close">&times;</button>
    <h2 id="ii-h">Add BYO Player to your Home Screen</h2>
    <p class="ii-lead">Safari installs apps from the share menu. It takes three taps, and then BYO Player opens full screen like any other app.</p>
    <ol>
      <li><span class="ii-n">1</span><div><div class="ii-t"><span class="ii-ic"><svg width="18" height="20" viewBox="0 0 18 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 13V2M5 5.5 9 2l4 3.5"/><path d="M6 8H3.5A1.5 1.5 0 0 0 2 9.5v7A1.5 1.5 0 0 0 3.5 18h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 14.5 8H12"/></svg></span>Tap Share</div>
        <div class="ii-d">On newer iPhones, first tap the <b>&bull;&bull;&bull;</b> button at the bottom right of Safari, then Share. On older ones, Share (the square with an arrow) is in the bottom bar.</div></div></li>
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
i = s.rfind('</body>')
s = (s[:i] + SHEET + s[i:]) if i >= 0 else (s + SHEET)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(s)

shutil.copy(os.path.join(ASSETS, 'hls.min.js'), os.path.join(OUT, 'hls.min.js'))
if os.path.isdir(os.path.join(OUT, 'logos')):
    shutil.rmtree(os.path.join(OUT, 'logos'))
shutil.copytree(os.path.join(ASSETS, 'logos'), os.path.join(OUT, 'logos'))
print('web app written to', OUT, round(len(s) / 1048576, 1), 'MB')
