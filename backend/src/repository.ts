import type { Pool, PoolClient, QueryResultRow } from "pg";
import { randomBytes } from "node:crypto";
import type { AgreementInput, MilestoneInput, ProposalInput } from "./types.js";
import { sha256 } from "./canonical.js";

const referenceCode = () => `AT-${Date.now().toString(36).toUpperCase()}-${randomBytes(5).toString("hex").toUpperCase()}`;
const iso = (value: unknown) => new Date(String(value)).toISOString();
const lower = (value: string) => value.toLowerCase();

export function createRepository(pool: Pool) {
  return {
    async createAgreement(input: AgreementInput, createdBy: string) {
      const result = await pool.query(`
        INSERT INTO trade_agreements (
          reference_code, buyer_address, seller_address, arbitration_address, operator_address,
          total_usdc, negotiation_expiry, commitment_window_sec, arbitration_timeout_sec,
          goods_description, goods_category, quantity, quantity_unit, quality_standard,
          transport_mode, origin_country, origin_port_city, destination_country,
          destination_port_city, incoterm, freight_arranger, insurance_arranger,
          delivery_named_place, delivery_named_place_type, delivery_deadline, created_by, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'drafting')
        RETURNING *`, [
        referenceCode(), lower(input.buyerAddress), lower(input.sellerAddress), lower(input.arbitrationAddress), lower(input.operatorAddress),
        input.totalUSDC, iso(input.negotiationExpiry), input.commitmentWindowSec, input.arbitrationTimeoutSec,
        input.goodsDescription.trim(), input.goodsCategory || null, input.quantity || null, input.quantityUnit || null, input.qualityStandard || null,
        input.transportMode, input.originCountry.trim(), input.originPortCity.trim(), input.destinationCountry.trim(), input.destinationPortCity.trim(),
        input.incoterm && input.incoterm !== "OTHER" ? input.incoterm : null, input.freightArranger, input.insuranceArranger,
        input.deliveryNamedPlace ? String(input.deliveryNamedPlace).trim() : null, namedPlaceType(input.incoterm), iso(input.deliveryDeadline), lower(createdBy)
      ]);
      return mapAgreement(result.rows[0]);
    },

    async getAgreement(id: string) {
      const agreement = await pool.query("SELECT * FROM trade_agreements WHERE id = $1", [id]);
      if (!agreement.rowCount) return null;
      const mapped = mapAgreement(agreement.rows[0]);
      const latest = await latestProposal(pool, id);
      const proposals = latest ? await milestonesForProposal(pool, latest.id) : [];
      const finalization = await pool.query("SELECT finalized_payload_hash FROM agreement_finalizations WHERE agreement_id = $1 ORDER BY negotiation_round DESC LIMIT 1", [id]);
      return { ...mapped, finalized_hash: finalization.rowCount ? finalization.rows[0].finalized_payload_hash : null, latestProposal: latest ? { ...latest, milestones: proposals } : null, agreedMilestones: latest?.status === "accepted" ? proposals.map(contractMilestone) : null };
    },

    async updateAgreement(id: string, actor: string, input: Record<string, unknown>) {
      const current = await pool.query("SELECT * FROM trade_agreements WHERE id = $1", [id]);
      if (!current.rowCount) throw new Error("Agreement not found");
      assertParticipant(current.rows[0], actor);
      if (["agreed", "deploying", "deployed", "cancelled"].includes(current.rows[0].status)) throw new Error("This agreement is no longer editable");
      const allowed: Record<string, string> = { goodsDescription: "goods_description", goodsCategory: "goods_category", quantity: "quantity", quantityUnit: "quantity_unit", qualityStandard: "quality_standard", originCountry: "origin_country", originPortCity: "origin_port_city", destinationCountry: "destination_country", destinationPortCity: "destination_port_city", incoterm: "incoterm", deliveryNamedPlace: "delivery_named_place", freightArranger: "freight_arranger", insuranceArranger: "insurance_arranger", deliveryDeadline: "delivery_deadline" };
      const fields = Object.keys(allowed).filter(key => input[key] !== undefined);
      if (!fields.length) return mapAgreement(current.rows[0]);
      const values = fields.map(key => key === "deliveryDeadline" ? iso(input[key]) : input[key] === "" ? null : input[key]);
      const set = fields.map((key, index) => `${allowed[key]} = $${index + 1}`).join(", ");
      const result = await pool.query(`UPDATE trade_agreements SET ${set} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
      return mapAgreement(result.rows[0]);
    },

    async listProposals(id: string) {
      const result = await pool.query("SELECT * FROM proposals WHERE agreement_id = $1 ORDER BY created_at ASC", [id]);
      return Promise.all(result.rows.map(async row => ({ ...mapProposal(row), milestones: await milestonesForProposal(pool, row.id) })));
    },

    async createProposal(id: string, actor: string, input: ProposalInput) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const agreement = await client.query("SELECT * FROM trade_agreements WHERE id = $1 FOR UPDATE", [id]);
        if (!agreement.rowCount) throw new Error("Agreement not found");
        assertParticipant(agreement.rows[0], actor);
        if (["agreed", "deploying", "deployed", "cancelled"].includes(agreement.rows[0].status)) throw new Error("This agreement is no longer negotiable");
        const previous = await client.query("SELECT * FROM proposals WHERE agreement_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [id]);
        await client.query("UPDATE proposals SET status = 'superseded' WHERE agreement_id = $1 AND status = 'pending'", [id]);
        const version = Number((await client.query("SELECT COALESCE(MAX(array_version), 0) + 1 AS next FROM proposals WHERE agreement_id = $1", [id])).rows[0].next);
        const round = Number(agreement.rows[0].negotiation_round || 1);
        const parentId = round > 1 ? null : (previous.rowCount ? previous.rows[0].id : null);
        const proposalHash = sha256(input.milestones.map((milestone, index) => ({ index, description: milestone.description.trim(), basis_points: milestone.basisPoints, seller_deadline_sec: milestone.sellerDeadlineSec, buyer_response_window_sec: milestone.buyerResponseWindowSec, dispute_window_sec: milestone.disputeWindowSec, proof_description: milestone.proofDescription.trim() })));
        const proposal = await client.query("INSERT INTO proposals (agreement_id, proposed_by, array_version, parent_proposal_id, proposal_hash, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [id, lower(actor), version, parentId, proposalHash, input.note || null]);
        await insertMilestones(client, proposal.rows[0].id, input.milestones);
        await client.query("INSERT INTO negotiation_events (agreement_id,event_type,actor_address,proposal_id,note) VALUES ($1,$2,$3,$4,$5)", [id, version === 1 ? "proposal_sent" : "counter_proposed", lower(actor), proposal.rows[0].id, input.note || null]);
        await client.query("UPDATE trade_agreements SET status = 'negotiating' WHERE id = $1", [id]);
        await client.query("COMMIT");
        return { ...mapProposal(proposal.rows[0]), milestones: input.milestones };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },

    async acceptProposal(id: string, actor: string, proposalId: string) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const agreement = await client.query("SELECT * FROM trade_agreements WHERE id = $1 FOR UPDATE", [id]);
        if (!agreement.rowCount) throw new Error("Agreement not found");
        assertParticipant(agreement.rows[0], actor);
        const proposal = await client.query("SELECT * FROM proposals WHERE id = $1 AND agreement_id = $2 FOR UPDATE", [proposalId, id]);
        if (!proposal.rowCount) throw new Error("Proposal not found");
        const p = proposal.rows[0];
        if (p.status !== "pending") throw new Error("This proposal is no longer pending");
        const newer = await client.query("SELECT 1 FROM proposals WHERE agreement_id = $1 AND status = 'pending' AND created_at > $2 LIMIT 1", [id, p.created_at]);
        if (newer.rowCount) { const error = new Error("A newer proposal exists. Accept or reject that proposal before acting on an older one."); (error as Error & { status?: number }).status = 409; throw error; }
        const already = await client.query("SELECT 1 FROM negotiation_events WHERE proposal_id = $1 AND event_type = 'accepted' AND lower(actor_address) = lower($2)", [p.id, actor]);
        if (already.rowCount) throw new Error("This party has already accepted this proposal");
        const timestampColumn = lower(actor) === lower(String(agreement.rows[0].buyer_address)) ? "accepted_by_buyer_at" : "accepted_by_seller_at";
        await client.query(`UPDATE proposals SET ${timestampColumn} = now() WHERE id = $1`, [p.id]);
        await client.query("INSERT INTO negotiation_events (agreement_id,event_type,actor_address,proposal_id) VALUES ($1,'accepted',$2,$3)", [id, lower(actor), p.id]);
        const accepted = await client.query("SELECT accepted_by_buyer_at IS NOT NULL AND accepted_by_seller_at IS NOT NULL AS both FROM proposals WHERE id = $1", [p.id]);
        const isAgreed = Boolean(accepted.rows[0].both);
        if (isAgreed) {
          await client.query("UPDATE proposals SET status = 'accepted' WHERE id = $1", [p.id]);
          await client.query("UPDATE trade_agreements SET status = 'agreed' WHERE id = $1", [id]);
          const milestones = await milestonesForProposal(client, p.id);
          const payload = finalizationPayload(agreement.rows[0], milestones);
          await client.query("INSERT INTO agreement_finalizations (agreement_id, proposal_id, negotiation_round, finalized_by, finalized_payload, finalized_payload_hash) VALUES ($1,$2,$3,$4,$5::jsonb,$6)", [id, p.id, agreement.rows[0].negotiation_round || 1, lower(actor), JSON.stringify(payload), sha256(payload)]);
        }
        await client.query("COMMIT");
        const milestones = await milestonesForProposal(pool, p.id);
        return { proposal: { ...mapProposal({ ...p, status: isAgreed ? "accepted" : p.status }), milestones }, agreed: isAgreed, agreedMilestones: isAgreed ? milestones.map(contractMilestone) : null };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },

    async beginDeployment(id: string, actor: string) {
      const agreement = await pool.query("SELECT * FROM trade_agreements WHERE id = $1", [id]);
      if (!agreement.rowCount) throw new Error("Agreement not found");
      assertParticipant(agreement.rows[0], actor);
      if (agreement.rows[0].status !== "agreed") throw new Error("Both parties must agree before deployment");
      const finalization = await pool.query("SELECT 1 FROM agreement_finalizations WHERE agreement_id = $1 AND negotiation_round = $2", [id, agreement.rows[0].negotiation_round || 1]);
      if (!finalization.rowCount) throw new Error("The agreed terms have not been finalised");
      const result = await pool.query("UPDATE trade_agreements SET status = 'deploying' WHERE id = $1 RETURNING *", [id]);
      return { buyerAddress: result.rows[0].buyer_address, sellerAddress: result.rows[0].seller_address, arbitrationAddress: result.rows[0].arbitration_address, operatorAddress: result.rows[0].operator_address, totalUSDC: String(result.rows[0].total_usdc), negotiationExpiry: Math.floor(new Date(result.rows[0].negotiation_expiry).getTime() / 1000), commitmentWindow: result.rows[0].commitment_window_sec, arbitrationTimeout: result.rows[0].arbitration_timeout_sec };
    },

    async confirmDeployment(id: string, actor: string, verified: { contractAddress: string; chainId: number; txHash: string; blockNumber: number }) {
      const agreement = await pool.query("SELECT * FROM trade_agreements WHERE id = $1", [id]);
      if (!agreement.rowCount) throw new Error("Agreement not found");
      assertParticipant(agreement.rows[0], actor);
      if (agreement.rows[0].status !== "deploying") throw new Error("Deployment intent has not been created");
      const round = agreement.rows[0].negotiation_round || 1;
      const result = await pool.query("UPDATE agreement_finalizations SET contract_address = $1, chain_id = $2, deployment_tx_hash = $3, deployment_block = $4 WHERE agreement_id = $5 AND negotiation_round = $6 RETURNING *", [lower(verified.contractAddress), verified.chainId, verified.txHash, verified.blockNumber, id, round]);
      if (!result.rowCount) throw new Error("The agreed terms have not been finalised");
      const updated = await pool.query("UPDATE trade_agreements SET contract_address = $1, deployment_block = $2, status = 'deployed' WHERE id = $3 RETURNING *", [lower(verified.contractAddress), verified.blockNumber, id]);
      await pool.query("INSERT INTO negotiation_events (agreement_id,event_type,actor_address,note) VALUES ($1,'deployed',$2,$3)", [id, lower(actor), `Verified contract deployed at ${lower(verified.contractAddress)}`]);
      return mapAgreement(updated.rows[0]);
    },

    async diff(id: string, proposalId: string) {
      const current = await pool.query("SELECT * FROM proposals WHERE id = $1 AND agreement_id = $2", [proposalId, id]);
      if (!current.rowCount) throw new Error("Proposal not found");
      const previous = current.rows[0].parent_proposal_id ? await pool.query("SELECT * FROM proposals WHERE id = $1", [current.rows[0].parent_proposal_id]) : { rowCount: 0, rows: [] };
      if (!previous.rowCount) return { proposalId, previousProposalId: null, changedMilestones: [], initialMilestones: await milestonesForProposal(pool, proposalId), warnings: [], note: current.rows[0].note };
      const [now, was] = await Promise.all([milestonesForProposal(pool, proposalId), milestonesForProposal(pool, previous.rows[0].id)]);
      const changedMilestones = diffMilestones(was, now, Number((await pool.query("SELECT total_usdc FROM trade_agreements WHERE id = $1", [id])).rows[0].total_usdc));
      return { proposalId, previousProposalId: previous.rows[0].id, changedMilestones, warnings: changedMilestones.flatMap(row => row.warnings), note: current.rows[0].note };
    }
  };
}

async function latestProposal(pool: Pool, id: string) { const result = await pool.query("SELECT * FROM proposals WHERE agreement_id = $1 ORDER BY created_at DESC LIMIT 1", [id]); return result.rowCount ? mapProposal(result.rows[0]) : null; }
async function milestonesForProposal(pool: Pool | PoolClient, proposalId: string) { const result = await pool.query("SELECT * FROM proposal_milestones WHERE proposal_id = $1 ORDER BY index ASC", [proposalId]); return result.rows.map(mapMilestone); }
async function insertMilestones(client: PoolClient, proposalId: string, milestones: MilestoneInput[]) { for (const [index, milestone] of milestones.entries()) await client.query("INSERT INTO proposal_milestones (proposal_id,index,description,basis_points,seller_deadline_sec,buyer_response_window_sec,dispute_window_sec,proof_description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [proposalId, index, milestone.description.trim(), milestone.basisPoints, milestone.sellerDeadlineSec, milestone.buyerResponseWindowSec, milestone.disputeWindowSec, milestone.proofDescription.trim()]); }
function assertParticipant(row: QueryResultRow, actor: string) { const value = lower(actor); if (value !== lower(String(row.buyer_address)) && value !== lower(String(row.seller_address))) throw new Error("Only the buyer or seller can access this agreement"); }
const mapAgreement = (row: QueryResultRow) => ({ id: row.id, referenceCode: row.reference_code, contractAddress: row.contract_address, deploymentBlock: row.deployment_block, onchainState: row.onchain_state ?? null, lastIndexedBlock: row.last_indexed_block ?? null, lastIndexedAt: row.last_indexed_at ? new Date(row.last_indexed_at).toISOString() : null, buyerAddress: row.buyer_address, sellerAddress: row.seller_address, arbitrationAddress: row.arbitration_address, operatorAddress: row.operator_address, totalUSDC: String(row.total_usdc), negotiationExpiry: new Date(row.negotiation_expiry).toISOString(), commitmentWindowSec: row.commitment_window_sec, arbitrationTimeoutSec: row.arbitration_timeout_sec, status: row.status, negotiationRound: row.negotiation_round ?? 1, commitmentExpiredAt: row.commitment_expired_at ? new Date(row.commitment_expired_at).toISOString() : null, goodsDescription: row.goods_description, goodsCategory: row.goods_category, quantity: row.quantity === null ? null : String(row.quantity), quantityUnit: row.quantity_unit, qualityStandard: row.quality_standard, transportMode: row.transport_mode, originCountry: row.origin_country, originPortCity: row.origin_port_city, destinationCountry: row.destination_country, destinationPortCity: row.destination_port_city, incoterm: row.incoterm, deliveryNamedPlace: row.delivery_named_place, deliveryNamedPlaceType: row.delivery_named_place_type, freightArranger: row.freight_arranger, insuranceArranger: row.insurance_arranger, deliveryDeadline: new Date(row.delivery_deadline).toISOString(), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), createdBy: row.created_by });
const mapProposal = (row: QueryResultRow) => ({ id: row.id, agreementId: row.agreement_id, proposedBy: row.proposed_by, parentProposalId: row.parent_proposal_id ?? null, proposalHash: row.proposal_hash ?? null, acceptedByBuyerAt: row.accepted_by_buyer_at ? new Date(row.accepted_by_buyer_at).toISOString() : null, acceptedBySellerAt: row.accepted_by_seller_at ? new Date(row.accepted_by_seller_at).toISOString() : null, arrayVersion: row.array_version, status: row.status, note: row.note, createdAt: new Date(row.created_at).toISOString() });
const mapMilestone = (row: QueryResultRow) => ({ id: row.id, index: row.index, description: row.description, basisPoints: row.basis_points, sellerDeadlineSec: row.seller_deadline_sec, buyerResponseWindowSec: row.buyer_response_window_sec, disputeWindowSec: row.dispute_window_sec, proofDescription: row.proof_description });
const contractMilestone = (row: ReturnType<typeof mapMilestone>) => ({ description: row.description, basisPoints: row.basisPoints, sellerDeadline: row.sellerDeadlineSec, buyerResponseWindow: row.buyerResponseWindowSec, disputeWindow: row.disputeWindowSec, proofDescription: row.proofDescription });

function diffMilestones(previous: ReturnType<typeof mapMilestone>[], current: ReturnType<typeof mapMilestone>[], totalUSDC: number) {
  const rows: Array<{ index: number; description: string; changes: Array<{ field: string; was: unknown; now: unknown }>; warnings: string[] }> = [];
  for (let index = 0; index < Math.max(previous.length, current.length); index++) {
    const oldRow = previous[index]; const newRow = current[index]; const changes: Array<{ field: string; was: unknown; now: unknown }> = [];
    for (const field of ["description", "basisPoints", "sellerDeadlineSec", "buyerResponseWindowSec", "disputeWindowSec", "proofDescription"] as const) if (oldRow?.[field] !== newRow?.[field]) changes.push({ field, was: oldRow?.[field] ?? null, now: newRow?.[field] ?? null });
    if (!changes.length) continue;
    const warnings: string[] = [];
    const oldReview = oldRow?.buyerResponseWindowSec || 0; const newReview = newRow?.buyerResponseWindowSec || 0;
    const oldDispute = oldRow?.disputeWindowSec || 0; const newDispute = newRow?.disputeWindowSec || 0;
    if (newReview < oldReview) warnings.push(`This change shortens the buyer review window; $${money(totalUSDC * (newRow?.basisPoints || 0) / 10000)} could release sooner if no response is made.`);
    if (newDispute < oldDispute) warnings.push(`This change shortens the dispute window; $${money(totalUSDC * (newRow?.basisPoints || 0) / 10000)} will have less time for a dispute.`);
    if ((newRow?.basisPoints || 0) > (oldRow?.basisPoints || 0) && index < Math.max(previous.length, current.length) - 1) warnings.push(`This change front-loads $${money(totalUSDC * ((newRow?.basisPoints || 0) - (oldRow?.basisPoints || 0)) / 10000)} into an earlier milestone.`);
    rows.push({ index, description: newRow?.description || oldRow?.description || `Milestone ${index + 1}`, changes, warnings });
  }
  return rows;
}
const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function namedPlaceType(incoterm: unknown) {
  if (["FAS", "FOB"].includes(String(incoterm))) return "port_of_shipment";
  if (["CFR", "CIF"].includes(String(incoterm))) return "port_of_destination";
  if (["DAP", "DPU", "DDP", "CPT", "CIP"].includes(String(incoterm))) return "place_of_destination";
  if (["EXW", "FCA"].includes(String(incoterm))) return "place_of_delivery";
  return null;
}

function finalizationPayload(agreement: QueryResultRow, milestones: ReturnType<typeof mapMilestone>[]) {
  return {
    parties: { buyer: lower(String(agreement.buyer_address)), seller: lower(String(agreement.seller_address)), arbitrator: lower(String(agreement.arbitration_address)), operator: lower(String(agreement.operator_address)) },
    totalUSDC: String(agreement.total_usdc),
    transport_mode: agreement.transport_mode,
    incoterm: agreement.incoterm,
    delivery_named_place: agreement.delivery_named_place,
    goods_description: agreement.goods_description,
    quantity: agreement.quantity === null ? null : String(agreement.quantity),
    unit: agreement.quantity_unit,
    quality_standard: agreement.quality_standard,
    delivery_deadline: new Date(agreement.delivery_deadline).toISOString(),
    negotiation_expiry: new Date(agreement.negotiation_expiry).toISOString(),
    commitment_window_sec: agreement.commitment_window_sec,
    arbitration_timeout_sec: agreement.arbitration_timeout_sec,
    milestones: milestones.map(milestone => ({ index: milestone.index, description: milestone.description, basis_points: milestone.basisPoints, seller_deadline_sec: milestone.sellerDeadlineSec, buyer_response_window_sec: milestone.buyerResponseWindowSec, dispute_window_sec: milestone.disputeWindowSec, proof_description: milestone.proofDescription }))
  };
}
