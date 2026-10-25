import sys
src = sys.argv[1] if len(sys.argv) > 1 else 'byo-player-pro.html'
out = sys.argv[2] if len(sys.argv) > 2 else 'index-tv.html'
s = open(src, encoding='utf-8').read()
TIZEN = (len(sys.argv) > 3 and sys.argv[3].lower() in ('tizen','1','true','yes'))
import re as _reV
try:
    VERSION_STR = _reV.search(r'versionName "([^"]+)"', open('byo-android-tv/app/build.gradle').read()).group(1)
except Exception:
    VERSION_STR = '3.28.0'

csp = ('<meta http-equiv="Content-Security-Policy" '
       'content="default-src * data: blob: filesystem: about: ws: wss: '
       "'unsafe-inline' 'unsafe-eval'; "
       "style-src * 'unsafe-inline'; "
       "script-src * 'unsafe-inline' 'unsafe-eval'; "
       'img-src * data: blob:; media-src * data: blob:; connect-src *;">')

viewport = ('<meta name="viewport" content="width=device-width, initial-scale=1, '
            'user-scalable=no, viewport-fit=cover">')

# Force the app's native-TV layout (no simulated "browser preview" frame).
# In a browser/WebView the app otherwise wraps itself in a .dev-head +
# small .tv-frame bezel + .remote-help footer; tv-native hides that chrome
# and runs the stage fullscreen, which we then scale (fit) or reflow (mobile).
SHIM = '<script id="rp-shim">(function(){try{var R=document.documentElement;var okClamp=!!(window.CSS&&CSS.supports&&CSS.supports("width","clamp(1px, 2vw, 3px)"));var okVar=!!(window.CSS&&CSS.supports&&CSS.supports("--a","1px"));var okAR=!!(window.CSS&&CSS.supports&&CSS.supports("aspect-ratio","1/1"));function cl(mn,vw,mx){var v=(window.innerWidth||R.clientWidth)*vw/100;return Math.round(Math.min(Math.max(v,mn),mx))+"px";}function setTokens(){var T=[["--rp-gutter",14,3.4,66],["--rp-gap",10,1.15,22],["--rp-gap-sm",6,.6,12],["--rp-radius",10,.9,18],["--rp-fs-hero",22,3.35,64],["--rp-fs-h1",20,2.5,48],["--rp-fs-h2",17,1.8,34],["--rp-fs-title",15,1.4,26],["--rp-fs-body",13,1.15,22],["--rp-fs-meta",11,.95,19],["--rp-fs-micro",10,.8,17],["--rp-ctrl-h",38,3.2,62],["--rp-ctrl-px",12,1.4,28],["--rp-icon",16,1.3,26],["--rp-poster-min",130,13,250],["--rp-rail-card",112,11,210],["--rp-avatar",84,9,176]];for(var i=0;i<T.length;i++){R.style.setProperty(T[i][0],cl(T[i][1],T[i][2],T[i][3]));}}if(!okClamp&&okVar){setTokens();window.addEventListener("resize",setTokens);window.addEventListener("orientationchange",function(){setTimeout(setTokens,80);});}if(!okAR){R.className+=" rp-no-ar";}}catch(e){}})();</script>'
if TIZEN:
    # Samsung Tizen builds only ever run on an actual Samsung TV.
    force_tv = '<script>try{document.documentElement.className+=" tv-native";}catch(e){}</script>'
else:
    # Android: the SAME apk installs on real Android TV / TCL boxes AND on
    # ordinary phones. Only force the fixed 1920x1080 TV layout when the native
    # bridge confirms this device actually IS a TV (Android UiModeManager /
    # leanback) -- never from a screen-size guess, since plenty of ordinary
    # phones also have a native 1920x1080 panel and would otherwise be locked
    # into the oversized, unscaled TV layout (the cause of the horizontal
    # scrolling seen on phones in Settings, Sports, etc).
    force_tv = ('<script>try{ if(window.ByoAndroid&&ByoAndroid.deviceInfo){ '
                'var __d=JSON.parse(ByoAndroid.deviceInfo()||"{}"); '
                'if(__d.tv) document.documentElement.className+=" tv-native"; '
                '} }catch(e){}</script>')

# Scale-to-fit (TV / tablet / landscape): keep the proven 1920x1080 layout and
# uniformly scale it to fill the screen. On narrow (phone) screens the scaler
# steps aside and the #rp-mobile reflow drives a native vertical layout.
fit_css = ''

try:
    with open('responsive.css', encoding='utf-8') as _mf:
        mobile_css = '<style id="rp-responsive">' + _mf.read() + '</style>'
except FileNotFoundError:
    mobile_css = ''

fit_js = ('<script id="rp-touch">(function(){try{'
          # close the Guide dropdown when tapping anywhere outside it (phone bottom-sheet)
          # phones/tablets: move the Guide menu out of the swipe-strip nav into <body> so no
          # ancestor (overflow/containing block) can clip or reposition the bottom sheet
          'function port(){var m=document.getElementById("nav-guide-menu");if(m&&window.innerWidth<1100&&m.parentNode!==document.body)document.body.appendChild(m);}'
          'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",port);else port();window.addEventListener("resize",port);'
          'document.addEventListener("click",function(e){var m=document.getElementById("nav-guide-menu");'
          'if(!m||m.classList.contains("hidden"))return;if(e.target.closest&&(e.target.closest(".nav-dd")||e.target.closest("#nav-guide-menu")))return;'
          'm.classList.add("hidden");e.stopPropagation();e.preventDefault();var t=document.getElementById("nav-guide-trigger");if(t)t.setAttribute("aria-expanded","false");},true);'
          # ---- touch player: back button + tap video to show/hide controls ----
          'function pb(){var vp=document.getElementById("view-player");if(!vp||document.getElementById("rp-player-back"))return;'
          'var b=document.createElement("button");b.id="rp-player-back";b.setAttribute("aria-label","Back");'
          'b.innerHTML=\'<svg viewBox="0 0 24 24"><use href="#i-chev-l"/></svg>\';'
          'b.addEventListener("click",function(e){e.stopPropagation();try{if(window.Nav&&Nav.onBack)Nav.onBack();}catch(x){}});vp.appendChild(b);}'
          'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",pb);else pb();'
          'document.addEventListener("click",function(e){var vp=document.getElementById("view-player");if(!vp||!vp.classList.contains("active-view")||!vp.contains(e.target))return;'
          'if(e.target.closest("#transport,button,.tb,#opt-pop,#player-msg,#next-toast,#paused-banner,[data-focusable]"))return;'
          'var v0=document.getElementById("html5-player"),W=window.innerWidth,H=window.innerHeight;'
          'if(v0&&isFinite(v0.duration)&&v0.duration>0&&e.clientY>H*0.16&&e.clientY<H*0.8&&(e.clientX<W*0.3||e.clientX>W*0.7)){var d=e.clientX<W*0.3?-10:10;'
          'v0.currentTime=Math.max(0,Math.min(v0.duration-1,v0.currentTime+d));var f=document.getElementById("rp-seekflash");if(!f){f=document.createElement("div");f.id="rp-seekflash";vp.appendChild(f);}'
          'f.textContent=d<0?"\u23EA 10s":"10s \u23E9";f.className=(d<0?"l":"r")+" show";clearTimeout(window.__rpSf);window.__rpSf=setTimeout(function(){f.className=f.className.replace(" show","");},700);return;}'
          'var o=document.getElementById("player-overlay"),t=document.getElementById("transport");if(!o||!t)return;'
          'if(t.classList.contains("visible")){o.classList.remove("visible");t.classList.remove("visible");vp.classList.remove("rp-ui");}'
          'else{o.classList.add("visible");t.classList.add("visible");vp.classList.add("rp-ui");clearTimeout(window.__rpOv);'
          'window.__rpOv=setTimeout(function(){var v=document.getElementById("html5-player");if(v&&!v.paused){o.classList.remove("visible");t.classList.remove("visible");vp.classList.remove("rp-ui");}},5000);}});'
          '}catch(e){}})();</script>')


# --- Player loading cover (replaces Android WebView's grey default video poster) ---
cover_js = r"""<script id="rp-cover-js">(function(){try{
var BLANK='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function noPoster(){ var vs=document.querySelectorAll('video'); for(var i=0;i<vs.length;i++){ if(vs[i].getAttribute('poster')!==BLANK) vs[i].setAttribute('poster',BLANK); } }
var art='', artTs=0;
document.addEventListener('click',function(e){ if(!e.target.closest) return;
  if(e.target.closest('#detail-actions .play-btn, #detail-actions .ghost-btn, #view-detail .episode, #detail-resume')){
    var im=document.querySelector('#detail-poster .detail-poster-img'); art=(im&&im.src)||''; artTs=Date.now(); }
  else if(e.target.closest('.poster-card, .live-card, .chan-row, .won-card, .event-card, .lc-card, [data-channel]')){ art=''; artTs=0; } },true);
function el(id){ return document.getElementById(id); }
function setT(n,t){ if(n&&n.textContent!==t) n.textContent=t; }
function build(){ var vp=el('view-player'); if(!vp||el('rp-cover')) return;
  var c=document.createElement('div'); c.id='rp-cover';
  c.innerHTML='<div class="rpc-bg"></div><div class="rpc-scrim"></div>'+
    '<div class="rpc-top"><div class="rpc-mark"><svg viewBox="0 0 24 24"><use href="#i-brand"/></svg></div><div class="rpc-title"></div><div class="rpc-sub"></div></div>'+
    '<div class="rpc-msg">Getting it ready…</div>';
  vp.appendChild(c);
  var v=el('html5-player'); if(!v) return;
  function show(){ var t=el('now-playing'), sb=el('np-sub');
    setT(c.querySelector('.rpc-title'),(t&&t.textContent)||'');
    setT(c.querySelector('.rpc-sub'),(sb&&sb.textContent)||'');
    var bg=c.querySelector('.rpc-bg'); var useArt=art&&(Date.now()-artTs<20000);
    var bi=useArt?('url("'+art.replace(/"/g,'%22')+'")'):'none'; if(bg.style.backgroundImage!==bi) bg.style.backgroundImage=bi;
    if(c.classList.contains('has-art')!==!!useArt) c.classList.toggle('has-art',!!useArt);
    if(!vp.classList.contains('rp-loading')) vp.classList.add('rp-loading'); if(!c.classList.contains('on')) c.classList.add('on'); }
  function hide(){ if(vp.classList.contains('rp-loading')) vp.classList.remove('rp-loading'); if(c.classList.contains('on')) c.classList.remove('on'); }
  v.addEventListener('loadstart',function(){ noPoster(); show(); });
  v.addEventListener('emptied',function(){ if(vp.classList.contains('active-view')) show(); });
  v.addEventListener('playing',hide);
  v.addEventListener('timeupdate',function(){ if(v.currentTime>0.05&&!v.paused) hide(); });
  var wasActive=false;
  new MutationObserver(function(){ var act=vp.classList.contains('active-view'); if(act===wasActive) return; wasActive=act;
    if(act){ noPoster(); if(!(v.currentTime>0.05)) show(); } else hide(); })
    .observe(vp,{attributes:true,attributeFilter:['class']});
  setInterval(function(){ if(c.classList.contains('on')){ var np=el('now-playing'), sb=el('np-sub'); setT(c.querySelector('.rpc-title'),(np&&np.textContent)||''); setT(c.querySelector('.rpc-sub'),(sb&&sb.textContent)||''); } },700);
}
function boot(){ noPoster(); build(); setInterval(noPoster,3000); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
}catch(e){}})();</script>"""
fit_js = fit_js + cover_js
img_js = r"""<script id="rp-img">(function(){try{
// Posters that are on (or just off) screen load immediately and in parallel instead of waiting for
// the lazy loader; decoding happens off the main thread so scrolling stays smooth.
function retry(img){ if(img.__rpRetry) return; img.__rpRetry=0; var orig=img.getAttribute('src')||'';
  img.onerror=function(){ var n=++img.__rpRetry; if(n<=2&&orig){ setTimeout(function(){ var cur=img.getAttribute('src')||''; if(cur.indexOf(orig)!==0||img.__rpReplaced) return;   /* artwork was replaced with a verified one: don't put the broken one back */ img.src=orig+(orig.indexOf('?')>-1?'&':'?')+'rp='+n; }, n*1500); }
    else { try{ img.remove(); }catch(e){} } }; }
function boost(img){ try{ img.decoding='async'; retry(img);
  var card=img.closest('.poster-card'); var row=card&&card.parentNode; var i=row?Array.prototype.indexOf.call(row.children,card):99;
  var inRail=row&&row.classList&&(row.classList.contains('carousel')||row.classList.contains('won-carousel'));
  if((inRail&&i<8)||(!inRail&&i<12)){ img.loading='eager'; if(i<3) img.setAttribute('fetchpriority','high'); } }catch(e){} }
new MutationObserver(function(ms){ for(var k=0;k<ms.length;k++){ var a=ms[k].addedNodes; for(var j=0;j<a.length;j++){ var n=a[j]; if(n.nodeType!==1) continue;
  if(n.classList&&n.classList.contains('poster-img')) boost(n); else if(n.querySelectorAll){ var l=n.querySelectorAll('img.poster-img'); for(var q=0;q<l.length;q++) boost(l[q]); } } } })
  .observe(document.documentElement,{childList:true,subtree:true});
}catch(e){}})();</script>"""
fit_js = fit_js + img_js

# --- inject CSP + viewport + our styles right before the app's own </head>,
#     so our overrides come AFTER every app <style> block and win.
if TIZEN:
    tv_vp = ('<script id="rp-tvvp">(function(){try{ document.documentElement.classList.add("is-tv","tv-wide"); }catch(e){}})();</script>')
else:
    tv_vp = ('<script id="rp-tvvp">(function(){try{ if(!(window.ByoAndroid&&ByoAndroid.deviceInfo)) return; var d=JSON.parse(ByoAndroid.deviceInfo()||"{}"); if(!d.tv) return;'
         ' var m=document.querySelector(\'meta[name="viewport"]\'); if(m) m.setAttribute("content","width=1920, user-scalable=no, viewport-fit=cover"); document.documentElement.classList.add("tv-wide"); }catch(e){}})();</script>')
inject_head = ('\n' + force_tv + '\n' + SHIM + '\n' + csp + '\n' + viewport + '\n' + tv_vp + '\n'
               + fit_css + '\n' + mobile_css + '\n')
if '</head>' in s:
    s = s.replace('</head>', inject_head + '</head>', 1)
else:
    # no head? put after first <style> as a fallback
    s = s.replace('</style>', '</style>' + inject_head, 1)

# --- responsive EPG: the app hard-codes a 300px channel column and 6px/min;
#     measure the (CSS-fluid) column instead, and use 4px/min on phones.
for _a,_b in [
    ("var GUIDE_PXMIN=6;", "var GUIDE_PXMIN=((window.innerWidth||1920)<600?4:6);"),
    ("rows.style.width=(300+totalPx)+'px';", "rows.style.width=(window.__gchw()+totalPx)+'px';"),
    ("line.style.left=(300+nowMin*GUIDE_PXMIN)+'px';", "line.style.left=(window.__gchw()+nowMin*GUIDE_PXMIN)+'px';"),
    ("S._guideScrollToNow=function(){ var target=Math.max(0, nowMin*GUIDE_PXMIN - scroll.clientWidth*0.25); scroll.scrollLeft=target;",
     "S._guideScrollToNow=function(){ var _cw=window.__gchw(); var _nl=rows.querySelector('.guide-nowline'); if(_nl) _nl.style.left=(_cw+nowMin*GUIDE_PXMIN)+'px'; rows.style.width=(_cw+totalPx)+'px'; var _vw=scroll.clientWidth||window.innerWidth; var target=Math.max(0, nowMin*GUIDE_PXMIN - Math.max(0,_vw-_cw)*0.25); scroll.scrollLeft=target;"),
    ("setTimeout(function(){ S._guideScrollToNow&&S._guideScrollToNow(); },30);",
     "setTimeout(function(){ S._guideScrollToNow&&S._guideScrollToNow(); },30); setTimeout(function(){ S._guideScrollToNow&&S._guideScrollToNow(); },350);"
     " if(!window.__gNowObs){ window.__gNowObs=1; try{ var _vg=document.getElementById('view-guide'); new MutationObserver(function(){ if(_vg.classList.contains('active-view')&&!_vg.__wasA){ _vg.__wasA=1; setTimeout(function(){ S._guideScrollToNow&&S._guideScrollToNow(); },60); } else if(!_vg.classList.contains('active-view')) _vg.__wasA=0; }).observe(_vg,{attributes:true,attributeFilter:['class']}); }catch(e){} }"),
]:
    assert s.count(_a)==1, _a
    s = s.replace(_a, _b)
# --- Always land on Home after connecting (install, onboarding, auto-reconnect on launch).
for _a,_b in [
    ("renderAll(); hideConnectModal(); goTo('live');", "renderAll(); hideConnectModal(); goTo('home');"),
    ("hideConnectModal(); goTo(S.live.length?'live':(S.movies.length?'movies':'series'));", "hideConnectModal(); goTo('home');"),
    ("goTo(S.live.length?'live':(S.movies.length?'movies':(S.series.length?'series':'live')));", "goTo('home');"),
]:
    assert s.count(_a)==1, _a
    s = s.replace(_a, _b)
force_gchw = ('<script>window.__gchw=function(){try{var c=document.querySelector(".guide-corner");'
              'if(c&&c.offsetWidth) return c.offsetWidth; var w=window.innerWidth||1920; return w<600?132:Math.max(112,Math.min(300,Math.round(w*0.156)));}catch(e){return 300;}};</script>')
s = s.replace(force_tv, force_tv + force_gchw, 1)

