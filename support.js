    /* ============================================================================
       REMOTE HELP. The customer opens Settings > Connection > Get remote help, the TV
       shows a 4-digit code, and BYO support types that code into the admin console.
       While help is on, the TV checks in every few seconds, applies what support sends
       (connections, settings, a message, trial days, sections on/off, refresh, sign out)
       and reports back "done" or the error. Nothing happens without the code, the TV
       always shows that help is on, and the customer can end it at any time.
       Sections switched off by support stay off until switched back on (read at start-up).
       ============================================================================ */
    var Support=(function(){
        var LS='byo_support', FLAGS_LS='byo_flags';
        var sess=null, pollT=null, busy=false, log=[], lastStatus='', agent='';
        function load(){ try{ sess=JSON.parse(localStorage.getItem(LS)||'null'); }catch(e){ sess=null; } }
        function save(){ try{ if(sess) localStorage.setItem(LS, JSON.stringify(sess)); else localStorage.removeItem(LS); }catch(e){} }
        function devKey(){ try{ return Billing.deviceId(); }catch(e){ return (Store.device&&Store.device.deviceId)||''; } }
        function plat(){ var d=window.__byoDevice||{}; return d.platform==='android'?(d.tv?'Android TV':'Android'):(window.tizen?'Samsung Tizen':'Web'); }

        // What support sees about this TV. Never includes passwords or playlist URLs.
        function snapshot(){ var d=window.__byoDevice||{}, lib={}; try{ lib=Multi.deviceState(); }catch(e){ lib={}; }
            var b={}; try{ var ax=Billing.access(); b={ state:billState(ax), days_left:Billing.daysLeft(), access:ax?ax.state:'', until:(ax&&ax.until)||'' }; }catch(e){}
            var p=Store.parental||{};
            return { version:d.version||'', platform:plat(), model:d.model||'', country:(Store.settings&&Store.settings.region)||'', lang:(Store.settings&&Store.settings.lang)||'en',
                profiles:(Store.profiles||[]).length, parental:{ enabled:!!p.enabled, has_pin:!!p.pin, lock_settings:!!p.lockSettings },
                flags:flags(), billing:b, library:lib, at:Date.now() }; }

        // ---------- sections on/off ----------
        var FLAG_SEL={ live:'.nav [data-view="live"]', sports:'.nav [data-view="sports"]', movies:'.nav [data-view="movies"]', series:'.nav [data-view="series"]', guide:'#nav-guide-dd', assistant:'.nav-ask-btn' };
        function flags(){ try{ return JSON.parse(localStorage.getItem(FLAGS_LS)||'{}')||{}; }catch(e){ return {}; } }
        function applyFlags(f){ f=f||{}; try{ localStorage.setItem(FLAGS_LS, JSON.stringify(f)); }catch(e){}
            Object.keys(FLAG_SEL).forEach(function(k){ var off=(f[k]===false); document.querySelectorAll(FLAG_SEL[k]).forEach(function(el){ el.classList.toggle('flag-off', off); }); }); }
        function flagAllows(view){ var f=flags(); var k=(view==='guide'||view==='replay'||view==='epg')?'guide':(view==='ask'?'assistant':view); return f[k]!==false; }
        // What every TV reports when it checks in: nothing personal, no playlist links, servers or logins.
        function billState(ax){ if(Billing.isBlocked()) return 'blocked'; if(ax&&ax.state==='ended') return 'expired';
            if(Billing.grantedUntil()) return 'enabled'; if(Billing.subActive()) return 'active'; return Billing.inTrial()?'trial':'expired'; }
        function fleetState(){ var d=window.__byoDevice||{}, b={}, lib={};
            try{ var ax=Billing.access(); b={ state:billState(ax), days_left:Billing.daysLeft(), access:ax?ax.state:'' }; try{ if(Billing.inTrial()) b.ends=new Date(Billing.trialEndsAt()).toISOString(); }catch(_e){} }catch(e){}
            try{ lib={ live:(S.live||[]).length, movies:(S.movies||[]).length, series:(S.series||[]).length, connections:(Store.savedPlaylists||[]).length||((Store.cfg&&Store.cfg.mode)?1:0) }; }catch(e){}
            return { version:d.version||'', platform:plat(), model:d.model||'', country:(Store.settings&&Store.settings.region)||'', lang:(Store.settings&&Store.settings.lang)||'en',
                profiles:(Store.profiles||[]).length, billing:b, library:lib }; }
        function onFlags(res){ if(!res||typeof res!=='object'||res.error) return; applyFlags(res);
            // access set by support (enable / end / block) is kept on the server and applied at every check-in
            try{ var cur=Billing.access(); var want=(res.access&&res.access.state)?res.access:null; if(JSON.stringify(cur||null)!==JSON.stringify(want)){ var wasLocked=Billing.locked(); Billing.setAccess(want);
                if(!wasLocked&&Billing.locked()){ try{ if($('view-player').classList.contains('active-view')) exitPlayer(); }catch(e){} try{ Billing.openWall(Billing.isBlocked()?'blocked':'expired'); }catch(e){} }
                if(wasLocked&&!Billing.locked()&&want&&want.state==='active') activated(want);
                else if(wasLocked&&!Billing.locked()) message(want&&want.state==='active'?'BYO Player is enabled':'Access restored', want&&want.state==='active'?('BYO support has enabled BYO Player on this TV until '+new Date(want.until).toLocaleDateString(undefined,{ day:'numeric', month:'long', year:'numeric' })+'.\nHappy watching!'):'BYO support has restored BYO Player on this TV.\nHappy watching!', true, 'Continue watching');
                try{ if($('view-home').classList.contains('active-view')) renderHome(); }catch(e){}
                setTimeout(checkin, 1500); } }catch(e){} }   // report the new state straight back so the console is current
        function checkin(){ var k=devKey(); if(!k||typeof Supa==='undefined') return;
            Supa.rpc('byo_device_checkin',{ p_device_key:k, p_state:fleetState() },function(err,res){
                if(err){ Supa.rpc('byo_device_flags',{ p_device_key:k },function(e2,r2){ if(!e2) onFlags(r2); }); return; }   // older backend
                onFlags(res); }); }
        var checkT=null;
        // Quick access check (enable / disable from the console shows within ~20 s)
        function quick(){ var k=devKey(); if(!k||typeof Supa==='undefined'||document.hidden) return;
            Supa.rpc('byo_device_flags',{ p_device_key:k },function(err,res){ if(!err) onFlags(res); }); }
        var quickT=null;
        function bootFlags(){ applyFlags(flags()); checkin(); if(!checkT) checkT=setInterval(checkin, 15*60000); if(!quickT) quickT=setInterval(quick, 20000);
            document.addEventListener('visibilitychange',function(){ if(!document.hidden) checkin(); }); }

        // ---------- overlay ----------
        function ov(){ var o=$('support-ov'); if(o) return o;
            o=document.createElement('div'); o.id='support-ov'; o.className='support-ov hidden';
            o.innerHTML='<div class="sup-card"><div class="sup-head"><span class="sup-ic">'+icon('i-bell')+'</span><div><div class="sup-title">Remote help</div><div class="sup-sub" id="sup-sub"></div></div></div>'+
                '<div class="sup-live hidden" id="sup-live"></div><div class="sup-code" id="sup-code"></div><div class="sup-status" id="sup-status"></div><div class="sup-log" id="sup-log"></div>'+
                '<div class="sup-acts"><button class="s-btn" id="sup-hide" data-focusable="true" tabindex="0">Keep help on &amp; close</button><button class="s-btn danger" id="sup-end" data-focusable="true" tabindex="0">End help</button></div></div>';
            ($('stage')||document.body).appendChild(o);
            $('sup-hide').addEventListener('click', hide); $('sup-end').addEventListener('click', function(){ end(true); });
            return o; }
        // Where the remote was before a help screen opened. Focus goes back there a moment AFTER the
        // screen closes, so the OK press that closed it can't also press whatever is underneath
        // (that is what opened the Subscribe screen on Home).
        var backTo=null, msgBackTo=null;
        function usable(el){ return !!(el&&el.isConnected&&el.offsetParent!==null&&!(el.closest&&(el.closest('#support-ov')||el.closest('#support-msg')))); }
        function restore(el, fallback){ setTimeout(function(){ try{ if(usable(el)) Nav.setFocus(el); else if(fallback&&usable(fallback)) Nav.setFocus(fallback); else Nav.focusFirst(); }catch(e){} }, 300); }
        function syncWall(){ var on=isOpen()||msgOpen(); document.body.classList.toggle('sup-on', on);
            if(!on){ try{ if(!Billing.locked()&&Billing.isWallOpen()) Billing.closeWall(); }catch(e){} try{ if(Billing.locked()&&!Billing.isWallOpen()) setTimeout(function(){ if(!isOpen()&&!msgOpen()&&Billing.locked()) Billing.openWall('expired'); },350); }catch(e){} } }
        function show(){ if(!isOpen()) backTo=Nav.current; document.body.classList.add('sup-on'); ov().classList.remove('hidden'); paint(); setTimeout(function(){ Nav.setFocus($('sup-hide')); },30); }
        function hide(){ var o=$('support-ov'); if(o) o.classList.add('hidden'); try{ renderCard(); }catch(e){} if(!msgOpen()) restore(backTo, $('btn-support')); syncWall(); }
        function isOpen(){ var o=$('support-ov'); return !!(o&&!o.classList.contains('hidden')); }
        function paint(){ if(!$('support-ov')) return;
            var st=sess?sess.status:'none', code=sess?sess.code:'';
            $('sup-code').innerHTML=code?code.split('').map(function(c){ return '<span>'+esc(c)+'</span>'; }).join(''):'';
            var live=(st==='connected'); $('sup-code').classList.toggle('hidden', live); $('support-ov').classList.toggle('is-live', live);
            $('sup-live').classList.toggle('hidden', !live);
            if(live) $('sup-live').innerHTML='<div class="sl-top"><span class="sl-dot"></span><span class="sl-t">Support is connected</span></div>'+
                '<div class="sl-s">'+esc(agent||'BYO support')+' is working on your TV now. This usually takes <b>less than 5 minutes</b>.</div>'+(code?'<div class="sl-c">Code '+esc(code)+'</div>':'');
            var tid=String(devKey()||'').slice(-6).toUpperCase();
            $('sup-sub').textContent= st==='connected' ? 'Changes support makes show up below.' :
                                      st==='waiting' ? 'Read this code to BYO support. It works for 15 minutes.'+(tid?' TV ID '+tid+'.':'') :
                                      st==='opening' ? 'Getting a code…' : 'Help has ended.';
            $('sup-status').textContent= st==='waiting' ? 'Waiting for support to connect…' : st==='connected' ? 'You can keep watching. Press End help at any time.' : (sess&&sess.err)||'';
            $('sup-log').innerHTML=log.slice(-6).reverse().map(function(l){ return '<div class="sup-li '+(l.ok===false?'err':(l.ok?'ok':''))+'"><b>'+esc(l.t)+'</b>'+(l.d?'<span>'+esc(l.d)+'</span>':'')+'</div>'; }).join(''); }
        function note(t, d, ok){ log.push({t:t, d:d||'', ok:ok}); if(log.length>30) log=log.slice(-30); paint(); }

        // Card at the top of Settings > Connection.
        function renderCard(){ try{
            var pg=document.querySelector('.set-page[data-page="connection"]'); if(!pg) return;
            var box=$('support-card'); if(!box){ box=document.createElement('div'); box.id='support-card'; box.className='conn-phone support-card'; var anchor=pg.querySelector('.conn-phone'); if(anchor) anchor.parentNode.insertBefore(box, anchor.nextSibling); else pg.appendChild(box); }
            var on=active();
            box.innerHTML='<div class="conn-phone-left"><div class="conn-phone-ic">'+icon('i-bell')+'</div><div><div class="conn-phone-title">'+(on?'Remote help is on':'Need help? Get remote help')+'</div>'+
                '<div class="conn-phone-sub">'+(on?(sess.status==='connected'?'Support is connected'+(agent?' ('+esc(agent)+')':'')+'.':'Code '+esc(sess.code)+', waiting for support.'):'Get a 4-digit code and read it to BYO support. They can set up your connection and settings for you.')+'</div></div></div>'+
                '<button class="s-btn primary" id="btn-support" data-focusable="true" tabindex="0">'+icon('i-bell')+'<span>'+(on?'Open':'Get remote help')+'</span></button>';
            $('btn-support').addEventListener('click', function(){ if(active()) show(); else open(); });
        }catch(e){} }

        // ---------- session ----------
        function active(){ return !!(sess&&(sess.status==='waiting'||sess.status==='connected'||sess.status==='opening')); }
        function open(){ if(typeof Supa==='undefined'||!Supa.configured||!Supa.configured()){ setToast('Remote help needs an internet connection.'); return; }
            var k=devKey(); if(!k){ setToast('Remote help is not available on this TV yet.'); return; }
            sess={ status:'opening' }; log=[]; agent=''; show();
            Supa.rpc('byo_support_open',{ p_device_key:k, p_state:snapshot() },function(err,res){
                if(err||!res||res.error){ sess={ status:'ended', err:(res&&res.error)?('Could not start help: '+res.error):'Could not reach BYO support. Check the internet connection and try again.' }; save(); paint(); renderCard(); return; }
                sess={ id:res.session_id, token:res.token, code:res.code, status:'waiting', exp:Date.parse(res.expires_at)||Date.now()+15*60000 }; save(); paint(); renderCard(); startPoll(); }); }
        function end(byUser){ if(sess&&sess.id&&sess.token){ try{ Supa.rpc('byo_support_end',{ p_session_id:sess.id, p_token:sess.token },function(){}); }catch(e){} }
            stopPoll(); if(byUser) setToast('Remote help ended.'); sess=null; save(); var o=$('support-ov'); if(o) o.classList.add('hidden'); renderCard(); try{ var b=$('btn-support'); if(b&&byUser) Nav.setFocus(b); }catch(e){} }
        function startPoll(){ stopPoll(); pollT=setInterval(poll, 4000); setTimeout(poll, 600); }
        function stopPoll(){ if(pollT){ clearInterval(pollT); pollT=null; } }
        var busyAt=0;
        function poll(){ if(!sess||!sess.id) return; if(busy&&Date.now()-busyAt<20000) return; busy=true; busyAt=Date.now();   // never let one lost reply stop the check-ins
            Supa.rpc('byo_support_poll',{ p_session_id:sess.id, p_token:sess.token, p_state:snapshot() },function(err,res){ busy=false;
                if(err||!res) return;                                   // network blip: try again next tick
                if(res.error){ note('Help stopped', res.error, false); sess.status='ended'; finish(); return; }
                if(res.claimed_by) agent=res.claimed_by;
                if(res.status!==sess.status){ var was=sess.status; sess.status=res.status; save();
                    if(res.status==='connected'&&was!=='connected'){ setToast('BYO support is connected.'); note('Support connected', agent); }
                    if(res.status==='ended'||res.status==='expired'){
                        if(res.status==='expired') setToast(res.status==='expired'&&was==='waiting'?'The help code expired.':'Remote help has ended.');
                        else if(res.ended_by==='timeout') { note('Help time is up',''); message('Remote help has ended','The time for this help session ran out. If you still need help, open Get remote help again for a new code.', true); }
                        else { note('Support has finished',''); message('All done!', (agent?agent+' from ':'')+'BYO support has finished helping you.\nHappy watching!', true); }
                        finish(); return; }
                    paint(); renderCard(); }
                (res.commands||[]).forEach(run); }); }
        function finish(){ stopPoll(); sess=null; save(); paint(); renderCard(); var o=$('support-ov'); if(o&&!o.classList.contains('hidden')){ o.classList.add('hidden'); if(!msgOpen()) restore(backTo, $('btn-support')); } syncWall(); }
        function ack(cmd, ok, msg){ note(label(cmd), msg, ok); if(!ok) setToast(label(cmd)+': '+msg);
            if(!sess||!sess.id) return; Supa.rpc('byo_support_ack',{ p_session_id:sess.id, p_token:sess.token, p_command_id:cmd.id, p_ok:!!ok, p_result:String(msg||'').slice(0,380) },function(){}); }
        function label(cmd){ var p=cmd.payload||{}; switch(cmd.kind){
            case 'connection.add': return 'Connection added: '+(p.name||p.mode||'');
            case 'connection.remove': return 'Connection removed';
            case 'settings': return 'Settings changed';
            case 'message': return 'Message from support';
            case 'refresh': return 'Library refreshed';
            case 'signout': return 'Signed out';
            case 'billing.refresh': case 'trial.add': case 'access.set': return 'Trial / subscription updated';
            case 'flags': return 'Sections updated';
            default: return cmd.kind; } }

        function unlockedNow(){ try{ if(Billing.isWallOpen()&&!Billing.locked()) Billing.closeWall(); }catch(e){}
            try{ if($('view-home').classList.contains('active-view')) renderHome(); }catch(e){} }
        // ---------- applying commands ----------
        function run(cmd){ var p=cmd.payload||{};
            try{ switch(cmd.kind){
                case 'connection.add': {
                    if(!p.mode||!/^(xtream|m3u|emby|jellyfin)$/.test(p.mode)) return ack(cmd,false,'Unknown connection type');
                    if(p.mode==='m3u'&&!p.url) return ack(cmd,false,'Playlist URL missing');
                    if(p.mode!=='m3u'&&!p.server) return ack(cmd,false,'Server URL missing');
                    if(typeof p.combine==='boolean'){ Store.settings.combineSources=p.combine; Store.save(); }
                    note('Adding '+(p.name||p.mode)+'…','',null);
                    Multi.addFromPhone({ mode:p.mode, name:p.name||'', url:p.url||'', epg:p.epg||'', server:p.server||'', user:p.user||'', pass:p.pass||'', via:'support' }, function(r){
                        if(r&&r.ok) ack(cmd,true,'Loaded'+(r.live!=null?': '+(r.live||0)+' channels, '+(r.movies||0)+' movies, '+(r.series||0)+' series':''));
                        else ack(cmd,false,(r&&r.err)||'Could not load this connection'); });
                    return; }
                case 'connection.remove': {
                    var saved=Store.savedPlaylists||[], hit=null; saved.forEach(function(x){ if(x.id===p.id) hit=x; });
                    if(!hit) return ack(cmd,false,'That connection is no longer on this TV');
                    var wasActive=false; try{ wasActive=Store.cfg&&Store.cfg.mode&&Store.cfg.mode!=='multi'&&Multi.keyOf(Store.cfg)===Multi.keyOf(hit); }catch(e){}
                    Store.savedPlaylists=saved.filter(function(x){ return x!==hit; }); Store.save();
                    if(Store.settings&&Store.settings.combineSources&&Store.savedPlaylists.length){ Multi.reload({ quiet:true }); }
                    else if(wasActive||!Store.savedPlaylists.length){ Store.cfg={}; if(Store.settings) Store.settings.combineSources=false; Store.save(); clearLibrary(); }
                    try{ renderPlaylists(); }catch(e){}
                    return ack(cmd,true,'Removed '+(hit.name||hit.mode)); }
                case 'settings': {
                    var done=[];
                    if(p.lang){ try{ if(window.L18N) L18N.set(p.lang); else { Store.settings.lang=p.lang; Store.save(); } done.push('language '+p.lang); }catch(e){} }
                    if(p.parental){ var pc=Store.parental||(Store.parental={enabled:false,pin:'',lockSettings:false,genres:{}}), q=p.parental;
                        if(q.pin!=null){ var pin=String(q.pin).replace(/\D/g,''); if(pin&&pin.length!==4) return ack(cmd,false,'PIN must be 4 digits'); pc.pin=pin; done.push(pin?'new parental PIN':'parental PIN cleared'); if(!pin) pc.enabled=false; }
                        if(typeof q.enabled==='boolean'){ if(q.enabled&&!pc.pin) return ack(cmd,false,'Set a PIN before turning parental controls on'); pc.enabled=q.enabled; done.push('parental controls '+(q.enabled?'on':'off')); }
                        if(typeof q.lockSettings==='boolean'){ pc.lockSettings=q.lockSettings; done.push('settings lock '+(q.lockSettings?'on':'off')); }
                        Store.save(); try{ renderParental(); }catch(e){} try{ renderAll(); }catch(e){} }
                    if(!done.length) return ack(cmd,false,'Nothing to change');
                    setToast('Support changed: '+done.join(', ')+'.');
                    return ack(cmd,true,done.join(', ')); }
                case 'message': { message(p.title||'Message from BYO support', p.text||''); return ack(cmd,true,'Shown on the TV'); }
                case 'refresh': { setToast('Support is refreshing your library…'); try{ Billing.sync(function(){}); }catch(e){}
                    var cur=null; try{ var c=Store.cfg||{}; (Store.savedPlaylists||[]).forEach(function(x){ if(c.mode&&c.mode!=='multi'&&Multi.keyOf(x)===Multi.keyOf(c)) cur=x; }); }catch(e){}
                    var fin=function(res, ok){ ack(cmd, !!ok, ok?('Reloaded: '+S.live.length+' channels, '+S.movies.length+' movies, '+S.series.length+' series'):'Nothing could be loaded'); };
                    if(Store.settings&&Store.settings.combineSources&&(Store.savedPlaylists||[]).length) Multi.reload({ quiet:true, done:fin });
                    else if(cur) Multi.reload({ quiet:true, only:cur, done:fin });
                    else ack(cmd,false,'No connection to refresh on this TV');
                    return; }
                case 'signout': {
                    Store.savedPlaylists=[]; if(Store.settings) Store.settings.combineSources=false; Store.save();
                    Store.cfg={}; Store.save(); clearLibrary();
                    try{ renderPlaylists(); }catch(e){}
                    setToast('Support signed this TV out of its connections.');
                    return ack(cmd,true,'All connections removed from this TV'); }
                case 'billing.refresh': { Billing.sync(function(err){ if(err) return ack(cmd,false,'Could not refresh: '+err);
                        var t=Billing.subActive()?'Subscription active':(Billing.inTrial()?'Trial: '+Billing.daysLeft()+' days left':'Trial ended'); setToast(t+'.'); ack(cmd,true,t); }); return; }
                case 'access.set': { var A=(p.access&&p.access.state)?p.access:null; var wasLocked=Billing.locked(); Billing.setAccess(A); unlockedNow();
                    if(!Billing.locked()&&(wasLocked||(A&&A.state==='active'))){
                        if(A&&A.state==='active') activated(A);
                        else message('Access restored', 'BYO support has restored BYO Player on this TV.\nHappy watching!', true, 'Continue watching'); }
                    var txt=!A?'Back to normal':(A.state==='active'?('Enabled until '+new Date(A.until).toLocaleDateString()):(A.state==='ended'?'Access ended':'Blocked'));
                    setToast(!A?'BYO support restored normal access.':(A.state==='active'?'BYO support enabled BYO Player on this TV.':(A.state==='ended'?'BYO support ended access on this TV.':'BYO support paused BYO Player on this TV.')));
                    try{ if($('view-home').classList.contains('active-view')) renderHome(); }catch(e){}
                    return ack(cmd,true,txt); }
                case 'trial.add': { var nd=parseInt(p.days,10)||0; if(!nd) return ack(cmd,false,'No days given');
                    // adding days also lifts an "access ended" (support clears it on the server too)
                    try{ var ax0=Billing.access(); if(nd>0&&ax0&&ax0.state==='ended') Billing.setAccess(null); }catch(e){}
                    Billing.addBonusDays(nd); unlockedNow();
                    var t2=Billing.subActive()?'Subscription active':(Billing.inTrial()?'Trial: '+Billing.daysLeft()+' days left':'Trial ended');
                    if(nd>0&&!Billing.locked()){ var dl=Billing.daysLeft();
                        message(nd+' free day'+(nd===1?'':'s')+' added', 'BYO support added '+nd+' day'+(nd===1?'':'s')+' to BYO Player on this TV. You now have '+dl+' day'+(dl===1?'':'s')+' left.\nHappy watching!', true, 'Continue watching'); }
                    else setToast((nd>0?'Support added '+nd+' free day'+(nd===1?'':'s'):'Support removed '+(-nd)+' day'+(nd===-1?'':'s'))+'. '+t2+'.');
                    return ack(cmd,true,t2); }
                case 'flags': { applyFlags((p&&p.flags)||{}); var offs=Object.keys(p.flags||{}).filter(function(k){ return p.flags[k]===false; });
                    return ack(cmd,true,offs.length?('Hidden: '+offs.join(', ')):'All sections on'); }
                default: return ack(cmd,false,'This TV does not support "'+cmd.kind+'" yet. Update the app.');
            } }catch(e){ ack(cmd,false,'Error: '+String(e&&e.message||e).slice(0,120)); } }

        // A message from support, shown on top until dismissed.
        // Blurred placeholder lines for a connection BYO support added: shows that details exist, never the details.
        window.__managedSub=function(pl){ var rows=pl.mode==='m3u'?[['Playlist','http://playlist.example.com/get.php?u=000000'],['Guide','http://guide.example.com/xmltv.xml']]
                :[['Server','http://server.example.com:8080'],['Username','username00'],['Password','password00']];
            return '<div class="mg-rows">'+rows.map(function(r){ return '<span class="mg-r"><i>'+r[0]+'</i><b aria-hidden="true">'+r[1]+'</b></span>'; }).join('')+'</div>'; };
        function message(title, text, done, okLabel){ if(!msgOpen()) msgBackTo=isOpen()?null:Nav.current; var m=$('support-msg'); if(!m){ m=document.createElement('div'); m.id='support-msg'; m.className='support-ov'; ($('stage')||document.body).appendChild(m); }
            m.innerHTML='<div class="sup-card sup-msg"><div class="sup-head"><span class="sup-ic'+(done?' done':'')+'">'+icon(done?'i-check':'i-bell')+'</span><div><div class="sup-title">'+esc(title)+'</div><div class="sup-sub">From BYO support</div></div></div>'+
                '<div class="sup-text">'+esc(text).replace(/\n/g,'<br>')+'</div><div class="sup-acts"><button class="s-btn primary" id="sup-msg-ok" data-focusable="true" tabindex="0">'+esc(okLabel||(done?'Start watching':'OK'))+'</button></div></div>';
            m._done=!!done; m.classList.remove('hidden'); document.body.classList.add('sup-on'); $('sup-msg-ok').addEventListener('click', closeMessage); setTimeout(function(){ Nav.setFocus($('sup-msg-ok')); },30); }
        // "Continue watching" / "Start watching" goes back to what they were watching: the remote help
        // screen closes too (help stays on in the background until support or the customer ends it).
        // "1 Month activated": the length is the headline, then until when, how, and the reference.
        function durLabel(a){ var plan=String(a.plan||'').toLowerCase(), M={ daily:'1 Day', weekly:'1 Week', monthly:'1 Month', quarterly:'3 Months', yearly:'1 Year', annual:'1 Year' };
            if(M[plan]) return M[plan];
            var d=Math.round((new Date(a.until)-new Date(a.at||Date.now()))/86400000); if(!(d>0)) d=1;
            if(d===1) return '1 Day'; if(d===7) return '1 Week'; if(d===14) return '2 Weeks'; if(d>=28&&d<=31) return '1 Month'; if(d>=89&&d<=92) return '3 Months'; if(d>=180&&d<=184) return '6 Months'; if(d>=364&&d<=366) return '1 Year'; return d+' Days'; }
        function activated(a){ if(!a||!a.until) return; if(!msgOpen()) msgBackTo=isOpen()?null:Nav.current;
            var m=$('support-msg'); if(!m){ m=document.createElement('div'); m.id='support-msg'; m.className='support-ov'; ($('stage')||document.body).appendChild(m); }
            var u=new Date(a.until), paid=!!a.paid;
            var when=u.toLocaleDateString(undefined,{ weekday:'short', day:'numeric', month:'short', year:'numeric' })+', '+u.toLocaleTimeString(undefined,{ hour:'numeric', minute:'2-digit' });
            var rows=['<div class="ac-row"><span>Active until</span><b>'+esc(when)+'</b></div>',
                '<div class="ac-row"><span>'+(paid?'Paid with':'From')+'</span><b>'+esc(paid?(a.by||'M-Pesa'):'BYO support')+'</b></div>'];
            if(paid&&a.ref) rows.push('<div class="ac-row"><span>Reference</span><b class="ac-ref">'+esc(a.ref)+'</b></div>');
            m.innerHTML='<div class="sup-card sup-msg sup-act"><div class="ac-ok">'+icon('i-check')+'</div>'+
                '<div class="ac-k">'+(paid?'Payment received':'BYO Player is on')+'</div>'+
                '<div class="ac-h">'+esc(durLabel(a))+' activated</div>'+
                '<div class="ac-rows">'+rows.join('')+'</div>'+
                '<div class="sup-acts"><button class="s-btn primary" id="sup-msg-ok" data-focusable="true" tabindex="0">Start watching</button></div></div>';
            m._done=true; m.classList.remove('hidden'); document.body.classList.add('sup-on'); $('sup-msg-ok').addEventListener('click', closeMessage); setTimeout(function(){ Nav.setFocus($('sup-msg-ok')); },30); }
        function closeMessage(){ var m=$('support-msg'), done=!!(m&&m._done); if(m) m.classList.add('hidden');
            if(done&&isOpen()){ var o=$('support-ov'); if(o) o.classList.add('hidden'); try{ renderCard(); }catch(e){} restore(backTo, $('btn-support')); syncWall(); return; }
            if(isOpen()) restore($('sup-hide')); else restore(msgBackTo||backTo, $('btn-support')); syncWall(); }
        function msgOpen(){ var m=$('support-msg'); return !!(m&&!m.classList.contains('hidden')); }
        function scope(){ if(msgOpen()) return $('support-msg'); if(isOpen()) return $('support-ov'); return null; }
        function back(){ if(msgOpen()){ closeMessage(); return true; } if(isOpen()){ hide(); return true; } return false; }

        function boot(){ load(); bootFlags(); renderCard();
            if(sess&&sess.id&&(sess.status==='waiting'||sess.status==='connected')){ if(sess.status==='waiting'&&sess.exp&&sess.exp<Date.now()){ sess=null; save(); renderCard(); } else startPoll(); }
            else if(sess){ sess=null; save(); } }
        return { boot:boot, checkin:checkin, activated:activated, tvId:function(){ return String(devKey()||'').slice(-6).toUpperCase(); }, open:open, end:end, show:show, back:back, scope:scope, renderCard:renderCard, flagAllows:flagAllows, applyFlags:applyFlags, active:active, _run:run };
    })();
    setTimeout(function(){ try{ Support.boot(); }catch(_e){} }, 2500);
