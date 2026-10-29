CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY,
  institution_name TEXT NOT NULL,
  region TEXT NOT NULL,
  institute_type TEXT NOT NULL CHECK (institute_type IN ('new', 'existing')),
  requires_evc BOOLEAN NOT NULL,
  current_stage TEXT NOT NULL,
  status TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status);
CREATE INDEX IF NOT EXISTS applications_stage_idx ON applications (current_stage);
CREATE INDEX IF NOT EXISTS applications_region_idx ON applications (region);

CREATE TABLE IF NOT EXISTS application_stages (
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  stage_name TEXT NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  reopened_at TIMESTAMPTZ,
  reverted_at TIMESTAMPTZ,
  reverted_by TEXT,
  PRIMARY KEY (application_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS application_stages_application_idx ON application_stages (application_id, sequence_no);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_id, performed_at);

CREATE TABLE IF NOT EXISTS event_outbox (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS event_outbox_pending_idx ON event_outbox (occurred_at) WHERE delivered_at IS NULL;