# --- Emby/Jellyfin on Android WebView: the app's DeviceProfile describes Samsung AVPlay
#     (MKV/HEVC/AC3 direct play). Chrome/WebView can't decode those, so the server would hand
#     back a file that never starts. Off-Tizen, send a profile built from what THIS device's
#     WebView can really play; everything else gets remuxed/transcoded to HLS (hls.js).
for _a,_b in [
    ("var body={ DeviceProfile:profile,",
     "if(!(window.tizen||window.webapis)&&window.__byoWebProfile){ try{ profile=window.__byoWebProfile(maxBitrate); }catch(e){} }\n            var body={ DeviceProfile:profile,"),
    ("if(watchMode==='transcode'){ alt=S.emby.streamUrlDirect(watchId, watchCont); setToast('Switching to direct stream…'); }",
     "if(watchMode==='transcode' && (window.tizen||window.webapis)){ alt=S.emby.streamUrlDirect(watchId, watchCont); setToast('Switching to direct stream…'); }"),
]:
    assert s.count(_a)==1, _a
    s = s.replace(_a, _b)
web_profile = r"""<script id="rp-emby">window.__byoWebProfile=function(maxBitrate){
 var mb=maxBitrate||40000000, v=document.createElement('video');
 function can(t){ try{ if(window.MediaSource&&MediaSource.isTypeSupported&&MediaSource.isTypeSupported(t)) return true; var r=v.canPlayType(t); return r==='probably'||r==='maybe'; }catch(e){ return false; } }
 var vc=['h264'];
 if(can('video/mp4; codecs="hvc1.1.6.L120.90"')||can('video/mp4; codecs="hev1.1.6.L120.90"')) vc.push('hevc','h265');
 var av1=can('video/mp4; codecs="av01.0.05M.08"'); if(av1) vc.push('av1');
 var ac=['aac','mp3'];
 if(can('audio/mp4; codecs="opus"')) ac.push('opus');
 if(can('audio/mp4; codecs="flac"')) ac.push('flac');
 if(can('audio/mp4; codecs="ac-3"')) ac.push('ac3');
 if(can('audio/mp4; codecs="ec-3"')) ac.push('eac3');
 var wv=['vp8']; if(can('video/webm; codecs="vp9"')) wv.push('vp9'); if(av1) wv.push('av1');
 return { MaxStreamingBitrate:mb, MaxStaticBitrate:mb,
  DirectPlayProfiles:[
   {Container:'mp4,m4v', Type:'Video', VideoCodec:vc.join(','), AudioCodec:ac.join(',')},
   {Container:'webm', Type:'Video', VideoCodec:wv.join(','), AudioCodec:'opus,vorbis'} ],
  TranscodingProfiles:[
   {Container:'ts', Type:'Video', Protocol:'hls', VideoCodec:'h264', AudioCodec:'aac,mp3', Context:'Streaming',
    MaxAudioChannels:'2', MinSegments:'1', BreakOnNonKeyFrames:true} ],
  ContainerProfiles:[],
  CodecProfiles:[ {Type:'Video', Codec:'h264', Conditions:[
     {Condition:'NotEquals', Property:'IsInterlaced', Value:'true', IsRequired:false},
     {Condition:'LessThanEqual', Property:'VideoBitDepth', Value:'8', IsRequired:false},
     {Condition:'LessThanEqual', Property:'VideoLevel', Value:'51', IsRequired:false} ]} ],
  SubtitleProfiles:[ {Format:'vtt',Method:'External'},{Format:'srt',Method:'External'},{Format:'subrip',Method:'External'},
   {Format:'ass',Method:'Encode'},{Format:'ssa',Method:'Encode'},{Format:'pgssub',Method:'Encode'},{Format:'dvdsub',Method:'Encode'} ] };
};</script>"""
s = s.replace(force_tv, force_tv + web_profile, 1)

# --- Emby + Jellyfin auth compatibility: Jellyfin 10.11+/12 rejects X-Emby-Authorization and
#     the api_key= query param (wants Authorization: MediaBrowser … and ApiKey=). Emby keeps
#     using its own forms, so send both everywhere inside the connector.
_i=s.index('function embyApi(server,user,pass){'); _j=s.index('function xtreamApi(', _i)
_e=s[_i:_j]
_e=_e.replace("?api_key='+encodeURIComponent(token)", "?api_key='+encodeURIComponent(token)+'&ApiKey='+encodeURIComponent(token)")
_e=_e.replace("&api_key='+encodeURIComponent(token)", "&api_key='+encodeURIComponent(token)+'&ApiKey='+encodeURIComponent(token)")
_old="try{ x.setRequestHeader('X-Emby-Authorization', authHeader+(token?(', Token=\"'+token+'\"'):'')); }catch(e){}"
assert _old in _e
_e=_e.replace(_old, _old+" try{ x.setRequestHeader('Authorization', authHeader+(token?(', Token=\"'+token+'\"'):'')); }catch(e){}")
s=s[:_i]+_e+s[_j:]
# --- Ethiopia paywall: honour the local 30-day free trial (the License page promises it);
#     the telebirr subscription is only required once the trial has ended.
_a="function unlocked(){ return sub.unlocked===true; }"
assert s.count(_a)==1
s=s.replace(_a,"function unlocked(){ if(sub.unlocked===true) return true; try{ var L=ensureLicense(); if(L&&L.plan==='trial'&&trialDaysLeft()>0) return true; }catch(e){} return false; }")

# --- Android: let the in-app Exit actually close the app (window.close() is a no-op in WebView)
_x="try{ window.close(); }catch(e){}"
_k=s.index('function doExit(){'); _m=s.index(_x,_k)
s=s[:_m]+"try{ if(window.ByoAndroid&&ByoAndroid.exit){ ByoAndroid.exit(); return; } }catch(e){} "+s[_m:]

# --- remove the "Fix artwork" action from detail pages
_fa="function fixArtworkBtn(item, kind){ if(!TMDB.enabled()) return null;"
assert s.count(_fa)==1
s=s.replace(_fa,"function fixArtworkBtn(item, kind){ return null; if(!TMDB.enabled()) return null;")

# --- Android: movies & episodes play in the native ExoPlayer screen (original file, no transcode) ---
_pc="    function playContent(url,title,sub,opts){ opts=opts||{}; S.playerExiting=false;"
assert s.count(_pc)==1
s=s.replace(_pc, """    function playContent(url,title,sub,opts){ opts=opts||{};
        window.__byoPlayWeb=playContent;
        window.__byoAfterNative=function(ctx){ try{ S._inNative=false; S._nativeRouteTs=Date.now(); var o=(ctx&&ctx.opts)||{};
            // Back from a series episode: land on that series, on the season that was playing, with the episode highlighted.
            if(o.type==='episode'&&o.seriesId!=null){ var sr=null; (S.series||[]).forEach(function(x){ if(x.id===o.seriesId) sr=x; });
                if(sr&&sr.seasons){ openSeries(sr); setTimeout(function(){ try{ S.currentSeason=Math.max(0,Math.min(o.seasonIdx||0,sr.seasons.length-1)); renderSeasons(sr);
                    var rows=document.querySelectorAll('#detail-body .episode'); var tgt=rows[o.epIdx||0]||rows[0]; if(tgt){ Nav.setFocus(tgt); try{ tgt.scrollIntoView({block:'center'}); }catch(_e){} } }catch(_e){} },80); return; } }
            // Back from a movie: return to Movies.
            if(o.type==='movie'){ if(S.currentDetail&&S.currentDetail.type==='movie'&&$('view-detail').classList.contains('active-view')){ openMovie(S.currentDetail.data); return; } goTo('movies'); return; }
            }catch(e){} };
        // Web player, live channel: if nothing plays within 25 s, say so (with Next channel) instead of an endless "Getting it ready…".
        if(S._liveStartT){ clearTimeout(S._liveStartT); S._liveStartT=null; } S._playSeq=(S._playSeq||0)+1;
        if(opts.type==='live'&&!(window.ByoAndroid&&ByoAndroid.playNativeAll&&!opts._noNative)){ var __seq=S._playSeq;
            S._liveStartT=setTimeout(function(){ S._liveStartT=null; try{ if(S._playSeq!==__seq||!$('view-player').classList.contains('active-view')||playbackHealthy()) return;
                try{ Recovery.stop(); }catch(_e){}
                var __tr=(opts.__tried||[]).slice(); if(__tr.indexOf(url)<0) __tr.push(url);
                var __alt=(window.__byoAltSources?window.__byoAltSources(title,url,'live'):[]).filter(function(u){ return __tr.indexOf(u)<0; });
                if(__alt.length){ __tr.push(__alt[0]); var __o={}; for(var __k in opts) __o[__k]=opts[__k]; __o.__tried=__tr; delete __o._noNative; setToast('Trying another source for '+(title||'this channel')+'\u2026'); playContent(__alt[0],title,sub,__o); return; }
                var __geo=/\u24BC/.test(title||''), __ne=window.__byoNativeErr||'', __403=/HTTP 40[13]|HTTP 451/.test(__ne);
                var __msg=(__403?"The channel's server refused the connection from here":(__geo?"Your playlist marks this channel \u24BC (region-locked)":"This channel isn't sending any video right now"))+(__geo||__403?". It may only play in its home country, or through a VPN set to that country.":". Try again, or pick another channel.")+(__ne?(" (Details: "+__ne+")"):"");
                showPlayerError({message:__msg,_rechecked:true}); }catch(_e){} },opts.__quickFail?12000:45000); }
        if(window.ByoAndroid&&ByoAndroid.playNativeAll&&!opts._noNative){
            try{
                var nurl=url, isLive=(opts.type==='live');
                if(S.emby&&opts.embyId){ nurl=S.emby.streamUrlDirect(opts.embyId,''); }
                var P={ url:nurl, title:title||'', sub:sub||'', startMs:Math.round((opts.startAt||0)*1000), live:isLive, chIndex:0 };
                try{ var _hh=window.__byoStreamOpts&&window.__byoStreamOpts.headersFor(url); if(_hh) P.headers=_hh; }catch(_e){}
                try{ var _dd=window.__byoStreamOpts&&window.__byoStreamOpts.drmInfo(url); if(_dd) P.drm=_dd; }catch(_e){}
                if(S.emby&&opts.embyId){
                    var L=[{l:'1080p',w:1920,b:6000000},{l:'720p',w:1280,b:3500000},{l:'480p',w:854,b:1800000},{l:'360p',w:640,b:900000}];
                    P.qualities=L.map(function(x){ return { label:x.l, bitrate:x.b, url:S.emby.streamUrl(opts.embyId,'',{maxWidth:x.w,vbitrate:x.b}) }; });
                }
                var chIds=null;
                if(isLive){
                    try{ var all=(S.live||[]), cur=null; for(var ci=0;ci<all.length;ci++){ if(all[ci].id===opts.channelId){ cur=all[ci]; break; } }
                        var gg=cur?cur.genre:(opts.genre||''); var arr=all.filter(function(c){ return c&&c.url&&!/^stalker:/.test(c.url)&&StreamOpts.playable(StreamOpts.drmInfo(c.url))&&(!gg||c.genre===gg); }).slice(0,500);
                        var at=-1; for(var cj=0;cj<arr.length;cj++){ if(arr[cj].id===opts.channelId){ at=cj; break; } }
                        if(at<0){ arr.unshift({id:opts.channelId,name:title,genre:sub,url:url}); at=0; }
                        P.channels=arr.map(function(c){ var _o={ title:c.name||'', sub:c.genre||'', url:c.url }; try{ var _h=window.__byoStreamOpts&&window.__byoStreamOpts.headersFor(c.url); if(_h) _o.headers=_h; var _d2=window.__byoStreamOpts.drmInfo(c.url); if(_d2) _o.drm=_d2; }catch(_e){} return _o; }); P.chIndex=at; chIds=arr.map(function(c){ return c.id; });
                        if(opts.channelId){ Store.cfg.lastChannelId=opts.channelId; Store.save(); }
                    }catch(e){}
                }
                // Series: hand the player the episodes that follow, so it rolls on to the next one by itself.
                var eps=null; try{ if(opts.type==='episode'&&opts.nextEpisode){ eps=[]; var nx=opts.nextEpisode, guard=0;
                    while(nx&&guard++<30){ var _se=nx.s.seasons[nx.seasonIdx], _ep=_se&&_se.episodes[nx.epIdx]; if(!_ep||!_ep.url) break;
                        var _u=_ep.url; if(S.emby&&_ep.embyId){ try{ _u=S.emby.streamUrlDirect(_ep.embyId,''); }catch(_e){} }
                        var _k='ep:'+_ep.id, _r=Store.getResume(_k), _sub='S'+_se.n+' · '+_ep.title;
                        eps.push({url:_u, title:nx.s.title||'', sub:_sub, startMs:(_r&&_r.pct<0.95)?Math.round(_r.pos*1000):0, key:_k, srcUrl:_ep.url, poster:opts.poster||'', seasonIdx:nx.seasonIdx, epIdx:nx.epIdx,
                            meta:{ type:'episode', series:nx.s.title||'', epLabel:'Season '+_se.n+' \u00B7 Episode '+(_ep.n||(nx.epIdx+1))+(_ep.title&&!/^episode\s*\d+$/i.test(_ep.title)?(': '+_ep.title):''), plot:_ep.desc||nx.s.plot||'', poster:_ep.thumb||nx.s.logo||'' }});
                        nx=nextEpisodeOf(nx.s,nx.seasonIdx,nx.epIdx); }
                    if(eps.length) P.episodes=eps.map(function(e){ return {url:e.url,title:e.title,sub:e.sub,startMs:e.startMs,meta:e.meta}; }); else eps=null; } }catch(_e){ eps=null; }
                // Details for the pause screen in the TV player.
                var __favCtx=null;
                try{ var __m={}, __mv=null, __s=null; if(opts.type==='episode'){ __s=null; (S.series||[]).forEach(function(x){ if(x.id===opts.seriesId) __s=x; }); if(!__s&&opts.nextEpisode) __s=opts.nextEpisode.s;
                        if(__s){ var __se=__s.seasons&&__s.seasons[opts.seasonIdx||0], __ep=__se&&__se.episodes[opts.epIdx||0];
                            __m={ type:'episode', series:__s.title||'', epLabel:(__se?('Season '+__se.n):'')+(__ep?(' \u00B7 Episode '+(__ep.n||((opts.epIdx||0)+1))+(__ep.title&&!/^episode\s*\d+$/i.test(__ep.title)?(': '+__ep.title):'')):''), plot:(__ep&&__ep.desc)||__s.plot||'', poster:(__ep&&__ep.thumb)||__s.logo||'' }; } }
                    else if(opts.type==='movie'){ var __mid=String(opts.key||'').replace(/^movie:/,''), __mv=null; (S.movies||[]).forEach(function(x){ if(String(x.id)===__mid) __mv=x; });
                        if(__mv) __m={ type:'movie', plot:__mv.plot||__mv.desc||'', poster:__mv.logo||'', year:String(__mv.year||''), genre:String(__mv.genre||'') }; }
                    // Favourite button in the TV player: which title it applies to (the series for an episode).
                    try{ var __fk=null, __fo=null; if(opts.type==='episode'&&__s){ __fk='series'; __fo=__s; } else if(opts.type==='movie'&&__mv){ __fk='movies'; __fo=__mv; }
                        if(__fk&&__fo&&__m.type){ __m.favKind=__fk; __m.fav=Store.isFav(__fk,__fo.id);
                            __favCtx={ kind:__fk, id:__fo.id, obj:{id:__fo.id,title:__fo.title,genre:__fo.genre,year:__fo.year,rating:__fo.rating,gi:__fo.gi,plot:__fo.plot,order:__fo.order,logo:__fo.logo} }; } }catch(_f){}
                    // In-player episode picker: every episode of the series (a window around the current one on huge shows).
                    try{ if(opts.type==='episode'&&__s&&__s.seasons){ var __all=[], __map=[], __cur=-1;
                        __s.seasons.forEach(function(se,si){ (se&&se.episodes||[]).forEach(function(ep,ei){ if(!ep||!ep.url) return;
                            if(si===(opts.seasonIdx||0)&&ei===(opts.epIdx||0)) __cur=__all.length;
                            var k='ep:'+ep.id, rr=Store.getResume(k), w=Store.isWatched&&Store.isWatched(k)?1:(rr&&rr.pct?Math.min(0.99,rr.pct):0);
                            __all.push({ s:se.n, n:ep.n||(ei+1), t:(ep.title&&!/^episode\s*\d+$/i.test(ep.title))?String(ep.title).slice(0,80):'', w:Math.round(w*100)/100 }); __map.push([si,ei]); }); });
                        if(__cur>=0&&__all.length>1){ var __a=Math.max(0,Math.min(__cur-300,__all.length-600)), __b=Math.min(__all.length,__a+600);
                            __m.allEps=__all.slice(__a,__b); __m.curEp=__cur-__a; __m.seasonCount=__s.seasons.length; window.__byoEpPick={ sid:__s.id, s:__s, map:__map.slice(__a,__b) }; } else window.__byoEpPick=null; } else window.__byoEpPick=null; }catch(_ap){ window.__byoEpPick=null; }
                    if(__m.type) P.meta=__m; }catch(_e){}
                // Lighter copies of the same film from the provider's own list (the 4K / 1080p / HD / SD
                // duplicates that were folded into one card) become quality levels for the TV player:
                // it opens on one the line can carry and drops to the next when the connection can't
                // keep up, instead of pausing to buffer. Bitrates are estimates from the name tags.
                try{ if(opts.type==='movie'&&__mv&&!S.emby&&!P.qualities){
                    function __est(nm){ var t=String(nm||''); var b=4.5e6;
                        if(/\b(2160p?|4k|uhd)\b/i.test(t)) b=16e6; else if(/\b(1080p?|fhd|full\s?hd)\b/i.test(t)) b=6.5e6; else if(/\b(720p?|hd)\b/i.test(t)) b=3.5e6; else if(/\b(480p?|sd|cam|ts)\b/i.test(t)) b=1.5e6;
                        if(/\b(hevc|x265|h\.?265)\b/i.test(t)) b=Math.round(b*0.6); return b; }
                    function __lab(nm){ var t=String(nm||''); if(/\b(2160p?|4k|uhd)\b/i.test(t)) return '4K'; if(/\b(1080p?|fhd|full\s?hd)\b/i.test(t)) return '1080p'; if(/\b(720p?|hd)\b/i.test(t)) return 'HD'; if(/\b(480p?|sd)\b/i.test(t)) return 'SD'; return 'Lighter copy'; }
                    var __ob=__est(__mv.title); P.origBitrate=__ob;
                    var __alts=(__mv.sources||[]).filter(function(sx){ return sx&&sx.url&&sx.url!==url; }).map(function(sx){ return { label:__lab(sx.name), url:sx.url, bitrate:__est(sx.name) }; })
                        .filter(function(q){ return q.bitrate<__ob; }).sort(function(a,b){ return b.bitrate-a.bitrate; });
                    var __seen={}; __alts=__alts.filter(function(q){ if(__seen[q.label]) return false; __seen[q.label]=1; return true; });
                    if(__alts.length) P.qualities=__alts; } }catch(_q){}
                S._inNative=true; window.__byoNativeStartAt=Date.now(); window.__byoNativePlayed=undefined;
                window.__byoNativeCtx={url:url,title:title,sub:sub,opts:opts,chIds:chIds,eps:eps,fav:__favCtx};
                try{ localStorage.setItem('byo_native_ctx', JSON.stringify(window.__byoNativeCtx)); }catch(e){}
                try{ Store.addHistory({ url:url, title:title, sub:sub||'', type:opts.type||'live', poster:opts.poster||'', genre:opts.genre||'', key:opts.key||'', channelId:opts.channelId||'', ts:Date.now() }); }catch(e){}
                try{ P.guard={ url:BYO_BACKEND.url, anon:BYO_BACKEND.anon, key:Billing.deviceId() }; }catch(_g){}
                ByoAndroid.playNativeAll(JSON.stringify(P));
                return;
            }catch(e){}
        }
        S.playerExiting=false;""")
