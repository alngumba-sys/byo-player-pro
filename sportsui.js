    /* ============ Sports page: picture-led layout (below the menu bar only) ============
       Real data only. Crests and team colours come from the live-score feed (ESPN) when the
       match is known there; channel logos come from the user's own playlist. The "pictures"
       are drawn here (pitch, court, track, ring ...) so no third-party photos are needed. */
    function __scInitials(n){ var w=String(n||'').replace(/[^A-Za-z0-9 ]+/g,' ').trim().split(/\s+/).filter(function(x){ return x&&!/^(fc|afc|cf|sc|ac|the|de|club)$/i.test(x); });
        if(!w.length) return '?'; return (w.length===1?w[0].slice(0,3):w[0].charAt(0)+w[1].charAt(0)).toUpperCase(); }
    function __scHue(n){ var h=0, s=String(n||''); for(var i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h; }
    function __scCrest(T, name, cls){ var nm=name||(T&&T.name)||''; var mono='<span class="sc-crest sc-mono '+(cls||'')+'" style="--h:'+__scHue(nm)+'">'+esc(__scInitials(nm))+'</span>';
        var logo=T&&T.logo;
        // No ESPN team object (e.g. a channel-name event): try the crest-by-name index so well-known
        // clubs still get a real badge instead of initials.
        if(!logo && nm && window.LiveScores && LiveScores.crestFor){ try{ var c=LiveScores.crestFor(nm); if(c&&c.logo) logo=c.logo; }catch(e){} }
        if(!logo) return mono;
        return '<span class="sc-crest '+(cls||'')+'"><img src="'+esc(logo)+'" alt="" loading="lazy" onerror="var p=this.parentNode; p.classList.add(\'sc-mono\'); p.style.setProperty(\'--h\',\''+__scHue(nm)+'\'); p.textContent=\''+esc(__scInitials(nm)).replace(/'/g,'')+'\';"/></span>'; }
    function __scStatus(e){ var st=evStatus(e);
        if(st==='live'){ var m=String(e.minute||'').trim(); if(/^(ht|half)/i.test(m)) return {k:'ht',t:'HT'};
            return {k:'live',t:'LIVE', m:(m&&!/^live$/i.test(m))?m:''}; }
        if(st==='finished'){ var f=String(e.minute||'FT'); return {k:'ft',t:/^(ft|full)/i.test(f)?'FT':f}; }
        return {k:'pre',t:fmtEvTime(e.start)}; }
    function __scChanName(c){ var n=String((c&&c.name)||'').replace(/\s*@.*$/,'').trim(); if(n.length>26&&n.indexOf(':')>2) n=n.slice(0,n.indexOf(':')).trim(); return n; }
    function __scWhere(e){ var ch=e.channels&&e.channels[0];
        if(ch){ var more=e.channels.length>1?' +'+(e.channels.length-1):''; return { lab:ch._guess?'Likely on':'On', name:__scChanName(ch), more:more, logo:ch.logo||'' }; }
        if(e.tv&&e.tv.length) return { lab:'TV', name:e.tv.slice(0,2).join(', '), more:'', logo:'' };
        return null; }
    function __scTeams(e){ return !!(e.home&&e.away); }
    // Shared ordering for sports lists: true amateur/youth feeds sink to the very bottom; COLLEGE games
    // sink below professional games, but ONLY when pro games are also present (a college-only day keeps
    // them in normal order). Within a tier, real team match-ups and higher channel priority come first.
    function rankSports(a){ a=a||[];
        var coll=(typeof itemCollege==='function'), low=(typeof itemLowPriority==='function');
        var hasPro=false; if(coll){ for(var i=0;i<a.length;i++){ if(!itemCollege(a[i])&&!(low&&itemLowPriority(a[i]))){ hasPro=true; break; } } }
        function tier(x){ if(low&&itemLowPriority(x)) return 2; if(coll&&hasPro&&itemCollege(x)) return 1; return 0; }
        return a.slice().sort(function(x,y){ var tx=tier(x), ty=tier(y); if(tx!==ty) return tx-ty;
            var mx=__scTeams(x)?0:1, my=__scTeams(y)?0:1; if(mx!==my) return mx-my;
            return (x._prio||50)-(y._prio||50); }); }
    try{ if(typeof window!=='undefined') window.rankSports=rankSports; }catch(_e){}
    function __scScore(e){ var sc=String(e.score||'').split('-'); return { h:(sc[0]||'').trim(), a:(sc[1]||'').trim(), has:!!(e.score&&sc.length===2) }; }
    function __scOutcome(e){ var st=evStatus(e), sc=__scScore(e); if(!__scTeams(e)||!sc.has) return '';
        var h=+sc.h, a=+sc.a; if(isNaN(h)||isNaN(a)) return '';
        if(st==='finished') return h===a?'Ended in a draw':((h>a?e.home:e.away)+' won');
        if(st==='live') return h===a?'Level':((h>a?e.home:e.away)+' leading');
        return ''; }
    function __scLeft(e){ if(evStatus(e)!=='live') return ''; var left=Math.round((+e.end-Date.now())/60000); if(left<=0||left>600) return ''; return left<60?left+'m left':Math.floor(left/60)+'h '+(left%60)+'m left'; }

    /* ---- generic sport-category background photography (not tied to any specific match) ----
       Per the brief: never a photo claiming to show the actual event — one stock, CC-licensed
       photo per broad sport category (same picture every time that category appears), sourced
       from Wikimedia Commons. A category not yet backed by a verified photo URL keeps the
       original drawn placeholder (below) rather than risk a broken image. */
    var __ART={};
    var __SPORT_PHOTO={
        basketball:'https://upload.wikimedia.org/wikipedia/commons/3/36/AISN_Basketball_Court.jpg',
        tennis:'https://upload.wikimedia.org/wikipedia/commons/7/74/Aerial_view_of_tennis_courts_in_Cologne%2C_Germany_%2850390585946%29.jpg',
        motor:'https://upload.wikimedia.org/wikipedia/commons/0/01/F1_2022_24-03-2022_Angelo.jpg',
        cricket:'https://upload.wikimedia.org/wikipedia/commons/8/88/ABES_Cricket_stadium.jpg',
        golf:'https://upload.wikimedia.org/wikipedia/commons/a/a2/3rd._tee_and_2nd._green%2C_Iona_Golf_Course%2C_Scotland%2C_Sept._2010_-_Flickr_-_PhillipC.jpg'
        /* football, boxing, other: no verified photo yet — see __sportArt's drawn fallback. */
    };
    function __sportCategory(sport){ var k=sport||'Other';
        if(/football|soccer|rugby/i.test(k)) return 'football';
        if(/basket/i.test(k)) return 'basketball';
        if(/tennis/i.test(k)) return 'tennis';
        if(/formula|motor|racing/i.test(k)) return 'motor';
        if(/box|mma|ufc|wrestl/i.test(k)) return 'boxing';
        if(/cricket/i.test(k)) return 'cricket';
        if(/golf/i.test(k)) return 'golf';
        return 'other'; }
    function __sportPhotoUrl(sport){ return __SPORT_PHOTO[__sportCategory(sport)]||''; }
    try{ if(typeof window!=='undefined'){ window.__sportPhotoUrl=__sportPhotoUrl; window.__sportCategory=__sportCategory; } }catch(_e){}
    function __svg(w,h,body){ return 'url("data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid slice">'+body+'</svg>')+'")'; }
    function __sportArt(sport){ var k=sport||'Other'; if(__ART[k]) return __ART[k];
        var photo=__sportPhotoUrl(k); if(photo) return (__ART[k]='url("'+photo+'")');
        var b='';
        var glow='<defs><radialGradient id="g" cx="50%" cy="-10%" r="90%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>';
        var lights='<rect width="1600" height="900" fill="url(#g)"/>';
        if(/football|soccer|rugby/i.test(k)){ var stripes=''; for(var i=0;i<10;i++) stripes+='<rect x="'+(i*160)+'" y="0" width="80" height="900" fill="#fff" opacity=".04"/>';
            b=glow+'<rect width="1600" height="900" fill="#1f6b3a"/>'+stripes+'<g fill="none" stroke="#e8fff0" stroke-opacity=".55" stroke-width="6"><rect x="80" y="80" width="1440" height="740"/><line x1="800" y1="80" x2="800" y2="820"/><circle cx="800" cy="450" r="115"/><rect x="80" y="250" width="220" height="400"/><rect x="1300" y="250" width="220" height="400"/><rect x="80" y="350" width="80" height="200"/><rect x="1440" y="350" width="80" height="200"/></g>'+lights;
            if(/rugby/i.test(k)) b=b.replace('<line x1="800"','<line x1="500" y1="80" x2="500" y2="820"/><line x1="1100" y1="80" x2="1100" y2="820"/><line x1="800"'); }
        else if(/box|mma|ufc|wrestl/i.test(k)) b=glow+'<rect width="1600" height="900" fill="#14161c"/><polygon points="260,260 1340,260 1500,820 100,820" fill="#1f4f9e"/><g stroke-width="10"><line x1="240" y1="300" x2="1360" y2="300" stroke="#e33"/><line x1="200" y1="420" x2="1400" y2="420" stroke="#fff"/><line x1="160" y1="560" x2="1440" y2="560" stroke="#e33"/></g>'+lights;
        else b=glow+'<rect width="1600" height="900" fill="#1b2340"/><g fill="#fff" opacity=".07"><circle cx="300" cy="120" r="220"/><circle cx="1300" cy="120" r="220"/></g><rect y="620" width="1600" height="280" fill="#22305a"/>'+lights;
        return (__ART[k]=__svg(1600,900,b)); }
    function __tint(e){ var c1=(e.homeT&&e.homeT.color)||'', c2=(e.awayT&&e.awayT.color)||'';
        if(!c1) c1='hsl('+__scHue(e.home||e.title)+' 55% 32%)'; if(!c2) c2='hsl('+__scHue(e.away||e.competition||e.title)+' 55% 28%)';
        return { a:c1, b:c2 }; }
    function __paint(el, e, strong){ var t=__tint(e); el.style.setProperty('--ca',t.a); el.style.setProperty('--cb',t.b); el.style.setProperty('--art',__sportArt(e.sport)); if(strong) el.classList.add('strong'); }

    /* ---- score card (live / results / fixtures) ---- */
    function __sportCard(e){ var st=evStatus(e), S0=__scStatus(e), sc=__scScore(e);
        var card=document.createElement('div'); card.className='event-card sc-card sc-'+S0.k; card.setAttribute('data-focusable','true'); card.tabIndex=0;
        if(e._espn) card.setAttribute('data-espn',e.espnId);
        var lab=S0.k==='live'?'<span class="live-pip"></span>LIVE':(S0.k==='ft'?'RESULT':(S0.k==='ht'?'HALF TIME':'UPCOMING'));
        var top='<div class="sc-top"><span class="sc-pill sc-pill-'+S0.k+'">'+lab+'</span><span class="sc-comp">'+esc(e.competition||e.sport||'')+'</span><span class="sc-sport">'+sportIcon(e.sport)+'</span></div>';
        var mid, foot;
        if(__scTeams(e)){ var showSc=(st!=='upcoming')&&sc.has;
            var centre='<div class="sc-mid">'+(showSc?'<div class="sc-big"><span class="ls-sc-h">'+esc(sc.h)+'</span><i>-</i><span class="ls-sc-a">'+esc(sc.a)+'</span></div>':'<div class="sc-big sc-vs">vs</div>')+
                '<div class="sc-state">'+esc(S0.k==='live'?(S0.m||'Live'):(S0.k==='ft'?'Ended':(S0.k==='ht'?'Half time':TimeService.fmtTime(+e.start))))+'</div></div>';
            mid='<div class="sc-match"><div class="sc-side">'+__scCrest(e.homeT,e.home,'mid')+'<span class="sc-tn">'+esc(e.home)+'</span></div>'+centre+
                '<div class="sc-side">'+__scCrest(e.awayT,e.away,'mid')+'<span class="sc-tn">'+esc(e.away)+'</span></div></div>';
            foot=__scOutcome(e); }
        else { var w0=__scWhere(e); mid='<div class="sc-solo">'+(w0&&w0.logo?'<span class="sc-chlogo"><img src="'+esc(w0.logo)+'" alt="" onerror="this.parentNode.remove()"/></span>':'')+'<div class="sc-title">'+esc(e.title)+'</div></div>'; foot=''; }
        var w=__scWhere(e);
        if(!foot) foot=w?(w.lab+' '+w.name+(w.more||'')):(st==='upcoming'?fmtEvTime(e.start):'');
        else if(w&&st!=='finished') foot+=' · '+w.name;
        card.innerHTML='<div class="sc-bg"></div>'+top+mid+'<div class="sc-foot">'+esc(foot)+'</div>'+(st==='live'?'<div class="sc-prog"><i style="width:'+evProgressPct(e)+'%"></i></div>':'')+
            ((window.LiveScores&&LiveScores.isFollowed&&LiveScores.isFollowed(e))?'<span class="sc-follow">'+icon('i-bell-on')+'</span>':'');
        __paint(card,e,false);
        card.addEventListener('click',function(){ openSportEvent(e); });
        return card; }
    window.__sportCard=__sportCard;

    /* ---- featured rail: big picture tiles + one action bar for the selected tile ---- */
    function __heroTile(e){ var st=evStatus(e), S0=__scStatus(e), sc=__scScore(e), w=__scWhere(e);
        var t=document.createElement('div'); t.className='sh3-tile sh3-'+S0.k; t.setAttribute('data-focusable','true'); t.tabIndex=0; if(e._espn) t.setAttribute('data-espn',e.espnId);
        var pill='<span class="sc-pill sc-pill-'+S0.k+'">'+(S0.k==='live'?'<span class="live-pip"></span>LIVE':(S0.k==='pre'?'UPCOMING':S0.t))+'</span>';
        var centre;
        if(__scTeams(e)){ var showSc=(st!=='upcoming')&&sc.has;
            centre='<div class="sh3-match">'+__scCrest(e.homeT,e.home,'big')+'<div class="sh3-score">'+(showSc?'<span class="ls-sc-h">'+esc(sc.h)+'</span><i>-</i><span class="ls-sc-a">'+esc(sc.a)+'</span>':'<span class="sh3-vs">vs</span>')+'</div>'+__scCrest(e.awayT,e.away,'big')+'</div>'; }
        else centre='<div class="sh3-match sh3-solo">'+(w&&w.logo?'<span class="sh3-chlogo"><img src="'+esc(w.logo)+'" alt="" onerror="this.parentNode.innerHTML=\''+sportIcon(e.sport)+'\'"/></span>':'<span class="sh3-emoji">'+sportIcon(e.sport)+'</span>')+'</div>';
        var title=__scTeams(e)?(e.home+' vs '+e.away):e.title;
        var meta=[]; if(S0.k==='live'&&S0.m) meta.push(S0.m); var left=__scLeft(e); if(left&&!S0.m) meta.push(left);
        if(S0.k==='pre') meta.push(fmtEvTime(e.start)); if(e.competition) meta.push(e.competition); if(w) meta.push(w.name+(w.more||''));
        t.innerHTML='<div class="sh3-art"></div><div class="sh3-shade"></div><div class="sh3-top">'+pill+'<span class="sh3-sport">'+sportIcon(e.sport)+' '+esc(e.sport||'')+'</span></div>'+centre+
            '<div class="sh3-text"><div class="sh3-title">'+esc(title)+'</div><div class="sh3-meta">'+esc(meta.join(' · '))+'</div></div>'+(st==='live'?'<div class="sc-prog"><i style="width:'+evProgressPct(e)+'%"></i></div>':'');
        __paint(t,e,true);
        t.addEventListener('click',function(){ var ch=primaryChannel(e); if(st==='live'&&ch) playSportChannel(ch); else openSportEvent(e); });
        t._ev=e; return t; }
    function __heroPicks(){ var live=[], up=[];
        try{ live=filteredEvents(liveSportEvents()); up=filteredEvents(upcomingSportEvents()); }catch(_e){}
        var out=rankSports(live).slice(0,6); if(out.length<3) out=out.concat(rankSports(up).slice(0,6-out.length)); return out; }
    function renderSportsHero(){
        var body=$('sports-body'); var picks=__heroPicks(); if(!picks.length) return;
        var e0=picks[0];
        if(evStatus(e0)==='upcoming'&&picks.length===1&&typeof __evHasReminder==='function'&&__evHasReminder(e0)){ body.appendChild(__heroMini(e0)); return; }
        var wrap=document.createElement('div'); wrap.className='sports-hero sh3';
        var rail=document.createElement('div'); rail.className='sh3-rail'; picks.forEach(function(e){ rail.appendChild(__heroTile(e)); }); wrap.appendChild(rail);
        var bar=document.createElement('div'); bar.className='sh3-bar'; bar.innerHTML='<div class="sh-actions"></div><div class="sh3-hint"></div>'; wrap.appendChild(bar);
        var acts=bar.querySelector('.sh-actions'), hint=bar.querySelector('.sh3-hint');
        function mk(cls,ic,txt,fn){ var b=document.createElement('button'); b.className=cls; b.setAttribute('data-focusable','true'); b.tabIndex=0; b.innerHTML=icon(ic)+txt; b.addEventListener('click',fn); acts.appendChild(b); }
        function show(e){ acts.innerHTML=''; var st=evStatus(e), ch=primaryChannel(e);
            if(st==='live'){ if(ch) mk('play-btn','i-play','Watch live',function(){ playSportChannel(ch); }); mk('ghost-btn','i-info','Event details',function(){ openSportEvent(e); }); }
            else if(st==='finished') mk('ghost-btn','i-info','Match details',function(){ openSportEvent(e); });
            else { mk('play-btn','i-bell','Set reminder',function(){ openReminderChooser(e); }); mk('ghost-btn','i-info','Details',function(){ openSportEvent(e); }); }
            if(e._espn&&st!=='finished'&&window.LiveScores){ var on=LiveScores.isFollowed(e); mk(on?'ghost-btn on':'ghost-btn','i-bell'+(on?'-on':''),on?'Tracking score':'Track score',function(){ var now=LiveScores.follow(e); setToast(now?'Tracking this match. A pop-up shows every goal.':'Stopped tracking this match.'); show(e); }); }
            var w=__scWhere(e); hint.innerHTML=w?icon('i-live')+'<span class="sc-wl">'+esc(w.lab)+'</span><b>'+esc(w.name)+'</b>'+(w.more?'<span class="sc-wm">'+esc(w.more)+'</span>':''):''; }
        show(e0);
        rail.addEventListener('focusin',function(ev){ var t=ev.target.closest&&ev.target.closest('.sh3-tile'); if(t&&t._ev){ show(t._ev); } });
        new MutationObserver(function(){ var f=rail.querySelector('.sh3-tile.focused'); if(f&&f._ev&&f!==wrap._cur){ wrap._cur=f; show(f._ev); } }).observe(rail,{subtree:true,attributes:true,attributeFilter:['class']});
        body.appendChild(wrap);
        try{ var _rb=__reminderBox(); if(_rb) body.appendChild(_rb); }catch(_e){}
    }
