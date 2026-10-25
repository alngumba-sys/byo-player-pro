    /* ============ Matches named inside the provider's channel names ============
       Many providers carry one-off event channels named like
         "Sky Sports + 01: WTA Tour Semi-Finals ... Zheng Qinwen v E. Mertens @ 10 Oct 11:55 AM London"
         "MAX UK 07: Premier League: Arsenal - Leeds United @ 10 Oct 11:00 AM GMT-1"
         "PremSp UK 03: Karlsruher v Inter (Friendly) - Premier Sports 1 Sat, @ Aug 1 10:00am"
       Reading the date and time out of the name turns these into real Live / Upcoming
       matches for the Sports hub, for every sport, without any outside data. */
    var ChanEvents=(function(){
        var MON={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
        var cache=null, cacheKey='';
        // UTC offset (hours) for a zone word, given the date (handles UK / Europe / US summer time)
        function lastSun(y,m){ var d=new Date(Date.UTC(y,m+1,0)); return d.getUTCDate()-d.getUTCDay(); }
        function euSummer(y,m,d){ if(m<2||m>9) return false; if(m>2&&m<9) return true; var ls=lastSun(y,m); return m===2?d>=ls:d<ls; }
        function usSummer(y,m,d){ if(m<2||m>10) return false; if(m>2&&m<10) return true; var first=new Date(Date.UTC(y,m,1)).getUTCDay();
            if(m===2){ var sun2=1+((7-first)%7)+7; return d>=sun2; } var sun1=1+((7-first)%7); return d<sun1; }
        function zoneOffset(z,y,m,d){ if(!z) return null; z=z.toUpperCase().replace(/\s+/g,'');
            var g=z.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/); if(g){ var h=+g[2]+(g[3]?+g[3]/60:0); return g[1]==='-'?-h:h; }
            if(z==='GMT'||z==='UTC'||z==='Z') return 0;
            if(z==='LONDON'||z==='UK'||z==='BST'||z==='GB') return euSummer(y,m,d)?1:0;
            if(z==='CET'||z==='CEST'||z==='PARIS'||z==='BERLIN'||z==='MADRID'||z==='ROME'||z==='EUROPE') return euSummer(y,m,d)?2:1;
            if(z==='ET'||z==='EST'||z==='EDT'||z==='EASTERN'||z==='NEWYORK') return usSummer(y,m,d)?-4:-5;
            if(z==='CT'||z==='CST'||z==='CDT') return usSummer(y,m,d)?-5:-6;
            if(z==='PT'||z==='PST'||z==='PDT') return usSummer(y,m,d)?-7:-8;
            if(z==='EAT'||z==='NAIROBI') return 3; if(z==='SAST') return 2; if(z==='WAT') return 1; if(z==='IST') return 5.5; if(z==='AEST'||z==='AEDT') return 10;
            return null; }
        // "@ 10 Oct 11:55 AM London" | "@ Aug 1 10:00am" | "@ 10/10 20:00" (no zone = the device's own time)
        var RE1=/@\s*(?:[A-Za-z]{3},?\s*)?(\d{1,2})\s+([A-Za-z]{3,4})\.?\s+(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*([A-Za-z]{2,8}(?:\s*[+-]\s*\d{1,2}(?::?\d{2})?)?)?/;
        var RE2=/@\s*(?:[A-Za-z]{3},?\s*)?([A-Za-z]{3,4})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*([A-Za-z]{2,8}(?:\s*[+-]\s*\d{1,2}(?::?\d{2})?)?)?/;
        function when(name){ var m=name.match(RE1), day, mon, hh, mm, ap, zone;
            if(m&&MON[m[2].toLowerCase()]!=null){ day=+m[1]; mon=MON[m[2].toLowerCase()]; hh=+m[3]; mm=+m[4]; ap=m[5]; zone=m[6]; }
            else { m=name.match(RE2); if(!m||MON[m[1].toLowerCase()]==null) return null; mon=MON[m[1].toLowerCase()]; day=+m[2]; hh=+m[3]; mm=+m[4]; ap=m[5]; zone=m[6]; }
            if(ap){ ap=ap.toLowerCase(); if(ap==='pm'&&hh<12) hh+=12; if(ap==='am'&&hh===12) hh=0; }
            if(hh>23||mm>59||day<1||day>31) return null;
            var now=new Date(), y=now.getFullYear();
            // a December match seen in January belongs to last year, a January match seen in December to next year
            if(mon===11&&now.getMonth()===0) y--; else if(mon===0&&now.getMonth()===11) y++;
            var off=zoneOffset(zone,y,mon,day); var t;
            if(off==null) t=new Date(y,mon,day,hh,mm).getTime(); else t=Date.UTC(y,mon,day,hh,mm)-off*3600000;
            return isNaN(t)?null:t; }
        var LONG={ 'Tennis':4*3600000, 'Cricket':8*3600000, 'Golf':6*3600000, 'Formula 1':2.5*3600000, 'Motorsport':3*3600000, 'Boxing':4*3600000, 'MMA':4*3600000, 'American Football':3.5*3600000, 'Baseball':3.5*3600000 };
        function clean(name){ var t=String(name||'');
            t=t.replace(/\s*@.*$/,'');                              // drop the time part
            t=t.replace(/^[^:]{1,40}?\d{1,3}\s*:\s*/,'');             // "Sky Sports + 01: " / "MAX UK 07: "
            t=t.replace(/\s*[-|]\s*(premier sports|sky sports|tnt sports|dazn|espn|bein)[^-|]*$/i,''); // trailing "- Premier Sports 1 Sat,"
            t=t.replace(/\s*\|\s*xtra time\s*$/i,' (Xtra Time)');
            return t.replace(/\s{2,}/g,' ').replace(/[,\s]+$/,'').trim(); }
        function teams(title){ var body=title; var comp='';
            var c=title.match(/^([^:]{3,40}):\s*(.+)$/); if(c){ comp=c[1].trim(); body=c[2].trim(); }
            body=body.replace(/\s*\((?:[^)]*)\)\s*$/,'').trim();
            var v=body.match(/^(.{2,80}?)\s+(?:vs\.?|v\.?|-|–)\s+(.{2,60})$/i); if(!v) return { comp:comp, home:'', away:'' };
            var home=v[1].trim(), away=v[2].trim();
            // "WTA Tour Semi-Finals at the China Open Zheng Qinwen" -> competition + "Zheng Qinwen"
            if(home.length>24){ var w=home.split(/\s+/), keep=[]; var STOP=/^(open|finals?|semi-finals?|quarter-finals?|cup|league|championship|tour|masters|round|grand|prix|series|one|two|three|trophy|classic|games|day|week|\d+)$/i;
                for(var k=w.length-1;k>=0&&keep.length<4;k--){ var t=w[k]; if(STOP.test(t)||!/^[A-Z0-9&'.-]/.test(t)) break; keep.unshift(t); }
                if(!keep.length||keep.join(' ').length>26) return { comp:comp, home:'', away:'' };
                var rest=w.slice(0,w.length-keep.length).join(' ').replace(/[-:,\s]+$/,''); if(rest) comp=comp?comp+' · '+rest:rest; home=keep.join(' '); }
            if(away.length>34) return { comp:comp, home:'', away:'' };
            return { comp:comp, home:home, away:away }; }
        function build(){ var list=(typeof profFilter==='function')?profFilter(S.live||[]):(S.live||[]); var key=list.length+'|'+(S.live&&S.live.length)+'|'+Store.activeId;
            if(cache&&cacheKey===key) return cache;
            var byKey={}, out=[], now=Date.now();
            for(var i=0;i<list.length;i++){ var ch=list[i], n=ch&&ch.name; if(!n||n.indexOf('@')<0) continue;
                var t=when(n); if(t==null) continue;
                if(t<now-36*3600000||t>now+7*86400000) continue;      // old feeds that were never renamed
                var title=clean(n); if(title.length<4) continue;
                var sport=classifySport(n)||classifySport(ch.genre||'')||'Other';
                var tm=teams(title); var k=title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+'@'+t;
                var ev=byKey[k]; if(!ev){ ev={ id:'chev-'+Math.abs(hash(k)), _chev:true, title:title, sport:sport, competition:tm.comp, home:tm.home, away:tm.away,
                    start:new Date(t), end:new Date(t+(LONG[sport]||2.5*3600000)), score:'', minute:'', channels:[] }; byKey[k]=ev; out.push(ev); }
                if(ev.channels.length<8) ev.channels.push({ id:ch.id, name:ch.name, logo:ch.logo||'', order:ch.order, url:ch.url }); }
            cache=out; cacheKey=key; return out; }
        function hash(s){ var h=0; for(var i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return h; }
        // skip anything already shown by the live-score feed on the same channel
        function events(existing){ var taken={}; (existing||[]).forEach(function(e){ (e.channels||[]).forEach(function(c){ if(!c._guess) taken[c.id]=1; }); });
            return build().filter(function(e){ return !e.channels.every(function(c){ return taken[c.id]; }); }); }
        return { events:events, _when:when, _clean:clean, _teams:teams, reset:function(){ cache=null; } };
    })();
