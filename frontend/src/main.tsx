import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Contract, formatUnits, id, parseUnits } from "ethers";
import { config } from "./config";
import { agreementsFor, call, contractFor, createAgreement, errorMessage, getAgreement, readAgreement, readProvider, roleFor, type AgreementRecord, type Role } from "./contract";
import { getSettlements, type Settlement } from "./api";
import { createCircleEmbeddedWalletAdapter, type CircleLoginMode, type EmbeddedWalletSession } from "./wallet";
import { acceptProposal, bindProposal, companyByWallet, companyProposals, createProposal as submitProposal, getProposal, lookupCompany, publicProposals, registerCompany, type Company, type Proposal, type ProposalVisibility } from "./registry";
import "./styles.css";

const wallet = createCircleEmbeddedWalletAdapter();
const states = ["Upcoming", "Awaiting submission", "Under review", "Dispute window open", "Payment released", "In dispute", "Resolved"];
const labels = { PENDING: "Payment processing", RETRYING: "Payment processing", AUTHORIZED: "Payment processing", MINTING: "Payment processing", MINTED: "Payment confirmed", FAILED: "Payment failed — contact support", PERMANENT_FAILURE: "Payment failed — contact support" };
const money = (n: bigint) => formatUnits(n, 6);
const proposalAmount = (proposal: Proposal) => proposal.totalUSDC;
const ref = (s?: string | null) => s ? `Ref: ${s.slice(2, 6).toUpperCase()}...${s.slice(-4).toUpperCase()}` : "—";
const date = (n: bigint) => n === 0n ? "—" : new Date(Number(n) * 1000).toLocaleString();

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
  const [companyName, setCompanyName] = useState("");
  const [profileCheck, setProfileCheck] = useState<"unchecked" | "new">("unchecked");
  const [recipientCompany, setRecipientCompany] = useState("");
  const [agreementLabel, setAgreementLabel] = useState("");
  const [proposalDescription, setProposalDescription] = useState("");
  const [proposalVisibility, setProposalVisibility] = useState<ProposalVisibility>("PRIVATE");
  const [sellerCommitmentHours, setSellerCommitmentHours] = useState("1");
  const [buyerResponseMinutes, setBuyerResponseMinutes] = useState("15");
  const [disputeWindowMinutes, setDisputeWindowMinutes] = useState("15");
  const [proposalLifetimeHours, setProposalLifetimeHours] = useState("1");
  const [proposalLink, setProposalLink] = useState("");
  const [joinId, setJoinId] = useState(() => { const parts = window.location.pathname.split("/").filter(Boolean); return parts[0] === "signin" ? parts[1] || "" : ""; });
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
      const record = await companyByWallet(address);
      setCompany(record);
      if (!record) { setMyProposals([]); setOpenProposals(await publicProposals().catch(() => [])); return; }
      const [mine, open] = await Promise.all([companyProposals(record.slug), publicProposals()]);
      setMyProposals(mine); setOpenProposals(open);
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

  const signIn = async (mode: CircleLoginMode) => {
    const name = companyName.trim();
    if (!name) { setMessage("Enter your company name to continue."); return; }
    setBusy("signIn"); setMessage("");
    try {
      const existing = await lookupCompany(name);
      if (mode === "register" && existing) { setAuthMode("login"); throw new Error("That company already has a profile. Use Login to access it."); }
      if (mode === "register" && profileCheck !== "new") {
        setProfileCheck("new");
        setMessage("You don’t appear to have an Arc Trade profile yet. Don’t worry—we’ll create one for you after you proceed with your passkey.");
        return;
      }
      if (mode === "login" && !existing) {
        setAuthMode("register");
        setProfileCheck("unchecked");
        throw new Error("We couldn’t find that company profile. Choose Send an Agreement to create one.");
      }
      const next = await wallet.login(name, mode);
      const record = await registerCompany(name, next.address);
      setCompany(record); setSession(next); setAuthMode(null); await Promise.all([refreshAgreements(next.address), refreshRegistry(next.address)]);
    }
    catch (error) { console.error("Sign-in failed", error); const detail = String(error); setMessage(detail.includes("already has a profile") || detail.includes("couldn’t find") ? detail : errorMessage(error, "signIn")); }
    finally { setBusy(""); }
  };

  const signOut = async () => { await wallet.logout(); clearAgreement(); setAgreements([]); setOpenProposals([]); setMyProposals([]); setCompany(null); setSession(null); };

  const create = async () => {
    if (!session || !company) return;
    if (proposalVisibility === "PRIVATE" && !recipientCompany.trim()) { setMessage("Enter the recipient company for a private proposal, or make the proposal public."); return; }
    setBusy("createAgreement"); setMessage("");
    try {
      const commitmentWindow = Math.max(300, Math.min(7 * 86400, Number(sellerCommitmentHours) * 3600 || 3600));
      const buyerWindow = Math.max(60, Math.min(86400, Number(buyerResponseMinutes) * 60 || 900));
      const disputeWindow = Math.max(60, Math.min(7 * 86400, Number(disputeWindowMinutes) * 60 || 900));
      const lifetime = Math.max(300, Math.min(7 * 86400, Number(proposalLifetimeHours) * 3600 || 3600));
      const proposal = await submitProposal({
        id: crypto.randomUUID(), proposerCompany: company.slug, proposerAddress: session.address,
        recipientCompany: proposalVisibility === "PRIVATE" ? recipientCompany.trim() : null,
        visibility: proposalVisibility, title: agreementLabel.trim() || "Documentary trade agreement",
        description: proposalDescription.trim(), totalUSDC: "20", sellerCommitmentWindow: commitmentWindow,
        buyerResponseWindow: buyerWindow, disputeWindow, proposalExpiresAt: Math.floor(Date.now() / 1000) + lifetime,
        milestones: [
          { description: "Shipment documents", basisPoints: 3000, sellerDeadline: commitmentWindow, buyerResponseWindow: buyerWindow, disputeWindow },
          { description: "Proof of delivery", basisPoints: 7000, sellerDeadline: commitmentWindow, buyerResponseWindow: buyerWindow, disputeWindow }
        ]
      });
      const recipientSlug = proposal.recipientCompany ? proposal.recipientCompany.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "public";
      setRecipientCompany(""); setAgreementLabel(""); setProposalDescription(""); setProposalLink(`${window.location.origin}/signin/${recipientSlug}/${proposal.id}`);
      setMessage("Proposal ready. Share the invitation link with the recipient.");
      setMyProposals(current => [proposal, ...current.filter(item => item.id !== proposal.id)]);
      setOpenProposals(current => proposal.visibility === "PUBLIC" ? [proposal, ...current.filter(item => item.id !== proposal.id)] : current);
    } catch (error) { setMessage(errorMessage(error, "createAgreement")); }
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
        setJoinId(""); setMessage("Proposal accepted. The sending company can now deploy the escrow agreement."); return;
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

  if (!session) return <main className="shell"><header><span className="mark">AT</span><span>Arc Trade</span><button className="secondary" disabled={!!busy} onClick={() => { setAuthMode("login"); setMessage(""); }}>{busy ? "Working…" : "Login"}</button></header><section className="hero"><p className="eyebrow">Documentary trade escrow</p><h1>Turn trade documents into accountable settlement.</h1><p>Send an agreement to a company, or log in to manage your trade proposals and settlements.</p>{message && <div className="error">{message}</div>}{authMode === null ? <div className="actions"><button disabled={!!busy} onClick={() => { setAuthMode("register"); setMessage(""); }}>Send an Agreement</button><button className="secondary" disabled={!!busy} onClick={() => { setAuthMode("login"); setMessage(""); }}>Login</button></div> : <section className="panel auth-panel"><p className="eyebrow">{authMode === "register" ? "Create your company profile" : "Sign in to your company"}</p><h2>{authMode === "register" ? "Who are you sending as?" : "Which company are you signing in as?"}</h2><p className="notice">Your company name identifies the profile. Your Circle passkey secures access.</p><input aria-label="Company name" placeholder="Company name" value={companyName} onChange={event => setCompanyName(event.target.value)} autoComplete="organization" />{authMode === "register" ? <button disabled={!!busy} onClick={() => void signIn("register")}>{busy ? "Creating profile…" : "Proceed with passkey"}</button> : <button disabled={!!busy} onClick={() => void signIn("login")}>{busy ? "Signing in…" : "Continue with passkey"}</button>}<button className="secondary" disabled={!!busy} onClick={() => { setAuthMode(null); setMessage(""); }}>Back</button></section>}</section></main>;

  if (!selected || !data) return <Dashboard session={session} company={company} openProposals={openProposals} myProposals={myProposals} agreements={agreements} busy={busy} message={message} proposalLink={proposalLink} recipientCompany={recipientCompany} agreementLabel={agreementLabel} proposalDescription={proposalDescription} proposalVisibility={proposalVisibility} sellerCommitmentHours={sellerCommitmentHours} buyerResponseMinutes={buyerResponseMinutes} disputeWindowMinutes={disputeWindowMinutes} proposalLifetimeHours={proposalLifetimeHours} joinId={joinId} setRecipientCompany={setRecipientCompany} setAgreementLabel={setAgreementLabel} setProposalDescription={setProposalDescription} setProposalVisibility={setProposalVisibility} setSellerCommitmentHours={setSellerCommitmentHours} setBuyerResponseMinutes={setBuyerResponseMinutes} setDisputeWindowMinutes={setDisputeWindowMinutes} setProposalLifetimeHours={setProposalLifetimeHours} setJoinId={setJoinId} create={create} join={join} select={record => void selectAgreement(record, session)} signOut={signOut} />;

  const t = data.terms; const finalized = data.state === 3;
  return <main className="shell"><header><span className="mark">AT</span><span>Arc Trade</span><span className="account">{role} · {ref(session.address)} <button className="quiet" onClick={signOut}>Sign out</button></span></header><div className="topline"><div><p className="eyebrow">Agreement {ref(selected.id)}</p><h1>{finalized ? "Trade agreement completed" : "Trade agreement"}</h1></div><div className="actions"><button className="secondary" onClick={clearAgreement}>All agreements</button><span className="pill">{finalized ? "Completed" : data.state === 0 ? "Negotiation" : data.state === 1 ? "Committed" : "In progress"}</span></div></div>{message && <div className="error">{message}</div>}{role === "READ_ONLY" && <section className="panel"><h2>This account is not a participant</h2><p className="notice">Open an agreement created for this passkey or sign in with the invited buyer or seller profile.</p></section>}<section className="grid terms"><Card title="Secured amount"><strong>{money(t.total)}</strong><small>Trade value</small></Card><Card title="Buyer / seller"><strong>{data.approvals.buyer ? "Approved" : "Pending"} / {data.approvals.seller ? "Approved" : "Pending"}</strong><small>Proposal v{data.approvals.version}</small></Card><Card title="Commitment deadline"><strong>{date(t.negotiationExpiry)}</strong><small>Negotiation expiry</small></Card></section>{role !== "READ_ONLY" && data.state === 0 && <section className="panel"><div className="section-head"><div><p className="eyebrow">Negotiation</p><h2>Milestones</h2></div><div className="actions"><button disabled={!!busy || !proposal.description} onClick={() => run("proposeMilestones", [[{ description: proposal.description, basisPoints: proposal.basisPoints, sellerDeadline: proposal.sellerDeadline, buyerResponseWindow: proposal.buyerResponseWindow, disputeWindow: proposal.disputeWindow }]])}>Propose milestones</button><button className="secondary" disabled={!!busy || data.milestones.length === 0} onClick={() => run("approve")}>Approve proposal</button>{role === "BUYER" && <><button className="secondary" onClick={() => run("cancel")}>Cancel agreement</button><button className="secondary" onClick={() => run("expire")}>Expire agreement</button></>}</div></div><div className="proposal"><input placeholder="Milestone description" value={proposal.description} onChange={event => setProposal({ ...proposal, description: event.target.value })} /><input placeholder="Basis points" value={proposal.basisPoints} onChange={event => setProposal({ ...proposal, basisPoints: event.target.value })} /></div><MilestoneList data={data} role={role} run={run} settlements={settlements} /></section>}{role !== "READ_ONLY" && data.state === 1 && <section className="panel"><p className="eyebrow">Commitment</p><h2>Secure the agreed amount</h2><p>The buyer secures the total amount before milestones begin.</p>{role === "BUYER" ? <button disabled={!!busy} onClick={approveAndDeposit}>{busy ? "Working…" : "Secure funds"}</button> : <><p className="notice">Waiting for the buyer to secure funds.</p><button className="secondary" disabled={!!busy} onClick={() => run("abandonCommitment")}>Reopen negotiation when permitted</button></>}</section>}{(data.state === 2 || finalized) && <><section className="grid terms"><Card title="Secured funds"><strong>{money(data.balances.remaining + data.balances.released)}</strong><small>Original amount</small></Card><Card title="Released"><strong>{money(data.balances.released)}</strong><small>Paid to date</small></Card><Card title="Remaining"><strong>{money(data.balances.remaining)}</strong><small>Still secured</small></Card><Card title="Disputed"><strong>{money(data.balances.disputed)}</strong><small>Under review</small></Card></section><section className="panel"><div className="section-head"><div><p className="eyebrow">Milestone runner</p><h2>Delivery plan</h2></div>{role === "BUYER" && <button disabled={!!busy} onClick={() => run("reclaimExpiry")}>Reclaim after expiry</button>}</div><MilestoneList data={data} role={role} run={run} settlements={settlements} finalized={finalized} /></section></>}</main>;
}

