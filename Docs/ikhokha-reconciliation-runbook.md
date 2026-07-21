# iKhokha reconciliation runbook

## Purpose and authority

Use `tools/reconcile-ikhokha.mjs` only to correct an existing local order state after authoritative iKhokha evidence proves that provider and local records disagree. It must not create a payment, PayLink, refund, order, stock movement, message, or fulfilment action.

A successful deployment does not reconcile historical orders. Browser redirects are not payment evidence. Provider identifiers are authoritative; basket, customer and time matching may group probable duplicates but can never establish payment ownership.

Dry-run approval does not authorise apply. A production apply requires explicit human approval for the exact incident ID, evidence snapshot, ETag and order allowlist.

## Required evidence

Before evidence mode, collect a fresh, checksummed snapshot outside Git containing:

- the complete orders Blob and its strong-read ETag;
- expected total order count and production site ID;
- payment-attempt and payment-audit records;
- authoritative external transaction or PayLink identifier;
- provider status, amount, currency and timestamp with timezone;
- provider Sale/receipt evidence or masked payer corroboration;
- current provider status for every proposed order;
- stock, email and fulfilment evidence for every cluster order;
- written operator confirmation about manual/off-platform side effects;
- an explicit compensating rollback record for every proposed mutation.

Use anonymised references in tickets and chat, such as `LUL-…PAID`, `LUL-…DUP1` and `incident-example-001`. Keep complete identifiers only in the access-controlled evidence package.

## Evidence and dry-run process

1. Take a fresh production snapshot using strong Blob reads.
2. Query every cluster PayLink read-only and record its status.
3. Build the evidence input in a secure directory outside the repository.
4. Run default evidence mode without `--apply`.
5. Resolve every blocker.
6. Run `--dry-run` and save the redacted report.
7. Verify exactly one authoritative retained order, an unambiguous duplicate cluster, the expected order count, zero side effects, rollback data and the snapshot ETag.
8. Obtain human approval for that exact report. Do not infer apply permission from dry-run approval.

Default and dry-run modes do not connect to production or write data.

## Apply gate

Apply is permitted only after explicit human approval and requires all of:

- `--apply` and `--confirm-apply`;
- an exact `--incident-id` matching the evidence;
- an exact comma-separated `--allow-orders` list;
- zero blockers and exactly one retained order;
- complete authoritative provider evidence;
- fresh provider statuses for the retained order and every duplicate;
- a fresh production ETag and expected order count;
- evidence, before/after state, audit data and rollback data for every mutation;
- confirmed absence of stock, email and fulfilment side effects.

Immediately before writing, the tool re-reads the orders Blob strongly, compares every record with the reviewed snapshot, re-queries provider status, and performs one conditional write. An ETag conflict, changed record, changed provider status, unexpected count, ambiguous identifier or allowlist mismatch aborts without retry.

Never manually edit the Blob or automatically retry a rejected write. Take a new snapshot, regenerate the dry-run and obtain new approval.

## Verification

After apply, take a second snapshot and verify:

- total order count is unchanged;
- only allowlisted orders changed;
- unrelated records are byte-for-byte unchanged;
- exactly one cluster order is Paid;
- audit and payment-event counts match the reviewed proposal;
- inventory, payment attempts and non-order Blobs are unchanged;
- provider states still match;
- no order, PayLink, refund, email or fulfilment action was created;
- Function logs contain no new authentication, Blob or 5xx failures.

## Rollback and escalation

Rollback only when verification shows a wrong paid owner, unexpected record change, multiple paid cluster orders, malformed/missing audit data or a forbidden side effect. Do not rollback over newer legitimate provider evidence.

Use the generated compensating records and a conditional write against the post-apply ETag. If the ETag or provider evidence changed, stop and escalate to the incident owner, payment operator and engineering reviewer. Never retry automatically.

## Prohibited actions

The reconciliation workflow must not:

- delete orders or rewrite customer, basket, price, delivery or creation data;
- reserve, deduct or restore stock;
- send email, WhatsApp or customer notifications;
- create fulfilment, courier, collection, refund, payment or PayLink activity;
- treat a browser return as payment confirmation;
- print secrets, HMACs, tokens, full callback payloads, card data or unmasked payer details;
- commit evidence, exports, screenshots, credentials or customer/payment records.

## Secure evidence handling

Store evidence outside Git with owner-only permissions. Record SHA-256 checksums and preserve originals unchanged. `/tmp` is temporary and must not be the sole long-term copy. Move the encrypted archive to an organisation-approved encrypted incident vault with access logging and retention controls. Do not upload evidence without authorisation.

## Monitoring plan

Monitoring changes belong in a separate reviewed runtime commit.

| Event name | Severity | Redacted fields | Alert threshold | Operator response |
|---|---|---|---|---|
| `ikhokha.callback.unauthorized` | High | correlation ID, masked order suffix, content type | 2 in 10 minutes or any known paid transaction | Compare provider delivery logs and callback canonicalisation; do not mark paid manually. |
| `ikhokha.request.invalid_signature` | High | endpoint name, HTTP status, masked reference | Any production occurrence | Stop affected verification flow and verify pathname/body signing configuration. |
| `ikhokha.callback.amount_mismatch` | Critical | masked order, expected/received minor units, currency | Any occurrence | Block mutation and obtain provider transaction evidence. |
| `ikhokha.callback.reference_mismatch` | Critical | masked external reference and candidate order | Any occurrence | Block mutation; investigate duplicate ownership. |
| `ikhokha.callback.paylink_mismatch` | Critical | masked order and PayLink suffixes | Any occurrence | Block mutation and verify stored PayLink history. |
| `ikhokha.payment_attempt.duplicate` | Medium | attempt hash, masked order, count | More than 1 suppressed attempt in 5 minutes | Confirm idempotency is working and inspect client retries. |
| `ikhokha.order.duplicate_detected` | High | basket hash, masked order suffixes, time window | Any new persisted duplicate | Freeze payment-state automation and inspect checkout idempotency. |
| `ikhokha.blob.conditional_conflict` | Medium | Blob key, operation, attempt number | 3 conflicts in 5 minutes or conflict exhaustion | Inspect concurrent writers; never bypass ETag protection. |
| `ikhokha.payment.paid_regression_blocked` | High | masked order, current/provider status | Any occurrence | Verify callback ordering and provider history. |
| `ikhokha.payment.state_mismatch` | High | masked order, local/provider status | Any unresolved mismatch over 10 minutes | Open a reconciliation investigation; do not auto-correct. |
| `ikhokha.callback.repeated` | Low | idempotency hash, masked order, delivery count | More than 3 deliveries in 15 minutes | Confirm idempotent response and check provider retry reason. |
| `ikhokha.function.5xx` | Critical | function name, correlation ID, error class | 2 in 5 minutes or 1 persistent failure | Inspect logs/configuration, pause risky operations and consider runtime rollback. |

Never include application secrets, HMACs, tokens, full card information, unmasked payer details or complete callback payloads in logs.
