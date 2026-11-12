import os
from contextlib import contextmanager
import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://campus:campus-demo@localhost:5432/campus"
)


@contextmanager
def db():
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        yield conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS config_versions (
 id serial PRIMARY KEY, definition jsonb NOT NULL, published_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS buildings (
 id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, floors int NOT NULL);
CREATE TABLE IF NOT EXISTS assets (
 id text PRIMARY KEY, building_id text REFERENCES buildings(id), name text NOT NULL,
 location text NOT NULL, kind text NOT NULL);
CREATE TABLE IF NOT EXISTS records (
 id serial PRIMARY KEY, title text NOT NULL, asset_id text REFERENCES assets(id),
 category text NOT NULL DEFAULT 'Inspection', priority text NOT NULL DEFAULT 'Normal',
 state text NOT NULL DEFAULT 'Draft', config_id int REFERENCES config_versions(id),
 values_json jsonb NOT NULL DEFAULT '{}', owner_name text NOT NULL,
 revision int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tasks (
 id serial PRIMARY KEY, record_id int REFERENCES records(id), title text NOT NULL,
 status text NOT NULL DEFAULT 'Open', assignee text NOT NULL DEFAULT 'Facilities team',
 due_at timestamptz NOT NULL DEFAULT now() + interval '4 hours', escalated boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS evidence (
 id text PRIMARY KEY, record_id int REFERENCES records(id), filename text NOT NULL,
 media_type text NOT NULL, size int NOT NULL, sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit (
 id bigserial PRIMARY KEY, record_id int REFERENCES records(id), actor text NOT NULL,
 action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS jobs (
 id serial PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'Queued', attempts int NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
CREATE TABLE IF NOT EXISTS handovers (
 id serial PRIMARY KEY, shift text NOT NULL, note text NOT NULL,
 snapshot jsonb NOT NULL, author text NOT NULL, acknowledged_by text,
 created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, username text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '12 hours');
CREATE TABLE IF NOT EXISTS worker_health (id int PRIMARY KEY, last_seen timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS maintenance_receipts (
 request_id text PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS log_entries (
 id serial PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id),
 category text NOT NULL, status text NOT NULL DEFAULT 'Open', priority text NOT NULL DEFAULT 'Normal',
 message text NOT NULL, event_time timestamptz NOT NULL DEFAULT now(),
 add_to_handover boolean NOT NULL DEFAULT true, author text NOT NULL,
 closed_by text, closed_at timestamptz, revision int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS log_notes (
 id serial PRIMARY KEY, entry_id int NOT NULL REFERENCES log_entries(id),
 message text NOT NULL, flagged boolean NOT NULL DEFAULT false,
 author text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS log_history (
 id serial PRIMARY KEY, entry_id int NOT NULL REFERENCES log_entries(id),
 action text NOT NULL, actor text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE config_versions ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS dev_projects (
 id serial PRIMARY KEY,name text NOT NULL,files jsonb NOT NULL,base_version int NOT NULL REFERENCES config_versions(id),
 revision int NOT NULL DEFAULT 1,author text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS config_items (
 id serial PRIMARY KEY,name text NOT NULL,definition jsonb NOT NULL,scope text NOT NULL DEFAULT '*',
 base_version int NOT NULL REFERENCES config_versions(id),status text NOT NULL DEFAULT 'Draft',revision int NOT NULL DEFAULT 1,
 author text NOT NULL,submitted_by text,reviewed_by text,published_version int REFERENCES config_versions(id),
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS config_item_history (
 id serial PRIMARY KEY,item_id int NOT NULL REFERENCES config_items(id),actor text NOT NULL,action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS config_bindings (
 scope text PRIMARY KEY REFERENCES buildings(id),config_id int NOT NULL REFERENCES config_versions(id),item_id int REFERENCES config_items(id));
ALTER TABLE records ADD COLUMN IF NOT EXISTS native_uuid uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE log_entries ADD COLUMN IF NOT EXISTS native_uuid uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE assets ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS parent text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS longitude double precision;
CREATE TABLE IF NOT EXISTS asset_batches(transaction_id uuid PRIMARY KEY,username text NOT NULL,total int NOT NULL,batches jsonb NOT NULL DEFAULT '{}',completed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS data_points(id text PRIMARY KEY,asset_id text REFERENCES assets(id),description text NOT NULL,label text NOT NULL,input_type text NOT NULL DEFAULT 'number',unit text NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS data_point_history(id bigserial PRIMARY KEY,point_id text NOT NULL REFERENCES data_points(id),value text NOT NULL,timestamp timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS data_point_history_point ON data_point_history(point_id,timestamp);
ALTER TABLE records ADD COLUMN IF NOT EXISTS workflow_history jsonb NOT NULL DEFAULT '{}';
ALTER TABLE records ADD COLUMN IF NOT EXISTS active_states jsonb NOT NULL DEFAULT '[]';
ALTER TABLE log_entries ADD COLUMN IF NOT EXISTS message_html text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS log_attachments (
 id text PRIMARY KEY, entry_id int NOT NULL REFERENCES log_entries(id),
 filename text NOT NULL, media_type text NOT NULL, size int NOT NULL, sha256 text NOT NULL,
 author text NOT NULL, deleted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workflow_timers(id bigserial PRIMARY KEY,record_id int NOT NULL REFERENCES records(id),transition_id text NOT NULL,source text NOT NULL,due_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'Pending',last_error text);
CREATE INDEX IF NOT EXISTS workflow_timers_due ON workflow_timers(status,due_at);
CREATE TABLE IF NOT EXISTS user_access(username text PRIMARY KEY,areas jsonb,revision int NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS log_event_time ON log_entries(event_time);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,available_at);
CREATE INDEX IF NOT EXISTS audit_record ON audit(record_id,id);
"""
