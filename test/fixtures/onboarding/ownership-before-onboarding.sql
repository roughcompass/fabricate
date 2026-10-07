INSERT INTO repository_sources (
  id, public_id, name, clone_url, canonical_url, git_ref, enabled, lock_version, created_at, updated_at
) VALUES (
  101, 'src_onboarding_orders', 'orders', 'https://git.example.com/pay/orders.git', 'https://git.example.com/pay/orders', NULL, 1, 0, 1000, 1000
);

INSERT INTO seal_applications (id, public_id, seal_id, name, created_at) VALUES
  (201, 'sea_onboarding_payments', '88001', 'Payments workspace', 1000),
  (202, 'sea_onboarding_access', '88002', 'Access', 1000);

INSERT INTO lines_of_business (id, public_id, label, label_key, concept_key, created_at) VALUES
  (301, 'lob_onboarding_payments', 'Payments', 'payments', 'line-of-business/payments', 1000);

INSERT INTO portals (id, public_id, label, label_key, concept_key, created_at) VALUES
  (401, 'ptl_onboarding_access', 'Access', 'access', 'portal/access', 1000);

INSERT INTO ownership_assertions (
  id, public_id, attribute, operation,
  subject_repository_source_id, subject_application_id, subject_portal_id,
  value_application_id, value_team, value_line_of_business_id, value_portal_id, value_repository_source_id,
  provided_by, attributed_to, source, verification, verified_at, read_at, recorded_at
) VALUES
  (501, 'own_onboarding_application', 'seal_id', 'set', 101, NULL, NULL, 201, NULL, NULL, NULL, NULL, 'ana@example.com', NULL, 'person', 'unverified', NULL, NULL, 1000),
  (502, 'own_onboarding_team_old', 'team', 'set', NULL, 201, NULL, NULL, 'Payments Web', NULL, NULL, NULL, 'ana@example.com', NULL, 'person', 'unverified', NULL, NULL, 1100),
  (503, 'own_onboarding_team_new', 'team', 'set', NULL, 201, NULL, NULL, 'Payments Experience', NULL, NULL, NULL, 'ben@example.com', NULL, 'person', 'unverified', NULL, NULL, 1200),
  (504, 'own_onboarding_lob', 'line_of_business', 'set', NULL, 201, NULL, NULL, NULL, 301, NULL, NULL, 'ana@example.com', NULL, 'person', 'unverified', NULL, NULL, 1300),
  (505, 'own_onboarding_portal', 'portal', 'add', NULL, 201, NULL, NULL, NULL, NULL, 401, NULL, 'ana@example.com', NULL, 'person', 'unverified', NULL, NULL, 1400),
  (506, 'own_onboarding_owner', 'owner', 'set', NULL, NULL, 401, 202, NULL, NULL, NULL, NULL, 'ana@example.com', NULL, 'person', 'unverified', NULL, NULL, 1500),
  (507, 'own_onboarding_host', 'host', 'set', NULL, NULL, 401, NULL, NULL, NULL, NULL, 101, 'ana@example.com', NULL, 'person', 'unverified', NULL, NULL, 1600);

INSERT INTO ownership_supersessions (assertion_id, superseded_id) VALUES (503, 502);