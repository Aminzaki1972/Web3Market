#!/usr/bin/env bash
# Two independent PostgreSQL sessions race the REAL W3M Safe finalizer
# against the real open_deal_dispute RPC in both lock orders.
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

# Order A: finalizer commits first; dispute RPC must wait then reject.
run_fixture "dispute-finalizer-first" "61000000-"
psql_w3m -c "GRANT SELECT ON public.w3m_test_finalizer_race_fixture TO authenticated;" >/dev/null
psql_w3m -At -c "SELECT CASE WHEN has_function_privilege('authenticated','public.open_deal_dispute(uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','public.open_deal_dispute(uuid,text)','EXECUTE') AND NOT has_function_privilege('service_role','public.open_deal_dispute(uuid,text)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END;" | grep -qx PASS
(export PGAPPNAME=w3m-finalizer-before-dispute; psql_w3m > /tmp/w3m-finalizer-before-dispute.log 2>&1 <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='dispute-finalizer-first';
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
FINALIZER_PID=$!
wait_for_query "w3m-finalizer-before-dispute" "pg_sleep" "any"
(export PGAPPNAME=w3m-dispute-after-finalizer; psql_w3m > /tmp/w3m-dispute-after-finalizer.log 2>&1 <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub',
  (SELECT buyer_id::text FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='dispute-finalizer-first'),false);
SELECT public.open_deal_dispute(
  (SELECT deal_id FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='dispute-finalizer-first'),
  'race after finalization'
);
SQL
) &
DISPUTE_AFTER_PID=$!
wait_for_query "w3m-dispute-after-finalizer" "open_deal_dispute" "Lock"
wait "$DISPUTE_AFTER_PID" || true
wait "$FINALIZER_PID"
if ! grep -q "Completed or resolved deals cannot be disputed" /tmp/w3m-dispute-after-finalizer.log; then
  echo "FAIL: dispute RPC was not rejected for the expected completed-deal reason:"
  cat /tmp/w3m-dispute-after-finalizer.log
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN d.status='completed' AND p.owner_id=f.buyer_id AND a.state='CONFIRMED' AND NOT EXISTS (SELECT 1 FROM public.deal_disputes x WHERE x.deal_id=d.id) AND (SELECT count(*) FROM public.deal_audit_logs l WHERE l.deal_id=d.id AND l.action='safe_release_confirmed')=1 THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.projects p ON p.id=f.project_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id WHERE f.fixture_key='dispute-finalizer-first';" | grep -qx PASS

# Order B: dispute commits first; finalizer must wait then reject settlement.
run_fixture "dispute-first-finalizer" "62000000-"
(export PGAPPNAME=w3m-dispute-before-finalizer; psql_w3m > /tmp/w3m-dispute-before-finalizer.log 2>&1 <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub',
  (SELECT buyer_id::text FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='dispute-first-finalizer'),false);
SELECT public.open_deal_dispute(
  (SELECT deal_id FROM public.w3m_test_finalizer_race_fixture WHERE fixture_key='dispute-first-finalizer'),
  'race before finalization'
);
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
DISPUTE_PID=$!
wait_for_query "w3m-dispute-before-finalizer" "pg_sleep" "any"
(export PGAPPNAME=w3m-finalizer-after-dispute; psql_w3m > /tmp/w3m-finalizer-after-dispute.log 2>&1 <<'SQL'
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.w3m_finalize_safe_execution_attempt(
  f.attempt_id,f.broadcast_tx_hash,f.buyer_id,f.receipt
) FROM public.w3m_test_finalizer_race_fixture f WHERE f.fixture_key='dispute-first-finalizer';
SQL
) &
FINALIZER_AFTER_PID=$!
wait_for_query "w3m-finalizer-after-dispute" "w3m_finalize_safe_execution_attempt" "Lock"
wait "$FINALIZER_AFTER_PID" || true
wait "$DISPUTE_PID"
if ! grep -q "An open, unresolved, or unclassified dispute blocks Safe settlement" /tmp/w3m-finalizer-after-dispute.log; then
  echo "FAIL: finalizer was not rejected for the expected open-dispute reason:"
  cat /tmp/w3m-finalizer-after-dispute.log
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN d.status='disputed' AND d.dispute_status='open' AND p.owner_id=f.seller_id AND p.status='active' AND a.state='RECONCILIATION_REQUIRED' AND t.status='submitted' AND r.status='locked' AND EXISTS (SELECT 1 FROM public.deal_disputes x WHERE x.deal_id=d.id AND x.status='open') AND NOT EXISTS (SELECT 1 FROM public.deal_audit_logs l WHERE l.deal_id=d.id AND l.action='safe_release_confirmed') THEN 'PASS' ELSE 'FAIL' END FROM public.w3m_test_finalizer_race_fixture f JOIN public.deals d ON d.id=f.deal_id JOIN public.projects p ON p.id=f.project_id JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id JOIN public.deal_multisig_transactions t ON t.deal_id=f.deal_id JOIN public.deal_release_policies r ON r.deal_id=f.deal_id WHERE f.fixture_key='dispute-first-finalizer';" | grep -qx PASS

echo "PASS: two independent PostgreSQL sessions raced the real Safe finalizer and real dispute-opening RPC in both lock orders."
