export type TransportMode = "sea" | "air" | "road" | "rail" | "inland_waterway" | "multimodal";

export type DeliveryTerm = {
  code: string;
  name: string;
  description: string;
  group: "origin" | "freight" | "destination";
  seaOnly: boolean;
  mostCommon?: boolean;
  namedPlaceLabel: string;
};

export type SuggestedMilestone = {
  description: string;
  basisPoints: number;
  proofDescription: string;
  sellerDeadlineSec: number;
  buyerResponseWindowSec: number;
  disputeWindowSec: number;
};

const defaults = { sellerDeadlineSec: 7 * 86400, buyerResponseWindowSec: 48 * 3600, disputeWindowSec: 48 * 3600 };

export const DELIVERY_TERMS: readonly DeliveryTerm[] = [
  { code: "EXW", name: "Ex Works", description: "The seller makes the goods available at their premises; the buyer handles collection and onward transport.", group: "origin", seaOnly: false, namedPlaceLabel: "Seller's premises or named place" },
  { code: "FCA", name: "Free Carrier", description: "The seller hands the goods to the buyer's chosen carrier at an agreed place.", group: "origin", seaOnly: false, mostCommon: true, namedPlaceLabel: "Place of delivery" },
  { code: "FAS", name: "Free Alongside Ship", description: "The seller places the goods alongside the vessel at the named port; the buyer takes over from there.", group: "origin", seaOnly: true, namedPlaceLabel: "Port of shipment" },
  { code: "FOB", name: "Free On Board", description: "The seller loads the goods on board the buyer's vessel; risk transfers once they are on board.", group: "origin", seaOnly: true, mostCommon: true, namedPlaceLabel: "Port of shipment" },
  { code: "CPT", name: "Carriage Paid To", description: "The seller pays carriage to the named destination, while risk transfers when the first carrier receives the goods.", group: "freight", seaOnly: false, namedPlaceLabel: "Place of destination" },
  { code: "CIP", name: "Carriage and Insurance Paid To", description: "The seller pays carriage and insurance to the named destination; risk transfers to the buyer at first-carrier handover.", group: "freight", seaOnly: false, namedPlaceLabel: "Place of destination" },
  { code: "CFR", name: "Cost and Freight", description: "The seller pays freight to the destination port; risk transfers when the goods are on board the vessel.", group: "freight", seaOnly: true, namedPlaceLabel: "Port of destination" },
  { code: "CIF", name: "Cost Insurance and Freight", description: "The seller pays freight and insurance to the destination port; risk transfers when the goods are on board.", group: "freight", seaOnly: true, mostCommon: true, namedPlaceLabel: "Port of destination" },
  { code: "DAP", name: "Delivered At Place", description: "The seller brings the goods to the named destination ready for unloading; the buyer unloads and clears import.", group: "destination", seaOnly: false, mostCommon: true, namedPlaceLabel: "Place of destination" },
  { code: "DPU", name: "Delivered At Place Unloaded", description: "The seller brings and unloads the goods at the named destination; the buyer handles import clearance.", group: "destination", seaOnly: false, namedPlaceLabel: "Place of destination" },
  { code: "DDP", name: "Delivered Duty Paid", description: "The seller delivers the goods ready for unloading and handles export, import, and duties.", group: "destination", seaOnly: false, namedPlaceLabel: "Place of destination" },
];

export const termsForMode = (mode: TransportMode): readonly DeliveryTerm[] =>
  DELIVERY_TERMS.filter(term => mode === "sea" || mode === "inland_waterway" || !term.seaOnly);

const milestone = (description: string, basisPoints: number, proofDescription: string): SuggestedMilestone => ({ ...defaults, description, basisPoints, proofDescription });

export const MILESTONE_SUGGESTIONS: Readonly<Record<string, readonly SuggestedMilestone[]>> = {
  EXW: [milestone("Goods ready for collection", 3000, "Readiness notice + packing list"), milestone("Delivery confirmed", 7000, "Signed collection receipt")],
  FCA: [milestone("Goods handed to carrier", 4000, "Carrier receipt / CMR"), milestone("Delivery confirmed", 6000, "Delivery receipt")],
  FAS: [milestone("Goods alongside vessel", 3000, "Alongside receipt"), milestone("Bill of Lading issued", 3000, "Bill of Lading"), milestone("Delivery confirmed", 4000, "Delivery receipt")],
  FOB: [milestone("Bill of Lading issued", 3500, "Bill of Lading"), milestone("Destination arrival", 2500, "Arrival notice"), milestone("Delivery confirmed", 4000, "Delivery receipt")],
  CFR: [milestone("Bill of Lading issued", 3500, "Bill of Lading"), milestone("Destination port arrival", 2500, "Vessel manifest / arrival notice"), milestone("Delivery confirmed", 4000, "Delivery receipt")],
  CIF: [milestone("Bill of Lading issued", 2500, "Bill of Lading"), milestone("Export customs clearance", 2000, "Export customs certificate"), milestone("Destination port arrival", 1500, "Vessel manifest / arrival notice"), milestone("Delivery confirmed", 4000, "Signed delivery receipt")],
  CPT: [milestone("Goods handed to first carrier", 3000, "Carrier receipt"), milestone("Destination arrival", 3000, "Arrival confirmation"), milestone("Delivery confirmed", 4000, "Delivery receipt")],
  CIP: [milestone("Goods handed to carrier + insurance", 3000, "Carrier receipt + insurance certificate"), milestone("Destination arrival", 3000, "Arrival confirmation"), milestone("Delivery confirmed", 4000, "Delivery receipt")],
  DAP: [milestone("Goods dispatched", 2000, "Dispatch notice / tracking reference"), milestone("In-country arrival", 3000, "Import arrival notice"), milestone("Delivery confirmed", 5000, "Signed delivery receipt")],
  DPU: [milestone("Goods dispatched", 2000, "Dispatch notice"), milestone("Arrived and unloaded", 4000, "Unloading receipt"), milestone("Delivery confirmed", 4000, "Signed receipt")],
  DDP: [milestone("Goods dispatched", 1500, "Dispatch notice"), milestone("Export customs cleared", 1500, "Export customs certificate"), milestone("Import customs cleared", 2000, "Import customs certificate"), milestone("Delivery confirmed", 5000, "Signed delivery receipt")],
};

export const suggestionsForTerm = (code: string): readonly SuggestedMilestone[] => MILESTONE_SUGGESTIONS[code] || [];
