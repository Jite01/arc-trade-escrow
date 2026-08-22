type TransportMode = "sea" | "air" | "road" | "rail" | "inland_waterway" | "multimodal";

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (value: unknown): value is string => typeof value === "string" && ADDRESS_RE.test(value);

export type ValidationResult = { ok: true } | { ok: false; message: string; field?: string };

export function validateProfileInput(input: Record<string, unknown>): ValidationResult {
  if (!input.companyName || !String(input.companyName).trim()) return { ok: false, field: "companyName", message: "Company name is required" };
  if (String(input.companyName).trim().length > 255) return { ok: false, field: "companyName", message: "Company name is too long" };
  if (!input.country || !String(input.country).trim()) return { ok: false, field: "country", message: "Country is required" };
  if (String(input.country).trim().length > 128) return { ok: false, field: "country", message: "Country is too long" };
  if (input.tradeCategory !== undefined && input.tradeCategory !== null && String(input.tradeCategory).length > 128) return { ok: false, field: "tradeCategory", message: "Trade category is too long" };
  return { ok: true };
}

export function validatePositiveUSDC(value: unknown): ValidationResult {
  if (typeof value !== "string" && typeof value !== "number") return { ok: false, field: "totalUSDC", message: "totalUSDC is required and must be greater than zero" };
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text) || Number(text) <= 0) return { ok: false, field: "totalUSDC", message: "totalUSDC is required and must be greater than zero" };
  return { ok: true };
}

