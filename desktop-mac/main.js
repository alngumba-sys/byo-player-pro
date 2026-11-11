// BYO Player for Mac. The window shows the same app as the web version (so it updates itself), and a small
// local engine (ffmpeg) plays the movies browsers cannot: MKV files, Dolby audio and providers on plain http.
const { app, BrowserWindow, Menu, shell, ipcMain, session } = require('electron');
const http = require('http'), path = require('path'), fs = require('fs'), { spawn } = require('child_process');

const APP_URL = process.env.BYO_APP_URL || 'https://byoplayer-pair.netlify.app/app/';
const VERSION = '1.0.0';
app.setName('BYO Player');

// ---------- local video engine ----------
function ffmpegPath(){
  const cands = [ path.join(process.resourcesPath || '', 'bin', 'ffmpeg'), path.join(__dirname, 'bin', 'ffmpeg'), process.env.BYO_FFMPEG || '', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg' ];
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch (e) {} }
  return 'ffmpeg';
}
const FF = ffmpegPath();
const NET = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '20', '-rw_timeout', '30000000'];
const probes = new Map();      // url -> Promise<info>
let current = null;            // the one running ffmpeg (a provider allows few connections)

function probe(url){
  if (probes.has(url)) return probes.get(url);
  const p = new Promise((resolve) => {
    const ff = spawn(FF, ['-hide_banner', ...NET, '-i', url], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '', done = false;
    const fin = () => { if (done) return; done = true; try { ff.kill('SIGKILL'); } catch (e) {}
      const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const dur = d ? (+d[1]) * 3600 + (+d[2]) * 60 + (+d[3]) : 0;
      const v = /Stream #\d+:\d+[^:]*: Video: (\w+)/.exec(err), a = /Stream #\d+:\d+[^:]*: Audio: (\w+)/.exec(err);
      resolve({ ok: !!(v || a), duration: dur, video: v ? v[1] : '', audio: a ? a[1] : '' }); };
    ff.stderr.on('data', (b) => { err += b.toString(); if (err.length > 200000) err = err.slice(-200000); });
    ff.on('close', fin); setTimeout(fin, 30000);
  });
  probes.set(url, p); p.then((i) => { if (!i.ok) probes.delete(url); });
  return p;
}

function stopCurrent(){ if (current) { try { current.kill('SIGKILL'); } catch (e) {} current = null; } }

async function stream(req, res, url, t){
  const info = await probe(url);
  stopCurrent();
  const vcopy = /^(h264|hevc)$/.test(info.video);
  const acopy = /^(aac|mp3)$/.test(info.audio);
  const args = ['-hide_banner', '-loglevel', 'error', ...NET];
  if (t > 0) args.push('-ss', String(t));
  args.push('-i', url, '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn');
  if (vcopy) { args.push('-c:v', 'copy'); if (info.video === 'hevc') args.push('-tag:v', 'hvc1'); }
  else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
  if (acopy) args.push('-c:a', 'copy'); else args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
  args.push('-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', 'pipe:1');
  const ff = spawn(FF, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  current = ff; let started = false, err = '';
  ff.stderr.on('data', (b) => { err += b.toString(); });
  ff.stdout.once('data', () => { started = true; });
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  ff.stdout.pipe(res);
  ff.on('close', (code) => { if (current === ff) current = null; if (!started) { try { res.destroy(new Error(err.slice(0, 300) || 'ffmpeg ' + code)); } catch (e) {} } else { try { res.end(); } catch (e) {} } });
  req.on('close', () => { try { ff.kill('SIGKILL'); } catch (e) {} });
}

let PORT = 0;
const server = http.createServer(async (req, res) => {
  try {
    const q = new URL(req.url, 'http://127.0.0.1');
    const u = q.searchParams.get('u') || '';
    if (!/^https?:\/\//i.test(u)) { res.writeHead(400); return res.end('bad url'); }
    if (q.pathname === '/probe') { const i = await probe(u); res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify(i)); }
    if (q.pathname === '/stream') return stream(req, res, u, Math.max(0, parseFloat(q.searchParams.get('t') || '0') || 0));
    res.writeHead(404); res.end();
  } catch (e) { try { res.writeHead(500); res.end(String(e)); } catch (_e) {} }
});
ipcMain.on('byo-desktop', (e) => { e.returnValue = { base: 'http://127.0.0.1:' + PORT, version: VERSION, platform: process.platform, arch: process.arch }; });

// ---------- window ----------
let win = null;
function offlinePage(){
  return 'data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:0;background:#070b14;color:#e8eef6;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><div style="font-size:26px;font-weight:700;margin-bottom:10px">BYO Player needs the internet to start</div><div style="color:#9fb0c0;margin-bottom:24px">Check your connection, then try again.</div><button onclick="location.href=\'' + APP_URL + '\'" style="background:#2fd4e8;color:#06212a;border:0;border-radius:12px;padding:14px 28px;font-size:17px;font-weight:700;cursor:pointer">Try again</button></div></body>');
}
function createWindow(){
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600, backgroundColor: '#070b14', title: 'BYO Player', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false,
      webSecurity: false, allowRunningInsecureContent: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/Electron\/\S+\s?/, '') + ' BYODesktop/' + VERSION);
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) win.loadURL(offlinePage()); });
  // Links to other sites (support, WhatsApp, payments) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('https://byoplayer-pair.netlify.app/') && !url.startsWith(APP_URL) && !url.startsWith('data:')) { e.preventDefault(); shell.openExternal(url); } });
  win.loadURL(APP_URL);
}

function menu(){
  const t = [
    { label: 'BYO Player', submenu: [ { label: 'About BYO Player', role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' } ] },
    { label: 'Edit', submenu: [ { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' } ] },
    { label: 'View', submenu: [ { role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' } ] },
    { label: 'Window', submenu: [ { role: 'minimize' }, { role: 'zoom' }, { role: 'close' } ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

app.setAboutPanelOptions({ applicationName: 'BYO Player', applicationVersion: VERSION, copyright: 'Wexlot Limited' });
app.whenReady().then(() => {
  server.listen(0, '127.0.0.1', () => { PORT = server.address().port; menu(); createWindow(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { stopCurrent(); app.quit(); });
app.on('before-quit', stopCurrent);
