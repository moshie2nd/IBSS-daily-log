import { useState, useMemo } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const STAFF = ["Stella Muriuki","Ruta Tekeste","Rose Mushanga","Selamawit Gebremedhin","Kudzai Dube"];

const CLIENTS = [
  { id:"c1", name:"Deborah Langford", room:"101" },
  { id:"c2", name:"Client B", room:"102" },
  { id:"c3", name:"Client C", room:"103" },
  { id:"c4", name:"Client D", room:"104" },
  { id:"c5", name:"Client E", room:"105" },
];
const DEFAULT_CLIENT = "c1";

// Google Drive spreadsheet ID (created by Claude)
const SPREADSHEET_ID = "1QPXv197FAzslJ_lEmNgOH7UKDGXpo0RasPLKu3eD5fw";
const DRIVE_MCP_URL  = "https://drivemcp.googleapis.com/mcp/v1";

const TIME_OPTIONS = [];
for(let h=0;h<24;h++){
  for(let m of [0,30]){
    const hh=String(h).padStart(2,"0"), mm=String(m).padStart(2,"0");
    const H=h%12||12, ampm=h<12?"AM":"PM";
    TIME_OPTIONS.push({ value:`${hh}:${mm}`, label:`${H}:${mm} ${ampm}` });
  }
}

const BEHAVIORS = [
  { id:"b1", emoji:"🔧", label:"Pulling at catheter / medical devices" },
  { id:"b2", emoji:"📢", label:"Screaming / yelling" },
  { id:"b3", emoji:"😰", label:"Severe anxiety / agitation" },
  { id:"b4", emoji:"🚫", label:"Refusal to follow instructions" },
  { id:"b5", emoji:"👊", label:"Physical aggression (hitting, grabbing, kicking)" },
  { id:"b6", emoji:"🪃", label:"Threw objects toward staff / peer" },
  { id:"b7", emoji:"🧱", label:"Knocking or hitting walls / objects" },
  { id:"b8", emoji:"👁️", label:"Hallucinations / visual disturbance" },
  { id:"b9", emoji:"🤔", label:"Confusion with accusatory / paranoid statements" },
];

const INTERVENTIONS = [
  { id:"i1",  emoji:"🧸", label:"Hand diversion activity (cloth, stress ball)" },
  { id:"i2",  emoji:"🤝", label:"Calm reassurance" },
  { id:"i3",  emoji:"🗺️", label:"Reorient to time / place" },
  { id:"i4",  emoji:"💬", label:"Redirect conversation" },
  { id:"i5",  emoji:"🩺", label:"Secure catheter tubing & position" },
  { id:"i6",  emoji:"🔄", label:"Calm redirection to another activity" },
  { id:"i7",  emoji:"💙", label:"Emotional support & reassurance" },
  { id:"i8",  emoji:"👤", label:"One-on-one behavioral support" },
  { id:"i9",  emoji:"🗣️", label:"Verbal de-escalation" },
  { id:"i10", emoji:"🚶", label:"Physical redirection (least restrictive)" },
  { id:"i11", emoji:"👀", label:"Close supervision maintained" },
  { id:"i12", emoji:"🛡️", label:"Blocked unsafe physical behavior" },
];

const STEPS = ["Who & When","Behaviors","Interventions","Notes & Sign"];

