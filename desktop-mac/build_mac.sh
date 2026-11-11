#!/bin/bash
# Packages BYO Player for Mac (Apple Silicon and Intel) from Electron's macOS builds, and ad-hoc signs it.
set -e
cd "$(dirname "$0")"
RCS=dl/apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign
VER=$(node -p "require('./app/package.json').version")
rm -rf out && mkdir -p out
for A in arm64 x64; do
  D=out/$A; mkdir -p $D; (cd $D && unzip -q ../../dl/electron-$A.zip)
  mv "$D/Electron.app" "$D/BYO Player.app"; APP="$D/BYO Player.app"; C="$APP/Contents"
  python3 - "$C/Info.plist" "$VER" <<'PY'
import plistlib, sys
p=sys.argv[1]; d=plistlib.load(open(p,'rb'))
d.update({'CFBundleName':'BYO Player','CFBundleDisplayName':'BYO Player','CFBundleIdentifier':'com.wexlot.byoplayer',
          'CFBundleShortVersionString':sys.argv[2],'CFBundleVersion':sys.argv[2],'CFBundleIconFile':'byo.icns',
          'NSHumanReadableCopyright':'Wexlot Limited','LSApplicationCategoryType':'public.app-category.entertainment'})
plistlib.dump(d,open(p,'wb'))
PY
  for H in "$C"/Frameworks/*.app; do python3 -c "import plistlib,sys;p=sys.argv[1];d=plistlib.load(open(p,'rb'));d['CFBundleIdentifier']='com.wexlot.byoplayer.helper';plistlib.dump(d,open(p,'wb'))" "$H/Contents/Info.plist"; done
  rm -f "$C/Resources/default_app.asar" "$C/Resources/electron.icns"
  cp byo.icns "$C/Resources/byo.icns"
  mkdir -p "$C/Resources/app" "$C/Resources/bin"
  cp app/package.json app/main.js app/preload.js "$C/Resources/app/"
  cp dl/ffmpeg-$A "$C/Resources/bin/ffmpeg"; chmod 755 "$C/Resources/bin/ffmpeg"
  $RCS sign -e ent.plist "$APP" >/dev/null 2>out/sign-$A.log || { tail -5 out/sign-$A.log; exit 1; }
  (cd $D && zip -qry9 "../BYO-Player-Mac-$A.zip" "BYO Player.app")
  echo "$A: $(du -h out/BYO-Player-Mac-$A.zip | cut -f1)"
done
