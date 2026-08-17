import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Contract, formatUnits, id, parseUnits } from "ethers";
import { config } from "./config";
import { agreementsFor, call, contractFor, createAgreement, errorMessage, getAgreement, readAgreement, readProvider, roleFor, type AgreementRecord, type Role } from "./contract";
import { getSettlements, type Settlement } from "./api";
import { createCircleEmbeddedWalletAdapter, type CircleLoginMode, type EmbeddedWalletSession } from "./wallet";
import { CommercialWorkflow } from "./commercial";
import { acceptProposal, bindProposal, companyByWallet, companyProposals, createProposal as submitProposal, deleteExpiredProposal, getProposal, lookupCompany, publicProposals, registerCompany, type Company, type Proposal, type ProposalVisibility } from "./registry";
import "./styles.css";

const wallet = createCircleEmbeddedWalletAdapter();
const states = ["Upcoming", "Awaiting submission", "Under review", "Dispute window open", "Payment released", "In dispute", "Resolved"];
const labels = { PENDING: "Payment processing", RETRYING: "Payment processing", AUTHORIZED: "Payment processing", MINTING: "Payment processing", MINTED: "Payment confirmed", FAILED: "Payment failed — contact support", PERMANENT_FAILURE: "Payment failed — contact support" };
const money = (n: bigint) => formatUnits(n, 6);
const proposalAmount = (proposal: Proposal) => proposal.totalUSDC;
const ref = (s?: string | null) => s ? `Ref: ${s.slice(2, 6).toUpperCase()}...${s.slice(-4).toUpperCase()}` : "—";
const date = (n: bigint) => n === 0n ? "—" : new Date(Number(n) * 1000).toLocaleString();
const routeParts = window.location.pathname.split("/").filter(Boolean);
const initialSignin = routeParts[0] === "signin" ? {
  recipient: routeParts[1] === "public" ? "" : routeParts[1] || "",
  proposalId: routeParts[1] === "public" ? routeParts[2] || "" : routeParts[2] || routeParts[1] || ""
} : { recipient: "", proposalId: "" };
const LAST_COMPANY_KEY = "arc-trade-last-company";
const humanizeSlug = (value: string) => value.split("-").filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const roleLabel = (role: Role) => role === "BUYER" ? "Initiator" : role === "SELLER" ? "Counterparty" : role === "ARBITRATOR" ? "Arbitrator" : "Viewer";

function ExplainerBoard() {
  return <aside className="trade-atlas" aria-labelledby="trade-atlas-title">
    <div className="atlas-heading"><p id="trade-atlas-title">A trade made executable</p><span>01 — 03</span></div>
    <div className="atlas-flow">
      <section className="atlas-stage atlas-stage--define">
        <div className="atlas-caption"><span>01</span><div><h3>Define the trade</h3><p><i className="atlas-typed atlas-typed--define">Goods, route, delivery terms, value, and parties.</i></p></div></div>
        <svg className="atlas-scene atlas-scene--define" viewBox="0 0 540 154" aria-hidden="true">
          <path className="atlas-flight-line" d="M90 84C179 17 353 19 462 82"/>
          <g className="atlas-document"><path d="M72 39h72l18 18v64H72z"/><path d="M144 39v19h18M90 69h49M90 82h56M90 95h35"/><path className="atlas-written-mark atlas-written-mark--one" d="M90 108h34"/><path className="atlas-written-mark atlas-written-mark--two" d="M90 117h49"/></g>
          <g className="atlas-writing-hand"><path d="M16 128c14-3 26-11 35-24l15-23c3-5 10-1 7 4l-10 18 18-19c4-4 10 1 6 6l-16 19 20-15c5-4 10 3 5 7l-20 16 18-10c5-3 9 4 3 7l-22 15c-9 6-19 10-32 12z"/><path d="m60 105 12 8"/></g>
          <g className="atlas-paper-plane"><g className="atlas-paper-plane--return"><path d="M112 70 166 88 112 106z"/><path d="M166 88h-39"/></g></g>
          <g className="atlas-agreement"><path d="M255 43h98v64h-98z"/><path d="M271 61h66M271 89h66"/><path className="atlas-slider-line" d="M271 75h66"/><circle className="atlas-slider" cx="278" cy="75" r="5"/></g>
          <g className="atlas-receiving-hand"><path d="M524 128c-14-3-26-11-35-24l-15-23c-3-5-10-1-7 4l10 18-18-19c-4-4-10 1-6 6l16 19-20-15c-5-4-10 3-5 7l20 16-18-10c-5-3-9 4-3 7l22 15c9 6 19 10 32 12z"/><path d="m480 105-12 8"/></g>
          <g className="atlas-handshake-hand atlas-handshake-hand--left">
            <path d="M154 57l38 27-17 27M162 50l38 27M192 84l8-7"/>
            <path d="M175 111l14-19c5-7 14-8 21-3l29 22c5 4 12 5 18 2l11-6c4-2 7 3 3 7l-11 8 14-4c5-1 7 5 2 8l-16 7c-11 5-22 3-31-4l-31-23"/>
            <path d="M211 108l12 9c6 4 12 5 18 2M204 115l12 10c5 4 11 5 16 3M197 122l11 9c4 4 9 5 14 4"/>
          </g>
          <g className="atlas-handshake-hand atlas-handshake-hand--right">
            <g transform="translate(540 184) scale(-1 -1)">
              <path d="M154 57l38 27-17 27M162 50l38 27M192 84l8-7"/>
              <path d="M175 111l14-19c5-7 14-8 21-3l29 22c5 4 12 5 18 2l11-6c4-2 7 3 3 7l-11 8 14-4c5-1 7 5 2 8l-16 7c-11 5-22 3-31-4l-31-23"/>
              <path d="M211 108l12 9c6 4 12 5 18 2M204 115l12 10c5 4 11 5 16 3M197 122l11 9c4 4 9 5 14 4"/>
            </g>
          </g>
          <g className="atlas-final-record"><path d="M287 115h35l10 10v19h-45z"/><path d="M322 115v10h10M297 130h24M297 137h17"/></g>
        </svg>
      </section>
      <section className="atlas-stage atlas-stage--plan">
        <div className="atlas-caption"><span>02</span><div><h3>Negotiate the payment plan</h3><p><i className="atlas-typed atlas-typed--plan">Milestones, proof, deadlines, and response windows.</i></p></div></div>
        <svg className="atlas-scene atlas-scene--plan" viewBox="0 0 540 154" aria-hidden="true">
          <path className="atlas-ruler-base" d="M57 75h426"/><path className="atlas-ruler-fill" d="M57 75h426"/><path d="M57 66v18M483 66v18"/>
          <g className="atlas-plan-hand atlas-plan-hand--left"><path d="M25 98c16-1 28-8 42-20l12-10"/></g><g className="atlas-plan-hand atlas-plan-hand--right"><path d="M515 98c-16-1-28-8-42-20l-12-10"/></g>
          <g className="atlas-pin atlas-pin--one"><path d="M215 42v40M205 53h20l-10-13z"/><circle cx="215" cy="75" r="6"/></g>
          <g className="atlas-pin atlas-pin--two"><path d="M326 42v40M316 53h20l-10-13z"/><circle cx="326" cy="75" r="6"/></g>
          <g className="atlas-proof-page"><path d="M176 28h20l6 6v25h-26zM196 28v7h6M183 42h12M183 49h9"/><path className="atlas-check" d="m182 65 5 5 11-12"/></g>
          <g className="atlas-proof-crate"><path d="m353 37 15-8 17 8v18l-17 9-15-9zM353 37l15 9 17-9M368 46v18"/><path d="M390 49c7 2 11 7 11 14"/></g>
          <g className="atlas-plan-record"><path d="M253 103h42l10 10v26h-52z"/><path d="M295 103v10h10M265 120h27M265 128h21"/><path className="atlas-lock" d="M268 97v-6c0-10 15-10 15 0v6"/></g>
          <circle className="atlas-proof-marker" cx="64" cy="75" r="4"/>
        </svg>
      </section>
      <section className="atlas-stage atlas-stage--settle">
        <div className="atlas-caption"><span>03</span><div><h3>Deploy once, then settle</h3><p><i className="atlas-typed atlas-typed--settle">The agreed commercial record joins the settlement rail.</i></p></div></div>
        <svg className="atlas-scene atlas-scene--settle" viewBox="0 0 540 184" aria-hidden="true">
          <g className="atlas-port atlas-port--start">
            <path d="M27 128V94h16v34z"/>
            <path d="M43 128v-18h22v18z"/>
            <path d="M20 128h52"/>
            <path d="M31 94V72h8v22z"/>
            <circle cx="35" cy="67" r="4"/>
          </g>
          <g className="atlas-port atlas-port--end">
            <path d="M497 128V94h16v34z"/>
            <path d="M475 128v-18h22v18z"/>
            <path d="M468 128h52"/>
            <path d="M501 94V72h8v22z"/>
            <circle cx="505" cy="67" r="4"/>
          </g>
          <g className="atlas-freight">
            <g className="atlas-birds">
              <path d="m207 47 7 5 7-5M239 39l6 4 6-4"/>
            </g>
            <path d="M166 124h193l-20 29H184z"/><path d="M191 124V91h57v33M208 91V72h29v19M251 124V88h42v36M256 88V74h32v14"/><path d="M199 106h39M258 102h26M258 113h26M192 138h142"/><path d="M297 95h33v29M297 105h33M297 114h33"/>
          </g>
          <g className="atlas-water"><path d="M20 153c10-8 20-8 30 0s20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0"/><path d="M20 168c10-8 20-8 30 0s20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0"/></g>
          <g className="atlas-rail"><path d="M144 177h252"/><path className="atlas-rail-value" d="M144 177h181"/><circle className="atlas-rail-stop atlas-rail-stop--one" cx="219" cy="177" r="5"/><circle className="atlas-rail-stop atlas-rail-stop--two" cx="324" cy="177" r="5"/><circle className="atlas-payment" cx="219" cy="177" r="5"/></g>
          <g className="atlas-thumbsup atlas-thumbsup--start"><rect x="46" y="55" width="9" height="25" rx="4.5"/><rect x="46" y="76" width="23" height="10" rx="3"/></g>
          <g className="atlas-thumbsup atlas-thumbsup--end"><rect x="485" y="55" width="9" height="25" rx="4.5"/><rect x="471" y="76" width="23" height="10" rx="3"/></g>
          <g className="atlas-payee"><path d="M405 182v-19c0-7 11-7 11 0v19M398 182h25M401 160h19"/></g>
          <g className="atlas-settled-record"><path d="M71 143h35l9 9v20H71z"/><path d="M106 143v9h9M80 158h25M80 165h18"/></g>
        </svg>
      </section>
    </div>
    <div className="atlas-footer"><span>Commercial terms</span><i /><span>Settlement logic</span></div>
  </aside>;
}

