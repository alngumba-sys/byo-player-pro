# BYO Player Pro: working rules

## When I say "deploy"
Run these steps in order, in this folder:
1. git pull
2. git status, and check no secret files are included (see below)
3. git add -A
4. git commit -m "<short plain description of what changed>"
5. git push
Then tell me what was pushed. Pushing to main redeploys the web version automatically.

## Never commit
- Any keystore file (*.keystore, *.jks)
- Provider logins, passwords or API keys
This repo is PUBLIC. If git status shows any such file, stop and tell me instead of pushing.

## Other rules
- Never use em dashes in anything written for me.
- The Android app file is always named tv3247.apk. New signed APKs are built in my cloud Claude session, not on this Mac.