export function validateAgreementInput(input: Record<string, unknown>, now = new Date()): ValidationResult {
  const total = validatePositiveUSDC(input.totalUSDC);
  if (!total.ok) return total;
  for (const field of ["operatorAddress", "createdBy"]) if (!isAddress(input[field])) return { ok: false, field, message: `${field} must be a valid wallet address` };
  const buyerKnown = input.buyerAddress === null || input.buyerAddress === undefined ? false : isAddress(input.buyerAddress);
  const sellerKnown = input.sellerAddress === null || input.sellerAddress === undefined ? false : isAddress(input.sellerAddress);
  if (input.buyerAddress !== null && input.buyerAddress !== undefined && !buyerKnown) return { ok: false, field: "buyerAddress", message: "buyerAddress must be a valid wallet address when supplied" };
  if (input.sellerAddress !== null && input.sellerAddress !== undefined && !sellerKnown) return { ok: false, field: "sellerAddress", message: "sellerAddress must be a valid wallet address when supplied" };
  if (!buyerKnown && !sellerKnown) return { ok: false, field: "sellerAddress", message: "At least one party address is required while drafting" };
  if (input.arbitrationAddress !== undefined && !isAddress(input.arbitrationAddress)) return { ok: false, field: "arbitrationAddress", message: "arbitrationAddress must be a valid wallet address when supplied" };
  if (buyerKnown && sellerKnown && String(input.buyerAddress).toLowerCase() === String(input.sellerAddress).toLowerCase()) return { ok: false, field: "sellerAddress", message: "Buyer and seller must be different wallet addresses" };
  const resolutionPolicy = String(input.resolutionPolicy || "ARCTRADE_DEFAULT");
  if (!["ARCTRADE_DEFAULT", "MUTUAL_RESOLVER"].includes(resolutionPolicy)) return { ok: false, field: "resolutionPolicy", message: "Unknown resolution policy" };
  if (input.assignedResolverAddress !== undefined && input.assignedResolverAddress !== null && input.assignedResolverAddress !== "" && !isAddress(input.assignedResolverAddress)) return { ok: false, field: "assignedResolverAddress", message: "assignedResolverAddress must be a valid wallet address when supplied" };
  const resolver = String(input.assignedResolverAddress || "").toLowerCase();
  if (resolutionPolicy === "ARCTRADE_DEFAULT" && resolver) return { ok: false, field: "assignedResolverAddress", message: "The ArcTrade default policy does not use a nominated resolver" };
  if (resolver && (resolver === String(input.buyerAddress || "").toLowerCase() || resolver === String(input.sellerAddress || "").toLowerCase())) return { ok: false, field: "assignedResolverAddress", message: "The nominated resolver must be independent of the buyer and seller" };
  if (!input.goodsDescription || !String(input.goodsDescription).trim()) return { ok: false, field: "goodsDescription", message: "goodsDescription is required" };
  const modes: TransportMode[] = ["sea", "air", "road", "rail", "inland_waterway", "multimodal"];
  if (!modes.includes(input.transportMode as TransportMode)) return { ok: false, field: "transportMode", message: "transportMode is required" };
  for (const field of ["originCountry", "originPortCity", "destinationCountry", "destinationPortCity", "freightArranger", "insuranceArranger"]) {
    if (!input[field] || !String(input[field]).trim()) return { ok: false, field, message: `${field} is required` };
  }
  if (!['seller', 'buyer', 'tba'].includes(String(input.freightArranger)) || !['seller', 'buyer', 'tba'].includes(String(input.insuranceArranger))) return { ok: false, field: "arrangement", message: "Freight and insurance arrangements are invalid" };
  if (input.quantity !== undefined && input.quantity !== null && (!/^\d+(?:\.\d{1,6})?$/.test(String(input.quantity)) || Number(input.quantity) <= 0)) return { ok: false, field: "quantity", message: "Quantity must be greater than zero when provided" };
  const negotiationExpiry = new Date(String(input.negotiationExpiry));
  const deliveryDeadline = new Date(String(input.deliveryDeadline));
  if (Number.isNaN(negotiationExpiry.valueOf()) || negotiationExpiry <= now) return { ok: false, field: "negotiationExpiry", message: "Agreement deadline must be in the future" };
  if (Number.isNaN(deliveryDeadline.valueOf()) || deliveryDeadline <= negotiationExpiry) return { ok: false, field: "deliveryDeadline", message: "Delivery deadline must be after the agreement deadline" };
  for (const field of ["commitmentWindowSec", "arbitrationTimeoutSec"]) {
    if (!Number.isInteger(Number(input[field])) || Number(input[field]) <= 0) return { ok: false, field, message: `${field} must be greater than zero` };
  }
  if (input.incoterm && typeof input.incoterm === "string" && input.incoterm !== "OTHER") {
    if (!["EXW", "FCA", "FAS", "FOB", "CPT", "CIP", "CFR", "CIF", "DAP", "DPU", "DDP"].includes(input.incoterm)) return { ok: false, field: "incoterm", message: "Unknown delivery term" };
    const valid = input.transportMode === "sea" || input.transportMode === "inland_waterway";
    if (!valid && ["FAS", "FOB", "CFR", "CIF"].includes(input.incoterm)) return { ok: false, field: "incoterm", message: "That delivery term is not available for this transport mode" };
    if (!String(input.deliveryNamedPlace || "").trim()) return { ok: false, field: "deliveryNamedPlace", message: "A named place is required when delivery terms are selected" };
    const insurance = String(input.insuranceArranger);
    const freight = String(input.freightArranger);
    if (["CIF", "CIP"].includes(input.incoterm) && insurance === "buyer") return { ok: false, field: "insuranceArranger", message: "Under CIF/CIP delivery terms, the seller provides insurance. Change delivery terms or set insurance arrangement to seller." };
    if (["CFR", "CPT"].includes(input.incoterm) && (freight !== "seller" && freight !== "tba")) return { ok: false, field: "freightArranger", message: "Under CFR/CPT delivery terms, the seller arranges main freight." };
    if (["CFR", "CPT"].includes(input.incoterm) && (insurance !== "buyer" && insurance !== "tba")) return { ok: false, field: "insuranceArranger", message: "Under CFR/CPT delivery terms, the buyer arranges insurance." };
    if (input.incoterm === "EXW" && (freight !== "buyer" && freight !== "tba")) return { ok: false, field: "freightArranger", message: "Under EXW delivery terms, the buyer arranges main freight." };
    if (input.incoterm === "EXW" && (insurance !== "buyer" && insurance !== "tba")) return { ok: false, field: "insuranceArranger", message: "Under EXW delivery terms, the buyer arranges insurance." };
    if (["FOB", "FAS", "FCA"].includes(input.incoterm) && (freight !== "buyer" && freight !== "tba")) return { ok: false, field: "freightArranger", message: "Under these delivery terms, the buyer arranges main freight." };
  }
  return { ok: true };
}

export function validateProposalMilestones(milestones: unknown): ValidationResult {
  if (!Array.isArray(milestones) || milestones.length === 0) return { ok: false, field: "milestones", message: "At least one milestone is required" };
  let sum = 0;
  for (const [index, milestone] of milestones.entries()) {
    if (!milestone || typeof milestone !== "object") return { ok: false, field: `milestones.${index}`, message: "Invalid milestone" };
    const row = milestone as Record<string, unknown>;
    if (!String(row.description || "").trim() || !String(row.proofDescription || "").trim()) return { ok: false, field: `milestones.${index}`, message: "Every milestone needs a description and proof description" };
    const basis = Number(row.basisPoints);
    sum += basis;
    if (!Number.isInteger(basis) || basis <= 0 || basis > 10000) return { ok: false, field: `milestones.${index}.basisPoints`, message: "Each payment share must be a whole number of basis points between 1 and 10,000" };
    for (const field of ["sellerDeadlineSec", "buyerResponseWindowSec", "disputeWindowSec"]) {
      if (!Number.isInteger(Number(row[field])) || Number(row[field]) <= 0) return { ok: false, field: `milestones.${index}.${field}`, message: "All milestone deadline fields must be greater than zero" };
    }
  }
  if (sum !== 10000) return { ok: false, field: "milestones", message: "Milestone payment shares must add up to exactly 100% (10,000 basis points)" };
  return { ok: true };
}
