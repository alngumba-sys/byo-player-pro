    /* ============================================================================
       BILLING: first-run trial of the PLAYER (user brings their own playlist) and the payment wall.
       - New users get TRIAL_DAYS (8) free with the house playlist already loaded.
       - When the trial ends (and no active subscription) a payment wall blocks content.
       - Methods by country: ET = telebirr (existing Pay flow), KE = M-Pesa or card,
         TZ = mobile money (M-Pesa / Tigo Pesa / Airtel Money, same send-to-our-number flow),
         everyone else = card. M-Pesa / card call backend functions that are stubs
         until the providers are integrated (see byo-payments/supabase/functions).
       ============================================================================ */
    var BILLING_CONFIG={
        trialDays:8,
        // Free, legal free-to-air channels so a new install is never empty (Free-TV/IPTV, public list).
        freeChannels:{ name:'Free channels', url:'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8' },
        // Placeholder prices (edit, or serve real ones from byo.prices via device-start).
        prices:{
            TZ:      { currency:'TZS', plans:[ {code:'m1',name:'1 Month',amount:10000,days:30}, {code:'m3',name:'3 Months',amount:27000,days:90,tag:'Save 10%'}, {code:'m12',name:'12 Months',amount:96000,days:365,tag:'Best value'} ] },
            KE:      { currency:'KES', plans:[ {code:'m1',name:'1 Month',amount:500,days:30}, {code:'m3',name:'3 Months',amount:1350,days:90,tag:'Save 10%'}, {code:'m12',name:'12 Months',amount:4800,days:365,tag:'Best value'} ] },
            DEFAULT: { currency:'USD', plans:[ {code:'m1',name:'1 Month',amount:4.99,days:30}, {code:'m3',name:'3 Months',amount:12.99,days:90,tag:'Save 13%'}, {code:'m12',name:'12 Months',amount:44.99,days:365,tag:'Best value'} ] }
        },
        supportEmail:'info@byoplayer.com'
    };
    var Billing=(function(){
        var base=BYO_BACKEND.url, key=BYO_BACKEND.anon;
        var st={}; try{ st=JSON.parse(localStorage.getItem('byo_billing')||'{}')||{}; }catch(e){ st={}; }   // { state, trialEndsAt, subUntil, plans, currency, methods, source, checkedAt }
        var pollT=null, wallOpen=false, pending=null;

        function save(){ try{ localStorage.setItem('byo_billing',JSON.stringify(st)); }catch(e){} try{ Store.save(); }catch(e){} }
        function country(){ return (Store.settings&&Store.settings.region)||''; }
        // This TV's identity for payments, access and support. Fixed the first time it is needed and never changed
        // afterwards: pairing a phone again (e.g. scanning the QR to add a connection) used to give the TV a new ID,
        // which lost its payment and showed the trial-ended screen.
        var _did=null;
        function deviceId(){ if(_did) return _did; var d=null; try{ d=localStorage.getItem('byo_tv_key'); }catch(e){}
            if(!d){ if(Store.device&&Store.device.deviceId) d=Store.device.deviceId; else if(window.deviceId) d=window.deviceId;
                if(!d){ try{ d=localStorage.getItem('byo_bill_did'); }catch(e){} }
                if(!d) d='bd'+Date.now().toString(36)+Math.floor(Math.random()*1e9).toString(36);
                try{ localStorage.setItem('byo_tv_key',d); localStorage.setItem('byo_bill_did',d); }catch(e){} }
            _did=d; return d; }
        function fn(name, body, cb){ try{ var x=new XMLHttpRequest(); x.open('POST', base+'/functions/v1/'+name, true);
                x.setRequestHeader('Content-Type','application/json'); x.setRequestHeader('apikey',key); x.setRequestHeader('Authorization','Bearer '+key); x.timeout=15000;
                x.onreadystatechange=function(){ if(x.readyState!==4) return; var j=null; try{ j=JSON.parse(x.responseText||'null'); }catch(e){}
                    if(x.status>=200&&x.status<300) cb(null,j); else cb('http-'+x.status,j); };
                x.ontimeout=function(){ cb('timeout',null); }; x.onerror=function(){ cb('neterr',null); }; x.send(JSON.stringify(body||{})); }catch(e){ cb('exc',null); } }

        // ---- trial clock (server is authoritative; the local clock is the offline fallback) ----
        function lic(){ var L=ensureLicense(); if(!L.v3trial){ L.v3trial=true; L.started=Date.now(); save(); } return L; }
        // Server clock wins (it already includes any days support added); otherwise the TV's own clock plus support's extra days.
        // Support can override access for this TV: enable until a date, end it now, or block it.
        function acc(){ try{ return JSON.parse(localStorage.getItem('byo_access')||'null')||null; }catch(e){ return null; } }
        function setAccess(a){
            // "End access" really ends it: the free days left are used up, so days added later count from today.
            if(a&&a.state==='ended'){ var L=lic(), D=86400000, T=BILLING_CONFIG.trialDays; if(L.started+(T+(L.bonusDays||0))*D>Date.now()){ L.bonusDays=(Date.now()-L.started)/D-T; save(); } }
            try{ if(a&&a.state) localStorage.setItem('byo_access', JSON.stringify(a)); else localStorage.removeItem('byo_access'); }catch(e){}
            if(locked()){ openWall(isBlocked()?'blocked':'expired'); } else if(wallOpen){ closeWall(); }
            try{ refreshBanner(); }catch(e){} try{ paintNav(); }catch(e){} }
        function isBlocked(){ var a=acc(); return !!(a&&a.state==='blocked'); }
        function grantedUntil(){ var a=acc(); if(a&&a.state==='active'){ var u=a.until?+new Date(a.until):Infinity; if(u>Date.now()) return u; } return 0; }
        function trialEndsAt(){ var a=acc(); if(a&&(a.state==='ended'||a.state==='blocked')) return Math.min(a.at?+new Date(a.at):Date.now(), Date.now());
            if(st.trialEndsAt) return +new Date(st.trialEndsAt); var L=lic(); return L.started+(BILLING_CONFIG.trialDays+(L.bonusDays||0))*86400000; }
        // If the trial has already run out, added days count from today (not from the old end date).
        function addBonusDays(n){ var L=lic(), D=86400000, T=BILLING_CONFIG.trialDays; L.bonusDays=L.bonusDays||0;
            if(n>0&&L.started+(T+L.bonusDays)*D<Date.now()) L.bonusDays=(Date.now()-L.started)/D-T;
            L.bonusDays+=n; save(); try{ refreshBanner(); }catch(e){} }
        function subActive(){ var a=acc(); if(a&&(a.state==='ended'||a.state==='blocked')) return false; if(grantedUntil()) return true;
            return !!(st.subUntil && +new Date(st.subUntil)>Date.now()) || (st.state==='active') || (window.Pay&&Pay._state&&Pay._state().unlocked===true&&Pay._state().state==='active'); }
        function inTrial(){ return !subActive() && Date.now()<trialEndsAt(); }
        function locked(){ return !subActive() && Date.now()>=trialEndsAt(); }
        function daysLeft(){ return Math.max(0, Math.ceil((trialEndsAt()-Date.now())/86400000)); }
        function hoursLeft(){ return Math.max(0, Math.ceil((trialEndsAt()-Date.now())/3600000)); }

        // ---- talk to the backend ----
        function apply(res){ if(!res||!res.ok) return; st.state=res.state||st.state; if(res.trial_ends_at) st.trialEndsAt=res.trial_ends_at; if(res.sub_expires_at!==undefined) st.subUntil=res.sub_expires_at;
            if(res.plans&&res.plans.length){ st.plans=res.plans; st.currency=res.currency; } if(res.methods) st.methods=res.methods; st.checkedAt=Date.now(); save(); }
        function sync(cb){ fn('device-start',{ device_id:deviceId(), country:country(), platform:(window.ByoAndroid?'android':'web'), trial_started_at:new Date(lic().started).toISOString() },function(err,res){ if(!err) apply(res); cb&&cb(err); }); }
        function status(cb){ fn('billing-status',{ device_id:deviceId() },function(err,res){ if(!err) apply(res); cb&&cb(err,res); }); }

        // ---- first run: "Add your playlist" (paste a link, log in, or start with free channels) ----
        var addMode='m3u';
        function renderTrialStep(grid, contBtn, backBtn, stepBadge, eyebrow, rhead, foot){
            contBtn.classList.add('hidden'); backBtn.classList.remove('hidden'); stepBadge.textContent='3 / 3';
            eyebrow.textContent=BILLING_CONFIG.trialDays+'-DAY FREE TRIAL';
            $('welcome-title').innerHTML='Add your<br>playlist.';
            $('welcome-sub').textContent='Paste the M3U link or log in with the details from your TV provider. BYO Player does not supply channels.';
            rhead.textContent='Connect your playlist';
            grid.className='welcome-grid one-col bl-add';
            var seg=document.createElement('div'); seg.className='bl-seg';
            [['m3u','M3U link'],['xtream','Xtream login'],['emby','Emby / Jellyfin']].forEach(function(m){ var b=document.createElement('button'); b.className='bl-segb'+(addMode===m[0]?' on':''); b.setAttribute('data-focusable','true'); b.tabIndex=0; b.textContent=m[1];
                b.addEventListener('click',function(){ addMode=m[0]; renderWelcome(); }); seg.appendChild(b); });
            grid.appendChild(seg);
            var form=document.createElement('div'); form.className='bl-form';
            function field(id,label,ph,type,paste){ return '<div class="f-field bl-f"><label for="'+id+'">'+label+'</label><div class="bl-in"><input id="'+id+'" type="'+(type||'text')+'" placeholder="'+ph+'" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"'+(paste?' inputmode="url"':'')+' data-focusable="true" tabindex="0"/>'+(paste?'<button type="button" class="bl-paste" data-for="'+id+'" data-focusable="true" tabindex="0">Paste</button>':'')+'</div></div>'; }
            if(addMode==='m3u') form.innerHTML=field('wz-url','Playlist link (M3U)','https://…/get.php?username=…','text',true);
            else if(addMode==='xtream') form.innerHTML=field('wz-server','Server','http://provider.com:8080','text',true)+field('wz-user','Username','username')+field('wz-pass','Password','password','password');
            else form.innerHTML=field('wz-server','Server address','http://your-server:8096','text',true)+field('wz-user','Username','username')+field('wz-pass','Password','password','password')+
                '<label class="bl-chk"><input type="checkbox" id="wz-jelly"/> This is a Jellyfin server</label>';
            grid.appendChild(form);
            var err=document.createElement('div'); err.className='bl-err hidden'; grid.appendChild(err);
            var go=document.createElement('button'); go.className='s-btn primary bl-start'; go.setAttribute('data-focusable','true'); go.tabIndex=0; go.innerHTML=icon('i-play')+'Connect & start watching';
            go.addEventListener('click',function(){ connectFromWelcome(err); }); grid.appendChild(go);
            var or=document.createElement('div'); or.className='wz-or'; or.textContent='or'; grid.appendChild(or);
            var free=document.createElement('button'); free.className='s-btn bl-free'; free.setAttribute('data-focusable','true'); free.tabIndex=0; free.innerHTML=icon('i-live')+'Start with free channels';
            free.addEventListener('click',function(){ loadFree(err); }); grid.appendChild(free);
            var qr=document.createElement('button'); qr.className='wz-link bl-own'; qr.setAttribute('data-focusable','true'); qr.tabIndex=0; qr.textContent='Set up from another phone (QR code)';
            qr.addEventListener('click',function(){ lic(); Store.settings.firstRun=false; Store.save(); closeWelcome(); openPairing('welcome'); }); grid.appendChild(qr);
            foot.innerHTML='<span class="wz-foot-note" style="text-align:left;display:block">Your '+BILLING_CONFIG.trialDays+' days of BYO Player are free. After that, subscribe to keep using the app '+(country()==='ET'?'(telebirr).':(country()==='KE'?'(M-Pesa or card).':(country()==='TZ'?'(M-Pesa, Tigo Pesa or Airtel Money).':'(card).')))+'</span>';
            // Paste buttons: read the clipboard (Android bridge, then the browser API) and REPLACE the field
            [].forEach.call(grid.querySelectorAll('.bl-paste'),function(b){ b.addEventListener('click',function(){ var inp=$(b.getAttribute('data-for')); var t='';
                try{ if(window.ByoAndroid&&ByoAndroid.getClipboard) t=ByoAndroid.getClipboard()||''; }catch(e){}
                function put(v){ if(!v){ setToast('Copy your playlist link first, then tap Paste.'); inp.focus(); return; } inp.value=window.__cleanUrl?window.__cleanUrl(v):String(v).trim(); }
                if(t) put(t); else { try{ navigator.clipboard.readText().then(put,function(){ put(''); }); }catch(e){ put(''); } } }); });
            [].forEach.call(grid.querySelectorAll('input'),function(inp){ inp.addEventListener('paste',function(e){ if(inp.type==='password') return; var t=''; try{ t=(e.clipboardData||window.clipboardData).getData('text'); }catch(x){}
                if(t&&/url|server/.test(inp.id)){ e.preventDefault(); inp.value=window.__cleanUrl?window.__cleanUrl(t):t.trim(); } }); });
            setTimeout(function(){ var f=grid.querySelector('input'); if(f) Nav.setFocus(f); },60);
        }
        function showErr(el,t){ el.textContent=t; el.classList.toggle('hidden',!t); }
        // Fill the (hidden) Settings › Connection form and run the normal connect, then watch for success / error.
        function connectFromWelcome(errEl){ showErr(errEl,'');
            var clean=window.__cleanUrl||function(v){ return String(v||'').trim(); };
            try{
                if(addMode==='m3u'){ var u=clean($('wz-url').value); $('wz-url').value=u; if(!/^https?:\/\//i.test(u)){ showErr(errEl,'Paste your playlist link (it starts with http).'); return; }
                    setMode('m3u'); $('m-url').value=u; $('m-epg').value=''; }
                else if(addMode==='xtream'){ var sv=clean($('wz-server').value), us=$('wz-user').value.trim(), pw=$('wz-pass').value.trim();
                    var sx=window.__splitXtream&&window.__splitXtream(sv); if(sx){ sv=sx.server; us=us||sx.user; pw=pw||sx.pass; }
                    if(!/^https?:\/\//i.test(sv)||!us||!pw){ showErr(errEl,'Enter the server, username and password from your provider.'); return; }
                    setMode('xtream'); $('x-server').value=sv; $('x-user').value=us; $('x-pass').value=pw; }
                else { var es=clean($('wz-server').value), eu=$('wz-user').value.trim(), ep=$('wz-pass').value;
                    if(!/^https?:\/\//i.test(es)||!eu){ showErr(errEl,'Enter your server address and username.'); return; }
                    setMode($('wz-jelly')&&$('wz-jelly').checked?'jellyfin':'emby'); $('e-server').value=es; $('e-user').value=eu; $('e-pass').value=ep; }
            }catch(e){ showErr(errEl,'Something went wrong. Try again.'); return; }
            runConnect(errEl,null);
        }
        function loadFree(errEl){ showErr(errEl,''); try{ setMode('m3u'); $('m-url').value=BILLING_CONFIG.freeChannels.url; $('m-epg').value=''; }catch(e){} runConnect(errEl,BILLING_CONFIG.freeChannels.name); }
        function runConnect(errEl,label){ var t0=Date.now(); var stEl=$('settings-status'); if(stEl){ stEl.textContent=''; stEl.className='settings-status'; }
            try{ connect(); }catch(e){ showErr(errEl,'Could not connect. Check the details and try again.'); return; }
            var iv=setInterval(function(){ var cls=(stEl&&stEl.className)||'', txt=(stEl&&stEl.textContent)||'';
                var ok=(S.live&&S.live.length)||(S.movies&&S.movies.length)||(S.series&&S.series.length);
                if(/\bok\b/.test(cls)&&ok){ clearInterval(iv); begin(label); return; }
                if(/\berr\b/.test(cls)&&txt){ clearInterval(iv); showErr(errEl,txt); return; }
                if(Date.now()-t0>90000){ clearInterval(iv); showErr(errEl,'This is taking too long. Check your internet and the link, then try again.'); } },300); }
        function begin(label){ lic(); Store.settings.firstRun=false; if(label&&Store.cfg){ Store.cfg.name=label; Store.cfg.free=true; } Store.save(); closeWelcome(); purgeDemo();
            sync(function(){ refreshBanner(); }); goTo('home');
            setToast(label?('Loaded '+label+'. Add your own playlist any time in Settings.'):('Your '+BILLING_CONFIG.trialDays+'-day free trial has started.')); }

        function purgeDemo(){ try{ if(!(Store.cfg&&Store.cfg.mode)||!Store.resume) return; var ch=false; Object.keys(Store.resume).forEach(function(k){ if(Store.resume[k]&&Store.resume[k]._demo){ delete Store.resume[k]; ch=true; } }); if(ch){ if(Store._persist) Store._persist(); else Store.save(); } }catch(e){} }
        function boot(){ lic(); purgeDemo(); try{ Pay.refresh(); }catch(e){}
            sync(function(){ if(locked()){ openWall('expired'); return; } refreshBanner(); });
            if(locked()) setTimeout(function(){ if(locked()) openWall('expired'); },400);
            setInterval(function(){ if(locked()&&!wallOpen&&!document.hidden) openWall('expired'); refreshBanner(); },60000);
            paintNav(); setInterval(paintNav, 1500);
            // a click on a greyed-out tab explains itself instead of doing nothing
            document.addEventListener('click',function(e){ var t=e.target&&e.target.closest&&e.target.closest('.nav-dis'); if(!t) return; e.preventDefault(); e.stopPropagation(); allow(viewOf(t)==='profile'?'mytv':viewOf(t)); }, true); }

        // ---- gate: content needs a trial or a subscription ----
        var GATED={ live:1, movies:1, series:1, sports:1, guide:1, now:1, replay:1, sportdetail:1 };
        function hasLibrary(){ try{ return !!((Store.cfg&&Store.cfg.mode)||(Store.savedPlaylists||[]).length); }catch(e){ return true; } }
        // What the top bar allows right now: everything; only Settings (paused or no access); or Home + Settings (no playlist yet)
        function navMode(){ if(locked()) return 'locked'; if(!hasLibrary()) return 'nolib'; return ''; }
        var NAV_FREE={ settings:1, about:1, license:1, playlists:1 };
        function navOk(name, m){ m=(m===undefined)?navMode():m; if(!m) return true; if(NAV_FREE[name]) return true; if(m==='nolib'&&name==='home') return true; return false; }
        function allow(name){
            var m=navMode();
            if(m==='nolib'&&!navOk(name,m)){ try{ setToast('Add a playlist first: Settings, Connection.'); }catch(e){} return false; }
            if(GATED[name]||(m==='locked'&&!navOk(name,m))){ if(!locked()) return true; pending=GATED[name]?name:null; openWall(isBlocked()?'blocked':'expired'); return false; }
            return true; }
        var NAV_ITEMS='#nav .nav-item, .topbar-right [data-view="ask"], .topbar-right [data-view="search"], #btn-profile';
        function viewOf(el){ if(el.id==='nav-guide-trigger') return 'guide'; if(el.id==='btn-profile') return 'profile'; return el.getAttribute('data-view')||''; }
        function paintNav(){ var m=navMode(); document.body.classList.toggle('nav-lock', !!m);
            [].forEach.call(document.querySelectorAll(NAV_ITEMS),function(el){ var off=!navOk(viewOf(el),m);
                if(off===el.classList.contains('nav-dis')) return;
                el.classList.toggle('nav-dis', off); el.setAttribute('aria-disabled', off?'true':'false'); el.setAttribute('data-focusable', off?'false':'true'); el.tabIndex=off?-1:0;
                el.title=off?(m==='nolib'?'Add a playlist in Settings first':(isBlocked()?'BYO Player is paused on this TV':'Subscribe to use this')):(el.getAttribute('aria-label')||''); }); }
        function canPlay(){ if(!locked()) return true; openWall('expired'); return false; }

        // ---- Home banner: quiet countdown during the trial, firm prompt after ----
        function homeBanner(){ if(isBlocked()){ var bb=document.createElement('div'); bb.className='pay-banner bl-banner exp'; bb.setAttribute('data-focusable','true'); bb.tabIndex=0;
                bb.innerHTML='<div class="pb-ic">'+icon('i-lock')+'</div><div class="pb-text"><div class="pb-title">BYO Player is paused on this TV</div><div class="pb-sub">Contact '+esc(BILLING_CONFIG.supportEmail)+' or get remote help.</div></div><div class="pb-cta">Details'+icon('i-chev-r')+'</div>';
                bb.addEventListener('click',function(){ openWall('blocked'); }); return bb; }
            if(subActive()) return null; var exp=locked(); if(!exp && !inTrial()) return null;
            var el=document.createElement('div'); el.className='pay-banner bl-banner'+(exp?' exp':''); el.setAttribute('data-focusable','true'); el.tabIndex=0;
            var left=daysLeft(), hl=hoursLeft(); var when=left>1?(left+' days left'):(hl+' hour'+(hl===1?'':'s')+' left');
            el.innerHTML='<div class="pb-ic">'+icon(exp?'i-lock':'i-clock')+'</div><div class="pb-text"><div class="pb-title">'+(exp?'Your free trial has ended':('Free trial · '+when))+'</div>'+
                '<div class="pb-sub">'+(exp?'Subscribe to keep using BYO Player.':'Subscribe any time to keep using BYO Player after your trial.')+'</div></div><div class="pb-cta">Subscribe'+icon('i-chev-r')+'</div>';
            el.addEventListener('click',function(){ openWall(exp?'expired':'trial'); }); return el; }
        function refreshBanner(){ var hv=$('view-home'); if(!hv||!hv.classList.contains('active-view')) return; var b=$('home-body'); var old=b&&b.querySelector('.bl-banner');
            var want=homeBanner(); if(old&&want){ old.replaceWith(want); } else if(old&&!want){ old.remove(); } else if(!old&&want&&b){ b.insertBefore(want,b.firstChild); } }

        // ---- the payment wall ----
        function cc(){ return String(country()||'').toUpperCase(); }
        function mobile(){ return cc()==='KE'||cc()==='ET'||cc()==='TZ'; }
        function payCfg(){ var p=st.pay; return (p&&p.country===cc()&&p.plans&&p.plans.length)?p:null; }
        function loadPay(cb){ if(!mobile()||typeof Supa==='undefined'){ cb&&cb(); return; }
            Supa.rpc('byo_pay_config',{ p_country:cc() },function(err,res){ if(!err&&res&&res.ok){ st.pay=res; save(); } cb&&cb(); }); }
        function priceTable(){ var p=payCfg(); if(p) return { currency:p.currency, plans:p.plans };
            if(st.plans&&st.plans.length) return { currency:st.currency||'USD', plans:st.plans }; return BILLING_CONFIG.prices[cc()]||BILLING_CONFIG.prices.DEFAULT; }
        function methods(){ var c=cc(); if(c==='ET') return ['telebirr']; if(c==='KE') return ['mpesa']; if(c==='TZ') return ['tzmm']; if(st.methods&&st.methods.length) return st.methods; return ['card']; }
        function mm(){ if(cc()==='ET') return { id:'telebirr', name:'telebirr', cls:'telebirr', cur:'ETB', ex:'0912 345 678' };
            if(cc()==='TZ') return { id:'tzmm', name:'mobile money', long:'M-Pesa, Tigo Pesa or Airtel Money', cls:'mpesa', cur:'TZS', ex:'0712 345 678' };
            return { id:'mpesa', name:'M-Pesa', cls:'mpesa', cur:'KES', ex:'0712 345 678' }; }
        function money(cur,amt){ var n=Number(amt); return cur+' '+(n%1?n.toFixed(2):n.toLocaleString()); }
        function wallEl(){ var w=$('billing-wall'); if(w) return w; w=document.createElement('div'); w.id='billing-wall'; w.className='bl-wall hidden'; w.innerHTML='<div class="bl-card"></div>'; document.body.appendChild(w); return w; }
        var plan=null;
        function openWall(why){ if(isBlocked()) why='blocked'; var w=wallEl(); wallOpen=true; w.classList.remove('hidden'); w._why=why; try{ stopHeroPreview(); }catch(e){} screenPlans();
            if(why!=='blocked') loadPay(function(){ var c0=card(); if(wallOpen&&!payReq&&!isBlocked()&&c0.querySelector('.bl-plans, .pk-plans')&&document.activeElement!==$('bl-phone')) screenPlans(); }); }
        function closeWall(){ var w=$('billing-wall'); if(w) w.classList.add('hidden'); wallOpen=false; stopPoll(); }
        function resume(){ if(payReq&&wallOpen&&!isBlocked()){
                if(Date.now()-(payReq.started||0)<VERIFY_MS){ screenVerify(); return true; }
                payReq=null; st.payReq=null; save(); } return false; }
        function card(){ var c=wallEl().querySelector('.bl-card'); if(!isBlocked()) c.classList.remove('bl-paused'); if(!mobile()||isBlocked()) c.classList.remove('bl-pick'); return c; }
        function screenPlans(){ var why=wallEl()._why; var c=card(); var M=methods(); if(why!=='blocked'&&!isBlocked()&&payReq&&!c.querySelector('.bl-plans')&&resume()) return;
            if(why==='blocked'||isBlocked()){ screenPaused(); return; }
            var T=priceTable(); if(!plan||!T.plans.some(function(p){ return p.code===plan.code; })) plan=T.plans[Math.min(2,T.plans.length-1)];
            if(mobile()){ screenPick(why); return; }
            c.innerHTML=head(why)+'<div class="bl-plans"></div><div class="bl-sub">Pay with</div><div class="bl-methods"></div>'+foot();
            var pl=c.querySelector('.bl-plans');
            T.plans.forEach(function(p){ var d=document.createElement('button'); d.className='bl-plan'+(plan&&plan.code===p.code?' on':''); d.setAttribute('data-focusable','true'); d.tabIndex=0;
                d.innerHTML='<span class="bl-pn">'+esc(p.name)+(p.tag?'<i>'+esc(p.tag)+'</i>':'')+'</span><span class="bl-pp">'+esc(money(T.currency,p.amount))+'</span>';
                d.addEventListener('click',function(){ plan=p; screenPlans(); }); pl.appendChild(d); });
            var m=c.querySelector('.bl-methods');
            if(M.indexOf('mpesa')>-1) m.appendChild(btn('M-Pesa','bl-m mpesa',function(){ screenPick(wallEl()._why); }));
            if(M.indexOf('card')>-1) m.appendChild(btn('Debit / credit card','bl-m card',function(){ startCard(); }));
            if(M.indexOf('telebirr')>-1) m.appendChild(btn('telebirr','bl-m telebirr',function(){ closeWall(); try{ Pay.openFlow(); }catch(e){} }));
            wireFoot(); focusFirst(); }
        // Paused by support: calm, clear, and two easy ways back
        function tvId(){ try{ return Support.tvId()||''; }catch(e){ return ''; } }
        function screenPaused(){ var c=card(); var id=tvId(); c.classList.add('bl-paused');
            c.innerHTML='<div class="bp-top"><div class="bp-ic">'+icon('i-pause')+'</div><div class="bp-tt"><div class="bl-h">BYO Player is paused on this TV</div>'+
                '<div class="bl-hs">Nothing is lost. Your playlists, favourites and settings are safe and will be right here when it is turned back on.</div></div></div>'+
                '<div class="bp-how"><div class="bp-k">To turn it back on</div>'+
                '<div class="bp-step"><span>1</span><div>Choose <b>Get remote help</b> and read the 4-digit code to BYO support.</div></div>'+
                '<div class="bp-step"><span>2</span><div>Or email <b>'+esc(BILLING_CONFIG.supportEmail)+'</b>'+(id?' with your TV ID':'')+'.</div></div>'+
                (id?'<div class="bp-id">TV ID <b>'+esc(id)+'</b></div>':'')+'</div>'+
                '<div class="bp-acts"></div><div class="bl-msg hidden"></div>'+
                '<div class="bl-foot"><button class="wz-link" data-a="settings" data-focusable="true" tabindex="0">Go to Settings</button></div>';
            var a=c.querySelector('.bp-acts');
            a.appendChild(btn('Get remote help','bl-m card',function(){ try{ Support.open(); }catch(e){} }));
            a.appendChild(btn('Check again','bl-m bp-sec',function(){ msg('Checking with BYO support…');
                try{ Support.checkin(); }catch(e){}
                setTimeout(function(){ if(isBlocked()) msg('Still paused. Support has not turned it back on yet.',true); },3500); }));
            c.querySelector('[data-a="settings"]').addEventListener('click',function(){ closeWall(); goTo('settings'); });
            focusFirst(); }
        function head(why){ var ended=(acc()&&acc().state==='ended');
            return '<div class="bl-lock">'+icon(why==='expired'?'i-lock':'i-star')+'</div><div class="bl-h">'+(why==='expired'?(ended?'Your access has ended':'Your free trial has ended'):'Subscribe to BYO Player')+'</div>'+
                '<div class="bl-hs">'+(why==='expired'?'Subscribe to keep using BYO Player with your playlist: TV guide, sports scores, profiles and more.':'Keep using BYO Player after your free trial. Choose a plan.')+'</div>'; }
        function foot(){ return '<div class="bl-foot"><button class="wz-link" data-a="paid" data-focusable="true" tabindex="0">I have already paid</button>'+
                (wallEl()._why==='expired'?'':'<button class="wz-link" data-a="later" data-focusable="true" tabindex="0">Not now</button>')+
                '<button class="wz-link" data-a="settings" data-focusable="true" tabindex="0">Settings</button></div><div class="bl-help">Help: '+esc(BILLING_CONFIG.supportEmail)+'</div><div class="bl-msg hidden"></div>'; }
        function wireFoot(){ var c=card(); [].forEach.call(c.querySelectorAll('.bl-foot [data-a]'),function(b){ b.addEventListener('click',function(){ var a=b.getAttribute('data-a');
            if(a==='later'){ closeWall(); } else if(a==='settings'){ closeWall(); goTo('settings'); } else if(a==='paid'&&mobile()){ if(payReq){ screenVerify(); } else msg('Your TV unlocks by itself within a minute of your payment arriving. If it has not, contact '+BILLING_CONFIG.supportEmail+' with your '+mm().name+' message.',false); }
            else if(a==='paid'){ msg('Checking your subscription…'); status(function(){ if(!locked()&&subActive()) done(); else msg('No payment found yet. If you just paid, wait a minute and try again.',true); }); } }); }); }
        function btn(label,cls,fnc){ var b=document.createElement('button'); b.className=cls; b.setAttribute('data-focusable','true'); b.tabIndex=0; b.innerHTML=esc(label); b.addEventListener('click',fnc); return b; }
        function focusFirst(){ setTimeout(function(){ var f=card().querySelector('.bl-plan.on, .bl-m, [data-focusable]'); if(f) Nav.setFocus(f); },30); }
        function msg(t,err){ var m=card().querySelector('.bl-msg'); if(!m) return; m.textContent=t; m.className='bl-msg'+(err?' err':''); }

        // M-Pesa (Kenya) / telebirr (Ethiopia): the customer sends money to our number; the collector
        // phone reads the SMS and the backend matches it to this TV by the payer's number.
        var payReq=null;
        function daysTxt(d){ d=+d; if(d===1) return '1 day'; if(d===7) return '1 week'; if(d===30) return '30 days'; if(d%30===0&&d<=360) return (d/30)+' months'; return d+' days'; }
        // One screen: pick a plan, type the number you pay from, press the green button.
        function screenPick(why){ var c=card(), W=mm(), T=priceTable(), P=payCfg()||{}; payReq=null; stopPoll();
            c.classList.add('bl-pick');
            var to=P.number?local(P.number):'';
            c.innerHTML='<div class="pk-head"><span class="pk-ic">'+icon(why==='expired'?'i-lock':'i-star')+'</span><div><div class="bl-h">'+(why==='expired'?((acc()&&acc().state==='ended')?'Your access has ended':'Your free trial has ended'):'Subscribe to BYO Player')+'</div>'+
                    '<div class="bl-hs">Choose a plan and pay with '+(W.long||W.name)+'. BYO Player unlocks by itself.</div></div></div>'+
                '<div class="pk-plans" style="grid-template-columns:repeat('+Math.max(1,T.plans.length)+',minmax(0,1fr))"></div>'+
                '<div class="pk-row"><div class="pk-ph"><label for="bl-phone">Your '+W.name+' number <span>(you pay from)</span></label>'+
                    '<input id="bl-phone" type="tel" inputmode="tel" placeholder="'+W.ex+'" autocomplete="tel" data-focusable="true" tabindex="0"/></div>'+
                    '<div class="pk-to '+W.cls+'"><span>Send to</span><b>'+esc(to||'Not set yet')+'</b>'+(P.name?'<i>'+esc(P.name)+'</i>':'')+'</div></div>'+
                '<div class="pk-note">'+icon('i-info')+'<span>Only '+(W.long||W.name)+' from your phone. Bank transfers can’t be matched to your TV.</span></div>'+
                '<div class="pk-go"></div><div class="bl-msg hidden"></div>'+
                '<div class="bl-foot"><button class="wz-link" data-a="paid" data-focusable="true" tabindex="0">I have already paid</button><button class="wz-link" data-a="settings" data-focusable="true" tabindex="0">Settings</button></div>'+
                '<div class="bl-help">Help: '+esc(BILLING_CONFIG.supportEmail)+'</div>';
            var pl=c.querySelector('.pk-plans'), go=c.querySelector('.pk-go');
            var gb=btn('','bl-m '+W.cls,function(){ startPay(); }); go.appendChild(gb);
            function label(){ gb.textContent='Pay '+money(T.currency,plan.amount)+' with '+W.name; }
            T.plans.forEach(function(p){ var d=document.createElement('button'); d.className='pk-plan'+(plan&&plan.code===p.code?' on':''); d.setAttribute('data-focusable','true'); d.tabIndex=0;
                d.innerHTML='<span class="pk-n">'+esc(p.name)+'</span><span class="pk-p">'+esc(money(T.currency,p.amount))+'</span><span class="pk-d">'+esc(daysTxt(p.days))+'</span>';
                function pick(){ plan=p; [].forEach.call(pl.children,function(x){ x.classList.toggle('on', x===d); }); label(); }
                d.addEventListener('click',function(){ pick(); setTimeout(function(){ if(phoneOk($('bl-phone').value)) Nav.setFocus(gb); else { Nav.setFocus($('bl-phone')); if(kbOpen&&(window.ByoAndroid||window.tizen||window.webapis||!('ontouchstart' in window))) kbOpen(); } },30); });
                d.addEventListener('focus',pick); d.addEventListener('navfocus',pick); pl.appendChild(d); });
            label();
            $('bl-phone').value=st.payPhone||'';
            // A TV doesn't pop up a keyboard for a focused box: open the app's own number keyboard on OK.
            function typeNumber(){ try{ openFieldKeyboard($('bl-phone'),{ label:'Your '+W.name+' number (the one you pay from)', returnFocus:gb, digits:true }); }catch(e){} }
            kbOpen=typeNumber;
            $('bl-phone').addEventListener('click',function(e){ if(window.ByoAndroid||!('ontouchstart' in window)){ e.preventDefault(); typeNumber(); } });
            $('bl-phone').addEventListener('keydown',function(e){ if(e.key==='Enter'||e.keyCode===13){ e.preventDefault(); e.stopPropagation(); typeNumber(); } });
            if(window.ByoAndroid||(window.tizen||window.webapis)) $('bl-phone').setAttribute('readonly','readonly');
            [].forEach.call(c.querySelectorAll('.bl-foot [data-a]'),function(b){ b.addEventListener('click',function(){ var a=b.getAttribute('data-a');
                if(a==='settings'){ closeWall(); goTo('settings'); }
                else if(st.payReq&&st.payReq.id&&Date.now()-(st.payReq.at||0)<2*3600000){ payReq={ id:st.payReq.id, started:Date.now() }; screenVerify(); }
                else msg('Your TV unlocks by itself as soon as your '+W.name+' payment arrives. If it hasn’t, contact '+BILLING_CONFIG.supportEmail+'.',false); }); });
            setTimeout(function(){ var f=pl.querySelector('.pk-plan.on')||pl.firstChild; if(f) Nav.setFocus(f); },30); }
        var kbOpen=null;
        function phoneOk(v){ var d=String(v||'').replace(/\D/g,''); if(cc()==='ET') return /^(0?[79]\d{8}|251[79]\d{8})$/.test(d); if(cc()==='TZ') return /^(0?[67]\d{8}|255[67]\d{8})$/.test(d); return /^(0?[17]\d{8}|254[17]\d{8})$/.test(d); }
        function startPay(){ var W=mm(), ph=($('bl-phone')||{}).value||'';
            if(!phoneOk(ph)){ msg('Enter your '+W.name+' number, like '+W.ex+'.',true); setTimeout(function(){ Nav.setFocus($('bl-phone')); if(kbOpen&&(window.ByoAndroid||window.tizen||window.webapis||!('ontouchstart' in window))) kbOpen(); },30); return; }
            msg('One moment…');
            Supa.rpc('byo_pay_start',{ p_device_key:deviceId(), p_country:cc(), p_plan:plan.code, p_phone:ph },function(err,res){
                if(err||!res){ msg('Could not reach BYO. Check your internet and try again.',true); return; }
                if(!res.ok){ msg(res.error||'Could not start the payment.',true); return; }
                res.started=Date.now(); st.payPhone=ph; st.payReq={ id:res.id, at:Date.now() }; save(); payReq=res; screenVerify(); }); }
        function local(n){ var d=String(n||'').replace(/\D/g,''); if(/^25[145]\d{9}$/.test(d)) d='0'+d.slice(3); return d.length===10?(d.slice(0,4)+' '+d.slice(4,7)+' '+d.slice(7)):d; }
        // "Verifying payment" for up to 5 minutes; then: try again, choose again, or get help.
        var VERIFY_MS=5*60000;
        function screenVerify(){ var c=card(), W=mm(), r=payReq||{}; c.classList.add('bl-pick');
            var amt=r.amount!=null?money(r.currency||W.cur,r.amount):'', to=r.number?local(r.number):'';
            c.innerHTML='<div class="vf"><div class="vf-ring"><span class="bl-spin"></span><b id="vf-t">5:00</b></div><div class="bl-h">Verifying payment</div>'+
                (amt&&to?'<div class="bl-hs">Send <b>'+esc(amt)+'</b> with '+W.name+' to <b>'+esc(to)+'</b>'+(r.name?' ('+esc(r.name)+')':'')+(r.phone?' from <b>'+esc(local(r.phone))+'</b>':'')+'. BYO Player unlocks the moment it arrives.</div>':'<div class="bl-hs">BYO Player unlocks the moment your payment arrives.</div>')+
                '</div><div class="bl-msg hidden"></div><div class="bl-foot"><button class="wz-link" data-a="back" data-focusable="true" tabindex="0">Change plan or number</button></div>';
            c.querySelector('[data-a="back"]').addEventListener('click',function(){ stopPoll(); payReq=null; screenPick(wallEl()._why); });
            setTimeout(function(){ Nav.setFocus(c.querySelector('[data-a="back"]')); },40);
            if(payReq&&!payReq.started) payReq.started=Date.now(); var t0=(payReq&&payReq.started)||Date.now(); stopPoll();
            function tickV(){ var left=Math.max(0, VERIFY_MS-(Date.now()-t0)), m=Math.floor(left/60000), sct=Math.floor(left%60000/1000); var el=$('vf-t'); if(el) el.textContent=m+':'+(sct<10?'0':'')+sct; return left; }
            function check(){ if(!payReq||!payReq.id) return; Supa.rpc('byo_pay_status',{ p_device_key:deviceId(), p_id:payReq.id },function(err,res){ if(err||!res||!res.ok||!payReq) return;
                if(res.status==='paid'){ stopPoll(); st.payReq=null; save(); payReq=null; if(res.access) setAccess(res.access);
                    var shown=false; try{ if(res.access&&typeof Support!=='undefined'&&Support.activated){ closeWall(); Support.activated(res.access); shown=true; try{ paintNav(); refreshBanner(); }catch(_e){} } }catch(e){}
                    if(!shown) paid(res); }
                else if(res.status==='partial'){ stopPoll(); notYet('We received '+money(res.currency,res.paid_amount)+', but the '+res.plan+' plan is '+money(res.currency,res.amount)+'. Contact '+BILLING_CONFIG.supportEmail+' and we will sort it out.'); }
                else if(res.status==='expired'||res.status==='cancelled'){ stopPoll(); st.payReq=null; save(); notYet('This payment request has expired. Choose your plan again.'); } }); }
            tickV(); check(); pollT=setInterval(function(){ var left=tickV(); if(Math.round((Date.now()-t0)/1000)%4===0) check(); if(left<=0){ stopPoll(); check(); setTimeout(function(){ if(payReq&&!locked()) return; if(payReq) notYet(); },1500); } },1000); }
        function notYet(why){ var c=card(), W=mm();
            c.innerHTML='<div class="vf"><div class="bl-lock">'+icon('i-clock')+'</div><div class="bl-h">We haven’t received your payment yet</div>'+
                '<div class="bl-hs">'+esc(why||('It can take a minute for '+W.name+' to confirm. If you have paid, check again. If not, choose your plan again.'))+'</div></div>'+
                '<div class="pk-go vf-acts"></div><div class="bl-msg hidden"></div><div class="bl-help">Still stuck? Email '+esc(BILLING_CONFIG.supportEmail)+' or get remote help.</div>';
            var a=c.querySelector('.vf-acts');
            if(payReq&&!why) a.appendChild(btn('Check again','bl-m '+W.cls,function(){ if(payReq) payReq.started=Date.now(); screenVerify(); }));
            a.appendChild(btn('Choose plan again','bl-m bp-sec',function(){ payReq=null; screenPick(wallEl()._why); }));
            a.appendChild(btn('Get remote help','bl-m bp-sec',function(){ try{ Support.open(); }catch(e){} }));
            focusFirst(); }
        function paid(res){ payReq=null; st.payReq=null; save(); var c=card(); c.classList.remove('bl-pick'); var until=res&&res.until?new Date(res.until):null;
            c.innerHTML='<div class="bl-lock ok">'+icon('i-check')+'</div><div class="bl-h">Payment received</div><div class="bl-hs">Thank you. '+esc((res&&res.plan)||'Your plan')+' is active'+
                (until?(' until '+esc(until.toLocaleString(undefined,{ day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }))):'')+'. Everything is unlocked.</div><div class="bl-methods"></div>';
            c.querySelector('.bl-methods').appendChild(btn('Start watching','bl-m card',function(){ closeWall(); var g=pending||'home'; pending=null; goTo(g); }));
            try{ paintNav(); }catch(e){} refreshBanner(); focusFirst(); }
        function normKE(v){ var d=String(v||'').replace(/\D/g,''); if(/^0[17]\d{8}$/.test(d)) return '254'+d.slice(1); if(/^254[17]\d{8}$/.test(d)) return d; if(/^[17]\d{8}$/.test(d)) return '254'+d; return ''; }

        // Card: hosted checkout opened in the browser, then poll until paid
        function startCard(){ var T=priceTable(); msg('Opening secure card payment…');
            fn('card-checkout',{ device_id:deviceId(), plan_code:plan.code, country:country(), currency:T.currency },function(err,res){
                if(err||!res||!res.ok||!res.checkout_url){ msg(notReady(err,res,'Card'),true); return; }
                try{ if(window.ByoAndroid&&ByoAndroid.openUrl) ByoAndroid.openUrl(res.checkout_url); else window.open(res.checkout_url,'_blank'); }catch(e){}
                waiting('Finish paying in your browser','Complete the card payment, then come back here. This screen updates by itself.'); }); }
        function notReady(err,res,what){ if(err==='http-404'||(res&&res.error==='not_configured')) return what+' payments are being set up. Please try again soon, or contact '+BILLING_CONFIG.supportEmail+'.';
            if(res&&res.error) return String(res.error); return 'Could not start the payment. Check your internet and try again.'; }
        function waiting(t,s){ var c=card(); c.innerHTML='<div class="bl-spin"></div><div class="bl-h">'+esc(t)+'</div><div class="bl-hs">'+esc(s)+'</div><div class="bl-msg hidden"></div>'+
                '<div class="bl-foot"><button class="wz-link" data-a="back" data-focusable="true" tabindex="0">Choose another way</button></div>';
            c.querySelector('[data-a="back"]').addEventListener('click',function(){ stopPoll(); screenPlans(); });
            var n=0; stopPoll(); pollT=setInterval(function(){ n++; status(function(){ if(subActive()){ done(); } }); if(n>60){ stopPoll(); msg('Still waiting for the payment. If you paid, tap "Choose another way" then "I have already paid".',true); } },4000); }
        function stopPoll(){ if(pollT){ clearInterval(pollT); pollT=null; } }
        function done(){ stopPoll(); var c=card(); c.innerHTML='<div class="bl-lock ok">'+icon('i-check')+'</div><div class="bl-h">You are subscribed</div><div class="bl-hs">Thank you. Everything is unlocked.</div><div class="bl-methods"></div>';
            c.querySelector('.bl-methods').appendChild(btn('Start watching','bl-m card',function(){ closeWall(); var g=pending||'home'; pending=null; goTo(g); }));
            try{ Pay.applyLocks(); }catch(e){} refreshBanner(); focusFirst(); }

        return { boot:boot, begin:begin, renderTrialStep:renderTrialStep, allow:allow, canPlay:canPlay, locked:locked, inTrial:inTrial, daysLeft:daysLeft,
                 homeBanner:homeBanner, openWall:openWall, closeWall:closeWall, isWallOpen:function(){ return wallOpen; }, status:status,
                 trialEndsAt:trialEndsAt, subActive:subActive, deviceId:deviceId, sync:sync, addBonusDays:addBonusDays, setAccess:setAccess, access:acc, isBlocked:isBlocked, grantedUntil:grantedUntil, paintNav:paintNav, navOk:function(n){ return navOk(n); }, _st:function(){ return st; } };
    })();
