---
question: "What is Foreman?"
aliases:
  - "Tell me about Foreman"
  - "What does Foreman do?"
---

Foreman is a deliberately small product with deliberately large guarantees: one CSV import pipeline — submit a property CSV, get a report back — engineered so the interesting part is everything that can go wrong between "202 Accepted" and the finished report.[[foreman#context]] It is a production-style background job system built with Django, Celery, PostgreSQL, and Redis, using the transactional outbox pattern to commit jobs and dispatch events atomically.[[foreman#card]]
