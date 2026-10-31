    /* ============================================================================
       MAG / Stalker (Ministra) portals: portal link + MAC address.
       Speaks the portal API the way a MAG box does (set-top-box User-Agent, mac
       cookie, bearer token). On Android the requests go through the native
       downloader so those headers can be sent; elsewhere a plain request is tried.
       Live channels are loaded; each channel gets a short-lived play link from the
       portal ("create_link") at the moment it is played.
       ============================================================================ */
    var Stalker=(function(){
        var UA='Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
        var SESS={};   // key -> session
        function normMac(m){ m=String(m||'').trim().toUpperCase().replace(/[^0-9A-F]/g,''); if(m.length!==12) return ''; return m.match(/.{2}/g).join(':'); }
        function keyOf(portal, mac){ return String(portal||'').replace(/\/+$/,'').toLowerCase()+'|'+normMac(mac); }
        function candidates(portal){ var u; try{ u=new URL(window.__cleanUrl?window.__cleanUrl(portal):portal); }catch(e){ return []; }
            var o=u.protocol+'//'+u.host, p=u.pathname.replace(/index\.html?$/i,'');
            var list=[];
            if(/load\.php$|portal\.php$/i.test(p)) list.push(o+p);
            if(/stalker_portal/i.test(p)) list.push(o+p.replace(/stalker_portal\/.*$/i,'stalker_portal/')+'server/load.php');
            if(/\/c\/?$/i.test(p)){ var root=p.replace(/c\/?$/i,''); list.push(o+root+'portal.php'); list.push(o+root+'server/load.php'); list.push(o+root+'stalker_portal/server/load.php'); }
            list.push(o+'/portal.php'); list.push(o+'/stalker_portal/server/load.php'); list.push(o+'/c/portal.php');
            return list.filter(function(x,i){ return list.indexOf(x)===i; }); }
        function referer(portal){ try{ var u=new URL(portal); var p=u.pathname; if(!/\/c\/?$/.test(p)) p=(/stalker_portal/i.test(p)?p.replace(/stalker_portal\/.*$/i,'stalker_portal/'):'/')+'c/'; return u.protocol+'//'+u.host+p.replace(/\/?$/,'/'); }catch(e){ return portal; } }
        function headers(s){ var h={ 'User-Agent':UA, 'X-User-Agent':'Model: MAG250; Link: WiFi', 'Referer':s.referer, 'Accept':'*/*',
                'Cookie':'mac='+encodeURIComponent(s.mac)+'; stb_lang=en; timezone='+encodeURIComponent(s.tz||'Europe/London') };
            if(s.token) h['Authorization']='Bearer '+s.token; return h; }
        function qs(o){ return Object.keys(o).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(o[k]==null?'':o[k]); }).join('&'); }
        // One portal request -> parsed "js" payload.
        function get(s, api, params, ok, err){
            var url=api+'?'+qs(params)+'&JsHttpRequest=1-xml';
            function parse(txt){ var j=null; try{ j=JSON.parse(txt); }catch(e){}
                if(!j){ return err(/<html|<!doctype/i.test(String(txt||''))?'not-portal':'bad-reply'); }
                ok(j.js!==undefined?j.js:j, j); }
            if(window.ByoAndroid&&ByoAndroid.fetchToFileH){
                var id='s'+Date.now().toString(36)+Math.floor(Math.random()*1e6), fired=false;
                var t=setTimeout(function(){ if(fired) return; fired=true; delete window.__byoFetchCbs[id]; err('timeout'); },45000);
                window.__byoFetchCbs[id]=function(st,detail,path){ if(fired) return; fired=true; clearTimeout(t);
                    if(st!=='ok'||!path) return err(detail||'neterr');
                    var x=new XMLHttpRequest(); x.open('GET',path,true); x.onload=function(){ parse(x.responseText); }; x.onerror=function(){ err('read'); }; x.send(); };
                try{ ByoAndroid.fetchToFileH(id, url, JSON.stringify(headers(s))); }catch(e){ fired=true; clearTimeout(t); err('neterr'); }
                return; }
            // Browser / TV web view: headers like Cookie and User-Agent cannot be set; send what we can.
            var x=new XMLHttpRequest(); try{ x.open('GET', url+'&mac='+encodeURIComponent(s.mac), true); }catch(e){ return err('bad-url'); }
            x.timeout=30000; if(s.token) try{ x.setRequestHeader('Authorization','Bearer '+s.token); }catch(e){}
            x.onreadystatechange=function(){ if(x.readyState!==4) return; if(x.status>=200&&x.status<300) parse(x.responseText); else err('http-'+x.status); };
            x.ontimeout=function(){ err('timeout'); }; x.onerror=function(){ err('neterr'); }; x.send(); }
        function errText(e){ e=String(e||'');
            if(e==='not-portal') return 'That address answered, but it is not a MAG portal. Check the portal link from your provider.';
            if(e==='mac') return 'The portal did not accept this MAC address. Check it with your provider, it must be the one they activated.';
            if(e==='bad-mac') return 'Enter the MAC address from your provider, e.g. 00:1A:79:12:34:56.';
            if(e==='blocked') return 'The portal refused this device. Your provider may need to activate this MAC address.';
            return window.__netErrText?window.__netErrText(e):'Could not reach the portal.'; }
        // Handshake (+ profile) with the first API path that answers.
        function open(portal, mac, cb){
            var m=normMac(mac); if(!m) return cb(errText('bad-mac'));
            var s={ portal:portal, mac:m, referer:referer(portal), token:'', api:'', tz:(function(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London'; }catch(e){ return 'Europe/London'; } })() };
            var list=candidates(portal), i=0, lastErr='neterr';
            (function next(){ if(i>=list.length) return cb(errText(lastErr));
                var api=list[i++];
                get(s, api, { type:'stb', action:'handshake', token:'', prehash:'' }, function(js){
                    var tok=js&&js.token; if(!tok){ lastErr='not-portal'; return next(); }
                    s.api=api; s.token=tok;
                    get(s, api, { type:'stb', action:'get_profile', hd:1, ver:'ImageDescription: 0.2.18-r23-250; ImageDate: Thu Sep 13 11:31:16 EEST 2018; PORTAL version: 5.6.2; API Version: JS API version: 343; STB API version: 146; Player Engine version: 0x58c',
                            num_banks:2, stb_type:'MAG250', image_version:218, video_out:'hdmi', auth_second_step:1, hw_version:'1.7-BD-00', not_valid_token:0, client_type:'STB', timestamp:Math.floor(Date.now()/1000) },
                        function(p){ if(p&&p.block_msg) return cb(p.block_msg);
                            SESS[keyOf(portal,m)]=s; cb(null,s); },
                        function(){ SESS[keyOf(portal,m)]=s; cb(null,s); });   // some portals do not need the profile call
                }, function(e){ lastErr=e; next(); }); })(); }
        function absLogo(s, l){ l=String(l||''); if(!l) return ''; if(/^https?:\/\//i.test(l)) return l;
            try{ var u=new URL(s.api); var root=u.pathname.replace(/server\/load\.php$|portal\.php$/i,''); return u.protocol+'//'+u.host+root+(root.indexOf('stalker_portal')>=0?'':'stalker_portal/')+'misc/logos/320/'+l; }catch(e){ return ''; } }
        // Live channels for a session.
        function live(s, cb){
            get(s, s.api, { type:'itv', action:'get_genres' }, function(gj){
                var G={}; (Array.isArray(gj)?gj:[]).forEach(function(g){ if(g&&g.id!=null) G[String(g.id)]=g.title||g.alias||'Live'; });
                get(s, s.api, { type:'itv', action:'get_all_channels' }, function(cj){
                    var arr=(cj&&cj.data)||(Array.isArray(cj)?cj:[]);
                    if(!arr.length) return cb(errText('mac'));
                    var key=keyOf(s.portal,s.mac);
                    cb(null, arr.map(function(c,i){ var cmd=String(c.cmd||'');
                        return { id:'live-stk-'+(c.id||i), name:c.name||('Channel '+(c.number||i+1)), genre:G[String(c.tv_genre_id)]||'Live TV', logo:absLogo(s,c.logo), url:'stalker://'+encodeURIComponent(key)+'#'+encodeURIComponent(cmd), number:c.number, epgGenre:null, order:i, desc:'Channel from your MAG portal.' }; }));
                }, function(e){ cb(errText(e)); });
            }, function(e){ cb(errText(e)); }); }
        function isStalker(u){ return /^stalker:\/\//.test(String(u||'')); }
        // Turn a stalker:// channel link into a playable link (fresh play token), re-signing in once if needed.
        function resolve(u, cb){
            var m=String(u).match(/^stalker:\/\/([^#]+)#(.*)$/); if(!m) return cb('Bad channel link.');
            var key=decodeURIComponent(m[1]), cmd=decodeURIComponent(m[2]); var s=SESS[key];
            function doLink(s, retried){
                get(s, s.api, { type:'itv', action:'create_link', cmd:cmd, series:'', forced_storage:'undefined', disable_ad:0, download:0 }, function(js){
                    var c=String((js&&js.cmd)||'').replace(/^(ffmpeg|ffrt\d*|auto)\s+/i,'').trim();
                    if(!/^https?:\/\//i.test(c)){ var direct=cmd.replace(/^(ffmpeg|ffrt\d*|auto)\s+/i,'').trim(); if(/^https?:\/\//i.test(direct)&&!/localhost/i.test(direct)) c=direct; }
                    if(!/^https?:\/\//i.test(c)){ if(!retried) return reopen(); return cb('The portal did not give a link for this channel.'); }
                    try{ StreamOpts.reg(c, { headers:{ 'User-Agent':UA, 'Cookie':'mac='+encodeURIComponent(s.mac)+'; stb_lang=en', 'Referer':s.referer } }); }catch(e){}
                    cb(null, c); }, function(e){ if(!retried) return reopen(); cb(errText(e)); }); }
            function reopen(){ var p=key.split('|'); var saved=null; (Store.savedPlaylists||[]).forEach(function(x){ if(x.mode==='stalker'&&keyOf(x.server,x.user)===key) saved=x; });
                open(saved?saved.server:p[0], saved?saved.user:p[1], function(err,ns){ if(err) return cb(err); doLink(ns,true); }); }
            if(!s) return reopen();
            doLink(s,false); }
        return { open:open, live:live, resolve:resolve, isStalker:isStalker, normMac:normMac, keyOf:keyOf, UA:UA };
    })();
