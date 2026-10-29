# Prototype architecture

```mermaid
flowchart LR
  Browser[React SPA] -->|REST /api| Express[Express API]
  Express --> Memory[In-memory demo repository]
  Express -->|optional DATABASE_URL| PG[(PostgreSQL workflow data)]
  Express --> Outbox[Transactional event outbox]
  Outbox -->|optional AMQP_URL| Rabbit[(RabbitMQ)]
  Express -. demo only .-> EVC[EVC schedule state]
  Express -. demo only .-> Compliance[Undertaking and evidence state]
```

EVC and compliance are currently in-process demo data. Authentication, private document storage, notification delivery, cloud deployment, and monitoring are not connected. The production architecture needs team agreement on APH routing, IdP, provider, privacy controls, and service ownership.