native_js = r"""<script id="rp-native">window.__byoNativeResult=function(status,posMs,durMs,chIdx,thumb,epIdx,nerr,fav,pick){ try{ var __pk=window.__byoEpPick; window.__byoEpPick=null; try{ var _nc=window.__byoNativeCtx; var _lv=_nc&&_nc.opts&&_nc.opts.type==='live'&&_nc.opts.channelId; if(_lv){ var _chn=(typeof chanById==='function')?chanById(_nc.opts.channelId):null; if(window.__byoNativePlayed===true) ChanHealth.played(_chn); else if(window.__byoNativePlayed===false&&status!=='error'&&Date.now()-(window.__byoNativeStartAt||0)>8000) ChanHealth.noVideo(_chn,'no video when played'); } }catch(_hh){} if(status==='pickEp') status='ok'; if(status==='paused'){ try{ Support.checkin(); }catch(_p){} status='ok'; } window.__byoNativeErr=(status==='error'&&nerr)?String(nerr):'';
 var c=window.__byoNativeCtx; if(!c){ try{ c=JSON.parse(localStorage.getItem('byo_native_ctx')||'null'); }catch(e){} } if(!c) return;
 try{ if((fav==='1'||fav==='0')&&c.fav){ var _now=Store.isFav(c.fav.kind,c.fav.id); if((fav==='1')!==_now) Store.toggleFav(c.fav.kind,c.fav.id,c.fav.obj); } }catch(_fv){}
 // Auto-played on to later episodes: the earlier ones were watched to the end; the last one is where we stopped.
 if(epIdx>0&&c.eps&&c.eps.length){ try{ var _done=[c.opts.key].concat(c.eps.slice(0,epIdx-1).map(function(e){ return e.key; }));
   _done.forEach(function(k){ if(k){ Store.clearResume(k); if(Store.markWatched) Store.markWatched(k); } });
   var _cur=c.eps[Math.min(epIdx,c.eps.length)-1]; var _o={}; for(var _k in c.opts) _o[_k]=c.opts[_k]; _o.key=_cur.key; _o.nextEpisode=null; _o.startAt=0; if(_cur.seasonIdx!=null){ _o.seasonIdx=_cur.seasonIdx; _o.epIdx=_cur.epIdx; }
   c={url:_cur.srcUrl,title:_cur.title,sub:_cur.sub,opts:_o,chIds:null};
   try{ Store.addHistory({ url:_cur.srcUrl, title:_cur.title, sub:_cur.sub, type:'episode', poster:_o.poster||'', genre:_o.genre||'', key:_cur.key, channelId:'', ts:Date.now() }); }catch(_e){} }catch(_e){} }
 if(status==='error'){ var o={}; for(var k in c.opts) o[k]=c.opts[k];
   // Live channel the TV player couldn't open: first try the same channel from your other playlist entries
   // (the way the app's recovery always failed over), then the web player.
   if(o.type==='live'&&window.__byoAltSources&&window.__byoPlayWeb){ var tried=(o.__tried||[]).slice(); if(tried.indexOf(c.url)<0) tried.push(c.url);
     var alts=(window.__byoAltSources(c.title,c.url,'live')||[]).filter(function(u){ return tried.indexOf(u)<0; });
     if(alts.length){ tried.push(alts[0]); o.__tried=tried; delete o._noNative; try{ window.__byoToast&&window.__byoToast('Trying another source for '+(c.title||'this channel')+'\u2026'); }catch(_e){} window.__byoPlayWeb(alts[0],c.title,c.sub,o); return; } }
   o._noNative=true; if(o.type==='live'&&/HTTP 4\d\d/.test(String(nerr||''))) o.__quickFail=true; if(window.__byoPlayWeb) window.__byoPlayWeb(c.url,c.title,c.sub,o); return; }
 if(c.chIds&&chIdx!=null&&c.chIds[chIdx]){ try{ Store.cfg.lastChannelId=c.chIds[chIdx]; Store.save(); }catch(e){} }
 var key=c.opts.key; if(key&&durMs>0&&(c.opts.type==='movie'||c.opts.type==='episode')){ var pos=posMs/1000, dur=durMs/1000, pct=pos/dur;
   if(pct>0.97||status==='ended'){ Store.clearResume(key); if(Store.markWatched) Store.markWatched(key); }
   else if(pos>3){ var _prev=Store.getResume(key)||{}; Store.setResume(key,{pos:pos,dur:dur,pct:pct,title:c.title,sub:c.sub,url:c.url,poster:c.opts.poster||'',frame:(thumb||_prev.frame||''),type:c.opts.type,ts:Date.now()}); } }
 if(window.__byoAfterNative) window.__byoAfterNative(c);
 // Picked another episode from the list inside the player: play it now.
 if(pick!=null&&pick>=0&&__pk&&__pk.map[pick]){ var __mp=__pk.map[pick], __ss=__pk.s;
   setTimeout(function(){ try{ window.__byoPlayEp&&window.__byoPlayEp(__ss,__mp[0],__mp[1]); }catch(_e){} },150); }
}catch(e){} };</script>"""
s=(s.replace('</body>', native_js+'</body>',1) if '</body>' in s else s+native_js)

# --- Artwork everywhere: Emby backdrops, real art in Continue watching / hero, never a blank card ---
_r=[
 ("var IMG=function(id,tag,type){ return base+'/Items/'+id+'/Images/'+(type||'Primary')+'?maxWidth=400",
  "var IMG=function(id,tag,type){ return base+'/Items/'+id+'/Images/'+(type||'Primary')+'?maxWidth='+(type==='Backdrop'?1280:360)+'&quality=80"),
 ("logo:(o.ImageTags&&o.ImageTags.Primary)?api.imageUrl(o.Id,o.ImageTags.Primary):'', url:api.streamUrl(o.Id,ct)}; });",
  "logo:(o.ImageTags&&o.ImageTags.Primary)?api.imageUrl(o.Id,o.ImageTags.Primary):'', backdrop:(o.BackdropImageTags&&o.BackdropImageTags[0])?api.imageUrl(o.Id,o.BackdropImageTags[0],'Backdrop'):'', url:api.streamUrl(o.Id,ct)}; });"),
 ("embySeriesId:o.Id,\n                    logo:(o.ImageTags&&o.ImageTags.Primary)?api.imageUrl(o.Id,o.ImageTags.Primary):''}; });",
  "embySeriesId:o.Id,\n                    logo:(o.ImageTags&&o.ImageTags.Primary)?api.imageUrl(o.Id,o.ImageTags.Primary):'', backdrop:(o.BackdropImageTags&&o.BackdropImageTags[0])?api.imageUrl(o.Id,o.BackdropImageTags[0],'Backdrop'):''}; });"),
]
for _a,_b in _r:
    assert s.count(_a)==1, _a[:60]
    s=s.replace(_a,_b)
s=s.replace("poster:g(m.gi)","poster:(m.backdrop||m.logo||g(m.gi))")
s=s.replace("poster:g(s.gi)","poster:(s.backdrop||s.logo||g(s.gi))")
s=s.replace("poster:g(feat.gi)","poster:(feat.backdrop||feat.logo||g(feat.gi))")
# hero: prefer titles that have artwork, and paint it
_h="        var pool=profFilter(S.movies).filter(function(m){ return !itemLowPriority(m); });\n        if(!pool.length) pool=profFilter(S.movies);"
assert s.count(_h)==1
s=s.replace(_h,_h+"\n        var _art=pool.filter(function(m){ return m.backdrop||m.logo; }); if(_art.length>=3) pool=_art;")
_h2="var hero=document.createElement('div'); hero.className='hero'; hero.style.background=g(feat.gi);"
assert s.count(_h2)==1
s=s.replace(_h2, _h2+" var _hi=feat.backdrop||feat.logo; if(_hi){ hero.classList.add('has-art'); hero.style.background='#05070d url(\"'+_hi.replace(/\"/g,'%22')+'\") center '+(feat.backdrop?'30%':'22%')+'/cover no-repeat'; if(!feat.backdrop) hero.classList.add('art-poster'); }")
# continue watching: look up real art for older entries; designed placeholder otherwise
_c="var bg=r.poster||g(1); var isUrl=/^(https?:|data:|\\/)/.test(bg);"
# (Home v2 has no Continue-watching row; this patch is a no-op when the code is absent)
s=s.replace(_c,"""var bg=r.poster||g(1); var isUrl=/^(https?:|data:|\\/)/.test(bg);
                if(!isUrl){ try{ var _k=r._key||''; var _it=null;
                    if(_k.indexOf('movie:')===0){ var _id=_k.slice(6); for(var _i=0;_i<S.movies.length;_i++){ if(S.movies[_i].id===_id){ _it=S.movies[_i]; break; } } }
                    if(!_it){ var _t=(r.title||'').toLowerCase(), _s=(r.sub||'').toLowerCase(); var _all=S.movies.concat(S.series);
                        for(var _j=0;_j<_all.length;_j++){ var _n=(_all[_j].title||'').toLowerCase(); if(_n&&(_n===_t||(_s&&_s.indexOf(_n)===0))){ _it=_all[_j]; break; } } }
                    if(_it&&(_it.backdrop||_it.logo)){ bg=_it.backdrop||_it.logo; isUrl=true; } }catch(e){} }""")
_c2="""(isUrl?'<img src="'+esc(bg)+'" loading="lazy" onerror="this.style.display=\\'none\\';this.parentNode.style.background=\\''+g(1)+'\\'"/>':'<div class="cw-fill" style="background:'+bg+'"></div>')"""
# (Home v2 has no Continue-watching row; this patch is a no-op when the code is absent)
s=s.replace(_c2, """(isUrl?'<img src="'+esc(bg)+'" loading="lazy" onerror="this.style.display=\\'none\\';this.parentNode.classList.add(\\'cw-noart\\')"/>':'<div class="cw-fill" style="background:'+bg+'"></div>')+'<span class="cw-ph">'+esc(r.title||'')+'</span>'""")

# --- Continue watching: prefer the frame captured where playback stopped ---
_f="var bg=r.poster||g(1); var isUrl="
# (Home v2 has no Continue-watching row; this patch is a no-op when the code is absent)
s=s.replace(_f,"var bg=r.frame||r.poster||g(1); var isUrl=")

# --- Live: amateur / high-school sports channels go to the bottom of the default order ---
_lv="        S.liveView=sorted; return S.liveView; }"
assert s.count(_lv)==1, 'liveview'
s=s.replace(_lv,"""        if(!q && S.liveSort==='added'){ try{ var _lp=(typeof LOWPRI_SPORT!=='undefined')?LOWPRI_SPORT:/\\b(nfhs|high\\s?school|varsity|\\bjv\\b|middle\\s?school|youth)\\b/i;
            var _hi=[], _lo=[]; sorted.forEach(function(c){ ((_lp.test(c.name||'')||_lp.test(c.genre||''))?_lo:_hi).push(c); }); sorted=_hi.concat(_lo); }catch(e){} }
        S.liveView=sorted; return S.liveView; }""")
# --- Guide: same rule, high-school / amateur channels go to the bottom ---
_gf="var GUIDE_CAP=S._guideCap||150; var chans=filtered.slice(0,GUIDE_CAP);"
assert s.count(_gf)==1, 'guidecap'
s=s.replace(_gf,"""try{ var _glp=(typeof LOWPRI_SPORT!=='undefined')?LOWPRI_SPORT:/\\b(nfhs|high\\s?school|varsity|\\bjv\\b|middle\\s?school|youth)\\b/i; var _gh=[],_gl=[]; filtered.forEach(function(c){ ((_glp.test(c.name||'')||_glp.test(c.genre||''))?_gl:_gh).push(c); }); filtered=_gh.concat(_gl); }catch(e){} """+_gf)
# --- Live: auto-load more channels when the PAGE scrolls (phones scroll the page, not the panel) ---
_wl="    function wireLiveLazyLoad(){ var sc=$('live-grid'); if(!sc) return;"
assert s.count(_wl)==1, 'lazy'
s=s.replace(_wl,_wl+"""
        window.addEventListener('scroll',function(){ if(!$('view-live')||!$('view-live').classList.contains('active-view')) return;
            if(S._liveShown>=S.liveView.length) return; var r=sc.getBoundingClientRect(); if(r.bottom < window.innerHeight+900){ liveRenderMore(); } },{passive:true});""")

# --- Home pictures: drop Continue-watching items that are not in the current library (e.g. demo
#     leftovers after connecting a real playlist), and fall back to other Emby artwork types ---
_cw="var resumeItems=Object.keys(Store.resume).map(function(k){ var r=Store.resume[k]; r._key=k; return r; }).sort(function(a,b){ return b.ts-a.ts; });"
# cw-filter: optional (Home v2)
s=s.replace(_cw, _cw+"""
        try{ if(S.movies&&S.movies.length){ var _ids={}; S.movies.forEach(function(m){ _ids[m.id]=1; });
            resumeItems=resumeItems.filter(function(r){ var k=r._key||''; return k.indexOf('movie:')!==0 || _ids[k.slice(6)]; }); } }catch(e){}""")
for _old,_new in [
  ("logo:(o.ImageTags&&o.ImageTags.Primary)?api.imageUrl(o.Id,o.ImageTags.Primary):'', backdrop:",
   "logo:(o.ImageTags&&o.ImageTags.Primary)?api.imageUrl(o.Id,o.ImageTags.Primary):((o.ImageTags&&o.ImageTags.Thumb)?api.imageUrl(o.Id,o.ImageTags.Thumb,'Thumb'):((o.BackdropImageTags&&o.BackdropImageTags[0])?api.imageUrl(o.Id,o.BackdropImageTags[0],'Backdrop'):'')), backdrop:"),
]:
    _n=s.count(_old); assert _n==2, ('emby-logo',_n)
    s=s.replace(_old,_new)

# --- My TV greeting: no ", You" for the default profile name ---
_g="esc(mytvGreeting())+', '+esc(p.name)"
assert s.count(_g)==1, 'greet'
s=s.replace(_g,"esc(mytvGreeting())+((p.name&&!/^you$/i.test(p.name))?(', '+esc(p.name)):'')")

# --- My TV watchlist cards: show the real poster when the item has one ---
_w="""card.innerHTML='<div class="poster" style="background:'+bg+'">'+esc(w.title||'')+badge+'</div>"""
assert s.count(_w)==1, 'mytvcard'
s=s.replace(_w,"""var _lg=(it&&(it.logo||it.backdrop))||''; card.innerHTML='<div class="poster" style="background:'+bg+'">'+(_lg?'<img class="poster-img" src="'+esc(_lg)+'" loading="lazy" onload="this.parentNode.classList.add(\\'has-img\\')" onerror="this.remove()"/>':'')+'<span class="poster-ph">'+esc(w.title||'')+'</span>'+badge+'</div>""")

# ================= Live football scores (ESPN) =================
_LS=open('livescores.js',encoding='utf-8').read()
def _rep(a,b,tag):
    global s
    assert s.count(a)==1, 'live-scores patch: '+tag
    s=s.replace(a,b)