function Dashboard(props: { session: EmbeddedWalletSession; company: Company | null; openProposals: Proposal[]; myProposals: Proposal[]; agreements: AgreementRecord[]; busy: string; message: string; proposalLink: string; recipientCompany: string; agreementLabel: string; proposalDescription: string; proposalVisibility: ProposalVisibility; sellerCommitmentHours: string; buyerResponseMinutes: string; disputeWindowMinutes: string; proposalLifetimeHours: string; joinId: string; setRecipientCompany: (value: string) => void; setAgreementLabel: (value: string) => void; setProposalDescription: (value: string) => void; setProposalVisibility: (value: ProposalVisibility) => void; setSellerCommitmentHours: (value: string) => void; setBuyerResponseMinutes: (value: string) => void; setDisputeWindowMinutes: (value: string) => void; setProposalLifetimeHours: (value: string) => void; setJoinId: (value: string) => void; create: () => void; join: () => void; select: (record: AgreementRecord) => void; signOut: () => void; }) {
  const copyProposalLink = async () => { try { await navigator.clipboard.writeText(props.proposalLink); } catch { /* user can select the link manually */ } };
  return <main className="shell"><header><span className="mark">AT</span><span>Arc Trade</span><span className="account">{props.company?.name || "Company profile"} · {ref(props.session.address)} <button className="quiet" onClick={props.signOut}>Sign out</button></span></header>{props.message && <div className="error">{props.message}</div>}{props.proposalLink && <section className="panel invitation"><p className="eyebrow">Invitation ready</p><h2>Share this proposal</h2><div className="share-row"><code>{props.proposalLink}</code><button onClick={() => void copyProposalLink()}>Copy link</button></div></section>}<div className="topline"><div><p className="eyebrow">Agreement registry</p><h1>Your trades</h1></div><span className="pill">{props.agreements.length} agreement{props.agreements.length === 1 ? "" : "s"}</span></div><FundingPanel address={props.session.address} /><section className="panel"><div className="section-head"><div><p className="eyebrow">Open market</p><h2>Public proposals</h2></div><span className="pill">{props.openProposals.length} open</span></div>{props.openProposals.length === 0 ? <p className="notice">No public proposals are currently available.</p> : <div className="proposal-list">{props.openProposals.map(proposal => <article className="public-proposal" key={proposal.id}><div><h3>{proposal.title}</h3><p className="notice">{proposal.description || "Documentary trade agreement"}</p><small>{proposalAmount(proposal)} test funds · closes {new Date(proposal.proposalExpiresAt * 1000).toLocaleString()}</small></div><button className="secondary" onClick={() => window.location.assign(`/signin/public/${proposal.id}`)}>Review proposal</button></article>)}</div>}</section>{props.myProposals.length > 0 && <section className="panel"><div className="section-head"><div><p className="eyebrow">Your proposals</p><h2>Incoming and outgoing</h2></div><span className="pill">{props.myProposals.length}</span></div><div className="proposal-list">{props.myProposals.map(proposal => <article className="public-proposal" key={proposal.id}><div><h3>{proposal.title}</h3><p className="notice">{proposal.visibility === "PUBLIC" ? "Public proposal" : `Private invitation · ${proposal.recipientCompany || "recipient"}`}</p><small>{proposal.status} · {proposal.agreementId ? `Agreement ${ref(proposal.agreementId)}` : "Awaiting agreement deployment"}</small></div><button className="secondary" onClick={() => { props.setJoinId(`${window.location.origin}/signin/${proposal.recipientCompany || "public"}/${proposal.id}`); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }}>{proposal.status === "OPEN" ? "Open" : proposal.agreementId ? "View agreement" : "Deploy agreement"}</button></article>)}</div></section>}<section className="grid terms"><div className="panel"><p className="eyebrow">Buyer flow</p><h2>Propose an agreement</h2><p className="notice">Create a private invitation or publish a proposal for eligible companies.</p><select aria-label="Proposal visibility" value={props.proposalVisibility} onChange={event => props.setProposalVisibility(event.target.value as ProposalVisibility)}><option value="PRIVATE">Private invitation</option><option value="PUBLIC">Public proposal</option></select>{props.proposalVisibility === "PRIVATE" && <input placeholder="Recipient company" value={props.recipientCompany} onChange={event => props.setRecipientCompany(event.target.value)} />}<input placeholder="Proposal title" value={props.agreementLabel} onChange={event => props.setAgreementLabel(event.target.value)} /><textarea placeholder="What is being traded?" value={props.proposalDescription} onChange={event => props.setProposalDescription(event.target.value)} /><div className="grid terms"><label>Seller commitment (hours)<input type="number" min="1" max="168" value={props.sellerCommitmentHours} onChange={event => props.setSellerCommitmentHours(event.target.value)} /></label><label>Buyer response (minutes)<input type="number" min="1" max="1440" value={props.buyerResponseMinutes} onChange={event => props.setBuyerResponseMinutes(event.target.value)} /></label><label>Dispute window (minutes)<input type="number" min="1" max="10080" value={props.disputeWindowMinutes} onChange={event => props.setDisputeWindowMinutes(event.target.value)} /></label><label>Proposal stays open (hours)<input type="number" min="1" max="168" value={props.proposalLifetimeHours} onChange={event => props.setProposalLifetimeHours(event.target.value)} /></label></div><button disabled={!!props.busy} onClick={props.create}>{props.busy === "createAgreement" ? "Preparing proposal…" : "Propose as buyer"}</button></div><div className="panel"><p className="eyebrow">Seller flow</p><h2>Join agreement</h2><p className="notice">Paste the agreement link or ID shared by the buyer, or select an agreement already indexed to this account.</p><input placeholder="Agreement ID or proposal link" value={props.joinId} onChange={event => props.setJoinId(event.target.value)} /><button className="secondary" disabled={!!props.busy} onClick={props.join}>{props.busy === "joinAgreement" ? "Opening…" : "Open agreement"}</button></div></section><section className="panel"><div className="section-head"><div><p className="eyebrow">Registry state</p><h2>My agreements</h2></div><code>{props.session.address}</code></div>{props.agreements.length === 0 ? <p className="notice">No agreements yet. Create one as a buyer or open an invite as a seller.</p> : <div className="grid">{props.agreements.map(record => <button className="secondary" key={record.id} onClick={() => props.select(record)}>{ref(record.id)} · {ref(record.escrow)} · {record.buyer.toLowerCase() === props.session.address.toLowerCase() ? "BUYER" : "SELLER"}</button>)}</div>}</section></main>;
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
  return <section className="panel funding"><div><p className="eyebrow">Testnet funding</p><h2>Prepare the buyer profile</h2><p className="notice">Circle Faucet requires a Circle account. The buyer needs test funds; sponsored transactions normally cover fees.</p>{balance !== null && <p className="notice">Available test funds: {balance}</p>}{status && <p className="notice">{status}</p>}</div><div className="actions"><button onClick={() => void faucet()}>Get 20 test funds</button><button className="secondary" onClick={() => void native()}>Get Arc test tokens</button><button className="secondary" onClick={() => void refresh()}>Refresh balance</button></div></section>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) { return <div className="card"><small>{title}</small>{children}</div>; }
