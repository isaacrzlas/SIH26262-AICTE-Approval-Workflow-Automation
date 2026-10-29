const fs = require('node:fs/promises');
const path = require('node:path');
const { NotFoundError, ConflictError } = require('./workflow-errors');

async function runMigrations(pool) {
  const migrationDirectory = path.join(__dirname, 'migrations');
  const migrationFiles = (await fs.readdir(migrationDirectory))
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();
  for (const migrationFile of migrationFiles) {
    const migrationPath = path.join(migrationDirectory, migrationFile);
    const sql = await fs.readFile(migrationPath, 'utf8');
    await pool.query(sql);
  }
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapStage(row) {
  return {
    stage: row.stage_name,
    enteredAt: iso(row.entered_at),
    completedAt: iso(row.completed_at),
    completedBy: row.completed_by,
    reopenedAt: iso(row.reopened_at),
    revertedAt: iso(row.reverted_at),
    revertedBy: row.reverted_by,
  };
}

function mapAudit(row) {
  return {
    id: row.id,
    applicationId: row.entity_id,
    action: row.action,
    performedBy: row.performed_by,
    performedAt: iso(row.performed_at),
    details: row.details,
  };
}

function mapApplication(row, stageHistory = [], auditLog = []) {
  return {
    id: row.id,
    institutionName: row.institution_name,
    region: row.region,
    instituteType: row.institute_type,
    requiresEvc: row.requires_evc,
    currentStage: row.current_stage,
    status: row.status,
    submittedAt: iso(row.submitted_at),
    lastUpdatedAt: iso(row.last_updated_at),
    version: row.version,
    stageHistory,
    auditLog,
  };
}

function mapUndertaking(row) {
  return {
    id: row.id,
    applicationId: row.application_id,
    institutionName: row.institution_name,
    region: row.region,
    description: row.description,
    requiredAction: row.required_action,
    dueDate: typeof row.due_date === 'string' ? row.due_date.slice(0, 10) : row.due_date.toISOString().slice(0, 10),
    status: row.status,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    fulfilledAt: iso(row.fulfilled_at),
    evidence: row.evidence || null,
  };
}

function mapComplianceDoc(row) {
  return {
    id: row.id,
    applicationId: row.application_id,
    undertakingId: row.undertaking_id,
    documentType: row.document_type,
    expiryDate: row.expiry_date ? (typeof row.expiry_date === 'string' ? row.expiry_date.slice(0, 10) : row.expiry_date.toISOString().slice(0, 10)) : null,
    storageKey: row.storage_key,
    mimeType: row.mime_type || null,
    sizeBytes: row.size_bytes || null,
    validationStatus: row.validation_status,
    submittedBy: row.submitted_by,
    submittedAt: iso(row.submitted_at),
    validatedBy: row.validated_by,
    validatedAt: iso(row.validated_at),
  };
}

function mapComplianceAlert(row) {
  return {
    id: row.id,
    applicationId: row.application_id,
    undertakingId: row.undertaking_id,
    complianceDocId: row.compliance_doc_id,
    type: row.alert_type,
    thresholdDays: row.threshold_days,
    dedupeKey: row.dedupe_key,
    message: row.message,
    createdAt: iso(row.created_at),
  };
}

async function insertAudit(client, auditEntry) {
  await client.query(
    `INSERT INTO audit_logs (id, entity_type, entity_id, action, performed_by, performed_at, details)
     VALUES ($1, 'application', $2, $3, $4, $5, $6::jsonb)`,
    [auditEntry.id, auditEntry.applicationId, auditEntry.action, auditEntry.performedBy, auditEntry.performedAt, JSON.stringify(auditEntry.details)],
  );
}

async function upsertStageHistory(client, application) {
  for (const [index, entry] of application.stageHistory.entries()) {
    await client.query(
      `INSERT INTO application_stages
        (application_id, sequence_no, stage_name, entered_at, completed_at, completed_by, reopened_at, reverted_at, reverted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (application_id, sequence_no) DO UPDATE SET
         stage_name = EXCLUDED.stage_name,
         entered_at = EXCLUDED.entered_at,
         completed_at = EXCLUDED.completed_at,
         completed_by = EXCLUDED.completed_by,
         reopened_at = EXCLUDED.reopened_at,
         reverted_at = EXCLUDED.reverted_at,
         reverted_by = EXCLUDED.reverted_by`,
      [application.id, index, entry.stage, entry.enteredAt, entry.completedAt, entry.completedBy, entry.reopenedAt, entry.revertedAt || null, entry.revertedBy || null],
    );
  }
}

async function writeOutbox(client, event) {
  if (!event) return;
  await client.query(
    `INSERT INTO event_outbox (id, event_type, occurred_at, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [event.id, event.type, event.occurredAt, JSON.stringify(event.payload)],
  );
}

function createPostgresRepository(pool) {
  async function withTransaction(action) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async createApplication(application, auditEntry) {
      return withTransaction(async (client) => {
        await client.query(
          `INSERT INTO applications
            (id, institution_name, region, institute_type, requires_evc, current_stage, status, submitted_at, last_updated_at, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)`,
          [application.id, application.institutionName, application.region, application.instituteType, application.requiresEvc, application.currentStage, application.status, application.submittedAt, application.lastUpdatedAt],
        );
        await upsertStageHistory(client, application);
        await insertAudit(client, auditEntry);
      });
    },

    async getApplication(applicationId) {
      const result = await pool.query('SELECT * FROM applications WHERE id = $1', [applicationId]);
      const row = result.rows[0];
      if (!row) return null;
      const [stages, audits] = await Promise.all([
        pool.query('SELECT * FROM application_stages WHERE application_id = $1 ORDER BY sequence_no', [applicationId]),
        pool.query('SELECT * FROM audit_logs WHERE entity_id = $1 ORDER BY performed_at, id', [applicationId]),
      ]);
      return mapApplication(row, stages.rows.map(mapStage), audits.rows.map(mapAudit));
    },

    async listApplications(filters = {}) {
      const status = typeof filters.status === 'string' && filters.status.trim() ? filters.status.trim() : null;
      const region = typeof filters.region === 'string' && filters.region.trim() ? filters.region.trim() : null;
      const search = typeof filters.search === 'string' && filters.search.trim() ? `%${filters.search.trim()}%` : null;
      const result = await pool.query(
        `SELECT * FROM applications
         WHERE ($1::text IS NULL OR lower(status) = lower($1))
           AND ($2::text IS NULL OR lower(region) = lower($2))
           AND ($3::text IS NULL OR institution_name ILIKE $3 OR id::text ILIKE $3)
         ORDER BY submitted_at DESC`,
        [status, region, search],
      );
      return result.rows.map((row) => mapApplication(row));
    },

    async saveApplication(application, auditEntry, event) {
      return withTransaction(async (client) => {
        const result = await client.query(
          `UPDATE applications SET institution_name=$2, region=$3, institute_type=$4, requires_evc=$5,
             current_stage=$6, status=$7, submitted_at=$8, last_updated_at=$9, version=version+1
           WHERE id=$1 AND version=$10`,
          [application.id, application.institutionName, application.region, application.instituteType, application.requiresEvc, application.currentStage, application.status, application.submittedAt, application.lastUpdatedAt, application.version || 0],
        );
        if (!result.rowCount) {
          const exists = await client.query('SELECT 1 FROM applications WHERE id=$1', [application.id]);
          if (!exists.rowCount) throw new NotFoundError(`Application ${application.id} was not found`);
          throw new ConflictError('Application was changed by another reviewer; reload it and retry');
        }
        application.version = (application.version || 0) + 1;
        await upsertStageHistory(client, application);
        await insertAudit(client, auditEntry);
        await writeOutbox(client, event);
      });
    },

    async getPendingEvents(limit = 50) {
      const result = await pool.query(
        `SELECT id, event_type, occurred_at, payload FROM event_outbox
         WHERE delivered_at IS NULL ORDER BY occurred_at LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({ id: row.id, type: row.event_type, occurredAt: iso(row.occurred_at), payload: row.payload }));
    },

    async markEventDelivered(eventId, deliveredAt = new Date().toISOString()) {
      await pool.query('UPDATE event_outbox SET delivered_at=$2 WHERE id=$1 AND delivered_at IS NULL', [eventId, deliveredAt]);
    },

    async listUndertakings(applicationId = null) {
      const result = await pool.query(
        `SELECT u.*, a.institution_name, a.region
         FROM undertakings u JOIN applications a ON a.id = u.application_id
         WHERE ($1::uuid IS NULL OR u.application_id = $1)
         ORDER BY u.due_date, u.created_at`,
        [applicationId],
      );
      return result.rows.map(mapUndertaking);
    },

    async getUndertaking(undertakingId) {
      const result = await pool.query(
        `SELECT u.*, a.institution_name, a.region
         FROM undertakings u JOIN applications a ON a.id = u.application_id
         WHERE u.id = $1`,
        [undertakingId],
      );
      return result.rows[0] ? mapUndertaking(result.rows[0]) : null;
    },

    async createUndertaking(undertaking, auditEntry) {
      return withTransaction(async (client) => {
        await client.query(
          `INSERT INTO undertakings
           (id, application_id, description, required_action, due_date, status, created_by, created_at, updated_at, fulfilled_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [undertaking.id, undertaking.applicationId, undertaking.description, undertaking.requiredAction, undertaking.dueDate,
            undertaking.status, undertaking.createdBy, undertaking.createdAt, undertaking.updatedAt, undertaking.fulfilledAt],
        );
        await insertAudit(client, auditEntry);
      });
    },

    async saveUndertaking(undertaking, auditEntry) {
      return withTransaction(async (client) => {
        const result = await client.query(
          `UPDATE undertakings SET status=$2, updated_at=$3, fulfilled_at=$4, evidence=$5
           WHERE id=$1`,
          [undertaking.id, undertaking.status, undertaking.updatedAt, undertaking.fulfilledAt, undertaking.evidence || null],
        );
        if (!result.rowCount) throw new NotFoundError(`Undertaking ${undertaking.id} was not found`);
        await insertAudit(client, auditEntry);
      });
    },

    async listComplianceDocs(applicationId = null) {
      const result = await pool.query(
        `SELECT * FROM compliance_docs WHERE ($1::uuid IS NULL OR application_id = $1) ORDER BY submitted_at DESC`,
        [applicationId],
      );
      return result.rows.map(mapComplianceDoc);
    },

    async createComplianceDoc(document, auditEntry) {
      return withTransaction(async (client) => {
        await client.query(
          `INSERT INTO compliance_docs
           (id, application_id, undertaking_id, document_type, expiry_date, storage_key, mime_type, size_bytes,
            validation_status, submitted_by, submitted_at, validated_by, validated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [document.id, document.applicationId, document.undertakingId, document.documentType, document.expiryDate,
            document.storageKey, document.mimeType, document.sizeBytes, document.validationStatus, document.submittedBy,
            document.submittedAt, document.validatedBy, document.validatedAt],
        );
        await insertAudit(client, auditEntry);
      });
    },

    async completeUndertaking(undertaking, document, auditEntries) {
      return withTransaction(async (client) => {
        await client.query(
          `INSERT INTO compliance_docs
           (id, application_id, undertaking_id, document_type, expiry_date, storage_key, mime_type, size_bytes,
            validation_status, submitted_by, submitted_at, validated_by, validated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [document.id, document.applicationId, document.undertakingId, document.documentType, document.expiryDate,
            document.storageKey, document.mimeType, document.sizeBytes, document.validationStatus, document.submittedBy,
            document.submittedAt, document.validatedBy, document.validatedAt],
        );
        const result = await client.query(
          `UPDATE undertakings SET status=$2, updated_at=$3, fulfilled_at=$4, evidence=$5 WHERE id=$1`,
          [undertaking.id, undertaking.status, undertaking.updatedAt, undertaking.fulfilledAt, undertaking.evidence],
        );
        if (!result.rowCount) throw new NotFoundError(`Undertaking ${undertaking.id} was not found`);
        for (const entry of auditEntries) await insertAudit(client, entry);
      });
    },

    async saveComplianceAlert(alert, event) {
      return withTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO compliance_alerts
           (id, application_id, undertaking_id, compliance_doc_id, alert_type, threshold_days, dedupe_key, message, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [alert.id, alert.applicationId, alert.undertakingId, alert.complianceDocId, alert.type, alert.thresholdDays,
            alert.dedupeKey, alert.message, alert.createdAt],
        );
        if (result.rowCount) await writeOutbox(client, event);
        return Boolean(result.rowCount);
      });
    },

    async listComplianceAlerts() {
      const result = await pool.query('SELECT * FROM compliance_alerts ORDER BY created_at DESC');
      return result.rows.map(mapComplianceAlert);
    },
  };
}

module.exports = { createPostgresRepository, runMigrations };
