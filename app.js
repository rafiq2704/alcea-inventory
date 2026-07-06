/* ALCEA Inventory — three-entity model (raw → prep → dish)
   raws:   {id,name,unit,low,storage,waste}
   preps:  {id,name,recipe:{rawId:qty,...},prep,waste}
   dishes: {id,name,recipe:{prepId:qty,...}}   // cooked to order, not held
   Reconciliation rolls POS dish sales down: dish → preps → raws.
*/

let sb=null, CLOUD=false;
if(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase){
  sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY); CLOUD=true;
}

const LS={ load(k,f){try{const v=localStorage.getItem('alcea_'+k);return v?JSON.parse(v):f;}catch(e){return f;}}, save(k,v){localStorage.setItem('alcea_'+k,JSON.stringify(v));} };
const DEFAULT_PIN="4337";

/* ---------- starter data (matches the signed-off diagram) ---------- */
const SEED_RAWS=[
  {id:'egg',name:'Egg',unit:'egg',low:12,storage:0,waste:0},
  {id:'chicken',name:'Chicken',unit:'piece',low:6,storage:0,waste:0},
  {id:'chives',name:'Chives',unit:'g',low:100,storage:0,waste:0},
  {id:'rice',name:'Rice',unit:'g',low:2000,storage:0,waste:0},
  {id:'anchovies',name:'Anchovies',unit:'g',low:300,storage:0,waste:0},
];
const SEED_PREPS=[
  {id:'scrambledegg',name:'Scrambled Egg',recipe:{egg:2,chives:10},prep:0,waste:0},
  {id:'boiledegg',name:'Boiled Egg',recipe:{egg:1},prep:0,waste:0},
  {id:'poachedegg',name:'Poached Egg',recipe:{egg:1},prep:0,waste:0},
  {id:'roastedchicken',name:'Roasted Chicken',recipe:{chicken:1},prep:0,waste:0},
  {id:'sambalrice',name:'Sambal Rice',recipe:{rice:150,anchovies:20},prep:0,waste:0},
];
const SEED_DISHES=[
  {id:'nasilemak',name:'Nasi Lemak',recipe:{sambalrice:1,boiledegg:1,roastedchicken:1}},
  {id:'bigbreakfast',name:'Big Breakfast',recipe:{scrambledegg:1,roastedchicken:1}},
  {id:'eggsbenedict',name:'Eggs Benedict',recipe:{poachedegg:2}},
];

let raws   = LS.load('raws', SEED_RAWS);
let preps  = LS.load('preps', SEED_PREPS);
let dishes = LS.load('dishes', SEED_DISHES);
let log    = LS.load('log', []);            // {type,msg,iso,t,kind,id,qty}
let sales  = LS.load('sales', {});          // sales[YYYY-MM-DD][dishId]=qty
let settings = LS.load('settings', {pin:DEFAULT_PIN});
if(!settings.pin) settings.pin=DEFAULT_PIN;

let ADMIN=false, selDate=todayKey(), stockFilter='all', reconLevel='prep';

