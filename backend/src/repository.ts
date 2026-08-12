import type { Pool, PoolClient, QueryResultRow } from "pg";
import { randomBytes } from "node:crypto";
import type { AgreementInput, MilestoneInput, ProposalInput } from "./types.js";

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
          delivery_deadline, created_by, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'drafting')
        RETURNING *`, [
        referenceCode(), lower(input.buyerAddress), lower(input.sellerAddress), lower(input.arbitrationAddress), lower(input.operatorAddress),
        input.totalUSDC, iso(input.negotiationExpiry), input.commitmentWindowSec, input.arbitrationTimeoutSec,
        input.goodsDescription.trim(), input.goodsCategory || null, input.quantity || null, input.quantityUnit || null, input.qualityStandard || null,
        input.transportMode, input.originCountry.trim(), input.originPortCity.trim(), input.destinationCountry.trim(), input.destinationPortCity.trim(),
        input.incoterm && input.incoterm !== "OTHER" ? input.incoterm : null, input.freightArranger, input.insuranceArranger, iso(input.deliveryDeadline), lower(createdBy)
      ]);
      return mapAgreement(result.rows[0]);
    },

    async getAgreement(id: string) {
      const agreement = await pool.query("SELECT * FROM trade_agreements WHERE id = $1", [id]);
      if (!agreement.rowCount) return null;
      const mapped = mapAgreement(agreement.rows[0]);
      const latest = await latestProposal(pool, id);
      const proposals = latest ? await milestonesForProposal(pool, latest.id) : [];
      return { ...mapped, latestProposal: latest ? { ...latest, milestones: proposals } : null, agreedMilestones: latest?.status === "accepted" ? proposals.map(contractMilestone) : null };
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
        if (["agreed", "deployed", "active", "completed", "cancelled"].includes(agreement.rows[0].status)) throw new Error("This agreement is no longer negotiable");
        await client.query("UPDATE proposals SET status = 'superseded' WHERE agreement_id = $1 AND status = 'pending'", [id]);
        const version = Number((await client.query("SELECT COALESCE(MAX(array_version), 0) + 1 AS next FROM proposals WHERE agreement_id = $1", [id])).rows[0].next);
        const proposal = await client.query("INSERT INTO proposals (agreement_id, proposed_by, array_version, note) VALUES ($1,$2,$3,$4) RETURNING *", [id, lower(actor), version, input.note || null]);
        await insertMilestones(client, proposal.rows[0].id, input.milestones);
        await client.query("INSERT INTO negotiation_events (agreement_id,event_type,actor_address,proposal_id,note) VALUES ($1,$2,$3,$4,$5)", [id, version === 1 ? "proposal_sent" : "counter_proposed", lower(actor), proposal.rows[0].id, input.note || null]);
        await client.query("UPDATE trade_agreements SET status = 'negotiating' WHERE id = $1", [id]);
        await client.query("COMMIT");
        return { ...mapProposal(proposal.rows[0]), milestones: input.milestones };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },

    async acceptProposal(id: string, actor: string) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const agreement = await client.query("SELECT * FROM trade_agreements WHERE id = $1 FOR UPDATE", [id]);
        if (!agreement.rowCount) throw new Error("Agreement not found");
        assertParticipant(agreement.rows[0], actor);
        const proposal = await client.query("SELECT * FROM proposals WHERE agreement_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [id]);
        if (!proposal.rowCount) throw new Error("There is no pending proposal to accept");
        const p = proposal.rows[0];
        const already = await client.query("SELECT 1 FROM negotiation_events WHERE proposal_id = $1 AND event_type = 'accepted' AND lower(actor_address) = lower($2)", [p.id, actor]);
        if (already.rowCount) throw new Error("This party has already accepted this proposal");
        await client.query("INSERT INTO negotiation_events (agreement_id,event_type,actor_address,proposal_id) VALUES ($1,'accepted',$2,$3)", [id, lower(actor), p.id]);
        const accepted = await client.query("SELECT COUNT(DISTINCT lower(actor_address))::int AS count FROM negotiation_events WHERE proposal_id = $1 AND event_type = 'accepted'", [p.id]);
        const isAgreed = Number(accepted.rows[0].count) === 2;
        if (isAgreed) {
          await client.query("UPDATE proposals SET status = 'accepted' WHERE id = $1", [p.id]);
          await client.query("UPDATE trade_agreements SET status = 'agreed' WHERE id = $1", [id]);
        }
        await client.query("COMMIT");
        const milestones = await milestonesForProposal(pool, p.id);
        return { proposal: { ...mapProposal({ ...p, status: isAgreed ? "accepted" : p.status }), milestones }, agreed: isAgreed, agreedMilestones: isAgreed ? milestones.map(contractMilestone) : null };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },

    async recordDeployment(id: string, actor: string, contractAddress: string, deploymentBlock: number) {
      const agreement = await pool.query("SELECT * FROM trade_agreements WHERE id = $1", [id]);
      if (!agreement.rowCount) throw new Error("Agreement not found");
      assertParticipant(agreement.rows[0], actor);
      if (agreement.rows[0].status !== "agreed") throw new Error("Both parties must agree before deployment");
      const result = await pool.query("UPDATE trade_agreements SET contract_address = $1, deployment_block = $2, status = 'deployed' WHERE id = $3 RETURNING *", [lower(contractAddress), deploymentBlock, id]);
      await pool.query("INSERT INTO negotiation_events (agreement_id,event_type,actor_address,note) VALUES ($1,'deployed',$2,$3)", [id, lower(actor), `Contract deployed at ${lower(contractAddress)}`]);
      return mapAgreement(result.rows[0]);
    },

    async diff(id: string, proposalId: string) {
      const current = await pool.query("SELECT * FROM proposals WHERE id = $1 AND agreement_id = $2", [proposalId, id]);
      if (!current.rowCount) throw new Error("Proposal not found");
      const previous = await pool.query("SELECT * FROM proposals WHERE agreement_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT 1", [id, current.rows[0].created_at]);
      if (!previous.rowCount) return { proposalId, previousProposalId: null, changedMilestones: [], warnings: [], note: current.rows[0].note };
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
const mapAgreement = (row: QueryResultRow) => ({ id: row.id, referenceCode: row.reference_code, contractAddress: row.contract_address, deploymentBlock: row.deployment_block, buyerAddress: row.buyer_address, sellerAddress: row.seller_address, arbitrationAddress: row.arbitration_address, operatorAddress: row.operator_address, totalUSDC: String(row.total_usdc), negotiationExpiry: new Date(row.negotiation_expiry).toISOString(), commitmentWindowSec: row.commitment_window_sec, arbitrationTimeoutSec: row.arbitration_timeout_sec, status: row.status, goodsDescription: row.goods_description, goodsCategory: row.goods_category, quantity: row.quantity === null ? null : String(row.quantity), quantityUnit: row.quantity_unit, qualityStandard: row.quality_standard, transportMode: row.transport_mode, originCountry: row.origin_country, originPortCity: row.origin_port_city, destinationCountry: row.destination_country, destinationPortCity: row.destination_port_city, incoterm: row.incoterm, freightArranger: row.freight_arranger, insuranceArranger: row.insurance_arranger, deliveryDeadline: new Date(row.delivery_deadline).toISOString(), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), createdBy: row.created_by });
const mapProposal = (row: QueryResultRow) => ({ id: row.id, agreementId: row.agreement_id, proposedBy: row.proposed_by, arrayVersion: row.array_version, status: row.status, note: row.note, createdAt: new Date(row.created_at).toISOString() });
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
