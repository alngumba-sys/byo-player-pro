    /* ============================================================================
       Plex: sign in with a code (plex.tv/link) or by scanning a QR code, then
       load the movie and TV libraries of every Plex server on the account.
       Plex gives TMDB / IMDb ids, so titles merge cleanly with Emby / Jellyfin.
       ============================================================================ */
    var Plex=(function(){
        function TV(){ return window.__PLEX_TV||'https://plex.tv'; }
        function cid(){ var k='byo_plex_cid'; try{ var v=localStorage.getItem(k); if(!v){ v='byo-'+Date.now().toString(36)+Math.random().toString(36).slice(2,10); localStorage.setItem(k,v); } return v; }catch(e){ return 'byo-player'; } }
        function pq(extra){ return 'X-Plex-Product='+encodeURIComponent('BYO Player')+'&X-Plex-Client-Identifier='+encodeURIComponent(cid())+'&X-Plex-Device-Name='+encodeURIComponent('BYO Player')+'&X-Plex-Platform=Android'+(extra?'&'+extra:''); }
        // JSON request. "Accept" is a simple header, so browsers allow it without extra checks.
        function req(method, url, ok, err){
            var x=new XMLHttpRequest(); try{ x.open(method,url,true); }catch(e){ return err('bad-url'); }
            x.timeout=25000; try{ x.setRequestHeader('Accept','application/json'); }catch(e){}
            x.onreadystatechange=function(){ if(x.readyState!==4) return;
                if(x.status>=200&&x.status<300){ var j=null; try{ j=JSON.parse(x.responseText||'null'); }catch(e){} return j?ok(j):err('bad-reply'); }
                if(x.status===0&&method==='GET'&&window.ByoAndroid&&ByoAndroid.fetchToFileH) return nativeGet(url, ok, err);
                err(x.status===401?'auth':(x.status===0?'neterr':'http-'+x.status)); };
            x.ontimeout=function(){ err('timeout'); }; x.onerror=function(){ };
            x.send(); }
        function nativeGet(url, ok, err){ var id='px'+Date.now().toString(36)+Math.floor(Math.random()*1e6), fired=false;
            var t=setTimeout(function(){ if(fired) return; fired=true; delete window.__byoFetchCbs[id]; err('timeout'); },45000);
            window.__byoFetchCbs[id]=function(st,detail,path){ if(fired) return; fired=true; clearTimeout(t); if(st!=='ok'||!path) return err(detail||'neterr');
                var x=new XMLHttpRequest(); x.open('GET',path,true); x.onload=function(){ var j=null; try{ j=JSON.parse(x.responseText); }catch(e){} j?ok(j):err('bad-reply'); }; x.onerror=function(){ err('read'); }; x.send(); };
            try{ ByoAndroid.fetchToFileH(id, url, JSON.stringify({ 'Accept':'application/json' })); }catch(e){ fired=true; clearTimeout(t); err('neterr'); } }
        function errText(e){ e=String(e||''); if(e==='auth') return 'Plex did not accept the sign-in. Sign in again.'; if(e==='noserver') return 'No Plex server was found on this account, or none of them could be reached.';
            if(e==='expired') return 'The code expired. Start the Plex sign-in again.'; return window.__netErrText?window.__netErrText(e):'Could not reach Plex.'; }

        // ---------- sign in with a code ----------
        function startPin(cb){ req('POST', TV()+'/api/v2/pins?strong=true&'+pq(), function(j){ if(!j||!j.id||!j.code) return cb('bad-reply'); cb(null,{ id:j.id, code:j.code, authUrl:'https://app.plex.tv/auth#?clientID='+encodeURIComponent(cid())+'&code='+encodeURIComponent(j.code)+'&context%5Bdevice%5D%5Bproduct%5D='+encodeURIComponent('BYO Player') }); }, function(e){ cb(e); }); }
        function pollPin(pin, cb){ var t0=Date.now(), stop=false;
            (function tick(){ if(stop) return;
                req('GET', TV()+'/api/v2/pins/'+pin.id+'?'+pq(), function(j){ if(stop) return;
                    if(j&&j.authToken){ stop=true; return account(j.authToken, function(name){ cb(null,{ token:j.authToken, user:name||'Plex account' }); }); }
                    if(Date.now()-t0>15*60000){ stop=true; return cb('expired'); } setTimeout(tick,2000); },
                  function(){ if(stop) return; if(Date.now()-t0>15*60000){ stop=true; return cb('expired'); } setTimeout(tick,3000); }); })();
            return { cancel:function(){ stop=true; } }; }
        function account(token, cb){ req('GET', TV()+'/api/v2/user?'+pq('X-Plex-Token='+encodeURIComponent(token)), function(j){ cb((j&&(j.username||j.title||j.email))||''); }, function(){ cb(''); }); }

        // ---------- servers & libraries ----------
        function servers(token, cb){
            req('GET', TV()+'/api/v2/resources?includeHttps=1&includeRelay=1&'+pq('X-Plex-Token='+encodeURIComponent(token)), function(list){
                var srv=(Array.isArray(list)?list:[]).filter(function(d){ return String(d.provides||'').indexOf('server')>=0; });
                if(!srv.length) return cb('noserver');
                var out=[], left=srv.length;
                srv.forEach(function(d){ pick(d, token, function(conn){ if(conn) out.push(conn); if(--left===0){ out.length?cb(null,out):cb('noserver'); } }); });
            }, function(e){ cb(e); }); }
        // Try the server's addresses: local first, then remote, then Plex relay.
        function pick(d, token, cb){ var tok=d.accessToken||token;
            var cs=(d.connections||[]).slice().sort(function(a,b){ function r(c){ return c.relay?2:(c.local?0:1); } return r(a)-r(b); });
            var i=0; (function next(){ if(i>=cs.length) return cb(null); var c=cs[i++]; var base=String(c.uri||'').replace(/\/+$/,''); if(!base) return next();
                req('GET', base+'/identity?X-Plex-Token='+encodeURIComponent(tok), function(){ cb({ base:base, token:tok, name:d.name||'Plex server', id:d.clientIdentifier||'' }); }, function(){ next(); }); })(); }
        function sections(s, cb){ req('GET', s.base+'/library/sections?X-Plex-Token='+encodeURIComponent(s.token), function(j){ var d=(j&&j.MediaContainer&&j.MediaContainer.Directory)||[]; cb(d.filter(function(x){ return x.type==='movie'||x.type==='show'; })); }, function(){ cb([]); }); }
        function img(s, p){ if(!p) return ''; return s.base+'/photo/:/transcode?width=400&height=600&minSize=1&upscale=1&url='+encodeURIComponent(p)+'&X-Plex-Token='+encodeURIComponent(s.token); }
        function ids(m){ var o={}; (m.Guid||[]).forEach(function(g){ var v=String(g.id||''); var mm=v.match(/^(tmdb|imdb|tvdb):\/\/(.+)$/); if(mm) o[mm[1]]=mm[2]; });
            if(!o.tmdb&&!o.imdb){ var gg=String(m.guid||''); var m2=gg.match(/themoviedb:\/\/(\d+)/); if(m2) o.tmdb=m2[1]; var m3=gg.match(/imdb:\/\/(tt\d+)/); if(m3) o.imdb=m3[1]; } return o; }
        function partUrl(s, m){ var md=(m.Media||[])[0]; var pt=md&&(md.Part||[])[0]; if(!pt||!pt.key) return ''; return s.base+pt.key+'?X-Plex-Token='+encodeURIComponent(s.token)+'&'+pq(); }
        function hlsUrl(s, m){ return s.base+'/video/:/transcode/universal/start.m3u8?path='+encodeURIComponent('/library/metadata/'+m.ratingKey)+'&mediaIndex=0&partIndex=0&protocol=hls&fastSeek=1&directPlay=0&directStream=1&videoQuality=100&maxVideoBitrate=20000&session='+encodeURIComponent(cid()+'-'+m.ratingKey)+'&X-Plex-Token='+encodeURIComponent(s.token)+'&'+pq(); }
        function genreOf(m){ return (m.Genre&&m.Genre[0]&&m.Genre[0].tag)||'Uncategorised'; }
        function rating(m){ var r=m.audienceRating||m.rating; return r?Math.round(r*10)/10:'–'; }
        function loadLib(s, sec, cb){
            req('GET', s.base+'/library/sections/'+sec.key+'/all?type='+(sec.type==='movie'?1:2)+'&includeGuids=1&X-Plex-Token='+encodeURIComponent(s.token), function(j){
                var arr=(j&&j.MediaContainer&&j.MediaContainer.Metadata)||[];
                if(sec.type==='movie') cb(arr.map(function(m,i){ var u=partUrl(s,m), h=hlsUrl(s,m), d=ids(m), ct=((m.Media||[])[0]||{}).container||'';
                    return { id:'movie-px-'+m.ratingKey, title:m.title||'Movie', genre:genreOf(m), year:m.year||'', rating:rating(m), plot:m.summary||'', gi:i, order:i, logo:img(s,m.thumb), url:(/^(mp4|m4v|mov)$/i.test(ct)||(window.ByoAndroid&&ByoAndroid.playNativeAll))?(u||h):h, tmdb:d.tmdb||'', imdb:d.imdb||'', plexKey:m.ratingKey, _plexHls:h }; }));
                else cb(arr.map(function(m,i){ var d=ids(m);
                    return { id:'series-px-'+m.ratingKey, title:m.title||'Series', genre:genreOf(m), year:m.year||'', rating:rating(m), plot:m.summary||'', gi:i, order:i, logo:img(s,m.thumb), seasons:null, plexKey:m.ratingKey, _plex:s, tmdb:d.tmdb||'', imdb:d.imdb||'' }; }));
            }, function(){ cb([]); }); }
        // Whole account: every reachable server, every movie / TV library.
        function loadAll(token, cb){
            servers(token, function(e, list){ if(e) return cb(errText(e));
                var movies=[], series=[], jobs=0, done=0;
                list.forEach(function(s){ jobs++; sections(s, function(secs){
                    secs.forEach(function(sec){ jobs++; loadLib(s, sec, function(items){ (sec.type==='movie'?movies:series).push.apply(sec.type==='movie'?movies:series, items); fin(); }); });
                    fin(); }); });
                function fin(){ if(++done<jobs) return; cb(null,{ movies:movies, series:series, servers:list.map(function(s){ return s.name; }) }); }
            }); }
        // Seasons + episodes for a Plex show (one request: all episodes of the show).
        function seasons(show, cb){ var s=show._plex; if(!s) return cb([]);
            req('GET', s.base+'/library/metadata/'+show.plexKey+'/allLeaves?X-Plex-Token='+encodeURIComponent(s.token), function(j){
                var eps=(j&&j.MediaContainer&&j.MediaContainer.Metadata)||[], by={};
                eps.forEach(function(m){ var sn=m.parentIndex||0; (by[sn]=by[sn]||[]).push({ id:'ep-px-'+m.ratingKey, n:m.index||0, title:m.title||('Episode '+(m.index||'')), desc:m.summary||'', dur:m.duration?Math.round(m.duration/60000)+'m':'', thumb:img(s,m.thumb||m.parentThumb), url:(window.ByoAndroid&&ByoAndroid.playNativeAll)?(partUrl(s,m)||hlsUrl(s,m)):hlsUrl(s,m) }); });
                cb(Object.keys(by).map(function(k){ return { n:+k, episodes:by[k].sort(function(a,b){ return a.n-b.n; }) }; }).sort(function(a,b){ return a.n-b.n; })); }, function(){ cb([]); }); }
        return { startPin:startPin, pollPin:pollPin, loadAll:loadAll, seasons:seasons, errText:errText, cid:cid };
    })();
