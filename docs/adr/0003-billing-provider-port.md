# ADR-0003: Billing state is internal; payment providers are thin adapters

- **Status**: Accepted
- **Date**: 2026-08-19

## Context

The boilerplate must charge organizations, and the payment provider must be
replaceable — SePay today, possibly Stripe, Paddle or plain bank transfer later.
Providers differ far more than their marketing suggests:

- **Stripe** owns plans, subscriptions, invoices, retries and dunning, and pushes
  a rich lifecycle of webhooks.
- **SePay** is a Vietnamese bank-transfer/QR aggregator. It answers exactly one
  question: _money arrived, with this reference_. It has no concept of a
  subscription, a renewal or a dunning cycle.

Modelling the port on the richer provider is the common mistake: every weaker
provider then has to simulate a lifecycle it does not have.

## Decision

Three layers, and the source of truth is ours.

```
Plan / Price catalog          internal tables, not provider products
        ↓
Subscription state machine    internal: trialing → active → past_due → grace → suspended → canceled
        ↓
PaymentProviderPort           SePay | Stripe | Paddle | ManualBankTransfer
```

### The port is shaped by the weakest provider

```ts
interface PaymentProviderPort {
  createCharge(invoice: InvoiceRef): Promise<ChargeInstruction>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): boolean;
  parseEvent(payload: unknown): PaymentEvent;
  refund?(chargeId: string, amount: Money): Promise<RefundResult>;
  readonly capabilities: ProviderCapabilities;
}
```

`ChargeInstruction` is a union covering a hosted checkout URL, a QR payload or a
bank transfer reference. `PaymentEvent` normalises to `PaymentReceived`,
`PaymentFailed`, `Refunded` or `Unknown` — an unrecognised event is recorded and
ignored, never guessed at.

`ProviderCapabilities` (`{ recurring, refund, hostedCheckout, partialPayment }`)
lets the layer above branch on what exists instead of discovering a missing
capability as a `NotImplementedException` mid-payment.

### Recurring billing is ours, not the provider's

`apps/scheduler` — which already has a Redis leader lease — issues invoices,
sends reminders, and moves a subscription through grace into suspension. A
provider that _does_ support recurring (Stripe) may be delegated to later, but it
must still reconcile back into the internal state machine. No provider is allowed
to be the only place a subscription's state exists.

### Webhook ingest

Verify signature → persist to `payment_webhook_events` with a unique
`(provider, externalEventId)` → return `200` immediately → process asynchronously
on BullMQ. That uniqueness constraint is the deduplication mechanism; the
existing `Idempotency-Key` plugin is for inbound API calls and does not apply
here. Synchronous processing is forbidden: a provider timeout triggers a retry and
duplicates side effects.

### Entitlement and metering are separate from payment

`PlanEntitlement` (feature key → limit) and `UsageCounter` (organization, feature,
period) are internal and keep working when the provider is down. Hard limits are
refused at the guard with `403 plan_limit_exceeded`; soft limits only warn.
Counters increment atomically in Redis and flush to Postgres periodically.

## Consequences

- Swapping providers is: implement the port, migrate open charges, keep the
  subscription table untouched.
- We carry the cost of building invoicing, dunning and proration ourselves rather
  than inheriting Stripe's. That is the price of not being locked to it, and it is
  the reason the scheduler owns the billing cycle.
- Payment provider downtime degrades to "cannot collect", not "cannot serve" —
  entitlement decisions never call the provider.
- Money is stored as integer minor units with an explicit currency. No floats.

## Alternatives rejected

- **Stripe as the source of truth.** Fastest to build, and the standard advice.
  Rejected because it makes provider replacement a rewrite, and because SePay
  cannot represent the same model at all.
- **A provider-agnostic billing SaaS in front of the providers.** Adds a vendor
  and a monthly cost to a boilerplate, and still has to be modelled internally.
- **Port modelled on Stripe with SePay simulating subscriptions.** Rejected: the
  simulation would live in the adapter, where it is invisible to the domain and
  duplicated by the next weak provider.
