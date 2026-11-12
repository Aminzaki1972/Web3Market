#!/usr/bin/env bash
# Two independent PostgreSQL sessions race the REAL W3M Safe finalizer
# against the real trusted-signer revocation RPC. Disposable CI database only.
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
  # CI database is disposable and all preceding contract tests roll back their fixtures.
  psql_w3m -c "TRUNCATE public.projects, public.profiles, public.w3m_trusted_signer_keys CASCADE;" >/dev/null 2>&1 || true
  psql_w3m -c "DROP TABLE IF EXISTS public.w3m_test_finalizer_race_fixture;" >/dev/null 2>&1 || true
}
cleanup
trap cleanup EXIT

run_fixture() {
  local fixture_key="$1"
  if [[ "$fixture_key" == "signer-race" ]]; then
    psql_w3m -f supabase/tests/w3m-safe-finalizer-concurrency-fixture.sql
  else
    sed \
      -e "s/10000000-0000-4000-8000-000000000001/11000000-0000-4000-8000-000000000001/g" \
      -e "s/20000000-0000-4000-8000-000000000002/23000000-0000-4000-8000-000000000002/g" \
      -e "s/21000000-0000-4000-8000-000000000002/31000000-0000-4000-8000-000000000002/g" \
      -e "s/22000000-0000-4000-8000-000000000002/32000000-0000-4000-8000-000000000002/g" \
      -e "s/30000000-0000-4000-8000-000000000003/33000000-0000-4000-8000-000000000003/g" \
      -e "s/40000000-0000-4000-8000-000000000004/44000000-0000-4000-8000-000000000004/g" \
      -e "s/40000000-0000-4000-8000-000000000005/44000000-0000-4000-8000-000000000005/g" \
      -e "s/50000000-0000-4000-8000-000000000005/55000000-0000-4000-8000-000000000005/g" \
      -e "s/75000000-0000-4000-8000-000000000001/75500000-0000-4000-8000-000000000001/g" \
      -e "s/75100000-0000-4000-8000-000000000001/75600000-0000-4000-8000-000000000001/g" \
      -e "s/attempt-test-key/attempt-test-key-2/g" \
      -e "s/signer-race/signer-race-2/g" \
      supabase/tests/w3m-safe-finalizer-concurrency-fixture.sql | psql_w3m
  fi
}

# Lock order A: finalizer commits while holding the signer row lock;
# the independent revocation RPC must wait and then append REVOKED.
run_fixture "signer-race"
(export PGAPPNAME=w3m-finalizer-first; psql_w3m > /tmp/w3m-finalizer-first.log 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='signer-race';
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
FINALIZER_PID=$!
wait_for_query "w3m-finalizer-first" "pg_sleep" "any"
(export PGAPPNAME=w3m-revoke-after-finalizer; psql_w3m > /tmp/w3m-revoke-after-finalizer.log 2>&1 <<'SQL'
SELECT public.w3m_revoke_trusted_signer_key(
  'attempt-test-key',
  jsonb_build_object(
    'event_type','REVOKED','key_id','attempt-test-key',
    'actor_type','SYSTEM','reason','concurrency test',
    'event_hash',repeat('f',64)
  )
);
SQL
) &
REVOKE_PID=$!
wait_for_query "w3m-revoke-after-finalizer" "w3m_revoke_trusted_signer_key" "Lock"
wait "$FINALIZER_PID"
wait "$REVOKE_PID"
psql_w3m -At -c "SELECT CASE WHEN d.status='completed' AND p.status='sold' AND p.owner_id=f.buyer_id AND a.state='CONFIRMED' AND t.status='confirmed' AND r.status='released' AND (SELECT count(*) FROM public.deal_audit_logs l WHERE l.deal_id=d.id AND l.action='safe_release_confirmed')=1 AND (SELECT event_type FROM public.w3m_trusted_signer_key_events e WHERE e.key_id=f.signer_key_id ORDER BY event_id DESC LIMIT 1)='REVOKED' THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.projects p ON p.id=f.project_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id JOIN public.deal_multisig_transactions t ON t.deal_id=f.deal_id JOIN public.deal_release_policies r ON r.deal_id=f.deal_id WHERE f.fixture_key='signer-race';" | grep -qx PASS

# Lock order B: revocation commits first; the real finalizer must wait,
# re-read the signer event and reject without changing any settlement state.
run_fixture "signer-race-2"
(export PGAPPNAME=w3m-revoke-first; psql_w3m > /tmp/w3m-revoke-first.log 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.w3m_revoke_trusted_signer_key(
  'attempt-test-key-2',
  jsonb_build_object(
    'event_type','REVOKED','key_id','attempt-test-key-2',
    'actor_type','SYSTEM','reason','concurrency test',
    'event_hash',repeat('e',64)
  )
);
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
REVOKE_FIRST_PID=$!
wait_for_query "w3m-revoke-first" "pg_sleep" "any"
if (export PGAPPNAME=w3m-finalizer-after-revoke; psql_w3m > /tmp/w3m-finalizer-after-revoke.log 2>&1 <<'SQL'
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='signer-race-2';
SQL
); then
  wait "$REVOKE_FIRST_PID"
  echo "FAIL: finalizer succeeded after signer revocation committed first."
  exit 1
fi
wait "$REVOKE_FIRST_PID"
if ! grep -q "Pinned report signer has been revoked" /tmp/w3m-finalizer-after-revoke.log; then
  echo "FAIL: finalizer rejected for an unexpected reason:"
  cat /tmp/w3m-finalizer-after-revoke.log
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN d.status <> 'completed' AND d.release_tx_hash IS NULL AND p.owner_id=f.seller_id AND p.status='active' AND a.state='RECONCILIATION_REQUIRED' AND t.status='submitted' AND r.status='locked' AND NOT EXISTS (SELECT 1 FROM public.deal_audit_logs l WHERE l.deal_id=d.id AND l.action='safe_release_confirmed') THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.projects p ON p.id=f.project_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id JOIN public.deal_multisig_transactions t ON t.deal_id=f.deal_id JOIN public.deal_release_policies r ON r.deal_id=f.deal_id WHERE f.fixture_key='signer-race-2';" | grep -qx PASS

echo "PASS: two independent PostgreSQL sessions raced the real Safe finalizer and signer-revocation RPC in both lock orders."
