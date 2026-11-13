#!/usr/bin/env bash
# Two independent PostgreSQL sessions race evidence append against the REAL
# execution-claim RPC and evidence trigger in both lock orders.
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
       WHERE application_name = '$app_name' AND state = 'active'
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

reset_fixture_attempt() {
  local fixture_key="$1"
  psql_w3m -v fixture_key="$fixture_key" <<'SQL'
UPDATE public.w3m_safe_execution_attempts a
   SET state='FAILED', finalized_at=clock_timestamp(),
       safe_tx_hash='0x' || repeat('f',64),
       broadcast_tx_hash=NULL, broadcast_at=NULL
  FROM public.w3m_test_finalizer_race_fixture f
 WHERE f.fixture_key=:'fixture_key' AND a.id=f.attempt_id;
UPDATE public.deal_multisig_transactions t
   SET status='signed', tx_hash=NULL
  FROM public.w3m_test_finalizer_race_fixture f
 WHERE f.fixture_key=:'fixture_key' AND t.id=(
   SELECT transaction_id FROM public.w3m_safe_execution_attempts
    WHERE id=f.attempt_id
 );
SQL
}

append_evidence_sql() {
  local fixture_key="$1"
  psql_w3m -v fixture_key="$fixture_key" <<'SQL'
INSERT INTO public.w3m_acquisition_evidence (
  report_id,evidence_type,source_table,source_record_id,source_version,
  evidence_hash,result,mandatory,observed_at,valid_until,details
)
SELECT a.report_id,'DISPUTE_CHECK',null,null,null,repeat('9',64),'PASS',true,
       clock_timestamp(),clock_timestamp()+interval '1 hour',
       jsonb_build_object('test','two-session evidence append race')
  FROM public.w3m_test_finalizer_race_fixture f
  JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
 WHERE f.fixture_key=:'fixture_key';
SQL
}

claim_sql() {
  cat <<'SQL'
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.w3m_claim_safe_execution_attempt(
  f.deal_id,a.transaction_id,a.report_id,
  '0x' || repeat(substr(f.fixture_key,1,1),64),
  f.buyer_id::text,
  'evidence-race-claim-' || f.fixture_key
)
FROM public.w3m_test_finalizer_race_fixture f
JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
WHERE f.fixture_key=:'fixture_key';
SQL
}

# Order A: evidence INSERT owns the shared deal advisory lock first. The real
# claim RPC waits, then pins the report after the extra evidence row commits.
run_fixture "evidence-append-first" "67000000-"
reset_fixture_attempt "evidence-append-first"
(export PGAPPNAME=w3m-evidence-append-first; psql_w3m > /tmp/w3m-evidence-append-first.log 2>&1 <<'SQL'
BEGIN;
INSERT INTO public.w3m_acquisition_evidence (
  report_id,evidence_type,source_table,source_record_id,source_version,
  evidence_hash,result,mandatory,observed_at,valid_until,details
)
SELECT a.report_id,'DISPUTE_CHECK',null,null,null,repeat('9',64),'PASS',true,
       clock_timestamp(),clock_timestamp()+interval '1 hour',
       jsonb_build_object('test','append-first')
  FROM public.w3m_test_finalizer_race_fixture f
  JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
 WHERE f.fixture_key='evidence-append-first';
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
APPEND_PID=$!
wait_for_query "w3m-evidence-append-first" "pg_sleep" "any"
(export PGAPPNAME=w3m-claim-after-evidence; claim_sql "evidence-append-first" | psql_w3m -v fixture_key="evidence-append-first" > /tmp/w3m-claim-after-evidence.log 2>&1) &
CLAIM_PID=$!
wait_for_query "w3m-claim-after-evidence" "w3m_claim_safe_execution_attempt" "Lock"
wait "$CLAIM_PID"
wait "$APPEND_PID"
if grep -qi "ERROR:" /tmp/w3m-claim-after-evidence.log; then
  echo "FAIL: claim did not complete after append-first ordering:"
  cat /tmp/w3m-claim-after-evidence.log
  exit 1
fi
psql_w3m -At -v fixture_key="evidence-append-first" <<'SQL' | grep -qx PASS
SELECT CASE WHEN
  (SELECT count(*) FROM public.w3m_acquisition_evidence e
    JOIN public.w3m_test_finalizer_race_fixture f
      ON f.fixture_key=:'fixture_key'
    JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
   WHERE e.report_id=a.report_id)=3
  AND (SELECT count(*) FROM public.w3m_safe_execution_attempts a
    JOIN public.w3m_test_finalizer_race_fixture f ON f.fixture_key=:'fixture_key'
   WHERE a.deal_id=f.deal_id AND a.state='CLAIMED')=1
  AND (SELECT a.pinned_evidence_hash=r.evidence_hash
    FROM public.w3m_test_finalizer_race_fixture f
    JOIN public.w3m_safe_execution_attempts a ON a.deal_id=f.deal_id AND a.state='CLAIMED'
    JOIN public.w3m_acquisition_reports r ON r.id=a.report_id
   WHERE f.fixture_key=:'fixture_key')
THEN 'PASS' ELSE 'FAIL' END;
SQL
# The database claim does not recompute the changed evidence manifest. The
# coordinator's second fresh authorization must detect it and not broadcast.

# Order B: claim owns the shared deal advisory lock first. Evidence INSERT waits,
# then the real evidence trigger must reject it with SQLSTATE 55000.
run_fixture "evidence-claim-first" "68000000-"
reset_fixture_attempt "evidence-claim-first"
(export PGAPPNAME=w3m-evidence-claim-first; {
  echo "BEGIN;"
  claim_sql "evidence-claim-first"
  echo "SELECT pg_sleep(1.5);"
  echo "COMMIT;"
} | psql_w3m -v fixture_key="evidence-claim-first" > /tmp/w3m-evidence-claim-first.log 2>&1) &
CLAIM_FIRST_PID=$!
wait_for_query "w3m-evidence-claim-first" "pg_sleep" "any"
(export PGAPPNAME=w3m-append-after-claim; append_evidence_sql "evidence-claim-first" > /tmp/w3m-append-after-claim.log 2>&1) &
APPEND_AFTER_PID=$!
wait_for_query "w3m-append-after-claim" "INSERT INTO public.w3m_acquisition_evidence" "Lock"
wait "$APPEND_AFTER_PID" || true
wait "$CLAIM_FIRST_PID"
if ! grep -q "Evidence manifest is frozen after an execution attempt pins the report" /tmp/w3m-append-after-claim.log; then
  echo "FAIL: evidence append after claim was not rejected for the expected reason:"
  cat /tmp/w3m-append-after-claim.log
  exit 1
fi
psql_w3m -At -v fixture_key="evidence-claim-first" <<'SQL' | grep -qx PASS
SELECT CASE WHEN
  (SELECT count(*) FROM public.w3m_acquisition_evidence e
    JOIN public.w3m_test_finalizer_race_fixture f ON f.fixture_key=:'fixture_key'
    JOIN public.w3m_safe_execution_attempts a ON a.id=f.attempt_id
   WHERE e.report_id=a.report_id)=2
  AND (SELECT count(*) FROM public.w3m_safe_execution_attempts a
    JOIN public.w3m_test_finalizer_race_fixture f ON f.fixture_key=:'fixture_key'
   WHERE a.deal_id=f.deal_id AND a.state='CLAIMED')=1
THEN 'PASS' ELSE 'FAIL' END;
SQL

echo "PASS: two independent PostgreSQL sessions raced evidence append against the real execution-claim RPC and evidence trigger in both lock orders."
