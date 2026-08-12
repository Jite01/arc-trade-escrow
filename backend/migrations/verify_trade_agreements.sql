-- Run after 001_trade_agreements.sql with psql against a disposable database.
-- The transaction rolls back, so this verifies inserts and reads without
-- leaving sample records behind.
BEGIN;

INSERT INTO trade_agreements (
  reference_code, buyer_address, seller_address, arbitration_address, operator_address,
  total_usdc, negotiation_expiry, commitment_window_sec, arbitration_timeout_sec,
  goods_description, goods_category, quantity, quantity_unit, quality_standard,
  transport_mode, origin_country, origin_port_city, destination_country,
  destination_port_city, incoterm, freight_arranger, insurance_arranger,
  delivery_deadline, created_by
) VALUES (
  'AT-VERIFY-0001',
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  12500, now() + interval '7 days', 172800, 172800,
  'Verification goods', 'Physical goods', 10, 'tonnes', 'Buyer specification',
  'sea', 'GH', 'Tema', 'NL', 'Rotterdam', 'CIF', 'seller', 'seller',
  now() + interval '30 days', '0x1111111111111111111111111111111111111111'
);

SELECT reference_code, total_usdc, status, transport_mode, incoterm
FROM trade_agreements WHERE reference_code = 'AT-VERIFY-0001';

INSERT INTO proposals (agreement_id, proposed_by, array_version)
SELECT id, buyer_address, 1 FROM trade_agreements WHERE reference_code = 'AT-VERIFY-0001';

INSERT INTO proposal_milestones (proposal_id, index, description, basis_points, seller_deadline_sec, buyer_response_window_sec, dispute_window_sec, proof_description)
SELECT id, 0, 'Goods ready', 10000, 86400, 172800, 172800, 'Readiness notice'
FROM proposals WHERE agreement_id = (SELECT id FROM trade_agreements WHERE reference_code = 'AT-VERIFY-0001');

SELECT p.array_version, m.description, m.basis_points
FROM proposals p JOIN proposal_milestones m ON m.proposal_id = p.id
WHERE p.agreement_id = (SELECT id FROM trade_agreements WHERE reference_code = 'AT-VERIFY-0001');

ROLLBACK;
