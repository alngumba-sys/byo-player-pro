<script>
/* URL hygiene for pasted playlist links: strips invisible characters, smart quotes, HTML-escaped ampersands,
   stray spaces and wrapping punctuation that phones add when copying from chats, notes or email. */
window.__cleanUrl=function(u){ u=String(u||'');
  u=u.replace(/[​-‏‪-‮⁠-⁤﻿­]/g,'').replace(/[  - 　]/g,' ');
  u=u.replace(/[“”‘’"'<>`]/g,' ').trim();
  u=u.replace(/[\r\n\t]+/g,'');                                    // a link wrapped onto two lines is still one link
  var all=u.match(/https?:\/\/[^ "'<>]+?(?=https?:\/\/| |$)/ig); if(all&&all.length) u=all[all.length-1];            // take the link out of any surrounding text
  u=u.replace(/\s+/g,'').replace(/&amp;/gi,'&').replace(/[)\].,;:!?]+$/,'');
  u=u.replace(/^(https?)(:\/\/)/i,function(_,a,b){ return a.toLowerCase()+b; });
  // Xtream links: repair a cut-off playlist type (e.g. "type=m3u_pl" -> "type=m3u_plus")
  u=u.replace(/([?&]type=)(m3u[_a-z]*)(?=&|$)/i,function(_,a,b){ b=b.toLowerCase(); return a+((b==='m3u'||b==='m3u_plus')?b:(b.indexOf('m3u_p')===0||b==='m3u_'?'m3u_plus':b)); });
  if(u && !/^https?:\/\//i.test(u) && (/^[a-z0-9.-]+\.[a-z]{2,}([:/?]|$)/i.test(u)||/^[a-z0-9.-]+:\d{2,5}(\/|$)/i.test(u)||/^\d{1,3}(\.\d{1,3}){3}([:/]|$)/.test(u))) u='http://'+u;
  return u; };
/* Split an Xtream "get.php?username=..&password=.." link into server / user / pass. */
window.__splitXtream=function(u){ try{ var m=String(u).match(/^(https?:\/\/[^\/?#]+)\/?(?:get\.php|player_api\.php)?\??(.*)$/i); if(!m) return null;
  var q={}; (m[2]||'').split('&').forEach(function(kv){ var p=kv.split('='); if(p[0]) q[decodeURIComponent(p[0]).toLowerCase()]=decodeURIComponent((p[1]||'').replace(/\+/g,' ')); });
  if(q.username&&q.password) return {server:m[1],user:q.username,pass:q.password}; }catch(e){} return null; };
/* Native download (Android app only): no browser rules, normal player user-agent, follows http<->https redirects. */
window.__byoFetchCbs={};
window.__byoFetchCb=function(id,status,detail,path){ var cb=window.__byoFetchCbs[id]; if(!cb) return; delete window.__byoFetchCbs[id]; cb(status,detail,path); };
window.__nativeFetch=function(url,done,maxBytes){ if(!(window.ByoAndroid&&ByoAndroid.fetchToFile)) return false;
  var id='f'+Date.now()+Math.floor(Math.random()*1e6); var fired=false;
  var t=setTimeout(function(){ if(fired) return; fired=true; delete window.__byoFetchCbs[id]; done("err","timeout",""); },280000);
  window.__byoFetchCbs[id]=function(s,d,p){ if(fired) return; fired=true; clearTimeout(t); done(s,d,p); };
  try{ if(maxBytes&&ByoAndroid.fetchToFileMax) ByoAndroid.fetchToFileMax(id,url,maxBytes); else ByoAndroid.fetchToFile(id,url); }catch(e){ clearTimeout(t); delete window.__byoFetchCbs[id]; return false; }
  return true; };
window.__maskUrl=function(u){ try{ return String(u).replace(/(username|password|user|pass|token|api_key)=([^&]*)/ig,function(_,k,v){ return k+'='+(v?'\u2022\u2022\u2022':''); }); }catch(e){ return ''; } };
window.__netErrText=function(r){ r=String(r||'');
  if(r==='http-401'||r==='http-403') return 'The server refused access ('+r.slice(5)+'). Check the username and password in the link, and that the subscription is active.';
  if(r==='http-404') return 'Playlist not found (404). Check the link for typos.';
  if(r==='http-400') return 'The server rejected this link (400 Bad Request). The link is usually incomplete or has extra text on it. Tap Paste to replace it with the copied link.';
  if(r.indexOf('http-')===0) return 'The server returned an error ('+r.slice(5)+'). Try again in a moment.';
  if(r==='dns') return 'Could not find that server. Check the address for typos.';
  if(r==='timeout') return 'The server took too long to respond. Check your internet and try again.';
  if(r==='ssl') return 'Secure connection failed (certificate problem). Try the same link starting with http:// instead of https://.';
  if(r==='refused') return 'The server refused the connection. Check the port number in the link.';
  if(r==='bad-url') return 'That link is not valid. Copy it again and paste it here.';
  return 'Could not reach the server. Check the link and your internet connection.'; };
</script>
<script>
/* Playlist/server boxes: the first tap selects the whole saved link, so a paste REPLACES it instead of landing in the
   middle of the old one; plus a clear (x) button inside each box. */
(function(){ var IDS={'m-url':1,'m-epg':1,'x-server':1,'e-server':1};
  var armed=null;
  document.addEventListener('focusin',function(e){ var t=e.target; if(!t||!IDS[t.id]) return; armed=t; setTimeout(function(){ try{ t.select(); t.setSelectionRange(0,t.value.length); }catch(x){} },30); setTimeout(function(){ if(armed===t){ try{ t.setSelectionRange(0,t.value.length); }catch(x){} } armed=null; },320); },true);
  document.addEventListener('mouseup',function(e){ if(armed&&e.target===armed){ e.preventDefault(); } },true);
  // Any paste into these boxes REPLACES the whole value (never lands in the middle of the old link).
  document.addEventListener('paste',function(e){ var t=e.target; if(!t||!IDS[t.id]) return; var txt='';
      try{ txt=(e.clipboardData||window.clipboardData).getData('text'); }catch(x){}
      if(!txt) return; e.preventDefault(); t.value=window.__cleanUrl?window.__cleanUrl(txt):txt.trim();
      try{ t.dispatchEvent(new Event('input',{bubbles:true})); }catch(x){} },true);
  function pasteInto(inp){ var txt=''; try{ if(window.ByoAndroid&&ByoAndroid.getClipboard) txt=ByoAndroid.getClipboard()||''; }catch(x){}
      function put(v){ if(!v){ try{ if(window.setToast) setToast('Clipboard is empty. Copy the link first.'); }catch(x){} inp.focus(); return; } inp.value=window.__cleanUrl?window.__cleanUrl(v):String(v).trim(); try{ inp.dispatchEvent(new Event('input',{bubbles:true})); }catch(x){} }
      if(txt){ put(txt); return; }
      try{ if(navigator.clipboard&&navigator.clipboard.readText){ navigator.clipboard.readText().then(put,function(){ put(''); }); return; } }catch(x){}
      put(''); }
  function addClear(){ Object.keys(IDS).forEach(function(id){ var inp=document.getElementById(id); if(!inp||inp.__clr) return; inp.__clr=1; var f=inp.parentNode; if(!f) return;
      var pb=document.createElement('button'); pb.type='button'; pb.className='f-paste'; pb.textContent='Paste'; pb.setAttribute('data-focusable','true'); pb.tabIndex=0;
      pb.addEventListener('click',function(ev){ ev.preventDefault(); pasteInto(inp); }); f.appendChild(pb);
      f.classList.add('has-clear'); var b=document.createElement('button'); b.type='button'; b.className='f-clear'; b.setAttribute('aria-label','Clear'); b.tabIndex=-1; b.textContent='\u00D7';
      b.addEventListener('click',function(ev){ ev.preventDefault(); inp.value=''; inp.focus(); });
      f.appendChild(b); }); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',addClear); else addClear();
})();
</script>
<script>
/* Web player (fallback): press and HOLD the left/right side to scrub; longer hold = bigger jump. Quick taps stay at 10 s. */
(function(){ var st=null, iv=null, skipClick=false;
  function zone(x,y){ var W=window.innerWidth,H=window.innerHeight; if(y<H*0.16||y>H*0.8) return 0; return x<W*0.3?-1:(x>W*0.7?1:0); }
  function fmt(s){ s=Math.round(s); var m=Math.floor(s/60), r=s%60; return m?(m+':'+(r<10?'0':'')+r):(s+'s'); }
  function flash(side,secs,keep){ var vp=document.getElementById('view-player'); if(!vp) return; var f=document.getElementById('rp-seekflash'); if(!f){ f=document.createElement('div'); f.id='rp-seekflash'; vp.appendChild(f); }
    f.textContent=side<0?('\u23EA -'+fmt(secs)):('+'+fmt(secs)+' \u23E9'); f.className=(side<0?'l':'r')+' show'; clearTimeout(window.__rpSf); if(!keep) window.__rpSf=setTimeout(function(){ f.className=f.className.replace(' show',''); },700); }
  document.addEventListener('touchstart',function(e){ var vp=document.getElementById('view-player'); if(!vp||!vp.classList.contains('active-view')||!vp.contains(e.target)) return;
    if(e.target.closest&&e.target.closest('#transport,button,.tb,#opt-pop,[data-focusable]')) return;
    var v=document.getElementById('html5-player'); if(!v||!isFinite(v.duration)||!(v.duration>0)) return; var t=e.touches[0]; var z=zone(t.clientX,t.clientY); if(!z) return;
    st={side:z, t0:Date.now(), secs:0, held:false, v:v};
    clearInterval(iv); iv=setInterval(function(){ if(!st) return clearInterval(iv); var el=Date.now()-st.t0; if(el<450) return; st.held=true;
      var h=(el-450)/1000, rate=h<2.5?20:(h<5?60:180); st.secs+=rate*0.1;
      var maxB=st.v.currentTime, maxF=Math.max(0,st.v.duration-st.v.currentTime-1); if(st.side<0&&st.secs>maxB) st.secs=maxB; if(st.side>0&&st.secs>maxF) st.secs=maxF;
      flash(st.side,st.secs,true); },100); },{passive:true});
  function end(cancel){ clearInterval(iv); if(!st) return; var s=st; st=null; if(s.held){ skipClick=true; setTimeout(function(){ skipClick=false; },500);
      if(!cancel){ s.v.currentTime=Math.max(0,Math.min(s.v.duration-1,s.v.currentTime+s.side*s.secs)); } flash(s.side,s.secs,false); } }
  document.addEventListener('touchend',function(){ end(false); },{passive:true});
  document.addEventListener('touchcancel',function(){ end(true); },{passive:true});
  document.addEventListener('click',function(e){ if(skipClick){ skipClick=false; e.stopPropagation(); e.preventDefault(); } },true);
})();
</script>
