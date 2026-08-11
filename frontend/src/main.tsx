import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Contract, formatUnits, id, parseUnits } from "ethers";
import { config } from "./config";
import { agreementsFor, call, contractFor, createAgreement, errorMessage, getAgreement, readAgreement, readProvider, roleFor, type AgreementRecord, type Role } from "./contract";
import { getSettlements, type Settlement } from "./api";
import { createCircleEmbeddedWalletAdapter, type CircleLoginMode, type EmbeddedWalletSession } from "./wallet";
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
const humanizeSlug = (value: string) => value.split("-").filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const roleLabel = (role: Role) => role === "BUYER" ? "Initiator" : role === "SELLER" ? "Counterparty" : role === "ARBITRATOR" ? "Arbitrator" : "Viewer";

function App() {
  const [session, setSession] = useState<EmbeddedWalletSession | null>(null);
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
  const [companyName, setCompanyName] = useState(() => initialSignin.recipient ? humanizeSlug(initialSignin.recipient) : "");
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
    });
    const off = wallet.onAccountChange(async () => {
      const next = await wallet.getSession();
      clearAgreement();
      setSession(next);
      if (next) await Promise.all([refreshAgreements(next.address), refreshRegistry(next.address)]);
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
    setBusy("signIn"); setMessage("");
    try {
      const existing = await lookupCompany(name);
      if (mode === "login" && !existing) {
        setAuthMode("register");
        setProfileCheck("unchecked");
        setMessage("Company profile not found. Proceed to create it.");
        return;
      }
      if (mode === "register" && !existing && profileCheck !== "new") {
        setProfileCheck("new");
        setMessage("Company profile not found. Proceed to create it.");
        return;
      }
      const next = await wallet.login(name, existing ? "login" : "register");
      const record = await registerCompany(name, next.address);
      localStorage.setItem(`arc-trade-company:${next.address.toLowerCase()}`, record.name);
      setCompany(record); setSession(next); setAuthMode(null); await Promise.all([refreshAgreements(next.address), refreshRegistry(next.address)]);
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
      setCompany(record); await refreshRegistry(session.address);
    } catch (error) { setMessage(errorMessage(error, "restoreProfile")); }
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

  if (!session) return <main className="shell landing-shell">
    <header className="site-header"><a className="brand" href="/"><span className="mark">AT</span><span>Arc<span>Trade</span></span></a><nav className="site-nav"><a href="#how-it-works">How it works</a><a href="#principles">Principles</a></nav><button className="secondary" disabled={!!busy} onClick={() => { setAuthMode("register"); setMessage(""); }}>{busy ? "Working…" : "Get started"}</button></header>
    <section className="hero-grid">
      <div className="hero">
        <p className="eyebrow">Documentary settlement · Arc Testnet</p>
        <h1>Trade terms, <em>made accountable.</em></h1>
        <p className="hero-copy">Arc Trade is the proposal desk for documentary commerce: invite a counterparty, agree the evidence, and settle each approved milestone with a verifiable record.</p>
        {message && <div className="error">{message}</div>}
        {authMode === null ? <div className="actions hero-actions"><button disabled={!!busy} onClick={() => { setAuthMode("register"); setMessage(""); }}>Send an agreement <span aria-hidden>↗</span></button><button className="secondary" disabled={!!busy} onClick={() => { setAuthMode("login"); setMessage(""); }}>Login to Arc Trade</button></div> : <section className="panel auth-panel">
          <p className="eyebrow">{initialSignin.proposalId ? "Private proposal invitation" : authMode === "register" ? "Create your company profile" : "Secure company access"}</p>
          <h2>{initialSignin.proposalId ? `Continue as ${companyName || "the invited company"}` : authMode === "register" ? "Start with your company" : "Access your trade desk"}</h2>
          <p className="notice">{initialSignin.proposalId ? `Proposal ${initialSignin.proposalId} is addressed to this company. Continue with its Circle passkey.` : "Your company name locates the profile. Your Circle passkey confirms access."}</p>
          <label className="field-label">Company name<input aria-label="Company name" placeholder="Company name" value={companyName} onChange={event => { setCompanyName(event.target.value); setProfileCheck("unchecked"); setMessage(""); }} autoComplete="organization" /></label>
          <div className="actions">{authMode === "register" ? <button disabled={!!busy} onClick={() => void signIn("register")}>{busy ? "Creating profile…" : "Proceed with passkey"}</button> : <button disabled={!!busy} onClick={() => void signIn("login")}>{busy ? "Signing in…" : "Continue with passkey"}</button>}<button className="secondary" disabled={!!busy} onClick={() => { setAuthMode(null); setMessage(""); }}>Back</button></div>
        </section>}
        <div className="trust-row"><span>Passkey secured</span><span>•</span><span>Verifiable agreements</span><span>•</span><span>Documentary settlement</span></div>
      </div>
      <aside className="hero-aside" aria-label="Arc Trade workflow">
        <div className="aside-top"><span className="live-dot" /> Live on Arc Testnet</div>
        <p className="eyebrow">The flow</p><ol><li><span className="flow-marker"><i /></span><div><strong>Issue proposal</strong><small>Public board or named counterparty</small></div></li><li><span className="flow-marker"><i /></span><div><strong>Agree terms</strong><small>Document milestones and response windows</small></div></li><li><span className="flow-marker"><i /></span><div><strong>Settle evidence</strong><small>Funds release when the work is confirmed</small></div></li></ol>
        <div className="aside-footer"><span>Registry-backed</span><strong>AT</strong></div>
      </aside>
    </section>
    <section className="how-it-works" id="how-it-works"><div><p className="eyebrow">How Arc Trade works</p><h2>A clear record for every serious promise.</h2></div><div className="how-copy"><p>Arc Trade turns the messy middle of documentary commerce into a shared, time-bound proposal. Everyone sees the same public board. Private invitations arrive addressed to the right company.</p><a href="#principles">Read the operating principles <span aria-hidden>↘</span></a></div></section>
    <section className="principles" id="principles"><article><span>01</span><h3>Shared registry</h3><p>Each public proposal has one reference that every signed-in company can find.</p></article><article><span>02</span><h3>Evidence first</h3><p>Milestones and response windows make the expected proof visible before funds move.</p></article><article><span>03</span><h3>Protected access</h3><p>Passkeys identify companies while the agreement contract enforces the final actions.</p></article></section>
  </main>;

  if (!selected || !data) return <Dashboard session={session} company={company} openProposals={openProposals} myProposals={myProposals} agreements={agreements} busy={busy} message={message} proposalLink={proposalLink} recipientCompany={recipientCompany} agreementLabel={agreementLabel} proposalDescription={proposalDescription} proposalVisibility={proposalVisibility} sellerCommitmentHours={sellerCommitmentHours} buyerResponseMinutes={buyerResponseMinutes} disputeWindowMinutes={disputeWindowMinutes} proposalLifetimeHours={proposalLifetimeHours} joinId={joinId} setRecipientCompany={setRecipientCompany} setAgreementLabel={setAgreementLabel} setProposalDescription={setProposalDescription} setProposalVisibility={setProposalVisibility} setSellerCommitmentHours={setSellerCommitmentHours} setBuyerResponseMinutes={setBuyerResponseMinutes} setDisputeWindowMinutes={setDisputeWindowMinutes} setProposalLifetimeHours={setProposalLifetimeHours} setJoinId={setJoinId} create={create} join={join} removeExpired={removeExpired} restoreProfile={restoreProfile} select={record => void selectAgreement(record, session)} signOut={signOut} />;

  const t = data.terms; const finalized = data.state === 3;
  return <main className="shell"><header><span className="mark">AT</span><span>Arc Trade</span><span className="account">{roleLabel(role)} · {ref(session.address)} <button className="quiet" onClick={signOut}>Sign out</button></span></header><div className="topline"><div><p className="eyebrow">Agreement {ref(selected.id)}</p><h1>{finalized ? "Trade agreement completed" : "Trade agreement"}</h1></div><div className="actions"><button className="secondary" onClick={clearAgreement}>All agreements</button><span className="pill">{finalized ? "Completed" : data.state === 0 ? "Negotiation" : data.state === 1 ? "Committed" : "In progress"}</span></div></div>{message && <div className="error">{message}</div>}{role === "READ_ONLY" && <section className="panel"><h2>This account is not a participant</h2><p className="notice">Open an agreement created for this passkey or sign in with the invited profile.</p></section>}<section className="grid terms"><Card title="Secured amount"><strong>{money(t.total)}</strong><small>Trade value</small></Card><Card title="Participant approvals"><strong>{data.approvals.buyer ? "Approved" : "Pending"} / {data.approvals.seller ? "Approved" : "Pending"}</strong><small>Proposal v{data.approvals.version}</small></Card><Card title="Commitment deadline"><strong>{date(t.negotiationExpiry)}</strong><small>Negotiation expiry</small></Card></section>{role !== "READ_ONLY" && data.state === 0 && <section className="panel"><div className="section-head"><div><p className="eyebrow">Negotiation</p><h2>Milestones</h2></div><div className="actions"><button disabled={!!busy || !proposal.description} onClick={() => run("proposeMilestones", [[{ description: proposal.description, basisPoints: proposal.basisPoints, sellerDeadline: proposal.sellerDeadline, buyerResponseWindow: proposal.buyerResponseWindow, disputeWindow: proposal.disputeWindow }]])}>Propose milestones</button><button className="secondary" disabled={!!busy || data.milestones.length === 0} onClick={() => run("approve")}>Approve proposal</button>{role === "BUYER" && <><button className="secondary" onClick={() => run("cancel")}>Cancel agreement</button><button className="secondary" onClick={() => run("expire")}>Expire agreement</button></>}</div></div><div className="proposal"><input placeholder="Milestone description" value={proposal.description} onChange={event => setProposal({ ...proposal, description: event.target.value })} /><input placeholder="Basis points" value={proposal.basisPoints} onChange={event => setProposal({ ...proposal, basisPoints: event.target.value })} /></div><MilestoneList data={data} role={role} run={run} settlements={settlements} /></section>}{role !== "READ_ONLY" && data.state === 1 && <section className="panel"><p className="eyebrow">Commitment</p><h2>Secure the agreed amount</h2><p>The initiating profile secures the total amount before milestones begin.</p>{role === "BUYER" ? <button disabled={!!busy} onClick={approveAndDeposit}>{busy ? "Working…" : "Secure funds"}</button> : <><p className="notice">Waiting for the initiating profile to secure funds.</p><button className="secondary" disabled={!!busy} onClick={() => run("abandonCommitment")}>Reopen negotiation when permitted</button></>}</section>}{(data.state === 2 || finalized) && <><section className="grid terms"><Card title="Secured funds"><strong>{money(data.balances.remaining + data.balances.released)}</strong><small>Original amount</small></Card><Card title="Released"><strong>{money(data.balances.released)}</strong><small>Paid to date</small></Card><Card title="Remaining"><strong>{money(data.balances.remaining)}</strong><small>Still secured</small></Card><Card title="Disputed"><strong>{money(data.balances.disputed)}</strong><small>Under review</small></Card></section><section className="panel"><div className="section-head"><div><p className="eyebrow">Milestone runner</p><h2>Delivery plan</h2></div>{role === "BUYER" && <button disabled={!!busy} onClick={() => run("reclaimExpiry")}>Reclaim after expiry</button>}</div><MilestoneList data={data} role={role} run={run} settlements={settlements} finalized={finalized} /></section></>}</main>;
}

function Dashboard(props: { session: EmbeddedWalletSession; company: Company | null; openProposals: Proposal[]; myProposals: Proposal[]; agreements: AgreementRecord[]; busy: string; message: string; proposalLink: string; recipientCompany: string; agreementLabel: string; proposalDescription: string; proposalVisibility: ProposalVisibility; sellerCommitmentHours: string; buyerResponseMinutes: string; disputeWindowMinutes: string; proposalLifetimeHours: string; joinId: string; setRecipientCompany: (value: string) => void; setAgreementLabel: (value: string) => void; setProposalDescription: (value: string) => void; setProposalVisibility: (value: ProposalVisibility) => void; setSellerCommitmentHours: (value: string) => void; setBuyerResponseMinutes: (value: string) => void; setDisputeWindowMinutes: (value: string) => void; setProposalLifetimeHours: (value: string) => void; setJoinId: (value: string) => void; create: () => void; join: () => void; removeExpired: (proposal: Proposal) => void; restoreProfile: (name: string) => void; select: (record: AgreementRecord) => void; signOut: () => void; }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [profileName, setProfileName] = useState("");
  const copyProposalLink = async () => { try { await navigator.clipboard.writeText(props.proposalLink); document.documentElement.dataset.arcCopied = "true"; window.setTimeout(() => { delete document.documentElement.dataset.arcCopied; }, 1600); } catch { /* the link remains selectable */ } };
  const jumpTo = (selector: string) => { document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const setProposalForJoin = (proposal: Proposal) => { props.setJoinId(proposal.id); setSelectedProposal(proposal); };
  const draftProposal = (proposal: Proposal) => { props.setAgreementLabel(proposal.title); props.setProposalDescription(proposal.description); props.setProposalVisibility(proposal.visibility); props.setRecipientCompany(proposal.recipientCompany || ""); setSelectedProposal(null); jumpTo(".create-panel"); };
  return <main className="shell workspace-shell">
    <header className="site-header"><a className="brand" href="/"><span className="mark">AT</span><span>Arc<span>Trade</span></span></a><div className="account"><strong>{props.company?.name || "Company profile"}</strong></div><button className={`menu-toggle${menuOpen ? " is-open" : ""}`} aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><i /><i /></button>{menuOpen && <nav className="menu-panel"><a href="#issue" onClick={() => { setMenuOpen(false); jumpTo(".create-panel"); }}>Issue proposal</a><a href="#board" onClick={() => { setMenuOpen(false); jumpTo("#board"); }}>Proposal board</a><a href="#agreements" onClick={() => { setMenuOpen(false); jumpTo(".agreements-panel"); }}>Agreements</a><button className="quiet" onClick={props.signOut}>Sign out</button></nav>}</header>
    {props.message && <div className="error">{props.message}</div>}{!props.company && <section className="panel profile-recovery"><div><p className="eyebrow">Profile needs attention</p><h2>Restore your company profile</h2><p className="notice">This passkey is valid, but its company record is missing from the registry. Restore it once to unlock proposals and agreements.</p></div><div className="recovery-row"><input aria-label="Company name" placeholder="Company name" value={profileName} onChange={event => setProfileName(event.target.value)} /><button disabled={props.busy === "restoreProfile"} onClick={() => props.restoreProfile(profileName)}>{props.busy === "restoreProfile" ? "Restoring…" : "Restore profile"}</button></div></section>}{selectedProposal && <ProposalLetter proposal={selectedProposal} onClose={() => setSelectedProposal(null)} onAccept={() => { setSelectedProposal(null); void props.join(); }} onDraft={() => draftProposal(selectedProposal)} />}
    <section className="workspace-hero"><div><p className="eyebrow">Registry / workspace</p><h1>Good to see you, <span>{props.company?.name || "your company"}.</span></h1><p>Manage your proposals, counterparty invitations, and live settlement agreements from one operating desk.</p></div><div className="workspace-metrics"><div><strong>{props.openProposals.length}</strong><span>open to Arc Trade</span></div><div><strong>{props.myProposals.length}</strong><span>your proposals</span></div><div><strong>{props.agreements.length}</strong><span>live agreements</span></div></div></section>
    <FundingPanel address={props.session.address} /><span id="board" className="anchor-target" />
    <section className="panel board-panel"><div className="section-head"><div><p className="eyebrow">Global registry</p><h2>Open proposal board</h2></div><span className="pill">{props.openProposals.length} live</span></div><p className="notice board-intro">Public proposals are shared state: every Arc Trade company sees the same open board and can open a proposal by its registry reference.</p>{props.openProposals.length === 0 ? <p className="empty-state">No public proposals are open right now.</p> : <div className="proposal-list">{props.openProposals.map(proposal => <article className="public-proposal" key={proposal.id}><div className="proposal-ref"><code>{proposal.id}</code><span>Public · closes {new Date(proposal.proposalExpiresAt * 1000).toLocaleString()}</span></div><div className="proposal-main"><div><h3>{proposal.title}</h3><p className="notice">{proposal.description || "Documentary trade agreement"}</p><small>Proposed by {proposal.proposerCompany} · {proposalAmount(proposal)} test-fund value</small></div><button className="secondary" onClick={() => setProposalForJoin(proposal)}>Open proposal</button></div></article>)}</div>}</section>
    {props.myProposals.length > 0 && <section className="panel board-panel"><div className="section-head"><div><p className="eyebrow">Your activity</p><h2>Issued and received</h2></div><span className="pill">{props.myProposals.length}</span></div><div className="proposal-list">{props.myProposals.map(proposal => <article className="public-proposal" key={proposal.id}><div className="proposal-ref"><code>{proposal.id}</code><span>{proposal.visibility === "PUBLIC" ? "Public board" : `Private · ${proposal.recipientCompany || "recipient"}`}</span></div><div className="proposal-main"><div><h3>{proposal.title}</h3><small>{proposal.status} · {proposal.agreementId ? `Agreement ${ref(proposal.agreementId)}` : "Awaiting agreement deployment"}</small></div><div className="proposal-actions">{proposal.status === "EXPIRED" ? <button className="quiet danger" disabled={props.busy === `delete:${proposal.id}`} onClick={() => props.removeExpired(proposal)}>Remove expired</button> : <button className="secondary" onClick={() => setProposalForJoin(proposal)}>{proposal.status === "OPEN" ? "Open" : proposal.agreementId ? "View agreement" : "Deploy agreement"}</button>}</div></div></article>)}</div></section>}
    <section className="workflow-grid"><div className="panel create-panel"><p className="eyebrow">Issue a proposal</p><h2>Set the commercial terms.</h2><p className="notice">Choose a private counterparty invitation or place an offer on the public board.</p><details className="form-section" open><summary>Who is this for?</summary><label className="field-label">Visibility<select aria-label="Proposal visibility" value={props.proposalVisibility} onChange={event => props.setProposalVisibility(event.target.value as ProposalVisibility)}><option value="PRIVATE">Private invitation</option><option value="PUBLIC">Public proposal</option></select></label>{props.proposalVisibility === "PRIVATE" && <label className="field-label">Recipient company<input placeholder="e.g. Northstar Logistics" value={props.recipientCompany} onChange={event => props.setRecipientCompany(event.target.value)} /></label>}<label className="field-label">Proposal title<input placeholder="e.g. Coffee shipment — Lagos to Accra" value={props.agreementLabel} onChange={event => props.setAgreementLabel(event.target.value)} /></label></details><details className="form-section"><summary>What is being agreed?</summary><label className="field-label">Scope and evidence<textarea placeholder="Describe the goods, documents, and proof required." value={props.proposalDescription} onChange={event => props.setProposalDescription(event.target.value)} /></label></details><details className="form-section"><summary>When should it move?</summary><div className="window-grid"><label>Response window <small>hours</small><input type="number" min="1" max="168" value={props.sellerCommitmentHours} onChange={event => props.setSellerCommitmentHours(event.target.value)} /></label><label>Negotiation <small>minutes</small><input type="number" min="1" max="1440" value={props.buyerResponseMinutes} onChange={event => props.setBuyerResponseMinutes(event.target.value)} /></label><label>Dispute window <small>minutes</small><input type="number" min="1" max="10080" value={props.disputeWindowMinutes} onChange={event => props.setDisputeWindowMinutes(event.target.value)} /></label><label>Open for <small>hours</small><input type="number" min="1" max="168" value={props.proposalLifetimeHours} onChange={event => props.setProposalLifetimeHours(event.target.value)} /></label></div></details><button disabled={!!props.busy} onClick={props.create}>{props.busy === "createAgreement" ? "Publishing proposal…" : "Done — publish proposal"}</button>{props.proposalLink && <section className="share-result"><div><p className="eyebrow">{props.proposalVisibility === "PRIVATE" ? "Private invitation ready" : "Public reference ready"}</p><strong>{props.proposalVisibility === "PRIVATE" ? "Share this link" : "Share this registry reference"}</strong><small>{props.proposalVisibility === "PRIVATE" ? "The recipient will arrive with their company field prefilled." : "Every Arc Trade user can open this reference from the global board."}</small></div><div className="share-row"><code>{props.proposalLink}</code><button onClick={() => void copyProposalLink()}>{props.proposalVisibility === "PRIVATE" ? "Copy link" : "Copy reference"}</button></div></section>}</div>
      <aside className="panel join-panel"><p className="eyebrow">Open a proposal</p><h2>Bring a reference or invitation.</h2><p className="notice">A public registry reference opens any public proposal. A private link opens the proposal addressed to its named company.</p><label className="field-label">Proposal reference or invite link<input placeholder="AT-… or pasted invite link" value={props.joinId} onChange={event => props.setJoinId(event.target.value)} /></label><button className="secondary" disabled={!!props.busy} onClick={props.join}>{props.busy === "joinAgreement" ? "Opening…" : "Open proposal"}</button><div className="join-note"><strong>Why the reference matters</strong><p>It is the proposal’s permanent registry key. The agreement address appears only after the proposal is accepted and deployed.</p></div></aside>
    </section>
    <section className="panel agreements-panel"><div className="section-head"><div><p className="eyebrow">Verified portfolio</p><h2>Live agreements</h2></div><code>{ref(props.session.address)}</code></div>{props.agreements.length === 0 ? <p className="empty-state">No live agreements yet. Issue a proposal or open one from the board.</p> : <div className="agreement-list">{props.agreements.map(record => <button className="agreement-row" key={record.id} onClick={() => props.select(record)}><span className="agreement-index">{record.buyer.toLowerCase() === props.session.address.toLowerCase() ? "Initiator" : "Counterparty"}</span><strong>{ref(record.id)}</strong><code>{ref(record.escrow)}</code><span aria-hidden>→</span></button>)}</div>}</section>
  </main>;
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
