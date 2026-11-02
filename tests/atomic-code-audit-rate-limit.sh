#!/usr/bin/env bash
set -euo pipefail
fingerprint="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
window="2026-11-02 10:00:00+00"
next_window="2026-11-02 11:00:00+00"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
psql -v ON_ERROR_STOP=1 -c "DELETE FROM public.code_audit_rate_limits WHERE fingerprint='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';"
for i in $(seq 1 20); do
  (
    psql -v ON_ERROR_STOP=1 -At -c "SELECT public.reserve_code_audit_slot('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-02 10:00:00+00'::timestamptz,3)" > "$tmpdir/$i"
  ) &
done
wait
accepted="$(grep -hE '^[123]$' "$tmpdir"/* | wc -l | tr -d ' ')"
test "$accepted" = "3"
count="$(psql -At -c "SELECT request_count FROM public.code_audit_rate_limits WHERE fingerprint='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' AND window_started_at='2026-11-02 10:00:00+00'::timestamptz")"
test "$count" = "3"
echo "PASS: 20 concurrent requests reserve exactly 3 slots."
refunded="$(psql -At -c "SELECT public.refund_code_audit_slot('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-02 10:00:00+00'::timestamptz)")"
test "$refunded" = "2"
reserved="$(psql -At -c "SELECT public.reserve_code_audit_slot('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-02 10:00:00+00'::timestamptz,3)")"
test "$reserved" = "3"
echo "PASS: exact-window refund decrements once and releases one slot."
next="$(psql -At -c "SELECT public.reserve_code_audit_slot('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-02 11:00:00+00'::timestamptz,3)")"
test "$next" = "1"
echo "PASS: hourly windows are isolated."
if psql -v ON_ERROR_STOP=1 -c "SET ROLE anon; SELECT public.reserve_code_audit_slot('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-02 10:00:00+00'::timestamptz,3);" >/dev/null 2>&1; then
  echo "FAIL: anon can execute the reservation RPC"
  exit 1
fi
if psql -v ON_ERROR_STOP=1 -c "SET ROLE authenticated; SELECT public.refund_code_audit_slot('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-02 10:00:00+00'::timestamptz);" >/dev/null 2>&1; then
  echo "FAIL: authenticated can execute the refund RPC"
  exit 1
fi
service_result="$(psql -v ON_ERROR_STOP=1 -At -c "SET ROLE service_role; SELECT public.reserve_code_audit_slot('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-02 11:00:00+00'::timestamptz,3)")"
test "$service_result" = "2"
echo "PASS: only service_role can execute quota RPCs."
