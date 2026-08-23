# Yeshiva Donor CRM — Proposal

*The one-page summary for the yeshiva. The shareable web version (with screens) is published separately; the full technical specification lives in [`spec/`](./spec/00-INDEX.md).*

## What we're proposing to build

A custom donor-relationship system built around one promise: **you never have to remember who needs you — it tells you.** Every morning it shows exactly who to call, message and meet, what's overdue, and which relationships are going quiet. After every call, you speak one sentence into your phone and it becomes a proper record — including "call him again after Sukkos" turning into a real reminder on the right date.

It is designed from the proven best ideas of the leading donor and relationship systems (Bloomerang, Salesforce for Nonprofits, Beacon, Pipedrive, and a dozen more) — every borrowed idea is documented — but shaped around how a yeshiva actually raises money: family giving, annual cycles, the dinner, pledges paid over time, Gift Aid.

## What it does, in five sentences

1. **Today screen**: a queue of people, not a database — who needs attention, in order, every morning (plus a 7:30 email so you don't even need to open it).
2. **30-second logging**: dictate one line after a call; it files the conversation, the outcome, and the next step — nothing is ever lost.
3. **Relationships never go cold by accident**: every donor has a contact rhythm (monthly, quarterly…); the system flags anyone slipping and every promise not yet kept.
4. **The money side runs itself**: pledges chase themselves, thank-yous are never forgotten, and Gift Aid claims build automatically — worth ~25% extra on eligible gifts.
5. **Nothing is sent without you**: the system drafts and reminds; a person always presses send.

## What exists now

- A complete written specification (14 documents: data model, every screen, every automation, AI features, security & GDPR, build order) — in [`spec/`](./spec/00-INDEX.md).
- Wireframes of the eight key screens — [`spec/wireframes/`](./spec/wireframes/README.md).
- A phased build plan: a usable daily tool in ~5–6 weeks of part-time work, full fundraising management in ~9–12; running costs ~£5–50/month.

## What we need from the yeshiva

1. Roughly how many donor families now, and how many people will use the system?
2. The current spreadsheet/list of donors (it becomes the starting data).
3. Confirmation the yeshiva is registered with HMRC Charities Online for Gift Aid.
4. Which currencies besides GBP actually occur.
5. A contact for the privacy notice, and a preferred web address for the system.
