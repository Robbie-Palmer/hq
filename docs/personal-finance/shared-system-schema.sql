-- Asset Tracker shared household schema, contract version 1.
-- This file targets PostgreSQL 16 and must apply to an empty database.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE household_role AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE membership_status AS ENUM ('invited', 'active', 'revoked');
CREATE TYPE financial_entity_kind AS ENUM (
  'person',
  'household_pool',
  'business',
  'trust',
  'other'
);
CREATE TYPE asset_type AS ENUM (
  'cash',
  'stocks',
  'bonds',
  'reits',
  'crypto',
  'property',
  'mortgage',
  'debt'
);
CREATE TYPE liquidity_tier AS ENUM ('cash', 'liquid', 'illiquid');
CREATE TYPE source_kind AS ENUM (
  'manual',
  'legacy_json',
  'file_import',
  'provider',
  'reference'
);
CREATE TYPE financial_record_kind AS ENUM (
  'balance',
  'capital_flow',
  'income',
  'transfer',
  'holding',
  'price',
  'exchange_rate'
);
CREATE TYPE capital_flow_kind AS ENUM (
  'personal_saving',
  'debt_principal',
  'external'
);
CREATE TYPE plan_record_kind AS ENUM (
  'account',
  'account_expected_return',
  'recurring_flow',
  'planned_expenditure',
  'household_settings'
);
CREATE TYPE flow_frequency AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');
CREATE TYPE compensation_kind AS ENUM (
  'take_home_income',
  'employee_pension',
  'employer_pension'
);
CREATE TYPE calculation_status AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE idempotency_status AS ENUM ('running', 'completed');
CREATE TYPE local_json_import_status AS ENUM (
  'validated',
  'committed',
  'rejected',
  'deleted'
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  primary_email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CONSTRAINT app_user_email_nonempty CHECK (btrim(primary_email) <> '')
);

CREATE UNIQUE INDEX app_user_primary_email_uidx
  ON app_user (lower(primary_email));

CREATE TABLE auth_identity (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  provider_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz,
  CONSTRAINT auth_identity_provider_nonempty CHECK (btrim(provider) <> ''),
  CONSTRAINT auth_identity_subject_nonempty CHECK (btrim(provider_subject) <> ''),
  UNIQUE (provider, provider_subject)
);