// ── Helpers ───────────────────────────────────────────────────────────────────
const LS = {
  get:(k,fb)=>{ try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;} },
  set:(k,v)=>{ try{localStorage.setItem(k,JSON.stringify(v));}catch{} },
};
const today=()=>new Date().toISOString().split("T")[0];
const nowTime=()=>{const d=new Date();const h=d.getHours();const m=d.getMinutes()<30?0:30;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;};
const fmtTime=t=>{if(!t)return "";const[h,m]=t.split(":");const H=+h;return `${H%12||12}:${m} ${H<12?"AM":"PM"}`;};
const fmtDate=d=>{if(!d)return "";const[y,mo,day]=d.split("-");return `${mo}/${day}/${y}`;};
const startOfWeek=d=>{const dt=new Date(d);dt.setDate(dt.getDate()-dt.getDay());return dt.toISOString().split("T")[0];};
const startOfMonth=d=>{const dt=new Date(d);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-01`;};
const isSameWeek=(a,b)=>startOfWeek(a)===startOfWeek(b);
const isSameMonth=(a,b)=>startOfMonth(a)===startOfMonth(b);

function blankForm(staff=""){
  return{date:today(),staff,clientId:DEFAULT_CLIENT,startTime:nowTime(),endTime:"",behaviors:[],interventions:[],otherIntervention:"",notes:"",signature:staff};
}

const C={navy:"#0c2340",accent:"#1d6fa4",accentL:"#dbeafe",red:"#c0392b",redL:"#fde8e8",white:"#fff",bg:"#f0f4f8",border:"#c9d6e3",text:"#0f1f33",muted:"#5a7186",green:"#16a34a",greenL:"#dcfce7"};

// ── Save to Google Drive via Claude API + MCP ─────────────────────────────────
async function saveToGoogleDrive(entry, clientName, behaviorLabels, interventionLabels) {
  const row = [
    entry.date,
    entry.staff,
    clientName,
    fmtTime(entry.startTime),
    fmtTime(entry.endTime),
    behaviorLabels.join("; "),
    interventionLabels.join("; "),
    entry.otherIntervention || "",
    entry.notes || "",
    entry.signature,
    new Date().toISOString(),
  ];

  const prompt = `Append exactly one new row to Google Sheets spreadsheet with ID "${SPREADSHEET_ID}".
The row values in order are:
${row.map((v,i)=>`Column ${i+1}: ${JSON.stringify(v)}`).join("\n")}

Use the spreadsheets.values.append method on sheet "Sheet1", range "A:K", with valueInputOption RAW.
Do not modify any existing rows. Only append this single new row. Confirm when done.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      mcp_servers: [{ type:"url", url: DRIVE_MCP_URL, name:"google-drive" }],
      messages: [{ role:"user", content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);
  const data = await response.json();
  const text = data.content?.map(b=>b.text||"").join("") || "";
  if (!text.toLowerCase().includes("append") && !text.toLowerCase().includes("done") && !text.toLowerCase().includes("success")) {
    throw new Error("Drive save may have failed: " + text.slice(0,200));
  }
  return true;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function BarChart({data,color="#1d6fa4"}){
  const max=Math.max(...data.map(d=>d.value),1);
  return(
    <div style={{display:"flex",alignItems:"flex-end",gap:6,height:80}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
          <div style={{fontSize:11,fontWeight:700,color:d.value?color:"#ccc"}}>{d.value||""}</div>
          <div style={{width:"100%",background:d.value?color:"#e2e8f0",borderRadius:"4px 4px 0 0",height:d.value?`${Math.round((d.value/max)*56)+4}px`:"4px",transition:"height 0.3s"}}/>
          <div style={{fontSize:10,color:"#64748b",textAlign:"center",lineHeight:1.2}}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function StatCard({icon,label,value,sub,color="#0c2340"}){
  return(
    <div style={{background:"#fff",borderRadius:14,padding:"18px 14px",boxShadow:"0 2px 12px rgba(0,0,0,0.06)",display:"flex",flexDirection:"column",gap:4}}>
      <div style={{fontSize:20}}>{icon}</div>
      <div style={{fontSize:26,fontWeight:800,color}}>{value}</div>
      <div style={{fontSize:12,fontWeight:600,color:"#0c2340"}}>{label}</div>
      {sub&&<div style={{fontSize:11,color:"#64748b",lineHeight:1.3}}>{sub}</div>}
    </div>
  );
}

function ProgressBar({step}){
  return(
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,position:"relative"}}>
      {STEPS.map((label,i)=>(
        <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",flex:1,position:"relative"}}>
          <div style={{width:30,height:30,borderRadius:"50%",background:i<step?"#1d6fa4":i===step?"#0c2340":C.border,color:i<=step?"#fff":C.muted,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:12,zIndex:1,border:"2px solid "+(i<step?"#1d6fa4":i===step?"#0c2340":C.border),boxShadow:i===step?"0 0 0 4px rgba(12,35,64,0.15)":"none"}}>
            {i<step?"✓":i+1}
          </div>
          <div style={{fontSize:10,color:i===step?C.navy:C.muted,marginTop:4,textAlign:"center",fontWeight:i===step?700:500,lineHeight:1.2}}>{label}</div>
          {i<STEPS.length-1&&<div style={{position:"absolute",top:15,left:"50%",width:"100%",height:2,background:i<step?"#1d6fa4":C.border,zIndex:0}}/>}
        </div>
      ))}
    </div>
  );
}

function BigCard({item,selected,onToggle}){
  const active=selected.includes(item.id);
  return(
    <button onClick={()=>onToggle(item.id)} style={{display:"flex",alignItems:"center",gap:14,background:active?"#dbeafe":"#f8fafc",border:`2px solid ${active?"#1d6fa4":C.border}`,borderRadius:14,padding:"16px",cursor:"pointer",textAlign:"left",width:"100%",boxSizing:"border-box"}}>
      <span style={{fontSize:24,flexShrink:0,width:32,textAlign:"center"}}>{item.emoji}</span>
      <span style={{fontSize:15,color:active?"#0c2340":C.text,fontWeight:active?600:500,flex:1,lineHeight:1.3}}>{item.label}</span>
      <span style={{width:26,height:26,borderRadius:"50%",border:`2px solid ${active?"#1d6fa4":C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,color:active?"#fff":"transparent",background:active?"#1d6fa4":"transparent",flexShrink:0}}>
        {active?"✓":""}
      </span>
    </button>
  );
}

function StaffBadge({name,onClear}){
  const initials=name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  return(
    <div style={{display:"flex",alignItems:"center",gap:14,background:"#dbeafe",border:"1.5px solid #1d6fa4",borderRadius:12,padding:"14px 16px",marginBottom:18}}>
      <div style={{width:44,height:44,borderRadius:"50%",background:"#0c2340",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:16,flexShrink:0}}>{initials}</div>
      <div>
        <div style={{fontWeight:700,color:"#0c2340",fontSize:16}}>{name}</div>
        <button onClick={onClear} style={{background:"none",border:"none",color:"#1d6fa4",fontSize:13,cursor:"pointer",padding:0,marginTop:2,textDecoration:"underline"}}>Switch staff</button>
      </div>
    </div>
  );
}

function ClientPill({clientId,onChange}){
  const [open,setOpen]=useState(false);
  const client=CLIENTS.find(c=>c.id===clientId)||CLIENTS[0];
  return(
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.white,border:`1.5px solid ${C.border}`,borderRadius:12,padding:"10px 14px",cursor:"pointer",boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}} onClick={()=>setOpen(o=>!o)}>
        <span style={{fontSize:16}}>👤</span>
        <div style={{flex:1}}>
          <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:.6}}>Client</div>
          <div style={{fontSize:15,fontWeight:700,color:C.navy}}>{client.name}</div>
        </div>
        {clientId===DEFAULT_CLIENT&&<span style={{background:"#dcfce7",color:"#166534",fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:20,letterSpacing:.5}}>Default</span>}
        <span style={{color:C.muted,fontSize:13,marginLeft:4}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(
        <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:12,marginTop:6,overflow:"hidden",boxShadow:"0 4px 16px rgba(0,0,0,0.1)"}}>
          {CLIENTS.map(c=>(
            <button key={c.id} onClick={()=>{onChange(c.id);setOpen(false);}} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"13px 16px",background:c.id===clientId?"#dbeafe":"transparent",border:"none",borderBottom:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left"}}>
              <div style={{width:34,height:34,borderRadius:8,background:c.id===clientId?"#1d6fa4":"#0c2340",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,flexShrink:0}}>
                {c.name.split(" ").pop()[0]}
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:"#0c2340",fontSize:15}}>{c.name}</div>
                <div style={{fontSize:12,color:C.muted}}>Room {c.room}</div>
              </div>
              {c.id===clientId&&<span style={{color:"#1d6fa4",fontWeight:800,fontSize:18}}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drive status banner ───────────────────────────────────────────────────────
function DriveBanner({status}){
  if(!status) return null;
  const cfg = {
    saving: {bg:"#fffbeb",border:"#f59e0b",color:"#92400e",icon:"⏳",text:"Saving to Google Drive…"},
    saved:  {bg:"#f0fdf4",border:"#86efac",color:"#166534",icon:"✅",text:"Saved to Google Drive"},
    error:  {bg:"#fef2f2",border:"#fca5a5",color:"#991b1b",icon:"⚠️",text:"Drive save failed — entry kept locally"},
  }[status];
  return(
    <div style={{background:cfg.bg,border:`1.5px solid ${cfg.border}`,borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:10,marginTop:16,fontSize:14,color:cfg.color,fontWeight:600}}>
      <span style={{fontSize:18}}>{cfg.icon}</span>{cfg.text}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function App(){
  const[savedStaff,setSavedStaff]=useState(()=>LS.get("ibss_staff",""));
  const[lastEntry,setLastEntry]=useState(()=>LS.get("ibss_last",null));
  const[logs,setLogs]=useState(()=>LS.get("ibss_logs",[]));
  const[form,setForm]=useState(()=>blankForm(LS.get("ibss_staff","")));
  const[step,setStep]=useState(0);
  const[view,setView]=useState("form");
  const[submitted,setSubmitted]=useState(false);
  const[driveStatus,setDriveStatus]=useState(null); // null | saving | saved | error
  const[errors,setErrors]=useState({});
  const[reusePrompt,setReusePrompt]=useState(!!LS.get("ibss_last",null)&&!!LS.get("ibss_staff",""));
  const[dashPeriod,setDashPeriod]=useState("week");
  const[dashClient,setDashClient]=useState("all");
  const[histClient,setHistClient]=useState("all");

  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const toggleArr=(k,id)=>setForm(f=>({...f,[k]:f[k].includes(id)?f[k].filter(x=>x!==id):[...f[k],id]}));
  const clientName=id=>CLIENTS.find(c=>c.id===id)?.name||"Unknown";

  const reuseLastEntry=()=>{
    if(!lastEntry)return;
    setForm({...lastEntry,date:today(),startTime:nowTime(),endTime:"",signature:lastEntry.staff});
    setReusePrompt(false);
  };
  const selectStaff=name=>{
    setSavedStaff(name);LS.set("ibss_staff",name);
    setForm(f=>({...f,staff:name,signature:name}));
    setReusePrompt(!!LS.get("ibss_last",null));
  };
  const clearStaff=()=>{setSavedStaff("");LS.set("ibss_staff","");setForm(blankForm(""));setReusePrompt(false);};

  const validateStep=()=>{
    const e={};
    if(step===0){if(!form.date)e.date=true;if(!form.staff)e.staff=true;if(!form.startTime)e.startTime=true;if(!form.endTime)e.endTime=true;}
    if(step===1&&!form.behaviors.length)e.behaviors=true;
    if(step===2&&!form.interventions.length&&!form.otherIntervention.trim())e.interventions=true;
    if(step===3&&!form.signature.trim())e.signature=true;
    setErrors(e);return!Object.keys(e).length;
  };
  const next=()=>{if(validateStep())setStep(s=>Math.min(s+1,3));};
  const back=()=>{setErrors({});setStep(s=>Math.max(s-1,0));};

  const submit=async()=>{
    if(!validateStep())return;
    const entry={...form,id:Date.now()};
    const updated=[entry,...logs];
    LS.set("ibss_logs",updated);LS.set("ibss_last",entry);
    setLogs(updated);setLastEntry(entry);setSubmitted(true);

    // Save to Google Drive
    setDriveStatus("saving");
    try{
      const bLabels=BEHAVIORS.filter(b=>entry.behaviors.includes(b.id)).map(b=>b.label);
      const iLabels=INTERVENTIONS.filter(i=>entry.interventions.includes(i.id)).map(i=>i.label);
      await saveToGoogleDrive(entry, clientName(entry.clientId), bLabels, iLabels);
      setDriveStatus("saved");
    }catch(err){
      console.error("Drive save error:",err);
      setDriveStatus("error");
    }
  };

  const handleNew=()=>{setForm(blankForm(savedStaff));setStep(0);setSubmitted(false);setDriveStatus(null);setErrors({});setReusePrompt(!!lastEntry&&!!savedStaff);};
  const deleteLog=id=>{const u=logs.filter(l=>l.id!==id);LS.set("ibss_logs",u);setLogs(u);};

  // Dashboard data
  const refDate=today();
  const filteredLogs=useMemo(()=>
    logs.filter(l=>dashPeriod==="week"?isSameWeek(l.date,refDate):isSameMonth(l.date,refDate))
        .filter(l=>dashClient==="all"||l.clientId===dashClient)
  ,[logs,dashPeriod,dashClient]);

  const totalIncidents=filteredLogs.length;
  const uniqueClients=new Set(filteredLogs.map(l=>l.clientId)).size;
  const topBehavior=useMemo(()=>{
    const cnt={};filteredLogs.forEach(l=>(l.behaviors||[]).forEach(b=>{cnt[b]=(cnt[b]||0)+1;}));
    const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
    if(!top)return null;const beh=BEHAVIORS.find(b=>b.id===top[0]);
    return beh?{label:beh.label,emoji:beh.emoji,count:top[1]}:null;
  },[filteredLogs]);

  const barData=useMemo(()=>{
    if(dashPeriod==="week"){
      const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const sw=new Date(startOfWeek(refDate));
      return days.map((label,i)=>{const d=new Date(sw);d.setDate(d.getDate()+i);const ds=d.toISOString().split("T")[0];return{label,value:filteredLogs.filter(l=>l.date===ds).length};});
    } else {
      const sw=new Date(startOfMonth(refDate));const weeks=[];
      for(let w=0;w<5;w++){
        const wStart=new Date(sw);wStart.setDate(wStart.getDate()+w*7);
        const wEnd=new Date(wStart);wEnd.setDate(wEnd.getDate()+6);
        const wStartS=wStart.toISOString().split("T")[0],wEndS=wEnd.toISOString().split("T")[0];
        const cnt=filteredLogs.filter(l=>l.date>=wStartS&&l.date<=wEndS).length;
        if(wStart.getMonth()===new Date(refDate).getMonth())weeks.push({label:`Wk${w+1}`,value:cnt});
      }
      return weeks;
    }
  },[filteredLogs,dashPeriod]);

  const behaviorBreakdown=useMemo(()=>{
    const cnt={};filteredLogs.forEach(l=>(l.behaviors||[]).forEach(b=>{cnt[b]=(cnt[b]||0)+1;}));
    return BEHAVIORS.map(b=>({...b,count:cnt[b.id]||0})).filter(b=>b.count>0).sort((a,b)=>b.count-a.count).slice(0,5);
  },[filteredLogs]);

  const clientBreakdown=useMemo(()=>{
    const cnt={};filteredLogs.forEach(l=>{if(l.clientId)cnt[l.clientId]=(cnt[l.clientId]||0)+1;});
    return CLIENTS.map(c=>({...c,count:cnt[c.id]||0})).filter(c=>c.count>0).sort((a,b)=>b.count-a.count);
  },[filteredLogs]);

  // ── Success screen ──
  if(submitted) return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Helvetica Neue',Arial,sans-serif",padding:"20px 16px"}}>
      <div style={{maxWidth:460,margin:"40px auto",background:C.white,borderRadius:20,padding:"36px 28px",boxShadow:"0 8px 40px rgba(0,0,0,0.1)"}}>
        <div style={{width:64,height:64,background:C.greenL,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,color:C.green,margin:"0 auto 20px"}}>✓</div>
        <h2 style={{margin:"0 0 8px",fontSize:24,color:C.navy,textAlign:"center"}}>Entry Saved</h2>
        <p style={{margin:"0 0 4px",color:C.muted,fontSize:14,textAlign:"center"}}>Signed by <strong>{form.signature}</strong></p>
        <p style={{margin:"0 0 4px",color:C.muted,fontSize:14,textAlign:"center"}}>{fmtDate(form.date)} · {fmtTime(form.startTime)} – {fmtTime(form.endTime)}</p>
        <p style={{margin:"0 0 16px",color:C.accent,fontSize:14,fontWeight:600,textAlign:"center"}}>👤 {clientName(form.clientId)}</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginBottom:8}}>
          {form.behaviors.map(id=>{const b=BEHAVIORS.find(x=>x.id===id);return b?<span key={id} style={{background:C.redL,color:C.red,borderRadius:6,padding:"5px 10px",fontSize:12}}>{b.emoji} {b.label}</span>:null;})}
        </div>

        {/* Drive status */}
        <DriveBanner status={driveStatus}/>

        {driveStatus==="saved"&&(
          <div style={{marginTop:12,textAlign:"center"}}>
            <a href={`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`} target="_blank" rel="noreferrer"
              style={{fontSize:13,color:C.accent,textDecoration:"underline"}}>
              📊 Open Google Sheet →
            </a>
          </div>
        )}

        <div style={{display:"flex",gap:12,marginTop:24}}>
          <button style={{flex:1,background:C.navy,color:"#fff",border:"none",borderRadius:10,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer"}} onClick={handleNew}>+ New Entry</button>
          <button style={{flex:1,background:"none",color:C.navy,border:"2px solid "+C.navy,borderRadius:10,padding:"14px",fontSize:15,fontWeight:600,cursor:"pointer"}} onClick={()=>{setView("dashboard");setSubmitted(false);}}>Dashboard</button>
        </div>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Helvetica Neue',Arial,sans-serif"}}>

      {/* Header */}
      <div style={{background:C.navy,position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 16px rgba(0,0,0,0.25)"}}>
        <div style={{maxWidth:720,margin:"0 auto",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{background:"#1d6fa4",color:"#fff",fontSize:11,fontWeight:800,letterSpacing:2,padding:"3px 8px",borderRadius:4}}>IBSS</span>
            <span style={{color:"#fff",fontSize:18,fontWeight:600}}>Daily Log</span>
          </div>
          <div style={{display:"flex",background:"rgba(255,255,255,0.12)",borderRadius:8,padding:3,gap:2}}>
            {[["form","📝 Log"],["history","🗂 History"],["dashboard","📊 Dashboard"]].map(([v,label])=>(
              <button key={v} onClick={()=>setView(v)} style={{background:view===v?"#fff":"none",border:"none",color:view===v?C.navy:"rgba(255,255,255,0.7)",padding:"8px 12px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:view===v?700:500}}>
                {label}{v==="history"&&logs.length>0&&<span style={{background:C.accent,color:"#fff",borderRadius:10,padding:"1px 5px",fontSize:10,marginLeft:4}}>{logs.length}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ══ FORM ══ */}
      {view==="form"&&(
        <div style={{maxWidth:680,margin:"0 auto",padding:"20px 16px 80px"}}>
          {reusePrompt&&step===0&&(
            <div style={{background:"#fffbeb",border:"1.5px solid #f59e0b",borderRadius:12,padding:"14px 16px",marginBottom:14,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <span style={{fontSize:22}}>⚡</span>
                <div>
                  <div style={{fontWeight:700,color:"#92400e",fontSize:15}}>Reuse last entry?</div>
                  <div style={{color:"#b45309",fontSize:13,marginTop:2}}>Same client, behaviors & interventions from {fmtDate(lastEntry?.date)}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button style={{flex:1,background:"#f59e0b",color:"#fff",border:"none",borderRadius:8,padding:"12px",fontWeight:700,fontSize:15,cursor:"pointer"}} onClick={reuseLastEntry}>Yes, reuse</button>
                <button style={{flex:1,background:"none",color:"#92400e",border:"1.5px solid #f59e0b",borderRadius:8,padding:"12px",fontWeight:600,fontSize:15,cursor:"pointer"}} onClick={()=>setReusePrompt(false)}>Start fresh</button>
              </div>
            </div>
          )}

          <ClientPill clientId={form.clientId} onChange={id=>set("clientId",id)}/>
          <ProgressBar step={step}/>

          <div style={{background:C.white,borderRadius:16,padding:"24px 20px",boxShadow:"0 4px 24px rgba(0,0,0,0.07)"}}>

            {step===0&&(
              <div>
                <h2 style={{margin:"0 0 16px",fontSize:22,color:C.navy,fontWeight:700}}>Who & When</h2>
                {savedStaff
                  ?<StaffBadge name={savedStaff} onClear={clearStaff}/>
                  :<div style={{marginBottom:18}}>
                    <label style={{display:"block",fontSize:12,fontWeight:700,color:C.navy,marginBottom:8,textTransform:"uppercase",letterSpacing:.8}}>Staff Name <span style={{color:C.red}}>*</span></label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
                      {STAFF.map(name=>(
                        <button key={name} onClick={()=>selectStaff(name)} style={{display:"flex",alignItems:"center",gap:10,background:form.staff===name?"#dbeafe":"#f8fafc",border:`1.5px solid ${form.staff===name?"#1d6fa4":C.border}`,borderRadius:12,padding:"14px",cursor:"pointer",textAlign:"left"}}>
                          <span style={{width:36,height:36,borderRadius:"50%",background:C.navy,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:13,flexShrink:0}}>{name.split(" ").map(w=>w[0]).join("").slice(0,2)}</span>
                          <span style={{fontSize:14,color:C.text,fontWeight:500,lineHeight:1.3}}>{name}</span>
                        </button>
                      ))}
                    </div>
                    {errors.staff&&<span style={{display:"block",color:C.red,fontSize:12,marginTop:4}}>Select a staff member</span>}
                  </div>
                }
                <div style={{marginBottom:18}}>
                  <label style={{display:"block",fontSize:12,fontWeight:700,color:C.navy,marginBottom:8,textTransform:"uppercase",letterSpacing:.8}}>Date <span style={{color:C.red}}>*</span></label>
                  <input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={{width:"100%",padding:"14px",border:`1.5px solid ${errors.date?C.red:C.border}`,borderRadius:10,fontSize:16,color:C.text,background:C.white,boxSizing:"border-box",outline:"none"}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <div>
                    <label style={{display:"block",fontSize:12,fontWeight:700,color:C.navy,marginBottom:8,textTransform:"uppercase",letterSpacing:.8}}>Start Time <span style={{color:C.red}}>*</span></label>
                    <select value={form.startTime} onChange={e=>set("startTime",e.target.value)} style={{width:"100%",padding:"14px",border:`1.5px solid ${errors.startTime?C.red:C.border}`,borderRadius:10,fontSize:16,color:C.text,background:C.white,boxSizing:"border-box",outline:"none"}}>
                      {TIME_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{display:"block",fontSize:12,fontWeight:700,color:C.navy,marginBottom:8,textTransform:"uppercase",letterSpacing:.8}}>End Time <span style={{color:C.red}}>*</span></label>
                    <select value={form.endTime} onChange={e=>set("endTime",e.target.value)} style={{width:"100%",padding:"14px",border:`1.5px solid ${errors.endTime?C.red:C.border}`,borderRadius:10,fontSize:16,color:C.text,background:C.white,boxSizing:"border-box",outline:"none"}}>
                      <option value="">Select end time…</option>
                      {TIME_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {errors.endTime&&<span style={{color:C.red,fontSize:12}}>Required</span>}
                  </div>
                </div>
              </div>
            )}

            {step===1&&(
              <div>
                <h2 style={{margin:"0 0 4px",fontSize:22,color:C.navy,fontWeight:700}}>Primary Behavior(s)</h2>
                <p style={{margin:"0 0 16px",color:C.muted,fontSize:14}}>Tap all that apply</p>
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12}}>
                  {BEHAVIORS.map(b=><BigCard key={b.id} item={b} selected={form.behaviors} onToggle={id=>toggleArr("behaviors",id)}/>)}
                </div>
                {errors.behaviors&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"12px 14px",color:C.red,fontSize:14}}>Please select at least one behavior</div>}
              </div>
            )}

            {step===2&&(
              <div>
                <h2 style={{margin:"0 0 4px",fontSize:22,color:C.navy,fontWeight:700}}>Intervention(s) Used</h2>
                <p style={{margin:"0 0 16px",color:C.muted,fontSize:14}}>Tap all that apply</p>
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
                  {INTERVENTIONS.map(i=><BigCard key={i.id} item={i} selected={form.interventions} onToggle={id=>toggleArr("interventions",id)}/>)}
                </div>
                <div>
                  <label style={{display:"block",fontSize:12,fontWeight:700,color:C.navy,marginBottom:8,textTransform:"uppercase",letterSpacing:.8}}>Other</label>
                  <input placeholder="Any other intervention…" value={form.otherIntervention} onChange={e=>set("otherIntervention",e.target.value)} style={{width:"100%",padding:"14px",border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:16,color:C.text,background:C.white,boxSizing:"border-box",outline:"none"}}/>
                </div>
                {errors.interventions&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"12px 14px",color:C.red,fontSize:14,marginTop:12}}>Select or describe at least one</div>}
              </div>
            )}

            {step===3&&(
              <div>
                <h2 style={{margin:"0 0 16px",fontSize:22,color:C.navy,fontWeight:700}}>Notes & Signature</h2>
                <div style={{background:"#f0f7ff",border:"1.5px solid #dbeafe",borderRadius:12,padding:"14px 16px",marginBottom:20,display:"flex",flexDirection:"column",gap:8}}>
                  {[["👤",form.staff],["🏷️",clientName(form.clientId)],["📅",`${fmtDate(form.date)} · ${fmtTime(form.startTime)} – ${fmtTime(form.endTime)}`],["⚠️",`${form.behaviors.length} behavior${form.behaviors.length!==1?"s":""} · ${form.interventions.length+(form.otherIntervention?1:0)} intervention${(form.interventions.length+(form.otherIntervention?1:0))!==1?"s":""}`]].map(([icon,text])=>(
                    <div key={icon} style={{display:"flex",alignItems:"center",gap:10,fontSize:14,color:C.navy,fontWeight:500}}>
                      <span style={{fontSize:16}}>{icon}</span>{text}
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:18}}>
                  <label style={{display:"block",fontSize:12,fontWeight:700,color:C.navy,marginBottom:8,textTransform:"uppercase",letterSpacing:.8}}>Notes <span style={{color:C.muted,fontWeight:400,textTransform:"none"}}>(optional)</span></label>
                  <textarea rows={4} placeholder="Additional observations…" value={form.notes} onChange={e=>set("notes",e.target.value)} style={{width:"100%",padding:"14px",border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:15,color:C.text,background:C.white,boxSizing:"border-box",outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
                </div>
                <div>
                  <label style={{display:"block",fontSize:12,fontWeight:700,color:C.navy,marginBottom:4,textTransform:"uppercase",letterSpacing:.8}}>Digital Signature <span style={{color:C.red}}>*</span></label>
                  <p style={{fontSize:12,color:C.muted,margin:"0 0 8px"}}>Type your full name to sign this entry</p>
                  <input placeholder="Full name…" value={form.signature} onChange={e=>set("signature",e.target.value)} style={{width:"100%",padding:"14px",border:`1.5px solid ${errors.signature?C.red:C.border}`,borderRadius:10,fontSize:18,color:C.text,background:C.white,boxSizing:"border-box",outline:"none",fontStyle:"italic",letterSpacing:1}}/>
                  {errors.signature&&<span style={{color:C.red,fontSize:12,marginTop:4,display:"block"}}>Signature required</span>}
                </div>
                <div style={{marginTop:14,background:"#f0f7ff",border:"1px solid #dbeafe",borderRadius:8,padding:"10px 14px",fontSize:13,color:C.accent,display:"flex",alignItems:"center",gap:8}}>
                  <span>📊</span> Entry will be saved to Google Drive on submit
                </div>
              </div>
            )}

            <div style={{display:"flex",gap:12,marginTop:24}}>
              {step>0&&<button style={{flex:1,background:"none",border:`2px solid ${C.border}`,color:C.muted,borderRadius:12,padding:"16px",fontSize:16,fontWeight:600,cursor:"pointer"}} onClick={back}>← Back</button>}
              {step<3
                ?<button style={{flex:2,background:C.navy,color:"#fff",border:"none",borderRadius:12,padding:"16px",fontSize:16,fontWeight:700,cursor:"pointer"}} onClick={next}>Next →</button>
                :<button style={{flex:2,background:C.green,color:"#fff",border:"none",borderRadius:12,padding:"16px",fontSize:16,fontWeight:700,cursor:"pointer"}} onClick={submit}>Submit & Save to Drive ✓</button>
              }
            </div>
          </div>
        </div>
      )}

      {/* ══ HISTORY ══ */}
      {view==="history"&&(
        <div style={{maxWidth:720,margin:"0 auto",padding:"20px 16px 80px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
            <h2 style={{margin:0,fontSize:20,color:C.navy,fontWeight:700}}>Log History</h2>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <select value={histClient} onChange={e=>setHistClient(e.target.value)} style={{padding:"8px 12px",border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:14,color:C.text,background:C.white,outline:"none"}}>
                <option value="all">All Clients</option>
                {CLIENTS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <a href={`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`} target="_blank" rel="noreferrer"
                style={{background:C.accent,color:"#fff",borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:700,textDecoration:"none"}}>
                📊 Open Sheet
              </a>
            </div>
          </div>
          {logs.filter(l=>histClient==="all"||l.clientId===histClient).length===0
            ?<div style={{textAlign:"center",color:C.muted,padding:"60px 20px",fontSize:16}}>No entries yet.</div>
            :logs.filter(l=>histClient==="all"||l.clientId===histClient).map(log=>{
              const lb=BEHAVIORS.filter(b=>(log.behaviors||[]).includes(b.id));
              const li=INTERVENTIONS.filter(i=>(log.interventions||[]).includes(i.id));
              return(
                <div key={log.id} style={{background:C.white,borderRadius:14,padding:"20px",marginBottom:14,boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{fontSize:17,fontWeight:700,color:C.navy}}>{fmtDate(log.date)}</div>
                      <div style={{fontSize:13,color:C.muted,marginTop:2}}>{log.staff}</div>
                      <div style={{display:"inline-block",marginTop:6,background:"#f0f7ff",border:"1px solid #dbeafe",borderRadius:6,padding:"3px 10px",fontSize:13,color:C.accent,fontWeight:600}}>👤 {clientName(log.clientId)}</div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{background:C.accentL,color:C.accent,borderRadius:6,padding:"4px 10px",fontSize:12,fontWeight:600}}>{fmtTime(log.startTime)} – {fmtTime(log.endTime)}</span>
                      <button style={{background:"#fef2f2",border:"none",color:C.red,borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:13}} onClick={()=>deleteLog(log.id)}>✕</button>
                    </div>
                  </div>
                  {lb.length>0&&<div style={{marginBottom:10}}><div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Behaviors</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{lb.map(b=><span key={b.id} style={{background:C.redL,color:C.red,borderRadius:6,padding:"5px 10px",fontSize:12,fontWeight:500}}>{b.emoji} {b.label}</span>)}</div></div>}
                  {(li.length>0||log.otherIntervention)&&<div style={{marginBottom:10}}><div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Interventions</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{li.map(i=><span key={i.id} style={{background:C.accentL,color:C.accent,borderRadius:6,padding:"5px 10px",fontSize:12,fontWeight:500}}>{i.emoji} {i.label}</span>)}{log.otherIntervention&&<span style={{background:C.accentL,color:C.accent,borderRadius:6,padding:"5px 10px",fontSize:12,fontWeight:500}}>📝 {log.otherIntervention}</span>}</div></div>}
                  {log.notes&&<p style={{fontSize:13,color:C.muted,fontStyle:"italic",margin:"8px 0 4px",lineHeight:1.5}}>"{log.notes}"</p>}
                  <div style={{fontSize:12,color:C.muted,borderTop:`1px solid ${C.border}`,paddingTop:10,marginTop:10}}>Signed: <em>{log.signature}</em></div>
                </div>
              );
            })
          }
        </div>
      )}

      {/* ══ DASHBOARD ══ */}
      {view==="dashboard"&&(
        <div style={{maxWidth:720,margin:"0 auto",padding:"20px 16px 80px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
            <h2 style={{margin:0,fontSize:20,color:C.navy,fontWeight:700}}>📊 Dashboard</h2>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <div style={{display:"flex",background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                {[["week","This Week"],["month","This Month"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setDashPeriod(v)} style={{background:dashPeriod===v?C.navy:"none",color:dashPeriod===v?"#fff":C.muted,border:"none",padding:"9px 14px",cursor:"pointer",fontSize:13,fontWeight:dashPeriod===v?700:500}}>{label}</button>
                ))}
              </div>
              <select value={dashClient} onChange={e=>setDashClient(e.target.value)} style={{padding:"8px 12px",border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.text,background:C.white,outline:"none"}}>
                <option value="all">All Clients</option>
                {CLIENTS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <a href={`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`} target="_blank" rel="noreferrer"
                style={{background:C.accent,color:"#fff",borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:700,textDecoration:"none"}}>
                📊 Open Sheet
              </a>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
            <StatCard icon="📋" label="Total Incidents" value={totalIncidents} color={C.navy}/>
            <StatCard icon="👥" label="Clients Involved" value={uniqueClients} color={C.accent}/>
            <StatCard icon="⚠️" label="Top Behavior" value={topBehavior?topBehavior.emoji:"—"} sub={topBehavior?`${topBehavior.label.slice(0,24)}… ×${topBehavior.count}`:"No data"} color={C.red}/>
          </div>
          <div style={{background:C.white,borderRadius:14,padding:"20px",boxShadow:"0 2px 12px rgba(0,0,0,0.06)",marginBottom:16}}>
            <div style={{fontWeight:700,color:C.navy,fontSize:15,marginBottom:16}}>Incidents {dashPeriod==="week"?"by Day":"by Week"}</div>
            {totalIncidents===0
              ?<div style={{textAlign:"center",color:C.muted,padding:"24px 0",fontSize:14}}>No incidents {dashPeriod==="week"?"this week":"this month"}</div>
              :<BarChart data={barData} color={C.accent}/>
            }
          </div>
          {behaviorBreakdown.length>0&&(
            <div style={{background:C.white,borderRadius:14,padding:"20px",boxShadow:"0 2px 12px rgba(0,0,0,0.06)",marginBottom:16}}>
              <div style={{fontWeight:700,color:C.navy,fontSize:15,marginBottom:14}}>Top Behaviors</div>
              {behaviorBreakdown.map((b,i)=>(
                <div key={b.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                  <span style={{fontSize:20,width:28,textAlign:"center"}}>{b.emoji}</span>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:13,color:C.text,fontWeight:500}}>{b.label}</span>
                      <span style={{fontSize:13,fontWeight:700,color:C.red}}>{b.count}×</span>
                    </div>
                    <div style={{height:6,background:"#f1f5f9",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:3,background:i===0?C.red:i===1?"#f97316":"#f59e0b",width:`${Math.round((b.count/behaviorBreakdown[0].count)*100)}%`,transition:"width 0.3s"}}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {clientBreakdown.length>0&&(
            <div style={{background:C.white,borderRadius:14,padding:"20px",boxShadow:"0 2px 12px rgba(0,0,0,0.06)",marginBottom:16}}>
              <div style={{fontWeight:700,color:C.navy,fontSize:15,marginBottom:14}}>Incidents by Client</div>
              {clientBreakdown.map((c,i)=>(
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                  <div style={{width:36,height:36,borderRadius:8,background:C.navy,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,flexShrink:0}}>{c.name.split(" ").pop()[0]}</div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:13,color:C.text,fontWeight:600}}>{c.name} <span style={{color:C.muted,fontWeight:400}}>· Rm {c.room}</span></span>
                      <span style={{fontSize:13,fontWeight:700,color:C.accent}}>{c.count} incident{c.count!==1?"s":""}</span>
                    </div>
                    <div style={{height:6,background:"#f1f5f9",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:3,background:C.accent,width:`${Math.round((c.count/clientBreakdown[0].count)*100)}%`,transition:"width 0.3s"}}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {logs.length===0&&(
            <div style={{textAlign:"center",color:C.muted,padding:"60px 20px",fontSize:16}}>
              <div style={{fontSize:40,marginBottom:12}}>📋</div>
              No entries yet.
              <br/>
              <button style={{marginTop:16,background:C.navy,color:"#fff",border:"none",borderRadius:10,padding:"12px 24px",fontSize:15,fontWeight:700,cursor:"pointer"}} onClick={()=>setView("form")}>+ New Entry</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