function App() {
  const [session, setSession] = useState<EmbeddedWalletSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [pathname, setPathname] = useState(window.location.pathname);
  const [marketingHome, setMarketingHome] = useState(() => window.location.hash === "#resources");
  const [company, setCompany] = useState<Company | null>(null);
  const [openProposals, setOpenProposals] = useState<Proposal[]>([]);
  const [myProposals, setMyProposals] = useState<Proposal[]>([]);
  const [agreements, setAgreements] = useState<AgreementRecord[]>([]);
  const [selected, setSelected] = useState<AgreementRecord | null>(null);
  const [data, setData] = useState<any>(null);
  const [role, setRole] = useState<Role>("READ_ONLY");
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [companyName, setCompanyName] = useState(() => initialSignin.recipient ? humanizeSlug(initialSignin.recipient) : localStorage.getItem(LAST_COMPANY_KEY) || "");
  const [profileCheck, setProfileCheck] = useState<"unchecked" | "new">("unchecked");
  const [recipientCompany, setRecipientCompany] = useState(() => initialSignin.recipient ? humanizeSlug(initialSignin.recipient) : "");
  const [agreementLabel, setAgreementLabel] = useState("");
  const [proposalDescription, setProposalDescription] = useState("");
  const [proposalVisibility, setProposalVisibility] = useState<ProposalVisibility>("PRIVATE");
  const [sellerCommitmentHours, setSellerCommitmentHours] = useState("1");
  const [buyerResponseMinutes, setBuyerResponseMinutes] = useState("15");
  const [disputeWindowMinutes, setDisputeWindowMinutes] = useState("15");
  const [proposalLifetimeHours, setProposalLifetimeHours] = useState("1");
  const [proposalLink, setProposalLink] = useState("");
  const [joinId, setJoinId] = useState(() => initialSignin.proposalId);
  const [proposal, setProposal] = useState({ description: "", basisPoints: "10000", sellerDeadline: "86400", buyerResponseWindow: "86400", disputeWindow: "86400" });
  const generation = useRef(0);
  const timers = useRef<number[]>([]);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, "", path);
    setPathname(new URL(path, window.location.origin).pathname);
  }, []);
  const openCommercial = useCallback(() => { setMarketingHome(false); navigate("/agreements/new"); }, [navigate]);
  const goHome = useCallback(() => { setMarketingHome(true); navigate("/#resources"); window.setTimeout(() => document.querySelector("#resources")?.scrollIntoView({ behavior: "smooth" }), 0); }, [navigate]);

  useEffect(() => {
    const handleNavigation = () => { setPathname(window.location.pathname); setMarketingHome(window.location.hash === "#resources"); };
    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("hashchange", handleNavigation);
    return () => { window.removeEventListener("popstate", handleNavigation); window.removeEventListener("hashchange", handleNavigation); };
  }, []);

  useEffect(() => {
    if (!marketingHome || window.location.hash !== "#resources") return;
    const timer = window.setTimeout(() => document.querySelector("#resources")?.scrollIntoView({ behavior: "smooth" }), 0);
    return () => window.clearTimeout(timer);
  }, [marketingHome]);

  const clearAgreement = useCallback(() => {
    generation.current++;
    timers.current.forEach(clearInterval);
    timers.current = [];
    setSelected(null);
    setData(null);
    setSettlements([]);
    setRole("READ_ONLY");
  }, []);

  const refreshAgreements = useCallback(async (address: string) => {
    try { setAgreements(await agreementsFor(address)); }
    catch { setMessage("We couldn’t load your agreements. Please try again."); }
  }, []);

  const refreshRegistry = useCallback(async (address: string) => {
    try {
      const [open, record] = await Promise.all([publicProposals(), companyByWallet(address)]);
      setCompany(record);
      setOpenProposals(open);
      if (!record) { setMyProposals([]); return; }
      setMyProposals(await companyProposals(record.slug));
    } catch { setMessage("We couldn’t load the company registry. Please try again."); }
  }, []);

  const loadAgreement = useCallback(async (record: AgreementRecord, currentSession: EmbeddedWalletSession | null) => {
    const current = ++generation.current;
    setMessage("");
    try {
      const next = await readAgreement(record.escrow);
      if (current !== generation.current) return;
      setData(next);
      setRole(currentSession ? roleFor(currentSession.address, next.terms) : "READ_ONLY");
      setSettlements(await getSettlements(config.relayerUrl, record.escrow).catch(() => []));
    } catch (error) {
      if (current === generation.current) setMessage(errorMessage(error, "loadAgreement"));
    }
  }, []);

  const selectAgreement = useCallback(async (record: AgreementRecord, currentSession: EmbeddedWalletSession | null = session) => {
    setSelected(record);
    setData(null);
    localStorage.setItem(`arc-trade-selected-agreement:${window.location.hostname}`, record.id);
    await loadAgreement(record, currentSession);
  }, [loadAgreement, session]);

  useEffect(() => {
    let alive = true;
    wallet.getSession().then(async current => {
      if (!alive || !current) return;
      setSession(current);
      setCompanyName(name => name || localStorage.getItem(`arc-trade-company:${current.address.toLowerCase()}`) || "");
      await Promise.all([refreshAgreements(current.address), refreshRegistry(current.address)]);
    }).finally(() => { if (alive) setSessionChecked(true); });
    const off = wallet.onAccountChange(async () => {
      const next = await wallet.getSession();
      clearAgreement();
      setSession(next);
      if (next) {
        setCompanyName(name => name || localStorage.getItem(`arc-trade-company:${next.address.toLowerCase()}`) || "");
        await Promise.all([refreshAgreements(next.address), refreshRegistry(next.address)]);
      }
    });
    return () => { alive = false; off(); clearAgreement(); };
  }, [clearAgreement, refreshAgreements, refreshRegistry]);

  useEffect(() => {
    if (!session || agreements.length === 0 || selected) return;
    const saved = localStorage.getItem(`arc-trade-selected-agreement:${window.location.hostname}`);
    const record = agreements.find(item => item.id.toLowerCase() === saved?.toLowerCase());
    if (record) void selectAgreement(record, session);
  }, [agreements, selected, selectAgreement, session]);

  useEffect(() => {
    if (!selected || !data || !session) return;
    const refresh = () => void loadAgreement(selected, session);
    const timer = window.setInterval(refresh, 10000);
    timers.current.push(timer);
    const c = contractFor(selected.escrow);
    const names = ["MilestoneReleased", "MilestoneArbitrated", "ArbitrationForced", "FundsReclaimed"];
    names.forEach(name => c.on(name, refresh));
    return () => { clearInterval(timer); timers.current = timers.current.filter(item => item !== timer); names.forEach(name => c.off(name, refresh)); };
  }, [data, loadAgreement, selected, session]);

  useEffect(() => {
    if (!initialSignin.proposalId) return;
    setAuthMode("login");
    if (initialSignin.recipient) {
      const prettyRecipient = humanizeSlug(initialSignin.recipient);
      setRecipientCompany(prettyRecipient);
      setCompanyName(current => current || prettyRecipient);
    }
    void getProposal(initialSignin.proposalId).then(proposal => {
      if (!proposal.recipientCompany) return;
      const prettyRecipient = humanizeSlug(proposal.recipientCompany);
      setRecipientCompany(prettyRecipient);
      setCompanyName(current => current || prettyRecipient);
    }).catch(() => {});
  }, []);

  const signIn = async (mode: CircleLoginMode) => {
    const name = companyName.trim();
    if (!name) { setMessage("Enter your company name to continue."); return; }
    if (!/[a-z0-9]/i.test(name)) { setMessage("Use at least one letter or number in the company name."); return; }
    localStorage.setItem(LAST_COMPANY_KEY, name);
    setBusy("signIn"); setMessage("");
    try {
      const existing = await lookupCompany(name);
      if (mode === "login" && !existing) {
        setAuthMode("register");
        setProfileCheck("new");
        setMessage("We couldn’t find a company profile with that name. If this is a new profile, continue to create access.");
        return;
      }
      if (mode === "register" && !existing && profileCheck !== "new") {
        setProfileCheck("new");
        setMessage("No profile exists yet. Continue once more to create this company profile with your passkey.");
        return;
      }
      const next = await wallet.login(name, existing ? "login" : "register");
      const addressCompany = await companyByWallet(next.address);
      if (addressCompany && (!existing || addressCompany.slug !== existing.slug)) {
        throw new Error(`This passkey is already linked to ${addressCompany.name}. Enter that company name to continue.`);
      }
      const record = addressCompany || await registerCompany(name, next.address);
      wallet.rememberCredential(record.name, next.credentialId);
      localStorage.setItem(`arc-trade-company:${next.address.toLowerCase()}`, record.name);
      localStorage.setItem(LAST_COMPANY_KEY, record.name);
      setCompanyName(record.name); setCompany(record); setSession(next); setAuthMode(null); await Promise.all([refreshAgreements(next.address), refreshRegistry(next.address)]);
    }
    catch (error) { console.error("Sign-in failed", error); setMessage(errorMessage(error, "signIn")); }
    finally { setBusy(""); }
  };

  const signOut = async () => { await wallet.logout(); clearAgreement(); setAgreements([]); setOpenProposals([]); setMyProposals([]); setCompany(null); setSession(null); };

  const restoreProfile = async (name: string) => {
    if (!session || !name.trim()) { setMessage("Enter the company name to restore this profile."); return; }
    setBusy("restoreProfile"); setMessage("");
    try {
      const record = await registerCompany(name, session.address);
      localStorage.setItem(`arc-trade-company:${session.address.toLowerCase()}`, record.name);
      localStorage.setItem(LAST_COMPANY_KEY, record.name);
      setCompany(record); await refreshRegistry(session.address);
    } catch (error) { setMessage(error instanceof Error ? error.message : errorMessage(error, "restoreProfile")); }
    finally { setBusy(""); }
  };

  const create = async () => {
    if (!session) return;
    if (!company) { setMessage("Restore your company profile before creating a proposal."); return; }
    if (proposalVisibility === "PRIVATE" && !recipientCompany.trim()) { setMessage("Enter the recipient company for a private proposal, or make the proposal public."); return; }
    setBusy("createAgreement"); setMessage("");
    try {
      const commitmentWindow = Math.max(300, Math.min(7 * 86400, Number(sellerCommitmentHours) * 3600 || 3600));
      const buyerWindow = Math.max(60, Math.min(86400, Number(buyerResponseMinutes) * 60 || 900));
      const disputeWindow = Math.max(60, Math.min(7 * 86400, Number(disputeWindowMinutes) * 60 || 900));
      const lifetime = Math.max(300, Math.min(7 * 86400, Number(proposalLifetimeHours) * 3600 || 3600));
      const proposal = await submitProposal({
        proposerCompany: company.slug, proposerAddress: session.address,
        recipientCompany: proposalVisibility === "PRIVATE" ? recipientCompany.trim() : null,
        visibility: proposalVisibility, title: agreementLabel.trim() || "Documentary trade agreement",
        description: proposalDescription.trim(), totalUSDC: "20", sellerCommitmentWindow: commitmentWindow,
        buyerResponseWindow: buyerWindow, disputeWindow, proposalExpiresAt: Math.floor(Date.now() / 1000) + lifetime,
        milestones: [
          { description: "Shipment documents", basisPoints: 3000, sellerDeadline: commitmentWindow, buyerResponseWindow: buyerWindow, disputeWindow },
          { description: "Proof of delivery", basisPoints: 7000, sellerDeadline: commitmentWindow, buyerResponseWindow: buyerWindow, disputeWindow }
        ]
      });
      const recipientSlug = proposal.recipientCompany ? proposal.recipientCompany.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "";
      const shareValue = proposal.visibility === "PRIVATE" ? `${window.location.origin}/signin/${recipientSlug}/${proposal.id}` : "";
      setRecipientCompany(""); setAgreementLabel(""); setProposalDescription(""); setProposalLink(shareValue);
      setMessage(proposal.visibility === "PRIVATE"
        ? "Private invitation ready. Share the link with the recipient."
        : "Public proposal published.");
      setMyProposals(current => [proposal, ...current.filter(item => item.id !== proposal.id)]);
      setOpenProposals(current => proposal.visibility === "PUBLIC" ? [proposal, ...current.filter(item => item.id !== proposal.id)] : current);
    } catch (error) { setMessage(errorMessage(error, "createAgreement")); }
    finally { setBusy(""); }
  };

  const removeExpired = async (proposal: Proposal) => {
    if (!session) return;
    setBusy(`delete:${proposal.id}`); setMessage("");
    try {
      await deleteExpiredProposal(proposal.id, session.address);
      setMyProposals(current => current.filter(item => item.id !== proposal.id));
      setMessage(`Removed ${proposal.id} from your registry.`);
    } catch (error) { setMessage(errorMessage(error, "deleteProposal")); }
    finally { setBusy(""); }
  };

  const join = async () => {
    const value = joinId.trim();
    setBusy("joinAgreement"); setMessage("");
    try {
      const routeParts = value.match(/\/signin\/([^/?#]+)\/([^/?#]+)/);
      const proposalId = routeParts?.[2] || value.match(/\/signin\/([^/?#]+)/)?.[1] || value;
      if (!/^0x[0-9a-fA-F]{64}$/.test(proposalId)) {
        if (!session || !company) throw new Error("Sign in with a company profile before opening a proposal");
        const proposal = await getProposal(proposalId);
        if (proposal.proposerAddress.toLowerCase() === session.address.toLowerCase()) {
          if (proposal.status !== "ACCEPTED" || !proposal.acceptedByAddress) throw new Error("The recipient has not accepted this proposal yet");
          const record = await createAgreement(session.signer, id(`arc-trade-proposal:${proposal.id}`), proposal.acceptedByAddress, parseUnits(proposal.totalUSDC, 6), BigInt(Math.floor(Date.now() / 1000) + 7 * 86400), BigInt(proposal.sellerCommitmentWindow), BigInt(proposal.disputeWindow));
        await bindProposal(proposal.id, record.id, record.escrow);
          setAgreements(current => [record, ...current.filter(item => item.id.toLowerCase() !== record.id.toLowerCase())]);
          setMyProposals(current => current.map(item => item.id === proposal.id ? { ...item, status: "ACCEPTED", agreementId: record.id, escrowAddress: record.escrow } : item));
          setJoinId(""); await selectAgreement(record, session); return;
        }
        if (proposal.status !== "OPEN") throw new Error("This proposal is no longer open");
        const accepted = await acceptProposal(proposal.id, company.slug, session.address);
        setMyProposals(current => [accepted, ...current.filter(item => item.id !== accepted.id)]);
        setJoinId(""); setMessage("Proposal accepted. The proposing company can now deploy the escrow agreement."); return;
      }
      const record = await getAgreement(value);
      if (!record) throw new Error("Agreement not found");
      if (session && ![record.buyer, record.seller, record.arbitrator].some(address => address.toLowerCase() === session.address.toLowerCase())) throw new Error("This account is not a participant in that agreement");
      setAgreements(current => [record, ...current.filter(item => item.id.toLowerCase() !== record.id.toLowerCase())]);
      setJoinId(""); await selectAgreement(record, session);
    } catch (error) { setMessage(errorMessage(error, "joinAgreement")); }
    finally { setBusy(""); }
  };

  const run = async (name: string, args: any[] = []) => {
    if (!session || !selected) return;
    setBusy(name); setMessage("");
    try { const tx = await call(session.signer, selected.escrow, name, ...args); await tx.wait(); await loadAgreement(selected, session); }
    catch (error) { setMessage(errorMessage(error, name)); }
    finally { setBusy(""); }
  };

  const approveAndDeposit = async () => {
    if (!session || !selected || !data) return;
    setBusy("approve"); setMessage("");
    try {
      const token = new Contract(config.tokenAddress, ["function approve(address,uint256) returns(bool)"], session.signer);
      const approval = await token.approve(selected.escrow, data.terms.total); await approval.wait();
      setBusy("depositUSDS"); const deposit = await call(session.signer, selected.escrow, "depositUSDS"); await deposit.wait(); await loadAgreement(selected, session);
    } catch (error) { setMessage(errorMessage(error, busy || "depositUSDS")); }
    finally { setBusy(""); }
  };

  if (!session && !sessionChecked) return <main className="shell landing-shell app-loading"><div className="loading-card"><span className="mark">AT</span><p className="eyebrow">Arc Trade</p><h1>Opening your trade desk.</h1><p>Checking your secure session…</p></div></main>;

  if (!session || marketingHome) return <main className="shell landing-shell">
    <header className="site-header"><a className="brand" href="/#resources" onClick={event => { event.preventDefault(); goHome(); }}><span className="mark">AT</span><span>Arc<span>Trade</span></span></a><nav className="site-nav"><a href="#how-it-works">Platform</a><a href="#principles">Principles</a><a href="#resources">Resources</a></nav><button className="secondary" disabled={!!busy} onClick={() => session ? openCommercial() : (setAuthMode("register"), setMessage(""))}>{busy ? "Opening…" : session ? "Draft an agreement" : "Get started"}</button></header>
    <section className="hero-grid">
      <div className="hero">
        <p className="eyebrow">Commercial agreement registry · Arc Testnet</p>
        <h1>The agreement <em>comes first.</em></h1>
        <p className="hero-copy">Buyers and sellers negotiate the full commercial record — goods, route, delivery terms, and milestone conditions — before a single dollar is committed. The settlement follows the agreement. Not the other way around.</p>
        {message && <div className="error">{message}</div>}
        {authMode === null ? <div className="actions hero-actions"><button disabled={!!busy} onClick={() => session ? openCommercial() : (setAuthMode("register"), setMessage(""))}>Draft an agreement <span aria-hidden>↗</span></button><button className="secondary" disabled={!!busy} onClick={() => session ? setMarketingHome(false) : (setAuthMode("login"), setMessage(""))}>{session ? "Open the trade desk" : "Sign in to the trade desk"}</button></div> : <section className="panel auth-panel">
          <p className="eyebrow">{initialSignin.proposalId ? "Proposal invitation" : authMode === "register" ? "Create access" : "Sign in"}</p>
          <h2>{initialSignin.proposalId ? `Review the invitation for ${companyName || "your company"}` : authMode === "register" ? "Create your company access" : "Open your trade desk"}</h2>
          <p className="notice">{initialSignin.proposalId ? `You have been invited to review proposal ${initialSignin.proposalId}. Enter the invited company name to continue.` : authMode === "register" ? "Your company name identifies the commercial profile. A passkey then secures access to its agreements." : "Enter your company name first. We will check whether the profile exists, then open it with your passkey."}</p>
          <label className="field-label">Company name<input aria-label="Company name" placeholder="e.g. Northstar Logistics" value={companyName} onChange={event => { setCompanyName(event.target.value); setProfileCheck("unchecked"); setMessage(""); }} autoComplete="organization" /></label>
          <p className="auth-help">No password is stored here. Your device passkey confirms that you control this company profile.</p>
          <div className="actions">{authMode === "register" ? <button disabled={!!busy} onClick={() => void signIn("register")}>{busy ? "Checking profile…" : profileCheck === "new" ? "Continue with passkey" : "Check company name"}</button> : <button disabled={!!busy} onClick={() => void signIn("login")}>{busy ? "Checking profile…" : "Continue with passkey"}</button>}<button className="secondary" disabled={!!busy} onClick={() => { setAuthMode(null); setMessage(""); }}>Cancel</button></div>
        </section>}
        <div className="trust-row"><span>Passkey secured</span><span>•</span><span>Verifiable agreements</span><span>•</span><span>Documentary settlement</span></div>
      </div>
      <ExplainerBoard />
    </section>
    <section className="how-it-works" id="how-it-works"><div><p className="eyebrow">The platform</p><h2>Agree first. Deploy once. Settle on the terms you wrote.</h2></div><div className="how-copy"><p>Before any contract is deployed, Arc Trade gives both companies a structured place to establish the commercial context and negotiate how payment follows evidence. Once the terms are accepted, the buyer deploys the settlement contract once. The registry remains the source of commercial context; the contract handles financial settlement.</p><a href="#principles">Read the operating principles <span aria-hidden>↘</span></a></div></section>
    <section className="principles" id="principles"><article><span>01</span><h3>Commercial context stays explicit</h3><p>Goods, route, delivery terms, named place, quality standards, and proof requirements live in the agreement record—not in an opaque transaction note.</p></article><article><span>02</span><h3>Payment follows agreed evidence</h3><p>Each milestone defines the amount, seller deadline, buyer response window, dispute window, and proof description before either party approves the schedule.</p></article><article><span>03</span><h3>Finalization is consequential</h3><p>Mutual acceptance produces a tamper-evident record. Buyer, seller, value, and deployment parameters are reviewed before the settlement contract is created once.</p></article></section>
    <section className="resources" id="resources"><div className="resources-intro"><p className="eyebrow">Product resources</p><h2>Know what the record does before you use it.</h2><p>Arc Trade is built for consequential commercial agreements. These resources explain the workflow, the settlement boundary, and how to get help.</p></div><div className="resource-grid"><a className="resource-card" href="#how-it-works" id="documentation"><span>01 / Documentation</span><strong>Read the agreement guide ↗</strong><p>Understand the commercial record, proposal versions, finalization, and deployment handoff.</p></a><a className="resource-card" href="#faqs" id="faqs"><span>02 / FAQs</span><strong>Common questions ↘</strong><p>Answers about wallets, delivery terms, milestones, evidence, and Arc Testnet settlement.</p></a><a className="resource-card" href="#support" id="help-resource"><span>03 / Help &amp; support</span><strong>Get help with a trade record ↗</strong><p>Bring the agreement reference and the step where you need assistance.</p></a><button className="resource-card resource-card-button" onClick={() => { setAuthMode("register"); setMessage(""); }}><span>04 / Mainnet waitlist</span><strong>Join the mainnet waitlist ↗</strong><p>Start on Arc Testnet today and register your interest in mainnet access.</p></button></div></section>
    <section className="faq-section"><div><p className="eyebrow">FAQs</p><h2>Clear answers for a serious workflow.</h2></div><div className="faq-list"><details><summary>Is Arc Trade the settlement contract?</summary><p>No. Arc Trade stores the commercial agreement and negotiation record. The settlement contract is deployed once to handle the financial rail after both parties approve the milestone schedule.</p></details><details><summary>What happens before deployment?</summary><p>The parties establish the goods, route, delivery terms, value, counterparties, deadlines, and milestone payment plan. The buyer deploys only after mutual acceptance.</p></details><details><summary>What does a wallet represent?</summary><p>Your wallet is your account identity. It is used to authenticate actions and sign the deployment or settlement transactions that belong to your company profile.</p></details></div></section>
    <footer className="site-footer" id="support"><div><a className="brand" href="/#resources" onClick={event => { event.preventDefault(); goHome(); }}><span className="mark">AT</span><span>Arc<span>Trade</span></span></a><p>Commercial agreement infrastructure for documentary trade.</p></div><nav><a href="#documentation">Documentation</a><a href="#faqs">FAQs</a><a href="#support">Help &amp; support</a><a href="#resources">Mainnet waitlist</a></nav><small>Arc Testnet · Commercial records are complementary to on-chain settlement.</small></footer>
  </main>;

  if (pathname.startsWith("/agreements")) return <CommercialWorkflow session={session} onSignOut={signOut} onHome={goHome} />;

  if (!selected || !data) return <Dashboard session={session} company={company} profileHint={companyName} openProposals={openProposals} myProposals={myProposals} agreements={agreements} busy={busy} message={message} proposalLink={proposalLink} recipientCompany={recipientCompany} agreementLabel={agreementLabel} proposalDescription={proposalDescription} proposalVisibility={proposalVisibility} sellerCommitmentHours={sellerCommitmentHours} buyerResponseMinutes={buyerResponseMinutes} disputeWindowMinutes={disputeWindowMinutes} proposalLifetimeHours={proposalLifetimeHours} joinId={joinId} setRecipientCompany={setRecipientCompany} setAgreementLabel={setAgreementLabel} setProposalDescription={setProposalDescription} setProposalVisibility={setProposalVisibility} setSellerCommitmentHours={setSellerCommitmentHours} setBuyerResponseMinutes={setBuyerResponseMinutes} setDisputeWindowMinutes={setDisputeWindowMinutes} setProposalLifetimeHours={setProposalLifetimeHours} setJoinId={setJoinId} create={create} join={join} openAgreement={openCommercial} goHome={goHome} removeExpired={removeExpired} restoreProfile={restoreProfile} select={record => void selectAgreement(record, session)} signOut={signOut} />;

  const t = data.terms; const finalized = data.state === 3;
  return <main className="shell"><header><span className="mark">AT</span><span>Arc Trade</span><span className="account">{roleLabel(role)} · {ref(session.address)} <button className="quiet" onClick={signOut}>Sign out</button></span></header><div className="topline"><div><p className="eyebrow">Agreement {ref(selected.id)}</p><h1>{finalized ? "Trade agreement completed" : "Trade agreement"}</h1></div><div className="actions"><button className="secondary" onClick={clearAgreement}>All agreements</button><span className="pill">{finalized ? "Completed" : data.state === 0 ? "Negotiation" : data.state === 1 ? "Committed" : "In progress"}</span></div></div>{message && <div className="error">{message}</div>}{role === "READ_ONLY" && <section className="panel"><h2>This account is not a participant</h2><p className="notice">Open an agreement created for this passkey or sign in with the invited profile.</p></section>}<section className="grid terms"><Card title="Secured amount"><strong>{money(t.total)}</strong><small>Trade value</small></Card><Card title="Participant approvals"><strong>{data.approvals.buyer ? "Approved" : "Pending"} / {data.approvals.seller ? "Approved" : "Pending"}</strong><small>Proposal v{data.approvals.version}</small></Card><Card title="Commitment deadline"><strong>{date(t.negotiationExpiry)}</strong><small>Negotiation expiry</small></Card></section>{role !== "READ_ONLY" && data.state === 0 && <section className="panel"><div className="section-head"><div><p className="eyebrow">Negotiation</p><h2>Milestones</h2></div><div className="actions"><button disabled={!!busy || !proposal.description} onClick={() => run("proposeMilestones", [[{ description: proposal.description, basisPoints: proposal.basisPoints, sellerDeadline: proposal.sellerDeadline, buyerResponseWindow: proposal.buyerResponseWindow, disputeWindow: proposal.disputeWindow }]])}>Propose milestones</button><button className="secondary" disabled={!!busy || data.milestones.length === 0} onClick={() => run("approve")}>Approve proposal</button>{role === "BUYER" && <><button className="secondary" onClick={() => run("cancel")}>Cancel agreement</button><button className="secondary" onClick={() => run("expire")}>Expire agreement</button></>}</div></div><div className="proposal"><input placeholder="Milestone description" value={proposal.description} onChange={event => setProposal({ ...proposal, description: event.target.value })} /><input placeholder="Basis points" value={proposal.basisPoints} onChange={event => setProposal({ ...proposal, basisPoints: event.target.value })} /></div><MilestoneList data={data} role={role} run={run} settlements={settlements} /></section>}{role !== "READ_ONLY" && data.state === 1 && <section className="panel"><p className="eyebrow">Commitment</p><h2>Secure the agreed amount</h2><p>The initiating profile secures the total amount before milestones begin.</p>{role === "BUYER" ? <button disabled={!!busy} onClick={approveAndDeposit}>{busy ? "Working…" : "Secure funds"}</button> : <><p className="notice">Waiting for the initiating profile to secure funds.</p><button className="secondary" disabled={!!busy} onClick={() => run("abandonCommitment")}>Reopen negotiation when permitted</button></>}</section>}{(data.state === 2 || finalized) && <><section className="grid terms"><Card title="Secured funds"><strong>{money(data.balances.remaining + data.balances.released)}</strong><small>Original amount</small></Card><Card title="Released"><strong>{money(data.balances.released)}</strong><small>Paid to date</small></Card><Card title="Remaining"><strong>{money(data.balances.remaining)}</strong><small>Still secured</small></Card><Card title="Disputed"><strong>{money(data.balances.disputed)}</strong><small>Under review</small></Card></section><section className="panel"><div className="section-head"><div><p className="eyebrow">Milestone runner</p><h2>Delivery plan</h2></div>{role === "BUYER" && <button disabled={!!busy} onClick={() => run("reclaimExpiry")}>Reclaim after expiry</button>}</div><MilestoneList data={data} role={role} run={run} settlements={settlements} finalized={finalized} /></section></>}</main>;
}

function Dashboard(props: { session: EmbeddedWalletSession; company: Company | null; profileHint: string; openProposals: Proposal[]; myProposals: Proposal[]; agreements: AgreementRecord[]; busy: string; message: string; proposalLink: string; recipientCompany: string; agreementLabel: string; proposalDescription: string; proposalVisibility: ProposalVisibility; sellerCommitmentHours: string; buyerResponseMinutes: string; disputeWindowMinutes: string; proposalLifetimeHours: string; joinId: string; setRecipientCompany: (value: string) => void; setAgreementLabel: (value: string) => void; setProposalDescription: (value: string) => void; setProposalVisibility: (value: ProposalVisibility) => void; setSellerCommitmentHours: (value: string) => void; setBuyerResponseMinutes: (value: string) => void; setDisputeWindowMinutes: (value: string) => void; setProposalLifetimeHours: (value: string) => void; setJoinId: (value: string) => void; create: () => void; join: () => void; openAgreement: () => void; goHome: () => void; removeExpired: (proposal: Proposal) => void; restoreProfile: (name: string) => void; select: (record: AgreementRecord) => void; signOut: () => void; }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [profileName, setProfileName] = useState(() => localStorage.getItem(`arc-trade-company:${props.session.address.toLowerCase()}`) || props.company?.name || props.profileHint || "");
  useEffect(() => { if (!profileName) setProfileName(localStorage.getItem(`arc-trade-company:${props.session.address.toLowerCase()}`) || props.company?.name || props.profileHint || ""); }, [props.company, props.profileHint, props.session.address, profileName]);
  const issued = props.myProposals.filter(proposal => proposal.proposerAddress.toLowerCase() === props.session.address.toLowerCase());
  const received = props.myProposals.filter(proposal => proposal.proposerAddress.toLowerCase() !== props.session.address.toLowerCase());
  const copyProposalLink = async () => { try { await navigator.clipboard.writeText(props.proposalLink); document.documentElement.dataset.arcCopied = "true"; window.setTimeout(() => { delete document.documentElement.dataset.arcCopied; }, 1600); } catch { /* the link remains selectable */ } };
  const jumpTo = (selector: string) => { document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const setProposalForJoin = (proposal: Proposal) => { props.setJoinId(proposal.id); setSelectedProposal(proposal); };
  const draftProposal = (proposal: Proposal) => { props.setAgreementLabel(proposal.title); props.setProposalDescription(proposal.description); props.setProposalVisibility(proposal.visibility); props.setRecipientCompany(proposal.recipientCompany || ""); setSelectedProposal(null); jumpTo(".create-panel"); };
  return <main className="shell workspace-shell">
    <header className="site-header"><a className="brand" href="/#resources" onClick={event => { event.preventDefault(); props.goHome(); }}><span className="mark">AT</span><span>Arc<span>Trade</span></span></a><div className="account"><strong>{props.company?.name || "Company profile"}</strong></div><button className={`menu-toggle${menuOpen ? " is-open" : ""}`} aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><i /><i /></button>{menuOpen && <nav className="menu-panel"><a href="#issue" onClick={() => { setMenuOpen(false); jumpTo(".create-panel"); }}>Draft a proposal</a><a href="#board" onClick={() => { setMenuOpen(false); jumpTo("#board"); }}>Public offers</a><a href="#live-agreements" onClick={() => { setMenuOpen(false); jumpTo("#live-agreements"); }}>Live agreements</a><button className="quiet" onClick={props.signOut}>Sign out</button></nav>}</header>
    {props.message && <div className="error">{props.message}</div>}{!props.company && <section className="panel profile-recovery"><div><p className="eyebrow">Profile needs attention</p><h2>Restore your company profile</h2><p className="notice">This passkey is valid, but its company record is missing from the registry. Restore it once to unlock proposals and agreements.</p></div><div className="recovery-row"><input aria-label="Company name" placeholder="Company name" value={profileName} onChange={event => setProfileName(event.target.value)} /><button disabled={props.busy === "restoreProfile"} onClick={() => props.restoreProfile(profileName)}>{props.busy === "restoreProfile" ? "Restoring…" : "Restore profile"}</button></div></section>}{selectedProposal && <ProposalLetter proposal={selectedProposal} onClose={() => setSelectedProposal(null)} onAccept={() => { setSelectedProposal(null); void props.join(); }} onDraft={() => draftProposal(selectedProposal)} />}
    <section className="workspace-hero"><div><p className="eyebrow">Trade desk</p><h1>Good to see you, <span>{props.company?.name || "your company"}.</span></h1><p>Review incoming commercial proposals, continue your drafts, and monitor live agreements from one operating desk.</p></div><div className="workspace-metrics" aria-label="Trade desk sections">{issued.length > 0 ? <a href="#proposals-drafted"><strong>{issued.filter(proposal => proposal.status !== "OPEN").length}</strong><span>concluded drafts</span></a> : <div className="metric-empty"><strong>0</strong><span>concluded drafts</span></div>}{issued.length > 0 ? <a href="#proposals-drafted"><strong>{issued.length}</strong><span>proposals drafted</span></a> : <div className="metric-empty"><strong>0</strong><span>proposals drafted</span></div>}{props.agreements.length > 0 ? <a href="#live-agreements"><strong>{props.agreements.length}</strong><span>live agreements</span></a> : <div className="metric-empty"><strong>0</strong><span>live agreements</span></div>}</div></section>
{props.agreements.length > 0 && <section className="panel agreements-panel" id="live-agreements"><div className="section-head"><div><p className="eyebrow">Live agreements</p><h2>Settlement registry</h2></div><code>{ref(props.session.address)}</code></div><div className="agreement-list">{props.agreements.map(record => <button className="agreement-row" key={record.id} onClick={() => props.select(record)}><span className="agreement-index">{record.buyer.toLowerCase() === props.session.address.toLowerCase() ? "Buyer" : "Seller"}</span><strong>{ref(record.id)}</strong><code>{ref(record.escrow)}</code><span aria-hidden>→</span></button>)}</div></section>}
    <FundingPanel address={props.session.address} />
    {issued.length > 0 && <ActivityPanel id="proposals-drafted" title="Proposals drafted" eyebrow="Your outbound work" proposals={issued} props={props} open={setProposalForJoin} removeExpired={props.removeExpired} />}
    <section className="workflow-grid"><div className="panel create-panel draft-panel" id="concluded-drafts"><p className="eyebrow">Draft a proposal</p><h2>Set the commercial terms.</h2><p className="notice">Start a private counterparty invitation. The next page captures the goods, route, delivery terms, value, and milestone schedule.</p><button className="primary-button" onClick={props.openAgreement}>Create commercial agreement</button></div></section>
    <section className="panel board-panel registry-preview" id="board"><div className="section-head"><div><p className="eyebrow">Public offers</p><h2>Public proposal board</h2></div><span className="pill">Coming soon</span></div><p className="notice board-intro">A shared board for public offers is planned for a later release. Private commercial agreements are available now.</p></section>

  </main>;
}

function ActivityPanel({ id, className = "", title, eyebrow, proposals, props, open, removeExpired }: { id?: string; className?: string; title: string; eyebrow: string; proposals: Proposal[]; props: { busy: string }; open: (proposal: Proposal) => void; removeExpired: (proposal: Proposal) => void }) {
  const stateLabel = (proposal: Proposal) => proposal.status === "ACCEPTED" ? (proposal.agreementId ? "Live agreement" : "Accepted · waiting for issuer") : proposal.status === "OPEN" ? "Open" : proposal.status === "EXPIRED" ? "Expired" : "Cancelled";
  return <section id={id} className={`panel board-panel activity-panel ${className}`}><div className="section-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><span className="pill">{proposals.length}</span></div><div className="proposal-list">{proposals.map(proposal => <article className="public-proposal" key={proposal.id}><div className="proposal-ref"><code>{proposal.id}</code><span>{proposal.visibility === "PUBLIC" ? "Public board" : `Private · ${proposal.recipientCompany || "recipient"}`}</span></div><div className="proposal-main"><div><h3>{proposal.title}</h3><small>{stateLabel(proposal)}{proposal.agreementId ? ` · ${ref(proposal.agreementId)}` : ""}</small></div><div className="proposal-actions">{proposal.status === "EXPIRED" ? <button className="quiet danger" disabled={props.busy === `delete:${proposal.id}`} onClick={() => removeExpired(proposal)}>Remove expired</button> : proposal.status === "ACCEPTED" && !proposal.agreementId ? <span className="status">Awaiting issuer</span> : <button className="secondary" onClick={() => open(proposal)}>{proposal.status === "OPEN" ? "Open proposal" : "View agreement"}</button>}</div></div></article>)}</div></section>;
}

function ProposalLetter({ proposal, onClose, onAccept, onDraft }: { proposal: Proposal; onClose: () => void; onAccept: () => void; onDraft: () => void }) {
  return <section className="proposal-letter" role="dialog" aria-modal="true" aria-label="Proposal details"><div className="letter-head"><div><p className="eyebrow">Proposal letter</p><code>{proposal.id}</code></div><button className="quiet" onClick={onClose} aria-label="Close proposal">Close ×</button></div><div className="letter-body"><p className="letter-kicker">{proposal.visibility === "PUBLIC" ? "Open public proposal" : "Private invitation"}</p><h2>{proposal.title}</h2><p className="letter-copy">{proposal.description || "The proposing company has not added a description."}</p><div className="letter-meta"><div><small>Proposed by</small><strong>{proposal.proposerCompany}</strong></div><div><small>Settlement value</small><strong>{proposalAmount(proposal)} test funds</strong></div><div><small>Closes</small><strong>{new Date(proposal.proposalExpiresAt * 1000).toLocaleString()}</strong></div></div><div className="letter-terms"><div><span>Response window</span><strong>{Math.round(proposal.sellerCommitmentWindow / 3600)} hours</strong></div><div><span>Negotiation</span><strong>{Math.round(proposal.buyerResponseWindow / 60)} minutes</strong></div><div><span>Dispute window</span><strong>{Math.round(proposal.disputeWindow / 60)} minutes</strong></div></div><h3>Evidence plan</h3><div className="letter-milestones">{proposal.milestones.map((milestone, index) => <div key={`${proposal.id}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><strong>{milestone.description}</strong><small>{milestone.basisPoints / 100}% of value</small></div>)}</div></div><div className="letter-actions"><button className="secondary" onClick={onDraft}>Draft a response</button><button onClick={onAccept}>Accept proposal</button></div></section>;
}

function FundingPanel({ address }: { address: string }) {
  const [balance, setBalance] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const refresh = async () => {
    setStatus("Checking balance…");
    try {
      const token = new Contract(config.tokenAddress, ["function balanceOf(address) view returns(uint256)"], readProvider);
      setBalance(formatUnits(await token.balanceOf(address), 6)); setStatus("");
    } catch { setStatus("Balance unavailable"); }
  };
  useEffect(() => { void refresh(); }, [address]);
  const faucet = async () => {
    try { await navigator.clipboard.writeText(address); setStatus("Address copied. Sign in to Circle Faucet and send the test amount to this address."); }
    catch { setStatus("Copy this account address into Circle Faucet: " + address); }
    window.open("https://faucet.circle.com", "_blank", "noopener,noreferrer");
  };
  const native = async () => {
    try { await navigator.clipboard.writeText(address); setStatus("Address copied. Use the Circle Console faucet for Arc test tokens."); }
    catch { setStatus("Copy this account address into the Circle Console faucet: " + address); }
    window.open("https://console.circle.com", "_blank", "noopener,noreferrer");
  };
  return <section className="panel funding"><div><p className="eyebrow">Profile balance</p><div className="balance-line"><strong>{balance === null ? "—" : balance}</strong><span>TEST FUNDS</span></div><p className="notice">Your Arc Testnet balance. This is the balance used when you secure an agreement.</p>{status && <p className="notice funding-status">{status}</p>}</div><div className="actions"><button onClick={() => void faucet()}>Get 20 test funds</button><button className="secondary" onClick={() => void native()}>Get Arc test tokens</button><button className="quiet" onClick={() => void refresh()}>Refresh</button></div></section>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) { return <div className="card"><small>{title}</small>{children}</div>; }
function MilestoneList({ data, role, run, settlements, finalized = false }: { data: any; role: Role; run: (name: string, args?: any[]) => void; settlements: Settlement[]; finalized?: boolean }) {
  const [documentRefs, setDocumentRefs] = useState<Record<number, string>>({});
  return <div className="milestones">{data.milestones.map((m: any, i: number) => <article className="milestone" key={i}><div className="milestone-top"><span className="number">{String(i + 1).padStart(2, "0")}</span><div><h3>{m.description || "Milestone"}</h3><span className="status">{states[m.state] || "Unknown"}</span></div><strong>{money(m.amount || 0n)}</strong></div>{m.documentHash !== "0x" + "00".repeat(32) && <p className="document">Document · {ref(m.documentHash)}</p>}<p className="deadline">{m.windowDeadline ? `Deadline · ${date(m.windowDeadline)}` : "No active deadline"}</p>{!finalized && <div className="actions">{role === "SELLER" && m.state === 1 && <><input aria-label={`Document reference for milestone ${i + 1}`} placeholder="Document reference" value={documentRefs[i] || ""} onChange={event => setDocumentRefs(current => ({ ...current, [i]: event.target.value }))} /><button disabled={!documentRefs[i]?.trim()} onClick={() => run("triggerMilestone", [i, documentRefs[i].trim()])}>Submit document</button></>}{role === "BUYER" && m.state === 2 && <button onClick={() => run("confirmMilestone", [i])}>Confirm delivery</button>}{role === "BUYER" && (m.state === 2 || m.state === 3) && <button className="secondary" onClick={() => run("dispute", [i])}>Raise concern</button>}{m.state === 3 && <button className="secondary" onClick={() => run("release", [i])}>Release payment</button>}{role === "ARBITRATOR" && m.state === 5 && <><button onClick={() => run("arbitrate", [i, data.terms.buyer])}>Award buyer</button><button className="secondary" onClick={() => run("arbitrate", [i, data.terms.seller])}>Award seller</button></>}{(role === "BUYER" || role === "SELLER") && m.state === 5 && <button className="secondary" onClick={() => run("forceRelease", [i])}>Force resolution</button>}</div>}{settlements.filter(s => s.milestoneIndex === i).map(s => <div className={`settlement ${s.status}`} key={s.settlementKey}><span>{labels[s.status as keyof typeof labels]}</span><small>{money(BigInt(Math.round(Number(s.amount) * 1e6)))} · {ref(s.txHash)}</small></div>)}</article>)}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
