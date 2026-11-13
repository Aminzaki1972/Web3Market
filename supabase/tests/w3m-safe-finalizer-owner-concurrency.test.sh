#!/usr/bin/env bash
# Two independent PostgreSQL sessions race the REAL W3M Safe finalizer
# against an authenticated project-owner mutation in both lock orders.
# Disposable PostgreSQL only; no production DB or live Safe calls.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

psql_w3m() {
  psql -X -q -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
}

wait_for_query() {
  local app_name="$1" pattern="$2" wait_type="$3"
  for _ in $(seq 1 200); do
    if psql_w3m -At -c "SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity
       WHERE application_name = '$app_name'
         AND state = 'active'
         AND query LIKE '%$pattern%'
         AND ('$wait_type' = 'any' OR wait_event_type = '$wait_type')
    )" | grep -qx t; then return 0; fi
    sleep 0.05
  done
  echo "FAIL: timed out waiting for $app_name ($pattern / $wait_type)"
  return 1
}

cleanup() {
  psql_w3m -c "DROP TABLE IF EXISTS public.w3m_test_finalizer_race_fixture;" >/dev/null 2>&1 || true
}
cleanup
trap cleanup EXIT

run_fixture() {
  local fixture_key="$1" prefix="$2"
  sed \
    -e "s/10000000-0000-4000-8000-000000000001/${prefix}0000-4000-8000-000000000001/g" \
    -e "s/20000000-0000-4000-8000-000000000002/${prefix}0000-4000-8000-000000000002/g" \
    -e "s/21000000-0000-4000-8000-000000000002/${prefix}1000-4000-8000-000000000002/g" \
    -e "s/22000000-0000-4000-8000-000000000002/${prefix}2000-4000-8000-000000000002/g" \
    -e "s/30000000-0000-4000-8000-000000000003/${prefix}3000-4000-8000-000000000003/g" \
    -e "s/40000000-0000-4000-8000-000000000004/${prefix}4000-4000-8000-000000000004/g" \
    -e "s/40000000-0000-4000-8000-000000000005/${prefix}4000-4000-8000-000000000005/g" \
    -e "s/50000000-0000-4000-8000-000000000005/${prefix}5000-4000-8000-000000000005/g" \
    -e "s/75000000-0000-4000-8000-000000000001/${prefix}5000-4000-8000-000000000001/g" \
    -e "s/75100000-0000-4000-8000-000000000001/${prefix}5100-4000-8000-000000000001/g" \
    -e "s/v_safe_hash text := '0x' || repeat('a', 64);/v_safe_hash text := '0x' || repeat('${prefix:1:1}', 64);/g" \
    -e "s/attempt-test-key/attempt-test-key-${fixture_key}/g" \
    -e "s/signer-race-idempotency/signer-idempotency-${fixture_key}/g" \
    -e "s/signer-race/${fixture_key}/g" \
    supabase/tests/w3m-safe-finalizer-concurrency-fixture.sql | psql_w3m
}

# Order A: finalizer owns the project row first. The independent authenticated
# owner mutation waits, then must be rejected by the project trust-field guard.
run_fixture "owner-finalizer-first" "63000000-"
(export PGAPPNAME=w3m-finalizer-before-owner-change; psql_w3m > /tmp/w3m-finalizer-before-owner-change.log 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='owner-finalizer-first';
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
FINALIZER_PID=$!
wait_for_query "w3m-finalizer-before-owner-change" "pg_sleep" "any"
(export PGAPPNAME=w3m-owner-change-after-finalizer; psql_w3m > /tmp/w3m-owner-change-after-finalizer.log 2>&1 <<'SQL'
SELECT set_config('request.jwt.claim.role','authenticated',false);
UPDATE public.projects
   SET owner_id=(SELECT seller_id FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='owner-finalizer-first')
 WHERE id=(SELECT project_id FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='owner-finalizer-first');
SQL
) &
OWNER_AFTER_PID=$!
wait_for_query "w3m-owner-change-after-finalizer" "UPDATE public.projects" "Lock"
wait "$OWNER_AFTER_PID" || true
wait "$FINALIZER_PID"
if ! grep -q "Project owner cannot be changed" /tmp/w3m-owner-change-after-finalizer.log; then
  echo "FAIL: authenticated owner mutation was not rejected after finalization:"
  cat /tmp/w3m-owner-change-after-finalizer.log
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN d.status='completed' AND p.status='sold' AND p.owner_id=f.buyer_id AND a.state='CONFIRMED' AND (SELECT count(*) FROM public.deal_audit_logs l WHERE l.deal_id=d.id AND l.action='safe_release_confirmed')=1 THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.projects p ON p.id=f.project_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id WHERE f.fixture_key='owner-finalizer-first';" | grep -qx PASS

# Order B: authenticated owner mutation obtains the project row lock first.
# It is rejected, releases the lock, and the waiting real finalizer then commits.
run_fixture "owner-first-finalizer" "64000000-"
(export PGAPPNAME=w3m-owner-lock-first; psql_w3m > /tmp/w3m-owner-lock-first.log 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT id FROM public.projects
 WHERE id=(SELECT project_id FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='owner-first-finalizer')
 FOR UPDATE;
SELECT pg_sleep(1.5);
UPDATE public.projects
   SET owner_id=(SELECT buyer_id FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='owner-first-finalizer')
 WHERE id=(SELECT project_id FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='owner-first-finalizer');
COMMIT;
SQL
) &
OWNER_PID=$!
wait_for_query "w3m-owner-lock-first" "pg_sleep" "any"
(export PGAPPNAME=w3m-finalizer-after-owner-lock; psql_w3m > /tmp/w3m-finalizer-after-owner-lock.log 2>&1 <<'SQL'
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='owner-first-finalizer';
SQL
) &
FINALIZER_AFTER_PID=$!
wait_for_query "w3m-finalizer-after-owner-lock" "w3m_finalize_safe_execution_attempt" "Lock"
wait "$OWNER_PID" || true
wait "$FINALIZER_AFTER_PID"
if ! grep -q "Project owner cannot be changed" /tmp/w3m-owner-lock-first.log; then
  echo "FAIL: authenticated owner mutation was not rejected before finalization:"
  cat /tmp/w3m-owner-lock-first.log
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN d.status='completed' AND p.status='sold' AND p.owner_id=f.buyer_id AND a.state='CONFIRMED' AND (SELECT count(*) FROM public.deal_audit_logs l WHERE l.deal_id=d.id AND l.action='safe_release_confirmed')=1 THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.projects p ON p.id=f.project_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id WHERE f.fixture_key='owner-first-finalizer';" | grep -qx PASS

echo "PASS: two independent PostgreSQL sessions raced the real Safe finalizer against authenticated project-owner mutation in both lock orders."