CREATE TABLE user_session (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_rotated_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_hash bytea,
  user_agent_hash bytea,
  CONSTRAINT user_session_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX user_session_user_active_idx
  ON user_session (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE household (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT household_name_nonempty CHECK (btrim(name) <> '')
);

CREATE TABLE household_membership (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  role household_role NOT NULL,
  status membership_status NOT NULL,
  invited_by_user_id uuid REFERENCES app_user (id),
  invited_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (household_id, user_id),
  CONSTRAINT household_membership_activation CHECK (
    (status = 'invited' AND invited_at IS NOT NULL AND activated_at IS NULL AND revoked_at IS NULL)
    OR (status = 'active' AND activated_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX household_membership_user_active_idx
  ON household_membership (user_id, household_id)
  WHERE status = 'active';

CREATE TABLE household_state (
  household_id uuid PRIMARY KEY REFERENCES household (id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_state_revision_nonnegative CHECK (revision >= 0)
);

CREATE TABLE financial_entity (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  kind financial_entity_kind NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (household_id, id),
  CONSTRAINT financial_entity_name_nonempty CHECK (btrim(name) <> '')
);

-- financial_account is stable identity only. Mutable account fields live in
-- immutable account_plan versions below.
CREATE TABLE financial_account (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id)
);

CREATE TABLE account_ownership (
  household_id uuid NOT NULL,
  account_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  valid_during daterange NOT NULL,
  percentage numeric(9,8) NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL REFERENCES app_user (id),
  PRIMARY KEY (household_id, account_id, entity_id, valid_during),
  FOREIGN KEY (household_id, account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, entity_id)
    REFERENCES financial_entity (household_id, id) ON DELETE CASCADE,
  CONSTRAINT account_ownership_nonempty_range CHECK (NOT isempty(valid_during)),
  CONSTRAINT account_ownership_percentage CHECK (
    percentage > 0 AND percentage <= 1
  ),
  EXCLUDE USING gist (
    household_id WITH =,
    account_id WITH =,
    entity_id WITH =,
    valid_during WITH &&
  )
);

CREATE TABLE fact_source (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  kind source_kind NOT NULL,
  external_key text,
  label text,
  content_sha256 bytea,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES app_user (id),
  PRIMARY KEY (household_id, id),
  UNIQUE NULLS NOT DISTINCT (household_id, kind, external_key),
  CONSTRAINT fact_source_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT fact_source_sha256_length CHECK (
    content_sha256 IS NULL OR octet_length(content_sha256) = 32
  )
);

CREATE TABLE instrument (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  symbol text NOT NULL,
  name text NOT NULL,
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, symbol, currency),
  CONSTRAINT instrument_name_nonempty CHECK (btrim(name) <> ''),
  CONSTRAINT instrument_symbol_nonempty CHECK (btrim(symbol) <> ''),
  CONSTRAINT instrument_currency_supported CHECK (currency IN ('GBP', 'USD'))
);

CREATE TABLE financial_record (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  record_kind financial_record_kind NOT NULL,
  valid_on date NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source_id uuid NOT NULL,
  corrects_record_id uuid,
  is_void boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, id, record_kind),
  FOREIGN KEY (household_id, source_id)
    REFERENCES fact_source (household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, corrects_record_id, record_kind)
    REFERENCES financial_record (household_id, id, record_kind) ON DELETE CASCADE,
  CONSTRAINT financial_record_not_self_correction CHECK (
    corrects_record_id IS NULL OR corrects_record_id <> id
  )
);

CREATE UNIQUE INDEX financial_record_one_direct_correction_uidx
  ON financial_record (household_id, corrects_record_id)
  WHERE corrects_record_id IS NOT NULL;

CREATE INDEX financial_record_household_valid_idx
  ON financial_record (household_id, record_kind, valid_on, accepted_at);

CREATE TABLE balance_fact (
  household_id uuid NOT NULL,
  record_id uuid NOT NULL,
  record_kind financial_record_kind NOT NULL DEFAULT 'balance',
  account_id uuid NOT NULL,
  balance numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  PRIMARY KEY (household_id, record_id),
  FOREIGN KEY (household_id, record_id, record_kind)
    REFERENCES financial_record (household_id, id, record_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  CONSTRAINT balance_fact_kind CHECK (record_kind = 'balance'),
  CONSTRAINT balance_fact_currency_supported CHECK (currency IN ('GBP', 'USD'))
);

CREATE TABLE capital_flow_fact (
  household_id uuid NOT NULL,
  record_id uuid NOT NULL,
  record_kind financial_record_kind NOT NULL DEFAULT 'capital_flow',
  account_id uuid NOT NULL,
  amount numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  flow_kind capital_flow_kind NOT NULL,
  PRIMARY KEY (household_id, record_id),
  FOREIGN KEY (household_id, record_id, record_kind)
    REFERENCES financial_record (household_id, id, record_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  CONSTRAINT capital_flow_fact_kind CHECK (record_kind = 'capital_flow'),
  CONSTRAINT capital_flow_currency_supported CHECK (currency IN ('GBP', 'USD'))
);

CREATE TABLE income_fact (
  household_id uuid NOT NULL,
  record_id uuid NOT NULL,
  record_kind financial_record_kind NOT NULL DEFAULT 'income',
  amount numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  PRIMARY KEY (household_id, record_id),
  FOREIGN KEY (household_id, record_id, record_kind)
    REFERENCES financial_record (household_id, id, record_kind) ON DELETE CASCADE,
  CONSTRAINT income_fact_kind CHECK (record_kind = 'income'),
  CONSTRAINT income_amount_nonnegative CHECK (amount >= 0),
  CONSTRAINT income_currency_supported CHECK (currency IN ('GBP', 'USD'))
);

CREATE TABLE transfer_fact (
  household_id uuid NOT NULL,
  record_id uuid NOT NULL,
  record_kind financial_record_kind NOT NULL DEFAULT 'transfer',
  from_account_id uuid,
  to_account_id uuid,
  amount numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  received_amount numeric(24,8),
  received_currency char(3),
  fee_amount numeric(24,8) NOT NULL DEFAULT 0,
  conversion_provider text,
  recurring_flow_logical_id uuid,
  PRIMARY KEY (household_id, record_id),
  FOREIGN KEY (household_id, record_id, record_kind)
    REFERENCES financial_record (household_id, id, record_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, from_account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, to_account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  CONSTRAINT transfer_fact_kind CHECK (record_kind = 'transfer'),
  CONSTRAINT transfer_has_endpoint CHECK (
    from_account_id IS NOT NULL OR to_account_id IS NOT NULL
  ),
  CONSTRAINT transfer_distinct_endpoints CHECK (
    from_account_id IS NULL OR to_account_id IS NULL OR from_account_id <> to_account_id
  ),
  CONSTRAINT transfer_amount_positive CHECK (amount > 0),
  CONSTRAINT transfer_fee_nonnegative CHECK (fee_amount >= 0),
  CONSTRAINT transfer_currency_supported CHECK (currency IN ('GBP', 'USD')),
  CONSTRAINT transfer_received_pair CHECK (
    (received_amount IS NULL AND received_currency IS NULL)
    OR (received_amount > 0 AND received_currency IN ('GBP', 'USD'))
  )
);

CREATE TABLE holding_fact (
  household_id uuid NOT NULL,
  record_id uuid NOT NULL,
  record_kind financial_record_kind NOT NULL DEFAULT 'holding',
  account_id uuid NOT NULL,
  instrument_id uuid NOT NULL,
  quantity numeric(30,12) NOT NULL,
  PRIMARY KEY (household_id, record_id),
  FOREIGN KEY (household_id, record_id, record_kind)
    REFERENCES financial_record (household_id, id, record_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, instrument_id)
    REFERENCES instrument (household_id, id) ON DELETE CASCADE,
  CONSTRAINT holding_fact_kind CHECK (record_kind = 'holding'),
  CONSTRAINT holding_quantity_nonnegative CHECK (quantity >= 0)
);

CREATE TABLE price_fact (
  household_id uuid NOT NULL,
  record_id uuid NOT NULL,
  record_kind financial_record_kind NOT NULL DEFAULT 'price',
  instrument_id uuid NOT NULL,
  price numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  PRIMARY KEY (household_id, record_id),
  FOREIGN KEY (household_id, record_id, record_kind)
    REFERENCES financial_record (household_id, id, record_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, instrument_id)
    REFERENCES instrument (household_id, id) ON DELETE CASCADE,
  CONSTRAINT price_fact_kind CHECK (record_kind = 'price'),
  CONSTRAINT price_nonnegative CHECK (price >= 0),
  CONSTRAINT price_currency_supported CHECK (currency IN ('GBP', 'USD'))
);

CREATE TABLE exchange_rate_fact (
  household_id uuid NOT NULL,
  record_id uuid NOT NULL,
  record_kind financial_record_kind NOT NULL DEFAULT 'exchange_rate',
  from_currency char(3) NOT NULL,
  to_currency char(3) NOT NULL,
  rate numeric(20,12) NOT NULL,
  PRIMARY KEY (household_id, record_id),
  FOREIGN KEY (household_id, record_id, record_kind)
    REFERENCES financial_record (household_id, id, record_kind) ON DELETE CASCADE,
  CONSTRAINT exchange_rate_fact_kind CHECK (record_kind = 'exchange_rate'),
  CONSTRAINT exchange_rate_positive CHECK (rate > 0),
  CONSTRAINT exchange_rate_distinct_currencies CHECK (from_currency <> to_currency),
  CONSTRAINT exchange_rate_from_currency_supported CHECK (from_currency IN ('GBP', 'USD')),
  CONSTRAINT exchange_rate_to_currency_supported CHECK (to_currency IN ('GBP', 'USD'))
);

CREATE TABLE plan_record (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  plan_kind plan_record_kind NOT NULL,
  logical_id uuid NOT NULL,
  version integer NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  supersedes_plan_id uuid,
  is_deleted boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, id, plan_kind),
  UNIQUE (household_id, logical_id, version),
  FOREIGN KEY (household_id, supersedes_plan_id, plan_kind)
    REFERENCES plan_record (household_id, id, plan_kind) ON DELETE CASCADE,
  CONSTRAINT plan_record_version_positive CHECK (version > 0),
  CONSTRAINT plan_record_not_self_superseding CHECK (
    supersedes_plan_id IS NULL OR supersedes_plan_id <> id
  )
);

CREATE UNIQUE INDEX plan_record_one_successor_uidx
  ON plan_record (household_id, supersedes_plan_id)
  WHERE supersedes_plan_id IS NOT NULL;

CREATE INDEX plan_record_current_lookup_idx
  ON plan_record (household_id, plan_kind, logical_id, version DESC);

CREATE TABLE account_plan (
  household_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_kind plan_record_kind NOT NULL DEFAULT 'account',
  account_id uuid NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  currency char(3) NOT NULL,
  asset_type asset_type NOT NULL,
  liquidity liquidity_tier NOT NULL,
  linked_account_id uuid,
  opened_on date NOT NULL,
  closed_on date,
  PRIMARY KEY (household_id, plan_id),
  FOREIGN KEY (household_id, plan_id, plan_kind)
    REFERENCES plan_record (household_id, id, plan_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, linked_account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  CONSTRAINT account_plan_kind CHECK (plan_kind = 'account'),
  CONSTRAINT account_plan_name_nonempty CHECK (btrim(name) <> ''),
  CONSTRAINT account_plan_provider_nonempty CHECK (btrim(provider) <> ''),
  CONSTRAINT account_plan_currency_supported CHECK (currency IN ('GBP', 'USD')),
  CONSTRAINT account_plan_dates CHECK (closed_on IS NULL OR closed_on >= opened_on),
  CONSTRAINT account_plan_not_self_linked CHECK (
    linked_account_id IS NULL OR linked_account_id <> account_id
  )
);

CREATE TABLE account_expected_return_plan (
  household_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_kind plan_record_kind NOT NULL DEFAULT 'account_expected_return',
  account_id uuid NOT NULL,
  effective_from date NOT NULL,
  annual_rate numeric(20,12) NOT NULL,
  PRIMARY KEY (household_id, plan_id),
  FOREIGN KEY (household_id, plan_id, plan_kind)
    REFERENCES plan_record (household_id, id, plan_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  CONSTRAINT account_expected_return_plan_kind CHECK (
    plan_kind = 'account_expected_return'
  ),
  CONSTRAINT account_expected_return_above_loss CHECK (annual_rate > -1)
);

CREATE TABLE recurring_flow_plan (
  household_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_kind plan_record_kind NOT NULL DEFAULT 'recurring_flow',
  name text NOT NULL,
  from_account_id uuid,
  to_account_id uuid,
  amount numeric(24,8),
  currency char(3) NOT NULL,
  received_amount numeric(24,8),
  received_currency char(3),
  fee_amount numeric(24,8),
  conversion_provider text,
  gross_amount numeric(24,8),
  formula_percent numeric(20,12),
  formula_floor numeric(24,8),
  compensation_kind compensation_kind,
  frequency flow_frequency NOT NULL,
  start_on date NOT NULL,
  end_on date,
  PRIMARY KEY (household_id, plan_id),
  FOREIGN KEY (household_id, plan_id, plan_kind)
    REFERENCES plan_record (household_id, id, plan_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, from_account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, to_account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  CONSTRAINT recurring_flow_plan_kind CHECK (plan_kind = 'recurring_flow'),
  CONSTRAINT recurring_flow_name_nonempty CHECK (btrim(name) <> ''),
  CONSTRAINT recurring_flow_has_endpoint CHECK (
    from_account_id IS NOT NULL OR to_account_id IS NOT NULL
  ),
  CONSTRAINT recurring_flow_distinct_endpoints CHECK (
    from_account_id IS NULL OR to_account_id IS NULL OR from_account_id <> to_account_id
  ),
  CONSTRAINT recurring_flow_amount_or_formula CHECK (
    (amount > 0 AND formula_percent IS NULL AND formula_floor IS NULL)
    OR (amount IS NULL AND formula_percent > 0 AND formula_percent < 1 AND formula_floor >= 0)
  ),
  CONSTRAINT recurring_flow_formula_monthly CHECK (
    formula_percent IS NULL OR frequency = 'monthly'
  ),
  CONSTRAINT recurring_flow_currency_supported CHECK (currency IN ('GBP', 'USD')),
  CONSTRAINT recurring_flow_received_pair CHECK (
    (received_amount IS NULL AND received_currency IS NULL)
    OR (received_amount > 0 AND received_currency IN ('GBP', 'USD') AND received_currency <> currency)
  ),
  CONSTRAINT recurring_flow_fee_nonnegative CHECK (
    fee_amount IS NULL OR fee_amount >= 0
  ),
  CONSTRAINT recurring_flow_dates CHECK (end_on IS NULL OR end_on >= start_on)
);

CREATE TABLE planned_expenditure_plan (
  household_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_kind plan_record_kind NOT NULL DEFAULT 'planned_expenditure',
  name text NOT NULL,
  amount numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  due_on date NOT NULL,
  from_account_id uuid NOT NULL,
  PRIMARY KEY (household_id, plan_id),
  FOREIGN KEY (household_id, plan_id, plan_kind)
    REFERENCES plan_record (household_id, id, plan_kind) ON DELETE CASCADE,
  FOREIGN KEY (household_id, from_account_id)
    REFERENCES financial_account (household_id, id) ON DELETE CASCADE,
  CONSTRAINT planned_expenditure_plan_kind CHECK (
    plan_kind = 'planned_expenditure'
  ),
  CONSTRAINT planned_expenditure_name_nonempty CHECK (btrim(name) <> ''),
  CONSTRAINT planned_expenditure_amount_positive CHECK (amount > 0),
  CONSTRAINT planned_expenditure_currency_supported CHECK (currency IN ('GBP', 'USD'))
);

CREATE TABLE household_settings_plan (
  household_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_kind plan_record_kind NOT NULL DEFAULT 'household_settings',
  base_currency char(3) NOT NULL,
  expected_annual_inflation numeric(20,12) NOT NULL,
  target_net_worth numeric(24,8),
  target_is_real boolean NOT NULL DEFAULT false,
  withdrawal_rate numeric(20,12) NOT NULL,
  valuation_max_age_days integer NOT NULL,
  PRIMARY KEY (household_id, plan_id),
  FOREIGN KEY (household_id, plan_id, plan_kind)
    REFERENCES plan_record (household_id, id, plan_kind) ON DELETE CASCADE,
  CONSTRAINT household_settings_plan_kind CHECK (
    plan_kind = 'household_settings'
  ),
  CONSTRAINT household_settings_currency_supported CHECK (
    base_currency IN ('GBP', 'USD')
  ),
  CONSTRAINT household_settings_inflation CHECK (expected_annual_inflation > -1),
  CONSTRAINT household_settings_target CHECK (
    target_net_worth IS NULL OR target_net_worth > 0
  ),
  CONSTRAINT household_settings_withdrawal CHECK (
    withdrawal_rate > 0 AND withdrawal_rate <= 1
  ),
  CONSTRAINT household_settings_age CHECK (valuation_max_age_days >= 0)
);

CREATE TABLE calculation_run (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  calculation_type text NOT NULL,
  algorithm_version text NOT NULL,
  household_revision bigint NOT NULL,
  as_of_date date NOT NULL,
  as_known_at timestamptz NOT NULL,
  status calculation_status NOT NULL,
  output jsonb,
  output_sha256 bytea,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (household_id, id),
  CONSTRAINT calculation_type_nonempty CHECK (btrim(calculation_type) <> ''),
  CONSTRAINT calculation_algorithm_nonempty CHECK (btrim(algorithm_version) <> ''),
  CONSTRAINT calculation_revision_nonnegative CHECK (household_revision >= 0),
  CONSTRAINT calculation_output_object CHECK (
    output IS NULL OR jsonb_typeof(output) = 'object'
  ),
  CONSTRAINT calculation_output_sha256_length CHECK (
    output_sha256 IS NULL OR octet_length(output_sha256) = 32
  ),
  CONSTRAINT calculation_completion CHECK (
    (status = 'running' AND completed_at IS NULL AND output IS NULL AND failure_code IS NULL)
    OR (status = 'succeeded' AND completed_at IS NOT NULL AND output IS NOT NULL AND output_sha256 IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND output IS NULL AND failure_code IS NOT NULL)
  )
);

CREATE TABLE calculation_input (
  household_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  ordinal integer NOT NULL,
  financial_record_id uuid,
  plan_record_id uuid,
  input_sha256 bytea NOT NULL,
  PRIMARY KEY (household_id, calculation_id, ordinal),
  FOREIGN KEY (household_id, calculation_id)
    REFERENCES calculation_run (household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, financial_record_id)
    REFERENCES financial_record (household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, plan_record_id)
    REFERENCES plan_record (household_id, id) ON DELETE CASCADE,
  CONSTRAINT calculation_input_ordinal_nonnegative CHECK (ordinal >= 0),
  CONSTRAINT calculation_input_one_source CHECK (
    (financial_record_id IS NOT NULL)::integer
    + (plan_record_id IS NOT NULL)::integer = 1
  ),
  CONSTRAINT calculation_input_sha256_length CHECK (
    octet_length(input_sha256) = 32
  )
);

CREATE TABLE idempotency_record (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  key uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES app_user (id),
  method text NOT NULL,
  canonical_path text NOT NULL,
  request_sha256 bytea NOT NULL,
  status idempotency_status NOT NULL,
  response_status integer,
  response_headers jsonb,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, key),
  CONSTRAINT idempotency_method CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  CONSTRAINT idempotency_path_absolute CHECK (canonical_path LIKE '/api/v1/%'),
  CONSTRAINT idempotency_request_sha256_length CHECK (
    octet_length(request_sha256) = 32
  ),
  CONSTRAINT idempotency_response_headers_object CHECK (
    response_headers IS NULL OR jsonb_typeof(response_headers) = 'object'
  ),
  CONSTRAINT idempotency_lifetime CHECK (
    expires_at >= created_at + interval '7 days'
  ),
  CONSTRAINT idempotency_completion CHECK (
    (status = 'running' AND response_status IS NULL AND response_headers IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR (status = 'completed' AND response_status BETWEEN 200 AND 599 AND response_headers IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idempotency_record_expiry_idx ON idempotency_record (expires_at);

CREATE TABLE local_json_import (
  household_id uuid NOT NULL REFERENCES household (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  source_sha256 bytea NOT NULL,
  source_schema_version integer NOT NULL,
  status local_json_import_status NOT NULL,
  validation_report jsonb NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  committed_at timestamptz,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, source_sha256),
  CONSTRAINT local_json_import_sha256_length CHECK (
    octet_length(source_sha256) = 32
  ),
  CONSTRAINT local_json_import_schema_version_positive CHECK (
    source_schema_version > 0
  ),
  CONSTRAINT local_json_import_report_object CHECK (
    jsonb_typeof(validation_report) = 'object'
  ),
  CONSTRAINT local_json_import_commit_state CHECK (
    (status = 'committed' AND committed_at IS NOT NULL)
    OR (status <> 'committed' AND committed_at IS NULL)
  )
);

CREATE TABLE local_json_import_item (
  household_id uuid NOT NULL,
  import_id uuid NOT NULL,
  collection_name text NOT NULL,
  local_key text NOT NULL,
  server_id uuid NOT NULL,
  PRIMARY KEY (household_id, import_id, collection_name, local_key),
  FOREIGN KEY (household_id, import_id)
    REFERENCES local_json_import (household_id, id) ON DELETE CASCADE,
  CONSTRAINT local_json_import_item_collection_nonempty CHECK (
    btrim(collection_name) <> ''
  ),
  CONSTRAINT local_json_import_item_key_nonempty CHECK (btrim(local_key) <> '')
);

-- Accepted facts and plan versions are append-only. Corrections and deletions
-- create new records instead of changing these rows.
CREATE FUNCTION reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Household deletion is a deliberate privacy operation. Its transaction
  -- sets this local flag before cascading through immutable history.
  IF current_setting('app.allow_financial_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is immutable; append a correction or version', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER financial_record_immutable
  BEFORE UPDATE OR DELETE ON financial_record
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER financial_entity_immutable
  BEFORE UPDATE OR DELETE ON financial_entity
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER financial_account_immutable
  BEFORE UPDATE OR DELETE ON financial_account
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER account_ownership_immutable
  BEFORE UPDATE OR DELETE ON account_ownership
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER fact_source_immutable
  BEFORE UPDATE OR DELETE ON fact_source
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER instrument_immutable
  BEFORE UPDATE OR DELETE ON instrument
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER balance_fact_immutable
  BEFORE UPDATE OR DELETE ON balance_fact
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER capital_flow_fact_immutable
  BEFORE UPDATE OR DELETE ON capital_flow_fact
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER income_fact_immutable
  BEFORE UPDATE OR DELETE ON income_fact
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER transfer_fact_immutable
  BEFORE UPDATE OR DELETE ON transfer_fact
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER holding_fact_immutable
  BEFORE UPDATE OR DELETE ON holding_fact
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER price_fact_immutable
  BEFORE UPDATE OR DELETE ON price_fact
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER exchange_rate_fact_immutable
  BEFORE UPDATE OR DELETE ON exchange_rate_fact
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER plan_record_immutable
  BEFORE UPDATE OR DELETE ON plan_record
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER account_plan_immutable
  BEFORE UPDATE OR DELETE ON account_plan
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER account_expected_return_plan_immutable
  BEFORE UPDATE OR DELETE ON account_expected_return_plan
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER recurring_flow_plan_immutable
  BEFORE UPDATE OR DELETE ON recurring_flow_plan
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER planned_expenditure_plan_immutable
  BEFORE UPDATE OR DELETE ON planned_expenditure_plan
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER household_settings_plan_immutable
  BEFORE UPDATE OR DELETE ON household_settings_plan
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

COMMIT;
