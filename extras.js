    /* ---- helpers added for phone polish: provider logos, continue-watching art, sports reminder state ---- */
    var BRAND_DOMAIN={'netflix':'netflix.com','hulu':'hulu.com','disney':'disneyplus.com','disney plus':'disneyplus.com','hbo':'hbomax.com','hbo max':'hbomax.com',
        'amazon':'primevideo.com','prime video':'primevideo.com','amazon prime':'primevideo.com','apple tv':'tv.apple.com','apple':'tv.apple.com','paramount':'paramountplus.com',
        'peacock':'peacocktv.com','crunchyroll':'crunchyroll.com','tubi':'tubitv.com','sky':'sky.com','sky cinema':'sky.com','showtime':'sho.com','starz':'starz.com','bbc':'bbc.co.uk',
        'espn':'espn.com','youtube':'youtube.com','discovery':'discoveryplus.com','showmax':'showmax.com','canal':'canalplus.com','dstv':'dstv.com','marvel':'marvel.com',
        'pixar':'pixar.com','national geographic':'nationalgeographic.com','nat geo':'nationalgeographic.com','mubi':'mubi.com','britbox':'britbox.com','shudder':'shudder.com',
        'amc':'amcplus.com','amc+':'amcplus.com','fubo':'fubo.tv','fubotv':'fubo.tv','mgm+':'mgmplus.com','lionsgate':'lionsgate.com','sony':'sonypictures.com','universal':'universalpictures.com','warner':'warnerbros.com','dreamworks':'dreamworks.com',
        'pluto':'pluto.tv','iqiyi':'iq.com','viu':'viu.com','zee5':'zee5.com','hotstar':'hotstar.com','jiocinema':'jiocinema.com','sonyliv':'sonyliv.com','rakuten':'rakuten.tv',
        'videoland':'videoland.com','viaplay':'viaplay.com','stan':'stan.com.au','crave':'crave.ca','itv':'itv.com','channel 4':'channel4.com','cartoon network':'cartoonnetwork.com',
        'nickelodeon':'nick.com','dazn':'dazn.com','acorn':'acorn.tv','curiosity':'curiositystream.com','mgm':'mgmplus.com','hallmark':'hallmarkchannel.com','lifetime':'mylifetime.com',
        'max':'max.com','fx':'fxnetworks.com','tvplus':'tv.apple.com','kanopy':'kanopy.com','plex':'plex.tv','roku':'therokuchannel.roku.com','shahid':'shahid.mbc.net','osn':'osnplus.com','starzplay':'starzplay.com','iroko':'irokotv.com','netflix kids':'netflix.com'};
    function brandLogo(name){ var k=' '+String(name||'').toLowerCase().replace(/\+/g,' ').replace(/[^a-z0-9&]+/g,' ').replace(/\s+/g,' ')+' ';
        var best='',bl=0; for(var key in BRAND_DOMAIN){ if(key.length>bl && k.indexOf(' '+key+' ')>-1){ best=key; bl=key.length; } }
        if(!best) return ''; var d=BRAND_DOMAIN[best];
        // Bundled logos load instantly (no network); anything else is not shown (monogram instead).
        return (window.__BYO_LOGOS&&window.__BYO_LOGOS[d])?('logos/'+d+'.png'):''; }
    function monoTile(name){ var t=String(name||'?').replace(/[^A-Za-z0-9 ]/g,' ').trim(); var w=t.split(/\s+/).filter(Boolean);
        var ab=(w.length>1?(w[0].charAt(0)+w[1].charAt(0)):t.slice(0,2)).toUpperCase()||'?'; var h=0; for(var i=0;i<t.length;i++) h=(h*31+t.charCodeAt(i))%360;
        return '<span class="ct-logo ct-mono" style="background:linear-gradient(135deg,hsl('+h+',55%,42%),hsl('+((h+40)%360)+',60%,26%));color:#fff">'+esc(ab)+'</span>'; }
    function brandTile(name){ var u=brandLogo(name); if(!u) return ''; var m=monoTile(name);
        return m.replace('class="ct-logo ct-mono"','class="ct-logo ct-mono ct-img"').replace('</span>','<img src="'+esc(u)+'" alt="" onerror="this.remove()"/></span>'); }

    function __isUrl(v){ return /^(https?:|data:image|file:|\/)/.test(String(v||'')); }
    function __cwItem(r){ var k=r._key||r.key||''; var it=null;
        if(k.indexOf('movie:')===0){ var id=k.slice(6); for(var i=0;i<(S.movies||[]).length;i++){ if(S.movies[i].id===id){ it=S.movies[i]; break; } } }
        if(!it){ var t=(r.title||'').toLowerCase(), s=(r.sub||'').toLowerCase(); var all=(S.movies||[]).concat(S.series||[]);
            for(var j=0;j<all.length;j++){ var n=(all[j].title||'').toLowerCase(); if(n&&(n===t||(s&&s.indexOf(n)===0)||(t&&t.indexOf(n+' ')===0))){ it=all[j]; break; } } }
        return it; }
    function __cwValid(r){ var k=r._key||r.key||''; if(k.indexOf('movie:')===0 && S.movies && S.movies.length){ return !!__cwItem(r); } return true; }
    function __artFor(r){ if(r.frame&&__isUrl(r.frame)) return r.frame; if(__isUrl(r.poster)) return r.poster; var it=__cwItem(r); return it?(it.backdrop||it.logo||''):''; }
    function __posterHTML(r, fallbackBg, inner){ var a=__artFor(r);
        return '<div class="poster'+(a?' has-art-bg':'')+'" style="background:'+(a?'#0b1020':fallbackBg)+'">'+(a?'<img class="poster-img" src="'+esc(a)+'" loading="lazy" onload="this.parentNode.classList.add(\'has-img\')" onerror="this.remove()"/>':'')+
               '<span class="poster-ph">'+esc(r.title||'')+'</span>'+(inner||'')+'</div>'; }

    function __evHasReminder(e){ if(!e) return false; if((e.channels||[]).some(function(c){ return Store.hasReminder(c.id,e.title,+e.start); })) return true;
        var f=(Store.settings&&Store.settings.followMatches)||{}; return !!(e._espn&&f[e.espnId]); }
    function __heroMiniRow(e){ var d=document.createElement('div'); d.className='sports-hero-mini'; d.setAttribute('data-focusable','true'); d.tabIndex=0;
        var st=evStatus(e);
        d.innerHTML='<span class="shm-ic">'+icon('i-bell-on')+'</span><span class="shm-txt"><b>'+(st==='live'?'Live now':'Reminder set')+'</b><span class="shm-t">'+esc(e.title)+'</span></span><span class="shm-time">'+esc(st==='live'?(e.minute||'LIVE'):fmtEvTime(e.start))+'</span><span class="shm-chev">'+icon('i-chev-r')+'</span>';
        d.addEventListener('click',function(){ openSportEvent(e); }); return d; }
    function __reminderBox(){ var evs=[]; try{ evs=allSportEvents().filter(function(x){ return evStatus(x)!=='finished' && __evHasReminder(x); }); }catch(_e){} if(!evs.length) return null; return __heroMini(evs.sort(function(a,b){ return a.start-b.start; })[0]); }
    function __heroMini(e){ var evs=[]; try{ evs=allSportEvents().filter(function(x){ return evStatus(x)!=='finished' && __evHasReminder(x); }).sort(function(a,b){ return a.start-b.start; }); }catch(_e){}
        if(evs.indexOf(e)<0) evs.unshift(e);
        if(evs.length===1) return __heroMiniRow(e);
        var w=document.createElement('div'); w.className='shm-wrap';
        w.innerHTML='<div class="shm-head">'+icon('i-bell-on')+'<span>Your reminders</span><span class="shm-n">'+evs.length+'</span></div>';
        var list=document.createElement('div'); list.className='shm-list'; evs.forEach(function(x){ list.appendChild(__heroMiniRow(x)); }); w.appendChild(list);
        if(evs.length>3){ var hint=document.createElement('div'); hint.className='shm-hint'; hint.textContent='Scroll to see all '+evs.length; w.appendChild(hint); }
        return w; }
    function __evList(list){ if(window.__sportCard) return carousel(list.map(eventCard)); if(list.length&&list.every(function(e){ return e&&e._espn; })){ var d=document.createElement('div'); d.className='ls-list ls-list-flat';
            list.forEach(function(e){ d.appendChild(LiveScores.matchRow(e,true)); }); return d; }
        return carousel(list.map(eventCard)); }

    /* ============ Category Selector: organised bottom sheet (phones) ============ */
    var CC_NAME={us:'USA',usa:'USA',uk:'United Kingdom',gb:'United Kingdom',ca:'Canada',au:'Australia',nz:'New Zealand',ie:'Ireland',fr:'France',de:'Germany',es:'Spain',it:'Italy',pt:'Portugal',
        br:'Brazil',ar:'Arabic',mx:'Mexico',in:'India',pk:'Pakistan',nl:'Netherlands',be:'Belgium',tr:'Turkey',gr:'Greece',pl:'Poland',ro:'Romania',ru:'Russia',se:'Sweden',no:'Norway',dk:'Denmark',
        fi:'Finland',ch:'Switzerland',at:'Austria',za:'South Africa',ke:'Kenya',ng:'Nigeria',et:'Ethiopia',ug:'Uganda',tz:'Tanzania',gh:'Ghana',eg:'Egypt',ma:'Morocco',sa:'Saudi Arabia',ae:'UAE',
        qa:'Qatar',latino:'Latino',latam:'Latin America',afr:'Africa',africa:'Africa',asia:'Asia',en:'English',ex:'Ex-Yu',yu:'Ex-Yu',al:'Albania',cn:'China',jp:'Japan',kr:'Korea',ph:'Philippines',
        id:'Indonesia',my:'Malaysia',th:'Thailand',vn:'Vietnam',il:'Israel',ir:'Iran',iq:'Iraq',sy:'Syria',lb:'Lebanon',kw:'Kuwait',om:'Oman',bh:'Bahrain',jo:'Jordan',dz:'Algeria',tn:'Tunisia',
        cz:'Czechia',sk:'Slovakia',hu:'Hungary',bg:'Bulgaria',rs:'Serbia',hr:'Croatia',ba:'Bosnia',ua:'Ukraine',ppv:'PPV & Events',vip:'VIP',sport:'Sports',sports:'Sports',four:'4K'};
    var CC_FLAG={USA:'🇺🇸','United Kingdom':'🇬🇧',Canada:'🇨🇦',Australia:'🇦🇺',Ireland:'🇮🇪',France:'🇫🇷',Germany:'🇩🇪',Spain:'🇪🇸',Italy:'🇮🇹',Portugal:'🇵🇹',Brazil:'🇧🇷',Mexico:'🇲🇽',India:'🇮🇳',
        Pakistan:'🇵🇰',Netherlands:'🇳🇱',Belgium:'🇧🇪',Turkey:'🇹🇷',Greece:'🇬🇷',Poland:'🇵🇱',Romania:'🇷🇴',Sweden:'🇸🇪',Norway:'🇳🇴',Denmark:'🇩🇰',Finland:'🇫🇮',Switzerland:'🇨🇭',Austria:'🇦🇹',
        'South Africa':'🇿🇦',Kenya:'🇰🇪',Nigeria:'🇳🇬',Ethiopia:'🇪🇹',Uganda:'🇺🇬',Tanzania:'🇹🇿',Ghana:'🇬🇭',Egypt:'🇪🇬',Morocco:'🇲🇦','Saudi Arabia':'🇸🇦',UAE:'🇦🇪',Qatar:'🇶🇦',China:'🇨🇳',
        Japan:'🇯🇵',Korea:'🇰🇷',Philippines:'🇵🇭',Israel:'🇮🇱',Ukraine:'🇺🇦',Albania:'🇦🇱',Serbia:'🇷🇸',Croatia:'🇭🇷'};
    function __ccSplit(label){ var s=String(label||'').trim(); var m=s.match(/^\s*([A-Za-z]{2,7})\s*(?:[|:\-–]|\s)\s*(.+)$/);
        if(m){ var k=m[1].toLowerCase(); if(CC_NAME[k] && !(k==='sport'||k==='sports')){ return { group:CC_NAME[k], short:m[2].replace(/^[|:\-–\s]+/,'').trim()||s }; } }
        var full=s.toLowerCase().split(/[\s|:\-–]+/)[0]; for(var key in CC_FLAG){ if(full===key.toLowerCase()) return { group:key, short:s.slice(full.length).replace(/^[|:\-–\s]+/,'').trim()||s }; }
        return { group:'', short:s }; }
    function __sheetClose(){ var o=$('cat-sheet'); if(!o) return; o.classList.remove('open'); setTimeout(function(){ if(!o.classList.contains('open')) o.classList.add('hidden'); },220); var f=o._returnFocus; if(f) try{ Nav.setFocus(f); }catch(e){} }
    function __sheetOpen(){ var o=$('cat-sheet'); return !!(o&&o.classList.contains('open')); }
    function openCatSheet(opts){
        var o=$('cat-sheet'); if(!o){ o=document.createElement('div'); o.id='cat-sheet'; o.className='cat-sheet hidden';
            o.innerHTML='<div class="cs-scrim"></div><div class="cs-panel" role="dialog" aria-modal="true"><div class="cs-grab"></div><div class="cs-head"><div class="cs-title"></div>'+
              '<button class="cs-close" data-focusable="true" tabindex="0" aria-label="Close">'+icon('i-chev-d')+'</button></div>'+
              '<div class="cs-search"><span class="cs-sic">'+icon('i-search')+'</span><input type="search" placeholder="Search categories" autocomplete="off" autocapitalize="off" spellcheck="false" data-focusable="true" tabindex="0"/></div>'+
              '<div class="cs-body"></div></div>';
            document.body.appendChild(o);
            o.querySelector('.cs-scrim').addEventListener('click',__sheetClose); o.querySelector('.cs-close').addEventListener('click',__sheetClose); }
        o._returnFocus=Nav.current;
        o.querySelector('.cs-title').innerHTML=esc(opts.title||'Categories')+'<span class="cs-sub">'+esc(opts.sub||'')+'</span>';
        var input=o.querySelector('.cs-search input'); input.value='';
        var body=o.querySelector('.cs-body');
        function row(it, short){ var r=document.createElement('button'); r.className='cs-row'+(it.value===opts.selected?' on':''); r.setAttribute('data-focusable','true'); r.tabIndex=0;
            var lead=it.logo?'<span class="cs-lead logo"><img src="'+esc(it.logo)+'" alt="" onerror="this.parentNode.innerHTML=\''+esc((it.label||'?').charAt(0).toUpperCase())+'\'"/></span>':('<span class="cs-lead">'+(it.iconId?icon(it.iconId):esc((short||it.label||'?').charAt(0).toUpperCase()))+'</span>');
            r.innerHTML=lead+'<span class="cs-name">'+esc(short||it.label)+'</span>'+(it.count!=null?'<span class="cs-count">'+it.count+'</span>':'')+(it.value===opts.selected?'<span class="cs-check">'+icon('i-check')+'</span>':'');
            r.addEventListener('click',function(){ __sheetClose(); opts.onPick(it.value); }); return r; }
        function render(q){ body.innerHTML=''; q=(q||'').toLowerCase().trim(); var items=opts.items;
            var all=items.filter(function(it){ return it.value==='All'; })[0]; var rest=items.filter(function(it){ return it.value!=='All' && (!q || String(it.label).toLowerCase().indexOf(q)>-1); });
            if(all&&!q) body.appendChild(row(all));
            if(!rest.length){ var e=document.createElement('div'); e.className='cs-empty'; e.textContent='No categories match "'+q+'".'; body.appendChild(e); return; }
            // Selected one first, so it is always easy to find
            if(!q&&opts.selected&&opts.selected!=='All'){ var cur=items.filter(function(it){ return it.value===opts.selected; })[0]; if(cur){ var h0=document.createElement('div'); h0.className='cs-sec'; h0.textContent='Selected'; body.appendChild(h0); body.appendChild(row(cur)); } }
            var groups={}, order=[];
            rest.forEach(function(it){ var sp=opts.group===false?{group:'',short:it.label}:__ccSplit(it.label); var g=sp.group||''; if(!groups[g]){ groups[g]={name:g,items:[],total:0}; order.push(g); } groups[g].items.push({it:it,short:sp.short}); groups[g].total+=(it.count||0); });
            // tiny country groups fold into "More categories"
            var other=groups['']||{name:'',items:[],total:0}; if(!groups['']){ groups['']=other; }
            order.forEach(function(g){ if(g&&groups[g].items.length<2){ groups[g].items.forEach(function(x){ x.short=x.it.label; other.items.push(x); other.total+=(x.it.count||0); }); delete groups[g]; } });
            var keys=Object.keys(groups).filter(function(g){ return g&&groups[g]; }).sort(function(a,b){ return groups[b].total-groups[a].total; });
            var top=[]; if(!q&&opts.popular!==false){ top=rest.slice().sort(function(a,b){ return (b.count||0)-(a.count||0); }).slice(0,6);
                if(rest.length>10&&top.length){ var hp=document.createElement('div'); hp.className='cs-sec'; hp.textContent='Most channels'; body.appendChild(hp); top.forEach(function(it){ body.appendChild(row(it)); }); } }
            keys.forEach(function(g){ var G=groups[g]; var h=document.createElement('div'); h.className='cs-sec'; h.innerHTML=(CC_FLAG[g]?'<span class="cs-flag">'+CC_FLAG[g]+'</span>':'')+esc(g)+'<span class="cs-sec-n">'+G.items.length+'</span>'; body.appendChild(h);
                G.items.sort(function(a,b){ return (b.it.count||0)-(a.it.count||0); }).forEach(function(x){ body.appendChild(row(x.it,x.short)); }); });
            if(other.items.length){ var ho=document.createElement('div'); ho.className='cs-sec'; ho.innerHTML=(keys.length?'More categories':'All categories')+'<span class="cs-sec-n">'+other.items.length+'</span>'; body.appendChild(ho);
                other.items.sort(function(a,b){ return opts.alpha?String(a.it.label).localeCompare(b.it.label):((b.it.count||0)-(a.it.count||0)); }).forEach(function(x){ body.appendChild(row(x.it,x.short)); }); }
        }
        render(''); input.oninput=function(){ render(input.value); };
        o.classList.remove('hidden'); requestAnimationFrame(function(){ o.classList.add('open'); body.scrollTop=0; });
        setTimeout(function(){ var f=body.querySelector('.cs-row.on')||body.querySelector('.cs-row'); if(f) Nav.setFocus(f); },60);
    }
    function __useSheet(){ return (window.innerWidth||1920)<900; }
    function __countMap(list, keyFn){ var m={}; for(var i=0;i<list.length;i++){ var ks=keyFn(list[i]); var seen={}; for(var j=0;j<ks.length;j++){ var k=ks[j]; if(!k||seen[k]) continue; seen[k]=1; m[k]=(m[k]||0)+1; } } return m; }
    function __genreKeys(x){ var out=[]; var src=(x&&x.tmdbGenre)?x.tmdbGenre:(x?x.genre:''); splitGenres(src).forEach(function(p){ if(isRealGenre(p)) out.push(canonGenre(p).toLowerCase()); }); if(x&&x.genre) out.push(String(x.genre).trim().toLowerCase()); return out; }
    function openLiveCatSheet(){ var list=profFilter(S.live);
        // The playlist's own groups (what providers call categories), plus any real genres detected.
        var raw={}, canon={}; list.forEach(function(c){ var g=String(c.genre||'').trim(); if(!g) return; var k=g.toLowerCase(); raw[k]=(raw[k]||0)+1; if(!canon[k]) canon[k]=g; });
        var gens=['All']; Object.keys(canon).forEach(function(k){ gens.push(canon[k]); });
        var cm=__countMap(list,__genreKeys); genresOf(list).forEach(function(g){ if(g!=='All'&&!canon[String(g).toLowerCase()]) gens.push(g); });
        var items=gens.map(function(g){ var k=String(g).toLowerCase(); return { value:g, label:g==='All'?'All channels':g, count:g==='All'?list.length:(raw[k]||cm[k]||0), iconId:g==='All'?'i-grid':null }; });
        openCatSheet({ title:'Live categories', sub:(gens.length-1)+' groups', items:items, selected:S.liveGenre||'All', alpha:true,
            onPick:function(v){ if(S.liveGenre===v) return; S.liveGenre=v; S._guideCap=150; renderLiveGenres(); renderLive(); try{ window.scrollTo(0,0); }catch(e){} } }); }
    function openVodCatSheet(kind){ var isMovies=(kind==='movies'); var isChan=((isMovies?S.moviesGroupBy:S.seriesGroupBy)==='channel');
        var list=profFilter(isMovies?S.movies:S.series); var vals=isChan?channelsOf(list):genresOf(list);
        var cm=isChan?__countMap(list,function(x){ var p=providerOf(x); return p?[p.toLowerCase()]:[]; }):__countMap(list,__genreKeys);
        var items=vals.map(function(v){ var it={ value:v, label:v==='All'?(isMovies?'All movies':'All series'):v, count:v==='All'?list.length:(cm[String(v).toLowerCase()]||0) };
            if(v==='All') it.iconId='i-grid'; else if(isChan){ var bl=brandLogo(v); if(bl) it.logo=bl; } else { it.iconId=genreIcon(v); } return it; });
        var sel=isChan?(isMovies?S.moviesChannel:S.seriesChannel):(isMovies?S.moviesGenre:S.seriesGenre);
        openCatSheet({ title:(isMovies?'Movie ':'Series ')+(isChan?'channels':'genres'), sub:(vals.length-1)+(isChan?' channels':' genres'), items:items, selected:sel||'All', group:isChan, popular:isChan,
            onPick:function(v){ if(isChan){ if(isMovies) S.moviesChannel=v; else S.seriesChannel=v; } else { if(isMovies) S.moviesGenre=v; else S.seriesGenre=v; }
                renderCatBar(kind); if(isMovies) renderMovies(); else renderSeries(); try{ window.scrollTo(0,0); }catch(e){} } }); }
    // Live: a single "Category" selector button replaces the chip row on phones
    function __liveCatButton(){ var strip=$('live-genres'); if(!strip) return; var b=$('live-cat-select');
        if(!b){ b=document.createElement('button'); b.id='live-cat-select'; b.className='cat-current live-cat-select'; b.setAttribute('data-focusable','true'); b.tabIndex=0;
            b.addEventListener('click',function(){ openLiveCatSheet(); }); strip.parentNode.insertBefore(b,strip); }
        var cur=S.liveGenre||'All'; b.innerHTML='<span class="cc-ic">'+icon('i-grid')+'</span><span class="lcs-k">Category</span><span class="lcs-v">'+esc(cur==='All'?'All channels':cur)+'</span><span class="cc-chev">'+icon('i-chev-d')+'</span>'; }
    /* TV / wide screens: Live groups as a vertical list down the left side (up/down to move, right to the
       channels) instead of a long sideways strip. Phones keep the Category sheet. */
    var __lsSig='';
    function __liveGroups(){ var list=profFilter(S.live); var raw={}, canon={}, order=[];
        list.forEach(function(c){ var g=String(c.genre||'').trim(); if(!g) return; var k=g.toLowerCase(); if(!canon[k]){ canon[k]=g; order.push(k); } raw[k]=(raw[k]||0)+1; });
        var items=[{ value:'All', label:'All channels', count:list.length }];
        if(order.length>1) order.forEach(function(k){ items.push({ value:canon[k], label:canon[k], count:raw[k] }); });
        else { var cm=__countMap(list,__genreKeys); genresOf(list).forEach(function(g){ if(g!=='All') items.push({ value:g, label:g, count:cm[String(g).toLowerCase()]||0 }); }); }
        return items; }
    function __liveSideList(){ var view=$('view-live'); if(!view) return; var body=view.querySelector('.scroll-body'); if(!body) return;
        var wide=(window.innerWidth||1920)>=900;
        var lay=$('live-layout');
        if(!lay){ lay=document.createElement('div'); lay.id='live-layout'; lay.className='live-layout';
            var side=document.createElement('aside'); side.id='live-side'; side.className='live-side';
            var main=document.createElement('div'); main.className='live-main';
            while(body.firstChild) main.appendChild(body.firstChild);
            lay.appendChild(side); lay.appendChild(main); body.appendChild(lay); }
        var items=__liveGroups(); var many=items.length>2;
        view.classList.toggle('has-side', wide&&many);
        if(!wide||!many) return;
        var sel=S.liveGenre||'All'; var side=$('live-side');
        var sig=sel+'|'+items.length+'|'+(S.live||[]).length+'|'+items.map(function(x){ return x.value; }).join('\u0001').length;
        if(sig===__lsSig&&side.children.length) return; __lsSig=sig;
        var hadFocus=Nav.current&&side.contains(Nav.current);
        side.innerHTML='<div class="ls-head"><span class="ls-t">Groups</span><span class="ls-n">'+(items.length-1)+'</span></div>';
        var box=document.createElement('div'); box.className='ls-list'; var on=null;
        items.forEach(function(it){ var b=document.createElement('button'); b.className='ls-row'+(it.value===sel?' on':''); b.setAttribute('data-focusable','true'); b.tabIndex=0;
            b.innerHTML=(it.value==='All'?'<span class="ls-ic">'+icon('i-grid')+'</span>':'')+'<span class="ls-name">'+esc(it.label)+'</span><span class="ls-c">'+(it.count||0)+'</span>';
            b.addEventListener('click',function(){ if(S.liveGenre===it.value) return; S.liveGenre=it.value; S._guideCap=150; renderLiveGenres(); renderLive();
                try{ window.scrollTo(0,0); body.scrollTop=0; }catch(e){} });
            if(it.value===sel) on=b; box.appendChild(b); });
        side.appendChild(box);
        __lsPin();
        if(on){ try{ box.scrollTop=Math.max(0, on.offsetTop-box.clientHeight/3); }catch(e){} if(hadFocus) Nav.setFocus(on); } }
    // Remote rules for the side list: Right goes to the first channel on screen, Left from the channels returns
    // to the selected group, and Up/Down never jump between the list and the channels.
    (function(){ var t=setInterval(function(){ if(typeof Nav==='undefined'||!Nav.move) return; clearInterval(t); if(Nav.__lsWrapped) return; Nav.__lsWrapped=true;
        var orig=Nav.move;
        Nav.move=function(dir){ var old=this.current, side=$('live-side');
            var on=side&&old&&$('view-live').classList.contains('has-side')&&$('view-live').classList.contains('active-view');
            if(!on) return orig.call(this,dir);
            var inSide=side.contains(old), inMain=!inSide&&!!(old.closest&&old.closest('.live-main'));
            if(inSide&&dir==='right'){ var cards=[].slice.call(document.querySelectorAll('#live-grid [data-focusable="true"]')), pick=null;
                for(var i=0;i<cards.length;i++){ var r=cards[i].getBoundingClientRect(); if(r.bottom>80&&r.top<window.innerHeight){ pick=cards[i]; break; } }
                if(pick||cards[0]){ this.setFocus(pick||cards[0]); return; } }
            orig.call(this,dir); var now=this.current; if(now===old) return;
            var nowSide=side.contains(now);
            if(inMain&&nowSide){ if(dir==='left'){ var sel=side.querySelector('.ls-row.on')||now; if(sel!==now) this.setFocus(sel); } else this.setFocus(old); return; }
            if(inSide&&!nowSide&&(dir==='down'||(dir==='up'&&now.closest&&now.closest('.live-main')))) this.setFocus(old); };
        },300); })();
    // Keep the list in view while the channels scroll (CSS sticky does not hold in this page's scroll setup).
    var __lsRaf=0; function __lsPin(){ __lsRaf=0; var view=$('view-live'), side=$('live-side'), lay=$('live-layout');
        if(!view||!side||!lay||!view.classList.contains('has-side')||!view.classList.contains('active-view')){ if(side) side.style.transform=''; return; }
        var tb=document.querySelector('.topbar'), tr0=tb?tb.getBoundingClientRect():null; var top=(tr0&&tr0.height&&tr0.top<=1&&tr0.bottom>0)?Math.round(tr0.bottom)+14:16; var L=lay.getBoundingClientRect(); var mh=Math.max(240,(window.innerHeight||1080)-top-20)+'px'; if(side.style.maxHeight!==mh) side.style.maxHeight=mh;
        var dy=Math.max(0, Math.min(top-L.top, L.height-side.offsetHeight)); side.style.transform=dy?('translateY('+Math.round(dy)+'px)'):''; }
    window.addEventListener('scroll',function(){ if(!__lsRaf) __lsRaf=requestAnimationFrame(__lsPin); },true);
    window.addEventListener('resize',function(){ __lsSig=''; try{ __liveSideList(); }catch(e){} });

    /* What's On Now (phones): sections become compact lists; long sections collapse to 5 with "Show all" */
    function __wonCompact(){ if((window.innerWidth||1920)>=900) return; var body=$('won-body'); if(!body) return;
        [].forEach.call(body.querySelectorAll('.won-carousel'),function(car){ var n=car.querySelectorAll('.won-card').length; car.classList.add('won-list');
            var old=car.parentNode.querySelector('.won-more'); if(old) old.remove();
            if(n>5){ car.classList.add('won-collapsed'); var b=document.createElement('button'); b.className='won-more'; b.setAttribute('data-focusable','true'); b.tabIndex=0;
                b.innerHTML='Show all '+n+icon('i-chev-d'); b.addEventListener('click',function(){ car.classList.remove('won-collapsed'); b.remove(); });
                car.parentNode.insertBefore(b, car.nextSibling); } }); }

    /* ---- Phones: a real text box with the phone's own keyboard instead of the TV on-screen keyboard ---- */
    function __nativeField(inputEl, opts){ opts=opts||{}; var o=$('nf-sheet');
        if(!o){ o=document.createElement('div'); o.id='nf-sheet'; o.className='nf-sheet';
            o.innerHTML='<div class="nf-scrim"></div><div class="nf-panel"><div class="nf-label"></div><div class="nf-row"><span class="nf-ic">'+icon('i-search')+'</span><input class="nf-input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"/><button class="nf-x" type="button" aria-label="Clear">×</button></div>'+
              '<div class="nf-acts"><button class="nf-cancel" type="button">Cancel</button><button class="nf-done" type="button">Done</button></div></div>';
            document.body.appendChild(o); }
        var inp=o.querySelector('.nf-input'); var label=opts.label||'Enter text'; o.querySelector('.nf-label').textContent=label;
        var isSearch=/search/i.test(label); inp.type=isSearch?'search':'text'; inp.placeholder=opts.placeholder||(isSearch?'Type a channel name':''); o.querySelector('.nf-ic').style.display=isSearch?'':'none';
        inp.value=String(inputEl&&inputEl.value||''); var t=null;
        function close(){ o.classList.remove('open'); try{ inp.blur(); }catch(e){} setTimeout(function(){ o.style.display='none'; },160); }
        function commit(){ var v=inp.value; if(inputEl){ inputEl.value=v; try{ inputEl.dispatchEvent(new Event('input',{bubbles:true})); }catch(e){} } close(); if(opts.onDone) opts.onDone(v); }
        inp.oninput=function(){ if(!isSearch||!opts.onDone) return; clearTimeout(t); t=setTimeout(function(){ if(inputEl) inputEl.value=inp.value; opts.onDone(inp.value); },300); };
        inp.onkeydown=function(e){ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); commit(); } }; inp.onkeyup=function(e){ e.stopPropagation(); };
        o.querySelector('.nf-done').onclick=commit; o.querySelector('.nf-cancel').onclick=function(){ close(); };
        o.querySelector('.nf-scrim').onclick=commit; o.querySelector('.nf-x').onclick=function(){ inp.value=''; inp.focus(); if(inp.oninput) inp.oninput(); };
        o.style.display='block'; requestAnimationFrame(function(){ o.classList.add('open'); setTimeout(function(){ inp.focus(); try{ inp.setSelectionRange(inp.value.length,inp.value.length); }catch(e){} },60); });
    }

    /* ---- Sports: ONE filter row (All · Live · Upcoming · My Teams · My Sports · each sport) ---- */
    function __sportsUnified(){ var w=$('sports-filters'); w.innerHTML=''; w.style.display='flex'; var sn=$('sports-subnav'); if(sn) sn.style.display='none';
        var present={}; allSportEvents().forEach(function(e){ if(e.sport) present[e.sport]=1; });
        sportsChannelsList().forEach(function(c){ var cs=(c._spClass!==undefined)?c._spClass:(c._spClass=classifySport(c.name)); if(cs) present[cs]=1; });
        var sports=SPORT_ORDER.filter(function(s){ return s!=='Other'&&present[s]; }); if(!sports.length) sports=['Football','Basketball','Tennis','Motorsport','Boxing'];
        var chips=[['All','All','All'],['Live','Live Now','All'],['Upcoming','Upcoming','All'],['My Teams','My Teams','All'],['My Sports','My Sports','All']]
            .concat(sports.map(function(s){ return [s,'All',s]; }));
        var activeKey = sportsSub==='Live Now'?'Live':(sportsSub==='Upcoming'?'Upcoming':(sportsSub==='My Teams'?'My Teams':(sportsSub==='My Sports'?'My Sports':(sportsFilter&&sportsFilter!=='All'&&sportsFilter!=='Live'&&sportsFilter!=='Upcoming'?sportsFilter:'All'))));
        chips.forEach(function(c){ var b=document.createElement('button'); b.className='sport-filter'+(c[0]===activeKey?' active-filter':''); b.setAttribute('data-focusable','true'); b.tabIndex=0;
            var sp=SPORT_META[c[0]]; var ic=c[0]==='Live'?'<span class="sf-live"></span>':(c[0]==='My Teams'?icon('i-star'):(sp?sp.icon+' ':''));
            b.innerHTML=ic+esc(c[0]);
            b.addEventListener('click',function(){ sportsSub=c[1]; sportsFilter=c[2]; renderSportsFilters(); renderSportsBody(); try{ window.scrollTo(0,0); }catch(e){}
                setTimeout(function(){ var hit=[].filter.call(w.querySelectorAll('.sport-filter'),function(x){ return x.classList.contains('active-filter'); })[0]; if(hit){ Nav.setFocus(hit); try{ hit.scrollIntoView({inline:'center',block:'nearest'}); }catch(e){} } },10); });
            w.appendChild(b); });
        // Phone widths show the compact "Type: <label> ▾" trigger instead of this chip row (CSS swaps
        // them by width) — keep it wired to the exact same chip list so it never goes dead on phone.
        var trig=$('sports-filter-trigger');
        if(trig){
            var valEl=$('sports-filter-trigger-val'); if(valEl) valEl.textContent=activeKey;
            trig.onclick=function(){
                var items=chips.map(function(c){ var sp2=SPORT_META[c[0]]; var lead=c[0]==='Live'?'<span class="sf-live"></span>':(c[0]==='My Teams'?icon('i-star'):(sp2?sp2.icon+' ':'')); return { id:c[0], label:c[0], lead:lead }; });
                openPickMenu(trig, items, activeKey, function(id){
                    var hit=chips.filter(function(c){ return c[0]===id; })[0]; if(!hit) return;
                    sportsSub=hit[1]; sportsFilter=hit[2]; renderSportsFilters(); renderSportsBody();
                });
            };
        }
    }
