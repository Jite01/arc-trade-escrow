import { readFileSync, readdirSync, statSync } from "node:fs"; import { join } from "node:path";
// The commercial agreement flow intentionally names USDC and wallet identity.
// The user-facing delivery terminology must remain plain language.
const forbidden=["Incoterms","Incoterms 2020","2020","blockchain","smart contract","seed phrase","gas","chain ID"];
function files(dir){return readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?files(p):[p];}).filter(p=>p.endsWith(".tsx"));}
const source=files("src").map(file=>readFileSync(file,"utf8")).join("\n"); const visible=[...source.matchAll(/>([^<>]*)</g)].map(m=>m[1]).join(" ")+[...source.matchAll(/(?:placeholder|title)=\"([^\"]*)\"/g)].map(m=>m[1]).join(" "); const hits=forbidden.filter(word=>visible.toLowerCase().includes(word.toLowerCase())); if(hits.length){console.error("Forbidden rendered terms found: "+hits.join(", "));process.exit(1)} console.log("Forbidden-string audit passed.");
