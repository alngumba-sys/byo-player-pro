    /* ============================================================================
       Multi-connection library. When "Combine connections" is on, every saved
       connection that is switched on (M3U, Xtream, Emby, Jellyfin) is loaded and
       merged into one Live / Movies / Series library:
       - the same movie or series from two sources shows ONCE (TMDB / IMDb id,
         else cleaned title + year), the same live channel shows once (tvg-id,
         else cleaned channel name);
       - the copy from the highest connection in the list is the one that plays,
         the other copies are kept as backups for automatic failover;
       - a series that exists on two sources shows every season and episode from
         both, without repeats;
       - each item remembers its own source so playback, seasons and episodes
         are always fetched from the right server.
       ============================================================================ */
    // Xtream category names: { live:{id:name}, vod:{...}, series:{...} } (empty maps on failure, never blocks for long)
    function xtreamCats(api, cb){ var maps={live:{},vod:{},series:{}}, left=3, fired=false;
        var t=setTimeout(function(){ if(!fired){ fired=true; cb(maps); } }, 20000);
        [['live','get_live_categories'],['vod','get_vod_categories'],['series','get_series_categories']].forEach(function(k){
            Net.fetchJSON(api.cats(k[1]), function(arr){ if(Array.isArray(arr)) arr.forEach(function(c){ if(c&&c.category_id!=null&&c.category_name) maps[k[0]][String(c.category_id)]=String(c.category_name).trim(); }); fin(); }, function(){ fin(); }); });
        function fin(){ if(--left===0&&!fired){ fired=true; clearTimeout(t); cb(maps); } } }
    function catApply(list, m){ var n=0; if(!list||!m) return 0; for(var i=0;i<list.length;i++){ var it=list[i], g=String(it.genre||''), mm=g.match(/^Cat (.+)$/); if(mm&&m[mm[1]]){ it.genre=m[mm[1]]; n++; } } return n; }
    window.__byoXtreamCats=function(api, done){ xtreamCats(api, function(m){ var n=catApply(S.live,m.live)+catApply(S.movies,m.vod)+catApply(S.series,m.series); done&&done(n); }); };
    var Multi=(function(){
        var REG={};                 // emby/jellyfin item id -> api of the server it belongs to
        var report=[];              // last load result per source
        var loading=false, tok=0;
        function st(){ return Store.settings||(Store.settings={}); }
        function on(){ return !!st().combineSources; }
        function keyOf(pl){ return pl.mode+'|'+(pl.mode==='m3u'?(pl.url||''):((pl.server||'')+'|'+(pl.user||''))); }
        function included(){ return (Store.savedPlaylists||[]).filter(function(p){ return !p.off; }); }
        function plName(pl){ if(pl.mode==='plex'&&!pl.name) return 'Plex: '+(pl.user||'account'); if(pl.mode==='stalker'&&!pl.name){ try{ return 'MAG portal: '+new URL(pl.server).host; }catch(e){ return 'MAG portal'; } } return pl.name||(pl.mode==='xtream'?'Xtream: '+(pl.user||''):(isEmbyMode(pl.mode)?embyLabel(pl.mode)+': '+(pl.user||''):'M3U playlist')); }
        function kindOf(pl){ return isEmbyMode(pl.mode)?'emby':(pl.mode==='xtream'?'xtream':(pl.mode==='stalker'?'stalker':(pl.mode==='plex'?'plex':'m3u'))); }
        function reg(id){ return REG[id]||null; }
        function n(x){ return (x||0).toLocaleString(); }

        // ---------- saved copy of the library: instant start, quiet refresh ----------
        // After a full load the library is kept on the TV (IndexedDB). On the next launch it is shown
        // straight away; it is only downloaded again when the copy is more than 6 hours old, and then
        // quietly in the background, swapped in when you are not in the middle of browsing.
        var SNAP_MAX_AGE=6*3600e3, lastKeyAt=0;
        try{ document.addEventListener('keydown',function(){ lastKeyAt=Date.now(); },true); document.addEventListener('pointerdown',function(){ lastKeyAt=Date.now(); },true); }catch(_e){}
        var Snap={
            open:function(cb){ try{ if(!window.indexedDB) return cb(null); var r=indexedDB.open('byo_lib',1); r.onupgradeneeded=function(){ try{ r.result.createObjectStore('snap'); }catch(_e){} }; r.onsuccess=function(){ cb(r.result); }; r.onerror=function(){ cb(null); }; r.onblocked=function(){ cb(null); }; }catch(e){ cb(null); } },
            put:function(v,cb){ Snap.open(function(db){ if(!db) return cb&&cb(false); try{ var tx=db.transaction('snap','readwrite'); tx.objectStore('snap').put(v,'lib'); tx.oncomplete=function(){ try{ db.close(); }catch(_e){} cb&&cb(true); }; tx.onerror=tx.onabort=function(){ try{ db.close(); }catch(_e){} cb&&cb(false); }; }catch(e){ cb&&cb(false); } }); },
            get:function(cb){ Snap.open(function(db){ if(!db) return cb(null); try{ var rq=db.transaction('snap','readonly').objectStore('snap').get('lib'); rq.onsuccess=function(){ try{ db.close(); }catch(_e){} cb(rq.result||null); }; rq.onerror=function(){ try{ db.close(); }catch(_e){} cb(null); }; }catch(e){ cb(null); } }); } };
        function snapOk(pl){ return pl&&(pl.mode==='m3u'||pl.mode==='xtream'); }   // sources whose items play straight from the saved copy
        function libSig(list){ return (on()?'C:':'S:')+list.map(keyOf).join('\n'); }
        function bootList(){ if(on()) return included(); var c=Store.cfg||{}; if(!c.mode||c.mode==='multi') return [];
            return [{mode:c.mode,url:c.url,epg:c.epg,server:c.server,user:c.user,pass:c.pass,name:c.name}]; }
        function libFingerprint(a){ a=a||[]; var h=a.length+'|', step=Math.max(1,Math.floor(a.length/200));
            for(var i=0;i<a.length;i+=step){ var x=a[i]; h+=(x.id||'')+(x.url||'')+(x.title||x.name||'')+'|'; } return h; }
        // Launch diagnostics (shown in Settings > About as "Library:") -- says whether the saved copy
        // was used, how long it took to read, or why it was downloaded again instead.
        function libLog(msg){ try{ var t=new Date(); function p2(n){ return (n<10?'0':'')+n; } (S._libLog=S._libLog||[]).push(p2(t.getHours())+':'+p2(t.getMinutes())+':'+p2(t.getSeconds())+' '+msg); if(S._libLog.length>10) S._libLog.shift(); }catch(e){} }
        function saveSnap(list){ if(!list.length||!list.some(snapOk)) return;
            setTimeout(function(){ try{
                var lib=pendingSwap||S; var t0=Date.now(); var json=JSON.stringify({live:lib.live,movies:lib.movies,series:lib.series}, function(k,v){
                    if(k==='_src') return (v&&v.key)?v.key:undefined;
                    if(k.length>1&&k.charAt(0)==='_'&&k.charAt(1)==='_') return undefined;     // per-session caches
                    if(k==='_mergedSeasons'||k==='_bdTried'||k==='_bd') return undefined;
                    return v; });
                var mb=(json.length/1048576).toFixed(1);
                Snap.put({ v:1, sig:libSig(list), at:Date.now(), json:json }, function(ok){ libLog(ok?('saved copy '+mb+' MB in '+(Date.now()-t0)+'ms'):('saving copy FAILED ('+mb+' MB)')); });
            }catch(e){ libLog('saving copy threw '+(e&&e.message||e)); } }, 4000); }
        function srcMapFor(list){ var m={}; list.forEach(function(pl,i){ var k=keyOf(pl), sc={ idx:i, key:k, name:plName(pl), kind:kindOf(pl), api:null };
            if(pl.mode==='xtream'){ try{ sc.api=xtreamApi(pl.server,pl.user,pl.pass); }catch(_e){} } m[k]=sc; }); return m; }
        function revive(d, list){ var m=srcMapFor(list);
            function fix(it){ if(!it) return; if(typeof it._src==='string') it._src=m[it._src]; (it._alts||[]).forEach(fix); (it.seasons||[]).forEach(function(se){ (se&&se.episodes||[]).forEach(fix); }); }
            d.live.forEach(fix); d.movies.forEach(fix); d.series.forEach(fix);
            var fx=null; list.forEach(function(pl){ if(pl.mode==='xtream'&&!fx){ var sc=m[keyOf(pl)]; fx=sc&&sc.api; } }); return fx; }
        // Fresh data from a background refresh: swap it in only when it changed, and only when the viewer is
        // not mid-browse (watching something, in Settings, or no button pressed for 15 s).
        var pendingSwap=null, swapT=null;
        function trySwap(){ clearTimeout(swapT); if(!pendingSwap) return;
            var av=document.querySelector('.view.active-view'), id=av?av.id:'';
            var busy=Date.now()-lastKeyAt<15000 && !/view-(player|settings|mvplay)/.test(id);
            if(busy){ swapT=setTimeout(trySwap,5000); return; }
            var p=pendingSwap; pendingSwap=null;
            S.live=p.live; S.movies=p.movies; S.series=p.series; S.replay=[]; S.emby=p.emby; S.xtream=p.xtream;
            try{ renderAll(); }catch(_e){} try{ window.__byoLibTick&&window.__byoLibTick(); }catch(_e){} }

        // ---------- title matching ----------
        function normTitle(t){ t=String(t||'').replace(/^\s*(\[[A-Z]{2,3}\]|\|[A-Z]{2,3}\||[A-Z]{2,3}\s*[|\-]\s+)\s*/,'').toLowerCase();   // "EN | ", "[EN]", "|EN|", "FR - "
            t=t.replace(/\((19|20)\d\d\)|\[(19|20)\d\d\]/g,' ');
            t=t.replace(/\b(4k|uhd|hdr|fhd|hd|sd|1080p?|720p?|480p?|multi[- ]?sub|multi|vostfr|dubbed|subbed|x26[45]|hevc)\b/g,' ');
            t=t.replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/^the /,'').trim();
            return t; }
        function yearOf(it){ var y=String(it.year||'').match(/(19|20)\d\d/); if(y) return y[0];
            var m=String(it.title||'').match(/[\(\[]((19|20)\d\d)[\)\]]/); return m?m[1]:''; }

        // ---------- loading one source ----------
        function tagItems(arr, idx, src){ arr.forEach(function(it){ if(idx) it.id=String(it.id)+'~'+idx; it._src=src; }); return arr; }
        function loadOne(pl, idx, cb){
            var src={ idx:idx, key:keyOf(pl), name:plName(pl), kind:kindOf(pl), api:null };
            var out={ ok:false, src:src, live:[], movies:[], series:[], err:'' };
            var finished=false; function fin(){ if(finished) return; finished=true; cb(out); }
            var guard=setTimeout(function(){ if(!out.ok&&!out.err) out.err='Timed out'; fin(); }, (pl.mode==='emby'||pl.mode==='jellyfin')?240000:90000);
            function end(){ clearTimeout(guard); fin(); }
            try{
            if(pl.mode==='m3u'){
                Net.fetchText(pl.url,function(txt){
                    if(String(txt).indexOf('#EXTINF')===-1){ out.err='Not an M3U playlist'; return end(); }
                    var cls=Net.classifyM3U(Net.parseM3U(txt));
                    out.live=tagItems(cls.live.map(function(c,i){ c.id='live-'+i; c.order=i; c.epgGenre=null; c.desc='Channel from '+src.name+'.'; return c; }), idx, src);
                    out.movies=tagItems(cls.movies||[], idx, src);
                    out.series=tagItems(cls.series||[], idx, src);
                    if(idx) out.series.forEach(function(s){ (s.seasons||[]).forEach(function(se){ (se.episodes||[]).forEach(function(ep){ ep.id=String(ep.id)+'~'+idx; }); }); });
                    out.ok=true; end();
                },function(err){ out.err=String(err||'Could not load'); end(); });
                return; }
            if(pl.mode==='plex'){
                Plex.loadAll(pl.pass, function(e, r){ if(e){ out.err=e; return end(); }
                    out.movies=tagItems(r.movies, idx, src); out.series=tagItems(r.series, idx, src); out.ok=true; end(); });
                return; }
            if(pl.mode==='stalker'){
                Stalker.open(pl.server, pl.user, function(e1, sess){
                    if(e1){ out.err=e1; return end(); }
                    Stalker.live(sess, function(e2, chans){ if(e2){ out.err=e2; return end(); }
                        out.live=tagItems(chans, idx, src); out.ok=true; end(); }); });
                return; }
            if(pl.mode==='xtream'){
                var api=xtreamApi(pl.server,pl.user,pl.pass); src.api=api; var left=4, okAny=false, xcats=null;
                // Many Xtream servers leave category_name out of the stream lists, so fetch the
                // category lists too and turn "Cat 162" into the provider's real group name.
                xtreamCats(api, function(m){ xcats=m; one(); });
                function one(){ if(--left===0){ if(xcats){ catApply(out.live,xcats.live); catApply(out.movies,xcats.vod); catApply(out.series,xcats.series); } out.ok=okAny; if(!okAny&&!out.err) out.err='The server did not answer'; end(); } }
                Net.fetchJSON(api.liveStreams,function(arr){ if(arr&&!Array.isArray(arr)&&arr.user_info&&String(arr.user_info.auth)==='0') out.err='Wrong username or password'; if(Array.isArray(arr)){ okAny=true; out.live=tagItems(arr.map(function(o,i){ return {id:'live-'+(o.stream_id||i),name:o.name||'Channel',genre:o.category_name||('Cat '+(o.category_id||'')),logo:o.stream_icon||'',url:api.liveUrl(o.stream_id),streamId:o.stream_id,tvgId:o.epg_channel_id||'',epgGenre:null,order:i,desc:'Live channel from '+src.name+'.'}; }), idx, src); } one(); },function(e){ out.err=String(e||''); one(); });
                Net.fetchJSON(api.vodStreams,function(arr){ if(Array.isArray(arr)){ okAny=true; out.movies=tagItems(arr.map(function(o,i){ return {id:'movie-'+(o.stream_id||i),title:o.name||'Movie',genre:o.category_name||('Cat '+(o.category_id||'')),year:(o.year||''),rating:(o.rating||o.rating_5based||'–'),plot:o.plot||o.description||'',gi:i,order:i,streamId:o.stream_id,tmdb:(o.tmdb||o.tmdb_id||''),
                    logo:(o.stream_icon||o.cover||o.cover_big||o.movie_image||''),url:api.vodUrl(o.stream_id,o.container_extension)}; }), idx, src); } one(); },function(){ one(); });
                Net.fetchJSON(api.seriesList,function(arr){ if(Array.isArray(arr)){ okAny=true; out.series=tagItems(arr.map(function(o,i){ return {id:'series-'+(o.series_id||i),title:o.name||'Series',genre:o.category_name||('Cat '+(o.category_id||'')),year:(o.year||o.releaseDate||''),rating:(o.rating||'–'),plot:o.plot||'',gi:i,order:i,seasons:null,seriesId:o.series_id,tmdb:(o.tmdb||o.tmdb_id||''),
                    logo:(o.cover||o.cover_big||o.series_image||'')}; }), idx, src); } one(); },function(){ one(); });
                return; }
            // Emby / Jellyfin
            var eapi=embyApi(pl.server,pl.user,pl.pass); src.api=eapi; var label=embyLabel(pl.mode);
            eapi.authenticate(function(){
                var left2=3;
                function one2(){ if(--left2===0){ out.ok=true; end(); } }
                function firstGenre(it){ return (it.Genres&&it.Genres[0])||'Uncategorised'; }
                function pid(o,k){ var p=o.ProviderIds||{}; return p[k]||p[k.toLowerCase()]||p[k.toUpperCase()]||''; }
                function dedupe(items){ var seen={}, out2=[]; (items||[]).forEach(function(o){ if(!o||!o.Id||seen[o.Id]) return; seen[o.Id]=1; out2.push(o); }); return out2; }
                function img(o){ return (o.ImageTags&&o.ImageTags.Primary)?eapi.imageUrl(o.Id,o.ImageTags.Primary):''; }
                eapi.movies(function(res){ out.movies=tagItems(dedupe(res&&res.Items).map(function(o,i){ REG[o.Id]=eapi; var ct=(o.Container||'').split(',')[0]||'mp4';
                    return {id:'movie-'+o.Id,title:o.Name||'Movie',genre:firstGenre(o),year:(o.ProductionYear||''),rating:(o.CommunityRating?Math.round(o.CommunityRating*10)/10:'–'),plot:o.Overview||'',gi:i,order:i,embyId:o.Id,embyContainer:ct,tmdb:pid(o,'Tmdb'),imdb:pid(o,'Imdb'),
                        logo:img(o), url:eapi.streamUrl(o.Id,ct)}; }), idx, src); one2(); }, function(){ one2(); });
                eapi.series(function(res){ out.series=tagItems(dedupe(res&&res.Items).map(function(o,i){ REG[o.Id]=eapi;
                    return {id:'series-'+o.Id,title:o.Name||'Series',genre:firstGenre(o),year:(o.ProductionYear||''),rating:(o.CommunityRating?Math.round(o.CommunityRating*10)/10:'–'),plot:o.Overview||'',gi:i,order:i,seasons:null,embySeriesId:o.Id,tmdb:pid(o,'Tmdb'),imdb:pid(o,'Imdb'),
                        logo:img(o)}; }), idx, src); one2(); }, function(){ one2(); });
                eapi.liveChannels(function(res){ out.live=tagItems(dedupe(res&&res.Items).map(function(o,i){ REG[o.Id]=eapi;
                    return {id:'live-'+o.Id,name:o.Name||('Channel '+(o.ChannelNumber||i)),genre:(o.ChannelType==='Radio'?'Radio':'Live TV'),logo:img(o),url:eapi.liveUrl(o.Id),embyId:o.Id,epgGenre:null,order:i,desc:o.Overview||('Live channel from '+label+'.')}; }), idx, src); one2(); }, function(){ one2(); });
            }, function(err){ out.err=String(err||'Could not sign in'); end(); });
            }catch(e){ out.err=String(e&&e.message||e); end(); }
        }

        // ---------- merging ----------
        function adopt(keep, other){ // fill gaps in the kept copy from the duplicate
            ['logo','plot','year','tmdb','imdb'].forEach(function(k){ if(!keep[k]&&other[k]) keep[k]=other[k]; });
            if((keep.rating==='–'||!keep.rating)&&other.rating&&other.rating!=='–') keep.rating=other.rating;
            (keep._alts=keep._alts||[]).push(other); }
        function mergeVod(lists){
            var out=[], byTmdb={}, byImdb={}, byTY={}, byT={}, dup=0;
            lists.forEach(function(list,li){ list.forEach(function(it){
                var tm=it.tmdb?String(it.tmdb):'', im=it.imdb?String(it.imdb).toLowerCase():'', t=normTitle(it.title), y=yearOf(it);
                var hit=null;
                function other(e){ return e&&e.li!==li?e:null; }
                if(tm) hit=other(byTmdb[tm]); if(!hit&&im) hit=other(byImdb[im]);
                if(!hit&&t&&y) hit=other(byTY[t+'|'+y]);
                if(!hit&&t&&byT[t]){ // one side has no year: match on title alone
                    var c=byT[t].filter(function(e){ return e.li!==li && (!y || !e.y); }); if(c.length===1) hit=c[0]; }
                if(hit&&!(tm&&hit.item.tmdb&&String(hit.item.tmdb)!==tm)){ adopt(hit.item,it); dup++; return; }
                var e={item:it, li:li, y:y}; out.push(it);
                if(tm&&!byTmdb[tm]) byTmdb[tm]=e; if(im&&!byImdb[im]) byImdb[im]=e;
                if(t&&y&&!byTY[t+'|'+y]) byTY[t+'|'+y]=e; if(t) (byT[t]=byT[t]||[]).push(e);
            }); });
            out.forEach(function(it,i){ it.gi=i; it.order=i; });
            return {items:out, dup:dup}; }
        function mergeLive(lists){
            var out=[], byId={}, byName={}, dup=0;
            lists.forEach(function(list,li){ list.forEach(function(c){
                var id=c.tvgId?String(c.tvgId).toLowerCase():'', nk=liveMatchKey(c.name||'');
                var hit=null; if(id&&byId[id]&&byId[id].li!==li) hit=byId[id]; if(!hit&&nk&&nk.length>1&&byName[nk]&&byName[nk].li!==li) hit=byName[nk];
                if(hit){ (hit.item._alts=hit.item._alts||[]).push(c); if(!hit.item.logo&&c.logo) hit.item.logo=c.logo; dup++; return; }
                var e={item:c, li:li}; out.push(c); if(id&&!byId[id]) byId[id]=e; if(nk&&!byName[nk]) byName[nk]=e;
            }); });
            out.forEach(function(c,i){ c.order=i; });
            return {items:out, dup:dup}; }

        // ---------- apply ----------
        function apply(results, opts){
            var ok=results.filter(function(r){ return r.ok; });
            report=results.map(function(r){ return { key:r.src.key, name:r.src.name, ok:r.ok, err:r.err, live:r.live.length, movies:r.movies.length, series:r.series.length }; });
            if(!ok.length){ return false; }
            var L=mergeLive(ok.map(function(r){ return r.live; })), M=mergeVod(ok.map(function(r){ return r.movies; })), SR=mergeVod(ok.map(function(r){ return r.series; }));
            var nl=L.items, nm=(typeof dedupeVod==='function')?dedupeVod(M.items,false):M.items, ns=(typeof dedupeVod==='function')?dedupeVod(SR.items,true):SR.items;
            var fe=null, fx=null; ok.forEach(function(r){ if(r.src.kind==='emby'&&!fe) fe=r.src.api; if(r.src.kind==='xtream'&&!fx) fx=r.src.api; });
            report.dup=L.dup+M.dup+SR.dup;
            if(opts&&opts.refresh){   // background refresh after an instant start from the saved copy
                if(libFingerprint(nl)===libFingerprint(S.live)&&libFingerprint(nm)===libFingerprint(S.movies)&&libFingerprint(ns)===libFingerprint(S.series)){
                    if(fx) S.xtream=fx; if(fe) S.emby=fe; return true; }                 // nothing changed: keep what is on screen
                pendingSwap={ live:nl, movies:nm, series:ns, emby:fe, xtream:fx }; trySwap(); return true; }
            S.live=nl; S.movies=nm; S.series=ns; S.replay=[];
            S.emby=fe; S.xtream=fx;
            if(!(opts&&opts.keepFilters)){ S.liveGenre='All'; S.liveQ=''; S.moviesGenre='All'; S.moviesQ=''; S.seriesGenre='All'; S.seriesQ=''; }
            renderAll();
            return true; }
        function summary(){ var okN=report.filter(function(r){ return r.ok; }).length;
            var s='Combined '+okN+' connection'+(okN===1?'':'s')+': Live '+n(S.live.length)+' · Movies '+n(S.movies.length)+' · Series '+n(S.series.length)+'.';
            if(report.dup) s+=' '+n(report.dup)+' duplicates shown once.';
            var bad=report.filter(function(r){ return !r.ok; }); if(bad.length) s+=' Could not load: '+bad.map(function(r){ return r.name; }).join(', ')+'.';
            return s; }
        function cfgKeep(extra){ var c=Store.cfg||{}, o={}; ['resumeLast','lastChannelId','epgTz','providerTz'].forEach(function(k){ if(c[k]!=null) o[k]=c[k]; }); for(var k in extra) o[k]=extra[k]; return o; }

        // Load every included source (combined mode), or just `only` (single-source relaunch).
        function reload(opts){ opts=opts||{};
            var list=opts.only?[opts.only]:included();
            if(!list.length){ if(!opts.quiet) setStatus('Switch on at least one saved connection.','err'); return; }
            var my=++tok; loading=true; var mtok=null;
            if(!opts.quiet){ setStatus('Loading '+list.length+' connection'+(list.length===1?'':'s')+'…','info'); mtok=showConnectModal(); }
            else if(!opts.only&&!opts.silent){ setToast('Loading your connections…'); }
            if(!opts.only) renderPlaylists();
            var results=new Array(list.length), left=list.length;
            if(!opts.silent&&(!opts.only||opts.quiet)){ window.__byoLib={ total:list.length, done:0, failed:0 }; try{ window.__byoLibTick&&window.__byoLibTick(); }catch(_e){} }
            var early=false;
            list.forEach(function(pl,i){ loadOne(pl, i, function(r){ results[i]=r; try{ if(window.__byoLib){ window.__byoLib.done++; if(!(r&&r.ok)) window.__byoLib.failed++; window.__byoLibTick&&window.__byoLibTick(); } }catch(_e){} if(--left>0){
                    // First connection ready while others still load: show it now, add the rest when they arrive.
                    if(opts.early&&!opts.refresh&&!early&&r&&r.ok&&my===tok){ early=true; try{ apply(results.filter(Boolean), opts); opts.keepFilters=true; if(opts.onEarly) opts.onEarly(); setToast('Ready. Loading '+left+' more connection'+(left===1?'':'s')+' in the background\u2026'); }catch(_e){} }
                    return; }
                if(my!==tok) return;
                // A source that failed on a network hiccup (often because several connections were loading at the
                // same time) gets one more quiet try on its own before the library is built.
                var again=[]; if(!opts.noRetry) results.forEach(function(r,i){ if(r&&!r.ok&&!/wrong username|refused access|not an m3u|not found|not valid|could not find|timed out/i.test(String(r.err||''))) again.push(i); });
                if(again.length){ var k=0; (function step(){ if(my!==tok) return; if(k>=again.length) return finish(); var i=again[k++];
                        setTimeout(function(){ if(my!==tok) return; loadOne(list[i], i, function(r){ if(r&&r.ok) results[i]=r; step(); }); }, 3000); })(); return; }
                finish(); }); });
            function finish(){
                loading=false; if(mtok!==null&&mtok!==_connectToken){ renderPlaylists(); return; }
                var done=apply(results, opts);
                if(done&&results.every(function(r){ return r&&r.ok; })) saveSnap(list);
                if(!opts.only){ if(done) Store.cfg=cfgKeep({mode:'multi',name:'All connections'}); Store.save(); }
                if(mtok!==null) hideConnectModal();
                if(!opts.only){ if(done){ setStatus(summary(), report.some(function(r){ return !r.ok; })?'info':'ok'); if(opts.quiet&&!opts.silent) setToast(summary()); }
                    else setStatus('None of your connections could be loaded. Check them and try again.','err');
                    renderPlaylists(); if(done&&opts.goHome) goTo('home'); }
                try{ if(opts.done) opts.done(results, done); }catch(_e){}
                renderActive(); if(!opts.noPublish) publish();
            } }

        // ---------- per-item routing ----------
        function useSourceOf(it){ if(!it||!it._src||!it._src.api) return; if(it._src.kind==='emby') S.emby=it._src.api; else if(it._src.kind==='xtream') S.xtream=it._src.api; }
        function mergeSeasons(base, add, src){ base.seasons=base.seasons||[];
            (add||[]).forEach(function(se){ var bs=null; base.seasons.forEach(function(x){ if(x.n===se.n) bs=x; });
                if(!bs){ bs={n:se.n, episodes:[]}; base.seasons.push(bs); }
                var have={}; bs.episodes.forEach(function(e){ have[e.n]=1; });
                se.episodes.forEach(function(ep){ if(have[ep.n]&&ep.n) return; ep.id=String(ep.id)+'~a'+src.idx; ep._src=src; if(ep.embyId&&src.api) REG[ep.embyId]=src.api; bs.episodes.push(ep); have[ep.n]=1; });
                bs.episodes.sort(function(a,b){ return a.n-b.n; }); });
            base.seasons.sort(function(a,b){ return a.n-b.n; });
            base.epCount=base.seasons.reduce(function(a,x){ return a+x.episodes.length; },0); }
        function ensureSeries(s, cb, orig0){
            var orig=function(x,c){ if(x._plex&&!x.seasons) return Plex.seasons(x,function(se){ x.seasons=se; x.epCount=se.reduce(function(a,y){ return a+y.episodes.length; },0); c(); }); return orig0(x,c); };
            if(!s._src&&!(s._alts&&s._alts.length)) return orig(s,cb);
            if(s._mergedSeasons&&s.seasons){ return cb(); }
            var prevE=S.emby, prevX=S.xtream;
            useSourceOf(s);
            orig(s,function(){
                (s.seasons||[]).forEach(function(se){ (se.episodes||[]).forEach(function(ep){ if(ep.embyId&&s._src&&s._src.api) REG[ep.embyId]=s._src.api; }); });
                var alts=(s._alts||[]).slice(), i=0;
                function next(){ if(i>=alts.length){ s._mergedSeasons=true; S.emby=prevE||S.emby; S.xtream=prevX||S.xtream; return cb(); }
                    var a=alts[i++]; useSourceOf(a);
                    orig(a,function(){ try{ mergeSeasons(s, a.seasons, a._src||{idx:0}); }catch(e){} next(); }); }
                next(); }); }
        function altUrls(c){ var o=(c&&c.opts)||{}, out=[];
            function scan(list,match){ (list||[]).forEach(function(it){ if(match(it)) (it._alts||[]).forEach(function(a){ if(a.url) out.push(a.url); }); }); }
            if(o.type==='live') scan(S.live,function(ch){ return (o.channelId&&ch.id===o.channelId)||ch.url===c.url; });
            else if(o.type==='movie') scan(S.movies,function(m){ return (o.embyId&&m.embyId===o.embyId)||m.url===c.url||(c.title&&m.title===c.title); });
            return out; }

        // ---------- settings UI ----------
        function ensureCard(){ var cur=$('playlist-current'); if(!cur) return null; var card=$('multi-card');
            if(!card){ card=document.createElement('div'); card.id='multi-card'; card.className='multi-card'; cur.parentNode.insertBefore(card,cur); }
            var saved=Store.savedPlaylists||[];
            card.innerHTML='<div class="toggle-row"><button class="toggle'+(on()?' on':'')+'" id="multi-toggle" data-focusable="true" tabindex="0"><i></i></button><span class="t-label">Combine all my connections</span></div>'+
                '<p class="sec-sub mc-sub">Show movies, series and channels from every connection switched on below, as one library. Anything that exists on more than one connection appears once and plays from the connection highest in the list. The other copies are kept as backups.</p>';
            $('multi-toggle').addEventListener('click',function(){ setOn(!on()); });
            return card; }
        function setOn(v){
            if(v){ if(!(Store.savedPlaylists||[]).length){ setStatus('Add at least one connection first.','err'); setToast('Add a connection first, then switch this on.'); return; }
                st().combineSources=true; Store.save(); reload({goHome:false}); renderPlaylists(); }
            else { st().combineSources=false; Store.save();
                var first=included()[0]||(Store.savedPlaylists||[])[0];
                if(first){ Store.cfg=cfgKeep({}); try{ activateSavedPlaylist(first); connect(); }catch(e){} }
                renderPlaylists(); } }
        function statusFor(pl){ var r=null; report.forEach(function(x){ if(x.key===keyOf(pl)) r=x; });
            if(pl.off) return '<span class="mc-st off">Off</span>';
            if(loading) return '<span class="mc-st">Loading…</span>';
            if(!r) return '<span class="mc-st">Not loaded yet</span>';
            if(!r.ok) return '<span class="mc-st bad">Could not load'+(r.err?': '+esc(String(r.err).slice(0,60)):'')+'</span>';
            var bits=[]; if(r.live) bits.push(n(r.live)+' live'); if(r.movies) bits.push(n(r.movies)+' movies'); if(r.series) bits.push(n(r.series)+' series');
            return '<span class="mc-st ok">'+(bits.join(' · ')||'Connected, nothing found')+'</span>'; }
        function render(){ // returns true when it rendered the page itself (combined mode)
            ensureCard(); renderActive(); if(!on()) return false;
            var cur=$('playlist-current'); var inc=included().length;
            cur.innerHTML='<div class="plc-tag">Currently active</div><div class="plc-name">All connections</div><div class="plc-url">'+inc+' of '+(Store.savedPlaylists||[]).length+' connections switched on'+(report.length&&!loading?(' · Live '+n(S.live.length)+' · Movies '+n(S.movies.length)+' · Series '+n(S.series.length)):'')+'</div>';
            var rb=document.createElement('button'); rb.className='s-btn plc-disconnect'; rb.setAttribute('data-focusable','true'); rb.tabIndex=0; rb.innerHTML=icon('i-reload')+'Reload library';
            rb.addEventListener('click',function(e){ e.stopPropagation(); reload({}); }); cur.appendChild(rb);
            var list=$('playlist-list'); list.innerHTML='';
            var saved=Store.savedPlaylists||[];
            if(!saved.length){ list.innerHTML='<div class="section-empty">'+icon('i-info')+'No saved connections yet. Add one and it appears here.</div>'; return true; }
            saved.forEach(function(pl,i){
                var item=document.createElement('div'); item.className='pl-item mc-item'+(pl.off?' mc-off':' active-pl');
                var sub=pl.mode==='m3u'?(pl.url||''):(pl.server||'');
                item.innerHTML='<div class="mc-rank">'+(i+1)+'</div><div class="pli-main"><div class="pli-name">'+esc(plName(pl))+(pl.managed?' <span class="mg-tag">'+icon('i-lock')+'Set up by BYO support</span>':'')+'</div>'+
                    (pl.managed?window.__managedSub(pl):'<div class="pli-sub">'+esc(window.__maskUrl?window.__maskUrl(sub):sub)+'</div>')+statusFor(pl)+'</div>';
                var acts=document.createElement('div'); acts.className='mc-acts';
                function btn(cls,html,label,fn,dis){ var b=document.createElement('button'); b.className='mc-btn '+cls; b.setAttribute('data-focusable','true'); b.tabIndex=0; b.innerHTML=html; b.setAttribute('aria-label',label); b.title=label; if(dis) b.disabled=true;
                    b.addEventListener('click',function(e){ e.stopPropagation(); fn(); }); acts.appendChild(b); return b; }
                btn('mc-onoff'+(pl.off?'':' on'),'<i></i>',pl.off?'Switch on':'Switch off',function(){ setOnPl(pl, !!pl.off); });
                btn('mc-up','▲','Move up',function(){ if(i===0) return; var a=Store.savedPlaylists; a.splice(i-1,0,a.splice(i,1)[0]); Store.save(); renderPlaylists(); reload({}); }, i===0);
                btn('mc-down','▼','Move down',function(){ var a=Store.savedPlaylists; if(i>=a.length-1) return; a.splice(i+1,0,a.splice(i,1)[0]); Store.save(); renderPlaylists(); reload({}); }, i===saved.length-1);
                btn('pli-del',icon('i-trash'),'Remove',function(){ Store.savedPlaylists=Store.savedPlaylists.filter(function(x){ return x!==pl; }); Store.save(); renderPlaylists(); if(included().length) reload({}); });
                item.appendChild(acts); list.appendChild(item); });
            return true; }

        // A connection sent from the phone (QR pairing page). In combined mode it is saved and joins the
        // library without replacing anything; several sends in a row are batched into one reload.
        var phoneT=null, phoneRids=[], results={};
        function entryFrom(p){ var e={mode:p.mode}; if(p.mode==='m3u'){ e.url=p.text?(SmartPaste.savePasted(String(p.text).slice(0,600000), p.name||'Playlist from phone')||''):(window.__directLink?window.__directLink(p.url):p.url); e.epg=p.epg||''; if(p.text) e.name=p.name||'Playlist from phone'; } else { e.server=p.server; e.user=p.user||''; e.pass=p.pass||''; } e.name=(p.name&&!p.text?String(p.name).slice(0,60):"")||e.name||plName(e); if(p.via==='support') e.managed=true; return e; }
        function saveEntry(e){ var saved=Store.savedPlaylists||[]; var k=keyOf(e), found=null; saved.forEach(function(x){ if(keyOf(x)===k) found=x; });
            if(found){ found.off=false; if(e.managed) found.managed=true; if(e.pass) found.pass=e.pass; if(e.epg!=null&&e.mode==='m3u') found.epg=e.epg; Store.save(); return found; }
            e.id='pl'+Date.now().toString(36)+Math.floor(Math.random()*1e3); saved.push(e); Store.savedPlaylists=saved; Store.save(); return e; }
        function resultFor(pl){ var r=null; report.forEach(function(x){ if(x.key===keyOf(pl)) r=x; });
            return r?{ ok:r.ok, err:r.ok?'':(r.err||'Could not load'), name:plName(pl), live:r.live, movies:r.movies, series:r.series, at:Date.now() }:{ ok:false, err:'Not loaded', name:plName(pl), at:Date.now() }; }
        function useSaved(e){ setToast('Loading '+plName(e)+'…');
            reload({quiet:true, only:e, noPublish:true, done:function(res, ok){
                if(ok){ Store.cfg=cfgKeep({mode:e.mode, url:e.url, epg:e.epg, server:e.server, user:e.user, pass:e.pass, name:plName(e), managed:!!e.managed}); Store.save();
                    try{ restoreConfig(); }catch(_e){} setToast('Connected to '+plName(e)+'.'); renderPlaylists(); }
                else setToast('Could not load '+plName(e)+'.'); publish(); }}); }
        function addFromPhone(p, cb){
            var e=saveEntry(entryFrom(p)); var rid=p.rid||null; var via=(p.via==='support')?' (remote help)':' from your phone';
            if(on()){
                setToast('Adding '+plName(e)+via+'…');
                if(rid||cb) phoneRids.push({rid:rid, pl:e, cb:cb});
                clearTimeout(phoneT); phoneT=setTimeout(function(){ var mine=phoneRids; phoneRids=[];
                    reload({quiet:true, goHome:true, noPublish:true, done:function(){ mine.forEach(function(x){ var rr=resultFor(x.pl); if(x.rid) results[x.rid]=rr; try{ if(x.cb) x.cb(rr); }catch(_e){} }); publish(); }}); },1200);
                return; }
            // One connection at a time: make it the active connection if it loads.
            setToast('Loading '+plName(e)+via+'…');
            reload({quiet:true, only:e, noPublish:true, done:function(res, ok){
                if(ok){ Store.cfg=cfgKeep({mode:e.mode, url:e.url, epg:e.epg, server:e.server, user:e.user, pass:e.pass, name:plName(e), managed:!!e.managed}); Store.save();
                    try{ restoreConfig(); }catch(_e){} setToast('Connected to '+plName(e)+'.'); try{ goTo('home'); }catch(_e){} renderPlaylists(); }
                else setToast('Could not load '+plName(e)+(p.via==='support'?'.':'. Check the details on your phone.'));
                var rr=resultFor(e); if(rid) results[rid]=rr; try{ if(cb) cb(rr); }catch(_e){} publish(); }}); }
        // What the TV tells the phone: which connections exist, which are active, and how each load went.
        function hostOf(pl){ var u=pl.mode==='m3u'?pl.url:pl.server; try{ return new URL(u).host; }catch(e){ return String(u||'').replace(/^https?:\/\//,'').split(/[\/?#]/)[0]; } }
        function isActive(pl){ var c=Store.cfg||{}; if(on()){ if(pl.off) return false; var r=null; report.forEach(function(x){ if(x.key===keyOf(pl)) r=x; }); return !!(r&&r.ok); }
            return !!c.mode&&c.mode!=='multi'&&keyOf(pl)===keyOf(c); }
        function deviceState(forPhone){ var saved=Store.savedPlaylists||[];
            var conns=saved.map(function(pl){ var r=null; report.forEach(function(x){ if(x.key===keyOf(pl)) r=x; }); var act=isActive(pl);
                var hide=forPhone&&pl.managed;   // the customer's phone never sees support's details
                var o={ id:pl.id, name:plName(pl), mode:pl.mode, host:hide?'':hostOf(pl), user:hide?'':(pl.user||''), on:on()?!pl.off:(!pl.off&&act), active:act, managed:!!pl.managed };
                if(on()&&r){ o.ok=r.ok; o.err=r.ok?'':String(r.err||'').slice(0,80); o.live=r.live; o.movies=r.movies; o.series=r.series; }
                else if(act){ o.ok=true; o.live=S.live.length; o.movies=S.movies.length; o.series=S.series.length; }
                return o; });
            var keep={}, ks=Object.keys(results).sort(function(a,b){ return results[b].at-results[a].at; }).slice(0,12); ks.forEach(function(k){ keep[k]=results[k]; }); results=keep;
            return { mode:on()?'combined':'single', live:S.live.length, movies:S.movies.length, series:S.series.length, connections:conns, results:results, at:Date.now() }; }
        var pubT=null;
        function publish(){ clearTimeout(pubT); pubT=setTimeout(function(){ try{ var d=Store.device||{}; if(!d.deviceId||!d.deviceSecret||typeof Supa==='undefined') return;
            Supa.rpc('byo_device_report',{ p_device_id:d.deviceId, p_secret:d.deviceSecret, p_state:deviceState(true) },function(){}); }catch(e){} },250); }
        // "Active connection" card at the top of Settings > Connection.
        function renderActive(){ try{
            var pg=document.querySelector('.set-page[data-page="connection"]'); if(!pg) return; var box=$('conn-active');
            if(!box){ box=document.createElement('div'); box.id='conn-active'; box.className='conn-active'; var h=pg.querySelector('.sec-sub')||pg.querySelector('h3'); h.parentNode.insertBefore(box,h.nextSibling); }
            var c=Store.cfg||{}, html='';
            var all=Store.savedPlaylists||[];
            // The connection in use must be in the saved list so it can be switched off and back on.
            if(c.mode&&c.mode!=='multi'&&!all.some(function(p){ return keyOf(p)===keyOf(c); })){
                try{ saveEntry({ mode:c.mode, url:c.url, epg:c.epg, server:c.server, user:c.user, pass:c.pass, name:(c.name&&c.name!=='Synced from phone')?c.name:undefined, managed:!!c.managed }); }catch(_e){}
                all=Store.savedPlaylists||[]; }
            if(on()||all.length>=1){
                // Every saved connection with an on/off switch. Off = hidden from Live, Movies and Series, not deleted.
                var onN=all.filter(function(p){ return on()?!p.off:isActive(p); }).length;
                html='<div class="ca-k"><span class="ca-dot ok"></span>Your connections <span class="ca-cnt">'+onN+' of '+all.length+' on</span></div><div class="ca-list">'+all.map(function(pl,i){ var r=null; report.forEach(function(x){ if(x.key===keyOf(pl)) r=x; });
                    var shown=on()?!pl.off:isActive(pl);
                    var cls=!shown?'':(r?(r.ok?'ok':'bad'):'');
                    var st=!shown?'Off · hidden':(r?(r.ok?([r.live?n(r.live)+' live':'',r.movies?n(r.movies)+' movies':'',r.series?n(r.series)+' series':''].filter(Boolean).join(' · ')||'Connected'):'Could not load'):(loading?'Loading…':(on()?'':(isActive(pl)?([S.live.length?n(S.live.length)+' live':'',S.movies.length?n(S.movies.length)+' movies':'',S.series.length?n(S.series.length)+' series':''].filter(Boolean).join(' · ')||'In use'):'In use'))));
                    return '<div class="ca-row'+(shown?'':' ca-off')+'"><span class="ca-dot '+cls+'"></span><span class="ca-n">'+esc(plName(pl))+'</span><span class="ca-s">'+esc(st)+'</span>'+
                        '<button class="mc-btn mc-onoff ca-sw'+(shown?' on':'')+'" data-i="'+i+'" data-focusable="true" tabindex="0" aria-label="'+(shown?'Switch off ':'Switch on ')+esc(plName(pl))+'"><i></i></button></div>'; }).join('')+'</div>'+
                    '<div class="ca-hint">Switch a connection off to hide its channels, movies and series. Nothing is deleted. Switch it on again any time.</div>';
                box.innerHTML=html;
                [].forEach.call(box.querySelectorAll('.ca-sw'),function(b){ b.addEventListener('click',function(e){ e.stopPropagation(); var pl=all[+b.getAttribute('data-i')]; if(!pl) return;
                    var shown=on()?!pl.off:isActive(pl); setOnPl(pl,!shown); setTimeout(renderActive,50); }); });
                return; }
            if(c.mode&&c.mode!=='multi'&&c.managed){ html='<div class="ca-k"><span class="ca-dot ok"></span>Active: '+esc(c.name&&c.name!=='Synced from phone'?c.name:plName(c))+' <span class="mg-tag">'+icon('i-lock')+'Set up by BYO support</span></div>'+window.__managedSub(c)+
                '<div class="ca-s1">Live '+n(S.live.length)+' · Movies '+n(S.movies.length)+' · Series '+n(S.series.length)+'</div><div class="mg-note">The details are hidden. To use your own playlist, fill in the form below.</div>'; }
            else if(c.mode&&c.mode!=='multi'){ html='<div class="ca-k"><span class="ca-dot ok"></span>Active: '+esc(c.name&&c.name!=='Synced from phone'?c.name:plName(c))+'</div><div class="ca-s1">'+esc(hostOf(c))+' · Live '+n(S.live.length)+' · Movies '+n(S.movies.length)+' · Series '+n(S.series.length)+'</div>'; }
            else html='<div class="ca-k"><span class="ca-dot"></span>No connection yet. You are seeing demo content.</div>';
            box.innerHTML=html; }catch(e){} }
        // Connect a MAG portal from Settings > Connection (one connection, or added to the combined library).
        function connectPortal(){
            var portal=window.__cleanUrl($('k-portal').value), mac=Stalker.normMac($('k-mac').value);
            if(!/^https?:\/\//i.test(portal)){ setStatus('Enter the portal link from your provider, e.g. http://portal.example.com/c/','err'); return; }
            if(!mac){ setStatus('Enter the MAC address from your provider, e.g. 00:1A:79:12:34:56.','err'); return; }
            $('k-portal').value=portal; $('k-mac').value=mac;
            connectEntry(saveEntry({ mode:'stalker', server:portal, user:mac, pass:'' }), 'Signing in to the portal…'); }
        function connectEntry(e, msg){
            if(on()){ reload({ goHome:true }); return; }
            setStatus(msg||'Connecting…','info'); var mt=showConnectModal();
            reload({ quiet:true, only:e, noPublish:true, done:function(res, ok){ if(mt!==_connectToken) return; hideConnectModal();
                if(ok){ Store.cfg=cfgKeep({ mode:e.mode, server:e.server, user:e.user, pass:e.pass, name:plName(e) }); Store.save(); setStatus('Connected to '+plName(e)+'. Live '+n(S.live.length)+' · Movies '+n(S.movies.length)+' · Series '+n(S.series.length)+'.','ok'); renderPlaylists(); goTo('home'); }
                else setStatus((res&&res[0]&&res[0].err)||'Could not connect.','err');
                publish(); } }); }
        // Plex sign-in on the TV: show a code + QR, wait for approval, then load the libraries.
        var plexPoll=null;
        function plexSignIn(){ var box=$('plex-box'); if(!box) return; if(plexPoll){ plexPoll.cancel(); plexPoll=null; }
            box.innerHTML='<div class="px-wait">Getting a code from Plex…</div>'; try{ box.scrollIntoView({block:'center',behavior:'smooth'}); }catch(_e){}
            Plex.startPin(function(e, pin){ if(e){ box.innerHTML='<div class="px-err">'+esc(Plex.errText(e))+'</div>'; return; }
                var qr=''; try{ qr=QRCode.toSVG(QRCode.make(pin.authUrl), 6, 2); }catch(_e){}
                box.innerHTML='<div class="px-grid"><div class="px-qr">'+qr+'</div><div class="px-txt"><div class="px-k">Scan with your phone, or go to</div><div class="px-url">plex.tv/link</div><div class="px-k">and enter this code</div><div class="px-code">'+esc(pin.code)+'</div><div class="px-wait"><span class="px-spin"></span>Waiting for you to approve…</div></div></div>';
                plexPoll=Plex.pollPin(pin, function(e2, acc){ plexPoll=null;
                    if(e2){ box.innerHTML='<div class="px-err">'+esc(Plex.errText(e2))+'</div>'; return; }
                    box.innerHTML='<div class="px-ok">Signed in as '+esc(acc.user)+'. Loading your libraries…</div>';
                    connectEntry(saveEntry({ mode:'plex', server:'plex://account', user:acc.user, pass:acc.token }), 'Loading your Plex libraries…'); }); }); }
        // After a single connection is added from the Connection page while combining: rebuild everything.
        function afterConnect(){ renderActive(); publish(); if(!on()) return false; setTimeout(function(){ reload({goHome:true}); },50); return true; }
        // On app launch: bring the user's library back (combined, or the single active connection).
        function boot(){
            var list=bootList();
            if(!list.length||!list.every(snapOk)){ libLog('no saved copy for this kind of source; downloading'); return bootLoad(); }
            // Wait for the saved copy. A big library (tens of MB of JSON) can take well over the old
            // 4s limit to read + parse on a TV, and that limit meant the whole library was downloaded
            // again on EVERY launch. 25s now only guards against IndexedDB never answering at all.
            var started=false, t0=Date.now(); S._libFromSnapWait=true;
            var giveUp=setTimeout(function(){ if(!started){ started=true; S._libFromSnapWait=false; libLog('saved copy did not answer in 25s; downloading'); bootLoad(); } }, 25000);
            Snap.get(function(v){ if(started) return; var tRead=Date.now()-t0;
                if(!v){ started=true; clearTimeout(giveUp); S._libFromSnapWait=false; libLog('no saved copy yet ('+tRead+'ms); downloading'); return bootLoad(); }
                if(v.v!==1||!v.json){ started=true; clearTimeout(giveUp); S._libFromSnapWait=false; libLog('saved copy is from an older format; downloading'); return bootLoad(); }
                if(v.sig!==libSig(list)){ started=true; clearTimeout(giveUp); S._libFromSnapWait=false; libLog('saved copy is for a different connection; downloading'); return bootLoad(); }
                try{ var t1=Date.now(); var d=JSON.parse(v.json); if(!d||!Array.isArray(d.live)) throw 0;
                    var fx=revive(d, list); if(started) return; started=true; clearTimeout(giveUp); S._libFromSnapWait=false;
                    S.live=d.live; S.movies=d.movies||[]; S.series=d.series||[]; S.replay=[]; S.emby=null; S.xtream=fx;
                    S._libLoading=false; S._libFailed=false; S._libFromSaved=true;
                    var ageMin=Math.round((Date.now()-(v.at||0))/60000);
                    libLog('opened saved copy: read '+tRead+'ms, parse '+(Date.now()-t1)+'ms, '+(v.json.length/1048576).toFixed(1)+' MB, '+ageMin+' min old');
                    try{ renderAll(); }catch(_e){} try{ window.__byoLibTick&&window.__byoLibTick(); }catch(_e){}
                    if(Date.now()-(v.at||0)<SNAP_MAX_AGE) return;           // recent enough: no download at all
                    libLog('copy older than 6h; refreshing quietly in the background');
                    setTimeout(function(){ reload({ quiet:true, silent:true, refresh:true, keepFilters:true, noRetry:false, only:on()?null:list[0], noPublish:true }); }, 8000);
                }catch(e){ if(!started){ started=true; clearTimeout(giveUp); } S._libFromSnapWait=false; libLog('saved copy could not be read ('+(e&&e.message||'bad data')+'); downloading'); bootLoad(); } }); }
        function bootLoad(){ try{ var tb=Date.now(); libLog('downloading library from provider');
            if(on()){ if(included().length) reload({quiet:true, early:true, onEarly:function(){ S._libLoading=false; try{ window.__byoLibTick&&window.__byoLibTick(); }catch(_e){} try{ if($('view-home').classList.contains('active-view')) renderHome(); }catch(_e){} }, done:function(r,ok){ S._libLoading=false; if(!ok){ S._libFailed=true; try{ renderHome(); }catch(_e){} } try{ window.__byoLibTick&&window.__byoLibTick(); }catch(_e){} }}); else S._libLoading=false; return; }
            var c=Store.cfg||{}; if(!c.mode||c.mode==='multi'){ S._libLoading=false; return; }
            if((c.mode==='m3u'&&!c.url)||(c.mode!=='m3u'&&!c.server)){ S._libLoading=false; return; }
            reload({quiet:true, only:{mode:c.mode,url:c.url,epg:c.epg,server:c.server,user:c.user,pass:c.pass,name:c.name},
                done:function(res, ok){ S._libLoading=false; libLog(ok?('downloaded in '+Math.round((Date.now()-tb)/1000)+'s'):'download failed'); if(!ok){ S._libFailed=true; try{ renderHome(); }catch(_e){} } try{ window.__byoLibTick&&window.__byoLibTick(); }catch(_e){} }});
        }catch(e){ S._libLoading=false; } }
        // Switch one saved connection on or off (from the phone page). Combined library: rebuild without it /
        // with it. One-at-a-time: switching off the one in use moves to the next one that is on.
        function setOn(id, want){ var saved=Store.savedPlaylists||[], pl=null; saved.forEach(function(x){ if(x.id===id) pl=x; }); return pl?setOnPl(pl, want):false; }
        function setOnPl(pl, want){ var saved=Store.savedPlaylists||[];
            var c0=Store.cfg||{}, shown=on()?!pl.off:!!(c0.mode&&c0.mode!=='multi'&&keyOf(c0)===keyOf(pl));
            if(!!want===shown){ publish(); return true; }   // already as asked
            pl.off=!want; Store.save(); setToast((want?'Switched on: ':'Switched off: ')+plName(pl)+'.');
            if(on()){ if(included().length) reload({quiet:true}); else { Store.cfg={}; Store.save(); try{ clearLibrary(); }catch(e){} renderPlaylists(); publish(); } return true; }
            var c=Store.cfg||{}, hasActive=!!(c.mode&&c.mode!=='multi'), wasActive=hasActive&&keyOf(c)===keyOf(pl);
            if(want){
                if(!hasActive){ useSaved(pl); return true; }                       // nothing shown yet: use this one
                if(wasActive){ try{ renderPlaylists(); }catch(e){} publish(); return true; }
                // Another connection is showing: show both together (combined library) rather than replacing it.
                var cur=null; saved.forEach(function(x){ if(keyOf(x)===keyOf(c)) cur=x; });
                saved.forEach(function(x){ x.off=!(x===pl||x===cur); });
                st().combineSources=true; Store.save();
                setToast('Showing '+(cur?plName(cur)+' and ':'')+plName(pl)+' together.');
                reload({quiet:true}); try{ renderPlaylists(); }catch(e){} return true; }
            // Switching off the one being shown: hide its content (nothing else is switched on in this mode).
            if(wasActive){ Store.cfg={}; Store.save(); try{ clearLibrary(); }catch(e){} try{ renderAll(); }catch(e){} }
            try{ renderPlaylists(); }catch(e){} publish(); return true; }
        return { useSaved:useSaved, setOn:setOn, setOnPl:setOnPl, on:on, plexSignIn:plexSignIn, connectEntry:connectEntry, saveEntry:saveEntry, connectPortal:connectPortal, publish:publish, renderActive:renderActive, addFromPhone:addFromPhone, deviceState:deviceState, keyOf:keyOf, reload:reload, reg:reg, ensureSeries:ensureSeries, altUrls:altUrls, render:render, afterConnect:afterConnect, boot:boot, _merge:{vod:mergeVod,live:mergeLive,norm:normTitle} };
    })();
