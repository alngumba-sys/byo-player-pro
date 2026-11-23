#!/usr/bin/env bash
# Sends a check-in "welcome" to a room TV through Supabase (no adb, no cable).
# Usage: ./hotel-send.sh <hotel-secret> <room number> "<guest name>" [hotel-code]
# The secret is in Supabase: select code, secret from byo.hotels;
SECRET="${1:?hotel secret}"; ROOM="${2:?room number}"; NAME="${3:-Guest}"; HOTEL="${4:-savanna-demo}"
URL="https://lkftnbkuuitaxtlvrqfj.supabase.co/rest/v1/rpc/byo_hotel_checkin"
KEY="sb_publishable_D5tMkCSL1AVvJS8S9fuPgQ_nOg_ItOY"
curl -s -X POST "$URL" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  --data "$(python3 -c 'import json,sys; print(json.dumps({"p_hotel":sys.argv[1],"p_secret":sys.argv[2],"p_room":sys.argv[3],"p_name":sys.argv[4]}))' "$HOTEL" "$SECRET" "$ROOM" "$NAME")"
echo
