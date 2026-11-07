// Script of the /eaa-checker page: the same decision as checkEaaScope (src/eaa.ts), run in the visitor's browser so that
// the figures typed never leave it. The CSP of the page allows this script by hash and has no connect-src (default-src
// 'none'), so the page cannot send them anywhere. Any change to this text changes its hash: test/eaa-checker-page.test.ts
// checks the hash and runs the script against checkEaaScope over every combination of answers.
import { EAA_PAGE_DATA } from "./eaa.ts";

export const VERDICT_LABELS: Record<string, string> = {
  in_scope: "In scope of the EAA",
  terminals_only: "In scope for self-service terminals only",
  exempt_microenterprise: "Exempt: microenterprise",
  out_of_scope: "Out of scope of the EAA",
  public_sector_other_law: "Not covered by the EAA: public-sector rules apply",
  need_more_info: "More information needed",
};

const LOGIC = `function eaaCheck(i){
const r=(v,x)=>({verdict:v,reasons:x,key_dates:D.keyDates,sources:D.sources,disclaimer:D.disclaimer});
if(i.sector==="other"||!i.sells_to_eu_consumers){
const x=i.sector==="other"?D.otherReasons:["The EAA covers "+D.sectorLabels[i.sector]+" provided to consumers in the EU (art. 2(2)); a business-to-business-only service is not covered."];
if(i.public_body)return r("public_sector_other_law",[D.publicSector+"; the EAA adds its requirements only for the consumer services it lists (recital 46).",...x]);
return r("out_of_scope",x)}
const t=i.sector==="urban_regional_transport",c=t?"terminals_only":"in_scope",l=D.sectorLabels[i.sector],x=[l[0].toUpperCase()+l.slice(1)+" provided to EU consumers are listed in article 2(2) of the EAA."],tail=t?D.terminalsOnly:[];
if(i.public_body)return r(c,[...x,D.publicSector+", and the EAA applies to this service in addition (recital 46).","The microenterprise exemption does not apply: under Recommendation 2003/361/EC, an enterprise 25% or more controlled by public bodies is not a microenterprise.",...tail]);
if(i.employees===undefined)return r("need_more_info",[...x,"Microenterprises providing services are exempt: give the headcount, and the annual turnover or balance sheet total, to decide."]);
if(i.employees>=10)return r(c,[...x,i.employees+" employees: not a microenterprise (fewer than 10 persons), so the exemption does not apply.",...tail]);
const f=[i.annual_turnover_eur,i.balance_sheet_eur].filter(v=>v!==undefined);
if(f.length===0)return r("need_more_info",[...x,"Fewer than 10 employees: the business is exempt if its annual turnover or its balance sheet total does not exceed EUR 2 million. Give one of the two figures."]);
if(f.some(v=>v<=2000000))return r("exempt_microenterprise",[...x,"Fewer than 10 employees and turnover or balance sheet total not above EUR 2 million: microenterprise, exempt from the accessibility requirements for services (art. 4(5); France: consumer code art. L412-13).",D.counting]);
if(f.length===1){const m=i.annual_turnover_eur===undefined?"annual turnover":"balance sheet total";return r("need_more_info",[...x,"Fewer than 10 employees and the figure given is above EUR 2 million: the business is still exempt if its "+m+" does not exceed EUR 2 million. Give that figure."])}
return r(c,[...x,"Fewer than 10 employees, but both turnover and balance sheet total above EUR 2 million: not a microenterprise.",...tail])}`;

// DOM part. Everything is written with textContent, never as HTML. Without the form (stub DOM of the tests) it does nothing.
const PAGE = `const f=document.getElementById("eaa-form");
if(f){
const $=id=>document.getElementById(id),R=$("eaa-result"),H=$("eaa-verdict"),L=$("eaa-reasons"),M=$("eaa-more"),F=["eaa-employees","eaa-turnover","eaa-balance"];
const fill=(ul,items,link)=>{ul.replaceChildren(...items.map(t=>{const li=document.createElement("li");if(link){const a=document.createElement("a");a.href=t.url;a.textContent=t.label;li.append(a)}else if(typeof t==="string")li.textContent=t;else{const a=document.createElement("a");a.href=t.href;a.textContent=t.text;li.append(a)}return li}))};
const num=id=>{const s=$(id).value.replace(/[\\s\\u00a0\\u202f]/g,"");return s===""?undefined:/^\\d{1,15}$/.test(s)?+s:NaN};
const show=(label,items,more)=>{H.textContent=label;fill(L,items);M.hidden=!more;R.hidden=false;H.focus()};
f.hidden=false;$("eaa-nojs").hidden=true;
f.addEventListener("submit",e=>{
e.preventDefault();
const q=n=>f.querySelector('input[name="'+n+'"]:checked'),s=q("sector"),c=q("consumers"),bad=[];
for(const id of F){$(id).removeAttribute("aria-invalid");$(id+"-err").hidden=true;$(id).setAttribute("aria-describedby",id+"-hint")}
if(!s)bad.push({href:"#eaa-sector-first",text:"Choose the service you provide."});
if(!c)bad.push({href:"#eaa-consumers-first",text:"Say whether you offer it to consumers in the EU."});
const v={};
for(const [id,k,w,x] of [["eaa-employees","employees","the number of people employed","12"],["eaa-turnover","annual_turnover_eur","the annual turnover","1200000"],["eaa-balance","balance_sheet_eur","the balance sheet total","1500000"]]){const n=num(id);if(Number.isNaN(n)){const m="Write "+w+" with digits only, no comma or decimal point, for example "+x+".",p=$(id+"-err");$(id).setAttribute("aria-invalid","true");$(id).setAttribute("aria-describedby",id+"-hint "+id+"-err");p.textContent=m;p.hidden=false;bad.push({href:"#"+id,text:m})}else if(n!==undefined)v[k]=n}
if(bad.length){show("Check the form",bad,false);return}
const r=eaaCheck({sector:s.value,sells_to_eu_consumers:c.value==="yes",public_body:f.elements.publicbody.checked,...v});
fill($("eaa-dates"),r.key_dates);fill($("eaa-sources"),r.sources,true);$("eaa-disc").textContent=r.disclaimer;
show(D.labels[r.verdict],r.reasons,true)})}`;

export const EAA_SCRIPT = `const D=${JSON.stringify({ ...EAA_PAGE_DATA, labels: VERDICT_LABELS }).replaceAll("<", "\\u003c")};\n${LOGIC}\n${PAGE}`;
export const EAA_SCRIPT_HASH = "sha256-mpqhtJtcyv9RlUgKOKesdOSgvD8F5gftSmYuBmmvpNU=";