_rep("    function allSportEvents(){", _LS+"\n"+open('chanevents.js',encoding='utf-8').read()+"\n    function allSportEvents(){", 'module')
_rep("        // index\n        var byChannel={};", "        try{ LiveScores.events().forEach(function(ev0){ events.push(ev0); }); }catch(e){}\n        try{ ChanEvents.events(events).forEach(function(ev0){ events.push(ev0); }); }catch(e){}\n        events=_mergeDupEvents(events);\n        events=events.filter(function(ev0){ return !eventIsLowPriority(ev0); });\n        // index\n        var byChannel={};", 'index')
# De-duplicate the merged event list: the SAME match arrives both from the live-score feed (ESPN)
# and from several provider channel names ("Real Madrid vs Manresa" on DAZN CA, DAZN US, ...), so it
# showed as many identical cards. Merge by normalized teams (or title) within a 3h time window; keep
# the richest record (ESPN, which carries crests/score) as the base and fold every duplicate's
# channels into it.
_rep("    function sportsIndex(){ if(!_sportsIndex) buildSportsIndex(); return _sportsIndex; }",
     "    function _normTeam(s){ return String(s||'').toLowerCase().replace(/\\b(fc|cf|afc|sc|ac|club|cd|ud|real|deportivo)\\b/g,' ').replace(/[^a-z0-9]+/g,'').trim(); }\n"
     "    function _evMatchKey(e){ var h=_normTeam(e.home), a=_normTeam(e.away);\n"
     "        var teams = (h&&a) ? [h,a].sort().join('~') : String(e.title||'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();\n"
     "        if(!teams) return null;\n"
     "        var t=+e.start; if(isNaN(t)) t=0; var bucket=Math.round(t/(3*3600000)); // 3-hour window\n"
     "        return (e.sport||'')+'|'+teams+'|'+bucket; }\n"
     "    function _mergeDupEvents(list){ var by={}, out=[];\n"
     "        for(var i=0;i<list.length;i++){ var e=list[i]; var k=_evMatchKey(e);\n"
     "            if(!k){ out.push(e); continue; }\n"
     "            var ex=by[k];\n"
     "            if(!ex){ by[k]=e; out.push(e); continue; }\n"
     "            // Prefer the ESPN record as the kept base (crests, live score). If the incoming one is\n"
     "            // ESPN and the kept one isn't, swap the kept base in place.\n"
     "            var base=ex, extra=e;\n"
     "            if(e._espn && !ex._espn){ var idx=out.indexOf(ex); if(idx>-1) out[idx]=e; by[k]=e; base=e; extra=ex; }\n"
     "            // Fold channels from the duplicate into the base (unique by id).\n"
     "            base.channels=base.channels||[]; (extra.channels||[]).forEach(function(ch){ if(!base.channels.some(function(x){return x.id===ch.id;})) base.channels.push(ch); });\n"
     "            // Fill any missing crest/competition/time from the duplicate.\n"
     "            if(!base.home && extra.home) base.home=extra.home; if(!base.away && extra.away) base.away=extra.away;\n"
     "            if(!base.competition && extra.competition) base.competition=extra.competition;\n"
     "            if(!base.homeCrest && extra.homeCrest) base.homeCrest=extra.homeCrest;\n"
     "            if(!base.awayCrest && extra.awayCrest) base.awayCrest=extra.awayCrest;\n"
     "        }\n"
     "        return out; }\n"
     "    function sportsIndex(){ if(!_sportsIndex) buildSportsIndex(); return _sportsIndex; }",
     'mergedup')
_rep("function evStatus(ev0){ var now=Date.now();", "function evStatus(ev0){ if(ev0&&ev0._state) return ev0._state==='in'?'live':(ev0._state==='pre'?'upcoming':'finished'); var now=Date.now();", 'evstatus')
_rep("function eventCard(e){", "function eventCard(e){ var _c=_eventCardBase(e); try{ LiveScores.decorate(_c,e); }catch(_x){} return _c; }\n    function _eventCardBase(e){", 'card')
_rep("showView('sportdetail'); setTimeout(function(){ Nav.setFocus(scroll.querySelector('.watch-row, .play-btn, .sd-back')); },30);",
     "try{ LiveScores.decorateDetail(scroll,e); }catch(_x){} showView('sportdetail'); setTimeout(function(){ Nav.setFocus(scroll.querySelector('.watch-row, .play-btn, .sd-back')); },30);", 'detail')
_rep("w.addEventListener('click',function(){ if(ch) playSportChannel(ch); });", "w.addEventListener('click',function(){ if(ch) playSportChannel(ch); else openSportEvent(e); });", 'hero')
_rep("if(la!==lb) return la-lb;", "if(la!==lb) return la-lb; var _pa=a._prio||30, _pb=b._prio||30; if(_pa!==_pb) return _pa-_pb;", 'prio')
_rep("// Tonight timeline", "var _res=filteredEvents(LiveScores.results()); if(_res.length){ body.appendChild(LiveScores.leagueBlock('Results',_res,{sub:'Finished in the last day',showLeague:true,icon:icon('i-check'),max:5})); }\n        // Tonight timeline", 'results')
_rep("comps.slice(0,4).forEach(function(gr){ var upc=filteredEvents(gr.events).filter(function(e){ return evStatus(e)!=='finished'; }); if(!upc.length) return; var rr=rowEl(sportIcon(gr.sport)+' ',gr.competition); rr.appendChild(carousel(upc.map(sportsHubCard))); body.appendChild(rr); });",
     "comps.sort(function(a,b){ return ((a.events[0]&&a.events[0]._prio)||50)-((b.events[0]&&b.events[0]._prio)||50); }); var _espnComps=comps.filter(function(gr){ return gr.events[0]&&gr.events[0]._espn; }); if(_espnComps.length){ var _fh=document.createElement('div'); _fh.className='sports-row-title ls-fixtures-h'; _fh.innerHTML=sportIcon('Football')+' Fixtures by league'; body.appendChild(_fh); }\n        _espnComps.forEach(function(gr){ var upc=filteredEvents(gr.events).filter(function(e){ return evStatus(e)!=='finished'; }).sort(function(a,b){ return a.start-b.start; }); if(!upc.length) return; body.appendChild(LiveScores.leagueBlock(gr.competition,upc)); });\n        comps.filter(function(gr){ return !(gr.events[0]&&gr.events[0]._espn); }).slice(0,4).forEach(function(gr){ var upc=filteredEvents(gr.events).filter(function(e){ return evStatus(e)!=='finished'; }); if(!upc.length) return; var rr=rowEl(sportIcon(gr.sport)+' ',gr.competition); rr.appendChild(carousel(upc.map(sportsHubCard))); body.appendChild(rr); });", 'leagues')
_rep("var ch=primaryChannel(e); if(!ch) return;",
     "if(e&&e._espn) LiveScores.follow(e,true); var ch=primaryChannel(e); if(!ch){ if(e&&e._espn){ setToast('Alerts on: you will be told at kick-off and when goals go in.'); if($('view-sportdetail').classList.contains('active-view')) openSportEvent(e); else if($('view-sports').classList.contains('active-view')) renderSports(); } return; }", 'remind')
_rep("else b['tomorrow'].push(e); });", "else if(+e.start<=+todayEnd+86400000) b['tomorrow'].push(e); else (b.later=b.later||[]).push(e); });", 'later1')
_rep("['30','2h','tonight','tomorrow'].forEach", "['30','2h','tonight','tomorrow','later'].forEach", 'later2')
_rep("'tomorrow':'Tomorrow'};", "'tomorrow':'Tomorrow','later':'Later this week'};", 'later3')
_rep("var evs=filteredEvents(buckets[k]);", "var evs=filteredEvents(buckets[k]||[]);", 'later4')
_rep("$('btn-connect').addEventListener('click',connect);", "setTimeout(function(){ try{ LiveScores.start(); }catch(e){} },2500); $('btn-connect').addEventListener('click',connect);", 'start')

# ================= Phone polish: reminders, My TV art, channel logos =================
_EX=open('extras.js',encoding='utf-8').read()
import os as _os
_LG={f[:-4]:1 for f in _os.listdir(_os.path.join(_os.path.dirname(_os.path.abspath(out)),'logos')) if f.endswith('.png')} if _os.path.isdir(_os.path.join(_os.path.dirname(_os.path.abspath(out)),'logos')) else {}
_EX='    window.__BYO_LOGOS='+__import__('json').dumps(_LG)+';\n'+_EX
_rep("    function openCatPicker(kind){", _EX+"\n    function openCatPicker(kind){", 'extras')
_rep("return x.channelId===chId&&x.title===title&&x.start===start;", "return x.channelId===chId&&x.title===title&&(x.start===start||x.evStart===start);", 'hasrem')
_rep("Store.addReminder({channelId:ch.id,channelName:ch.name,title:e.title,start:start,", "Store.addReminder({channelId:ch.id,channelName:ch.name,title:e.title,evStart:+e.start,start:start,", 'evstart')
_rep("var st=evStatus(e); var ch=primaryChannel(e);\n        var hero=document.createElement('div'); hero.className='sports-hero'",
     "var st=evStatus(e); var ch=primaryChannel(e);\n        if(st==='upcoming'&&__evHasReminder(e)){ body.appendChild(__heroMini(e)); return; }\n        var hero=document.createElement('div'); hero.className='sports-hero'", 'heromini')
_rep("$('reminder-pop').classList.remove('hidden');", "$('reminder-pop').classList.remove('hidden'); try{ if(document.hidden&&window.ByoAndroid&&ByoAndroid.toast) ByoAndroid.toast('Reminder: '+r.title+(mins>0?' starts in '+mins+' min':' is starting now')+(r.channelName?' on '+r.channelName:'')); }catch(_e){}", 'remtoast')
_rep(".filter(function(r){ return r&&r.pos&&r.dur&&r.pos<r.dur*0.95; })", ".filter(function(r){ return r&&r.pos&&r.dur&&r.pos<r.dur*0.95&&__cwValid(r); })", 'cwvalid')
_rep("""card.innerHTML='<div class="poster" style="background:'+(r.poster||g(1))+'">'+esc(r.title)+'<div class="resume">""",
     """card.innerHTML=__posterHTML(r,g(1),'').replace(/<\\/div>$/,'')+'<div class="resume">""", 'cwart')
_rep("""'<div class="poster" style="background:'+(e.poster||g(2))+'">'+icon(tIcon)+'</div>""", """__posterHTML(e,g(2),__artFor(e)?'':icon(tIcon))+'""", 'recentart')
_rep("""var state=live?'<span class="mytv-badge live">LIVE NOW</span>':(soon?'<span class="mytv-badge">STARTING SOON</span>':'<span class="mytv-badge">in '+mins+' min</span>');""",
     """var state=live?'<span class="mytv-badge live">LIVE NOW</span>':(soon?'<span class="mytv-badge">STARTING SOON</span>':(mins<90?'<span class="mytv-badge">in '+mins+' min</span>':'<span class="mytv-badge">'+esc(fmtEvTime(r.evStart||r.start))+'</span>'));""", 'remstate')
_rep("var when=TimeService.fmtTime(r.start);", "var when=fmtEvTime(r.evStart||r.start);", 'remwhen')
_rep("            if(isChan){ if(val==='All'){", "            var _bt=(isChan&&val!=='All')?brandTile(val):''; var _gi=(isChan&&val!=='All'&&!_bt)?genreIcon(val):'';\n            if(isChan&&val==='All'){ vis='<span class=\"ct-ic\">'+icon('i-grid')+'</span>'; } else if(_bt){ vis=_bt; } else if(_gi&&_gi!=='gn-generic'){ vis='<span class=\"ct-ic\">'+icon(_gi)+'</span>'; } else if(isChan){ vis=monoTile(val); }\n            else if(false){ if(val==='All'){", 'chantile')
_rep("if(isChan){ if(cur==='All'){ lead='<span class=\"cc-ic\">'+icon('i-live')+'</span>'; } else {",
     "var _cbl=(isChan&&cur&&cur!=='All')?brandLogo(cur):''; if(_cbl){ lead='<span class=\"cc-logo cc-img\"><img src=\"'+esc(_cbl)+'\" alt=\"\" onerror=\"this.remove()\"/></span>'; } else if(isChan){ if(cur==='All'){ lead='<span class=\"cc-ic\">'+icon('i-live')+'</span>'; } else {", 'ccbtn')

_rep("setToast('Reminder set — '", "setToast('Reminder set: '", 'remtoasttxt')
s=s.replace("t.textContent=msg; t.style.opacity='1';", "t.textContent=String(msg).replace(/ — /g,': '); t.style.opacity='1';",1)
_rep("for(var key in PROVIDER_BRAND){ if(key.length>bestLen && k.indexOf(key)>-1){ best=key; bestLen=key.length; } }",
     "var _kw=' '+k.replace(/[^a-z0-9+&]+/g,' ')+' '; for(var key in PROVIDER_BRAND){ if(key.length>bestLen && (_kw.indexOf(' '+key+' ')>-1||(key.length>=6&&k.indexOf(key)>-1&&!/^(max|sky|apple|amazon)$/.test(key)))){ best=key; bestLen=key.length; } }", 'provword')
# ================= Playlist URL robustness (paste in app) =================
s=s.replace(force_tv, force_tv+open('netfix.js',encoding='utf-8').read(), 1)
for _id,_url in [('m-url',1),('m-epg',1),('x-server',1),('x-user',0),('x-pass',0),('e-server',1),('e-user',0),('e-pass',0)]:
    _a='<input id="%s" '%_id
    assert s.count(_a)==1, _id
    s=s.replace(_a, _a+'autocapitalize="off" autocorrect="off" spellcheck="false" '+('inputmode="url" ' if _url else ''))
_rep("if(S.mode==='m3u'){ var url=$('m-url').value.trim();", "if(S.mode==='m3u'){ var url=window.__cleanUrl($('m-url').value); $('m-url').value=url; try{ $('m-epg').value=window.__cleanUrl($('m-epg').value); }catch(_e){}", 'm3uclean')
_rep("var server=$('x-server').value.trim(), user=$('x-user').value.trim(), pass=$('x-pass').value.trim();",
     "var server=window.__cleanUrl($('x-server').value), user=$('x-user').value.trim(), pass=$('x-pass').value.trim(); var _sx=window.__splitXtream(server); if(_sx){ server=_sx.server; if(!user) user=_sx.user; if(!pass) pass=_sx.pass; $('x-user').value=user; $('x-pass').value=pass; } else { server=server.replace(/\/+$/,''); } $('x-server').value=server;", 'xclean')
_rep("var server=$('e-server').value.trim(), user=$('e-user').value.trim(), pass=$('e-pass').value;", "var server=window.__cleanUrl($('e-server').value).replace(/\/+$/,''), user=$('e-user').value.trim(), pass=$('e-pass').value; $('e-server').value=server;", 'eclean')
_rep("""        rawGet(url, function(body){ ok(body); }, function(reason){
            // On failure, fall through the proxy list (unless disabled).""",
"""        rawGet(url, function(body){ ok(body); }, function(reason){
            // In the Android app, retry through the native downloader (no browser rules) and report the REAL reason.
            if(window.__nativeFetch && window.__nativeFetch(url,function(st,detail,path){
                if(st==='ok'&&path){ rawGet(path,function(body){ ok(body); },function(){ err(window.__netErrText('read')); }); }
                else err(window.__netErrText(detail||reason)); })) return;
            // On failure, fall through the proxy list (unless disabled).""", 'nativefetch')
_rep("err('Could not load — the host blocks browser requests and no proxy succeeded. This works directly on the TV.');", "err(window.__netErrText(reason));", 'errtext')

for _v in ['live','evs','soon','teamEvents','byPref']:
    s=s.replace('carousel(%s.map(eventCard))'%_v,'__evList(%s)'%_v)
# ================= Remove the My TV tab (duplicated Home), blur the provider on License =================
import re as _re2
_mt=_re2.search(r'[ \t]*<button class="nav-item"\s+data-view="mytv"[^\n]*?</button>\n?', s)
assert _mt, 'mytv nav'
s=s[:_mt.start()]+s[_mt.end():]
_rep("    function goTo(name){", "    function goTo(name){ if(name==='mytv') name='home';", 'gotomytv')
_rep("(srcDetail?licRow('Provider', srcDetail):'')+",
     "(srcDetail?((cfg.mode==='m3u'||cfg.mode==='xtream'||isEmbyMode(cfg.mode))?'<div class=\"lic-row\"><span class=\"k\">Provider</span><span class=\"v lic-secret\" onclick=\"this.classList.toggle(\\'show\\')\" title=\"Tap to show or hide\">'+esc(srcDetail)+'</span></div>':licRow('Provider', srcDetail)):'')+", 'licblur')

