#!/usr/bin/env bash
# Simulates a hotel check-in: wakes the Android TV and opens BYO Player on the guest welcome screen.
# Usage: ./hotel-checkin.sh <tv-ip> "<guest name>" [tv-mac-for-wake-on-lan]
# One-time TV setup: Settings > Device Preferences > About > tap "Build" 7 times, then
#   Developer options > turn on USB debugging (and Network/Wireless debugging if shown).
# On the first run the TV asks "Allow USB debugging?": tick "Always allow" and press Allow.
# Also in BYO Player: Settings > Startup > turn on "Hotel mode".
set -u
IP="${1:?TV ip address}"; NAME="${2:-Guest}"; MAC="${3:-}"
NAME="${NAME//[^[:alnum:] .\'-]/}"
command -v adb >/dev/null || { echo "adb not found. Mac: brew install android-platform-tools"; exit 1; }

if [ -n "$MAC" ]; then   # wakes a TV in deep standby, if the TV has 'Wake on LAN/Wi-Fi' enabled
python3 - "$MAC" <<'PY'
import socket,sys
m=bytes.fromhex(sys.argv[1].replace(':','').replace('-',''))
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1)
for _ in range(3): s.sendto(b'\xff'*6+m*16,('255.255.255.255',9))
print("wake-on-lan packet sent")
PY
  sleep 12
fi

for i in 1 2 3 4 5 6; do
  adb connect "$IP:5555" 2>&1 | grep -q "connected" && break; sleep 3
done
adb -s "$IP:5555" get-state >/dev/null 2>&1 || { echo "Cannot reach the TV over adb ($IP:5555). Check the debugging setting and that the TV is awake on the same network."; exit 1; }
adb -s "$IP:5555" shell input keyevent KEYCODE_WAKEUP
sleep 2
adb -s "$IP:5555" shell "am start --activity-clear-top -n com.wexlot.byoplayerpro/.MainActivity --es byo_welcome '$NAME'"
echo "Sent check-in for: $NAME"