function MilestoneList({ data, role, run, settlements, finalized = false }: { data: any; role: Role; run: (name: string, args?: any[]) => void; settlements: Settlement[]; finalized?: boolean }) {
  const [documentRefs, setDocumentRefs] = useState<Record<number, string>>({});
  return <div className="milestones">{data.milestones.map((m: any, i: number) => <article className="milestone" key={i}><div className="milestone-top"><span className="number">{String(i + 1).padStart(2, "0")}</span><div><h3>{m.description || "Milestone"}</h3><span className="status">{states[m.state] || "Unknown"}</span></div><strong>{money(m.amount || 0n)}</strong></div>{m.documentHash !== "0x" + "00".repeat(32) && <p className="document">Document · {ref(m.documentHash)}</p>}<p className="deadline">{m.windowDeadline ? `Deadline · ${date(m.windowDeadline)}` : "No active deadline"}</p>{!finalized && <div className="actions">{role === "SELLER" && m.state === 1 && <><input aria-label={`Document reference for milestone ${i + 1}`} placeholder="Document reference" value={documentRefs[i] || ""} onChange={event => setDocumentRefs(current => ({ ...current, [i]: event.target.value }))} /><button disabled={!documentRefs[i]?.trim()} onClick={() => run("triggerMilestone", [i, documentRefs[i].trim()])}>Submit document</button></>}{role === "BUYER" && m.state === 2 && <button onClick={() => run("confirmMilestone", [i])}>Confirm delivery</button>}{role === "BUYER" && (m.state === 2 || m.state === 3) && <button className="secondary" onClick={() => run("dispute", [i])}>Raise concern</button>}{m.state === 3 && <button className="secondary" onClick={() => run("release", [i])}>Release payment</button>}{role === "ARBITRATOR" && m.state === 5 && <><button onClick={() => run("arbitrate", [i, data.terms.buyer])}>Award buyer</button><button className="secondary" onClick={() => run("arbitrate", [i, data.terms.seller])}>Award seller</button></>}{(role === "BUYER" || role === "SELLER") && m.state === 5 && <button className="secondary" onClick={() => run("forceRelease", [i])}>Force resolution</button>}</div>}{settlements.filter(s => s.milestoneIndex === i).map(s => <div className={`settlement ${s.status}`} key={s.settlementKey}><span>{labels[s.status as keyof typeof labels]}</span><small>{money(BigInt(Math.round(Number(s.amount) * 1e6)))} · {ref(s.txHash)}</small></div>)}</article>)}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
