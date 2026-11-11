# BYO Player for Mac

Desktop shell (Electron 33.4.11) that opens https://byoplayer-pair.netlify.app/app/ and adds a local engine (ffmpeg)
so movies browsers cannot play (MKV, Dolby/EAC3 audio, providers on plain http) play with seeking and resume.

Build (on Linux): put electron-v33.4.11-darwin-{arm64,x64}.zip, ffmpeg-darwin-{arm64,x64} (eugeneware/ffmpeg-static b6.0)
and rcodesign 0.29.0 in `dl/`, copy these files to `app/`, then run `./build_mac.sh`. Output: out/BYO-Player-Mac-{arm64,x64}.zip (ad-hoc signed).