if 'alngumba@gmail.com</div>' in s: _rep('<div class="abs-email">alngumba@gmail.com</div>', '<div class="abs-email">info@byoplayer.com</div>', 'supportemail')
# ================= Category Selector bottom sheet =================
_rep("var btn=$('live-genre-btn'); if(btn) btn.classList.toggle('hidden', hasChoice);", "var btn=$('live-genre-btn'); if(btn) btn.classList.toggle('hidden', hasChoice); try{ __liveCatButton(); }catch(_e){} try{ __liveSideList(); }catch(_e){}", 'livecatbtn')
_rep("btn.addEventListener('click',function(){ openCatPicker(kind); });", "btn.addEventListener('click',function(){ if(__useSheet()) openVodCatSheet(kind); else openCatPicker(kind); });", 'vodsheet')
_rep("$('live-genre-btn').addEventListener('click',function(){ openLiveGenrePicker(); });", "$('live-genre-btn').addEventListener('click',function(){ if(__useSheet()) openLiveCatSheet(); else openLiveGenrePicker(); });", 'livesheet')
_rep("            if(reminderShowing()){ hideReminderPopup(); return; }", "            if(reminderShowing()){ hideReminderPopup(); return; }\n            if(__sheetOpen()){ __sheetClose(); return; }", 'sheetback')
# ================= Home hero: working dots (tap / swipe / auto-rotate), icon buttons on phones =================
_rep("acts.appendChild(play); acts.appendChild(info);\n", """acts.appendChild(play); acts.appendChild(info); play.setAttribute('aria-label','Play'); info.setAttribute('aria-label','More info');
        try{ var _set=[feat]; var _pool=top.filter(function(m){ return m!==feat; }); while(_set.length<4&&_pool.length){ _set.push(_pool.splice(Math.floor(Math.random()*_pool.length),1)[0]); }
            var _cur=0, _dots=hero.querySelector('.hero-dots'); _dots.removeAttribute('aria-hidden');
            _dots.innerHTML=_set.map(function(m,i){ return '<i class="'+(i?'':'on')+'" role="button" aria-label="Featured '+(i+1)+'"></i>'; }).join('');
            if(_set.length<2) _dots.style.display='none';
            var _show=function(i){ _cur=(i+_set.length)%_set.length; feat=_set[_cur]; S._lastHeroId=feat.id;
                hero.querySelector('.hero-title').textContent=feat.title;
                hero.querySelector('.hero-meta').innerHTML=(feat.year?'<span>'+esc(feat.year)+'</span>':'')+(feat.genre?'<span class="hm-sep">·</span><span>'+esc(feat.genre)+'</span>':'');
                hero.classList.remove('has-art','art-poster'); hero.style.background=g(feat.gi);
                var _hi=feat.backdrop||feat.logo; if(_hi){ hero.classList.add('has-art'); hero.style.background='#05070d url("'+_hi.replace(/"/g,'%22')+'") center '+(feat.backdrop?'30%':'22%')+'/cover no-repeat'; if(!feat.backdrop) hero.classList.add('art-poster'); }
                [].forEach.call(_dots.children,function(d,k){ d.classList.toggle('on',k===_cur); });
                try{ stopHeroPreview(); }catch(_e){} S._heroUrl=feat.url; if(heroPreviewAllowed()){ try{ startHeroPreview(feat.url); }catch(_e){} } };
            [].forEach.call(_dots.children,function(d,k){ d.addEventListener('click',function(ev){ ev.stopPropagation(); _show(k); _kick(); }); });
            var _tx=null,_ty=0; hero.addEventListener('touchstart',function(ev){ var t=ev.touches[0]; _tx=t.clientX; _ty=t.clientY; },{passive:true});
            hero.addEventListener('touchend',function(ev){ if(_tx===null) return; var t=ev.changedTouches[0]; var dx=t.clientX-_tx, dy=t.clientY-_ty; _tx=null;
                if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.4){ _show(_cur+(dx<0?1:-1)); _kick(); } },{passive:true});
            var _timer=null, _kick=function(){ clearInterval(_timer); _timer=setInterval(function(){ if(!document.body.contains(hero)){ clearInterval(_timer); return; }
                var hv=document.getElementById('view-home'); if(!hv||!hv.classList.contains('active-view')||document.hidden) return;
                if(hero.contains(document.activeElement)&&!(window.matchMedia&&matchMedia('(pointer:coarse)').matches)) return; _show(_cur+1); },9000); };
            if(_set.length>1) _kick();
        }catch(_e){}
""", 'herodots')
_rep("        body.appendChild(hero);\n", "        body.appendChild(hero); try{ var _rb=__reminderBox(); if(_rb) body.appendChild(_rb); }catch(_e){}\n", 'remboxafterhero')
_rep("},function(err){ if(tok!==_connectToken) return; hideConnectModal(); setStatus(err,'err'); }); return; }", "},function(err){ if(tok!==_connectToken) return; if(/get\\.php/i.test(url) && window.__m3uRetried!==url && /\\(400\\)|400 Bad/.test(err)){ var alt=url.replace(/([?&]type=)[^&]*/i,'$1m3u_plus'); if(!/[?&]type=/i.test(alt)) alt+='&type=m3u_plus'; if(!/[?&]output=/i.test(alt)) alt+='&output=ts'; if(alt!==url){ window.__m3uRetried=alt; $('m-url').value=alt; setTimeout(connect,60); return; } } hideConnectModal(); setStatus(err+'  Link used: '+window.__maskUrl(url),'err'); }); return; }", 'm3uerrlink')
_rep("    function paintWhatsOn(){ var body=$('won-body');", "    function paintWhatsOn(){ _paintWhatsOn(); try{ __wonCompact(); }catch(_e){} }\n    function _paintWhatsOn(){ var body=$('won-body');", 'woncompact')
# ================= Billing: 3-day trial, house playlist, payment wall =================
_BL=open('billing.js',encoding='utf-8').read()
_rep("    function goTo(name){ if(name==='mytv') name='home';", _BL+"\n    function goTo(name){ if(name==='mytv') name='home';", 'billingmod')
_rep("if(!Pay.allow(name)) return;", "if(!Billing.allow(name)) return;", 'billallow')
_rep("var payBanner=Pay.homeBanner();", "var payBanner=Billing.homeBanner();", 'billbanner')
_rep("        Pay.refresh();   // learn this device's subscription state so the ET paywall gates correctly", "        Billing.boot();   // trial clock, house playlist, payment wall (ET telebirr state is refreshed inside)", 'billboot')
_rep("function playContent(url,title,sub,opts){ opts=opts||{};", "function playContent(url,title,sub,opts){ opts=opts||{}; if(!Billing.canPlay()) return;", 'billplay')
_rep("        } else { // method: set up with phone / remote (spec §55)", "        } else if(!window.__wzOwn){ Billing.renderTrialStep(grid, contBtn, backBtn, stepBadge, eyebrow, rhead, foot); } else { // method: set up with phone / remote (spec §55)", 'billwelcome')
_rep("else if(_welcomeStep==='method'){ _welcomeStep='region'; renderWelcome(); } }", "else if(_welcomeStep==='method'){ if(window.__wzOwn){ window.__wzOwn=false; renderWelcome(); } else { _welcomeStep='region'; renderWelcome(); } } }", 'billwback')
_rep("            if(Store.settings.firstRun){ openWelcome(); } else { openProfilePicker(true); }", "            if(Store.settings.firstRun){ openWelcome(); } else if(/resume/.test(location.hash||'')&&Store.profiles&&Store.profiles.some(function(p){ return p.id===Store.activeId; })){ applyProfileVisibility(); goTo('home'); } else if(Store.profiles&&Store.profiles.length>1){ openProfilePicker(true); } else { goTo('home'); }", 'billsplash')
_rep("function trialDaysLeft(){ var lic=ensureLicense(); var days=30-Math.floor((Date.now()-lic.started)/86400000); return Math.max(0,days); }", "function trialDaysLeft(){ try{ return Billing.subActive()?0:Billing.daysLeft(); }catch(e){ var lic=ensureLicense(); return Math.max(0,8-Math.floor((Date.now()-lic.started)/86400000)); } }", 'billdays')
_rep("(isTrial?'30-day free trial':'Activated')", "(isTrial?(BILLING_CONFIG.trialDays+'-day free trial'):'Activated')", 'billlictext')
_rep("var pct=Math.round((days/30)*100);", "var pct=Math.round((days/BILLING_CONFIG.trialDays)*100);", 'billpct')
_rep("            if(__sheetOpen()){ __sheetClose(); return; }", "            if(__sheetOpen()){ __sheetClose(); return; }\n            if(typeof Support!=='undefined'&&Support.back()) return;\n            if(Billing.isWallOpen()){ if(!Billing.locked()) Billing.closeWall(); return; }", 'billback')

_rep("var isTrial=lic.plan==='trial'; var expired=isTrial&&days<=0;", "var isTrial=lic.plan==='trial'&&!Billing.subActive(); var expired=isTrial&&days<=0;", 'billlicsub')
# ================= phone polish: native search field, single Sports row =================
_rep("function openFieldKeyboard(inputEl, opts){ opts=opts||{};", "function openFieldKeyboard(inputEl, opts){ opts=opts||{}; if(__useSheet()){ __nativeField(inputEl,opts); return; }", 'nativefield')
_rep("function renderSportsFilters(){ var w=$('sports-filters'); w.innerHTML='';", "function renderSportsFilters(){ try{ return __sportsUnified(); }catch(_e){} var w=$('sports-filters'); w.innerHTML='';", 'sportsunified')
_rep("if(mode==='light') stage.setAttribute('data-mode','light'); else stage.removeAttribute('data-mode');", "if(mode==='light') stage.setAttribute('data-mode','light'); else stage.removeAttribute('data-mode'); rootEl.classList.toggle('light', mode==='light');", 'lightclass')
_rep("    function renderKeyboard(){", "    function renderKeyboard(){ if(__useSheet()){ __nativeField({value:SEARCH.q},{label:tr('nav.search','Search'),placeholder:tr('search.placeholder','Search channels, movies, series'),onDone:function(v){ v=String(v||'').trim(); if(v) setSearchQuery(v); else clearSearch(); }}); return; }", 'searchnative')
_rep("document.addEventListener('keydown',function(e){ if(!$('view-search').classList.contains('active-view')) return;", "document.addEventListener('keydown',function(e){ if(!$('view-search').classList.contains('active-view')) return; var _ae=document.activeElement; if(_ae&&_ae.closest&&_ae.closest('#nf-sheet')) return;", 'searchkeysheet')
# ================= Multi-connection combined library =================
_MU=open('multi.js',encoding='utf-8').read()
_rep("    function renderPlaylists(){\n", _MU+"\n    function renderPlaylists(){ if(Multi.render()) return;\n", 'multimod')
# ================= Remote help (support code + commands) =================
_SU=open('support.js',encoding='utf-8').read()
_rep("    function renderPlaylists(){ if(Multi.render()) return;\n", _SU+"\n    function renderPlaylists(){ if(Multi.render()) return;\n", 'supportmod')
_rep("logo:attr(l,'tvg-logo'),url:''}", "logo:attr(l,'tvg-logo'),tvgId:attr(l,'tvg-id'),url:''}", 'multitvgid')
# (ProviderIds is now requested directly by the paged Emby loader in the source.)
_rep("    function ensureSeriesLoaded(s,cb){ if(s.seasons){ cb(); return; }", "    function ensureSeriesLoaded(s,cb){ return Multi.ensureSeries(s,cb,_ensureSeriesLoaded1); }\n    function _ensureSeriesLoaded1(s,cb){ if(s.seasons){ cb(); return; }", 'multiseries')
_rep("function playContent(url,title,sub,opts){ opts=opts||{}; if(!Billing.canPlay()) return;", "function playContent(url,title,sub,opts){ opts=opts||{}; if(!Billing.canPlay()) return; if(opts.embyId&&Multi.reg(opts.embyId)) S.emby=Multi.reg(opts.embyId);", 'multiplayroute')
_rep("        function add(u){ if(u&&u!==cur&&out.indexOf(u)<0&&out.length<4) out.push(u); }\n", "        function add(u){ if(u&&u!==cur&&out.indexOf(u)<0&&out.length<4) out.push(u); }\n        try{ Multi.altUrls(c).forEach(add); }catch(_e){}\n", 'multialts')
_rep("var realSource=Store.cfg&&(Store.cfg.mode==='m3u'||Store.cfg.mode==='xtream');", "var realSource=Store.cfg&&(Store.cfg.mode==='m3u'||Store.cfg.mode==='xtream'||Store.cfg.mode==='multi');", 'multireal')
_rep("var src=cfg.mode==='m3u'?'M3U playlist':", "var src=cfg.mode==='multi'?'All connections':cfg.mode==='m3u'?'M3U playlist':", 'multilic')
_rep("        Store.cfg={}; Store.save();\n        clearLibrary();", "        Store.cfg={}; if(Store.settings) Store.settings.combineSources=false; Store.save();\n        clearLibrary();", 'multidisc')
_rep("                renderAll(); hideConnectModal();\n                goTo('home');", "                renderAll(); hideConnectModal();\n                if(!Multi.afterConnect()) goTo('home');", 'multiafter1')
assert s.count("renderAll(); hideConnectModal(); goTo('home'); } }")==2, 'multiafter2'
s=s.replace("renderAll(); hideConnectModal(); goTo('home'); } }", "renderAll(); hideConnectModal(); if(!Multi.afterConnect()) goTo('home'); } }")
_rep("                    applyPairedPayload({ iptv:cfg });", "                    if(cfg.combine===true){ Store.settings.combineSources=true; Store.save(); } else if(cfg.combine===false){ Store.settings.combineSources=false; Store.save(); }\n                    try{ goTo('home'); }catch(_e){} Multi.addFromPhone(cfg);", 'multiphone')
_rep("restoreConfig(); L18N.init();", "restoreConfig(); setTimeout(function(){ try{ Multi.boot(); }catch(_e){} },250); L18N.init();", 'multiboot')
_rep("    function finalizePairing(payload){\n        stopPairingWatch(); PAIR.state='done';", "    function finalizePairing(payload){\n        stopPairingWatch(); PAIR.state='done'; setTimeout(function(){ try{ Multi.publish(); }catch(_e){} },1500);", 'multipairpub')
_rep("restoreConfig(); setTimeout(function(){ try{ Multi.boot(); }catch(_e){} },250);", "restoreConfig(); setTimeout(function(){ try{ Multi.boot(); }catch(_e){} },250); setTimeout(function(){ try{ Multi.renderActive(); Multi.publish(); }catch(_e){} },2500);", 'multibootpub')
_rep(r"""        setHeroBackdrop({gi:(c.order||0)});
        var dp=$('detail-poster'); dp.style.backgroundImage='none'; dp.style.background=g((c.order||0));
        if(c.logo){ dp.innerHTML='<img src="'+esc(c.logo)+'" style="width:100%;height:100%;object-fit:contain;padding:14px;box-sizing:border-box" onerror="this.parentNode.innerHTML=\''+icon('i-live').replace(/'/g,"\\'")+'\'"/>'; }
        else { dp.innerHTML=icon('i-live'); }""", r"""        setHeroBackdrop(null); var dhbg=$('detail-hero-bg'); if(dhbg) dhbg.style.background='linear-gradient(180deg,#141a26 0%,#0d121b 100%)';
        var dp=$('detail-poster'); dp.style.backgroundImage='none'; dp.style.background='#0f141d'; dp.classList.add('live-poster');
        dp.innerHTML=icon('i-live');
        if(c.logo){ var _li=new Image(); _li.className='lp-logo'; _li.alt=''; _li.onerror=function(){ if(_li.parentNode) _li.parentNode.removeChild(_li); var _ic=dp.querySelector('.ic'); if(_ic) _ic.style.display=''; };
            _li.onload=function(){ var _ic=dp.querySelector('.ic'); if(_ic) _ic.style.display='none'; }; _li.src=c.logo; dp.appendChild(_li); }""", 'livedetailposter')
_rep("    function paintDetailArt(x){\n        var pos=$('detail-poster');", "    function paintDetailArt(x){\n        var pos=$('detail-poster'); pos.classList.remove('live-poster');", 'livepostercls')
# ================= Smart paste =================
_SP=open('smartpaste.js',encoding='utf-8').read()
_rep("\n    function renderPlaylists(){ if(Multi.render()) return;\n", "\n"+_SP+"\n    function renderPlaylists(){ if(Multi.render()) return;\n", 'smartpastemod')
_rep(" if(!/^https?:\/\//i.test(url)){ setStatus('Enter a valid M3U URL (http/https).','err'); return; }", " if(/^pasted:\/\//.test($('m-url').value.trim())) url=$('m-url').value.trim(); else { url=window.__directLink(url); $('m-url').value=url; } if(!/^(https?|pasted):\/\//i.test(url)){ setStatus('Enter a valid M3U URL (http/https).','err'); return; } if(/^https?:/i.test(url)&&S.__spOk!==url){ var _spu=url; setStatus('Checking the link…','info'); return SmartPaste.maybeUpgrade(_spu,function(){ S.__spOk=_spu; connect(); }); } S.__spOk=null;", 'smartm3u')
_rep("restoreConfig(); setTimeout(function(){ try{ Multi.boot(); }catch(_e){} },250);", "restoreConfig(); try{ SmartPaste.ui(); }catch(_e){} setTimeout(function(){ try{ Multi.boot(); }catch(_e){} },250);", 'smartpasteui')
# ================= Extra stream settings (headers) from playlists =================
_SO=open('streamopts.js',encoding='utf-8').read()
s=s.replace(force_tv, force_tv+'<script id="rp-streamopts">\n'+_SO+'\n</script>', 1)
_rep("""    function parseM3U(t){ var lines=t.split(/\\r?\\n/),out=[],p=null;
        for(var i=0;i<lines.length;i++){ var l=lines[i].trim(); if(!l) continue;
            if(l.indexOf('#EXTINF')===0){ p={name:nm(l)||attr(l,'tvg-name')||'Unnamed',genre:attr(l,'group-title')||'Ungrouped',logo:attr(l,'tvg-logo'),tvgId:attr(l,'tvg-id'),url:''}; }
            else if(l.charAt(0)==='#'){ continue; } else { if(p){ p.url=l; out.push(p); p=null; } else out.push({name:l,genre:'Ungrouped',logo:'',url:l}); } }
        return out; }""", """    function parseM3U(t){ var lines=t.split(/\\r?\\n/),out=[],p=null,pend=null,SO=window.__byoStreamOpts;
        for(var i=0;i<lines.length;i++){ var l=lines[i].trim(); if(!l) continue;
            if(l.indexOf('#EXTINF')===0){ p={name:nm(l)||attr(l,'tvg-name')||'Unnamed',genre:attr(l,'group-title')||'Ungrouped',logo:attr(l,'tvg-logo'),tvgId:attr(l,'tvg-id'),url:''}; p._o=pend||{}; pend=null; if(SO) SO.extinf(l,p._o); }
            else if(l.charAt(0)==='#'){ if(SO&&!/^#EXTM3U/i.test(l)){ if(p) SO.line(l,p._o); else SO.line(l,(pend=pend||{})); } continue; }
            else { var o=p?p._o:(pend||{}); var u=SO?SO.url(l,o):l; if(SO) SO.reg(u,o); if(o.drm&&p) p.drm=o.drm;
                if(p){ p.url=u; delete p._o; out.push(p); p=null; } else { out.push({name:u,genre:'Ungrouped',logo:'',url:u}); pend=null; } } }
        return out; }""", 'streamoptsparse')