function cacheLocal(){ LS.save('raws',raws);LS.save('preps',preps);LS.save('dishes',dishes);LS.save('log',log);LS.save('sales',sales);LS.save('settings',settings); }

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!==undefined)e.innerHTML=h;return e;};
const rawById=id=>raws.find(r=>r.id===id);
const prepById=id=>preps.find(p=>p.id===id);
const dishById=id=>dishes.find(d=>d.id===id);
function toast(m,err){const t=$('#toast');t.textContent=m;t.className='toast show'+(err?' err':'');clearTimeout(t._x);t._x=setTimeout(()=>t.className='toast',1800);}
function nowTime(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function slug(s){return s.toLowerCase().replace(/[^a-z0-9]/g,'')+Math.random().toString(36).slice(2,5);}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

/* ---------- dates ---------- */
function todayKey(){return dateKey(new Date());}
function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function keyToDate(k){const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d);}
function isoDateKey(iso){return dateKey(new Date(iso));}
function prettyDate(k){const t=todayKey();if(k===t)return'Today';const yd=dateKey(new Date(Date.now()-864e5));if(k===yd)return'Yesterday';return keyToDate(k).toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'});}

/* ---------- status ---------- */
function setStatus(state){const dot=$('#dot'),txt=$('#statusTxt');dot.className='dot '+state;txt.textContent=state==='online'?'synced':state==='offline'?'offline · local':state==='error'?'sync error':'local mode';}

/* ============================================================
   CLOUD SYNC
   ============================================================ */
async function cloudPullAll(){
  if(!CLOUD){setStatus('local');return;}
  try{
    const [rw,pr,ds,mv,sl,st]=await Promise.all([
      sb.from('raws').select('*').order('created_at'),
      sb.from('preps').select('*').order('created_at'),
      sb.from('dishes').select('*').order('created_at'),
      sb.from('movements').select('*').order('created_at',{ascending:false}).limit(500),
      sb.from('sales').select('*'),
      sb.from('settings').select('*').eq('id',1).maybeSingle()
    ]);
    if(rw.error||pr.error||ds.error||mv.error||sl.error) throw(rw.error||pr.error||ds.error||mv.error||sl.error);
    if(rw.data&&rw.data.length) raws=rw.data.map(r=>({id:r.id,name:r.name,unit:r.unit,low:r.low,storage:r.storage,waste:r.waste}));
    else if(raws.length) for(const r of raws) await sb.from('raws').upsert(r);
    if(pr.data&&pr.data.length) preps=pr.data.map(r=>({id:r.id,name:r.name,recipe:r.recipe,prep:r.prep,waste:r.waste}));
    else if(preps.length) for(const p of preps) await sb.from('preps').upsert(p);
    if(ds.data&&ds.data.length) dishes=ds.data.map(r=>({id:r.id,name:r.name,recipe:r.recipe}));
    else if(dishes.length) for(const d of dishes) await sb.from('dishes').upsert(d);
    log=(mv.data||[]).map(r=>({type:r.type,msg:r.msg,iso:r.created_at,kind:r.kind||undefined,id:r.item_id||undefined,qty:r.qty||undefined,t:new Date(r.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}));
    sales={};(sl.data||[]).forEach(r=>{const d=r.date||todayKey();(sales[d]=sales[d]||{})[r.dish_id]=r.qty;});
    if(st&&st.data&&st.data.pin) settings.pin=st.data.pin;
    else if(CLOUD) await sb.from('settings').upsert({id:1,pin:settings.pin});
    cacheLocal();setStatus('online');renderAll();
  }catch(e){console.error(e);setStatus('error');toast('Cloud read failed — using local',true);}
}
async function pushRaw(r){if(!CLOUD)return;const{error}=await sb.from('raws').upsert(r);if(error){setStatus('error');}else setStatus('online');}
async function pushPrep(p){if(!CLOUD)return;const{error}=await sb.from('preps').upsert(p);if(error)setStatus('error');else setStatus('online');}
async function pushDish(d){if(!CLOUD)return;const{error}=await sb.from('dishes').upsert(d);if(error)setStatus('error');else setStatus('online');}
async function delRawCloud(id){if(!CLOUD)return;await sb.from('raws').delete().eq('id',id);}
async function delPrepCloud(id){if(!CLOUD)return;await sb.from('preps').delete().eq('id',id);}
async function delDishCloud(id){if(!CLOUD)return;await sb.from('dishes').delete().eq('id',id);await sb.from('sales').delete().eq('dish_id',id);}
async function pushSale(date,dish_id,qty){if(!CLOUD)return;const{error}=await sb.from('sales').upsert({date,dish_id,qty},{onConflict:'date,dish_id'});if(error)setStatus('error');else setStatus('online');}
async function pushMovement(type,msg,meta){if(!CLOUD)return;await sb.from('movements').insert({type,msg,kind:meta&&meta.kind||null,item_id:meta&&meta.id||null,qty:meta&&meta.qty||null});}
async function pushSettings(){if(!CLOUD)return;await sb.from('settings').upsert({id:1,pin:settings.pin});}

function subscribeRealtime(){
  if(!CLOUD)return;
  sb.channel('alcea-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'raws'},cloudPullAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'preps'},cloudPullAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'dishes'},cloudPullAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'movements'},cloudPullAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'sales'},cloudPullAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'settings'},cloudPullAll)
    .subscribe();
}
function addLog(type,msg,meta){const iso=new Date().toISOString();log.unshift({type,msg,iso,t:nowTime(),...(meta||{})});cacheLocal();pushMovement(type,msg,meta);}

/* ============================================================
   RECIPE HELPERS
   ============================================================ */
function prepRecipeText(p){
  return Object.entries(p.recipe||{}).map(([rid,q])=>{const r=rawById(rid);return q+(r&&r.unit&&r.unit!=='piece'&&r.unit!=='egg'?r.unit:'×')+' '+(r?r.name:rid);}).join(' + ');
}
function dishRecipeText(d){
  return Object.entries(d.recipe||{}).map(([pid,q])=>{const p=prepById(pid);return q+'× '+(p?p.name:pid);}).join(' + ');
}
/* how many of a prep can we currently make from raw stock */
function prepMakeable(p){
  let max=Infinity;
  for(const[rid,q] of Object.entries(p.recipe||{})){const r=rawById(rid);if(!r||q<=0){max=0;break;}max=Math.min(max,Math.floor(r.storage/q));}
  return max===Infinity?0:max;
}
/* how many of a dish can we cook from prep stock */
function dishCookable(d){
  let max=Infinity;
  for(const[pid,q] of Object.entries(d.recipe||{})){const p=prepById(pid);if(!p||q<=0){max=0;break;}max=Math.min(max,Math.floor(p.prep/q));}
  return max===Infinity?0:max;
}

/* ============================================================
   STOCK TAB
   ============================================================ */
function setFilter(f){stockFilter=f;document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('on',c.dataset.filter===f));renderStock();}

function renderStock(){
  const wrap=$('#stock-list');wrap.innerHTML='';
  const banner=$('#cloud-banner');
  if(!CLOUD){banner.style.display='block';banner.innerHTML='<b>Local mode.</b> Add your Supabase URL + key in index.html to sync across devices.';}
  else banner.style.display='none';
  const q=($('#search').value||'').toLowerCase().trim();
  const match=name=>!q||name.toLowerCase().includes(q);

  const showRaw = stockFilter==='all'||stockFilter==='raw'||stockFilter==='low';
  const showPrep= stockFilter==='all'||stockFilter==='prep'||stockFilter==='low';
  const showDish= stockFilter==='all'||stockFilter==='dish';
  let any=false;

  if(showRaw){
    const list=raws.filter(r=>match(r.name)&&(stockFilter!=='low'||r.storage<=r.low));
    if(list.length){any=true;wrap.appendChild(stageHeader('raw','Raw items','storage'));list.forEach(r=>wrap.appendChild(rawRow(r)));}
  }
  if(showPrep){
    const list=preps.filter(p=>match(p.name)&&(stockFilter!=='low'||prepMakeable(p)<=0));
    if(list.length){any=true;wrap.appendChild(stageHeader('prep','Prep items','prep'));list.forEach(p=>wrap.appendChild(prepRow(p)));}
  }
  if(showDish){
    const list=dishes.filter(d=>match(d.name));
    if(list.length){any=true;wrap.appendChild(stageHeader('dish','Dishes','cook to order'));list.forEach(d=>wrap.appendChild(dishRow(d)));}
  }
  if(!any) wrap.appendChild(el('div','empty','<div class="big">🍳</div>Nothing matches.'));
}
function stageHeader(cls,title,countlbl){
  const h=el('div','stage-head '+cls);
  h.innerHTML=`<span class="bar"></span><h2>${title}</h2><span class="count">${countlbl}</span>`;
  return h;
}

/* --- RAW row --- */
function rawRow(r){
  const row=el('div','row');row.dataset.id=r.id;
  let flag='';if(r.storage<=0)flag='<span class="flag out"></span>';else if(r.storage<=r.low)flag='<span class="flag low"></span>';
  row.innerHTML=`
    <div class="row-main" onclick="toggleRow(this)">
      <div class="row-name">${flag}${esc(r.name)} <span class="sub">/ ${esc(r.unit)}</span></div>
      <div class="row-nums"><span class="n storage">${r.storage}</span></div>
      <button class="row-quick recv-q" onclick="event.stopPropagation();move('raw','${r.id}','receive')">Receive</button>
      <span class="chev">▶</span>
    </div>
    <div class="row-exp"><div class="row-exp-in">
      <div class="stage-counts">
        <div class="mini storage${ADMIN?' editable':''}" ${ADMIN?`onclick="editCount(event,'raw','${r.id}','storage')"`:''}><div class="l">Storage</div><div class="v">${r.storage}</div></div>
        <div class="mini waste${ADMIN?' editable':''}" ${ADMIN?`onclick="editCount(event,'raw','${r.id}','waste')"`:''}><div class="l">Waste</div><div class="v">${r.waste}</div></div>
      </div>
      <div class="actrow">
        <button class="btn receive" onclick="move('raw','${r.id}','receive')">＋ Receive</button>
        <button class="btn waste" onclick="move('raw','${r.id}','waste')">✕ Waste</button>
        ${ADMIN?`<button class="btn btn-ghost del-x" style="flex:0" onclick="delRaw('${r.id}')">Delete</button>`:''}
      </div>
    </div></div>`;
  return row;
}
/* --- PREP row --- */
function prepRow(p){
  const row=el('div','row');row.dataset.id=p.id;
  const makeable=prepMakeable(p);
  let flag='';if(p.prep<=0)flag='<span class="flag out"></span>';
  row.innerHTML=`
    <div class="row-main" onclick="toggleRow(this)">
      <div class="row-name">${flag}${esc(p.name)} <span class="sub">${esc(prepRecipeText(p))}</span></div>
      <div class="row-nums"><span class="n prep">${p.prep}</span></div>
      <button class="row-quick prep-q" onclick="event.stopPropagation();move('prep','${p.id}','prep')">Prep</button>
      <span class="chev">▶</span>
    </div>
    <div class="row-exp"><div class="row-exp-in">
      <div class="recipe-note">1 ${esc(p.name)} needs <b>${esc(prepRecipeText(p))}</b>. Can make <b>${makeable}</b> from current raw stock.</div>
      <div class="stage-counts">
        <div class="mini prep${ADMIN?' editable':''}" ${ADMIN?`onclick="editCount(event,'prep','${p.id}','prep')"`:''}><div class="l">In prep</div><div class="v">${p.prep}</div></div>
        <div class="mini waste${ADMIN?' editable':''}" ${ADMIN?`onclick="editCount(event,'prep','${p.id}','waste')"`:''}><div class="l">Waste</div><div class="v">${p.waste}</div></div>
      </div>
      <div class="actrow">
        <button class="btn prep" onclick="move('prep','${p.id}','prep')">→ Prep (make)</button>
        <button class="btn waste" onclick="move('prep','${p.id}','waste')">✕ Waste</button>
        ${ADMIN?`<button class="btn btn-ghost del-x" style="flex:0" onclick="delPrep('${p.id}')">Delete</button>`:''}
      </div>
    </div></div>`;
  return row;
}
/* --- DISH row --- */
function dishRow(d){
  const row=el('div','row');row.dataset.id=d.id;
  const cookable=dishCookable(d);
  row.innerHTML=`
    <div class="row-main" onclick="toggleRow(this)">
      <div class="row-name">${esc(d.name)} <span class="sub">${esc(dishRecipeText(d))}</span></div>
      <div class="row-nums"><span class="n used" style="font-size:11px;color:var(--ink-faint)">can cook ${cookable}</span></div>
      <button class="row-quick" onclick="event.stopPropagation();move('dish','${d.id}','used')">Cook</button>
      <span class="chev">▶</span>
    </div>
    <div class="row-exp"><div class="row-exp-in">
      <div class="recipe-note">1 ${esc(d.name)} uses <b>${esc(dishRecipeText(d))}</b>. Can cook <b>${cookable}</b> from current prep stock.</div>
      <div class="actrow">
        <button class="btn used" onclick="move('dish','${d.id}','used')">✓ Cook / Use</button>
        ${ADMIN?`<button class="btn btn-ghost del-x" style="flex:0" onclick="delDish('${d.id}')">Delete</button>`:''}
      </div>
    </div></div>`;
  return row;
}
function toggleRow(elm){elm.parentElement.classList.toggle('open');}

/* ---------- inline count editing (admin) ---------- */
function editCount(ev,kind,id,field){
  if(!ADMIN)return;ev.stopPropagation();
  const obj = kind==='raw'?rawById(id):prepById(id);
  const cur=obj[field];const cell=ev.currentTarget;const valEl=cell.querySelector('.v');
  const input=el('input','edit-input');input.type='number';input.value=cur;input.inputMode='numeric';
  valEl.innerHTML='';valEl.appendChild(input);input.focus();input.select();
  const commit=()=>{
    const nv=Math.max(0,parseInt(input.value)||0);
    if(nv!==cur){
      obj[field]=nv;
      addLog('adjust',`${obj.name} ${field} corrected ${cur} → ${nv} (admin)`,{kind,id,qty:nv});
      cacheLocal(); kind==='raw'?pushRaw(obj):pushPrep(obj);
      renderStock();renderReconcile();renderLog();toast(`${obj.name} ${field} set to ${nv}`);
    } else valEl.innerHTML=cur;
  };
  input.addEventListener('blur',commit);
  input.addEventListener('keydown',e=>{if(e.key==='Enter')input.blur();if(e.key==='Escape'){input.value=cur;input.blur();}});
}

/* ============================================================
   MOVE MODAL — receive / prep / cook / waste
   ============================================================ */
let pending=null, wasteStage='storage';
function move(kind,id,type){
  pending={kind,id,type};
  const obj = kind==='raw'?rawById(id): kind==='prep'?prepById(id): dishById(id);
  const titles={receive:'Receive stock',prep:'Prep (make)',used:'Cook / Use',waste:'Log wastage'};
  const subs={
    receive:'Checkpoint 1 — received from supplier, into storage.',
    prep:'Checkpoint 2 — make this prep item; raw ingredients are deducted.',
    used:'Checkpoint 3 — cook this dish to order; prep items are deducted.',
    waste:'Removed as waste. Kept separate from sales.'
  };
  $('#mm-title').textContent=titles[type]+' · '+obj.name;
  $('#mm-sub').textContent=subs[type];
  $('#mm-qty').value= type==='receive'?10:1;
  const quicks= type==='receive'?[6,10,20,50]:[1,2,5,10];
  const q=$('#mm-quick');q.innerHTML='';
  quicks.forEach(n=>{const b=el('button',null,'+'+n);b.onclick=()=>{$('#mm-qty').value=n;updateConsume();};q.appendChild(b);});
  $('#mm-confirm').textContent=titles[type];

  // waste stage picker (raw has storage; prep has prep-stock; both can also be wasted)
  const spWrap=$('#mm-stagepick-wrap');
  spWrap.style.display='none';
  if(type==='waste'){
    // raw waste comes from storage, prep waste from prep — single source, no picker needed
    wasteStage = kind==='raw'?'storage':'prep';
  }
  updateConsume();
  openModal('move-modal');
}
function stepQty(d){const i=$('#mm-qty');i.value=Math.max(1,(parseInt(i.value)||0)+d);updateConsume();}

/* live preview of what will be consumed (prep & cook) */
function updateConsume(){
  const box=$('#mm-consume');
  if(!pending){box.style.display='none';return;}
  const q=Math.max(1,parseInt($('#mm-qty').value)||0);
  if(pending.type==='prep'){
    const p=prepById(pending.id);
    let html='<div class="ttl">Will consume from raw stock</div>';
    for(const[rid,per] of Object.entries(p.recipe||{})){
      const r=rawById(rid);const need=per*q;const short=r?need>r.storage:true;
      html+=`<div>${need} ${r?esc(r.unit):''} ${r?esc(r.name):rid} <span style="color:var(--ink-faint)">(have ${r?r.storage:0})</span>${short?' <span class="short">short</span>':''}</div>`;
    }
    box.innerHTML=html;box.style.display='block';
  } else if(pending.type==='used'){
    const d=dishById(pending.id);
    let html='<div class="ttl">Will consume from prep stock</div>';
    for(const[pid,per] of Object.entries(d.recipe||{})){
      const p=prepById(pid);const need=per*q;const short=p?need>p.prep:true;
      html+=`<div>${need}× ${p?esc(p.name):pid} <span style="color:var(--ink-faint)">(have ${p?p.prep:0})</span>${short?' <span class="short">short</span>':''}</div>`;
    }
    box.innerHTML=html;box.style.display='block';
  } else box.style.display='none';
}

$('#mm-confirm').onclick=()=>{
  const q=Math.max(1,parseInt($('#mm-qty').value)||0);
  const {kind,id,type}=pending;

  if(kind==='raw'&&type==='receive'){
    const r=rawById(id);r.storage+=q;addLog('receive',`+${q} ${r.name} received into storage`,{kind:'raw',id,qty:q});
    cacheLocal();pushRaw(r);
  }
  else if(kind==='raw'&&type==='waste'){
    const r=rawById(id);if(r.storage<q){toast('Only '+r.storage+' in storage',true);return;}
    r.storage-=q;r.waste+=q;addLog('waste',`${q} ${r.name} wasted from storage`,{kind:'raw',id,qty:q});
    cacheLocal();pushRaw(r);
  }
  else if(kind==='prep'&&type==='prep'){
    const p=prepById(id);
    // check raw availability
    for(const[rid,per] of Object.entries(p.recipe||{})){const r=rawById(rid);if(!r||r.storage<per*q){toast(`Not enough ${r?r.name:'raw'} (need ${per*q})`,true);return;}}
    // deduct raws
    const consumed=[];
    for(const[rid,per] of Object.entries(p.recipe||{})){const r=rawById(rid);r.storage-=per*q;pushRaw(r);consumed.push(`${per*q} ${r.name}`);}
    p.prep+=q;pushPrep(p);
    addLog('prep',`${q} ${p.name} prepped (used ${consumed.join(', ')})`,{kind:'prep',id,qty:q});
    cacheLocal();
  }
  else if(kind==='prep'&&type==='waste'){
    const p=prepById(id);if(p.prep<q){toast('Only '+p.prep+' in prep',true);return;}
    p.prep-=q;p.waste+=q;addLog('waste',`${q} ${p.name} wasted from prep`,{kind:'prep',id,qty:q});
    cacheLocal();pushPrep(p);
  }
  else if(kind==='dish'&&type==='used'){
    const d=dishById(id);
    for(const[pid,per] of Object.entries(d.recipe||{})){const p=prepById(pid);if(!p||p.prep<per*q){toast(`Not enough ${p?p.name:'prep'} (need ${per*q})`,true);return;}}
    const consumed=[];
    for(const[pid,per] of Object.entries(d.recipe||{})){const p=prepById(pid);p.prep-=per*q;pushPrep(p);consumed.push(`${per*q} ${p.name}`);}
    addLog('used',`${q} ${d.name} cooked (used ${consumed.join(', ')})`,{kind:'dish',id,qty:q});
    cacheLocal();
  }
  renderStock();renderReconcile();renderLog();closeModal('move-modal');toast('Updated');
};

/* ============================================================
   RECONCILE — roll dish sales down to preps and raws
   ============================================================ */
function onDateChange(){selDate=$('#recon-date').value||todayKey();renderReconcile();}
function shiftDate(delta){const d=keyToDate(selDate);d.setDate(d.getDate()+delta);if(dateKey(d)>todayKey())return;selDate=dateKey(d);renderReconcile();}
function setToday(){selDate=todayKey();renderReconcile();}
function setReconLevel(lvl){reconLevel=lvl;$('#seg-prep').classList.toggle('on',lvl==='prep');$('#seg-raw').classList.toggle('on',lvl==='raw');$('#rh-name').textContent=lvl==='prep'?'Prep item':'Raw item';renderReconcile();}

/* daily logged usage, per kind+id, from the movement log */
function dayUsage(dayKey){
  const agg={prep:{},dish:{},raw:{}}; // agg[kind][id] = {receive,prep,used,waste}
  const bump=(kind,id,type,qty)=>{const b=(agg[kind][id]=agg[kind][id]||{receive:0,prep:0,used:0,waste:0});if(b[type]!==undefined)b[type]+=qty;};
  log.forEach(e=>{
    if(!e.iso||isoDateKey(e.iso)!==dayKey)return;
    const {kind,id,qty}=resolveMovement(e);
    if(!kind||!id||!qty)return;
    bump(kind,id,e.type,qty);
  });
  return agg;
}
/* fallback parse for legacy rows without structured fields */
function resolveMovement(e){
  let kind=e.kind,id=e.id,qty=e.qty;
  if(qty==null){const m=(e.msg||'').match(/-?\d+/);if(m)qty=Math.abs(parseInt(m[0],10));}
  if(!id&&e.msg){
    const hay=e.msg.toLowerCase();
    const all=[...raws.map(x=>['raw',x]),...preps.map(x=>['prep',x]),...dishes.map(x=>['dish',x])];
    const hit=all.filter(([k,x])=>hay.includes(x.name.toLowerCase())).sort((a,b)=>b[1].name.length-a[1].name.length)[0];
    if(hit){kind=hit[0];id=hit[1].id;}
  }
  return {kind,id,qty};
}

/* expand dish sales into expected prep + raw consumption */
function expectedFromSales(daySales){
  const prepExp={}, rawExp={};
  for(const[did,sold] of Object.entries(daySales||{})){
    const d=dishById(did);if(!d||!sold)continue;
    for(const[pid,per] of Object.entries(d.recipe||{})){
      prepExp[pid]=(prepExp[pid]||0)+per*sold;
      const p=prepById(pid);
      if(p) for(const[rid,rper] of Object.entries(p.recipe||{})) rawExp[rid]=(rawExp[rid]||0)+rper*per*sold;
    }
  }
  return {prepExp,rawExp};
}

function renderReconcile(){
  const di=$('#recon-date');if(di)di.value=selDate;
  const dl=$('#day-label');if(dl)dl.textContent='· '+prettyDate(selDate);

  // sales inputs
  const daySales=sales[selDate]||{};
  const si=$('#sales-inputs');si.innerHTML='';
  if(!dishes.length){si.innerHTML='<div class="muted">Add dishes under Recipes first.</div>';}
  dishes.forEach(d=>{
    const row=el('div','recon-row');
    row.innerHTML=`<div class="recon-name">${esc(d.name)}<small>${esc(dishRecipeText(d))}</small></div>`;
    const inp=el('input','sales-in');inp.type='number';inp.inputMode='numeric';inp.value=daySales[d.id]||0;inp.min=0;
    inp.oninput=()=>{(sales[selDate]=sales[selDate]||{})[d.id]=Math.max(0,parseInt(inp.value)||0);cacheLocal();pushSale(selDate,d.id,sales[selDate][d.id]);computeRecon();};
    const cell=el('div');cell.style.gridColumn='2 / span 3';cell.style.textAlign='right';cell.appendChild(inp);
    row.appendChild(cell);si.appendChild(row);
  });
  computeRecon();
}

function computeRecon(){
  const daySales=sales[selDate]||{};
  const agg=dayUsage(selDate);
  const {prepExp,rawExp}=expectedFromSales(daySales);
  const rr=$('#recon-rows');rr.innerHTML='';
  let allMatch=true,totalSold=0,totalExp=0;
  dishes.forEach(d=>totalSold+=daySales[d.id]||0);

  if(reconLevel==='prep'){
    $('#rh-name').textContent='Prep item';
    $('#recon-hint').textContent='Expected = prep items implied by dish sales. Used = prep items consumed by cooking that day. Diff ≠ 0 means cooking didn\'t match sales.';
    preps.forEach(p=>{
      const exp=prepExp[p.id]||0;
      const used=(agg.dish, sumPrepUsedByCooking(agg,p.id)); // prep consumed by dishes cooked
      if(exp===0&&used===0)return;
      totalExp+=exp;const diff=used-exp;if(diff!==0)allMatch=false;
      rr.appendChild(reconRow(p.name, wasteNote('prep',p.id,agg), exp, used, diff));
    });
  } else {
    $('#rh-name').textContent='Raw item';
    $('#recon-hint').textContent='Expected = raw items implied by dish sales (rolled through prep recipes). Used = raw consumed by prepping that day. This is where "2 dishes but 20 raw eggs" shows up.';
    raws.forEach(r=>{
      const exp=rawExp[r.id]||0;
      const used=sumRawUsedByPrepping(agg,r.id);
      if(exp===0&&used===0)return;
      totalExp+=exp;const diff=used-exp;if(diff!==0)allMatch=false;
      rr.appendChild(reconRow(r.name, wasteNote('raw',r.id,agg), exp, used, diff));
    });
  }
  if(!rr.children.length)rr.appendChild(el('div','muted','No sales or usage recorded for this day yet.'));

  const sm=$('#recon-summary');sm.innerHTML='';
  sm.appendChild(el('div','sum',`<div class="k">Dishes sold ${prettyDate(selDate)}</div><div class="v">${totalSold}</div>`));
  const matched=allMatch&&totalExp>0;const cls=totalExp===0?'':(matched?'match':'miss');const txt=totalExp===0?'—':(matched?'Tallied':'Mismatch');
  sm.appendChild(el('div','sum '+cls,`<div class="k">${reconLevel==='prep'?'Prep':'Raw'} tally</div><div class="v">${txt}</div>`));
}
function reconRow(name,note,exp,used,diff){
  const row=el('div','recon-row');
  row.innerHTML=`<div class="recon-name">${esc(name)}${note?`<small>${esc(note)}</small>`:''}</div>
    <div class="pill inv">${exp}</div><div class="pill pos">${used}</div>
    <div class="pill diff ${diff===0?'ok':'bad'}">${diff>0?'+':''}${diff}</div>`;
  return row;
}
function wasteNote(kind,id,agg){const a=agg[kind][id];return a&&a.waste?a.waste+' wasted today':'';}
/* prep units consumed by dishes cooked that day = sum over dishes(usedCount * recipe[prepId]) */
function sumPrepUsedByCooking(agg,prepId){
  let t=0;
  for(const[did,a] of Object.entries(agg.dish)){const d=dishById(did);if(!d)continue;const per=d.recipe[prepId]||0;t+=per*(a.used||0);}
  return t;
}
/* raw units consumed by prepping that day = sum over preps(prepMadeCount * recipe[rawId]) */
function sumRawUsedByPrepping(agg,rawId){
  let t=0;
  for(const[pid,a] of Object.entries(agg.prep)){const p=prepById(pid);if(!p)continue;const per=p.recipe[rawId]||0;t+=per*(a.prep||0);}
  return t;
}

/* ============================================================
   RECIPES TAB
   ============================================================ */
function renderRecipes(){
  const pw=$('#prep-recipe-list');pw.innerHTML='';
  if(!preps.length)pw.innerHTML='<div class="muted">No prep items yet.</div>';
  preps.forEach(p=>{
    const d=el('div','recipe-item');
    d.innerHTML=`<div class="rn">${esc(p.name)}<span style="font-size:12px;color:var(--ink-faint);cursor:pointer" onclick="editPrep('${p.id}')">edit</span></div>
      <div class="ri">↳ ${esc(prepRecipeText(p))||'<span style="color:var(--waste)">no ingredients set</span>'}</div>`;
    pw.appendChild(d);
  });
  const dw=$('#dish-recipe-list');dw.innerHTML='';
  if(!dishes.length)dw.innerHTML='<div class="muted">No dishes yet.</div>';
  dishes.forEach(dd=>{
    const d=el('div','recipe-item');
    d.innerHTML=`<div class="rn">${esc(dd.name)}<span style="font-size:12px;color:var(--ink-faint);cursor:pointer" onclick="editDish('${dd.id}')">edit</span></div>
      <div class="ri">↳ ${esc(dishRecipeText(dd))||'<span style="color:var(--waste)">no ingredients set</span>'}</div>`;
    dw.appendChild(d);
  });
}

/* ---- ingredient picker (shared by prep & dish modals) ---- */
function ingOptions(kind){ // kind 'raw' for prep-editor, 'prep' for dish-editor
  const list = kind==='raw'?raws:preps;
  return list.map(x=>`<option value="${x.id}">${esc(x.name)}${kind==='raw'?' ('+esc(x.unit)+')':''}</option>`).join('');
}
function addIngLine(which,rid,qty){
  const box=$(which==='prep'?'#prep-ings':'#dish-ings');
  const kind=which==='prep'?'raw':'prep';
  const line=el('div','ing-line');
  line.innerHTML=`<select>${ingOptions(kind)}</select><input type="number" min="0" step="any" value="${qty!=null?qty:1}" inputmode="decimal"><button class="rm" onclick="this.parentElement.remove()">×</button>`;
  if(rid) line.querySelector('select').value=rid;
  box.appendChild(line);
}
function collectIngs(which){
  const box=$(which==='prep'?'#prep-ings':'#dish-ings');
  const recipe={};
  box.querySelectorAll('.ing-line').forEach(l=>{
    const id=l.querySelector('select').value;const q=parseFloat(l.querySelector('input').value)||0;
    if(id&&q>0)recipe[id]=q;
  });
  return recipe;
}

/* ---- prep modal ---- */
let editingPrepId=null;
function openPrepModal(){editingPrepId=null;$('#prep-modal-title').textContent='Add prep item';$('#prep-name').value='';$('#prep-ings').innerHTML='';addIngLine('prep');openModal('prep-modal');}
function editPrep(id){const p=prepById(id);editingPrepId=id;$('#prep-modal-title').textContent='Edit prep item';$('#prep-name').value=p.name;$('#prep-ings').innerHTML='';const ents=Object.entries(p.recipe||{});if(ents.length)ents.forEach(([rid,q])=>addIngLine('prep',rid,q));else addIngLine('prep');openModal('prep-modal');}
function savePrep(){
  const name=$('#prep-name').value.trim();if(!name){toast('Name required',true);return;}
  const recipe=collectIngs('prep');if(!Object.keys(recipe).length){toast('Add at least one raw ingredient',true);return;}
  if(editingPrepId){const p=prepById(editingPrepId);p.name=name;p.recipe=recipe;pushPrep(p);}
  else{const p={id:slug(name),name,recipe,prep:0,waste:0};preps.push(p);pushPrep(p);}
  cacheLocal();renderRecipes();renderStock();renderReconcile();closeModal('prep-modal');toast('Prep item saved');
}
function delPrep(id){
  const p=prepById(id);if(!confirm(`Delete prep item "${p.name}"? It will be removed from any dish recipes.`))return;
  preps=preps.filter(x=>x.id!==id);
  dishes.forEach(d=>{if(d.recipe[id]){delete d.recipe[id];pushDish(d);}});
  cacheLocal();delPrepCloud(id);renderStock();renderRecipes();renderReconcile();toast(p.name+' deleted');
}

/* ---- dish modal ---- */
let editingDishId=null;
function openDishModal(){editingDishId=null;$('#dish-modal-title').textContent='Add dish';$('#dish-name').value='';$('#dish-ings').innerHTML='';addIngLine('dish');openModal('dish-modal');}
function editDish(id){const d=dishById(id);editingDishId=id;$('#dish-modal-title').textContent='Edit dish';$('#dish-name').value=d.name;$('#dish-ings').innerHTML='';const ents=Object.entries(d.recipe||{});if(ents.length)ents.forEach(([pid,q])=>addIngLine('dish',pid,q));else addIngLine('dish');openModal('dish-modal');}
function saveDish(){
  const name=$('#dish-name').value.trim();if(!name){toast('Name required',true);return;}
  const recipe=collectIngs('dish');if(!Object.keys(recipe).length){toast('Add at least one prep ingredient',true);return;}
  if(editingDishId){const d=dishById(editingDishId);d.name=name;d.recipe=recipe;pushDish(d);}
  else{const d={id:slug(name),name,recipe};dishes.push(d);pushDish(d);}
  cacheLocal();renderRecipes();renderStock();renderReconcile();closeModal('dish-modal');toast('Dish saved');
}
function delDish(id){
  const d=dishById(id);if(!confirm(`Delete dish "${d.name}"?`))return;
  dishes=dishes.filter(x=>x.id!==id);Object.keys(sales).forEach(dt=>{if(sales[dt])delete sales[dt][id];});
  cacheLocal();delDishCloud(id);renderStock();renderRecipes();renderReconcile();toast(d.name+' deleted');
}

/* ---- raw modal ---- */
function openRawModal(){$('#raw-modal-title').textContent='Add raw item';$('#raw-name').value='';$('#raw-unit').value='';$('#raw-low').value=5;openModal('raw-modal');}
function saveRaw(){
  const name=$('#raw-name').value.trim(),unit=$('#raw-unit').value.trim()||'unit';
  if(!name){toast('Name required',true);return;}
  const r={id:slug(name),name,unit,low:parseInt($('#raw-low').value)||5,storage:0,waste:0};
  raws.push(r);cacheLocal();pushRaw(r);renderStock();closeModal('raw-modal');toast(name+' added');
}
function delRaw(id){
  const r=rawById(id);if(!confirm(`Delete raw item "${r.name}"? It will be removed from any prep recipes.`))return;
  raws=raws.filter(x=>x.id!==id);
  preps.forEach(p=>{if(p.recipe[id]){delete p.recipe[id];pushPrep(p);}});
  cacheLocal();delRawCloud(id);renderStock();renderRecipes();renderReconcile();toast(r.name+' deleted');
}

/* ============================================================
   LOG
   ============================================================ */
function renderLog(){
  const w=$('#log-list');w.innerHTML='';
  $('#log-count').textContent=log.length?log.length+' movements recorded':'No movements yet';
  if(!log.length){w.innerHTML='<div class="muted">Movements appear here as you receive, prep, cook and waste stock. Counts run continuously.</div>';return;}
  let lastDay=null;
  log.slice(0,200).forEach(l=>{
    const day=l.iso?isoDateKey(l.iso):todayKey();
    if(day!==lastDay){lastDay=day;const h=el('div',null,prettyDate(day));h.style.cssText='font-family:Cormorant Garamond,serif;color:var(--gold-soft);font-size:16px;font-weight:600;margin:14px 0 4px;padding-bottom:4px;border-bottom:1px solid var(--line)';w.appendChild(h);}
    const r=el('div','logrow');r.innerHTML=`<span class="t">${l.t||''}</span><span class="m">${esc(l.msg)}</span><span class="tag ${l.type}">${l.type}</span>`;w.appendChild(r);
  });
}

/* ============================================================
   CSV EXPORT
   ============================================================ */
function csvCell(v){if(v==null)v='';v=String(v);if(/[",\n\r]/.test(v))v='"'+v.replace(/"/g,'""')+'"';return v;}
function downloadCSV(fn,rows){const csv='\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');const b=new Blob([csv],{type:'text/csv;charset=utf-8;'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(u);},100);toast('Exported '+fn);}

function exportStock(){
  const rows=[['Stage','Item','Unit/Recipe','Storage','Prep','Waste']];
  raws.forEach(r=>rows.push(['Raw',r.name,r.unit,r.storage,'',r.waste]));
  preps.forEach(p=>rows.push(['Prep',p.name,prepRecipeText(p),'',p.prep,p.waste]));
  dishes.forEach(d=>rows.push(['Dish',d.name,dishRecipeText(d),'','','']));
  downloadCSV(`alcea-stock-${todayKey()}.csv`,rows);
}
function inRange(day,from,to){if(from&&day<from)return false;if(to&&day>to)return false;return true;}
function exportLog(){
  const from=$('#log-from').value||'',to=$('#log-to').value||'';
  const rows=[['Date','Time','Type','Stage','Item','Qty','Detail']];
  const ordered=[...log].filter(l=>inRange(l.iso?isoDateKey(l.iso):todayKey(),from,to)).sort((a,b)=>(a.iso||'').localeCompare(b.iso||''));
  if(!ordered.length){toast('No movements in that range',true);return;}
  ordered.forEach(l=>{
    const {kind,id}=resolveMovement(l);
    const obj=kind==='raw'?rawById(id):kind==='prep'?prepById(id):kind==='dish'?dishById(id):null;
    rows.push([l.iso?isoDateKey(l.iso):'',l.t||'',l.type,kind||'',obj?obj.name:(id||''),l.qty!=null?l.qty:'',l.msg]);
  });
  const tag=from||to?`${from||'start'}_to_${to||'now'}`:'all';
  downloadCSV(`alcea-log-${tag}.csv`,rows);
}
function exportUsageSummary(){
  const from=$('#log-from').value||'',to=$('#log-to').value||'';
  const perDay={};
  log.forEach(e=>{
    if(!e.iso)return;const day=isoDateKey(e.iso);if(!inRange(day,from,to))return;
    const {kind,id,qty}=resolveMovement(e);if(!kind||!id||!qty)return;
    ((perDay[day]=perDay[day]||{})[kind+':'+id]=perDay[day][kind+':'+id]||{receive:0,prep:0,used:0,waste:0})[e.type]!==undefined&&(perDay[day][kind+':'+id][e.type]+=qty);
  });
  const days=Object.keys(perDay).sort();
  if(!days.length){toast('No usage in that range',true);return;}
  const rows=[['Date','Stage','Item','Received','Prepped','Cooked','Wasted']];
  days.forEach(day=>{
    Object.entries(perDay[day]).forEach(([key,a])=>{
      const[kind,id]=key.split(':');const obj=kind==='raw'?rawById(id):kind==='prep'?prepById(id):dishById(id);
      rows.push([day,kind,obj?obj.name:id,a.receive,a.prep,a.used,a.waste]);
    });
  });
  const tag=from||to?`${from||'start'}_to_${to||'now'}`:'all';
  downloadCSV(`alcea-usage-${tag}.csv`,rows);
}

/* ============================================================
   ADMIN / PIN
   ============================================================ */
let pinBuf='';const IDLE_MS=5*60*1000;let idleTimer=null;
function toggleAdmin(){if(ADMIN)openModal('admin-modal');else openPin();}
function openPin(){pinBuf='';renderPinDots();openModal('pin-modal');}
function pinPress(n){if(pinBuf.length>=4)return;pinBuf+=n;renderPinDots();if(pinBuf.length===4)setTimeout(checkPin,120);}
function pinBack(){pinBuf=pinBuf.slice(0,-1);renderPinDots();}
function renderPinDots(err){document.querySelectorAll('#pin-dots .pin-dot').forEach((d,i)=>{d.className='pin-dot'+(i<pinBuf.length?' filled':'')+(err?' err':'');});}
function checkPin(){if(pinBuf===String(settings.pin)){unlockAdmin();closeModal('pin-modal');toast('Admin unlocked');}else{renderPinDots(true);toast('Wrong PIN',true);setTimeout(()=>{pinBuf='';renderPinDots();},400);}}
function unlockAdmin(){ADMIN=true;document.body.classList.add('admin');$('#brand-sub').textContent='ADMIN';$('#fab').style.display='flex';bumpIdle();renderStock();renderReconcile();}
function lockAdmin(){ADMIN=false;document.body.classList.remove('admin');$('#brand-sub').textContent='INVENTORY';$('#fab').style.display='none';$('#fab-menu').classList.remove('open');closeModal('admin-modal');const active=document.querySelector('.view.active');if(active&&active.id!=='view-stock')switchTab('stock');renderStock();toast('Admin locked');}
function changePin(){const v=$('#new-pin').value.trim();if(!/^\d{4}$/.test(v)){toast('PIN must be 4 digits',true);return;}settings.pin=v;cacheLocal();pushSettings();$('#new-pin').value='';toast('PIN updated');}
function bumpIdle(){if(!ADMIN)return;clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(ADMIN)lockAdmin();},IDLE_MS);}
['click','keydown','touchstart'].forEach(ev=>document.addEventListener(ev,bumpIdle,{passive:true}));
function factoryReset(){if(!ADMIN)return;if(!confirm('Factory reset THIS DEVICE?\n\nClears the local copy on this device and reloads. Cloud data in Supabase is NOT touched.\n\nContinue?'))return;if(!confirm('Are you sure? This cannot be undone on this device.'))return;try{['raws','preps','dishes','log','sales','settings'].forEach(k=>localStorage.removeItem('alcea_'+k));}catch(e){}toast('Local data cleared — reloading');setTimeout(()=>location.reload(),700);}

function toggleFab(){$('#fab-menu').classList.toggle('open');}

/* ============================================================
   UTIL / TABS / INIT
   ============================================================ */
function openModal(id){$('#'+id).classList.add('open');}
function closeModal(id){$('#'+id).classList.remove('open');}
document.querySelectorAll('.modal-bg').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open');}));
function switchTab(view){const tab=document.querySelector(`.tab[data-view="${view}"]`);if(tab&&tab.classList.contains('admin-only')&&!ADMIN){openPin();return;}document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));if(tab)tab.classList.add('active');$('#view-'+view).classList.add('active');}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.view));

function renderAll(){renderStock();renderReconcile();renderRecipes();renderLog();}
setStatus(CLOUD?'offline':'local');
renderAll();
if(CLOUD)cloudPullAll().then(subscribeRealtime);

/* PWA service worker */
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{});});}
