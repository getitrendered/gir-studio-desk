/* GIR Studio Desk: renderer state, sheet interaction, and Supabase sync. */
const $ = s => document.querySelector(s);
const uid = () => crypto.randomUUID();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmtDate = d => { if (!d) return '—'; const x = new Date(d + 'T00:00:00'); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); };
const defaults = { clients:[], groups:[], projectGroups:[], items:[], invoices:[], receipts:[], members:[], pending:[], settings:{ seller:{ name:'GIR — Get It Rendered', address:'', email:'', phone:'', taxId:'', bankDetails:'', logoData:'' }, url:'https://isdxybpeagloikchhsbp.supabase.co', key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzZHh5YnBlYWdsb2lrY2hoc2JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NzkzMjcsImV4cCI6MjEwODE1NTMyN30.ll1YG9uyrTqmLzE90miCk-O1Ab5VkBPfqrCPDDUc5u8', workspaceId:'', displayName:'Samuel', localPartner:'Mezrid', zoom:100 } };
const GIR_WORKSPACE_ID='17f39873-e10f-4bdf-93ee-1f92b3e25251';
let data = structuredClone(defaults), tab = 'sheet', lastRenderedTab = null, lastRenderedClient = null, activeClient = null, selected = new Set(), selectionAnchor = null, selectionCell = null, collapsedGroups = new Set(), blankRows = 60, highlightUser = null, filter = 'all', clientApi = null, session = null, channel = null, syncing = false, toastTimer, syncTimer, lastSyncTime = Date.now(), importPreview = null, previewClientIndex = 0, migrating = false;
let authLoading=true,workspaceReady=false,workspaceResolving=false,accessMode='signin',accessError='',activeStatusMenu=null;
let desktopUpdate = { status: 'unavailable', message: 'Checking update support…' };

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000); }
function save() { window.desk.write(data).catch(e => toast('Could not save locally: ' + e.message)); }
function enqueue(table,id) { const key=table+':'+id; if(!data.pending.some(p=>p.key===key))data.pending.push({key,table,id}); }
function scheduleSync(){if(!clientApi||!session||!data.settings.workspaceId)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>flushPending().catch(e=>toast('Sync waiting: '+e.message)),400);}
function queue(table, id) { enqueue(table,id); save(); scheduleSync(); }
function mutate(table, record) { record.updatedAt = new Date().toISOString(); const list = data[table]; const ix = list.findIndex(x => x.id === record.id); if (ix < 0) list.push(record); else list[ix] = record; queue(table, record.id); render(); }
function currentClient() { return data.clients.find(c => c.id === activeClient); }
function clientItems(id = activeClient) { return data.items.filter(i => i.clientId === id).sort((a,b) => a.sortOrder - b.sortOrder); }
function displayStatus(i) { return i.status === 'changes' ? 'Changes' : i.status[0].toUpperCase() + i.status.slice(1); }
function currentUserId() { return session?.user?.id || 'local-me'; }
function person(id) { return data.members.find(m => m.userId === id)?.displayName || (id === 'local-me' ? data.settings.displayName : id === 'local-partner' ? data.settings.localPartner : 'Team member'); }
function initials(name) { return String(name || '?').split(/\s+/).map(s => s[0]).join('').slice(0,2).toUpperCase(); }
function unfinishedCount(clientId) { return data.items.filter(i=>i.clientId===clientId && !['sent','paid','discarded'].includes(i.status)).length; }
function clientActivity(clientId) {
  const items = data.items.filter(i => i.clientId === clientId);
  const pending = items.filter(i => ['pending', 'working', 'changes'].includes(i.status)).length;
  const sent = items.filter(i => i.status === 'sent').length;
  return { pending, sent, active: pending + sent };
}
function sortedClients() {
  return [...data.clients].sort((a, b) => {
    const actA = clientActivity(a.id);
    const actB = clientActivity(b.id);
    if (actA.pending !== actB.pending) return actB.pending - actA.pending;
    if (actA.sent !== actB.sent) return actB.sent - actA.sent;
    return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name);
  });
}
function selectionLabel(){const total=data.items.filter(i=>selected.has(i.id)).reduce((sum,i)=>sum+num(i.quotedTotal),0);return selected.size?`${selected.size} selected · Total ${money(total)}`:'0 selected';}
function avatar(id,name,size='') { const src=data.members.find(m=>m.userId===id)?.avatarData || (id===currentUserId()?data.settings.avatarData:''); return src&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(src)?`<img class="avatar-image ${size}" src="${esc(src)}" alt="${esc(name)}">`:`<span>${esc(initials(name))}</span>`; }
function billedIds() { return new Set(data.invoices.flatMap(inv => inv.itemIds || [])); }
function receiptEffectiveItem(r) {
  if (r.referenceKind === 'item' && r.referenceId) return data.items.find(i => i.id === r.referenceId) || null;
  if (r.source === 'app' && r.sourceKey && r.sourceKey.startsWith('app:')) {
    const id = r.sourceKey.slice(4);
    return data.items.find(i => i.id === id) || null;
  }
  return null;
}
function receiptEffectiveAmount(r) {
  const item = receiptEffectiveItem(r);
  if (item) {
    if (item.status !== 'paid') return 0;
    return Math.max(0, effectiveItemValue(item) - num(item.advanceAmount));
  }
  if (r.referenceKind === 'invoice' && r.referenceId) {
    const inv = data.invoices.find(x => x.id === r.referenceId);
    if (inv) {
      if (inv.status !== 'paid') return 0;
      return Math.max(0, num(inv.finalAmount) - invoiceAdvance(inv));
    }
  }
  if (r.referenceKind === 'deal' && r.referenceId) {
    const g = data.groups.find(x => x.id === r.referenceId);
    const dealItems = data.items.filter(i => i.groupId === r.referenceId && i.status !== 'discarded');
    if (dealItems.length && dealItems.every(i => i.status === 'paid')) {
      const total = dealItems.reduce((sum, i) => sum + num(i.quotedTotal), 0);
      const agreed = g && g.agreedAmount != null && g.agreedAmount !== '' ? num(g.agreedAmount) : total;
      const advances = dealItems.reduce((sum, i) => sum + num(i.advanceAmount), 0);
      return Math.max(0, agreed - advances);
    }
  }
  return num(r.amount);
}
function receiptEffectiveDescription(r) {
  const item = receiptEffectiveItem(r);
  if (item) return item.service || r.description || 'Payment';
  if (r.referenceKind === 'invoice' && r.referenceId) {
    const inv = data.invoices.find(x => x.id === r.referenceId);
    if (inv) return `Invoice ${inv.number}`;
  }
  return r.description || (r.source === 'historical_workbook' ? 'Historical payment' : 'Payment');
}
function receiptEffectiveClientName(r) {
  const item = receiptEffectiveItem(r);
  if (item) {
    const client = data.clients.find(c => c.id === item.clientId);
    if (client?.name) return client.name;
  }
  return r.clientName || 'Client';
}
function financials() {
  const billed = billedIds(), amount = { revenue:0, awaiting:0, estimated:0, quoted:0, advances:0, openAdvances:0, discarded:0, closed:0, months:{}, sentItems:[], outstandingItems:[] };
  const month = (date,field,value) => { if(!value)return;const key=/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date||'')?date.slice(0,7):'Date unknown'; const m=amount.months[key] ||= {received:0,closed:0,advances:0,discarded:0};m[field]+=value; };
  const invoiceAdvanceMonths = (inv,advance,open) => { let remaining=advance;for(const id of inv.itemIds||[]){const item=data.items.find(i=>i.id===id);if(!item||remaining<=0)continue;const part=Math.min(remaining,Math.max(0,num(item.advanceAmount)));month(item.advanceReceivedAt,'received',part);if(open)month(item.advanceReceivedAt,'advances',part);remaining-=part;}month(null,'received',remaining);if(open)month(null,'advances',remaining); };
  for (const inv of data.invoices) {
    const value=Math.max(0,num(inv.finalAmount)), advance=Math.min(value,Math.max(0,invoiceAdvance(inv))),due=Math.max(0,value-advance);
    invoiceAdvanceMonths(inv,advance,inv.status!=='paid');
    if(inv.status==='paid'){amount.revenue+=value;amount.closed+=value;month(inv.paidAt,'received',due);month(inv.paidAt,'closed',value);}
    else {amount.revenue+=advance;amount.openAdvances+=advance;amount.awaiting+=due;amount.estimated+=due;if(due>0)amount.outstandingItems.push({clientId:inv.clientId,itemIds:inv.itemIds||[],balance:due,status:'invoiced'});}
  }
  for (const i of data.items) {
    if (i.status === 'discarded') { amount.discarded+=num(i.quotedTotal);month(null,'discarded',num(i.quotedTotal));continue; }
    amount.quoted += num(i.quotedTotal);
    amount.advances += num(i.advanceAmount);
  }
  const groups = new Map(data.groups.map(g => [g.id,g]));
  const groupTotals = new Map();
  for (const i of data.items) if (i.status !== 'discarded' && i.groupId && groups.has(i.groupId)) groupTotals.set(i.groupId, (groupTotals.get(i.groupId) || 0) + num(i.quotedTotal));
  for (const i of data.items) {
    if (billed.has(i.id) || i.status === 'discarded') continue;
    const g = groups.get(i.groupId), total = groupTotals.get(i.groupId) || 0;
    const value = g && g.agreedAmount !== null && g.agreedAmount !== '' && total > 0 ? num(g.agreedAmount) * num(i.quotedTotal) / total : num(i.quotedTotal);
    const advance=Math.min(Math.max(0,num(i.advanceAmount)),Math.max(0,value));
    if(i.status==='paid'){amount.revenue+=value;amount.closed+=value;month(i.advanceReceivedAt,'received',advance);month(i.paidAt,'received',Math.max(0,value-advance));month(i.paidAt,'closed',value);}
    else {const due=Math.max(0,value-advance);amount.revenue+=advance;amount.openAdvances+=advance;amount.estimated+=due;if(due>0)amount.outstandingItems.push({clientId:i.clientId,itemIds:[i.id],balance:due,status:i.status});if(i.status==='sent'){amount.awaiting+=due;amount.sentItems.push({id:i.id,clientId:i.clientId,balance:due});}month(i.advanceReceivedAt,'received',advance);month(i.advanceReceivedAt,'advances',advance);}
  }
  if (Array.isArray(data.receipts) && data.receipts.length) {
    amount.revenue=0;
    amount.months={};
    for(const receipt of data.receipts){
      const val=typeof receiptEffectiveAmount==='function'?receiptEffectiveAmount(receipt):num(receipt.amount);
      const itm=typeof receiptEffectiveItem==='function'?receiptEffectiveItem(receipt):null;
      if(val<=0&&itm&&itm.status!=='paid')continue;
      amount.revenue+=val;
      month(receipt.receivedMonth,'received',val);
    }
  }
  return amount;
}
function counts() { const all = data.items.filter(i=>i.status!=='discarded'), todayValue = today(); return { total:all.length, discarded:data.items.length-all.length, done:all.filter(i => ['sent','paid'].includes(i.status)).length, working:all.filter(i => ['working','changes'].includes(i.status)).length, pending:all.filter(i => i.status === 'pending').length, overdue:all.filter(i => i.dueDate && i.dueDate < todayValue && !['sent','paid'].includes(i.status)).length }; }
function render() {
  closeStatusMenu();
  const main=$('#main'), sameSheet=tab==='sheet'&&lastRenderedTab==='sheet'&&lastRenderedClient===activeClient;
  const scroll=sameSheet?{main:main.scrollTop,grid:main.querySelector('.sheet-viewport')?.scrollTop||0,across:main.querySelector('.sheet-viewport')?.scrollLeft||0}:null;
  document.documentElement.style.setProperty('--grid-size', Math.round(12 * data.settings.zoom / 100) + 'px');
  document.documentElement.style.setProperty('--grid-height', Math.round(29 * data.settings.zoom / 100) + 'px');
  if(authLoading||!session||!workspaceReady||data.settings.workspaceId!==GIR_WORKSPACE_ID){
    $('#app').classList.remove('sheet-mode');$('#app').classList.add('access-mode');
    const tabsH=$('#tabsHeader')||$('#tabs');if(tabsH)tabsH.hidden=true;$('.client-tabs').hidden=true;main.innerHTML=renderAccess();bindAccess();return;
  }
  $('#app').classList.remove('access-mode');const tabsH=$('#tabsHeader')||$('#tabs');if(tabsH)tabsH.hidden=false;$('.client-tabs').hidden=false;
  $('#app').classList.toggle('sheet-mode',tab==='sheet');
  const live = !!(clientApi && session && data.settings.workspaceId);
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderClients();
  main.innerHTML = ({ dashboard:renderDashboard, sheet:renderSheet, tracker:renderTracker, groups:renderGroups, revenue:renderRevenue, payments:renderPayments, invoices:renderInvoices, 'client-details':renderClientDetails, settings:renderSettings, 'import-preview':renderImportPreview }[tab] || renderSheet)();
  if(scroll){main.scrollTop=scroll.main;const grid=main.querySelector('.sheet-viewport');if(grid){grid.scrollTop=scroll.grid;grid.scrollLeft=scroll.across;}}
  const indicator = $('#tabIndicator'), active = $(`#tabs button[data-tab="${tab}"]`);
  requestAnimationFrame(() => { indicator.style.opacity = active ? '1' : '0'; if (active) { indicator.style.left = active.offsetLeft + 'px'; indicator.style.width = active.offsetWidth + 'px'; } });
  if (lastRenderedTab !== tab) { const order = ['sheet','dashboard','tracker','groups','revenue','payments','invoices','client-details','settings']; const direction = order.indexOf(tab) >= order.indexOf(lastRenderedTab) ? 'tab-next' : 'tab-prev'; $('#main').classList.remove('tab-next','tab-prev'); void $('#main').offsetWidth; $('#main').classList.add(direction); lastRenderedTab = tab; }
  if(tab==='settings')showUpdateState(desktopUpdate);
  lastRenderedClient=activeClient;bindMain();updateSyncUI();
}
function $$(s) { return [...document.querySelectorAll(s)]; }
function renderAccess(){
  const busy=authLoading||(!workspaceReady&&!!session);
  const joining=!!session&&workspaceReady&&data.settings.workspaceId!==GIR_WORKSPACE_ID;
  const heading=busy?'Connecting to GIR Studio':joining?'Join GIR workspace':accessMode==='signup'?'Create your account':'Welcome to GIR Studio';
  const body=busy?'<p>Checking your account and workspace…</p>':joining?`<p>Enter the GIR workspace code to access the existing clients and work.</p><form id="joinForm"><label>Workspace code<input id="accessCode" autocomplete="off" spellcheck="false" required placeholder="12-character code"></label><button type="submit" class="access-primary">Join workspace</button></form><p class="access-note">Signed in as ${esc(session.user.email)}</p><button class="access-link" id="accessSignOut">Use another account</button>`:accessMode==='signup'?`<p>Create your personal account. After email confirmation, sign in and enter the GIR workspace code.</p><form id="signupForm"><label>Your name<input id="accessName" autocomplete="name" required placeholder="Your name"></label><label>Email<input id="accessEmail" type="email" autocomplete="email" required></label><label>Password<input id="accessPassword" type="password" autocomplete="new-password" minlength="6" required></label><label>Confirm password<input id="accessConfirm" type="password" autocomplete="new-password" minlength="6" required></label><button type="submit" class="access-primary">Create account</button></form><button class="access-link" id="accessSwitch">Already have an account? Sign in</button>`:`<p>Sign in to continue to your shared worksheet.</p><form id="signinForm"><label>Email<input id="accessEmail" type="email" autocomplete="email" required></label><label>Password<input id="accessPassword" type="password" autocomplete="current-password" required></label><button type="submit" class="access-primary">Sign in</button></form><button class="access-link" id="accessSwitch">New teammate? Create account</button>`;
  return `<div class="access-wrap"><div class="access-card"><img class="access-logo" src="assets/gir-icon.png" alt="GIR"><h1>${heading}</h1>${body}${accessError?`<p class="access-error">${esc(accessError)}</p>`:''}</div></div>`;
}
function bindAccess(){
  $('#accessSwitch')?.addEventListener('click',()=>{accessMode=accessMode==='signup'?'signin':'signup';accessError='';render();});
  $('#accessSignOut')?.addEventListener('click',signOut);
  $('#signinForm')?.addEventListener('submit',async e=>{e.preventDefault();const email=inputValue('accessEmail'),password=$('#accessPassword').value;const {data:auth,error}=await clientApi.auth.signInWithPassword({email,password});if(error){accessError=error.message;render();return;}session=auth.session;workspaceReady=false;accessError='';render();resolveWorkspace();});
  $('#signupForm')?.addEventListener('submit',async e=>{e.preventDefault();const email=inputValue('accessEmail'),password=$('#accessPassword').value,name=inputValue('accessName');if(password!==$('#accessConfirm').value){accessError='Passwords do not match';render();return;}const {data:auth,error}=await clientApi.auth.signUp({email,password,options:{data:{display_name:name}}});if(error){accessError=error.message;render();return;}data.settings.displayName=name;save();accessError='';if(auth.session){session=auth.session;workspaceReady=false;render();resolveWorkspace();}else{accessMode='signin';accessError='Account created. Confirm your email, then sign in.';render();}});
  $('#joinForm')?.addEventListener('submit',async e=>{e.preventDefault();const code=inputValue('accessCode').toUpperCase();const {data:id,error}=await clientApi.rpc('join_gir_workspace',{code,name:data.settings.displayName||session.user.user_metadata?.display_name||'Team member'});if(error){accessError=error.message;render();return;}if(id!==GIR_WORKSPACE_ID){accessError='This code does not match the GIR workspace';render();return;}data.settings.workspaceId=id;workspaceReady=true;accessError='';save();await syncNow();});
}
function renderClients() {
  const nav=$('#clientList'), position=nav.scrollLeft;
  const list = sortedClients();
  if(!activeClient && list.length) activeClient = list[0].id;
  nav.innerHTML = list.map(c => {
    const act = clientActivity(c.id);
    const badges = [];
    if(act.pending > 0) badges.push(`<small class="pending-badge" title="${act.pending} pending tasks">${act.pending}</small>`);
    if(act.sent > 0) badges.push(`<small class="sent-badge" title="${act.sent} sent awaiting payment">${act.sent} sent</small>`);
    return `<button class="client-tab ${activeClient===c.id && tab==='sheet'?'active':''}" data-client="${c.id}" title="${act.pending} pending, ${act.sent} sent awaiting payment">${esc(c.name)}${badges.join('')}</button>`;
  }).join('');
  nav.scrollLeft=position;
  const active=nav.querySelector('.client-tab.active');
  if(active){
    const left=active.offsetLeft-nav.offsetLeft,right=left+active.offsetWidth;
    if(left<nav.scrollLeft)nav.scrollLeft=left;
    else if(right>nav.scrollLeft+nav.clientWidth)nav.scrollLeft=right-nav.clientWidth;
  }
  $$('#clientList [data-client]').forEach(b => b.onclick = () => { activeClient = b.dataset.client; selected.clear();selectionAnchor=null;selectionCell=null;blankRows=60; tab='sheet'; render(); });
}
function renderTeam() {
  const members = data.members.length ? data.members : [{ userId:'local-me', displayName:data.settings.displayName }, { userId:'local-partner', displayName:data.settings.localPartner }];
  $('#teamList').innerHTML = members.map(m => { const works = data.items.filter(i => i.assigneeId === m.userId && ['working','changes'].includes(i.status)); return `<div class="member ${highlightUser===m.userId?'active':''}" data-member="${esc(m.userId)}"><div class="member-top"><div class="avatar">${avatar(m.userId,m.displayName)}</div><span class="member-name">${esc(m.displayName)}</span><span class="member-count">${works.length}</span></div><div class="member-rows">${works.slice(0,5).map(i=>`<button data-jump="${i.id}">${esc(data.clients.find(c=>c.id===i.clientId)?.name || '')} · ${esc(i.service)}</button>`).join('') || '<span class="muted">Available</span>'}</div></div>`; }).join('');
  $$('#teamList [data-member]').forEach(el => el.onclick = e => { const jump = e.target.closest('[data-jump]'); if (jump) { const item = data.items.find(i=>i.id===jump.dataset.jump); activeClient=item.clientId; tab='sheet'; highlightUser=item.assigneeId; render(); setTimeout(()=>document.querySelector(`[data-row="${item.id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'}),100); } else { highlightUser = highlightUser === el.dataset.member ? null : el.dataset.member; if (highlightUser) { const first=data.items.find(i=>i.assigneeId===highlightUser && ['working','changes'].includes(i.status)); if(first){activeClient=first.clientId;tab='sheet';} } render(); } });
  const c=counts(), f=financials(); $('#quickView').innerHTML = `<div class="qstat"><span>WORK IN PROGRESS</span><b>${c.working} tasks</b></div><div class="qstat"><span>WORK SENT EXPECTED</span><b>${money(f.awaiting)}</b></div><div class="qstat"><span>OVERDUE</span><b>${c.overdue} tasks</b></div>`;
}
function renderDashboard() {
  const c=counts(), f=financials(), completion=c.total?Math.round(c.done/c.total*100):0;
  const priority=data.clients.map(cl=>({cl,items:clientItems(cl.id).filter(i=>!['sent','paid','discarded'].includes(i.status))})).filter(x=>x.items.length).sort((a,b)=>b.items.length-a.items.length).slice(0,6);
  const byClient=data.clients.map(cl=>{ const its=clientItems(cl.id).filter(i=>i.status!=='discarded');return {cl,total:its.length,done:its.filter(i=>['sent','paid'].includes(i.status)).length,pending:unfinishedCount(cl.id)};}).filter(x=>x.pending>0).sort((a,b)=>a.pending-b.pending || b.done/b.total-a.done/a.total || a.cl.name.localeCompare(b.cl.name)).slice(0,5);
  return `<div class="section-top"><div><h2>Your studio at a glance</h2><p>Live progress across ${data.clients.length} clients.</p></div></div>
    <div class="cards"><div class="card blue"><div class="card-label">Completed work</div><div class="card-value">${completion}%</div><div class="card-foot">${c.done} of ${c.total} tasks sent or paid</div></div><div class="card"><div class="card-label">In progress</div><div class="card-value">${c.working}</div><div class="card-foot">${c.pending} waiting to start</div></div><div class="card amber"><div class="card-label">Work sent expected</div><div class="card-value">${money(f.awaiting)}</div><div class="card-foot">Sent or invoiced balances due</div></div><div class="card green"><div class="card-label">Revenue received</div><div class="card-value">${money(f.revenue)}</div><div class="card-foot">Paid work and open-work advances</div></div></div>
    <div class="grid-2"><div class="panel"><h3>Clients with most pending work</h3>${priority.length?priority.map(x=>`<div class="list-row"><div><strong>${esc(x.cl.name)}</strong><small>${x.items.length} unfinished rows</small></div><button class="small-btn" data-client-open="${x.cl.id}">Open sheet</button></div>`).join(''):'<p class="muted">No pending work right now.</p>'}</div>
    <div class="panel"><h3>Clients closest to completion</h3>${byClient.length?byClient.map(x=>`<div class="metric-row"><div style="width:100%"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong>${esc(x.cl.name)}</strong><span class="muted">${x.pending} left · ${x.done}/${x.total}</span></div><div class="bar"><span style="width:${x.done/x.total*100}%"></span></div></div></div>`).join(''):'<p class="muted">No unfinished client work right now.</p>'}</div></div>`;
}
function groupHeader(kind,group,items) {
  const done=items.filter(i=>['sent','paid'].includes(i.status)).length;
  const active=items.filter(i=>i.status!=='discarded');
  const folded=collapsedGroups.has(kind+':'+group.id);
  const detail=kind==='deal'&&group.agreedAmount!=null?` · Agreed ${money(group.agreedAmount)}`:'';
  const status=groupStatus(items);
  return `<tr class="sheet-group-header ${kind}"><td colspan="11"><div class="group-heading"><button data-group-collapse="${kind}:${group.id}" aria-expanded="${!folded}"><svg class="group-chevron ${folded?'collapsed':''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 5.75 4.5 4.5 4.5-4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><strong>${esc(group.label)}</strong><span>${done}/${active.length} complete${detail}</span></button><span class="group-status ${status.toLowerCase().replaceAll(' ','-')}">${status}</span><button class="group-quick" data-group-status="${kind}:${group.id}:sent" ${!active.length?'disabled':''}>Mark sent</button><button class="group-quick" data-group-status="${kind}:${group.id}:paid" ${!active.length?'disabled':''}>Mark paid</button>${kind==='project'?`<button class="group-add" data-group-add="${group.id}" title="Add work under this project">＋ Row</button>`:''}<button class="group-rename" data-group-rename="${kind}:${group.id}" title="Rename group">Rename</button></div></td></tr>`;
}
function groupStatus(items){const active=items.filter(i=>i.status!=='discarded');if(!active.length)return 'Discarded';if(active.every(i=>i.status==='paid'))return 'Paid';if(active.every(i=>['sent','paid'].includes(i.status)))return 'Sent';if(active.some(i=>['working','changes'].includes(i.status)))return 'Working';return 'Pending';}
function blankRowHtml(order) {
  const cell=key=>`<td><input data-blank-cell="${key}" data-blank-order="${order}" value="" readonly></td>`;
  return `<tr class="blank-row" data-blank-row="${order}"><td class="row-selector"></td><td class="serial-cell">${order+1}</td>${cell('workDate')}${cell('service')}${cell('quantity')}${cell('rate')}${cell('quotedTotal')}<td class="status-cell"></td>${cell('advanceAmount')}<td class="assignee-cell"></td>${cell('remarks')}</tr>`;
}
function groupedSheetItems(items) {
  const seen=new Set(),ordered=[];
  const append=group=>{for(const item of items)if(!seen.has(item.id)&&group(item)){seen.add(item.id);ordered.push(item);}};
  for(const item of items){
    if(seen.has(item.id))continue;
    if(item.projectGroupId){
      const project=item.projectGroupId;
      for(const nested of items.filter(i=>i.projectGroupId===project)){
        if(nested.groupId){const deal=nested.groupId;append(i=>i.projectGroupId===project&&i.groupId===deal);}
        else append(i=>i.id===nested.id);
      }
    } else if(item.groupId){const deal=item.groupId;append(i=>!i.projectGroupId&&i.groupId===deal);}
    else append(i=>i.id===item.id);
  }
  return ordered;
}
function renderSheet() {
  const cl=currentClient();
  if(!cl)return `<div class="empty"><h3>No client yet</h3><p>Create a client using the + button beside the bottom tabs.</p></div>`;
  const all=clientItems(),items=groupedSheetItems(all.filter(i=>filter==='all'||i.status===filter));
  let rows='',projectsSeen=new Set(),dealsSeen=new Set();
  for(const i of items){
    const project=data.projectGroups.find(g=>g.id===i.projectGroupId);
    if(project&&!projectsSeen.has(project.id)){
      projectsSeen.add(project.id);
      rows+=groupHeader('project',project,all.filter(x=>x.projectGroupId===project.id));
    }
    if(project&&collapsedGroups.has('project:'+project.id))continue;
    const deal=data.groups.find(g=>g.id===i.groupId);
    const dealHeaderKey=`${project?.id||''}:${deal?.id||''}`;
    if(deal&&!dealsSeen.has(dealHeaderKey)){
      dealsSeen.add(dealHeaderKey);
      rows+=groupHeader('deal',deal,all.filter(x=>x.groupId===deal.id));
    }
    if(deal&&collapsedGroups.has('deal:'+deal.id))continue;
    const own=['working','changes'].includes(i.status)&&i.assigneeId===currentUserId();
    const other=['working','changes'].includes(i.status)&&i.assigneeId&&i.assigneeId!==currentUserId();
    const value=(key,v,extra='')=>`<td><input data-cell="${key}" data-id="${i.id}" value="${esc(v??'')}" title="${esc(v??'')}" ${extra} readonly></td>`;
    rows+=`<tr data-row="${i.id}" class="${selected.has(i.id)?'selected':''} ${i.groupId?'grouped':''} ${i.status==='paid'&&i.groupId?'paid-group':''} ${i.status==='discarded'?'discarded-row':''} ${own?'working-own':''} ${other?'working-other':''} ${i.service?'has-entry':''}">
      <td class="row-selector"><input type="checkbox" data-check="${i.id}" ${selected.has(i.id)?'checked':''}></td>
      ${value('serial',i.serial||i.sortOrder+1)}${value('workDate',i.workDate||'')}${value('service',i.service)}${value('quantity',i.quantity)}${value('rate',i.rate)}${value('quotedTotal',i.quotedTotal,'class="money-cell"')}
      <td class="status-cell ${i.status}"><button type="button" class="status-trigger" data-status-menu="${i.id}" aria-label="Change status from ${esc(displayStatus(i))}" aria-haspopup="listbox" aria-expanded="false"><span class="status-dot"></span><span>${esc(displayStatus(i))}</span><svg class="status-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></td>
      ${value('advanceAmount',i.advanceAmount||0,'class="money-cell"')}
      <td class="assignee-cell"><button type="button" class="assignee-button" data-assignee-pick="${i.id}" title="${esc(i.assigneeId?person(i.assigneeId):'Assign person')}">${i.assigneeId?avatar(i.assigneeId,person(i.assigneeId)):'<span>＋</span>'}</button></td>
      ${value('remarks',i.remarks||'')}</tr>`;
  }
  if(filter==='all')rows+=Array.from({length:blankRows},(_,n)=>blankRowHtml(all.length+n)).join('');
  return `<div class="sheet-shell"><div class="sheet-toolbar"><div class="actions"><button class="small-btn blue" data-action="assign" ${selected.size?'':'disabled'}>● Start work</button><button class="small-btn" data-action="complete" ${selected.size?'':'disabled'}>✓ Mark sent</button><button class="small-btn" data-action="invoice" ${selected.size?'':'disabled'}>▣ Create invoice</button><button class="small-btn" data-action="group" ${selected.size>1?'':'disabled'}>Group deal</button><button class="small-btn" data-action="project-group" ${selected.size?'':'disabled'}>Group project</button><select id="bulkStatus" aria-label="Set selected rows status" ${selected.size?'':'disabled'}><option value="">Set status…</option>${['pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}">${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}<option value="paid-date">Paid on date…</option></select><select id="workFilter" aria-label="Filter work">${['all','pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}" ${filter===s?'selected':''}>${s==='all'?'All work':s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></div><span class="hint" id="selectedCount">${selectionLabel()}</span></div>
    <div class="sheet-viewport"><table class="sheet"><thead><tr><th class="row-selector"><input type="checkbox" id="selectAll" aria-label="Select visible rows"></th><th>SR</th><th>DATE</th><th>SERVICE PROVIDED</th><th>QTY</th><th>RATE</th><th>TOTAL</th><th>STATUS</th><th>ADVANCE</th><th>ASSIGNED</th><th>REMARKS</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderDeadlines() {
  const rows=data.items.filter(i=>i.dueDate && i.status!=='discarded').sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  return `<div class="section-top"><div><h2>What needs to go out</h2><p>Deadlines set directly on work rows.</p></div></div>${rows.length?`<table class="table-list"><thead><tr><th>DUE</th><th>CLIENT</th><th>WORK</th><th>ASSIGNED</th><th>STATUS</th></tr></thead><tbody>${rows.map(i=>`<tr data-jump-item="${i.id}"><td><strong>${fmtDate(i.dueDate)}</strong></td><td>${esc(data.clients.find(c=>c.id===i.clientId)?.name)}</td><td>${esc(i.service)}</td><td>${esc(person(i.assigneeId))}</td><td><span class="pill ${i.dueDate<today()&&!['paid','sent'].includes(i.status)?'overdue':i.status}">${i.dueDate<today()&&!['paid','sent'].includes(i.status)?'Overdue':displayStatus(i)}</span></td></tr>`).join('')}</tbody></table>`:`<div class="empty"><h3>No deadlines yet</h3><p>Add a due date to any row in the work sheet. Upcoming work will appear here.</p></div>`}`;
}
function renderTracker() {
  const members=data.members.length?data.members:[{userId:'local-me',displayName:data.settings.displayName},{userId:'local-partner',displayName:data.settings.localPartner}];
  const working=data.items.filter(i=>['working','changes'].includes(i.status));
  const unassigned=data.items.filter(i=>!i.assigneeId&&!['discarded','paid'].includes(i.status));
  const statusRank=s=>s==='changes'?1:s==='working'?2:s==='sent'?3:4;

  const renderCard=(i,showStart=true)=>{
    const client=data.clients.find(c=>c.id===i.clientId);
    const amount=i.quotedTotal||effectiveItemValue(i);
    const rateText=i.rate?`${i.quantity>1?i.quantity+' × ':''}${money(i.rate)}`:'';
    const isWorking=i.status==='working';
    return `<div class="tracker-card ${i.status}">
      <div class="tracker-card-head" data-jump-item="${i.id}" title="Click to open row in worksheet">
        <div class="tracker-card-title">
          <strong>${esc(i.service||'Unnamed work')}</strong>
          <span class="tracker-card-client">${esc(client?.name||'Client')}</span>
        </div>
        <div class="tracker-card-price">
          <strong>${money(amount)}</strong>
          ${rateText?`<small>${rateText}</small>`:''}
        </div>
      </div>
      <div class="tracker-card-meta">
        <span class="pill ${i.status}">${esc(displayStatus(i))}</span>
        ${i.dueDate?`<span class="tracker-due ${i.dueDate<today()&&!['sent','paid'].includes(i.status)?'overdue':''}">Due ${fmtDate(i.dueDate)}</span>`:''}
      </div>
      <div class="tracker-card-actions">
        ${showStart&&!isWorking?`<button type="button" class="small-btn blue tracker-start-btn" data-tracker-start="${i.id}">▶ Start</button>`:showStart&&isWorking?`<span class="pill working tracker-active-badge">● In progress</span>`:''}
        <select class="tracker-status-select ${i.status}" data-tracker-status="${i.id}" aria-label="Change status">
          ${['pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}" ${i.status===s?'selected':''}>${s==='changes'?'Changes':s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
          <option value="paid-date">Paid on date…</option>
        </select>
        <button type="button" class="small-btn tracker-view-btn" data-jump-item="${i.id}">View sheet</button>
      </div>
    </div>`;
  };

  return `<div class="section-top">
      <div>
        <h2>Work Tracker</h2>
        <p>Live team assignments, progress, and pending work across clients.</p>
      </div>
      <span class="pill working">${working.length} in progress</span>
    </div>
    <div class="tracker-grid">
      ${members.map(m=>{
        const assigned=data.items
          .filter(i=>{
            if(['discarded','paid'].includes(i.status))return false;
            if(!i.assigneeId)return false;
            if(i.assigneeId===m.userId)return true;
            if(m.userId===currentUserId()&&i.assigneeId==='local-me')return true;
            if(i.assigneeId==='local-partner'&&(m.userId==='local-partner'||m.displayName===data.settings.localPartner))return true;
            if(i.assigneeId==='local-me'&&(m.userId==='local-me'||m.displayName===data.settings.displayName))return true;
            if(m.displayName&&i.assigneeId.toLowerCase()===m.displayName.toLowerCase())return true;
            return false;
          })
          .sort((a,b)=>statusRank(a.status)-statusRank(b.status)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
        const inProgress=assigned.filter(i=>['working','changes'].includes(i.status)).length;
        return `<div class="panel">
          <h3>
            <span class="tracker-avatar">${avatar(m.userId,m.displayName)}</span>${esc(m.displayName)}
            <span class="muted">${assigned.length} assigned${inProgress?` · ${inProgress} in progress`:''}</span>
          </h3>
          ${assigned.length?assigned.map(i=>renderCard(i,true)).join(''):'<p class="muted">No work assigned right now. Assign work from any worksheet.</p>'}
        </div>`;
      }).join('')}
    </div>
    ${unassigned.length?`<div class="panel">
      <h3>Unassigned active work <span class="muted">· ${unassigned.length} rows</span></h3>
      <p class="muted">Rows without an assignee. Click to assign to a team member or open in the worksheet.</p>
      <div class="tracker-grid" style="margin-top:12px">
        ${unassigned.slice(0,40).map(i=>{
          const client=data.clients.find(c=>c.id===i.clientId);
          const amount=i.quotedTotal||effectiveItemValue(i);
          return `<div class="tracker-card ${i.status}">
            <div class="tracker-card-head" data-jump-item="${i.id}" title="Click to open row in worksheet">
              <div class="tracker-card-title">
                <strong>${esc(i.service||'Unnamed work')}</strong>
                <span class="tracker-card-client">${esc(client?.name||'Client')}</span>
              </div>
              <div class="tracker-card-price">
                <strong>${money(amount)}</strong>
                ${i.rate?`<small>${i.quantity} × ${money(i.rate)}</small>`:''}
              </div>
            </div>
            <div class="tracker-card-meta">
              <span class="pill ${i.status}">${esc(displayStatus(i))}</span>
              ${i.dueDate?`<span class="tracker-due ${i.dueDate<today()&&!['sent','paid'].includes(i.status)?'overdue':''}">Due ${fmtDate(i.dueDate)}</span>`:''}
            </div>
            <div class="tracker-card-actions">
              <button type="button" class="small-btn blue tracker-start-btn" data-assignee-pick="${i.id}">Assign</button>
              <button type="button" class="small-btn tracker-view-btn" data-jump-item="${i.id}">View sheet</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`:''}`;
}
function renderGroups() {
  const groups=[...data.projectGroups.map(g=>({...g,kind:'project'})),...data.groups.map(g=>({...g,kind:'deal'}))];
  const cards=groups.map(g=>{
    const rows=data.items.filter(i=>(g.kind==='project'?i.projectGroupId:i.groupId)===g.id);
    const active=rows.filter(i=>i.status!=='discarded');
    const done=active.filter(i=>['sent','paid'].includes(i.status)).length;
    const amount=g.kind==='deal'&&g.agreedAmount!=null?`<span>Agreed ${money(g.agreedAmount)}</span>`:'';
    return `<div class="group-card"><button class="group-card-open" data-open-group="${g.kind}:${g.id}"><span class="group-badge">${g.kind==='project'?'PROJECT GROUP':'DEAL GROUP'}</span><strong>${esc(g.label)}</strong><small>${esc(data.clients.find(c=>c.id===g.clientId)?.name)} · ${done}/${active.length} complete · ${active.length-done} left · ${groupStatus(rows)}</small>${amount}<div class="bar"><span style="width:${active.length?done/active.length*100:0}%"></span></div></button><div class="group-card-actions"><button class="group-quick" data-group-status="${g.kind}:${g.id}:sent">Mark sent</button><button class="group-quick" data-group-status="${g.kind}:${g.id}:paid">Mark paid</button></div><button class="group-card-rename" data-rename-card="${g.kind}:${g.id}" title="Rename group">Rename</button><div class="group-card-editor" hidden><label>Group name<input value="${esc(g.label)}" aria-label="Group name"></label><div><button type="button" data-save-card="${g.kind}:${g.id}">Save</button><button type="button" data-cancel-card>Cancel</button></div></div></div>`;
  }).join('');
  return `<div class="section-top"><div><h2>Groups</h2><p>Project folders and negotiated deals across clients.</p></div></div>${groups.length?`<div class="group-grid">${cards}</div>`:'<div class="empty"><h3>No groups yet</h3><p>Select rows on a worksheet to create a project group or grouped deal.</p></div>'}`;
}function renderClientDetails() {
  return `<div class="section-top"><div><h2>Client Details</h2><p>Billing information used on invoices.</p></div></div><div class="panel">${data.clients.length?data.clients.map(c=>`<div class="list-row"><div><strong>${esc(c.name)}</strong><small>${esc(c.billing?.name||'No billing name')} · ${esc(c.billing?.email||'No email')}</small></div><button class="small-btn" data-billing-edit="${c.id}">Edit details</button></div>`).join(''):'<p class="muted">Add a client using the + button in the bottom tab bar.</p>'}</div>`;
}
function renderRevenue() {
  const f=financials(), receipts=[...(data.receipts||[])].sort((a,b)=>(b.receivedMonth||'').localeCompare(a.receivedMonth||'')||(b.receivedOn||'').localeCompare(a.receivedOn||''));
  const months=new Map();
  for(const r of receipts){
    const amt=receiptEffectiveAmount(r);
    const itm=receiptEffectiveItem(r);
    if(amt<=0&&itm&&itm.status!=='paid')continue;
    const key=(r.receivedMonth||'').slice(0,7);
    const month=months.get(key)||{total:0,receipts:[]};
    month.total+=amt;
    month.receipts.push({
      ...r,
      effectiveAmount: amt,
      effectiveDescription: receiptEffectiveDescription(r),
      effectiveClientName: receiptEffectiveClientName(r)
    });
    months.set(key,month);
  }
  const monthName=key=>esc(new Date(key+'-01T00:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'}));
  return `<div class="section-top"><div><h2>Revenue</h2><p>Money received is recorded by payment date and client. Estimated incoming is unpaid active work.</p></div></div>
    <div class="cards"><div class="card green"><div class="card-label">Received</div><div class="card-value">${money(f.revenue)}</div><div class="card-foot">Recorded cash receipts</div></div><div class="card blue"><div class="card-label">Paid work value</div><div class="card-value">${money(f.closed)}</div><div class="card-foot">Value marked paid on worksheets</div></div><div class="card amber"><div class="card-label">Open-work advances</div><div class="card-value">${money(f.openAdvances)}</div><div class="card-foot">Already received; included in historical receipts where recorded</div></div><div class="card"><div class="card-label">Discarded project value</div><div class="card-value">${money(f.discarded)}</div><div class="card-foot">Excluded from income estimates</div></div></div>
    <div class="cards"><div class="card amber"><div class="card-label">Work sent expected</div><div class="card-value">${money(f.awaiting)}</div><div class="card-foot">Sent or invoiced balances still due</div></div><div class="card blue"><div class="card-label">Estimated incoming</div><div class="card-value">${money(f.estimated)}</div><div class="card-foot">All unpaid active work, including sent</div></div></div>
    <div class="panel">
      <h3>Revenue by month</h3>
      <p class="muted">Click any month to open the dropdown details showing exactly who has paid, payment dates, and amounts.</p>
      ${months.size?`
        <div class="revenue-month-list">
          ${[...months].map(([key,m],idx)=>`
            <details class="revenue-month-accordion" ${idx===0?'open':''}>
              <summary class="revenue-month-summary">
                <div class="revenue-month-col">
                  <span class="revenue-month-chevron">▶</span>
                  <strong>${monthName(key)}</strong>
                  <span class="muted font-11">(${m.receipts.length} payment${m.receipts.length===1?'':'s'})</span>
                </div>
                <div class="revenue-month-sum">
                  <strong>${money(m.total)}</strong>
                </div>
              </summary>
              <div class="revenue-month-breakdown">
                <table class="table-list">
                  <thead><tr><th>DATE</th><th>CLIENT</th><th>PAYMENT / SERVICE</th><th style="text-align:right">AMOUNT</th></tr></thead>
                  <tbody>
                    ${m.receipts.map(r=>`<tr><td>${r.receivedOn?fmtDate(r.receivedOn):'<span class="muted">Day unconfirmed</span>'}</td><td><strong>${esc(r.effectiveClientName||r.clientName)}</strong></td><td>${esc(r.effectiveDescription||r.description||(r.source==='historical_workbook'?'Historical payment':'Payment'))}</td><td style="text-align:right"><strong>${money(r.effectiveAmount!=null?r.effectiveAmount:r.amount)}</strong></td></tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </details>
          `).join('')}
        </div>
      `:'<p class="muted">No payment receipts recorded.</p>'}
    </div>
    ${renderOutstandingPanel(f)}`;
}
function renderOutstandingPanel(f=financials()) {
  const grouped=new Map();
  for(const entry of f.outstandingItems){
    const client=grouped.get(entry.clientId)||{balance:0,itemIds:new Set(),statuses:new Set()};
    client.balance+=entry.balance;
    entry.itemIds.forEach(id=>client.itemIds.add(id));
    client.statuses.add(entry.status);
    grouped.set(entry.clientId,client);
  }
  const clients=[...grouped].sort((a,b)=>b[1].balance-a[1].balance);
  return `<div class="panel"><h3>Outstanding by client</h3><p class="muted">Unpaid active work, including pending work and issued invoices. Advances already received are deducted.</p>${clients.length?clients.map(([id,entry])=>`<div class="list-row"><div><strong>${esc(data.clients.find(c=>c.id===id)?.name||'Client')}</strong><small>${entry.itemIds.size} row${entry.itemIds.size===1?'':'s'} · ${[...entry.statuses].map(s=>s==='changes'?'Changes':s==='invoiced'?'Invoiced':s[0].toUpperCase()+s.slice(1)).join(', ')}</small></div><div class="actions"><strong>${money(entry.balance)}</strong><button class="small-btn" data-view-outstanding="${esc(id)}">View work</button></div></div>`).join(''):'<p class="muted">No unpaid active work.</p>'}</div>`;
}
function renderPayments() {
  const f=financials(), issued=data.invoices.filter(i=>i.status==='issued'), byClient=new Map();
  for(const item of f.sentItems){const entry=byClient.get(item.clientId)||{count:0,balance:0};entry.count++;entry.balance+=item.balance;byClient.set(item.clientId,entry);}
  const clients=[...byClient].sort((a,b)=>b[1].balance-a[1].balance);
  return `<div class="section-top"><div><h2>Payment tracking</h2><p>See which clients still have a balance to pay.</p></div></div><div class="cards"><div class="card amber"><div class="card-label">Work sent expected</div><div class="card-value">${money(f.awaiting)}</div></div><div class="card blue"><div class="card-label">Active work not sent</div><div class="card-value">${money(Math.max(0,f.estimated-f.awaiting))}</div></div></div>${renderOutstandingPanel(f)}<div class="panel"><h3>Issued invoices</h3>${issued.length?issued.map(i=>`<div class="list-row"><div><strong>${esc(i.number)}</strong><small>${esc(data.clients.find(c=>c.id===i.clientId)?.name)} · ${fmtDate(i.issueDate)}</small></div><div class="actions"><strong>${money(Math.max(0,num(i.finalAmount)-invoiceAdvance(i)))}</strong><button class="small-btn" data-invoice-view="${i.id}">View</button><button class="small-btn blue" data-invoice-paid="${i.id}">Record paid</button></div></div>`).join(''):'<p class="muted">No invoices waiting for payment.</p>'}</div><div class="panel"><h3>Sent work awaiting invoice</h3>${clients.length?clients.map(([id,entry])=>`<div class="list-row"><div><strong>${esc(data.clients.find(c=>c.id===id)?.name||'Client')}</strong><small>${entry.count} sent row${entry.count===1?'':'s'} not yet invoiced</small></div><div class="actions"><strong>${money(entry.balance)}</strong><button class="small-btn" data-view-uninvoiced="${id}">View work</button></div></div>`).join(''):'<p class="muted">No sent work awaiting an invoice.</p>'}</div>`;
}
function renderInvoices() { return `<div class="section-top"><div><h2>Invoices</h2><p>Create an invoice from finished rows on a client work sheet.</p></div></div>${data.invoices.length?`<table class="table-list"><thead><tr><th>NUMBER</th><th>CLIENT</th><th>ISSUED</th><th>ROWS</th><th>FINAL AMOUNT</th><th>STATUS</th><th></th></tr></thead><tbody>${[...data.invoices].reverse().map(i=>`<tr><td><strong>${esc(i.number)}</strong></td><td>${esc(data.clients.find(c=>c.id===i.clientId)?.name)}</td><td>${fmtDate(i.issueDate)}</td><td>${i.itemIds.length}</td><td><strong>${money(i.finalAmount)}</strong></td><td><span class="pill ${i.status==='paid'?'paid':'sent'}">${i.status==='paid'?'Paid':'Issued'}</span></td><td><button class="small-btn" data-invoice-view="${i.id}">View</button> <button class="small-btn" data-invoice-delete="${i.id}">Delete</button></td></tr>`).join('')}</tbody></table>`:`<div class="empty"><h3>No invoices yet</h3><p>Select sent rows on a client sheet, then choose Create invoice.</p></div>`}`; }
function renderImportPreview() {
  if(!importPreview)return `<div class="empty"><h3>No workbook selected</h3><p>Choose an Excel workbook to inspect its clients and grouped deals.</p><button class="primary" data-action="import">Choose workbook</button></div>`;
  const stage=importPreview, client=stage.clients[previewClientIndex]||stage.clients[0], itemCount=stage.clients.reduce((n,c)=>n+c.items.length,0), groupCount=stage.clients.reduce((n,c)=>n+c.groups.length,0), discardedCount=stage.clients.reduce((n,c)=>n+c.items.filter(i=>i.status==='discarded').length,0), advanceTotal=stage.clients.reduce((n,c)=>n+c.items.reduce((s,i)=>s+num(i.advanceAmount),0),0);
  const duplicateNames=stage.clients.filter(c=>data.clients.some(old=>old.name.trim().toLowerCase()===c.name.trim().toLowerCase())).map(c=>c.name);
  const groupWarnings=stage.clients.flatMap(c=>c.groups.filter(g=>g.agreedAmount===null).map(g=>`${c.name}: ${g.label}`));
  return `<div class="section-top"><div><h2>Review workbook before migration</h2><p>${esc(stage.fileName)} · ${stage.clients.length} clients · ${itemCount} rows · ${groupCount} yellow groups · ${discardedCount} discarded · ${money(advanceTotal)} advances</p></div><div class="actions"><button class="small-btn" data-action="import">Choose another file</button><button class="small-btn blue" data-action="migrate" ${migrating?'disabled':''}>${migrating?'Migrating…':'Migrate to Supabase'}</button></div></div>
    <div class="preview-banner"><strong>Preview only</strong><span>Nothing from this workbook has been inserted yet. Check the rows and closed-at amounts, then use Migrate to Supabase.</span></div>
    ${!client?'<div class="empty"><h3>No importable clients found</h3><p>The workbook needs Date, Service and Status headers on each client sheet.</p></div>':`
    <div class="preview-client-tabs">${stage.clients.map((c,index)=>`<button data-preview-client="${index}" class="${index===previewClientIndex?'active':''}">${esc(c.name)} <span>${c.items.length}</span></button>`).join('')}</div>
    <div class="preview-metrics"><div><small>CLIENT</small><strong>${esc(client.name)}</strong></div><div><small>ACTIVE / DISCARDED</small><strong>${client.items.filter(i=>i.status!=='discarded').length} / ${client.items.filter(i=>i.status==='discarded').length}</strong></div><div><small>ADVANCES (L)</small><strong>${money(client.items.reduce((n,i)=>n+num(i.advanceAmount),0))}</strong></div><div><small>ACTIVE QUOTE</small><strong>${money(client.items.filter(i=>i.status!=='discarded').reduce((n,i)=>n+num(i.quotedTotal),0))}</strong></div></div>
    ${client.groups.length?`<div class="panel preview-groups"><h3>Closed-at deals <span class="muted">· amounts can be corrected here</span></h3>${client.groups.map(g=>`<div class="preview-group-row"><div><span class="group-badge">YELLOW GROUP</span> <strong>${esc(g.label)}</strong><small>${g.itemCount} rows · original quote ${money(g.quotedTotal)}${g.amountCell?` · read from ${esc(g.amountCell)}`:''}</small>${g.warning&&g.agreedAmount===null?`<em>${esc(g.warning)}</em>`:''}</div><label>Closed at <input type="number" min="0" step="0.01" data-preview-amount="${g.id}" value="${g.agreedAmount??''}" placeholder="Enter amount"></label></div>`).join('')}</div>`:''}
    <div class="sheet-shell preview-table-wrap"><div class="sheet-toolbar"><strong>Imported rows</strong><span class="hint">Yellow rows belong to one negotiated deal · a dash in Status is discarded</span></div><div class="sheet-viewport"><table class="table-list import-table"><thead><tr><th>EXCEL ROW</th><th>SR</th><th>DATE</th><th>SERVICE</th><th>QTY</th><th>RATE</th><th>TOTAL</th><th>STATUS</th><th>ADVANCE (L)</th><th>REMARKS</th></tr></thead><tbody>${client.items.map(i=>`<tr class="${i.groupId?'preview-yellow':''} ${i.status==='discarded'?'preview-discarded':''}"><td>${i.sourceRow??'—'}</td><td>${esc(i.serial)}</td><td>${esc(i.sourceDate||i.workDate||'')}</td><td><strong>${esc(i.service)}</strong></td><td>${esc(i.sourceQuantity||i.quantity)}</td><td>${money(i.rate)}</td><td>${money(i.quotedTotal)}</td><td><span class="pill ${i.status}">${esc(displayStatus(i))}</span></td><td><input class="preview-advance-input" type="number" min="0" step="0.01" data-preview-advance="${i.id}" value="${esc(i.advanceAmount)}" title="${esc(i.advanceCell||'Column L')}"></td><td>${esc(i.remarks||'')}</td></tr>`).join('')}</tbody></table></div></div>`}
    ${stage.skippedSheets.length?`<div class="notice">Skipped sheets: ${stage.skippedSheets.map(s=>esc(s.name)).join(', ')}. Their required headers were not found.</div>`:''}
    ${groupWarnings.length?`<div class="notice">${groupWarnings.length} yellow group${groupWarnings.length===1?'':'s'} have no detected closed-at amount. Enter the agreed amount above if applicable.</div>`:''}
    ${duplicateNames.length?`<div class="notice">Existing client names also found: ${duplicateNames.map(esc).join(', ')}. Migrating creates new client records. <label><input type="checkbox" id="confirmDuplicates"> I checked these duplicates</label></div>`:''}
    ${!(clientApi&&session&&data.settings.workspaceId)?'<div class="notice">Connect and join a Supabase workspace in Settings before migration. This preview stays available while you do that.</div>':''}
    <div class="preview-footer"><span>Workbook ID: ${esc(stage.fileHash.slice(0,12))}…</span><button class="small-btn blue" data-action="migrate" ${migrating?'disabled':''}>${migrating?'Migrating…':'Migrate to Supabase'}</button></div>`;
}
function renderSettings() { const s=data.settings; return `<div class="section-top"><div><h2>Workspace settings</h2><p>Business details, people and Supabase connection.</p></div></div><div class="grid-2"><div class="panel"><h3>Business on invoices</h3><div class="field"><label>Business name</label><input data-setting="seller.name" value="${esc(s.seller.name)}"></div><div class="field"><label>Address</label><textarea data-setting="seller.address" rows="3">${esc(s.seller.address)}</textarea></div><div class="field-grid"><div class="field"><label>Email</label><input data-setting="seller.email" value="${esc(s.seller.email)}"></div><div class="field"><label>Phone</label><input data-setting="seller.phone" value="${esc(s.seller.phone)}"></div></div><div class="field"><label>Tax / GST ID (optional)</label><input data-setting="seller.taxId" value="${esc(s.seller.taxId)}"></div><label class="invoice-logo-upload"><span class="invoice-logo-preview">${s.seller.logoData?`<img src="${esc(s.seller.logoData)}" alt="Company logo">`:`<img src="assets/gir-icon.png" alt="Default GIR logo">`}</span><span>Choose company logo</span><input id="companyLogoUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label><div class="field"><label>Your bank account details for client payments</label><textarea data-setting="seller.bankDetails" rows="4" placeholder="Account holder, bank, account number, IFSC">${esc(s.seller.bankDetails||'')}</textarea></div><button class="small-btn blue" data-action="save-settings">Save business details</button></div><div class="panel"><h3>Your team</h3><label class="avatar-upload"><span class="avatar">${avatar(currentUserId(),s.displayName)}</span><span>Choose your avatar image</span><input id="avatarUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label><div class="field"><label>Your display name</label><input data-setting="displayName" value="${esc(s.displayName)}"></div>${!session?`<div class="field"><label>Second person (local view)</label><input data-setting="localPartner" value="${esc(s.localPartner)}"></div>`:''}<button class="small-btn blue" data-action="save-settings">Save names</button><div class="notice">When connected, both people sign in with their own Supabase accounts. Assignments and updates then appear live on both PCs.</div></div></div>
    <div class="panel"><h3>Supabase connection</h3><div class="field-grid"><div class="field"><label>Project URL</label><input id="supaUrl" placeholder="https://project.supabase.co" value="${esc(s.url)}"></div><div class="field"><label>Publishable / anon key</label><input id="supaKey" type="password" placeholder="Never enter a service-role key" value="${esc(s.key)}"></div></div><div class="actions"><button class="small-btn" data-action="save-connection">Save connection</button>${session?`<span class="pill paid">Signed in as ${esc(session.user.email)}</span><button class="small-btn" data-action="sign-out">Sign out</button>`:`<button class="small-btn blue" data-action="sign-in">Sign in</button><button class="small-btn" data-action="sign-up">Create account</button>`}</div>${session?`<div class="notice">Workspace code: <strong>${esc(s.joinCode||'Create or join a workspace')}</strong> · Share this code with your second team member. Workspace ID: ${esc(s.workspaceId||'none')}</div><div class="actions"><button class="small-btn blue" data-action="sync">Sync now</button></div>`:''}</div><div class="panel"><h3>Desktop app</h3><p class="muted">Changes sync automatically while connected.</p><div class="actions"><button class="small-btn" data-action="sync">Sync now</button><button class="small-btn blue" id="updateBtn">Check for updates</button><span id="appVersion"></span></div><p class="muted" id="updateStatus"></p></div>`; }

function bindMain() {
  $$('[data-action]').forEach(b=>b.onclick=()=>actions(b.dataset.action));
  $$('[data-preview-client]').forEach(b=>b.onclick=()=>{previewClientIndex=Number(b.dataset.previewClient);render();});
  $$('[data-preview-amount]').forEach(el=>el.onchange=()=>{const group=importPreview?.clients.flatMap(c=>c.groups).find(g=>g.id===el.dataset.previewAmount);if(group){group.agreedAmount=el.value.trim()===''?null:num(el.value);render();}});
  $$('[data-preview-advance]').forEach(el=>el.onchange=()=>{const item=importPreview?.clients.flatMap(c=>c.items).find(i=>i.id===el.dataset.previewAdvance);if(item){item.advanceAmount=Math.max(0,num(el.value));render();}});
  const workFilter=$('#workFilter');if(workFilter)workFilter.onchange=()=>{filter=workFilter.value;selected.clear();render();};
  const bulkStatus=$('#bulkStatus');if(bulkStatus)bulkStatus.onchange=()=>{const next=bulkStatus.value;bulkStatus.value='';if(next==='paid-date'){paidAtDialog([...selected]);}else if(next)bulkSetStatus(next);};
  $$('[data-tracker-start]').forEach(b=>b.onclick=e=>{e.stopPropagation();startTrackerItem(b.dataset.trackerStart);});
  $$('[data-tracker-status]').forEach(sel=>sel.onchange=e=>{e.stopPropagation();updateTrackerItemStatus(sel.dataset.trackerStatus,sel.value);});
  $$('[data-check]').forEach(b=>{b.onclick=e=>e.stopPropagation();b.onchange=()=>{b.checked?selected.add(b.dataset.check):selected.delete(b.dataset.check);selectionAnchor=b.dataset.check;refreshSelection();};});
  const all=$('#selectAll'); if(all) all.onchange=()=>{$$('[data-check]').forEach(b=>all.checked?selected.add(b.dataset.check):selected.delete(b.dataset.check));refreshSelection();};
  $$('[data-cell]').forEach(el=>{ el.onchange=()=>editCell(el.dataset.id,el.dataset.cell,el.value); if(el.tagName==='INPUT') el.onpaste=e=>pasteGrid(e,el); });
  $$('[data-status-menu]').forEach(button=>button.onclick=()=>{selectSheetRow(button.dataset.statusMenu,false,false);openStatusMenu(button,button.dataset.statusMenu);});
  $$('[data-assignee-pick]').forEach(b=>b.onclick=()=>assignPersonDialog(b.dataset.assigneePick));
  $('#avatarUpload')?.addEventListener('change',e=>{if(e.target.files?.[0])saveAvatar(e.target.files[0]);});
  $('#companyLogoUpload')?.addEventListener('change',e=>{if(e.target.files?.[0])saveCompanyLogo(e.target.files[0]);});
  $$('[data-row]').forEach(row=>{
    row.onmousedown=e=>{if(e.button===0&&e.shiftKey&&!e.target.closest('button, input.editing, input[type=checkbox]'))e.preventDefault();};
    row.onclick=e=>{if(e.target.closest('button')||e.target.matches('[type=checkbox]'))return;const field=e.target.closest('td')?.querySelector('[data-cell]');selectionCell=field?{id:row.dataset.row,key:field.dataset.cell}:null;selectSheetRow(row.dataset.row,e.shiftKey,e.ctrlKey||e.metaKey);};
    row.ondblclick=e=>{const td=e.target.closest('td'),field=td?.querySelector('[data-cell]');if(field)activateSheetField(field);};
    row.oncontextmenu=e=>{e.preventDefault();if(!selected.has(row.dataset.row))selectSheetRow(row.dataset.row,false,false);const menu=$('#contextMenu')||document.createElement('div');menu.id='contextMenu';menu.className='context-menu';menu.innerHTML='<button id="contextInvoice">▣ &nbsp; Create invoice</button><button id="contextAssign">● &nbsp; Start work</button><button id="contextSent">✓ &nbsp; Mark sent</button>';document.body.appendChild(menu);menu.style.left=Math.min(e.clientX,innerWidth-190)+'px';menu.style.top=Math.min(e.clientY,innerHeight-135)+'px';$('#contextInvoice').onclick=()=>{menu.remove();invoiceDialog();};$('#contextAssign').onclick=()=>{menu.remove();assign([...selected]);};$('#contextSent').onclick=()=>{menu.remove();markSent([...selected]);};setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);};
  });
  $$('[data-blank-row]').forEach(row=>{row.onclick=e=>{const field=e.target.closest('td')?.querySelector('[data-blank-cell]');selectionCell=field?{blankOrder:Number(row.dataset.blankRow),key:field.dataset.blankCell}:null;};row.ondblclick=e=>{const field=e.target.closest('td')?.querySelector('[data-blank-cell]');if(field)activateSheetField(field);};});
  $$('[data-blank-cell]').forEach(el=>{el.onchange=()=>materializeBlankRow(el);el.onpaste=e=>pasteBlankGrid(e,el);});
  $$('[data-group-collapse]').forEach(b=>b.onclick=()=>{const id=b.dataset.groupCollapse;collapsedGroups.has(id)?collapsedGroups.delete(id):collapsedGroups.add(id);render();});
  $$('[data-group-add]').forEach(b=>b.onclick=()=>{const group=data.projectGroups.find(g=>g.id===b.dataset.groupAdd);if(!group)return;const item=newItem(group.clientId,clientItems(group.clientId).length);item.projectGroupId=group.id;mutate('items',item);setTimeout(()=>{const row=document.querySelector(`[data-row="${item.id}"]`);row?.scrollIntoView({block:'center'});const field=row?.querySelector('[data-cell="service"]');if(field)activateSheetField(field);},60);});
  $$('[data-group-rename]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.groupRename.split(':');renameGroup(kind,id);});
  $$('[data-group-status]').forEach(b=>b.onclick=()=>{const [kind,id,status]=b.dataset.groupStatus.split(':');const group=(kind==='project'?data.projectGroups:data.groups).find(g=>g.id===id);if(!group)return;const rows=data.items.filter(i=>(kind==='project'?i.projectGroupId:i.groupId)===id&&i.status!=='discarded'&&(status==='paid'?i.status!=='paid':!['sent','paid'].includes(i.status)));if(!rows.length){toast('Group is already '+status);return;}bulkSetStatus(status,rows.map(i=>i.id),{kind,id,label:group.label});});
  const viewport=$('.sheet-viewport');if(tab==='sheet'&&viewport)viewport.onscroll=()=>{if(filter==='all'&&viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<700){blankRows+=40;render();}};
  $$('[data-group-edit]').forEach(b=>b.onclick=()=>groupDialog(b.dataset.groupEdit));
  $$('[data-rename-card]').forEach(b=>b.onclick=()=>{const card=b.closest('.group-card');card.querySelector('[data-open-group]').hidden=true;b.hidden=true;const editor=card.querySelector('.group-card-editor');editor.hidden=false;const input=editor.querySelector('input');input.focus();input.select();});
  $$('[data-cancel-card]').forEach(b=>b.onclick=()=>{const card=b.closest('.group-card');card.querySelector('.group-card-editor').hidden=true;card.querySelector('[data-open-group]').hidden=false;card.querySelector('[data-rename-card]').hidden=false;});
  $$('[data-save-card]').forEach(b=>{const saveName=()=>{const [kind,id]=b.dataset.saveCard.split(':'),table=kind==='project'?'projectGroups':'groups',group=data[table].find(g=>g.id===id),name=b.closest('.group-card-editor').querySelector('input').value.trim();if(!group)return;if(!name){toast('Enter a group name');return;}if(name===group.label){b.closest('.group-card-editor').querySelector('[data-cancel-card]').click();return;}const scroll=$('#main').scrollTop;group.label=name;mutate(table,group);$('#main').scrollTop=scroll;toast('Group renamed');};b.onclick=saveName;b.closest('.group-card-editor').querySelector('input').onkeydown=e=>{if(e.key==='Enter')saveName();if(e.key==='Escape')b.closest('.group-card-editor').querySelector('[data-cancel-card]').click();};});
  $$('[data-open-group]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.openGroup.split(':');const group=(kind==='project'?data.projectGroups:data.groups).find(g=>g.id===id);if(!group)return;activeClient=group.clientId;filter='all';collapsedGroups.delete(kind+':'+id);tab='sheet';render();setTimeout(()=>document.querySelector(`[data-group-collapse="${kind}:${id}"]`)?.scrollIntoView({block:'center'}),50);});
  $$('[data-billing-edit]').forEach(b=>b.onclick=()=>billingDialog(b.dataset.billingEdit));
  $$('[data-client-open]').forEach(b=>b.onclick=()=>{activeClient=b.dataset.clientOpen;tab='sheet';render();});
  $$('[data-view-uninvoiced]').forEach(b=>b.onclick=()=>{activeClient=b.dataset.viewUninvoiced;selected=new Set(financials().sentItems.filter(i=>i.clientId===activeClient).map(i=>i.id));filter='sent';tab='sheet';render();const first=$('[data-row].selected');first?.scrollIntoView({block:'center'});});
  $$('[data-view-outstanding]').forEach(b=>b.onclick=()=>{activeClient=b.dataset.viewOutstanding;selected=new Set(financials().outstandingItems.filter(i=>i.clientId===activeClient).flatMap(i=>i.itemIds));filter='all';tab='sheet';render();const first=$('[data-row].selected');first?.scrollIntoView({block:'center'});});
  if($('#updateBtn'))$('#updateBtn').onclick=updateApp;
  $$('[data-invoice-view]').forEach(b=>b.onclick=()=>viewInvoice(b.dataset.invoiceView));
  $$('[data-invoice-paid]').forEach(b=>b.onclick=()=>markInvoicePaid(b.dataset.invoicePaid));
  $$('[data-invoice-delete]').forEach(b=>b.onclick=()=>deleteInvoiceDialog(b.dataset.invoiceDelete));
  $$('[data-jump-item]').forEach(r=>r.onclick=()=>{const i=data.items.find(x=>x.id===r.dataset.jumpItem);activeClient=i.clientId;tab='sheet';render();setTimeout(()=>document.querySelector(`[data-row="${i.id}"]`)?.scrollIntoView({block:'center'}),100);});
  if(tab==='sheet')refreshSelection();
}
function closeStatusMenu(){
  if(!activeStatusMenu)return;
  activeStatusMenu.trigger.setAttribute('aria-expanded','false');
  document.removeEventListener('pointerdown',activeStatusMenu.outside,true);
  activeStatusMenu.menu.remove();activeStatusMenu=null;
}
function openStatusMenu(trigger,id){
  if(activeStatusMenu?.trigger===trigger){closeStatusMenu();return;}
  closeStatusMenu();
  const item=data.items.find(i=>i.id===id);if(!item)return;
  const statuses=['pending','working','changes','sent','paid','discarded'];
  const menu=document.createElement('div');menu.className='status-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','Choose status');
  menu.innerHTML=statuses.map(status=>`<button type="button" class="status-option ${status} ${item.status===status?'current':''}" data-set-status="${status}" role="option" aria-selected="${item.status===status}"><span class="status-dot"></span><span>${status==='changes'?'Changes':status[0].toUpperCase()+status.slice(1)}</span>${item.status===status?'<span class="status-check">✓</span>':''}</button>`).join('') +
    `<button type="button" class="status-option paid" data-paid-at="${item.id}" role="option"><span class="status-dot"></span><span>Paid on date…</span></button>`;
  document.body.appendChild(menu);
  const rect=trigger.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))+'px';
  menu.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-menu.offsetHeight-8))+'px';
  const outside=e=>{if(!menu.contains(e.target)&&e.target!==trigger)closeStatusMenu();};
  activeStatusMenu={menu,trigger,outside};trigger.setAttribute('aria-expanded','true');
  menu.querySelectorAll('[data-set-status]').forEach(button=>button.onclick=()=>{const next=button.dataset.setStatus;closeStatusMenu();if(next!==item.status)editCell(id,'status',next);});
  menu.querySelectorAll('[data-paid-at]').forEach(button=>button.onclick=()=>{closeStatusMenu();paidAtDialog([button.dataset.paidAt]);});
  setTimeout(()=>{if(activeStatusMenu?.menu===menu)document.addEventListener('pointerdown',outside,true);},0);
}
function refreshSelection() {
  $$('[data-row]').forEach(row=>row.classList.toggle('selected',selected.has(row.dataset.row)));
  $$('[data-row]').forEach(row=>row.classList.toggle('selection-start',row.classList.contains('selected')&&!row.previousElementSibling?.classList.contains('selected')));
  $$('[data-check]').forEach(box=>box.checked=selected.has(box.dataset.check));
  const count=$('#selectedCount');if(count)count.textContent=selectionLabel();
  const bulk=$('#bulkStatus');if(bulk)bulk.disabled=!selected.size;
  for(const action of ['assign','complete','invoice']){const button=$(`[data-action="${action}"]`);if(button)button.disabled=!selected.size;}
  const group=$('[data-action="group"]');if(group)group.disabled=selected.size<2;
  const project=$('[data-action="project-group"]');if(project)project.disabled=!selected.size;
}
function selectSheetRow(id,shift=false,add=false) {
  const rows=$$('[data-row]').map(row=>row.dataset.row);
  if(shift&&selectionAnchor&&rows.includes(selectionAnchor)){
    const a=rows.indexOf(selectionAnchor),b=rows.indexOf(id);
    if(!add)selected.clear();for(const rowId of rows.slice(Math.min(a,b),Math.max(a,b)+1))selected.add(rowId);
  } else if(add) {selected.has(id)?selected.delete(id):selected.add(id);selectionAnchor=id;}
  else {selected.clear();selected.add(id);selectionAnchor=id;}
  refreshSelection();
}
function activateSheetField(field) {
  if(field.tagName==='INPUT'){field.readOnly=false;field.focus();field.select();field.onblur=()=>{field.readOnly=true;field.classList.remove('editing');};}
  else {field.style.pointerEvents='auto';field.tabIndex=0;field.focus();try{field.showPicker?.();}catch{}field.onblur=()=>{field.style.pointerEvents='';field.tabIndex=-1;field.classList.remove('editing');};}
  field.classList.add('editing');
}
function materializeBlankRow(field) {
  const value=field.value.trim();if(!value)return;
  const order=Number(field.dataset.blankOrder),key=field.dataset.blankCell;
  const item=newItem(activeClient,order);
  item[key]=['quantity','rate','quotedTotal','advanceAmount'].includes(key)?Math.max(0,num(value)):value;
  if(key==='quotedTotal')item.manualTotal=true;
  if(key==='rate'||key==='quantity')item.quotedTotal=num(item.quantity)*num(item.rate);
  mutate('items',item);
}
function pasteBlankGrid(event,field) {
  const raw=event.clipboardData.getData('text/plain');if(!raw)return;event.preventDefault();
  const columns=['serial','workDate','service','quantity','rate','quotedTotal','status','advanceAmount','assigneeId','remarks'];
  const start=columns.indexOf(field.dataset.blankCell),startOrder=Number(field.dataset.blankOrder);
  for(const [offset,line] of raw.trimEnd().split(/\r?\n/).entries()){
    if(!line.trim())continue;
    const item=newItem(activeClient,startOrder+offset);
    line.split('\t').forEach((value,index)=>{const key=columns[start+index];if(!key)return;item[key]=['quantity','rate','quotedTotal','advanceAmount'].includes(key)?Math.max(0,num(value)):key==='status'?(value.trim()==='-'?'discarded':value.trim().toLowerCase()||'pending'):value;});
    if(!line.split('\t').some((_,index)=>columns[start+index]==='quotedTotal'))item.quotedTotal=num(item.quantity)*num(item.rate);
    data.items.push(item);if(item.status==='paid'){recordPaidItems([{...item,status:'pending'}]);item.paidAt=today();item.paidAtTs=new Date().toISOString();}if(num(item.advanceAmount)>0&&item.status!=='paid'){createReceipt(item.clientId,num(item.advanceAmount),`Advance · ${item.service}`,'advance',item.id);item.advanceReceivedAt=today();}enqueue('items',item.id);
  }
  save();scheduleSync();render();
}
function editCell(id, key, value) {
  const i=data.items.find(x=>x.id===id); if(!i)return;
  if(key==='status'){bulkSetStatus(value,[id]);return;}
  if(['quantity','rate','quotedTotal','advanceAmount'].includes(key)) value=Math.max(0,num(value));
  if(key==='advanceAmount'&&value>num(i.advanceAmount))createReceipt(i.clientId,value-num(i.advanceAmount),`Advance · ${i.service}`,'advance',i.id);
  if(key==='advanceAmount'&&value>0&&!i.advanceReceivedAt)i.advanceReceivedAt=today();
  i[key]=value;
  if(key==='quantity'||key==='rate') { i.manualTotal=false; i.quotedTotal=num(i.quantity)*num(i.rate); }
  if(key==='quotedTotal')i.manualTotal=true;
  mutate('items',i);
  if(i.status==='paid'||data.receipts?.some(r=>(r.referenceKind==='item'&&r.referenceId===i.id)||(r.source==='app'&&r.sourceKey==='app:'+i.id))) {
    syncItemReceipt(i);
  }
}
function pasteGrid(e,el) {
  const text=e.clipboardData.getData('text/plain'); if(!text.includes('\t')&&!text.includes('\n'))return;
  e.preventDefault(); const columns=['serial','workDate','service','quantity','rate','quotedTotal','status','advanceAmount','assigneeId','remarks']; const startCol=columns.indexOf(el.dataset.cell); if(startCol<0)return;
  const rows=text.trimEnd().split(/\r?\n/).map(r=>r.split('\t')); const items=groupedSheetItems(clientItems()); let start=items.findIndex(i=>i.id===el.dataset.id);
  for(const cells of rows) {
    let item=items[start]; if(!item){item=newItem(activeClient,items.length);items.push(item);data.items.push(item);}
    const beforeStatus=item.status,beforeAdvance=num(item.advanceAmount);
    cells.forEach((v,c)=>{const key=columns[startCol+c];if(!key)return;if(['quantity','rate','quotedTotal','advanceAmount'].includes(key))v=Math.max(0,num(v));if(key==='status')v=v.trim()==='-'?'discarded':v.trim().toLowerCase()||'pending';if(key==='advanceAmount'&&v>0&&!item.advanceReceivedAt)item.advanceReceivedAt=today();item[key]=v;});
    if(!item.manualTotal && cells.length && !cells.some((_,c)=>columns[startCol+c]==='quotedTotal'))item.quotedTotal=num(item.quantity)*num(item.rate);
    if(item.status==='paid'&&beforeStatus!=='paid'){recordPaidItems([{...item,status:beforeStatus}]);item.paidAt=today();item.paidAtTs=new Date().toISOString();}
    else if(item.status==='paid'){syncItemReceipt(item);}
    else if(item.status!=='paid'&&beforeStatus==='paid'){const r=(data.receipts||[]).find(x=>(x.referenceKind==='item'&&x.referenceId===item.id)||(x.source==='app'&&x.sourceKey==='app:'+item.id));if(r)removeReceipt(r.id);}
    else if(item.status!=='paid'&&num(item.advanceAmount)>beforeAdvance)createReceipt(item.clientId,num(item.advanceAmount)-beforeAdvance,`Advance · ${item.service}`,'advance',item.id);
    enqueue('items',item.id);start++;
  }
  save();scheduleSync();
  toast(`Pasted ${rows.length} row${rows.length===1?'':'s'}`);render();
}
function newItem(clientId,order) { return { id:uid(), clientId, groupId:null, projectGroupId:null, sourceRow:null, sortOrder:order, serial:String(order+1), workDate:today(), dueDate:'', service:'', quantity:1, rate:0, quotedTotal:0, advanceAmount:0, status:'pending', revisionCount:0, assigneeId:'', remarks:'', manualTotal:false }; }
function effectiveItemValue(item){
  const group=data.groups.find(g=>g.id===item.groupId);
  if(!group||group.agreedAmount==null||group.agreedAmount==='')return num(item.quotedTotal);
  const total=data.items.filter(i=>i.groupId===group.id&&i.status!=='discarded').reduce((sum,i)=>sum+num(i.quotedTotal),0);
  return total>0?num(group.agreedAmount)*num(item.quotedTotal)/total:num(item.quotedTotal);
}
function createReceipt(clientId,amount,description,referenceKind,referenceId,stamp=new Date().toISOString()){
  if(amount<=0)return;
  const id=uid();
  const date=(stamp&&/^\d{4}-\d{2}-\d{2}/.test(stamp))?stamp.slice(0,10):today();
  const client=data.clients.find(c=>c.id===clientId);
  const receipt={id,clientId,clientName:client?.name||'Client',amount:Math.round(amount*100)/100,receivedMonth:date.slice(0,7)+'-01',receivedOn:date,receivedAt:(stamp.length===10?stamp+'T12:00:00.000Z':stamp),source:'app',sourceKey:'app:'+id,referenceKind,referenceId,description,dateQuality:'exact'};
  data.receipts ||= [];data.receipts.push(receipt);enqueue('receipts',id);
}
function recordPaidItems(items,context=null,stamp=new Date().toISOString()){
  const unpaid=items.filter(i=>i.status!=='paid'&&i.status!=='discarded');if(!unpaid.length)return;
  if(context){
    const amount=unpaid.reduce((sum,i)=>sum+Math.max(0,effectiveItemValue(i)-num(i.advanceAmount)),0);
    createReceipt(unpaid[0].clientId,amount,context.label||'Group deal',context.kind,context.id,stamp);
    return;
  }
  const sameDeal=unpaid.every(i=>i.groupId&&i.groupId===unpaid[0].groupId&&i.groupId!=null);
  const sameProject=unpaid.every(i=>i.projectGroupId&&i.projectGroupId===unpaid[0].projectGroupId&&i.projectGroupId!=null);
  if(sameDeal){
    const g=data.groups?.find(x=>x.id===unpaid[0].groupId);
    const amount=unpaid.reduce((sum,i)=>sum+Math.max(0,effectiveItemValue(i)-num(i.advanceAmount)),0);
    createReceipt(unpaid[0].clientId,amount,g?.label||'Group deal','deal',unpaid[0].groupId,stamp);
  } else if(sameProject){
    const pg=data.projectGroups?.find(x=>x.id===unpaid[0].projectGroupId);
    const amount=unpaid.reduce((sum,i)=>sum+Math.max(0,effectiveItemValue(i)-num(i.advanceAmount)),0);
    createReceipt(unpaid[0].clientId,amount,pg?.label||'Project','project',unpaid[0].projectGroupId,stamp);
  } else {
    for(const item of unpaid){
      const amount=Math.max(0,effectiveItemValue(item)-num(item.advanceAmount));
      createReceipt(item.clientId,amount,item.service||'Work row','item',item.id,stamp);
    }
  }
}
function assign(ids) { ids.forEach(id=>{const i=data.items.find(x=>x.id===id);if(!i||i.status==='discarded')return;if(i.status==='sent'){i.status='changes';i.revisionCount=(i.revisionCount||0)+1;}else if(i.status!=='changes')i.status='working';i.paidAt=null;i.paidAtTs=null;i.assigneeId=currentUserId();queue('items',id);});selected.clear();render(); }
function markSent(ids) { bulkSetStatus('sent',ids); }
function bulkSetStatus(next,idsOverride=null,context=null,customPaidDate=null) {
  const ids=new Set(idsOverride||selected),items=data.items.filter(i=>ids.has(i.id));if(!items.length)return;
  const invoices=data.invoices.filter(inv=>(inv.itemIds||[]).some(id=>ids.has(id)));
  if(invoices.some(inv=>next!=='paid'||(inv.status==='issued'&&!(inv.itemIds||[]).every(id=>ids.has(id))))){toast('Select every row on an invoice to mark it Paid; use invoice payment tracking for other changes');return;}
  const paidDay=(next==='paid'&&customPaidDate&&/^\d{4}-\d{2}-\d{2}/.test(customPaidDate))?customPaidDate.slice(0,10):today();
  const stamp=(next==='paid'&&customPaidDate)?(paidDay+'T12:00:00.000Z'):new Date().toISOString();
  if(next==='paid'){
    const invoiced=new Set(invoices.flatMap(inv=>inv.itemIds||[]));
    for(const inv of invoices){
      if(inv.status==='issued'||customPaidDate){
        let r=(data.receipts||[]).find(x=>x.referenceKind==='invoice'&&x.referenceId===inv.id);
        if(r){
          r.receivedOn=paidDay;
          r.receivedMonth=paidDay.slice(0,7)+'-01';
          r.receivedAt=stamp;
          enqueue('receipts',r.id);
        } else {
          createReceipt(inv.clientId,Math.max(0,num(inv.finalAmount)-invoiceAdvance(inv)),`Invoice ${inv.number}`,'invoice',inv.id,stamp);
        }
        inv.status='paid';inv.paidAt=paidDay;inv.paidAtTs=stamp;inv.updatedAt=stamp;enqueue('invoices',inv.id);
      }
    }
    const nonInvoicedItems=items.filter(i=>!invoiced.has(i.id));
    if(customPaidDate){
      for(const item of nonInvoicedItems){
        const r=(data.receipts||[]).find(x=>(x.referenceKind==='item'&&x.referenceId===item.id)||(x.source==='app'&&x.sourceKey==='app:'+item.id));
        if(r){
          r.receivedOn=paidDay;
          r.receivedMonth=paidDay.slice(0,7)+'-01';
          r.receivedAt=stamp;
          enqueue('receipts',r.id);
        }
      }
      const dealIds=new Set(nonInvoicedItems.map(i=>i.groupId).filter(Boolean));
      for(const gid of dealIds){
        const r=(data.receipts||[]).find(x=>x.referenceKind==='deal'&&x.referenceId===gid);
        if(r){
          r.receivedOn=paidDay;
          r.receivedMonth=paidDay.slice(0,7)+'-01';
          r.receivedAt=stamp;
          enqueue('receipts',r.id);
        }
      }
      const projIds=new Set(nonInvoicedItems.map(i=>i.projectGroupId).filter(Boolean));
      for(const pid of projIds){
        const r=(data.receipts||[]).find(x=>x.referenceKind==='project'&&x.referenceId===pid);
        if(r){
          r.receivedOn=paidDay;
          r.receivedMonth=paidDay.slice(0,7)+'-01';
          r.receivedAt=stamp;
          enqueue('receipts',r.id);
        }
      }
      recordPaidItems(nonInvoicedItems.filter(i=>!(data.receipts||[]).some(x=>(x.referenceKind==='item'&&x.referenceId===i.id)||(x.source==='app'&&x.sourceKey==='app:'+i.id))),context,stamp);
    } else {
      recordPaidItems(nonInvoicedItems,context,stamp);
    }
  } else {
    for(const item of items){
      if(item.status==='paid'){
        const r=(data.receipts||[]).find(x=>(x.referenceKind==='item'&&x.referenceId===item.id)||(x.source==='app'&&x.sourceKey==='app:'+item.id));
        if(r)removeReceipt(r.id);
      }
    }
  }
  for(const item of items){
    let status=next;
    if(next==='working'&&item.status==='sent'){status='changes';item.revisionCount=(item.revisionCount||0)+1;}
    else if(next==='changes'&&item.status!=='changes')item.revisionCount=(item.revisionCount||0)+1;
    if(['working','changes'].includes(status))item.assigneeId ||= currentUserId();
    if(status==='paid'){
      if(item.status!=='paid'||customPaidDate){
        item.paidAt=paidDay;
        item.paidAtTs=stamp;
      }
    } else {
      item.paidAt=null;
      item.paidAtTs=null;
    }
    item.status=status;item.updatedAt=stamp;enqueue('items',item.id);
  }
  selected.clear();save();scheduleSync();render();toast(`${items.length} row${items.length===1?'':'s'} updated`);
}
function syncItemReceipt(item) {
  if (!item || !Array.isArray(data.receipts)) return;
  const r = data.receipts.find(x => 
    (x.referenceKind === 'item' && x.referenceId === item.id) ||
    (x.source === 'app' && x.sourceKey === 'app:' + item.id)
  );
  if (item.status === 'paid') {
    const client = data.clients?.find(c => c.id === item.clientId);
    const amount = Math.max(0, effectiveItemValue(item) - num(item.advanceAmount));
    const desc = item.service || 'Work row';
    const date = (item.paidAt && /^\d{4}-\d{2}-\d{2}/.test(item.paidAt)) ? item.paidAt.slice(0, 10) : today();
    const month = date.slice(0, 7) + '-01';
    const stamp = item.paidAtTs || (date + 'T12:00:00.000Z');
    if (r) {
      const changed = r.amount !== amount || r.description !== desc || r.referenceId !== item.id || r.receivedOn !== date || r.receivedMonth !== month;
      r.amount = amount;
      r.description = desc;
      r.referenceKind = 'item';
      r.referenceId = item.id;
      r.receivedOn = date;
      r.receivedMonth = month;
      r.receivedAt = stamp;
      if (client?.name) r.clientName = client.name;
      if (changed) {
        enqueue('receipts', r.id);
        save();
        scheduleSync();
      }
    } else {
      createReceipt(item.clientId, amount, desc, 'item', item.id, stamp);
    }
  } else if (r) {
    removeReceipt(r.id);
  }
}
function desktopNotify(title,body){
  try{
    if(window.desk?.notify){
      window.desk.notify(title,body);
    } else if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
      new Notification(title,{body});
    }
  }catch(err){console.warn('Desktop notification error:',err);}
}
function startTrackerItem(id){
  const item=data.items.find(x=>x.id===id);if(!item||item.status==='discarded')return;
  const user=data.members.find(m=>m.userId===(item.assigneeId||currentUserId()));
  const userName=user?.displayName||data.settings.displayName||'You';
  const client=data.clients.find(c=>c.id===item.clientId);
  const clientName=client?` for ${client.name}`:'';
  bulkSetStatus('working',[id]);
  desktopNotify('Work started',`${userName} started working on "${item.service||'work item'}"${clientName}`);
}
function updateTrackerItemStatus(id,next){
  const item=data.items.find(x=>x.id===id);if(!item)return;
  if(next==='paid-date'){paidAtDialog([id]);return;}
  if(!next||next===item.status)return;
  const user=data.members.find(m=>m.userId===(item.assigneeId||currentUserId()));
  const userName=user?.displayName||data.settings.displayName||'You';
  const client=data.clients.find(c=>c.id===item.clientId);
  const clientName=client?` for ${client.name}`:'';
  const statusLabel=next==='working'?'started working on':next==='sent'?'marked as sent to client':next==='paid'?'marked as paid':next==='changes'?'marked for changes':`updated status to ${next} for`;
  bulkSetStatus(next,[id]);
  desktopNotify('Status updated',`${userName} ${statusLabel} "${item.service||'work item'}"${clientName}`);
}
function paidAtDialog(ids){
  const targetIds=(ids&&ids.length)?ids:[...selected];
  if(!targetIds.length){toast('Select at least one row to mark Paid');return;}
  const items=data.items.filter(i=>targetIds.includes(i.id));
  const firstItem=items[0];
  const initialDate=(firstItem?.paidAt&&/^\d{4}-\d{2}-\d{2}/.test(firstItem.paidAt))?firstItem.paidAt.slice(0,10):today();
  modal('Mark paid on date',`
    <div style="display:flex;flex-direction:column;gap:12px">
      <p>Select the date payment was received. This updates the revenue and receipt records for that month.</p>
      <div class="field">
        <label for="customPaidDateInput">Payment date</label>
        <input type="date" id="customPaidDateInput" value="${initialDate}" style="font-size:14px;padding:8px 10px;border-radius:6px;border:1px solid #c8d8cd;width:100%">
      </div>
      <p class="muted" style="font-size:12px;margin:0">${items.length} row${items.length===1?'':'s'} selected · ${items.map(i=>esc(i.service||'Work row')).slice(0,3).join(', ')}${items.length>3?'...':''}</p>
    </div>
  `,`
    <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button type="button" class="small-btn" id="cancelPaidDate">Cancel</button>
      <button type="button" class="small-btn blue" id="confirmPaidDate">Record paid</button>
    </div>
  `);
  $('#cancelPaidDate').onclick=closeModal;
  $('#confirmPaidDate').onclick=()=>{
    const val=$('#customPaidDateInput')?.value;
    if(!val||!/^\d{4}-\d{2}-\d{2}/.test(val)){toast('Please choose a valid payment date');return;}
    closeModal();
    bulkSetStatus('paid',targetIds,null,val);
  };
}
function removeReceipt(id) {
  if (!id || !Array.isArray(data.receipts)) return;
  const ix = data.receipts.findIndex(r => r.id === id);
  if (ix >= 0) data.receipts.splice(ix, 1);
  if (Array.isArray(data.pending)) data.pending = data.pending.filter(p => !(p.table === 'receipts' && p.id === id));
  data.pendingDeletes ||= [];
  if (!data.pendingDeletes.some(d => d.table === 'receipts' && d.id === id)) {
    data.pendingDeletes.push({table: 'receipts', id});
  }
  save();
  scheduleSync();
  if (typeof clientApi !== 'undefined' && clientApi && session && data.settings?.workspaceId) {
    clientApi.from('payment_receipts').delete().eq('id', id).eq('workspace_id', data.settings.workspaceId)
      .then(({error}) => { if (error) console.error('Supabase delete payment_receipt error:', error); });
  }
}
function modal(title,body,footer='',wide=false) { $('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal ${wide?'wide-modal':''}"><div class="modal-head"><div><h2>${title}</h2></div><button class="close" id="closeModal">×</button></div>${body}${footer}</div></div>`;$('#closeModal').onclick=closeModal;$('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();}; }
function closeModal(){ $('#modalRoot').innerHTML=''; }
function assignPersonDialog(id) {
  const item=data.items.find(i=>i.id===id);if(!item)return;
  const members=data.members.length?data.members:[{userId:'local-me',displayName:data.settings.displayName,avatarData:data.settings.avatarData},{userId:'local-partner',displayName:data.settings.localPartner}];
  modal('Assign work',`<p>${esc(item.service||'Work row')}</p><div class="assignee-choices"><button data-assign-choice="" class="${item.assigneeId?'':'active'}"><span class="choice-avatar">—</span> Unassigned</button>${members.map(m=>`<button data-assign-choice="${esc(m.userId)}" class="${item.assigneeId===m.userId?'active':''}"><span class="choice-avatar">${avatar(m.userId,m.displayName)}</span> ${esc(m.displayName)}</button>`).join('')}</div>`);
  $$('[data-assign-choice]').forEach(button=>button.onclick=()=>{item.assigneeId=button.dataset.assignChoice;mutate('items',item);closeModal();});
}
async function saveAvatar(file) {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5_000_000){toast('Choose a PNG, JPG or WebP image under 5 MB');return;}
  const url=URL.createObjectURL(file), image=new Image();
  try {
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
    const side=Math.min(image.naturalWidth,image.naturalHeight),x=(image.naturalWidth-side)/2,y=(image.naturalHeight-side)/2;
    canvas.getContext('2d').drawImage(image,x,y,side,side,0,0,96,96);
    const avatarData=canvas.toDataURL('image/jpeg',0.82);data.settings.avatarData=avatarData;save();
    if(clientApi&&session&&data.settings.workspaceId){
      const {error}=await clientApi.from('members').update({avatar_data:avatarData}).eq('workspace_id',data.settings.workspaceId).eq('user_id',session.user.id);
      if(error)toast('Avatar saved locally; team sync failed: '+error.message);
      else {const member=data.members.find(m=>m.userId===session.user.id);if(member)member.avatarData=avatarData;}
    }
    render();toast('Avatar updated');
  } catch(error){toast('Could not read that image');}
  finally{URL.revokeObjectURL(url);}
}
async function saveCompanyLogo(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5_000_000){toast('Choose a PNG, JPG or WebP logo under 5 MB');return;}
  const url=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    const scale=Math.min(1,640/image.naturalWidth,240/image.naturalHeight),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    $$('[data-setting^="seller."]').forEach(el=>{data.settings.seller[el.dataset.setting.split('.')[1]]=el.value;});
    data.settings.seller.logoData=canvas.toDataURL('image/png');save();
    if(clientApi&&session&&data.settings.workspaceId){const {error}=await clientApi.from('workspaces').update({business:data.settings.seller}).eq('id',data.settings.workspaceId);if(error)throw error;}
    render();toast('Company logo saved');
  }catch(error){render();toast('Could not sync company logo: '+error.message);}
  finally{URL.revokeObjectURL(url);}
}
function inputValue(id){return $('#'+id)?.value.trim()||'';}
async function saveSettings(){
  $$('[data-setting]').forEach(el=>{const path=el.dataset.setting.split('.');if(path.length===2)data.settings[path[0]][path[1]]=el.value;else data.settings[path[0]]=el.value;});
  save();
  if(clientApi&&session&&data.settings.workspaceId){const [member,business]=await Promise.all([clientApi.from('members').update({display_name:data.settings.displayName}).eq('workspace_id',data.settings.workspaceId).eq('user_id',session.user.id),clientApi.from('workspaces').update({business:data.settings.seller}).eq('id',data.settings.workspaceId)]);if(member.error||business.error)toast('Saved locally; team sync failed: '+(member.error||business.error).message);else {const me=data.members.find(m=>m.userId===session.user.id);if(me)me.displayName=data.settings.displayName;}}
  render();toast('Settings saved');
}
function actions(action) {
  if(action==='import')return importWorkbook();
  if(action==='migrate')return migrateImport();
  if(action==='add-row'){const i=newItem(activeClient,clientItems().length);mutate('items',i);setTimeout(()=>document.querySelector(`[data-id="${i.id}"][data-cell="service"]`)?.focus(),80);return;}
  if(action==='assign')return assign([...selected]); if(action==='complete')return markSent([...selected]); if(action==='invoice')return invoiceDialog(); if(action==='group')return groupDialog();
  if(action==='project-group')return projectGroupDialog();
  if(action==='billing')return billingDialog(); if(action==='save-settings')return saveSettings();
  if(action==='save-connection'){data.settings.url=inputValue('supaUrl').replace(/\/$/,'');data.settings.key=inputValue('supaKey');save();setupSupabase();render();toast('Connection saved');return;}
  if(action==='sign-in')return signInDialog(); if(action==='sign-up')return signUpDialog(); if(action==='sign-out')return signOut(); if(action==='create-workspace')return createWorkspace(); if(action==='join-workspace')return joinDialog(); if(action==='sync')return syncNow();
}
async function importWorkbook() {
  try { const result=await window.desk.chooseWorkbook();if(!result)return;importPreview=prepareImportPreview(result);previewClientIndex=0;tab='import-preview';render();toast('Workbook staged for review. Nothing has been inserted.'); }
  catch(e){toast('Import failed: '+e.message);}
}
function prepareImportPreview(result) {
  if(!/^[a-f0-9]{64}$/i.test(result.fileHash||''))throw new Error('Workbook hash is missing');
  const hash=result.fileHash.toLowerCase(), batchId=uid();
  const clients=(result.clients||[]).map((raw,index)=>{
    const clientId=uid(), groups=(raw.groups||[]).map(g=>({id:uid(),sourceGroup:g.sourceGroup,label:`Rows ${g.startRow}–${g.endRow}`,startRow:g.startRow,endRow:g.endRow,agreedAmount:g.agreedAmount===null?null:num(g.agreedAmount),amountCell:g.amountCell||'',warning:g.warning||''}));
    const groupIdBySource=new Map(groups.map(g=>[g.sourceGroup,g.id]));
    const items=(raw.items||[]).map((r,order)=>({id:uid(),clientId,groupId:groupIdBySource.get(r.yellowGroup)||null,sourceRow:r.sourceRow,sortOrder:order,serial:String(r.serial||order+1),sourceDate:r.date||'',sourceQuantity:r.quantity||'',workDate:validDate(r.date)||'',dueDate:'',service:r.service||'',quantity:num(r.quantity)||1,rate:num(r.rate),quotedTotal:r.total===''?num(r.quantity)*num(r.rate):num(r.total),status:r.status==='-'?'discarded':r.status||'pending',revisionCount:0,remarks:r.remarks||'',advanceAmount:num(r.advance),advanceCell:r.advanceCell||'',paidAt:null,advanceReceivedAt:null}));
    groups.forEach(g=>{const own=items.filter(i=>i.groupId===g.id);g.itemCount=own.length;g.quotedTotal=own.reduce((n,i)=>n+num(i.quotedTotal),0);});
    return {id:clientId,name:raw.name,billing:{name:raw.name,address:'',email:'',phone:'',taxId:''},sortOrder:data.clients.length+index,groups,items};
  });
  return {batchId,fileHash:hash,fileName:result.fileName||'Workbook.xlsx',skippedSheets:result.skippedSheets||[],clients};
}
async function migrateImport() {
  const stage=importPreview;if(!stage||migrating)return;
  if(!stage.clients.length){toast('No importable client sheets found');return;}
  if(!clientApi||!session||!data.settings.workspaceId){tab='settings';render();toast('Connect to a Supabase workspace before migrating');return;}
  const duplicateNames=stage.clients.filter(c=>data.clients.some(old=>old.name.trim().toLowerCase()===c.name.trim().toLowerCase()));
  if(duplicateNames.length&&!$('#confirmDuplicates')?.checked){toast('Review and acknowledge the existing client names first');return;}
  if(stage.clients.some(c=>c.groups.some(g=>g.agreedAmount!==null&&(!Number.isFinite(g.agreedAmount)||g.agreedAmount<0)))){toast('A closed-at amount is invalid');return;}
  const payload={batch_id:stage.batchId,source_sha256:stage.fileHash,file_name:stage.fileName,clients:stage.clients.map(c=>({id:c.id,name:c.name,billing:c.billing,sort_order:c.sortOrder,groups:c.groups.map(g=>({id:g.id,label:g.label,agreed_amount:g.agreedAmount})),items:c.items.map(i=>({id:i.id,group_id:i.groupId,source_row:i.sourceRow,sort_order:i.sortOrder,serial:i.serial,work_date:i.workDate||null,due_date:null,service:i.service,quantity:i.quantity,rate:i.rate,quoted_total:i.quotedTotal,advance_amount:i.advanceAmount,status:i.status,revision_count:0,remarks:i.remarks}))}))};
  migrating=true;render();
  try { await flushPending();const {data:receipt,error}=await clientApi.rpc('migrate_workbook',{p_workspace_id:data.settings.workspaceId,p_payload:payload});if(error)throw error;const firstName=stage.clients[0]?.name;await pullRemote();importPreview=null;previewClientIndex=0;activeClient=data.clients.find(c=>c.name===firstName)?.id||data.clients[0]?.id||null;tab='sheet';render();toast(receipt?.already_imported?'This workbook was already migrated':`Migrated ${receipt?.client_count||0} clients and ${receipt?.item_count||0} rows`); }
  catch(e){toast(/migrate_workbook|PGRST202/i.test(e.message||'')?'Run setup/import-migration.sql in Supabase, then retry':'Migration failed: '+e.message);}
  finally{migrating=false;render();}
}
function newClientDialog(){modal('New client','<div class="field"><label>Client name</label><input id="newClientName" autofocus></div>','<div class="modal-actions"><button class="small-btn" id="cancelClient">Cancel</button><button class="small-btn blue" id="saveClient">Create client</button></div>');$('#cancelClient').onclick=closeModal;$('#saveClient').onclick=()=>{const name=inputValue('newClientName');if(!name)return;const c={id:uid(),name,billing:{name,address:'',email:'',phone:'',taxId:''},sortOrder:data.clients.length};mutate('clients',c);activeClient=c.id;tab='sheet';closeModal();render();};}
function billingDialog(id=activeClient){const c=data.clients.find(client=>client.id===id);if(!c)return;const b=c.billing||{};modal('Client billing details',`<p>Shown on invoices for ${esc(c.name)}.</p><div class="field"><label>Billing name</label><input id="billName" value="${esc(b.name||c.name)}"></div><div class="field"><label>Address</label><textarea id="billAddress" rows="3">${esc(b.address||'')}</textarea></div><div class="field-grid"><div class="field"><label>Email</label><input id="billEmail" value="${esc(b.email||'')}"></div><div class="field"><label>Phone</label><input id="billPhone" value="${esc(b.phone||'')}"></div></div><div class="field"><label>Tax / GST ID</label><input id="billTax" value="${esc(b.taxId||'')}"></div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveBilling">Save</button></div>`);$('#saveBilling').onclick=()=>{c.billing={name:inputValue('billName'),address:inputValue('billAddress'),email:inputValue('billEmail'),phone:inputValue('billPhone'),taxId:inputValue('billTax')};mutate('clients',c);closeModal();};}
function groupDialog(id){const chosen=id?data.items.filter(i=>i.groupId===id):data.items.filter(i=>selected.has(i.id));if(!chosen.length)return;const existing=id?data.groups.find(g=>g.id===id):null;const quote=chosen.reduce((n,i)=>n+num(i.quotedTotal),0);modal(existing?'Edit grouped deal':'Group selected rows',`<p>${chosen.length} rows · Original quote ${money(quote)}</p><div class="field"><label>Group name</label><input id="groupLabel" value="${esc(existing?.label||'Agreed deal')}"></div><div class="field"><label>Agreed final amount</label><input id="groupAmount" type="number" min="0" step="0.01" placeholder="Enter negotiated amount" value="${existing?.agreedAmount??''}"></div><div class="notice">This amount replaces the sum of row totals in revenue and payment estimates. Individual rows stay visible for work tracking.</div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveGroup">Save group</button></div>`);$('#saveGroup').onclick=()=>{const value=inputValue('groupAmount');const g=existing||{id:uid(),clientId:activeClient};g.label=inputValue('groupLabel')||'Agreed deal';g.agreedAmount=value===''?null:num(value);if(!existing)chosen.forEach(i=>{i.groupId=g.id;queue('items',i.id);});mutate('groups',g);for(const i of data.items.filter(item=>item.groupId===g.id&&item.status==='paid'))syncItemReceipt(i);selected.clear();closeModal();toast('Deal group saved');};}
function projectGroupDialog() {
  const chosen=data.items.filter(i=>selected.has(i.id));if(!chosen.length)return;
  if(new Set(chosen.map(i=>i.clientId)).size!==1){toast('Select rows from one client');return;}
  modal('Group project',`<p>Organize ${chosen.length} selected rows under one collapsible project heading.</p><div class="field"><label>Project group name</label><input id="projectGroupName" placeholder="For example, Sheena and Royston" autofocus></div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveProjectGroup">Create group</button></div>`);
  $('#saveProjectGroup').onclick=()=>{const name=inputValue('projectGroupName');if(!name){toast('Enter a group name');return;}const group={id:uid(),clientId:chosen[0].clientId,label:name};for(const item of chosen){item.projectGroupId=group.id;queue('items',item.id);}mutate('projectGroups',group);selected.clear();closeModal();toast('Project group created');};
}
function renameGroup(kind,id){const table=kind==='project'?'projectGroups':'groups',group=data[table].find(g=>g.id===id);if(!group)return;modal('Rename group',`<div class="field"><label>Group name</label><input id="renameGroupName" value="${esc(group.label)}" autofocus></div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveGroupName">Save name</button></div>`);const saveName=()=>{const label=inputValue('renameGroupName');if(!label){toast('Enter a group name');return;}group.label=label;mutate(table,group);closeModal();toast('Group renamed');};$('#saveGroupName').onclick=saveName;$('#renameGroupName').onkeydown=e=>{if(e.key==='Enter')saveName();};}
function invoiceDialog(){const items=data.items.filter(i=>selected.has(i.id));if(!items.length)return;const notReady=items.filter(i=>i.status!=='sent');if(notReady.length){toast('Select rows marked Sent for a new invoice');return;}if(items.some(i=>billedIds().has(i.id))){toast('One or more rows are already invoiced');return;}if(new Set(items.map(i=>i.clientId)).size!==1){toast('Choose rows from one client');return;}const subtotal=items.reduce((n,i)=>n+num(i.quotedTotal),0);const next=String(data.invoices.length+1).padStart(4,'0');modal('Create invoice',`<p>${items.length} finished rows from ${esc(currentClient()?.name)}.</p><div class="preview-list">${items.map((i,n)=>`<div class="list-row"><div><strong>${n+1}. ${esc(i.service)}</strong><small>${i.quantity} × ${money(i.rate)}</small></div><strong>${money(i.quotedTotal)}</strong></div>`).join('')}</div><div class="field-grid" style="margin-top:15px"><div class="field"><label>Invoice number</label><input id="invNumber" value="GIR-${new Date().getFullYear()}-${next}"></div><div class="field"><label>Issue date</label><input id="invDate" type="date" value="${today()}"></div><div class="field"><label>Discount</label><input id="invDiscount" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Agreed final amount (overrides discount)</label><input id="invFinal" type="number" min="0" step="0.01" placeholder="Optional"></div></div><div class="notice">Subtotal ${money(subtotal)}. Advances already received: ${money(items.reduce((n,i)=>n+num(i.advanceAmount),0))}. The final amount is the full agreed price; the invoice will show advances separately and deduct them from the balance due.</div>`,`<div class="modal-actions"><button class="small-btn" id="cancelInvoice">Cancel</button><button class="small-btn blue" id="createInvoice">Create invoice</button></div>`,true);$('#cancelInvoice').onclick=closeModal;$('#createInvoice').onclick=()=>{const discount=num(inputValue('invDiscount')),final=inputValue('invFinal');if(discount>subtotal){toast('Discount exceeds subtotal');return;}const amount=final===''?subtotal-discount:num(final);const invoice={id:uid(),clientId:items[0].clientId,number:inputValue('invNumber')||`GIR-${next}`,issueDate:inputValue('invDate')||today(),itemIds:items.map(i=>i.id),lines:items.map((i,n)=>({serial:n+1,service:i.service,quantity:num(i.quantity),rate:num(i.rate),total:num(i.quotedTotal)})),subtotal,discount:final===''?discount:subtotal-amount,finalAmount:amount,advanceAmount:items.reduce((n,i)=>n+num(i.advanceAmount),0),status:'issued',seller:structuredClone(data.settings.seller),buyer:structuredClone(currentClient()?.billing||{})};mutate('invoices',invoice);selected.clear();closeModal();viewInvoice(invoice.id);};}
function invoiceAdvance(i){return i.advanceAmount==null?(i.itemIds||[]).reduce((sum,id)=>sum+num(data.items.find(item=>item.id===id)?.advanceAmount),0):num(i.advanceAmount);}
function invoiceHtml(i){return `<div class="invoice-paper"><div class="invoice-top"><div><img class="invoice-company-logo" src="${esc(i.seller.logoData||'assets/gir-icon.png')}" alt="${esc(i.seller.name||'GIR')} logo"><h1>Invoice</h1><div class="muted">${esc(i.seller.name||'GIR')}</div></div><div class="invoice-meta"><div class="label">INVOICE NO.</div><strong>${esc(i.number)}</strong><p>${fmtDate(i.issueDate)}</p><span class="pill ${i.status==='paid'?'paid':'sent'}">${i.status==='paid'?'PAID':'ISSUED'}</span></div></div><div class="invoice-parties"><div><div class="label">FROM</div><strong>${esc(i.seller.name||'')}</strong><p>${esc(i.seller.address||'').replace(/\n/g,'<br>')}<br>${esc(i.seller.email||'')} ${esc(i.seller.phone||'')}<br>${esc(i.seller.taxId||'')}</p></div><div><div class="label">BILL TO</div><strong>${esc(i.buyer.name||'')}</strong><p>${esc(i.buyer.address||'').replace(/\n/g,'<br>')}<br>${esc(i.buyer.email||'')} ${esc(i.buyer.phone||'')}<br>${esc(i.buyer.taxId||'')}</p></div></div><table><thead><tr><th>#</th><th>SERVICE</th><th>QTY</th><th>RATE</th><th>TOTAL</th></tr></thead><tbody>${i.lines.map(l=>`<tr><td>${l.serial}</td><td>${esc(l.service)}</td><td>${l.quantity}</td><td>${money(l.rate)}</td><td>${money(l.total)}</td></tr>`).join('')}</tbody></table><div class="totals"><div><span>Subtotal</span><strong>${money(i.subtotal)}</strong></div><div><span>Discount / adjustment</span><strong>${money(i.discount)}</strong></div><div><span>Final agreed amount</span><strong>${money(i.finalAmount)}</strong></div><div><span>Advance received</span><strong>− ${money(invoiceAdvance(i))}</strong></div><div class="grand"><span>Balance due</span><strong>${money(i.status==='paid'?0:Math.max(0,num(i.finalAmount)-invoiceAdvance(i)))}</strong></div></div>${i.seller.bankDetails?`<div class="invoice-bank"><div class="label">BANK DETAILS · PAY GIR</div><div>${esc(i.seller.bankDetails).replace(/\n/g,'<br>')}</div></div>`:''}<div class="thankyou">Thank you for working with GIR.</div></div>`;}
function viewInvoice(id){const i=data.invoices.find(x=>x.id===id);if(!i)return;modal('Invoice preview',`<div id="invoicePreview">${invoiceHtml(i)}</div>`,`<div class="modal-actions"><button class="small-btn" id="printInvoice">Print / save PDF</button><button class="small-btn" id="deleteInvoice">Delete invoice</button>${i.status==='issued'?`<button class="small-btn blue" id="recordPayment">Record paid</button>`:''}</div>`,true);$('#printInvoice').onclick=()=>{$('#printArea')?.remove();const div=document.createElement('div');div.id='printArea';div.className='print-only';div.innerHTML=invoiceHtml(i);document.body.appendChild(div);window.desk.print().finally(()=>setTimeout(()=>div.remove(),500));};$('#deleteInvoice').onclick=()=>deleteInvoiceDialog(i.id);if($('#recordPayment'))$('#recordPayment').onclick=()=>{markInvoicePaid(i.id);closeModal();};}
function deleteInvoiceDialog(id){
  const invoice=data.invoices.find(i=>i.id===id);if(!invoice)return;
  modal('Delete invoice',`<p>Delete invoice <strong>${esc(invoice.number)}</strong>? This removes the invoice from the shared workspace and frees its rows for another invoice.</p>${invoice.status==='paid'?'<div class="notice">The recorded payment and paid work will remain in revenue.</div>':''}`,`<div class="modal-actions"><button class="small-btn" id="cancelDeleteInvoice">Cancel</button><button class="small-btn" id="confirmDeleteInvoice">Delete invoice</button></div>`);
  $('#cancelDeleteInvoice').onclick=closeModal;
  $('#confirmDeleteInvoice').onclick=async()=>{
    const button=$('#confirmDeleteInvoice');button.disabled=true;button.textContent='Deleting…';
    try{
      if(!clientApi||!session||!data.settings.workspaceId)throw new Error('Connect to the workspace before deleting an invoice');
      await flushPending();
      const {data:deleted,error}=await clientApi.from('invoices').delete().eq('id',id).eq('workspace_id',data.settings.workspaceId).select('id');
      if(error)throw error;
      if(!deleted?.length)throw new Error('Invoice was not deleted. Check workspace permissions and sync again.');
      data.invoices=data.invoices.filter(i=>i.id!==id);
      data.pending=data.pending.filter(p=>!(p.table==='invoices'&&p.id===id));
      save();closeModal();render();toast('Invoice deleted');
    }catch(error){button.disabled=false;button.textContent='Delete invoice';toast('Delete failed: '+error.message);}
  };
}
function markInvoicePaid(id){const i=data.invoices.find(x=>x.id===id);if(!i||i.status==='paid')return;const stamp=new Date().toISOString();createReceipt(i.clientId,Math.max(0,num(i.finalAmount)-invoiceAdvance(i)),`Invoice ${i.number}`,'invoice',i.id,stamp);i.status='paid';i.paidAt=today();i.paidAtTs=stamp;mutate('invoices',i);i.itemIds.forEach(itemId=>{const item=data.items.find(x=>x.id===itemId);if(item){item.status='paid';item.paidAt=i.paidAt;item.paidAtTs=stamp;queue('items',itemId);}});render();toast('Payment recorded');}

const remoteTable = { clients:'clients', groups:'deal_groups', projectGroups:'project_groups', items:'work_items', invoices:'invoices', receipts:'payment_receipts' };
function remoteRow(table, x) {
  const ws=data.settings.workspaceId;
  if(table==='clients')return {id:x.id,workspace_id:ws,name:x.name,billing:x.billing||{},sort_order:x.sortOrder||0};
  if(table==='groups')return {id:x.id,workspace_id:ws,client_id:x.clientId,label:x.label,agreed_amount:x.agreedAmount};
  if(table==='projectGroups')return {id:x.id,workspace_id:ws,client_id:x.clientId,label:x.label};
  if(table==='items')return {id:x.id,workspace_id:ws,client_id:x.clientId,group_id:x.groupId||null,project_group_id:x.projectGroupId||null,source_row:x.sourceRow||null,sort_order:x.sortOrder||0,serial:String(x.serial||''),work_date:validDate(x.workDate),due_date:validDate(x.dueDate),service:x.service||'',quantity:num(x.quantity),rate:num(x.rate),quoted_total:num(x.quotedTotal),advance_amount:num(x.advanceAmount),advance_received_at:validDate(x.advanceReceivedAt),paid_at:validDate(x.paidAt),paid_at_ts:x.paidAtTs||null,status:x.status,revision_count:x.revisionCount||0,assignee_id:x.assigneeId==='local-me'?currentUserId():isUuid(x.assigneeId)?x.assigneeId:null,remarks:x.remarks||'',updated_at:x.updatedAt||new Date().toISOString()};
  if(table==='invoices')return {id:x.id,workspace_id:ws,client_id:x.clientId,number:x.number,issue_date:validDate(x.issueDate)||today(),paid_at:validDate(x.paidAt),paid_at_ts:x.paidAtTs||null,item_ids:x.itemIds,lines:x.lines,subtotal:num(x.subtotal),discount:num(x.discount),final_amount:num(x.finalAmount),advance_amount:invoiceAdvance(x),status:x.status,seller:x.seller,buyer:x.buyer};
  if(table==='receipts')return {id:x.id,workspace_id:ws,client_id:x.clientId||null,client_name:x.clientName,amount:num(x.amount),received_month:x.receivedMonth,received_on:x.receivedOn||null,received_at:x.receivedAt||null,source:x.source,source_key:x.sourceKey,reference_kind:x.referenceKind||null,reference_id:x.referenceId||null,description:x.description||'',source_file:x.sourceFile||null,source_row:x.sourceRow||null,original_date:x.originalDate||null,date_quality:x.dateQuality||'exact'};
}
function localRow(table,x) {
  if(table==='clients')return {id:x.id,name:x.name,billing:x.billing||{},sortOrder:x.sort_order};
  if(table==='groups')return {id:x.id,clientId:x.client_id,label:x.label,agreedAmount:x.agreed_amount};
  if(table==='projectGroups')return {id:x.id,clientId:x.client_id,label:x.label};
  if(table==='items')return {id:x.id,clientId:x.client_id,groupId:x.group_id,projectGroupId:x.project_group_id,sourceRow:x.source_row,sortOrder:x.sort_order,serial:x.serial||String((x.sort_order||0)+1),workDate:x.work_date||'',dueDate:x.due_date||'',service:x.service,quantity:num(x.quantity),rate:num(x.rate),quotedTotal:num(x.quoted_total),advanceAmount:num(x.advance_amount),advanceReceivedAt:x.advance_received_at||null,paidAt:x.paid_at||null,paidAtTs:x.paid_at_ts||null,status:x.status,revisionCount:x.revision_count,assigneeId:x.assignee_id||'',remarks:x.remarks||'',manualTotal:true,updatedAt:x.updated_at};
  if(table==='invoices')return {id:x.id,clientId:x.client_id,number:x.number,issueDate:x.issue_date,paidAt:x.paid_at||null,paidAtTs:x.paid_at_ts||null,itemIds:x.item_ids||[],lines:x.lines||[],subtotal:num(x.subtotal),discount:num(x.discount),finalAmount:num(x.final_amount),advanceAmount:num(x.advance_amount),status:x.status,seller:x.seller||{},buyer:x.buyer||{}};
  if(table==='receipts')return {id:x.id,clientId:x.client_id,clientName:x.client_name,amount:num(x.amount),receivedMonth:x.received_month,receivedOn:x.received_on,receivedAt:x.received_at,source:x.source,sourceKey:x.source_key,referenceKind:x.reference_kind,referenceId:x.reference_id,description:x.description,sourceFile:x.source_file,sourceRow:x.source_row,originalDate:x.original_date,dateQuality:x.date_quality};
}
function isUuid(s){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||'');}
function validDate(s){if(!s)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const parts=String(s).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);return parts?`${parts[3]}-${parts[2].padStart(2,'0')}-${parts[1].padStart(2,'0')}`:null;}
function setupSupabase() {
  if(channel&&clientApi)clientApi.removeChannel(channel);channel=null;clientApi=null;session=null;
  authLoading=true;workspaceReady=false;
  if(!data.settings.url||!data.settings.key){authLoading=false;accessError='Supabase connection is unavailable';render();return;}
  try {
    clientApi=supabase.createClient(data.settings.url,data.settings.key,{auth:{persistSession:true,autoRefreshToken:true}});
    clientApi.auth.onAuthStateChange((_event,s)=>{
      const changed=session?.user?.id!==s?.user?.id;session=s;authLoading=false;
      if(!s){workspaceReady=false;render();return;}
      if(changed||!workspaceReady){workspaceReady=false;render();setTimeout(()=>resolveWorkspace(),0);}
    });
    clientApi.auth.getSession().then(({data:d,error})=>{authLoading=false;if(error){accessError=error.message;render();return;}session=d.session;if(session){workspaceReady=false;render();resolveWorkspace();}else render();});
  } catch(e){authLoading=false;accessError='Supabase connection failed: '+e.message;render();}
}
async function resolveWorkspace(){
  if(workspaceResolving||!clientApi||!session)return;
  workspaceResolving=true;
  try{
    const {data:membership,error}=await clientApi.from('members').select('workspace_id,display_name').eq('workspace_id',GIR_WORKSPACE_ID).eq('user_id',session.user.id).maybeSingle();
    if(error)throw error;
    data.settings.workspaceId=membership?.workspace_id||'';
    if(membership?.display_name)data.settings.displayName=membership.display_name;
    else if(session.user.user_metadata?.display_name)data.settings.displayName=session.user.user_metadata.display_name;
    workspaceReady=true;save();render();
    if(membership)await syncNow();
  }catch(error){workspaceReady=true;data.settings.workspaceId='';accessError='Could not check the workspace: '+error.message;render();}
  finally{workspaceResolving=false;}
}
async function signInDialog() {
  if(!clientApi){toast('Save the Supabase URL and publishable key first');return;}
  modal('Sign in to Supabase','<p>Use the account created in your Supabase project.</p><div class="field"><label>Email</label><input id="loginEmail" type="email"></div><div class="field"><label>Password</label><input id="loginPassword" type="password"></div>','<div class="modal-actions"><button class="small-btn blue" id="doSignIn">Sign in</button></div>');
  $('#doSignIn').onclick=async()=>{const {data:auth,error}=await clientApi.auth.signInWithPassword({email:inputValue('loginEmail'),password:$('#loginPassword').value});if(error){toast(error.message);return;}session=auth.session;closeModal();render();if(data.settings.workspaceId)syncNow();else toast('Create or join a workspace in Settings');};
}
function signUpDialog() {
  if(!clientApi){toast('Save the Supabase URL and publishable key first');return;}
  modal('Create your account','<p>Use your own email and a new password. Your teammate should create a separate account on their PC.</p><div class="field"><label>Email</label><input id="signupEmail" type="email" autocomplete="email"></div><div class="field"><label>Password</label><input id="signupPassword" type="password" autocomplete="new-password"></div><div class="field"><label>Confirm password</label><input id="signupConfirm" type="password" autocomplete="new-password"></div>','<div class="modal-actions"><button class="small-btn blue" id="doSignUp">Create account</button></div>');
  $('#doSignUp').onclick=async()=>{
    const email=inputValue('signupEmail').trim(),password=$('#signupPassword').value;
    if(!email||!password){toast('Enter your email and password');return;}
    if(password!==$('#signupConfirm').value){toast('Passwords do not match');return;}
    const {data:auth,error}=await clientApi.auth.signUp({email,password});
    if(error){toast(error.message);return;}
    session=auth.session;closeModal();render();
    toast(session?'Account created. Create your workspace in Settings.':'Check your email to confirm your account, then sign in.');
  };
}
async function signOut(){if(clientApi)await clientApi.auth.signOut();session=null;workspaceReady=false;data.settings.workspaceId='';accessMode='signin';save();render();toast('Signed out');}
async function createWorkspace(){if(!clientApi||!session){toast('Sign in first');return;}if(data.settings.workspaceId){toast('Already in a workspace');return;}const id=uid(),code=crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();const {error}=await clientApi.from('workspaces').insert({id,owner_id:session.user.id,name:'GIR Studio',join_code:code,business:data.settings.seller});if(error){toast(error.message);return;}const m=await clientApi.from('members').insert({workspace_id:id,user_id:session.user.id,display_name:data.settings.displayName,avatar_data:data.settings.avatarData||''});if(m.error){toast(m.error.message);return;}data.settings.workspaceId=id;data.settings.joinCode=code;save();render();await syncNow();toast('Workspace created. Share code '+code);}
function joinDialog(){if(!clientApi||!session){toast('Sign in first');return;}modal('Join a workspace','<p>Enter the code shown on the first PC in Settings.</p><div class="field"><label>Workspace code</label><input id="joinCode" maxlength="12"></div>','<div class="modal-actions"><button class="small-btn blue" id="doJoin">Join workspace</button></div>');$('#doJoin').onclick=async()=>{const {data:id,error}=await clientApi.rpc('join_workspace',{code:inputValue('joinCode'),name:data.settings.displayName});if(error){toast(error.message);return;}data.settings.workspaceId=id;save();closeModal();if(data.settings.avatarData)await clientApi.from('members').update({avatar_data:data.settings.avatarData}).eq('workspace_id',id).eq('user_id',session.user.id);await syncNow();toast('Joined workspace');};}
async function flushPending() {
  if(syncing||!clientApi||!session||!data.settings.workspaceId)return;
  syncing=true;let successful=false;
  try {
    if(Array.isArray(data.pendingDeletes)&&data.pendingDeletes.length){
      const deletes=[...data.pendingDeletes];
      for(const del of deletes){
        const {error}=await clientApi.from(remoteTable[del.table]||del.table).delete().eq('id',del.id).eq('workspace_id',data.settings.workspaceId);
        if(!error){data.pendingDeletes=data.pendingDeletes.filter(d=>!(d.table===del.table&&d.id===del.id));save();}
      }
    }
    for(const table of ['clients','groups','projectGroups','items','invoices','receipts']) {
      const queued=data.pending.filter(p=>p.table===table), records=queued.map(p=>data[table].find(x=>x.id===p.id)).filter(Boolean);
      for(let start=0;start<records.length;start+=100){const chunk=records.slice(start,start+100);const {error}=await clientApi.from(remoteTable[table]).upsert(chunk.map(x=>remoteRow(table,x)),{onConflict:'id'});if(error)throw error;const ids=new Set(chunk.map(x=>x.id));data.pending=data.pending.filter(p=>!(p.table===table&&ids.has(p.id)));save();}
    }
    successful=true;
  } finally { syncing=false; if(successful&&data.pending.length)scheduleSync(); }
}
async function fetchAll(table){let out=[];for(let start=0;;start+=1000){const {data:rows,error}=await clientApi.from(table).select('*').eq('workspace_id',data.settings.workspaceId).order('id').range(start,start+999);if(error)throw error;out.push(...rows);if(rows.length<1000)break;}return out;}
async function pullRemote(){if(!clientApi||!session||!data.settings.workspaceId)return;const ws=data.settings.workspaceId;const [w,m,...tables]=await Promise.all([clientApi.from('workspaces').select('*').eq('id',ws).single(),clientApi.from('members').select('*').eq('workspace_id',ws),...['clients','deal_groups','project_groups','work_items','invoices','payment_receipts'].map(fetchAll)]);if(w.error)throw w.error;if(m.error)throw m.error;data.settings.joinCode=w.data.join_code;if(w.data.business&&Object.keys(w.data.business).length)data.settings.seller={...defaults.settings.seller,...data.settings.seller,...w.data.business};data.members=m.data.map(x=>({userId:x.user_id,displayName:x.display_name,avatarData:x.avatar_data||''}));['clients','groups','projectGroups','items','invoices','receipts'].forEach((table,k)=>{const pending=new Set(data.pending.filter(p=>p.table===table).map(p=>p.id));const pendingDeletes=new Set((data.pendingDeletes||[]).filter(p=>p.table===table).map(p=>p.id));const locals=data[table].filter(x=>pending.has(x.id));data[table]=tables[k].filter(x=>!pendingDeletes.has(x.id)).map(x=>localRow(table,x));for(const local of locals){const ix=data[table].findIndex(x=>x.id===local.id);if(ix<0)data[table].push(local);else data[table][ix]=local;}});if(!activeClient || !data.clients.some(c=>c.id===activeClient))activeClient=sortedClients()[0]?.id||null;lastSyncTime=Date.now();save();render();updateSyncUI();}
function subscribe(){
  if(!clientApi||!session||!data.settings.workspaceId)return;
  if(channel)clientApi.removeChannel(channel);
  let timer;
  channel=clientApi.channel('gir-ledger-'+data.settings.workspaceId);
  for(const table of ['clients','deal_groups','project_groups','work_items','invoices','payment_receipts','members']){
    channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`workspace_id=eq.${data.settings.workspaceId}`},(payload)=>{
      if(table==='work_items'&&payload?.new){
        const item=payload.new;
        const currentItem=data.items.find(x=>x.id===item.id);
        const statusChanged=currentItem&&currentItem.status!==item.status;
        const assignee=data.members.find(m=>m.userId===item.assignee_id);
        const assigneeName=assignee?assignee.displayName:'A team member';
        if(statusChanged&&item.assignee_id&&item.assignee_id!==session?.user?.id){
          const client=data.clients.find(c=>c.id===item.client_id);
          const workName=item.service||'work item';
          const clientName=client?` (${client.name})`:'';
          if(item.status==='working'){
            desktopNotify('Work in progress',`${assigneeName} started working on "${workName}"${clientName}`);
          }else if(item.status==='changes'){
            desktopNotify('Changes requested',`${assigneeName} marked "${workName}"${clientName} for changes`);
          }else if(item.status==='sent'){
            desktopNotify('Work sent',`${assigneeName} marked "${workName}"${clientName} as sent to client`);
          }else if(item.status==='paid'){
            desktopNotify('Payment recorded',`${assigneeName} marked "${workName}"${clientName} as paid`);
          }
        }
      }
      clearTimeout(timer);
      timer=setTimeout(()=>{pullRemote().catch(e=>toast('Live refresh failed: '+e.message));},250);
    });
  }
  channel.subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')toast('Live connection interrupted; use Sync now');});
}
function updateSyncUI(){
  const btn=$('#topSyncBtn');
  const text=$('#topSyncText');
  if(!btn||!text)return;
  if(syncing){
    btn.classList.add('syncing');
    text.textContent='Syncing…';
    return;
  }
  btn.classList.remove('syncing');
  if(!session||!clientApi||!data.settings.workspaceId){
    text.textContent='Local only';
    btn.title='Not connected to Supabase workspace. Click to open settings.';
    return;
  }
  btn.title='Click to refresh / sync workspace now';
  const diffSec=Math.max(0,Math.floor((Date.now()-(lastSyncTime||Date.now()))/1000));
  if(diffSec<60){
    text.textContent='Synced just now';
  }else if(diffSec<3600){
    text.textContent=`Synced ${Math.floor(diffSec/60)}m ago`;
  }else{
    text.textContent=`Synced ${Math.floor(diffSec/3600)}h ago`;
  }
}
async function syncNow(){
  if(!clientApi||!session){toast('Sign in to Supabase first');return;}
  if(!data.settings.workspaceId){toast('Create or join a workspace first');return;}
  syncing=true;updateSyncUI();
  try{
    await flushPending();
    await pullRemote();
    subscribe();
    lastSyncTime=Date.now();
    toast('Workspace synced');
  }catch(e){
    toast('Sync failed: '+e.message);
  }finally{
    syncing=false;
    updateSyncUI();
  }
}
$('#topSyncBtn')?.addEventListener('click',()=>{
  if(!session||!data.settings.workspaceId){tab='settings';render();toast('Connect or sign in to Supabase in Settings');return;}
  syncNow();
});
if(typeof setInterval!=='undefined')setInterval(updateSyncUI,15000);

$('#newClientBtn').onclick=newClientDialog;
$('#clientList').addEventListener('wheel',e=>{const strip=e.currentTarget;if(strip.scrollWidth<=strip.clientWidth||Math.abs(e.deltaY)<=Math.abs(e.deltaX))return;strip.scrollLeft+=e.deltaY;e.preventDefault();},{passive:false});
function showUpdateState(state) {
  desktopUpdate=state;
  if($('#appVersion'))$('#appVersion').textContent=state.version ? `v${state.version}` : '';
  if($('#updateStatus'))$('#updateStatus').textContent=state.message||'';
  const button=$('#updateBtn');
  if(!button)return;
  button.textContent=state.status==='available'?'Download update':state.status==='ready'?'Restart to install':state.status==='downloading'?'Downloading…':'Check for updates';
  button.disabled=['unavailable','checking','downloading'].includes(state.status);
}
window.desk.updates.onChange(showUpdateState);
window.desk.updates.state().then(showUpdateState).catch(error=>showUpdateState({status:'error',message:error.message}));
async function updateApp(){
  try {
    if(desktopUpdate.status==='available')await window.desk.updates.download();
    else if(desktopUpdate.status==='ready')await window.desk.updates.install();
    else await window.desk.updates.check();
  } catch(error){toast('Update failed: '+error.message);}
}
$$('#tabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;selected.clear();render();});
document.addEventListener('keydown',e=>{if(e.ctrlKey&&(e.key==='+'||e.key==='='||e.key==='-')){e.preventDefault();data.settings.zoom=Math.max(70,Math.min(150,data.settings.zoom+(e.key==='-'?-10:10)));save();render();}if(e.key==='Escape'){closeStatusMenu();closeModal();}});
document.addEventListener('paste',e=>{
  if(tab!=='sheet'||!selectionCell||activeStatusMenu||$('#modalRoot').children.length)return;
  if(e.target?.matches?.('[data-cell],[data-blank-cell]'))return;
  const focused=document.activeElement;
  if(focused?.matches('input:not([readonly]),textarea,select')||focused?.isContentEditable)return;
  const value=e.clipboardData?.getData('text/plain');if(!value)return;
  if(selectionCell.blankOrder!=null){pasteBlankGrid(e,{dataset:{blankOrder:String(selectionCell.blankOrder),blankCell:selectionCell.key}});return;}
  if(!selectionCell.id)return;
  if(value.includes('\t')||value.includes('\n'))pasteGrid(e,{dataset:{id:selectionCell.id,cell:selectionCell.key}});
  else{e.preventDefault();editCell(selectionCell.id,selectionCell.key,value);}
});
(async()=>{try{const saved=await window.desk.read();if(saved)data={...structuredClone(defaults),...saved,settings:{...structuredClone(defaults.settings),...(saved.settings||{}),seller:{...defaults.settings.seller,...(saved.settings?.seller||{})}}};const topClient=sortedClients()[0]?.id;if(topClient)activeClient=topClient;render();setupSupabase();}catch(e){render();toast('Could not load local data: '+e.message);}})();