# ================= MAG / Stalker portals =================
_ST=open('stalker.js',encoding='utf-8').read()
_rep("\n    var SmartPaste=(function(){", "\n"+_ST+"\n    var SmartPaste=(function(){", 'stalkermod')
_rep('<button class="seg-btn"        id="seg-jellyfin" data-focusable="true" tabindex="0">Jellyfin</button>', '<button class="seg-btn"        id="seg-jellyfin" data-focusable="true" tabindex="0">Jellyfin</button>\n                                <button class="seg-btn"        id="seg-stalker" data-focusable="true" tabindex="0">MAG portal</button>', 'stalkerseg')
_rep("""                            <div class="settings-actions">
                                <button class="s-btn primary" id="btn-connect" data-focusable""", """                            <div id="form-stalker" class="form-grid hidden">
                                <div class="f-field span2"><label for="k-portal">Portal link</label><input id="k-portal" type="text" placeholder="http://portal.example.com/c/" data-focusable="true" tabindex="0" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"/></div>
                                <div class="f-field span2"><label for="k-mac">MAC address</label><input id="k-mac" type="text" placeholder="00:1A:79:12:34:56" data-focusable="true" tabindex="0" autocomplete="off" autocapitalize="characters" spellcheck="false"/></div>
                                <p class="sec-sub span2" style="margin:4px 0 0">Use the portal link and the MAC address your provider activated for you. Live channels are loaded; each channel's link is fetched from the portal when you play it.</p>
                            </div>
                            <div class="settings-actions">
                                <button class="s-btn primary" id="btn-connect" data-focusable""", 'stalkerform')
_rep("var el=$('e-server-label'); if(el) el.textContent=(mode==='jellyfin')?'Jellyfin':'Emby'; }", "var el=$('e-server-label'); if(el) el.textContent=(mode==='jellyfin')?'Jellyfin':'Emby'; var sk=$('seg-stalker'); if(sk) sk.classList.toggle('seg-on',mode==='stalker'); var fk=$('form-stalker'); if(fk) fk.classList.toggle('hidden',mode!=='stalker'); }", 'stalkersetmode')
_rep("        var sgj=$('seg-jellyfin'); if(sgj) sgj.addEventListener('click',function(){ setMode('jellyfin'); });", "        var sgj=$('seg-jellyfin'); if(sgj) sgj.addEventListener('click',function(){ setMode('jellyfin'); });\n        var sgk=$('seg-stalker'); if(sgk) sgk.addEventListener('click',function(){ setMode('stalker'); });", 'stalkerwire')
_rep("        if(S.mode==='emby'||S.mode==='jellyfin'){ return connectEmby(S.mode); }", "        if(S.mode==='emby'||S.mode==='jellyfin'){ return connectEmby(S.mode); }\n        if(S.mode==='stalker'){ return Multi.connectPortal(); }", 'stalkerconnect')
_rep("        else setMode('xtream'); }\n", "        else if(c.mode==='stalker'){ setMode('stalker'); $('k-portal').value=c.server||''; $('k-mac').value=c.user||''; }\n        else setMode('xtream'); }\n", 'stalkerrestore')
_rep("        else if(isEmbyMode(pl.mode)){ setMode(pl.mode); var es=$('e-server');", "        else if(pl.mode==='stalker'){ setMode('stalker'); $('k-portal').value=pl.server||''; $('k-mac').value=pl.user||''; }\n        else if(isEmbyMode(pl.mode)){ setMode(pl.mode); var es=$('e-server');", 'stalkeractivate')
_rep("if(opts.embyId&&Multi.reg(opts.embyId)) S.emby=Multi.reg(opts.embyId);", "if(opts.embyId&&Multi.reg(opts.embyId)) S.emby=Multi.reg(opts.embyId); if(Stalker.isStalker(url)){ var _so={}; for(var _k in opts) _so[_k]=opts[_k]; try{ setToast('Getting the channel from your portal…'); }catch(_e){} Stalker.resolve(url,function(_e2,_real){ if(_e2){ try{ setToast(_e2); }catch(_e){} return; } playContent(_real,title,sub,_so); }); return; }", 'stalkerplay')
_rep("        function add(u){ if(u&&u!==cur&&out.indexOf(u)<0&&out.length<4) out.push(u); }\n", "        function add(u){ if(u&&u!==cur&&!/^stalker:/.test(u)&&out.indexOf(u)<0&&out.length<4) out.push(u); }\n", 'stalkeralts')
# ================= Plex =================
_PX=open('plex.js',encoding='utf-8').read()
_rep("\n    var SmartPaste=(function(){", "\n"+_PX+"\n    var SmartPaste=(function(){", 'plexmod')
_rep('<button class="seg-btn"        id="seg-stalker" data-focusable="true" tabindex="0">MAG portal</button>', '<button class="seg-btn"        id="seg-stalker" data-focusable="true" tabindex="0">MAG portal</button>\n                                <button class="seg-btn"        id="seg-plex" data-focusable="true" tabindex="0">Plex</button>', 'plexseg')
_rep('                            <div id="form-stalker" class="form-grid hidden">', """                            <div id="form-plex" class="hidden">
                                <p class="sec-sub" style="margin:0 0 14px">Sign in with your Plex account. Movies and TV shows from all your Plex servers are added, including servers friends share with you.</p>
                                <div id="plex-box" class="plex-box"><div class="px-k" id="plex-signed"></div></div>
                            </div>
                            <div id="form-stalker" class="form-grid hidden">""", 'plexform')
_rep("var fk=$('form-stalker'); if(fk) fk.classList.toggle('hidden',mode!=='stalker'); }", "var fk=$('form-stalker'); if(fk) fk.classList.toggle('hidden',mode!=='stalker'); var sp2=$('seg-plex'); if(sp2) sp2.classList.toggle('seg-on',mode==='plex'); var fp=$('form-plex'); if(fp) fp.classList.toggle('hidden',mode!=='plex'); var bc=$('btn-connect'); if(bc){ var lb=bc.lastChild; if(lb&&lb.nodeType===3) lb.nodeValue=(mode==='plex')?'Sign in with Plex':'Connect & Load'; } }", 'plexsetmode')
_rep("        var sgk=$('seg-stalker'); if(sgk) sgk.addEventListener('click',function(){ setMode('stalker'); });", "        var sgk=$('seg-stalker'); if(sgk) sgk.addEventListener('click',function(){ setMode('stalker'); });\n        var sgp=$('seg-plex'); if(sgp) sgp.addEventListener('click',function(){ setMode('plex'); });", 'plexwire')
_rep("        if(S.mode==='stalker'){ return Multi.connectPortal(); }", "        if(S.mode==='stalker'){ return Multi.connectPortal(); }\n        if(S.mode==='plex'){ return Multi.plexSignIn(); }", 'plexconnect')
_rep("        else if(c.mode==='stalker'){ setMode('stalker');", "        else if(c.mode==='plex'){ setMode('plex'); var ps=$('plex-signed'); if(ps) ps.textContent='Signed in as '+(c.user||'your Plex account')+'. Press Sign in with Plex to use a different account.'; }\n        else if(c.mode==='stalker'){ setMode('stalker');", 'plexrestore')
_rep("        else if(pl.mode==='stalker'){ setMode('stalker');", "        else if(pl.mode==='plex'){ setMode('plex'); var ps=$('plex-signed'); if(ps) ps.textContent='Saved: '+(pl.user||'Plex account')+'. Press Sign in with Plex to sign in again.'; }\n        else if(pl.mode==='stalker'){ setMode('stalker');", 'plexactivate')
# ================= Protected (DRM) channels =================
_rep("""                '<div class="lc-name">'+esc(info.name)+'</div>'+""", """                '<div class="lc-name">'+(function(){ var _d=c.drm?StreamOpts.info(c.drm):StreamOpts.drmInfo(c.url); if(!_d) return ''; return '<span class="lc-drm '+(StreamOpts.playable(_d)?'ck':'no')+'" title="'+(StreamOpts.playable(_d)?'Protected (ClearKey)':'Protected, cannot play')+'">'+(StreamOpts.playable(_d)?'KEY':'DRM')+'</span>'; })()+esc(info.name)+'</div>'+""", 'drmbadge')
_rep("if(opts.embyId&&Multi.reg(opts.embyId)) S.emby=Multi.reg(opts.embyId);", """if(opts.embyId&&Multi.reg(opts.embyId)) S.emby=Multi.reg(opts.embyId);
        var _drm=StreamOpts.drmInfo(url);
        if(_drm&&!StreamOpts.playable(_drm)){ try{ setToast((_drm.type==='widevine'?'Widevine':(_drm.type==='playready'?'PlayReady':'DRM'))+'-protected channel. BYO Player cannot play protected streams like this one.'); }catch(_e){} return; }
        if(_drm&&!(window.ByoAndroid&&ByoAndroid.playNativeAll)){ try{ setToast('This protected channel plays in the Android app only.'); }catch(_e){} return; }""", 'drmgate')
# ================= Welcome: keep the focused option in view on TVs =================
_rep("restoreConfig(); try{ SmartPaste.ui(); }catch(_e){}", "restoreConfig(); try{ SmartPaste.ui(); }catch(_e){} try{ document.getElementById('welcome').addEventListener('focusin',function(e){ var t=e.target; if(t&&t.scrollIntoView) setTimeout(function(){ try{ t.scrollIntoView({block:'nearest'}); }catch(_e){} },0); }); }catch(_e){}", 'welcomefocus')
# ================= Device info (TV flag, version label) =================
_TZDEV = ("\n try{ if(!(window.ByoAndroid&&ByoAndroid.deviceInfo)){ var v=''; try{ if(window.tizen&&tizen.application) v=tizen.application.getCurrentApplication().appInfo.version; }catch(_z){} window.__byoDevice={tv:true,version:v||'%s',w:(window.screen&&screen.width)||1920,h:(window.screen&&screen.height)||1080}; document.documentElement.classList.add('is-tv'); } }catch(e){}" % VERSION_STR) if TIZEN else ""
_DEV="""<script id="rp-device">(function(){ try{ if(window.ByoAndroid&&ByoAndroid.deviceInfo){ var d=JSON.parse(ByoAndroid.deviceInfo()||'{}'); window.__byoDevice=d; if(d.tv) document.documentElement.classList.add('is-tv'); } }catch(e){}"""+_TZDEV+"""
 function label(){ try{ var d=window.__byoDevice||{}; var txt=(d.version?'v'+d.version+' · ':'')+window.innerWidth+'×'+window.innerHeight;
   [].forEach.call(document.querySelectorAll('#welcome .wz-step, #splash'),function(st){ var sp=st.querySelector('.wz-ver'); if(!sp){ sp=document.createElement('span'); sp.className='wz-ver'; if(st.id==='splash'){ sp.style.cssText='position:absolute;right:16px;bottom:12px;font-size:12px;opacity:.5;color:#9aa6b6'; } st.appendChild(sp); } sp.textContent=txt; }); }catch(e){} }
 /* Landscape screens (TVs): keep the setup wizard's Continue button in the page flow, never floating over the options.
    Done in script as well as CSS so it also works on TVs with an older built-in browser. */
 function tvFix(){ try{ if(window.innerWidth<=window.innerHeight) return; var w=document.getElementById('welcome'); if(!w) return; w.classList.add('tvfix'); var two=window.innerWidth>=1200; w.classList.toggle('tv2col',two);
   var a=w.querySelectorAll('.wz-actions'); for(var i=0;i<a.length;i++){ a[i].style.setProperty('position','static','important'); a[i].style.setProperty('background','none','important'); a[i].style.setProperty('margin-top','14px','important'); }
   var short=window.innerHeight<=820;
   var g=w.querySelectorAll('.welcome-grid, .region-grid'); for(var j=0;j<g.length;j++){ var c=g[j].className||''; if(/one-col|bl-add/.test(c)) continue; if(short||two||/region/.test(c)) g[j].style.setProperty('grid-template-columns','repeat('+(two?3:4)+',minmax(0,1fr))','important'); if(short) g[j].style.setProperty('gap','10px','important'); }
   var t0=w.querySelectorAll('.wz-title'); for(var k0=0;k0<t0.length;k0++){ t0[k0].style.setProperty('font-size',Math.max(20,Math.min(60,Math.round(window.innerHeight*0.055)))+'px','important'); t0[k0].style.setProperty('line-height','1.06','important'); }
   if(short){ var t=w.querySelectorAll('.wz-title'); for(var k=0;k<t.length;k++){ t[k].style.setProperty('font-size',Math.max(20,Math.min(40,Math.round(window.innerHeight*0.06)))+'px','important'); t[k].style.setProperty('line-height','1.06','important'); t[k].style.setProperty('margin','2px 0 4px','important'); }
     var o=w.querySelectorAll('.welcome-opt'); for(var m=0;m<o.length;m++){ o[m].style.setProperty('min-height','0','important'); o[m].style.setProperty('padding-top','8px','important'); o[m].style.setProperty('padding-bottom','8px','important'); } }
 }catch(e){} }
 function tbh(){ try{ var t=document.querySelector('.topbar'); if(t&&t.offsetHeight) document.documentElement.style.setProperty('--tbh',t.offsetHeight+'px'); }catch(e){} }
 function fullScreens(){ try{ var R=document.documentElement; var was=R.classList.contains('no-topbar'); if(was) R.classList.remove('no-topbar');
   var el=document.elementFromPoint(Math.round(innerWidth/2), Math.round(innerHeight*0.55)); var on=!!(el&&el.closest&&el.closest('#welcome,#splash,#profile-picker,#pairing'));
   R.classList.toggle('no-topbar',on); }catch(e){} }
 if(window.MutationObserver) document.addEventListener('DOMContentLoaded',function(){ var mo=new MutationObserver(fullScreens); ['welcome','splash','profile-picker','pairing'].forEach(function(id){ var e=document.getElementById(id); if(e) mo.observe(e,{attributes:true,attributeFilter:['class','style']}); }); fullScreens(); });
 function tick(){ label(); tvFix(); tbh(); fullScreens(); }
 if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){ setTimeout(tick,300); }); else setTimeout(tick,300);
 setInterval(tick,800); window.addEventListener('resize',tick); })();</script>"""
s=s.replace(force_tv, force_tv+_DEV, 1)
# ================= Version label next to the logo on the setup screens (static, always visible) =================
import re as _re4
_VER=_re4.search(r'versionName "([^"]+)"', open('byo-android-tv/app/build.gradle').read()).group(1)
_n=s.count('BYO <span>Player</span></div>')
assert _n>=1, 'brandver'
s=s.replace('BYO <span>Player</span></div>', 'BYO <span>Player</span><span class="wz-ver-static">v'+_VER+'</span></div>')
s=s.replace('id="pp-build">v95<', 'id="pp-build">v'+_VER+'<')
# (About version is now read live from __byoDevice.version in renderAbout, so no build-time patch.)
# ================= Xtream: real category names instead of "Cat 162" =================
_rep("seriesList:api+'&action=get_series',", "seriesList:api+'&action=get_series', cats:function(a){ return api+'&action='+a; },", 'xtcatsapi')
_rep("renderSeriesGenres(); renderSeries(); done('series'); },function(){ done('series'); }); }", "renderSeriesGenres(); renderSeries(); done('series'); },function(){ done('series'); });\n        try{ if(window.__byoXtreamCats) window.__byoXtreamCats(api, function(n){ if(n&&xtok===_connectToken){ try{ renderLiveGenres(); renderLive(); renderMoviesGenres(); renderMovies(); renderSeriesGenres(); renderSeries(); }catch(_e){} } }); }catch(_e){} }", 'xtcatssingle')
# ================= Sports > Live: never a blank page =================
_rep("if(!live.length){ body.appendChild(emptyState('nolive')); return; }", "if(!live.length){ var _nl=document.createElement('div'); _nl.className='sports-live-note'; _nl.innerHTML='<span class=\"live-pip\"></span><div><b>No matches are live right now.</b> Your sports channels are below, and matches show here as soon as they start.</div>'; body.appendChild(_nl);\n                var _sc=sportsChannelsList(); if(_sc.length){ var _r=rowEl(icon('i-live'),'Sports channels ('+_sc.length+')'); var _g=document.createElement('div'); _g.className='spchan-grid'; _sc.slice(0,300).forEach(function(c){ _g.appendChild(spChanCard(c)); }); _r.appendChild(_g); body.appendChild(_r); } else body.appendChild(emptyState('nolive')); return; }", 'sportslivefallback')
# ================= Remote Back: go to the previous screen =================
_rep("    function goTo(name){ if(name==='mytv') name='home';", """    // Screen history for the remote's Back key. Every screen change is recorded (menus, film and
    // channel pages, match pages, search), so Back always returns to the screen you came from.
    var __navHist=[], __navBacking=false, __shownDetail=null, __shownSport=null;
    function __activeTop(){ var v=document.querySelector('.view.active-view'); return v?v.id.replace(/^view-/,''):null; }
    function __snap(cur){ return { v:cur, el:Nav.current, d:(cur==='detail'?__shownDetail:null), e:(cur==='sportdetail'?__shownSport:null) }; }
    function __same(a,b){ return a&&b&&a.v===b.v&&(a.v!=='detail'||(a.d&&b.d&&a.d.data===b.d.data))&&(a.v!=='sportdetail'||a.e===b.e); }
    function __navRecord(name){ if(__navBacking) return; var cur=__activeTop(); if(!cur||/^(player|mvplay|multiview)$/.test(cur)) return;
        if(/^(player|mvplay|multiview)$/.test(name)) return;
        if(cur===name&&cur!=='detail'&&cur!=='sportdetail') return;
        var sn=__snap(cur); var last=__navHist[__navHist.length-1]; if(__same(last,sn)){ last.el=sn.el; return; }
        __navHist.push(sn); if(__navHist.length>40) __navHist.shift(); }
    function __navPush(name){}
    function __navBack(){ var curS=__snap(__activeTop());
        while(__navHist.length){ var h=__navHist.pop(); if(__same(h,curS)) continue; __navBacking=true;
            try{ if(h.v==='detail'&&h.d&&h.d.data){ var t=h.d.type; if(t==='movie') openMovie(h.d.data); else if(t==='series') openSeries(h.d.data); else if(t==='live') openLive(h.d.data); else showView('detail'); }
                 else if(h.v==='sportdetail'&&h.e) openSportEvent(h.e);
                 else if(h.v==='search') openSearch(SEARCH.from);
                 else goTo(h.v); }catch(_e){ try{ goTo('home'); }catch(_x){} }
            finally{ __navBacking=false; }
            var el=h.el; if(el) setTimeout(function(){ if(document.body.contains(el)&&el.offsetParent){ Nav.setFocus(el); try{ el.scrollIntoView({block:'nearest',inline:'nearest'}); }catch(e){} } },120); return true; }
        return false; }
    window.__navBack=__navBack;
    function goTo(name){ if(name==='mytv') name='home';""", 'navhist1')
