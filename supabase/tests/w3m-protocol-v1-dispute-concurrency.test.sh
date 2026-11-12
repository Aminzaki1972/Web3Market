#!/usr/bin/env bash
# Real two-session PostgreSQL race test for the W3M dispute/deal-row lock.
# Runs only against the disposable PostgreSQL service in the isolated CI workflow.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

psql_w3m() {
  psql -X -q -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
}
wait_for_sleep_query() {
  local app_name="$1"
  for _ in $(seq 1 100); do
    if psql_w3m -At -c "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$app_name' AND state = 'active' AND query LIKE '%pg_sleep%')" | grep -qx t; then
      return 0
    fi
    sleep 0.05
  done
  echo "FAIL: timed out waiting for PostgreSQL session $app_name to reach its lock-holding sleep."
  return 1
}

PROJECT_A="2a000000-0000-4000-8000-000000000001"
DEAL_A="2a000000-0000-4000-8000-000000000002"
PROJECT_B="2b000000-0000-4000-8000-000000000001"
DEAL_B="2b000000-0000-4000-8000-000000000002"
BUYER="21000000-0000-4000-8000-000000000002"
SELLER="22000000-0000-4000-8000-000000000002"
TX_A="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

cleanup() {
  psql_w3m -c "DELETE FROM public.deal_disputes WHERE deal_id IN ('$DEAL_A','$DEAL_B');" >/dev/null 2>&1 || true
  psql_w3m -c "DELETE FROM public.deals WHERE id IN ('$DEAL_A','$DEAL_B');" >/dev/null 2>&1 || true
  psql_w3m -c "DELETE FROM public.projects WHERE id IN ('$PROJECT_A','$PROJECT_B');" >/dev/null 2>&1 || true
}
cleanup
trap cleanup EXIT

psql_w3m <<SQL
INSERT INTO public.projects (id, owner_id, status, github_url)
VALUES ('$PROJECT_A', '$SELLER', 'active', 'https://example.invalid/w3m-concurrency-a'),
       ('$PROJECT_B', '$SELLER', 'active', 'https://example.invalid/w3m-concurrency-b');
INSERT INTO public.deals (id, project_id, buyer_id, seller_id, payment_status, delivery_status, dispute_status, chain_id)
VALUES ('$DEAL_A', '$PROJECT_A', '$BUYER', '$SELLER', 'confirmed', 'accepted', 'none', 56),
       ('$DEAL_B', '$PROJECT_B', '$BUYER', '$SELLER', 'confirmed', 'accepted', 'none', 56);
SQL

# Race 1: the finalizer-side deal row lock wins first. The dispute INSERT
# trigger must wait for that lock, then observe completed settlement and reject.
(export PGAPPNAME=w3m-finalizer-first; psql_w3m > /tmp/w3m-lock-finalizer-first.log 2>&1 <<SQL
BEGIN;
SELECT id FROM public.deals WHERE id = '$DEAL_A' FOR UPDATE;
SELECT pg_sleep(1.5);
UPDATE public.deals
   SET status = 'completed', release_tx_hash = '$TX_A', completed_at = clock_timestamp()
 WHERE id = '$DEAL_A';
COMMIT;
SQL
) &
FINALIZER_PID=$!
wait_for_sleep_query "w3m-finalizer-first"
if DISPUTE_OUTPUT=$(psql_w3m 2>&1 <<SQL
INSERT INTO public.deal_disputes (deal_id, status) VALUES ('$DEAL_A', 'open');
SQL
); then
  wait "$FINALIZER_PID"
  echo "FAIL: active dispute INSERT succeeded after finalizer committed."
  exit 1
fi
wait "$FINALIZER_PID"
if ! grep -q "An active dispute cannot be created or reopened after settlement is completed" <<<"$DISPUTE_OUTPUT"; then
  echo "FAIL: dispute-first race failed for an unexpected reason:"
  echo "$DISPUTE_OUTPUT"
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN status='completed' AND release_tx_hash='$TX_A' AND NOT EXISTS (SELECT 1 FROM public.deal_disputes WHERE deal_id='$DEAL_A') THEN 'PASS' ELSE 'FAIL' END FROM public.deals WHERE id='$DEAL_A';" | grep -qx PASS

# Race 2: dispute INSERT obtains the parent deal lock first. The finalizer-side
# transaction must wait, re-read the now-committed child dispute, and fail closed.
(export PGAPPNAME=w3m-dispute-first; psql_w3m > /tmp/w3m-lock-dispute-first.log 2>&1 <<SQL
BEGIN;
INSERT INTO public.deal_disputes (deal_id, status) VALUES ('$DEAL_B', 'open');
SELECT pg_sleep(1.5);
COMMIT;
SQL
) &
DISPUTE_PID=$!
wait_for_sleep_query "w3m-dispute-first"
if FINALIZE_OUTPUT=$(psql_w3m 2>&1 <<SQL
BEGIN;
SELECT id FROM public.deals WHERE id = '$DEAL_B' FOR UPDATE;
DO \$guard\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.deal_disputes
     WHERE deal_id = '$DEAL_B'
       AND lower(coalesce(status, '')) NOT IN ('resolved', 'closed')
  ) THEN
    RAISE EXCEPTION 'An open, unresolved, or unclassified dispute blocks Safe settlement';
  END IF;
END;
\$guard\$;
UPDATE public.deals
   SET status = 'completed', release_tx_hash = '$TX_A', completed_at = clock_timestamp()
 WHERE id = '$DEAL_B';
COMMIT;
SQL
); then
  wait "$DISPUTE_PID"
  echo "FAIL: finalizer-side guard ignored the dispute committed first."
  exit 1
fi
wait "$DISPUTE_PID"
if ! grep -q "An open, unresolved, or unclassified dispute blocks Safe settlement" <<<"$FINALIZE_OUTPUT"; then
  echo "FAIL: finalizer-first race failed for an unexpected reason:"
  echo "$FINALIZE_OUTPUT"
  exit 1
fi
psql_w3m -At -c "SELECT CASE WHEN status <> 'completed' AND release_tx_hash IS NULL AND EXISTS (SELECT 1 FROM public.deal_disputes WHERE deal_id='$DEAL_B' AND status='open') THEN 'PASS' ELSE 'FAIL' END FROM public.deals WHERE id='$DEAL_B';" | grep -qx PASS

echo "PASS: two independent PostgreSQL sessions proved both dispute/finalizer lock orders."
echo "NOTE: this is a focused dispute/deal-row concurrency proof, not the full finalizer E2E race matrix."
