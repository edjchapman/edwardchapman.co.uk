---
question: "How did Foreman handle reliable event processing?"
aliases:
  - "How does Foreman handle reliable event processing?"
  - "How does Foreman guarantee reliability?"
---

Foreman uses the transactional outbox pattern to commit a job and dispatch its event atomically, so work is never lost between the database commit and the queue.[[foreman#card]] Workers own an exactly-once effect through a state guard and a per-job natural-key constraint, and failures are classified — poison input fails fast while everything else retries with capped full-jitter backoff into a redrivable dead-letter queue.[[foreman#architecture]]