_rep("    function showView(name){ if(name!=='home') stopHeroPreview();", "    function showView(name){ try{ __navRecord(name); }catch(_e){} if(name==='detail') __shownDetail=S.currentDetail; if(name==='sportdetail') __shownSport=S.currentSportEvent; if(name!=='home') stopHeroPreview();", 'navhistshow')
_rep("            if($('view-detail').classList.contains('active-view')){ if(S.prevView==='home') renderHome(); goTo(S.prevView); return; }", "            if($('view-detail').classList.contains('active-view')){ if(__navBack()) return; if(S.prevView==='home') renderHome(); goTo(S.prevView); return; }", 'navhistdetail')
_rep("            if($('view-sportdetail').classList.contains('active-view')){ goTo('sports'); return; }", "            if($('view-sportdetail').classList.contains('active-view')){ if(__navBack()) return; goTo('sports'); return; }", 'navhistsport')
_rep("                e.preventDefault(); goTo(SEARCH.from||'home'); return; }", "                e.preventDefault(); if(__navBack()) return; goTo(SEARCH.from||'home'); return; }", 'navhistsearch')
_rep("        if(!Billing.allow(name)) return;\n        S.prevView=name;", "        if(!Billing.allow(name)) return;\n        try{ __navPush(name); }catch(_e){}\n        S.prevView=name;", "navhist2")
_rep("            if(!$('view-home').classList.contains('active-view')){ goTo('home'); return; }\n            showExit(); };",
     "            if(!$('view-home').classList.contains('active-view')){ if(__navBack()) return; goTo('home'); return; }\n            showExit(); };", 'navhist3')
_rep("        Nav.onBack=function(){ if(Pin.isOpen()){ Pin.cancel(); return; }",
     """        Nav.onBack=function(){ if(Pin.isOpen()){ Pin.cancel(); return; }
            try{ var _nf=$('nf-sheet'); if(_nf&&_nf.classList.contains('open')){ _nf.querySelector('.nf-cancel').click(); return; } }catch(_e){}
            try{ var _bw=$('billing-wall'); if(_bw&&!_bw.classList.contains('hidden')){ var _nn=[].filter.call(_bw.querySelectorAll('button,a,[data-focusable]'),function(b){ return /^(not now|close|cancel|back)$/i.test((b.textContent||'').trim()); })[0]; if(_nn){ _nn.click(); return; } } }catch(_e){}""", 'navhist4')
# ================= Multi-View removed from the app =================
_rep("    function mvAvailable(){ return MV.enoughStreams(); }", "    function mvAvailable(){ return false; }", 'nomv1')
_rep("    function openMultiView(preset){", "    function openMultiView(preset){ return; }\n    function __openMultiViewOld(preset){", 'nomv2')
# ================= Parental: block programmes by content (sex, nudity, violence ...) =================
_rep('<div class="chip-picker" id="pc-genres"></div>', """<div class="chip-picker" id="pc-genres"></div>
                                <p class="sec-sub" style="margin:22px 0 6px">Hide programmes, films and channels with:</p>
                                <p class="sec-sub" style="margin:0 0 14px;opacity:.75">Checked by title, category and description. Hidden everywhere, including search, until you turn it off with your PIN.</p>
                                <div class="chip-picker" id="pc-content"></div>""", 'pccontenthtml')
_rep("    function profFilter(list){ var out=list;", """    var PC_CONTENT=[
        ['sex','Sex & adult content',/(^|[^a-z])(xxx|porn\\w*|adults? only|adult (channel|tv|movies?|content|xxx)|18\\s?\\+|\\+\\s?18|erotic\\w*|sex|sexy|sexual\\w*|playboy|hustler|brazzers|penthouse|redlight|red light|hentai|nsfw|escort\\w*|onlyfans|milf|fetish\\w*|bdsm|swinger\\w*|strip ?tease|strip club)([^a-z]|$)/i],
        ['nudity','Nudity',/(^|[^a-z])(nud(e|es|ity|ist|ists)|naked|topless|lingerie|burlesque|skinny dip\\w*)([^a-z]|$)/i],
        ['violence','Violence & gore',/(^|[^a-z])(gore|gory|slasher|torture\\w*|massacre|chainsaw|splatter|brutal\\w*|bloodbath|violen(t|ce))([^a-z]|$)/i],
        ['horror','Horror',/(^|[^a-z])(horror|zombie\\w*|haunt(ed|ing)|exorcis\\w*|demonic|possessed|terror)([^a-z]|$)/i],
        ['drugs','Drugs',/(^|[^a-z])(drugs?|cocaine|heroin|narcos?|cartel|meth|stoner|weed|marijuana|cannabis)([^a-z]|$)/i],
        ['gambling','Gambling',/(^|[^a-z])(casino|gambl\\w*|betting|poker|slots?)([^a-z]|$)/i]
    ];
    function pcContentOn(){ var c=pcOn()&&Store.parental.content; if(!c) return null; var ks=Object.keys(c).filter(function(k){ return c[k]; }); return ks.length?ks:null; }
    function pcBlocked(x, ks, sig){ if(!x) return false; if(x._pcSig===sig) return x._pcB;
        var txt=((x.name||x.title||'')+' | '+(x.genre||'')+' | '+String(x.plot||x.desc||'').slice(0,600)).replace(/adult swim/ig,' ');
        var hit=false; for(var i=0;i<PC_CONTENT.length&&!hit;i++){ if(ks.indexOf(PC_CONTENT[i][0])>-1&&PC_CONTENT[i][2].test(txt)) hit=true; }
        x._pcSig=sig; x._pcB=hit; return hit; }
    function pcContentFilter(list){ var ks=pcContentOn(); if(!ks||!list) return list; var sig=ks.join(','); return list.filter(function(x){ return !pcBlocked(x,ks,sig); }); }
    window.__pcContentFilter=pcContentFilter;
    function profFilter(list){ var out=pcContentFilter(list);""", 'pccontentfilter')
_rep("    function profFilterSafe(list){ var out=list;", "    function profFilterSafe(list){ var out=pcContentFilter(list);", 'pccontentsafe')
_rep("""            chip.addEventListener('click',function(){ if(!p.genres) p.genres={}; if(p.genres[gen]) delete p.genres[gen]; else p.genres[gen]=1; Store.save(); renderParental(); renderAll(); }); wrap.appendChild(chip); });
    }""", """            chip.addEventListener('click',function(){ if(!p.genres) p.genres={}; if(p.genres[gen]) delete p.genres[gen]; else p.genres[gen]=1; Store.save(); renderParental(); renderAll(); }); wrap.appendChild(chip); });
        var cw=$('pc-content'); if(cw){ cw.innerHTML=''; PC_CONTENT.forEach(function(c){ var on=!!(p.content&&p.content[c[0]]); var chip=document.createElement('div'); chip.className='pick-chip'+(on?' picked':''); chip.setAttribute('data-focusable','true'); chip.tabIndex=0;
            chip.innerHTML=(on?icon('i-lock'):'')+esc(c[1]);
            chip.addEventListener('click',function(){ var self=this; function flip(){ if(!p.content) p.content={}; if(p.content[c[0]]) delete p.content[c[0]]; else p.content[c[0]]=1; Store.save(); try{ invalidateSports(); }catch(_e){} renderParental(); renderAll(); setTimeout(function(){ var again=[].filter.call($('pc-content').children,function(x){ return x.textContent.indexOf(c[1])>-1; })[0]; if(again) Nav.setFocus(again); },20); }
                if(on) Pin.verify(p.pin,'Enter PIN','Confirm to show this content again',flip,function(){ Nav.setFocus(self); }); else flip(); });
            cw.appendChild(chip); }); }
    }""", 'pccontentui')
# ================= M3U: channel names that contain commas =================
_rep("    function nm(l){ var i=l.lastIndexOf(','); return i>=0?l.slice(i+1).trim():''; }", "    function nm(l){ var q=false; for(var i=0;i<l.length;i++){ var ch=l.charAt(i); if(ch==='\"') q=!q; else if(ch===','&&!q) return l.slice(i+1).trim(); } var j=l.lastIndexOf(','); return j>=0?l.slice(j+1).trim():''; }", 'm3ucommaname')
_rep("        Swimming:{icon:'🏊',pat:/\\b(swimming|swim|aquatics|fina|diving|water polo)\\b/i},", "        Swimming:{icon:'🏊',pat:/\\b(swimming|(?<!adult )swim|aquatics|fina|diving|water polo)\\b/i},", 'adultswim')
# ================= Sports page: featured match + match cards =================
_rep("    function renderSportsHero(){", open('sportsui.js',encoding='utf-8').read()+"\n    function _renderSportsHeroOld(){", 'sportsui')
_rep("function eventCard(e){ var _c=_eventCardBase(e); try{ LiveScores.decorate(_c,e); }catch(_x){} return _c; }", "function eventCard(e){ return __sportCard(e); }", 'sportscard')
# ================= Featured today: real video preview =================
# prefer titles the TV's web player can actually decode (mp4 / m3u8 / webm), skip mkv/avi
_rep("var _art=pool.filter(function(m){ return m.backdrop||m.logo; }); if(_art.length>=3) pool=_art;",
     "var _art=pool.filter(function(m){ return m.backdrop||m.logo; }); var _pv=function(m){ return /\\.(mp4|m4v|m3u8|webm|mov)(\\?|$)/i.test(String(m.url||''))||/\\/transcode\\//.test(String(m.url||'')); }; var _ap=_art.filter(_pv), _pp=pool.filter(_pv); if(_ap.length>=3) pool=_ap; else if(_pp.length>=3) pool=_pp; else if(_art.length>=3) pool=_art;", 'heroplayable')
# only reveal the video once frames are really moving; start a little into long films; give up quietly after 12s
_rep("function onReady(){ if(started) return; started=true; var p=v.play(); if(p&&p.catch) p.catch(function(){ /* retry once muted */ try{ v.muted=true; v.play(); }catch(e){} }); v.classList.add('showing'); $('hero-livedot').classList.remove('hidden'); var hs=$('hero-sound'); if(hs) hs.classList.remove('hidden'); }",
     "function reveal(){ if(S._heroActiveUrl!==url) return; v.classList.add('showing'); $('hero-livedot').classList.remove('hidden'); var hs=$('hero-sound'); if(hs) hs.classList.remove('hidden'); }\n        var _t0=0; v.addEventListener('timeupdate',function _tu(){ if(S._heroActiveUrl!==url){ v.removeEventListener('timeupdate',_tu); return; } if(!_t0) _t0=v.currentTime; if(v.currentTime-_t0>0.3||(v.currentTime>0.3&&!v.paused)){ v.removeEventListener('timeupdate',_tu); reveal(); } });\n        v.addEventListener('loadedmetadata',function(){ try{ if(isFinite(v.duration)&&v.duration>1200&&v.currentTime<5) v.currentTime=Math.min(600,v.duration*0.15); }catch(e){} },{once:true});\n        setTimeout(function(){ if(S._heroActiveUrl===url&&!v.classList.contains('showing')){ try{ stopHeroPreview(); }catch(e){} } },12000);\n        function onReady(){ if(started) return; started=true; var p=v.play(); if(p&&p.catch) p.catch(function(){ /* retry once muted */ try{ v.muted=true; v.play(); }catch(e){} }); }", 'heroreveal')
# ================= "More like this": real genres + TMDB recommendations =================
_rep("    return { configure:configure, setEnabled:setEnabled,", """    var _recC={};
    function recs(k,id,cb){ if(!enabled()||!id){ cb([]); return; } var key=k+':'+id; if(_recC[key]){ cb(_recC[key]); return; }
        function map(res){ return (res&&res.results||[]).map(function(r){ return { id:r.id, title:(r.title||r.name||''), year:yearOf(r) }; }); }
        get('https://api.themoviedb.org/3/'+k+'/'+id+'/recommendations?api_key='+encodeURIComponent(KEY), function(res){ var a=map(res);
            if(a.length>=6){ _recC[key]=a; cb(a); return; }
            get('https://api.themoviedb.org/3/'+k+'/'+id+'/similar?api_key='+encodeURIComponent(KEY), function(r2){ var b=a.concat(map(r2)); _recC[key]=b; cb(b); }, function(){ _recC[key]=a; cb(a); }); },
          function(){ cb([]); }); }
    return { recs:recs, configure:configure, setEnabled:setEnabled,""", 'tmdbrecs')
_rep("if(meta.genre&&meta.genre!==item.tmdbGenre){ item.tmdbGenre=meta.genre; scheduleGenreRefresh(kind); } if(meta.rating) item.tmdbRating=meta.rating;",
     "if(meta.genre&&meta.genre!==item.tmdbGenre){ item.tmdbGenre=meta.genre; scheduleGenreRefresh(kind); } if(meta.rating) item.tmdbRating=meta.rating; if(meta.genres&&meta.genres.length) item.tmdbGenres=meta.genres; if(meta.id) item.tmdbId=meta.id;", 'tmdbgenres')
_rep("""    function similarityScore(ref, cand){
        if(!ref||!cand||ref.id===cand.id) return -1;
        var score=0;
        if(cand.genre&&ref.genre){ if(cand.genre===ref.genre) score+=50; else if(sharedGenreFamily(ref.genre,cand.genre)) score+=22; }""",
"""    // Real genres only (TMDB genres, or a provider category that is an actual genre). Provider
    // categories such as "Amazon Prime Video" or "VOD Movies (EN)" say where a title came from,
    // not what it is like, so they barely count.
    function itemGenres(x){ if(!x) return []; if(x.tmdbGenres&&x.tmdbGenres.length) return x.tmdbGenres; var out=[]; if(x.tmdbGenre) out.push(x.tmdbGenre);
        String(x.genre||'').split(/[\\/,|&]+/).forEach(function(g){ g=g.trim(); if(isRealGenre(g)&&out.indexOf(g)<0) out.push(g); }); return out; }
    function similarityScore(ref, cand){
        if(!ref||!cand||ref.id===cand.id) return -1;
        if(nmTitle(ref.title||ref.name)===nmTitle(cand.title||cand.name)) return -1;
        var score=0; var rg=itemGenres(ref), cg=itemGenres(cand);
        if(rg.length&&cg.length){ var hit=0; cg.forEach(function(g){ if(rg.indexOf(g)>-1) hit++; }); if(hit){ score+=30+40*hit/Math.max(rg.length,cg.length); if(cg[0]===rg[0]) score+=10; }
            else if(sharedGenreFamily(rg[0],cg[0])) score+=18; else score-=25; }
        else if(rg.length&&!cg.length) score-=8;
        if(cand.genre&&ref.genre&&cand.genre===ref.genre) score+=(rg.length?4:30);""", 'simgenres')
_rep("    function similarTo(ref, n){ var pool=profFilter(S.movies).concat(profFilter(S.series));",
"""    function nmTitle(t){ return String(t||'').toLowerCase().replace(/\\(\\s*\\d{4}\\s*\\)/g,' ').replace(/^\\s*[a-z]{2,4}\\s*[|:-]\\s*/,'').replace(/[^a-z0-9]+/g,' ').trim(); }
    // TMDB "people who liked this also liked" picks that exist in the user's own library come first.
    function tmdbSimilar(ref, n, cb){ if(!TMDB.enabled()){ cb([]); return; } var k=(ref.seasons!==undefined)?'tv':'movie';
        function go(id){ TMDB.recs(k,id,function(list){ if(!list.length){ cb([]); return; }
            var lib=(k==='tv'?profFilter(S.series):profFilter(S.movies)); var byId={}, byT={};
            lib.forEach(function(x){ var tid=x.tmdbId||x.tmdb; if(tid) byId[String(tid)]=x; byT[nmTitle(x.title)]=byT[nmTitle(x.title)]||x; });
            var out=[], seen={}; list.forEach(function(r){ var x=byId[String(r.id)]; if(!x){ var tx=byT[nmTitle(r.title)]; var ty=String(tx&&tx.year||'').slice(0,4); if(tx&&!(ty&&r.year&&Math.abs(parseInt(ty,10)-parseInt(r.year,10))>1)&&!(tx.tmdb&&String(tx.tmdb)!==String(r.id))) x=tx; }   /* title match only for the same release */ if(x&&x.id!==ref.id&&!seen[x.id]){ seen[x.id]=1; out.push(x); } });
            cb(out.slice(0,n)); }); }
        var tid=ref.tmdbId||ref.tmdb; if(tid){ go(tid); return; }
        TMDB.lookupItem(ref, k==='tv'?'series':'movie', function(meta){ if(meta&&meta.id){ ref.tmdbId=meta.id; if(meta.genres&&meta.genres.length) ref.tmdbGenres=meta.genres; go(meta.id); } else cb([]); }); }
    function similarTo(ref, n){ var pool=profFilter(S.movies).concat(profFilter(S.series));""", 'simtmdb')
