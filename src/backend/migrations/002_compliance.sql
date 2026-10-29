CREATE TABLE IF NOT EXISTS undertakings (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  required_action TEXT NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'Fulfilled', 'Overdue')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ,
  evidence TEXT
);

ALTER TABLE undertakings ADD COLUMN IF NOT EXISTS evidence TEXT;

CREATE INDEX IF NOT EXISTS undertakings_application_idx
  ON undertakings (application_id, due_date);

CREATE INDEX IF NOT EXISTS undertakings_status_due_date_idx
  ON undertakings (status, due_date);

CREATE TABLE IF NOT EXISTS compliance_docs (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  undertaking_id UUID REFERENCES undertakings(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  expiry_date DATE,
  storage_key TEXT,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  validation_status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (validation_status IN ('Pending', 'Valid', 'Invalid')),
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_by TEXT,
  validated_at TIMESTAMPTZ
);

ALTER TABLE compliance_docs ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE compliance_docs ADD COLUMN IF NOT EXISTS size_bytes INTEGER;

CREATE INDEX IF NOT EXISTS compliance_docs_application_idx
  ON compliance_docs (application_id);

CREATE INDEX IF NOT EXISTS compliance_docs_expiry_date_idx
  ON compliance_docs (expiry_date)
  WHERE expiry_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS compliance_alerts (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  undertaking_id UUID REFERENCES undertakings(id) ON DELETE CASCADE,
  compliance_doc_id UUID REFERENCES compliance_docs(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  threshold_days INTEGER,
  dedupe_key TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_alerts_application_idx
  ON compliance_alerts (application_id, created_at DESC);
