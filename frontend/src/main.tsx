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
const labels = { PENDING: "Payment processing", RETRYING: "Payment processing", AUTHORIZED: "Payment processing", SUBMITTING: "Payment submission pending", GATEWAY_PENDING: "Gateway settlement pending", MINTING: "Payment finalising", MINTED: "Payment confirmed", FAILED: "Payment failed — contact support", PERMANENT_FAILURE: "Payment failed — contact support", RECONCILIATION_REQUIRED: "Settlement needs reconciliation" };
const money = (n: bigint) => formatUnits(n, 6);
const proposalAmount = (proposal: Proposal) => proposal.totalUSDC;
const ref = (s?: string | null) => s ? `Ref: ${s.slice(2, 6).toUpperCase()}...${s.slice(-4).toUpperCase()}` : "—";
const date = (n: bigint) => n === 0n ? "—" : new Date(Number(n) * 1000).toLocaleString();
const parseSigninRoute = (pathname: string) => {
  const routeParts = pathname.split("/").filter(Boolean);
  if (routeParts[0] !== "signin") return { recipient: "", proposalId: "" };
  return {
    recipient: routeParts[1] === "public" ? "" : routeParts[1] || "",
    proposalId: routeParts[1] === "public" ? routeParts[2] || "" : routeParts[2] || routeParts[1] || ""
  };
};
const initialSignin = parseSigninRoute(window.location.pathname);
const LAST_COMPANY_KEY = "arc-trade-last-company";
const isLandingHash = (hash: string) => hash === "#how-it-works" || hash === "#settlement-infrastructure" || hash === "#support";
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
          <g className="atlas-writing-hand">
            <path d="M16 132c18 2 35-5 48-18l14-15"/>
            <path d="M25 138c19-1 36-9 49-22l12-14"/>
            <path d="M78 99c4-3 8-2 9 1l-4 7"/>
            <path d="m83 107 7 5c3 2 6-1 4-4l-7-6"/>
            <path d="m89 102 7 7"/>
            <path d="M90 108 105 93M95 113 110 98M105 93l5 5M90 108l5 5"/>
          </g>
          <g className="atlas-paper-plane">
            <g className="atlas-paper-plane--return">
              <path d="M110 74 169 88 118 106l12-18z"/>
              <path d="m130 88 39 0-28 9"/>
            </g>
          </g>
          <g className="atlas-agreement"><path d="M385 43h98v64h-98z"/><path d="M401 61h66M401 89h66"/><path className="atlas-slider-line" d="M401 75h66"/><circle className="atlas-slider" cx="408" cy="75" r="5"/></g>
          <g className="atlas-receiving-hand">
            <path d="M524 132c-18 2-35-5-48-18l-14-15"/>
            <path d="M515 138c-19-1-36-9-49-22l-12-14"/>
            <path d="M462 99c-4-3-8-2-9 1l4 7"/>
            <path d="M457 107l-7 5c-3 2-6-1-4-4l7-6"/>
            <path d="M451 102l-7 7"/>
            <path d="M450 108 435 93M445 113 430 98M435 93l-5 5M450 108l-5 5"/>
          </g>
          <g className="atlas-handshake">
            <g transform="translate(0 8)">
              <path d="M164 87c26 5 54 14 74 26"/>
              <path d="M160 105c28 6 54 16 76 26"/>
              <path d="M238 113c5-3 11-2 16 2l17 14c3 3 8-1 5-4l-14-14"/>
              <path d="m236 131 14 11c3 3 8-1 5-4l-13-13"/>
              <path d="M376 140c-28-5-53-14-76-26"/>
              <path d="M380 123c-28-5-53-14-74-25-6-3-12-2-17 3l-14 15-10-7c-3-2-7 2-4 5l10 10c4 4 10 4 14 1l17-14"/>
            </g>
          </g>
        </svg>
      </section>
      <section className="atlas-stage atlas-stage--plan">
        <div className="atlas-caption"><span>02</span><div><h3>Negotiate payment milestones</h3><p><i className="atlas-typed atlas-typed--plan">Milestones, proof, deadlines, and response windows.</i></p></div></div>
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
        <div className="atlas-caption"><span>03</span><div><h3>Deploy once, settle in USDC.</h3><p><i className="atlas-typed atlas-typed--settle">The agreed commercial record joins the settlement rail.</i></p></div></div>
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
            <path d="M155 115h200l20 8c-5 10-14 18-29 24-46 6-120 5-164-9-14-5-23-13-27-23z"/>
            <path d="M178 115h174"/>
            <path d="M192 115V83h47v32M192 99h47"/>
            <path d="M276 115V91h47v24M276 103h47"/>
            <path d="M161 115V93h23v22M161 104h23"/>
            <path d="M260 115V83"/>
          </g>
          <g className="atlas-water"><path d="M20 153c10-8 20-8 30 0s20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0"/><path d="M20 168c10-8 20-8 30 0s20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0 20-8 30 0 20 8 30 0"/></g>
          <g className="atlas-rail"><path d="M144 177h252"/><path className="atlas-rail-value" d="M144 177h181"/><circle className="atlas-rail-stop atlas-rail-stop--one" cx="219" cy="177" r="5"/><circle className="atlas-rail-stop atlas-rail-stop--two" cx="324" cy="177" r="5"/><text className="atlas-dollar atlas-dollar--one" x="219" y="178" textAnchor="middle" dominantBaseline="middle">$</text><text className="atlas-dollar atlas-dollar--two" x="324" y="178" textAnchor="middle" dominantBaseline="middle">$</text><circle className="atlas-payment" cx="219" cy="177" r="5"/></g>
          <g className="atlas-thumbsup atlas-thumbsup--start"><path className="atlas-thumbsup-outline" d="M54.325 75.025V65.275c0-1.3.65-2.6 1.95-3.25l3.25-5.2c.65-1.3 2.6-1.3 3.25 0 .65.65.65 1.95 0 2.6l-1.3 4.55h7.15c1.95 0 3.25 1.3 3.25 3.25v6.5c0 4.55-3.25 7.15-7.8 7.15h-2.6c-1.95 0-3.9-1.95-3.9-4.55z"/><path className="atlas-thumbsup-fingers" d="M64.075 67.875h4.55M64.075 71.125h4.55M64.075 74.375h3.9"/><path className="atlas-thumbsup-cuff" d="M49.125 73.075h5.2v9.1h-5.2z"/></g>
          <g className="atlas-thumbsup atlas-thumbsup--end"><path className="atlas-thumbsup-outline" d="M485.325 75.025V65.275c0-1.3-.65-2.6-1.95-3.25l-3.25-5.2c-.65-1.3-2.6-1.3-3.25 0-.65.65-.65 1.95 0 2.6l1.3 4.55h-7.15c-1.95 0-3.25 1.3-3.25 3.25v6.5c0 4.55 3.25 7.15 7.8 7.15h2.6c1.95 0 3.9-1.95 3.9-4.55z"/><path className="atlas-thumbsup-fingers" d="M475.575 67.875h-4.55M475.575 71.125h-4.55M475.575 74.375h-3.9"/><path className="atlas-thumbsup-cuff" d="M485.325 73.075h5.2v9.1h-5.2z"/></g>
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
  const [search, setSearch] = useState(window.location.search);
  const [marketingHome, setMarketingHome] = useState(() => isLandingHash(window.location.hash));
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
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(() => {
    if (window.location.pathname === "/login") return new URLSearchParams(window.location.search).get("mode") === "register" ? "register" : "login";
    return initialSignin.proposalId ? "login" : null;
  });
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistJoined, setWaitlistJoined] = useState(false);
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
    const url = new URL(path, window.location.origin);
    window.history.pushState({}, "", url);
    setPathname(url.pathname);
    setSearch(url.search);
    setMarketingHome(isLandingHash(url.hash));
  }, []);
  const openCommercial = useCallback(() => { setMarketingHome(false); navigate("/agreements/new"); }, [navigate]);
  const openLogin = useCallback((mode: "login" | "register" = "login") => { setAuthMode(mode); setMessage(""); navigate(mode === "register" ? "/login?mode=register" : "/login"); }, [navigate]);
  const goHome = useCallback(() => { setMarketingHome(true); navigate("/#how-it-works"); window.setTimeout(() => document.querySelector("#how-it-works")?.scrollIntoView({ behavior: "smooth" }), 0); }, [navigate]);

  useEffect(() => {
    const handleNavigation = () => { setPathname(window.location.pathname); setSearch(window.location.search); setMarketingHome(isLandingHash(window.location.hash)); };
    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("hashchange", handleNavigation);
    return () => { window.removeEventListener("popstate", handleNavigation); window.removeEventListener("hashchange", handleNavigation); };
  }, []);

  useEffect(() => {
    if (session && !marketingHome) return;
    const root = document.documentElement;
    root.classList.add("landing-motion-ready");
    const revealItems = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    revealItems.forEach((item, index) => item.style.setProperty("--reveal-delay", `${Math.min(index * 70, 420)}ms`));
    if (typeof IntersectionObserver === "undefined") {
      revealItems.forEach(item => item.classList.add("is-visible"));
      return () => root.classList.remove("landing-motion-ready");
    }
    const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    }), { threshold: 0.12, rootMargin: "0px 0px -8%" });
    revealItems.forEach(item => revealObserver.observe(item));
    const readingObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      entry.target.classList.toggle("is-reading", entry.isIntersecting && entry.intersectionRatio > 0.35);
    }), { threshold: [0.35, 0.7], rootMargin: "-16% 0px -38%" });
    document.querySelectorAll<HTMLElement>(".how-step").forEach(item => readingObserver.observe(item));
    return () => {
      revealObserver.disconnect();
      readingObserver.disconnect();
      root.classList.remove("landing-motion-ready");
    };
  }, [marketingHome, session]);

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

  useEffect(() => {
    if (session && pathname === "/login") navigate("/");
  }, [navigate, pathname, session]);

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
        if (pathname === "/login") navigate("/login?mode=register");
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
      setCompanyName(record.name); setCompany(record); setSession(next); setAuthMode(null); if (pathname === "/login") navigate("/"); await Promise.all([refreshAgreements(next.address), refreshRegistry(next.address)]);
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

  const invitation = parseSigninRoute(pathname);
  const activeAuthMode = pathname === "/login"
    ? new URLSearchParams(search).get("mode") === "register" ? "register" : authMode || "login"
    : authMode || "login";

  if (session && pathname === "/login") return <main className="shell landing-shell app-loading"><div className="loading-card"><span className="mark">AT</span><p className="eyebrow">Arc Trade</p><h1>Opening your trade desk.</h1><p>Redirecting to your secure workspace…</p></div></main>;

  if (!session && (pathname === "/login" || invitation.proposalId)) return <main className="shell landing-shell auth-shell">
    <header className="site-header"><a className="brand" href="/#how-it-works" onClick={event => { event.preventDefault(); goHome(); }}><span className="mark">AT</span><span>Arc<span>Trade</span></span></a><a className="auth-back" href="/#how-it-works" onClick={event => { event.preventDefault(); goHome(); }}>Back to Arc Trade</a></header>
    <section className="auth-layout"><section className="panel auth-panel standalone-auth">
      <p className="eyebrow">{invitation.proposalId ? "Proposal invitation" : activeAuthMode === "register" ? "Create access" : "Secure sign in"}</p>
      <h1>{invitation.proposalId ? `Review the invitation for ${companyName || "your company"}` : activeAuthMode === "register" ? "Create your company access" : "Open your trade desk"}</h1>
      <p className="notice">{invitation.proposalId ? `You have been invited to review proposal ${invitation.proposalId}. Enter the invited company name to continue.` : activeAuthMode === "register" ? "Your company name identifies the commercial profile. A passkey then secures access to its agreements." : "Enter your company name first. We will check whether the profile exists, then open it with your passkey."}</p>
      {message && <div className="error" role="alert">{message}</div>}
      <label className="field-label">Company name<input aria-label="Company name" placeholder="e.g. Northstar Logistics" value={companyName} onChange={event => { setCompanyName(event.target.value); setProfileCheck("unchecked"); setMessage(""); }} autoComplete="organization" /></label>
      <p className="auth-help">No password is stored here. Your device passkey confirms that you control this company profile.</p>
      <div className="actions">{activeAuthMode === "register" ? <button disabled={!!busy} onClick={() => void signIn("register")}>{busy ? "Checking profile…" : profileCheck === "new" ? "Continue with passkey" : "Check company name"}</button> : <button disabled={!!busy} onClick={() => void signIn("login")}>{busy ? "Checking profile…" : "Continue with passkey"}</button>}<button className="secondary" disabled={!!busy} onClick={() => goHome()}>Cancel</button></div>
      {!invitation.proposalId && <p className="auth-switch">{activeAuthMode === "register" ? "Already have company access?" : "New to Arc Trade?"} <button className="quiet" disabled={!!busy} onClick={() => openLogin(activeAuthMode === "register" ? "login" : "register")}>{activeAuthMode === "register" ? "Sign in" : "Create access"}</button></p>}
    </section><aside className="auth-aside"><p className="eyebrow">Arc Trade access</p><h2>Passkey-secured company access.</h2><p>One key for your trade desk on Arc.</p></aside></section>
  </main>;

  if (!session || marketingHome) return <main className="shell landing-shell">
    <header className="site-header"><a className="brand" href="/#how-it-works" onClick={event => { event.preventDefault(); goHome(); }}><span className="mark">AT</span><span>Arc<span>Trade</span></span></a><nav className="site-nav"><a href="#how-it-works">Platform</a><a href="#settlement-infrastructure">Settlement</a></nav><button className="secondary" disabled={!!busy} onClick={() => session ? openCommercial() : openLogin("register")}>{busy ? "Opening…" : session ? "Draft an agreement" : "Get started"}</button></header>
    <section className="hero-grid">
      <div className="hero">
        <p className="eyebrow">Commercial agreement registry</p>
        <h1>Settlements <em> exactly </em>as agreed.</h1>
        <p className="hero-copy">Before goods move, payment locks. Before payment releases, evidence confirms. Arc Trade turns your commercial negotiation into an executable settlement contract — in USDC, on Arc, without a bank.</p>
        {message && <div className="error">{message}</div>}
        <div className="actions hero-actions"><button disabled={!!busy} onClick={() => session ? openCommercial() : openLogin("register")}>Draft an agreement <span aria-hidden>↗</span></button><button className="secondary" disabled={!!busy} onClick={() => session ? setMarketingHome(false) : openLogin("login")}>{session ? "Open the trade desk" : "Sign in to the trade desk"}</button></div>
        <div className="trust-row"><span>Passkey secured</span><span>•</span><span>Verifiable agreements</span><span>•</span><span>Documentary settlement</span></div>
      </div>
      <ExplainerBoard />
    </section>
    <section className="how-it-works" id="how-it-works" data-reveal>
      <ol className="how-steps">
        <li className="how-step" data-reveal><span className="how-step-number">01</span><h2>Negotiate the record</h2><p>Both parties agree the goods, route, delivery terms, evidence requirements, and milestone payment schedule before anything is deployed.</p></li>
        <li className="how-step" data-reveal><span className="how-step-number">02</span><h2>Finalize and deploy</h2><p>Mutual acceptance produces a tamper-evident record. The buyer deploys the settlement contract once, against the agreed terms.</p></li>
        <li className="how-step" data-reveal><span className="how-step-number">03</span><h2>Settle by milestone</h2><p>Evidence is submitted per milestone. Confirmed or released automatically. The contract executes what the agreement specified.</p></li>
      </ol>
    </section>
    <section className="chain-strip" id="settlement-infrastructure" data-reveal>
      <p className="eyebrow">Settlement infrastructure</p>
      <div className="chain-columns">
        <article data-reveal><h3>USDC</h3><p>Settlement is denominated and executed in USDC. Amounts are exact. There is no FX conversion step.</p></article>
        <article data-reveal><img className="chain-logo" src="https://arjo-defi.vercel.app/brand/arc-logo.jpg" alt="Arc" /><h3>Arc</h3><p>Contracts deploy to Arc, Circle&apos;s stablecoin-native L1. Milestone execution and payment are on-chain.</p></article>
        <article data-reveal><h3>Verified on-chain</h3><p>Every agreement finalization and settlement event is publicly verifiable.</p><a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">[ View on Arc Explorer ↗ ]</a></article>
      </div>
    </section>
    <section className="landing-cta" data-reveal><div><h2>Start on Arc Testnet.</h2><p>Mainnet migration underway. Agreements drafted today carry forward.</p></div><div className="landing-cta-actions"><button onClick={() => session ? openCommercial() : openLogin("register")}>Draft an agreement <span aria-hidden>↗</span></button>{waitlistJoined ? <div className="waitlist-success" role="status"><strong>You&apos;re on the list.</strong><span>We&apos;ll let you know when mainnet opens.</span></div> : <form className="waitlist-form" onSubmit={event => { event.preventDefault(); setWaitlistJoined(true); }}><input aria-label="Email address" type="email" placeholder="you@email.com" value={waitlistEmail} onChange={event => setWaitlistEmail(event.target.value)} required /><button className="secondary" type="submit">Join the mainnet waitlist</button></form>}</div></section>
    <footer className="site-footer" id="support" data-reveal><div><a className="brand" href="/#how-it-works" onClick={event => { event.preventDefault(); goHome(); }}><span className="mark">AT</span><span>Arc<span>Trade</span></span></a></div><nav><a href="#how-it-works">Platform</a><a href="#settlement-infrastructure">Settlement</a><a href="/login?mode=register" onClick={event => { event.preventDefault(); openLogin("register"); }}>Get started</a></nav><small>Arc Testnet · Mainnet migration in progress.</small></footer>
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
    <header className="site-header"><a className="brand" href="/#how-it-works" onClick={event => { event.preventDefault(); props.goHome(); }}><span className="mark">AT</span><span>Arc<span>Trade</span></span></a><div className="account"><strong>{props.company?.name || "Company profile"}</strong></div><button className={`menu-toggle${menuOpen ? " is-open" : ""}`} aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><i /><i /></button>{menuOpen && <nav className="menu-panel"><a href="#issue" onClick={() => { setMenuOpen(false); jumpTo(".create-panel"); }}>Draft a proposal</a><a href="#board" onClick={() => { setMenuOpen(false); jumpTo("#board"); }}>Public offers</a><a href="#live-agreements" onClick={() => { setMenuOpen(false); jumpTo("#live-agreements"); }}>Live agreements</a><button className="quiet" onClick={props.signOut}>Sign out</button></nav>}</header>
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
