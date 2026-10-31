    /* ============================================================================
       Smart paste: one box that understands whatever the user pastes.
       - Xtream links (get.php / player_api.php / a /live/user/pass/123.ts stream)
       - M3U playlist links, including Dropbox / Google Drive / GitHub / Pastebin
         share links (rewritten to the direct file)
       - the playlist TEXT itself (#EXTM3U ...), kept on the device
       - a link to ONE channel (.m3u8 / .ts / .mp4 / .mpd), becomes a one-channel list
       - Emby / Jellyfin server addresses (the server is asked which one it is)
       - MAG / Stalker portal links (recognised; support comes next)
       - compressed .gz playlists are unpacked when loaded
       ============================================================================ */
    var SmartPaste=(function(){
        // ---------- link helpers (also used by the loaders) ----------
        function directLink(u){ u=String(u||'');
            try{
                var m;
                if(/^https?:\/\/(www\.)?dropbox\.com\//i.test(u)){ u=u.replace(/([?&])dl=0/,'$1dl=1'); if(!/[?&](dl|raw)=1/.test(u)) u+=(u.indexOf('?')<0?'?':'&')+'dl=1'; return u; }
                if((m=u.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^\/?#]+)/i))) return 'https://drive.google.com/uc?export=download&id='+m[1];
                if((m=u.match(/^https?:\/\/drive\.google\.com\/open\?id=([^&#]+)/i))) return 'https://drive.google.com/uc?export=download&id='+m[1];
                if((m=u.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/(.+)$/i))) return 'https://raw.githubusercontent.com/'+m[1]+'/'+m[2]+'/'+m[3];
                if((m=u.match(/^https?:\/\/gist\.github\.com\/([^\/]+)\/([0-9a-f]+)\/?$/i))) return 'https://gist.githubusercontent.com/'+m[1]+'/'+m[2]+'/raw';
                if((m=u.match(/^https?:\/\/(www\.)?pastebin\.com\/(?!raw\/)([A-Za-z0-9]+)\/?$/i))) return 'https://pastebin.com/raw/'+m[2];
                if((m=u.match(/^https?:\/\/(www\.)?paste\.ee\/p\/([A-Za-z0-9]+)/i))) return 'https://paste.ee/r/'+m[2];
            }catch(e){}
            return u; }
        function nameFromUrl(u){ try{ var p=new URL(u); var segs=p.pathname.split('/').filter(Boolean).map(function(x){ try{ return decodeURIComponent(x); }catch(e){ return x; } });
            var GEN=/^(index|playlist|master|chunklist|stream|streams|live|mono|hls|dash|tracks-v1a1|video|output|out|v1|1080p?|720p?|480p?)$/i;
            for(var i=segs.length-1;i>=0;i--){ var sg=segs[i].replace(/\.(m3u8?|ts|mp4|mkv|mpd|flv|avi|mov|webm)$/i,'').replace(/[_+]+/g,' ').replace(/-/g,' ').trim(); if(sg&&!GEN.test(sg)&&!/^\d+$/.test(sg)) return sg.replace(/\b\w/g,function(c){ return c.toUpperCase(); }); }
            return p.host; }catch(e){ return 'My channel'; } }
        // Pasted playlist text lives on this device; the playlist "link" is pasted://<id>.
        function savePasted(text, name){ var id='p'+Date.now().toString(36)+Math.floor(Math.random()*1e4);
            try{ localStorage.setItem('byo_pasted_'+id, text); }catch(e){ return null; }
            try{ var idx=JSON.parse(localStorage.getItem('byo_pasted_idx')||'{}'); idx[id]={name:name||'Pasted playlist', at:Date.now()}; localStorage.setItem('byo_pasted_idx',JSON.stringify(idx)); }catch(e){}
            return 'pasted://'+id; }
        function readPasted(url){ var id=String(url).replace(/^pasted:\/\//,''); try{ return localStorage.getItem('byo_pasted_'+id); }catch(e){ return null; } }
        function singleChannelText(url, name){ return '#EXTM3U\n#EXTINF:-1 group-title="My channels",'+(name||nameFromUrl(url))+'\n'+url+'\n'; }
        function isHls(t){ var h=String(t||'').slice(0,6000); return /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|VERSION|INDEPENDENT-SEGMENTS)/.test(h); }

        // ---------- detection ----------
        var STREAM_EXT=/\.(m3u8|ts|mp4|mkv|mpd|flv|avi|mov|webm)(\?|$)/i;
        function detect(raw){
            var txt=String(raw||'');
            var t=txt.replace(/^[\s\u200b\ufeff]+|[\s\u200b\ufeff]+$/g,'');
            if(!t) return { kind:'empty' };
            // 1) The playlist text itself
            if(/^#EXTM3U/i.test(t) || /#EXTINF[^\n]*\n\s*\S+/i.test(t)){
                if(isHls(t)&&!/#EXTINF[^\n]*\n\s*https?:/i.test(t)) return { kind:'unknown', note:'This looks like part of a single video stream, not a channel list. Paste the link to the stream instead.' };
                var n=(t.match(/#EXTINF/gi)||[]).length; return { kind:'m3utext', text:t, count:n, label:'Playlist text with '+n+' entr'+(n===1?'y':'ies') }; }
            // 2) MAG / Stalker portal (often pasted together with a MAC address)
            var mac=(t.match(/\b([0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i)||[])[0]||'';
            var url=window.__cleanUrl?window.__cleanUrl(t):t;
            if(mac || /\/stalker_portal\b|\/portal\.php\b|\/c\/?(index\.html)?(\?|$)|\/server\/load\.php/i.test(url)){
                return { kind:'stalker', url:url, mac:mac.toUpperCase().replace(/-/g,':'), label:'MAG / Stalker portal'+(mac?' with MAC '+mac.toUpperCase():'') }; }
            if(!/^https?:\/\//i.test(url)) return { kind:'unknown', note:'That does not look like a link or a playlist. Copy the link from your provider again.' };
            url=directLink(url);
            var u; try{ u=new URL(url); }catch(e){ return { kind:'unknown', note:'That link is not valid. Copy it again and paste it here.' }; }
            var base=u.protocol+'//'+u.host, path=u.pathname||'/';
            // 3) Xtream: get.php / player_api.php with username + password
            var sx=window.__splitXtream&&window.__splitXtream(url);
            if(sx&&/\/(get|player_api)\.php/i.test(path)) return { kind:'xtream', server:sx.server, user:sx.user, pass:sx.pass, m3u:/get\.php/i.test(path)?url:'', label:'Xtream account '+sx.user+' at '+u.host };
            // 4) Xtream stream link: /live|movie|series/<user>/<pass>/<id>.<ext> (also gives the account)
            var xm=path.match(/^\/(live|movie|series|timeshift)\/([^\/]+)\/([^\/]+)\/[^\/]+$/i);
            if(xm) return { kind:'xtream', server:base, user:decodeURIComponent(xm[2]), pass:decodeURIComponent(xm[3]), single:url, label:'Xtream account '+decodeURIComponent(xm[2])+' at '+u.host, note:'This was a link to one stream. Connecting the whole account gives you all its channels, movies and series.' };
            // 5) Emby / Jellyfin web address
            var emHint=/\/web\/|\/emby(\/|$)|\/jellyfin(\/|$)/i.test(path)||/jellyfin|emby/i.test(u.host)||u.port==='8096'||u.port==='8920';
            // 6) One channel / one video
            if(STREAM_EXT.test(path)&&!/\.m3u(\?|$)/i.test(path)&&!/playlist|channels|tv|list|iptv/i.test(path.split('/').pop().replace(STREAM_EXT,'')))
                return { kind:'single', url:url, name:nameFromUrl(url), label:'A single channel: '+nameFromUrl(url), note:'If this is actually a full playlist it will still load as one.' };
            if(emHint) return { kind:'server', url:base+path.replace(/\/web\/.*$/i,'').replace(/\/(index\.html)?$/i,''), label:'Media server at '+u.host };
            // 7) A bare server address (no path, no query): Emby/Jellyfin or an Xtream server
            if((path==='/'||path==='')&&!u.search) return { kind:'server', url:base, label:'Server at '+u.host, bare:true };
            // 8) Anything else is a playlist link
            return { kind:'m3u', url:url, label:'Playlist link at '+u.host+(url!==(window.__cleanUrl?window.__cleanUrl(t):t)?' (share link converted to the direct file)':'') };
        }
        // Ask a server whether it is Emby or Jellyfin.
        function probeServer(base, cb){
            var tries=[base.replace(/\/+$/,''), base.replace(/\/+$/,'')+'/emby', base.replace(/\/+$/,'')+'/jellyfin'], i=0, done=false;
            (function next(){ if(i>=tries.length){ if(!done){ done=true; cb(null); } return; } var b=tries[i++];
                Net.fetchText(b+'/System/Info/Public', function(txt){ var j=null; try{ j=JSON.parse(txt); }catch(e){}
                    if(j&&(j.Id||j.ServerName||j.Version)){ done=true; cb({ kind:/jellyfin/i.test(j.ProductName||'')?'jellyfin':'emby', base:b, name:j.ServerName||'' }); }
                    else next(); }, function(){ next(); }, false); })(); }

        // ---------- loader support: pasted://, single streams, .gz ----------
        function install(){ if(Net.__spWrapped) return; Net.__spWrapped=true;
            var orig=Net.fetchText;
            Net.fetchText=function(url, ok, err, tp){
                url=String(url||'');
                if(/^pasted:\/\//.test(url)){ var t=readPasted(url); if(t) return ok(t); return err('This pasted playlist is no longer on this device. Paste it again.'); }
                if(/\.gz(\?|$)/i.test(url)&&window.fetch&&window.DecompressionStream){
                    fetch(url).then(function(r){ if(!r.ok) throw new Error('http-'+r.status); return r.body.pipeThrough(new DecompressionStream('gzip')); })
                      .then(function(s){ return new Response(s).text(); }).then(function(t){ ok(t); })
                      .catch(function(){ orig.call(Net, url, ok, err, tp); });
                    return; }
                orig.call(Net, url, function(body){
                    // A link to ONE stream (HLS): turn it into a one-channel playlist instead of failing.
                    if(body&&isHls(body)&&!/#EXTINF[^\n]*\n\s*https?:\/\//i.test(body)) body=singleChannelText(url);
                    ok(body); }, err, tp); };
        }

        // ---------- UI: the "Paste anything" box on Settings > Connection ----------
        var last=null;
        function ui(){ var or=document.querySelector('.set-page[data-page="connection"] .conn-or'); if(!or||$('sp-box')) return;
            var box=document.createElement('div'); box.id='sp-box'; box.className='sp-box';
            box.innerHTML='<div class="sp-h">Paste anything</div><div class="sp-s">A playlist link, an Xtream link, an Emby or Jellyfin address, or the playlist text. We will work out the rest.</div>'+
                '<div class="sp-row"><textarea id="sp-in" rows="1" placeholder="Paste here" autocapitalize="off" autocorrect="off" spellcheck="false" data-focusable="true" tabindex="0"></textarea>'+
                '<button class="s-btn sp-paste" id="sp-paste" data-focusable="true" tabindex="0">Paste</button></div><div class="sp-out" id="sp-out"></div>';
            or.parentNode.insertBefore(box, or);
            var inp=$('sp-in');
            inp.addEventListener('input',function(){ clearTimeout(inp.__t); inp.__t=setTimeout(function(){ analyse(inp.value); },250); });
            inp.addEventListener('paste',function(){ setTimeout(function(){ analyse(inp.value); },30); });
            $('sp-paste').addEventListener('click',function(){ var txt=''; try{ if(window.ByoAndroid&&ByoAndroid.getClipboard) txt=ByoAndroid.getClipboard()||''; }catch(e){}
                function put(v){ if(!v){ setToast('Clipboard is empty. Copy the link first.'); return; } inp.value=v; analyse(v); }
                if(txt) return put(txt);
                try{ if(navigator.clipboard&&navigator.clipboard.readText){ navigator.clipboard.readText().then(put,function(){ put(''); }); return; } }catch(e){} put(''); }); }
        function out(kind, title, sub, actions){ var o=$('sp-out'); if(!o) return;
            o.className='sp-out sp-'+kind; o.innerHTML=title?('<div class="sp-t">'+esc(title)+'</div>'+(sub?'<div class="sp-u">'+esc(sub)+'</div>':'')):'';
            (actions||[]).forEach(function(a){ var b=document.createElement('button'); b.className='s-btn'+(a.primary?' primary':''); b.setAttribute('data-focusable','true'); b.tabIndex=0; b.textContent=a.label; b.addEventListener('click',a.fn); o.appendChild(b); }); }
        function fillXtream(d){ setMode('xtream'); $('x-server').value=d.server; $('x-user').value=d.user||''; $('x-pass').value=d.pass||''; }
        function fillM3u(url){ setMode('m3u'); $('m-url').value=url; }
        function fillEmby(kind, base){ setMode(kind); var es=$('e-server'); if(es) es.value=base; }
        function go(){ try{ connect(); }catch(e){} }
        function analyse(v){ var d=detect(v); last=d;
            if(d.kind==='empty') return out('none','');
            if(d.kind==='xtream'){ fillXtream(d); return out('ok','Found: '+d.label, d.note||'The details are filled in below.', [{label:'Connect',primary:true,fn:go}]); }
            if(d.kind==='m3u'){ fillM3u(d.url); return out('ok','Found: '+d.label, 'Filled in below as an M3U playlist.', [{label:'Connect',primary:true,fn:go}]); }
            if(d.kind==='m3utext'){ out('ok','Found: '+d.label, 'It will be kept on this device.', [{label:'Use this playlist',primary:true,fn:function(){ var link=savePasted(d.text,'Pasted playlist'); if(!link){ out('bad','This playlist is too big to keep on the device.','Paste the link to it instead.'); return; } fillM3u(link); go(); }}]); return; }
            if(d.kind==='single'){ return out('ok','Found: '+d.label, d.note, [{label:'Add this channel',primary:true,fn:function(){ var link=savePasted(singleChannelText(d.url,d.name), d.name); fillM3u(link); go(); }}]); }
            if(d.kind==='stalker'){ setMode('stalker'); $('k-portal').value=d.url.replace(/\s.*$/,''); if(d.mac) $('k-mac').value=d.mac;
                return out('ok','Found: '+d.label, d.mac?'Filled in below.':'Enter the MAC address your provider activated, below.', d.mac?[{label:'Connect',primary:true,fn:go}]:[{label:'Enter MAC address',primary:true,fn:function(){ var km=$('k-mac'); if(km){ km.focus(); try{ Nav.setFocus(km); }catch(e){} } }}]); }
            if(d.kind==='server'){ out('info','Checking '+d.label+'…','');
                probeServer(d.url,function(r){ if(last!==d) return;
                    if(r){ fillEmby(r.kind, r.base); out('ok','Found: '+(r.kind==='jellyfin'?'Jellyfin':'Emby')+' server'+(r.name?' "'+r.name+'"':''), 'Enter your username and password below, then connect.', [{label:'Enter username',primary:true,fn:function(){ var eu=$('e-user'); if(eu){ eu.focus(); try{ Nav.setFocus(eu); }catch(e){} } }}]); }
                    else if(d.bare){ fillXtream({server:d.url}); out('info','This looks like a provider server address', 'Enter the username and password from your provider below (Xtream Codes).'); }
                    else out('bad','Could not reach this server', 'Check the address, and that the server is switched on.'); }); return; }
            out('bad', d.note||'Could not recognise that', 'Choose the connection type below and enter the details.'); }

        // Upgrade an Xtream get.php link typed into the M3U box to a full Xtream connection
        // (proper movie and series pages, posters, TV guide). Falls back to M3U if the API refuses.
        function maybeUpgrade(url, proceed){
            var sx=window.__splitXtream&&window.__splitXtream(url);
            if(!sx||!/\/get\.php/i.test(url)) return proceed();
            var api=xtreamApi(sx.server,sx.user,sx.pass);
            Net.fetchJSON(api.liveStreams.replace(/&action=[^&]*/,''), function(j){
                if(j&&j.user_info&&String(j.user_info.auth)==='1'){ fillXtream(sx); setStatus('This is an Xtream account, so it was connected as one for full movie and series details.','info'); go(); }
                else proceed(); }, function(){ proceed(); }); }

        return { detect:detect, directLink:directLink, install:install, ui:ui, probeServer:probeServer, maybeUpgrade:maybeUpgrade, savePasted:savePasted, isHls:isHls };
    })();
    SmartPaste.install();
    window.__directLink=SmartPaste.directLink; window.__detectSource=SmartPaste.detect;
