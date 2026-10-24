    /* ============ Live football: real fixtures + scores (ESPN public scoreboard) ============
       Feeds real matches into the Sports hub, links each match to channels in the user's OWN
       playlist ("Watch on"), and raises kick-off / goal / full-time alerts for followed matches. */
    var LiveScores=(function(){
        var BASE='https://site.api.espn.com/apis/site/v2/sports/soccer/';
        // slug, display name, priority (lower = more important), league-specific channel keywords
        var EPL=['premier league','epl','sky sports premier','sky sports main event','supersport premier','ss premier','canal premier','tnt sports','nbc sports','usa network','peacock'];
        var UCL=['champions league','uefa','tnt sports','cbs sports','paramount','canal sport','sky sport','bein sports','supersport football','supersport variety'];
        var AFR=['supersport','ss football','ss variety','canal sport','new world sport','azam sport','startimes sport','st world football','bein sports','kbc','ktn'];
        var LEAGUES=[
            ['eng.1','Premier League',1,EPL],
            ['uefa.champions','Champions League',2,UCL],
            ['esp.1','LaLiga',3,['laliga','la liga','supersport laliga','ss laliga','bein sports','espn','movistar','dazn']],
            ['ita.1','Serie A',4,['serie a','dazn','supersport','bein sports','cbs sports','paramount']],
            ['ger.1','Bundesliga',5,['bundesliga','sky sport','dazn','supersport','espn']],
            ['fra.1','Ligue 1',6,['ligue 1','bein sports','canal','dazn']],
            ['uefa.europa','Europa League',7,UCL],
            ['ken.1','Kenyan Premier League',8,['kenya','kbc','ktn','startimes','azam','supersport']],
            ['caf.champions','CAF Champions League',9,AFR],
            ['caf.confed','CAF Confederation Cup',10,AFR],
            ['caf.nations','Africa Cup of Nations',9,AFR],
            ['fifa.worldq.caf','World Cup Qualifying (Africa)',10,AFR],
            ['fifa.world','FIFA World Cup',2,['world cup','fifa','bein sports','supersport','fox sports','telemundo']],
            ['fifa.friendly','International Friendly',14,['supersport','bein sports','sky sport']],
            ['uefa.nations','UEFA Nations League',12,UCL],
            ['fifa.worldq.uefa','World Cup Qualifying (Europe)',12,UCL],
            ['eng.fa','FA Cup',11,['fa cup','bbc','itv','tnt sports','supersport','espn']],
            ['eng.league_cup','Carabao Cup',13,['carabao','sky sports football','sky sports main event','supersport']],
            ['uefa.europa.conf','Conference League',15,UCL],
            ['rsa.1','South African Premiership',16,['supersport psl','ss psl','supersport','sabc']],
            ['ksa.1','Saudi Pro League',17,['ssc','saudi','shahid','supersport']],
            ['usa.1','MLS',18,['mls','apple']],
            ['por.1','Liga Portugal',19,['sport tv','benfica tv','eleven']],
            ['ned.1','Eredivisie',20,['eredivisie','espn','viaplay']],
            ['eng.2','EFL Championship',21,['championship','sky sports football','efl']],
            ['nga.1','Nigerian Premier League',22,['supersport','nigeria']],
            ['uga.1','Uganda Premier League',22,['startimes','uganda','fufa']]
        ];
        var LEAGUE_WORDS=['premier league','epl','laliga','la liga','serie a','bundesliga','ligue 1','champions league','europa','conference league','mls','eredivisie','psl','saudi','ssc','fa cup','carabao','championship','nfl','nba','f1','formula 1','cricket','rugby','tennis','golf','ufc','boxing','wwe','nhl','mlb'];
        var byId={}, list=[], fetched=0, busy=false, fullTimer=null, liveTimer=null, started=false;
        var prevSnap=null, chanRef=null, chanNorm=null, eventPool=null;

        function pad(n){ return (n<10?'0':'')+n; }
        function etDay(ms){ var d=new Date(ms-4*3600000); return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate()); }
        function N(s){ s=String(s||'').toLowerCase(); try{ s=s.normalize('NFD').replace(/[̀-ͯ]/g,''); }catch(e){}
            return ' '+s.replace(/\+/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()+' '; }
        function getJSON(url,cb){ try{ var x=new XMLHttpRequest(); x.open('GET',url,true); x.timeout=12000;
            x.onload=function(){ var j=null; if(x.status===200){ try{ j=JSON.parse(x.responseText); }catch(e){} } cb(j); };
            x.onerror=x.ontimeout=function(){ cb(null); }; x.send(); }catch(e){ cb(null); } }
        function runQueue(urls,each,done){ var i=0, active=0, LIM=6; if(!urls.length){ done(); return; }
            function next(){ while(active<LIM && i<urls.length){ (function(u){ active++; getJSON(u[0],function(j){ active--; try{ if(j) each(j,u[1]); }catch(e){} if(i>=urls.length&&active===0) done(); else next(); }); })(urls[i++]); } }
            next(); }

        function teamOf(t){ var tm=(t&&t.team)||{}; return { id:tm.id||'', name:tm.displayName||tm.name||'?', short:tm.shortDisplayName||'', abbr:tm.abbreviation||'',
            logo:tm.logo||'', loc:tm.location||'', color:/^[0-9a-f]{6}$/i.test(tm.color||'')?'#'+tm.color:'', alt:/^[0-9a-f]{6}$/i.test(tm.alternateColor||'')?'#'+tm.alternateColor:'', score:(t&&t.score!=null)?String(t.score):'' }; }
        function parse(ev,lg){ var c=ev.competitions&&ev.competitions[0]; if(!c) return null; var h=null,a=null;
            (c.competitors||[]).forEach(function(t){ if(t.homeAway==='home') h=t; else a=t; }); if(!h||!a) return null;
            var stt=((ev.status||c.status||{}).type)||{}; var state=stt.state||'pre';
            var H=teamOf(h), A=teamOf(a); var start=new Date(ev.date); if(isNaN(+start)) return null;
            var tv=[]; (c.broadcasts||[]).forEach(function(b){ (b.names||[]).forEach(function(n){ if(tv.indexOf(n)<0) tv.push(n); }); });
            var minute=''; if(state==='in') minute=stt.shortDetail||((ev.status||{}).displayClock)||'Live';
            else if(state==='post') minute=/postpon/i.test(stt.name||'')?'Postponed':(/cancel/i.test(stt.name||'')?'Cancelled':'FT');
            var goals=[]; (c.details||[]).forEach(function(d){ var ty=((d.type||{}).text)||''; var isGoal=!!d.scoringPlay, isRed=!!d.redCard||/red card/i.test(ty);
                if(!isGoal&&!isRed) return; var who=((d.athletesInvolved||[])[0]||{}).displayName||'';
                goals.push({ min:((d.clock||{}).displayValue)||'', team:((d.team||{}).id)===H.id?'home':'away', who:who, kind:isGoal?(d.ownGoal?'og':(d.penaltyKick?'pen':'goal')):'red' }); });
            return { id:'espn-'+ev.id, espnId:String(ev.id), _espn:true, _state:state, _prio:lg[2], league:lg[0], title:H.name+' vs '+A.name, sport:'Football',
                competition:lg[1], home:H.name, away:A.name, homeT:H, awayT:A, start:start, end:new Date(+start+115*60000),
                score:(state==='pre')?'':(H.score+'-'+A.score), minute:minute, tv:tv, goals:goals, venue:((c.venue||{}).fullName)||'', channels:[], _lg:lg }; }

        /* ---- matching a match to channels in the user's own playlist ---- */
        function variants(T){ var out=[]; [T.name,T.short,T.loc].forEach(function(v){ if(!v) return; var n=N(v).trim();
                var base=n.replace(/\b(fc|afc|cf|sc|ac|cd|sk|fk|club|de)\b/g,' ').replace(/\s+/g,' ').trim();
                [n,base,base.replace(/\bunited\b/,'utd'),base.replace(/\butd\b/,'united')].forEach(function(x){ if(x&&x.length>=4&&out.indexOf(x)<0) out.push(x); }); });
            return out; }
        function hasAny(n,vs){ for(var i=0;i<vs.length;i++){ if(n.indexOf(' '+vs[i]+' ')>-1) return true; } return false; }
        function chanIndex(){ var src=(typeof profFilter==='function')?profFilter(S.live||[]):(S.live||[]);
            if(chanRef===src.length+'|'+(S.live&&S.live.length)+'|'+Store.activeId && chanNorm) return;
            chanRef=src.length+'|'+(S.live&&S.live.length)+'|'+Store.activeId; chanNorm=[]; eventPool=[];
            for(var i=0;i<src.length;i++){ var c=src[i]; var n=N(c.name);
                if(/ (vs\.?|v|x) |@/i.test(' '+(c.name||'')+' ')) eventPool.push({c:c,n:n}); }
            var sp=(typeof sportsChannelsList==='function')?sportsChannelsList():[];
            for(var j=0;j<sp.length;j++){ chanNorm.push({c:sp[j], n:N(sp[j].name+' '+(sp[j].genre||''))}); } }
        function matchChannels(e){ chanIndex(); var hv=variants(e.homeT), av=variants(e.awayT); var hits=[], seen={};
            function add(c,score,guess){ if(seen[c.id]) return; seen[c.id]=1; hits.push({id:c.id,name:c.name,logo:c.logo||'',order:c.order,url:c.url,_guess:guess,_score:score}); }
            eventPool.forEach(function(x){ var h=hasAny(x.n,hv), a=hasAny(x.n,av); if(h&&a) add(x.c,100,false); });

            var kw=(e._lg&&e._lg[3])||[]; var tvk=(e.tv||[]).map(function(t){ return N(t).trim(); }).filter(function(t){ return t.length>=3; });
            var own=' '+kw.join(' ')+' ';
            var cands=[]; chanNorm.forEach(function(x){ if(seen[x.c.id]) return; if(typeof itemLowPriority==='function'&&itemLowPriority(x.c)) return; var sc=0;
                // skip channels named after a DIFFERENT competition (e.g. "SuperSport Premier League" for a Serie A match)
                for(var q=0;q<LEAGUE_WORDS.length;q++){ var lw=LEAGUE_WORDS[q]; if(x.n.indexOf(' '+lw+' ')>-1 && own.indexOf(' '+lw+' ')<0) return; }
                // and channels that are a fixture feed for other teams ("PSF 04 | Arsenal vs Man City")
                if(/ (vs|v) /.test(x.n)) return;
                for(var i=0;i<kw.length;i++){ if(x.n.indexOf(' '+kw[i]+' ')>-1){ sc=Math.max(sc,(i<4?40:22)-i*0.5); } }
                for(var k=0;k<tvk.length;k++){ if(x.n.indexOf(' '+tvk[k]+' ')>-1) sc=Math.max(sc,30); }
                if(sc) cands.push({c:x.c,sc:sc}); });
            cands.sort(function(p,q){ return (q.sc-p.sc)||((p.c.order||0)-(q.c.order||0)); });
            cands.slice(0,hits.length?2:3).forEach(function(p){ add(p.c,p.sc,true); });
            hits.sort(function(p,q){ return q._score-p._score; }); return hits.slice(0,8); }

        /* ---- public: events for the Sports index ---- */
        function events(){ var now=Date.now(); var out=[]; try{ chanIndex(); }catch(e){}
            list.forEach(function(e){ if(+e.start<now-20*3600000||+e.start>now+5*86400000) return;
                if(e._chRef!==chanRef||!e._chDone){ try{ e.channels=matchChannels(e); }catch(err){ e.channels=[]; } e._chRef=chanRef; e._chDone=true; }
                out.push(e); });
            return out; }

        /* ---- follow + alerts ---- */
        function followed(){ var f=(Store.settings&&Store.settings.followMatches)||{}; return f; }
        function isFollowed(e){ if(!e||!e._espn) return false; if(followed()[e.espnId]) return true; return (typeof eventFollowed==='function')&&eventFollowed(e); }
        function follow(e,on){ if(!Store.settings) return; var f=Store.settings.followMatches||{}; var now=Date.now();
            Object.keys(f).forEach(function(k){ if(f[k]<now-3*86400000) delete f[k]; });
            if(on===undefined) on=!f[e.espnId]; if(on) f[e.espnId]=+e.start; else delete f[e.espnId]; Store.settings.followMatches=f; Store.save(); scheduleLive(); return on; }
        function alertBox(msg,e,kind){ var ch0=e&&e.channels&&e.channels[0];
            // the video player is open: show the alert over the picture (OK = watch)
            if(window.ByoAndroid && ByoAndroid.scoreAlert){ try{ if(ByoAndroid.scoreAlert(msg, (ch0&&ch0.name)||'', (ch0&&ch0.url)||'')) return; }catch(x){} }
            if(document.hidden && window.ByoAndroid && ByoAndroid.toast){ try{ ByoAndroid.toast(msg); return; }catch(x){} }
            var b=$('ls-alert'); if(!b){ b=document.createElement('div'); b.id='ls-alert'; document.body.appendChild(b); }
            var ch=e&&e.channels&&e.channels[0];
            b.className='ls-alert ls-'+(kind||'info'); b.innerHTML='<div class="ls-a-ic">'+(kind==='goal'?'⚽':(kind==='ft'?'🏁':'🔔'))+'</div><div class="ls-a-txt">'+esc(msg)+'</div>';
            if(ch){ var w=document.createElement('button'); w.className='ls-a-btn'; w.setAttribute('data-focusable','true'); w.tabIndex=0; w.innerHTML=icon('i-play')+'Watch';
                w.addEventListener('click',function(ev){ ev.stopPropagation(); b.classList.remove('show'); playSportChannel(ch); }); b.appendChild(w); }
            b.onclick=function(){ b.classList.remove('show'); if(e) openSportEvent(e); };
            // on a TV, put the remote on "Watch" so OK goes straight to the match; give focus back afterwards
            var prev=Nav.current, wbtn=b.querySelector('.ls-a-btn'), tv=!(window.matchMedia&&matchMedia('(pointer:coarse)').matches);
            if(tv&&wbtn&&!$('view-player').classList.contains('active-view')) setTimeout(function(){ try{ Nav.setFocus(wbtn); }catch(x){} },60);
            function hide(){ b.classList.remove('show'); if(wbtn&&Nav.current===wbtn&&prev&&document.body.contains(prev)) try{ Nav.setFocus(prev); }catch(x){} }
            setTimeout(function(){ b.classList.add('show'); },20); clearTimeout(b._t); b._t=setTimeout(hide,12000); }
        function diffAlerts(){ var snap={}; list.forEach(function(e){ snap[e.espnId]={s:e._state,sc:e.score}; });
            if(prevSnap){ list.forEach(function(e){ if(!isFollowed(e)) return; var p=prevSnap[e.espnId]; if(!p) return;
                var sc=e.score.replace('-','–');
                if(p.s==='pre'&&e._state==='in') alertBox('Kick-off: '+e.home+' vs '+e.away,e,'ko');
                else if(e._state==='in'&&p.sc&&p.sc!==e.score){ var pa=p.sc.split('-'), na=e.score.split('-'); var who=(+na[0]>+pa[0])?e.home:((+na[1]>+pa[1])?e.away:'');
                    alertBox((who?'GOAL! '+who+'.  ':'Score update.  ')+e.home+' '+sc+' '+e.away+(e.minute?' ('+e.minute+')':''),e,'goal'); }
                else if(p.s==='in'&&e._state==='post') alertBox('Full time: '+e.home+' '+sc+' '+e.away,e,'ft'); }); }
            prevSnap=snap; }

        /* ---- fetching ---- */
        var leagueLogo={};
        function ingest(j,lg){ try{ var L0=(j.leagues||[])[0]; var lo=L0&&L0.logos&&L0.logos[0]&&L0.logos[0].href; if(lo) leagueLogo[lg[0]]=lo; }catch(e){}
            (j.events||[]).forEach(function(ev){ var e=parse(ev,lg); if(!e) return; var old=byId[e.espnId];
            if(old){ e.channels=old.channels; e._chRef=old._chRef; e._chDone=old._chDone; } byId[e.espnId]=e; }); }
        function rebuild(){ var now=Date.now(); list=Object.keys(byId).map(function(k){ return byId[k]; }).filter(function(e){ return +e.start>now-30*3600000; });
            list.sort(function(a,b){ return (a._prio-b._prio)||(a.start-b.start); }); }
        function refresh(liveOnly,cb){ if(busy){ cb&&cb(); return; } busy=true; var urls=[]; var now=Date.now();
            if(liveOnly){ var need={}; list.forEach(function(e){ if(e._state==='in'||(e._state==='pre'&&+e.start-now<15*60000&&+e.start-now>-3*3600000)) need[e.league]=1; });
                LEAGUES.forEach(function(lg){ if(need[lg[0]]) urls.push([BASE+lg[0]+'/scoreboard',lg]); }); }
            else { var tmr=etDay(now+86400000);
                LEAGUES.forEach(function(lg){ urls.push([BASE+lg[0]+'/scoreboard',lg]); if(lg[2]<=12) urls.push([BASE+lg[0]+'/scoreboard?dates='+tmr,lg]); }); }
            runQueue(urls,ingest,function(){ busy=false; if(!liveOnly) fetched=Date.now(); rebuild(); diffAlerts(); onUpdate(); scheduleLive(); cb&&cb(); }); }
        function anyLiveish(){ var now=Date.now(); return list.some(function(e){ return e._state==='in'||(e._state==='pre'&&+e.start-now<15*60000&&+e.start-now>-3*3600000); }); }
        function anyFollowedLive(){ var now=Date.now(); return list.some(function(e){ return isFollowed(e)&&(e._state==='in'||(e._state==='pre'&&+e.start-now<20*60000)); }); }
        function scheduleLive(){ clearTimeout(liveTimer); if(!anyLiveish()) return;
            var sportsOpen=$('view-sports').classList.contains('active-view')||$('view-sportdetail').classList.contains('active-view');
            var ms=sportsOpen?30000:(anyFollowedLive()?45000:120000);
            if(document.hidden&&!anyFollowedLive()) ms=300000;
            liveTimer=setTimeout(function(){ refresh(true); },ms); }

        /* ---- repaint the Sports screens without losing the user's place ---- */
        function onUpdate(){ try{ invalidateSports(); }catch(e){}
            var vs=$('view-sports'), vd=$('view-sportdetail');
            if(vs&&vs.classList.contains('active-view')){ var cur=Nav.current; var inside=cur&&$('sports-body').contains(cur);
                if(inside && !(window.matchMedia&&matchMedia('(pointer:coarse)').matches)) { updateCardsInPlace(); }
                else { var y=window.scrollY, bs=$('sports-body').scrollTop; renderSportsFilters(); renderSportsBody(); window.scrollTo(0,y); $('sports-body').scrollTop=bs; } }
            else if(vd&&vd.classList.contains('active-view')&&S.currentSportEvent&&S.currentSportEvent._espn){ var ne=byId[S.currentSportEvent.espnId];
                if(ne&&(ne.score!==S.currentSportEvent.score||ne._state!==S.currentSportEvent._state||ne.minute!==S.currentSportEvent.minute)){
                    var sc=$('sd-scroll'), st=sc.scrollTop, wy=window.scrollY; events(); openSportEvent(ne); sc.scrollTop=st; window.scrollTo(0,wy); } } }
        function updateCardsInPlace(){ [].forEach.call(document.querySelectorAll('[data-espn]'),function(card){ var e=byId[card.getAttribute('data-espn')]; if(!e) return;
            var sc=(e.score||'').split('-'); var h=card.querySelector('.ls-sc-h'), a=card.querySelector('.ls-sc-a'); if(h&&e.score){ h.textContent=sc[0]; a.textContent=sc[1]; }
            var m=card.querySelector('.ls-min'); if(m) m.textContent=e.minute||''; }); }

        /* ---- decorate the hub's event cards (crests, live minute, follow bell, finished state) ---- */
        function crest(T){ return (T&&T.logo)?'<img class="ls-crest" src="'+esc(T.logo)+'" loading="lazy" onerror="this.remove()"/>':''; }
        function decorate(card,e){ if(!e||!e._espn) return; card.setAttribute('data-espn',e.espnId); card.classList.add('ls-card');
            var tbox=card.querySelector('.ec-teams'); if(tbox){ var hs=e.score?e.score.split('-'):['','']; var hw='', aw='';
                if(e._state==='post'&&hs[0]!==''){ hw=(+hs[0]>+hs[1])?' win':((+hs[0]<+hs[1])?' lose':''); aw=(+hs[1]>+hs[0])?' win':((+hs[1]<+hs[0])?' lose':''); }
                var rows=document.createElement('div'); rows.className='ls-rows';
                rows.innerHTML='<div class="ls-row'+hw+'">'+crest(e.homeT)+'<span class="ls-tn">'+esc(e.home)+'</span><span class="ls-sc ls-sc-h">'+esc(hs[0]||'')+'</span></div>'+
                               '<div class="ls-row'+aw+'">'+crest(e.awayT)+'<span class="ls-tn">'+esc(e.away)+'</span><span class="ls-sc ls-sc-a">'+esc(hs[1]||'')+'</span></div>';
                tbox.parentNode.replaceChild(rows,tbox); }
            var st=evStatus(e), btn=card.querySelector('.ec-btn');
            var mins=[].filter.call(card.querySelectorAll('.ec-time'),function(x){ return x.style&&x.style.textAlign==='center'; })[0];
            if(mins){ mins.className='ec-time ls-min'; }
            else if(st==='live'){ var tm=card.querySelector('.ls-rows'); if(tm) tm.insertAdjacentHTML('afterend','<div class="ec-time ls-min">'+esc(e.minute||'')+'</div>'); }
            if(mins&&st==='live'){ var rr=card.querySelector('.ls-rows'); if(rr&&rr.nextSibling!==mins) rr.parentNode.insertBefore(mins,rr.nextSibling); }
            if(st==='finished'&&btn){ btn.outerHTML='<div class="ls-ft">'+esc(e.minute==='FT'?'Full time':e.minute)+'</div>'; var top=card.querySelector('.ec-top .ec-time'); if(top) top.textContent=fmtEvTime(e.start); }
            if(st==='live'&&btn&&!(e.channels&&e.channels.length)){ btn.innerHTML=icon('i-info')+'Live score'; }
            var chl=card.querySelector('.ec-chan'); if(chl&&e.channels[0]&&e.channels[0]._guess) chl.insertAdjacentHTML('afterbegin','<span class="ls-likely">Likely on</span>');
            if(isFollowed(e)) card.insertAdjacentHTML('beforeend','<span class="ls-bell" title="Alerts on">🔔</span>'); }

        /* ---- match centre additions on the event detail page ---- */
        function decorateDetail(scroll,e){ if(!e||!e._espn) return; var st=evStatus(e);
            var hero=scroll.querySelector('.sd-hero');
            if(hero){ var crests='<div class="ls-sd-crests">'+crest(e.homeT)+'<span class="ls-sd-vs">'+(e.score?esc(e.score.replace('-',' – ')):'vs')+'</span>'+crest(e.awayT)+'</div>';
                var first=hero.firstElementChild; if(first) first.insertAdjacentHTML('afterbegin',crests);
                if(st==='finished'){ var s=hero.querySelector('.sd-status'); if(s) s.textContent=e.minute==='FT'?'Full time':e.minute; } }
            // match events (goals / red cards)
            var anchor=scroll.querySelector('.sd-section-title');
            if(e.goals&&e.goals.length){ var tl=document.createElement('div'); tl.className='ls-events';
                tl.innerHTML='<div class="sd-section-title">Match events</div>'+e.goals.map(function(g){ var ic=g.kind==='red'?'🟥':'⚽'; var tag=g.kind==='og'?' (OG)':(g.kind==='pen'?' (pen)':'');
                    return '<div class="ls-ev ls-'+g.team+'"><span class="ls-ev-min">'+esc(g.min)+'</span><span class="ls-ev-ic">'+ic+'</span><span class="ls-ev-who">'+esc(g.who+tag)+'</span><span class="ls-ev-team">'+esc(g.team==='home'?e.home:e.away)+'</span></div>'; }).join('');
                if(anchor) scroll.insertBefore(tl,anchor); else scroll.appendChild(tl); }
            // honest labels for guessed channels, and an empty state when nothing matched
            var rows=scroll.querySelectorAll('.watch-row');
            [].forEach.call(rows,function(r,i){ var c=e.channels[i]; if(!c) return; var sub=r.querySelector('.wr-sub');
                if(sub) sub.textContent=c._guess?('Usually shows '+e.competition+(st==='live'?'. Check it is this match':'')):(st==='live'?'Showing this match now':'Showing this match '+fmtEvTime(e.start)); });
            if(!rows.length){ var wo=scroll.querySelector('.watch-on'); if(wo){ var em=document.createElement('div'); em.className='ls-nochan';
                em.innerHTML='<div>No channel in your playlist matched this match yet.</div>'+(e.tv&&e.tv.length?'<div class="ls-tv">Broadcast on: '+esc(e.tv.join(', '))+'</div>':'');
                var bb=document.createElement('button'); bb.className='ghost-btn'; bb.setAttribute('data-focusable','true'); bb.tabIndex=0; bb.innerHTML=icon('i-live')+'Browse football channels';
                bb.addEventListener('click',function(){ sportsSub='All'; sportsFilter='Football'; goTo('sports'); }); em.appendChild(bb); wo.appendChild(em); } }
            // follow match (kick-off, goal and full-time alerts)
            if(st!=='finished'){ var on=isFollowed(e); var fb=document.createElement('button'); fb.className=on?'play-btn ls-follow':'ghost-btn ls-follow'; fb.setAttribute('data-focusable','true'); fb.tabIndex=0;
                fb.innerHTML=icon(on?'i-bell-on':'i-bell')+(on?'Tracking score: tap to stop':'Track score: pop-up on every goal');
                fb.addEventListener('click',function(){ var now=follow(e); setToast(now?'Tracking this match. A pop-up shows every goal, wherever you are in the app.':'Stopped tracking this match.'); var sc=scroll.scrollTop; openSportEvent(e); scroll.scrollTop=sc; });
                var wrap=document.createElement('div'); wrap.style.marginTop='18px'; wrap.appendChild(fb);
                var woEl=scroll.querySelector('.watch-on'); if(woEl&&woEl.nextSibling) scroll.insertBefore(wrap,woEl.nextSibling); else scroll.appendChild(wrap); }
            if(window.innerWidth<900){ [].forEach.call(scroll.querySelectorAll('button'),function(b){ if(/multi-?view/i.test(b.textContent)) (b.parentNode.childNodes.length===1?b.parentNode:b).remove(); }); }
            if(e.venue){ var v=document.createElement('div'); v.className='sd-note'; v.textContent='Venue: '+e.venue+'. Scores update automatically.'; scroll.appendChild(v); } }


        /* ---- clear league sections with one match per row (time | teams | status) ---- */
        var COUNTRY={'eng.1':'England','eng.2':'England','eng.fa':'England','eng.league_cup':'England','esp.1':'Spain','ita.1':'Italy','ger.1':'Germany','fra.1':'France',
            'por.1':'Portugal','ned.1':'Netherlands','ken.1':'Kenya','rsa.1':'South Africa','ksa.1':'Saudi Arabia','usa.1':'USA','nga.1':'Nigeria','uga.1':'Uganda',
            'uefa.champions':'Europe','uefa.europa':'Europe','uefa.europa.conf':'Europe','uefa.nations':'Europe','fifa.worldq.uefa':'Europe',
            'caf.champions':'Africa','caf.confed':'Africa','caf.nations':'Africa','fifa.worldq.caf':'Africa','fifa.world':'World','fifa.friendly':'International'};
        var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        function dayLabel(ms){ var d=new Date(ms), now=new Date(); var t0=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(); var dd=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
            var diff=Math.round((dd-t0)/86400000); if(diff===0) return 'Today'; if(diff===1) return 'Tomorrow'; if(diff===-1) return 'Yesterday';
            return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]+' '+d.getDate()+' '+MON[d.getMonth()]; }
        function matchRow(e,showLeague){ var st=evStatus(e); var r=document.createElement('div'); r.className='ls-match ls-'+st; r.setAttribute('data-focusable','true'); r.tabIndex=0; r.setAttribute('data-espn',e.espnId);
            var sc=(e.score||'').split('-');
            var left = st==='live' ? '<div class="lm-when live"><span class="lm-live">LIVE</span><span class="ls-min">'+esc(e.minute||'')+'</span></div>'
                     : st==='finished' ? '<div class="lm-when"><span class="lm-day">'+esc(dayLabel(+e.start))+'</span><span class="lm-ft">'+esc(e.minute==='FT'?'Full time':(e.minute||'Ended'))+'</span></div>'
                     : '<div class="lm-when"><span class="lm-day">'+esc(dayLabel(+e.start))+'</span><span class="lm-time">'+esc(TimeService.fmtTime(+e.start))+'</span></div>';
            var hw='',aw=''; if(st==='finished'&&sc[0]!==''){ hw=(+sc[0]>+sc[1])?' win':((+sc[0]<+sc[1])?' lose':''); aw=(+sc[1]>+sc[0])?' win':((+sc[1]<+sc[0])?' lose':''); }
            var teams='<div class="lm-teams"><div class="lm-t'+hw+'">'+crest(e.homeT)+'<span class="lm-n">'+esc(e.home)+'</span><span class="lm-s ls-sc-h">'+(st==='upcoming'?'':esc(sc[0]||''))+'</span></div>'+
                      '<div class="lm-t'+aw+'">'+crest(e.awayT)+'<span class="lm-n">'+esc(e.away)+'</span><span class="lm-s ls-sc-a">'+(st==='upcoming'?'':esc(sc[1]||''))+'</span></div>';
            var ch=e.channels&&e.channels[0]; var where='';
            var chn=ch?((typeof __scChanName==='function')?__scChanName(ch):ch.name):'';
            if(st!=='finished'){ if(ch&&!ch._guess) where='<div class="lm-where ok">'+icon('i-live')+'<span>Watch on: '+esc(chn)+'</span></div>';
                else if(ch) where='<div class="lm-where">'+icon('i-live')+'<span>Likely on: '+esc(chn)+'</span></div>'; }
            if(showLeague) where='<div class="lm-where">'+esc(e.competition)+'</div>'+where;
            teams+=where+'</div>';
            var right='<div class="lm-side">'+(__evHasReminder(e)||isFollowed(e)?'<span class="lm-bell" title="Reminder set">'+icon('i-bell-on')+'</span>':'')+icon('i-chev-r')+'</div>';
            r.innerHTML=left+teams+right; r.addEventListener('click',function(){ openSportEvent(e); }); return r; }
        function leagueBlock(title,events,opts){ opts=opts||{}; var e0=events[0]||{}; var w=document.createElement('section'); w.className='ls-league';
            var logo=e0.league&&leagueLogo[e0.league]; var sub=opts.sub!=null?opts.sub:((COUNTRY[e0.league]?COUNTRY[e0.league]+' · ':'')+events.length+' match'+(events.length===1?'':'es'));
            w.innerHTML='<div class="ls-lh">'+(logo?'<img class="ls-ll" src="'+esc(logo)+'" alt="" onerror="this.remove()"/>':'<span class="ls-ll ph">'+(opts.icon||sportIcon('Football'))+'</span>')+
                '<div class="ls-lt"><div class="ls-ln">'+esc(title)+'</div><div class="ls-ls">'+esc(sub)+'</div></div></div>';
            var list=document.createElement('div'); list.className='ls-list'; var MAX=opts.max||6;
            events.slice(0,MAX).forEach(function(e){ list.appendChild(matchRow(e,opts.showLeague)); }); w.appendChild(list);
            if(events.length>MAX){ var more=document.createElement('button'); more.className='ls-more'; more.setAttribute('data-focusable','true'); more.tabIndex=0; more.innerHTML='Show all '+events.length+' matches'+icon('i-chev-d');
                more.addEventListener('click',function(){ events.slice(MAX).forEach(function(e){ list.appendChild(matchRow(e,opts.showLeague)); }); more.remove(); }); w.appendChild(more); }
            return w; }
        function results(){ var now=Date.now(); return events().filter(function(e){ return e._state==='post'&&+e.start>now-20*3600000&&e.minute==='FT'; }).sort(function(a,b){ return (a._prio-b._prio)||(b.start-a.start); }).slice(0,24); }

        function start(){ if(started) return; started=true; refresh(false);
            fullTimer=setInterval(function(){ if(document.hidden&&!anyFollowedLive()) return; refresh(false); },15*60000);
            document.addEventListener('visibilitychange',function(){ if(!document.hidden){ if(Date.now()-fetched>5*60000) refresh(false); else scheduleLive(); } }); }
        // Crest-by-name: reuse the badges ESPN already sent for its fixtures, so a channel-name event
        // like "Real Madrid vs Manresa" can show a real club badge without any extra network call.
        var _crestIdx=null, _crestBuilt=0;
        function _nk(s){ return String(s||'').toLowerCase().replace(/\b(fc|cf|afc|sc|ac|club|cd|ud|deportivo)\b/g,' ').replace(/[^a-z0-9]+/g,'').trim(); }
        function buildCrestIdx(){ _crestIdx={}; try{ (list||[]).forEach(function(e){ [e.homeT,e.awayT].forEach(function(T){ if(T&&T.logo&&T.name){ var k=_nk(T.name); if(k&&!_crestIdx[k]) _crestIdx[k]={logo:T.logo,color:T.color||'',name:T.name};
            if(T.short){ var ks=_nk(T.short); if(ks&&!_crestIdx[ks]) _crestIdx[ks]=_crestIdx[k]; } } }); }); }catch(e){} _crestBuilt=Date.now(); }
        function crestFor(name){ if(!name) return null; if(!_crestIdx||Date.now()-_crestBuilt>60000) buildCrestIdx();
            var k=_nk(name); if(!k) return null; if(_crestIdx[k]) return _crestIdx[k];
            // loose contains match (e.g. "Real Madrid CF" vs "Real Madrid")
            for(var key in _crestIdx){ if(key.length>=4 && (k.indexOf(key)>-1||key.indexOf(k)>-1)) return _crestIdx[key]; }
            return null; }
        return { leagueBlock:leagueBlock, matchRow:matchRow, start:start, refresh:refresh, events:events, results:results, decorate:decorate, decorateDetail:decorateDetail, follow:follow, isFollowed:isFollowed, scheduleLive:scheduleLive, crestFor:crestFor, _list:function(){ return list; } };
    })();
