    /* ============================================================================
       Extra stream settings carried inside playlists. Many channels only play
       when the player sends the right User-Agent, Referer, Origin or Cookie.
       Understood formats:
         #EXTVLCOPT:http-user-agent=...  / http-referrer= / http-origin= / http-cookie=
         #EXTHTTP:{"User-Agent":"...","cookie":"..."}
         #KODIPROP:inputstream.adaptive.stream_headers=User-Agent=...&Referer=...
         #KODIPROP:inputstream.adaptive.manifest_headers=...
         #KODIPROP:inputstream.adaptive.license_type= / license_key=   (protected streams)
         #EXTINF ... user-agent="..." referrer="..."
         http://stream.url|User-Agent=...&Referer=...
       The headers are remembered per stream link and sent by the native player.
       ============================================================================ */
    var StreamOpts=(function(){
        var REG={};   // clean url -> { headers:{}, drm:{type,key} }
        var count=0;
        function canon(k){ k=String(k||'').trim().toLowerCase().replace(/^http-/,'');
            if(k==='user-agent'||k==='useragent'||k==='ua') return 'User-Agent';
            if(k==='referrer'||k==='referer') return 'Referer';
            if(k==='origin') return 'Origin';
            if(k==='cookie'||k==='cookies') return 'Cookie';
            if(k==='x-forwarded-for') return 'X-Forwarded-For';
            if(k==='authorization') return 'Authorization';
            return null; }
        function dec(v){ v=String(v==null?'':v).trim(); try{ if(/%[0-9A-F]{2}/i.test(v)) v=decodeURIComponent(v); }catch(e){} return v.replace(/^"|"$/g,''); }
        function put(o, k, v){ var c=canon(k); v=dec(v); if(!c||!v) return; (o.headers=o.headers||{})[c]=v; }
        function kv(o, s){ String(s||'').split('&').forEach(function(p){ var i=p.indexOf('='); if(i>0) put(o, p.slice(0,i), p.slice(i+1)); }); }
        // One "#..." line between #EXTINF and the link (or before #EXTINF).
        function line(l, o){ var m;
            if((m=l.match(/^#EXTVLCOPT:\s*([a-z-]+)\s*=\s*(.*)$/i))) put(o, m[1], m[2]);
            else if((m=l.match(/^#EXTHTTP:\s*(\{.*\})\s*$/i))){ try{ var j=JSON.parse(m[1]); for(var k in j) put(o, k, j[k]); }catch(e){} }
            else if((m=l.match(/^#KODIPROP:\s*inputstream\.adaptive\.(stream_headers|manifest_headers)\s*=\s*(.*)$/i))) kv(o, m[2]);
            else if((m=l.match(/^#KODIPROP:\s*inputstream\.adaptive\.license_type\s*=\s*(.*)$/i))) (o.drm=o.drm||{}).type=m[1].trim();
            else if((m=l.match(/^#KODIPROP:\s*inputstream\.adaptive\.license_key\s*=\s*(.*)$/i))) (o.drm=o.drm||{}).key=m[1].trim();
            else if((m=l.match(/^#KODIPROP:\s*inputstream\.adaptive\.drm_legacy\s*=\s*(.*)$/i))){ var parts=m[1].split('|'); (o.drm=o.drm||{}).type=parts[0]; if(parts[1]) o.drm.key=parts[1]; }
        }
        function extinf(l, o){ var re=/(user-agent|http-user-agent|tvg-user-agent|referrer|http-referrer|referer|http-referer|origin|http-origin)="([^"]*)"/ig, m;
            while((m=re.exec(l))) put(o, m[1].replace(/^tvg-/,''), m[2]); }
        // Link with "|Header=value&..." on the end: strip it and keep the headers.
        function url(u, o){ u=String(u||'').trim(); var i=u.indexOf('|');
            if(i>0&&/^https?:\/\//i.test(u)){ kv(o, u.slice(i+1)); u=u.slice(0,i); }
            return u; }
        function reg(u, o){ if(!u||!o) return; if((o.headers&&Object.keys(o.headers).length)||o.drm){ REG[u]={ headers:o.headers||null, drm:o.drm||null }; count++; } }
        function forUrl(u){ return REG[String(u||'')]||null; }
        function headersFor(u){ var r=forUrl(u); return r&&r.headers?r.headers:null; }
        function drmFor(u){ var r=forUrl(u); return r&&r.drm?r.drm:null; }
        // Normalise a playlist's DRM notes: { type:'clearkey'|'widevine'|'playready'|'other', keys:[{kid,key}] (hex), licenseUrl }
        function hex(v){ v=String(v||'').trim(); if(/^[0-9a-f]{32}$/i.test(v.replace(/-/g,''))) return v.replace(/-/g,'').toLowerCase();
            try{ var b=atob(v.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((v.length+3)%4)); if(b.length===16){ var h=''; for(var i=0;i<16;i++){ h+=('0'+b.charCodeAt(i).toString(16)).slice(-2); } return h; } }catch(e){} return ''; }
        function info(d){ if(!d) return null; var t=String(d.type||'').toLowerCase(); var out={ type:/clearkey|w3\.clearkey/.test(t)?'clearkey':(/widevine/.test(t)?'widevine':(/playready/.test(t)?'playready':(t?'other':'clearkey'))), keys:[], licenseUrl:'' };
            var k=String(d.key||'').trim();
            if(/^https?:\/\//i.test(k)){ out.licenseUrl=k.split('|')[0]; return out; }
            if(k.charAt(0)==='{'){ try{ var j=JSON.parse(k); if(Array.isArray(j.keys)) j.keys.forEach(function(x){ var a=hex(x.kid), b=hex(x.k||x.key); if(a&&b) out.keys.push({kid:a,key:b}); }); else for(var kk in j){ var a2=hex(kk), b2=hex(j[kk]); if(a2&&b2) out.keys.push({kid:a2,key:b2}); } }catch(e){} return out; }
            k.split(/[,;\s]+/).forEach(function(pair){ var p=pair.split(':'); if(p.length===2){ var a=hex(p[0]), b=hex(p[1]); if(a&&b) out.keys.push({kid:a,key:b}); } });
            return out; }
        function drmInfo(u){ return info(drmFor(u)); }
        // Can this app play it? clearkey with keys or a licence link: yes (Android app). Widevine / PlayReady: no.
        function playable(i){ if(!i) return true; if(i.type==='clearkey') return !!(i.keys.length||i.licenseUrl); return false; }
        return { line:line, extinf:extinf, url:url, reg:reg, headersFor:headersFor, drmFor:drmFor, drmInfo:drmInfo, info:info, playable:playable, count:function(){ return count; } };
    })();
    window.__byoStreamOpts=StreamOpts;