_rep("""        var car=document.createElement('div'); car.className='carousel';
        sims.forEach(function(x){ car.appendChild(x.seasons!==undefined?seriesPoster(x):moviePoster(x)); });
        var w=document.createElement('div'); w.className='carousel-wrap'; w.appendChild(car); container.appendChild(w);""",
"""        var car=document.createElement('div'); car.className='carousel';
        sims.forEach(function(x){ car.appendChild(x.seasons!==undefined?seriesPoster(x):moviePoster(x)); });
        var w=document.createElement('div'); w.className='carousel-wrap'; w.appendChild(car); container.appendChild(w);
        // then upgrade the row with TMDB recommendations that are in the library (keeps focus untouched)
        try{ tmdbSimilar(ref,12,function(top){ if(!top.length||!document.body.contains(car)) return; if(car.contains(Nav.current)) return;
            var seen={}, list=[]; top.concat(sims).forEach(function(x){ if(!seen[x.id]&&list.length<12){ seen[x.id]=1; list.push(x); } });
            car.innerHTML=''; list.forEach(function(x){ car.appendChild(x.seasons!==undefined?seriesPoster(x):moviePoster(x)); }); }); }catch(_e){}""", 'simrow')
# ================= Search on TVs: keyboard on the left, results on the right, live while typing =================
_rep("    function renderKeyboard(){", """    var __KB_TV=['a b c d e f','g h i j k l','m n o p q r','s t u v w x','y z 1 2 3 4','5 6 7 8 9 0'];
    function __kbSplitOn(){ return window.innerWidth>=1100; }
    function __searchLive(){ if(SEARCH.debounce) clearTimeout(SEARCH.debounce);
        SEARCH.debounce=setTimeout(function(){ SEARCH.debounce=null; if(!$('view-search').classList.contains('active-view')) return;
            if(!SEARCH.q.trim()){ try{ Search.cancelAsync(); }catch(_e){} renderSearchLanding(); return; }
            // Score the library in small slices so typing never freezes the TV; render when done (a newer
            // key press cancels this one). Previous results stay on screen, dimmed, until the new ones land.
            var q0=SEARCH.q, f0=SEARCH.filter; var rs=$('search-results'); if(rs&&!rs.classList.contains('hidden')) rs.classList.add('searching');
            Search.queryAsync(q0, f0, function(res){ if(SEARCH.q!==q0||SEARCH.filter!==f0) return; if(!$('view-search').classList.contains('active-view')) return;
                SEARCH._live=true; try{ renderSearchResults(false, res); }finally{ SEARCH._live=false; } }); },260); }
    function __renderKeyboardTV(){ var vs=$('view-search'); vs.classList.add('kb-split');
        var fr=$('search-filters'), rs=$('search-results'); if(fr&&rs&&fr.parentNode!==rs) rs.insertBefore(fr, rs.firstChild);
        var kb=$('search-kb'); kb.innerHTML=''; kb.classList.remove('hidden'); SEARCH.kbOpen=true;
        __KB_TV.forEach(function(rowStr){ var row=document.createElement('div'); row.className='kb-row';
            rowStr.split(' ').forEach(function(ch){ row.appendChild(kbKey(ch.toUpperCase(),false,function(){ appendSearch(ch); })); }); kb.appendChild(row); });
        var ar=document.createElement('div'); ar.className='kb-row kb-acts';
        ar.appendChild(kbKey(tr('kb.space','Space'),false,function(){ appendSearch(' '); },'wide'));
        ar.appendChild(kbKeyIcon('i-back10',tr('kb.delete','Delete'),false,backspaceSearch));
        ar.appendChild(kbKey(tr('kb.clear','Clear'),false,function(){ SEARCH.q=''; updateSearchField(); renderSearchLanding(); }));
        kb.appendChild(ar);
        var hint=document.createElement('div'); hint.className='kb-hint'; hint.innerHTML='Results appear on the right as you type. Press <b>Right</b> to go to them.'; kb.appendChild(hint);
        if(!SEARCH.q) renderSearchLanding(); else __searchLive();
        setTimeout(function(){ if(!kb.contains(Nav.current)) Nav.setFocus(kb.querySelector('.kb-key')); },30); }
    // Remote: Right from the keyboard's last column jumps to the results; Left from the first result comes back.
    document.addEventListener('keydown',function(ev){ var vs=$('view-search'); if(!vs||!vs.classList.contains('active-view')||!vs.classList.contains('kb-split')) return;
        var k=ev.keyCode, cur=Nav.current; if(!cur) return; var kb=$('search-kb');
        function vis(e){ return e&&e.offsetParent&&!e.closest('.hidden'); }
        function nearestBy(list,y){ var best=null,bd=1e9; list.forEach(function(e){ var r=e.getBoundingClientRect(); var d=Math.abs((r.top+r.bottom)/2-y); if(d<bd){ bd=d; best=e; } }); return best; }
        var sfw=$('search-filters'), tabsOn=sfw&&!sfw.classList.contains('hidden');
        var tabs=tabsOn?[].filter.call(sfw.querySelectorAll('.search-filter'),vis):[];
        function activeTab(){ return sfw.querySelector('.search-filter.active')||tabs[0]; }
        function areaNow(){ return $('search-results').classList.contains('hidden')?$('search-landing'):$('search-results'); }
        function goKb(fromEl){ var rr=fromEl.getBoundingClientRect(); var rowsLast=[].map.call(kb.querySelectorAll('.kb-row'),function(row){ return row.lastElementChild; }).filter(Boolean); var t3=nearestBy(rowsLast,(rr.top+rr.bottom)/2); if(t3) Nav.setFocus(t3); }
        // Result tabs (All / Channels / Movies ...): Left/Right walk the tabs and scroll the strip,
        // Down drops into the results, Up goes to the search box, Left from the first tab returns to the keyboard.
        if(tabsOn&&sfw.contains(cur)&&(k===37||k===39||k===38||k===40)){
            ev.preventDefault(); ev.stopPropagation(); var ti=tabs.indexOf(cur);
            if(k===39){ if(ti<tabs.length-1){ Nav.setFocus(tabs[ti+1]); try{ tabs[ti+1].scrollIntoView({block:'nearest',inline:'nearest'}); }catch(_e){} } return; }
            if(k===37){ if(ti>0){ Nav.setFocus(tabs[ti-1]); try{ tabs[ti-1].scrollIntoView({block:'nearest',inline:'nearest'}); }catch(_e){} } else goKb(cur); return; }
            if(k===38){ var sf0=$('search-field'); if(sf0) Nav.setFocus(sf0); return; }
            var it0=[].filter.call(areaNow().querySelectorAll('[data-focusable="true"]'),function(e){ return vis(e)&&!sfw.contains(e); }); if(it0.length){ areaNow().scrollTop=0; Nav.setFocus(it0[0]); } return; }
        // Left/Right inside the results move along the same row; Left from the first item goes back to the keyboard.
        if((k===37||k===39)&&!kb.contains(cur)&&areaNow().contains(cur)){
            var allH=[].filter.call(areaNow().querySelectorAll('[data-focusable="true"]'),vis); var rh=cur.getBoundingClientRect(), hy=(rh.top+rh.bottom)/2;
            var same=allH.filter(function(e){ if(e===cur) return false; var b=e.getBoundingClientRect(); var ey=(b.top+b.bottom)/2; if(Math.abs(ey-hy)>Math.max(14,rh.height*0.5)) return false; return k===39? b.left>=rh.right-4 : b.right<=rh.left+4; });
            ev.preventDefault(); ev.stopPropagation();
            if(same.length){ var bt=null,bdx=1e9; same.forEach(function(e){ var b=e.getBoundingClientRect(); var d=Math.abs((b.left+b.right)/2-(rh.left+rh.right)/2); if(d<bdx){ bdx=d; bt=e; } }); Nav.setFocus(bt); try{ bt.scrollIntoView({block:'nearest',inline:'nearest'}); }catch(_e){} return; }
            if(k===37) goKb(cur); return; }
        // Up from the top row of results goes to the active tab (when tabs are shown).
        if(k===38&&tabsOn&&!kb.contains(cur)&&areaNow().contains(cur)){
            var allU=[].filter.call(areaNow().querySelectorAll('[data-focusable="true"]'),function(e){ return vis(e)&&!sfw.contains(e); }); var ru=cur.getBoundingClientRect();
            var above=allU.some(function(e){ var b=e.getBoundingClientRect(); return (b.top+b.bottom)/2 < (ru.top+ru.bottom)/2-Math.max(12,ru.height*0.5); });
            if(!above){ ev.preventDefault(); ev.stopPropagation(); areaNow().scrollTop=0; Nav.setFocus(activeTab()); return; } }
        // Up/Down inside the results column stay INSIDE it: move to the next/previous row of results
        // (or up to the All/Live/Channels... tabs) and scroll the panel, instead of jumping into the keyboard.
        if((k===38||k===40)&&!kb.contains(cur)&&vs.contains(cur)&&!cur.closest('.search-top')){
            var area0=$('search-results').classList.contains('hidden')?$('search-landing'):$('search-results');
            if(area0.contains(cur)){
                var all=[].filter.call(area0.querySelectorAll('[data-focusable="true"]'),vis);
                var rc=cur.getBoundingClientRect(), cy=(rc.top+rc.bottom)/2, cx=(rc.left+rc.right)/2;
                var cands=all.filter(function(e){ if(e===cur) return false; var b=e.getBoundingClientRect(); var ey=(b.top+b.bottom)/2;
                    return k===40 ? (ey>cy+Math.max(12,rc.height*0.5)) : (ey<cy-Math.max(12,rc.height*0.5)); });
                ev.preventDefault(); ev.stopPropagation();
                if(!cands.length){ if(k===38){ var ff=$('search-field'); if(ff) Nav.setFocus(ff); } return; }
                var rowD=Math.min.apply(null,cands.map(function(e){ var b=e.getBoundingClientRect(); return Math.abs((b.top+b.bottom)/2-cy); }));
                var row=cands.filter(function(e){ var b=e.getBoundingClientRect(); return Math.abs((b.top+b.bottom)/2-cy)<=rowD+30; });
                var tgt=null, bx=1e9; row.forEach(function(e){ var b=e.getBoundingClientRect(); var dx=Math.abs((b.left+b.right)/2-cx); if(dx<bx){ bx=dx; tgt=e; } });
                Nav.setFocus(tgt);
                try{ tgt.scrollIntoView({block:k===40?'center':'nearest',inline:'nearest'}); }catch(_e){}
                // Going up to the top row: bring the section header / tabs fully into view too.
                if(k===38){ var top=all[0]; if(top&&tgt.getBoundingClientRect().top-area0.getBoundingClientRect().top<160) area0.scrollTop=Math.max(0,area0.scrollTop-200); }
                return; } }
        if(k===39&&kb.contains(cur)&&!cur.nextElementSibling&&tabsOn&&cur.parentNode===kb.querySelector('.kb-row')){ ev.preventDefault(); ev.stopPropagation(); var at=activeTab(); Nav.setFocus(at); try{ at.scrollIntoView({block:'nearest',inline:'nearest'}); }catch(_e){} return; }
        if(k===39&&kb.contains(cur)&&!cur.nextElementSibling){ var area=$('search-results').classList.contains('hidden')?$('search-landing'):$('search-results');
            var items=[].filter.call(area.querySelectorAll('[data-focusable="true"]'),vis); if(!items.length) return;
            var minX=Math.min.apply(null,items.map(function(e){ return e.getBoundingClientRect().left; })); var col=items.filter(function(e){ return e.getBoundingClientRect().left<=minX+40; });
            var r0=cur.getBoundingClientRect(); var t=nearestBy(col,(r0.top+r0.bottom)/2)||items[0]; ev.preventDefault(); ev.stopPropagation(); Nav.setFocus(t); try{ t.scrollIntoView({block:'nearest',inline:'nearest'}); }catch(_e){} return; }
        if(k===37&&!kb.contains(cur)&&vs.contains(cur)&&!cur.closest('.search-top')){ var r=cur.getBoundingClientRect(); var sibs=[].filter.call((cur.parentNode||vs).querySelectorAll(':scope > [data-focusable="true"]'),vis);
            var leftMost=!sibs.some(function(e){ return e!==cur&&e.getBoundingClientRect().right<=r.left+4&&Math.abs(e.getBoundingClientRect().top-r.top)<r.height; });
            if(leftMost){ var rowsLast=[].map.call(kb.querySelectorAll('.kb-row'),function(row){ return row.lastElementChild; }).filter(Boolean); var t2=nearestBy(rowsLast,(r.top+r.bottom)/2); if(t2){ ev.preventDefault(); ev.stopPropagation(); Nav.setFocus(t2); } } }
    },true);
    function renderKeyboard(){ if(__kbSplitOn()){ __renderKeyboardTV(); return; }""", 'searchtvkb')
_rep("    function appendSearch(ch){ SEARCH.q+=ch; updateSearchField(); scheduleSuggest(); }", "    function appendSearch(ch){ SEARCH.q+=ch; updateSearchField(); if(__kbSplitOn()&&SEARCH.kbOpen){ __searchLive(); return; } scheduleSuggest(); }", 'searchtvappend')
_rep("    function backspaceSearch(){ SEARCH.q=SEARCH.q.slice(0,-1); updateSearchField();", "    function backspaceSearch(){ SEARCH.q=SEARCH.q.slice(0,-1); updateSearchField(); if(__kbSplitOn()&&SEARCH.kbOpen){ __searchLive(); return; }", 'searchtvback')
_rep("    function closeKeyboard(){ SEARCH.kbOpen=false; $('search-kb').classList.add('hidden');", "    function closeKeyboard(){ SEARCH.kbOpen=false; $('view-search').classList.remove('kb-split'); $('search-kb').classList.add('hidden');", 'searchtvclose')
_rep("        if(SEARCH.q.trim().length>=2) Search.addRecent(SEARCH.q.trim());", "        if(!SEARCH._live&&SEARCH.q.trim().length>=2) Search.addRecent(SEARCH.q.trim());", 'searchtvrecent')
_rep("        setTimeout(function(){ if(keepFilterFocus){", "        var _lv=SEARCH._live; setTimeout(function(){ if(_lv) return; if(keepFilterFocus){", 'searchtvfocus')
_rep("        setTimeout(function(){ Nav.setFocus($('search-field')); },30);", "        setTimeout(function(){ if(__kbSplitOn()) renderKeyboard(); else Nav.setFocus($('search-field')); },30);", 'searchtvopen')
# a chosen chip / suggestion keeps the TV keyboard on the left instead of closing it
_rep("    function setSearchQuery(q){ SEARCH.q=q; updateSearchField(); if(SEARCH.kbOpen) closeKeyboard();", "    function setSearchQuery(q){ SEARCH.q=q; updateSearchField(); if(SEARCH.kbOpen&&!__kbSplitOn()) closeKeyboard();", 'searchtvset')
# ================= i18n phrase translator =================
_I18=open('i18n.js',encoding='utf-8').read()
_rep("plural:plural, _EN:EN };", "plural:plural, _EN:EN, _T:T };", 'i18nexposeT')
_rep("var k=el.getAttribute('data-i18n'); var v=t(k); if(v!=null) el.textContent=v;", "var k=el.getAttribute('data-i18n'); if(EN[k]==null&&!(T[cur]&&T[cur][k]!=null)) return; var v=t(k); if(v!=null) el.textContent=v;", 'i18nmissingkey')
_rep("window.L18N=L18N; window.t=function(k,p){ return L18N.t(k,p); };", "window.L18N=L18N; window.t=function(k,p){ return L18N.t(k,p); };\n"+_I18, 'i18nphrases')
# ensure a charset meta exists
if '<meta charset' not in s.lower():
    # the app file has no <head>/<doctype>; declare UTF-8 as the very first
    # bytes so WebView never falls back to Latin-1 (… -> 'â€¦').
    s = '<meta charset="utf-8">\n' + s

# inject the fit script before </body>
if '</body>' in s:
    s = s.replace('</body>', fit_js + '</body>', 1)
else:
    s = s + fit_js

open(out, 'w', encoding='utf-8').write(s)
print('built', out, len(s), 'bytes; CSP', 'Content-Security-Policy' in s,
      '; fit', 'rp-fit-js' in s, '; mobile', 'rp-mobile' in s)

# hls.js is referenced as <script src="hls.min.js"> — ship it beside index.html
import os, shutil
_dst=os.path.join(os.path.dirname(os.path.abspath(out)),'hls.min.js')
if os.path.exists('hls.min.js') and os.path.abspath('hls.min.js')!=_dst:
    shutil.copyfile('hls.min.js', _dst); print('copied hls.min.js ->', _dst)

# --- safety net: syntax-check every inline <script> so a bad patch can never ship ---
import re as _re, subprocess as _sp, tempfile as _tf
_bad=0
for _m in _re.finditer(r'<script(?![^>]*src)[^>]*>(.*?)</script>', s, _re.S):
    with _tf.NamedTemporaryFile('w',suffix='.js',delete=False) as _f: _f.write(_m.group(1)); _fn=_f.name
    _r=_sp.run(['node','--check',_fn],capture_output=True,text=True)
    if _r.returncode: _bad+=1; print('SYNTAX ERROR in inline script near line', s[:_m.start()].count('\n')+1, _r.stderr[:400])
if _bad: raise SystemExit('build aborted: %d inline script(s) failed syntax check' % _bad)
print('syntax check: all inline scripts OK')
