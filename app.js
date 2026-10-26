/* MeowSheet: renderer state, sheet interaction, and Supabase sync. */
const $ = s => document.querySelector(s);
const uid = () => crypto.randomUUID();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const cleanSerial = v => { if (v == null || v === '') return ''; const s = String(v).trim(), n = Number(s); if (!isNaN(n) && Number.isInteger(n) && !s.includes('e') && !s.includes('E')) return String(n); return s.replace(/\.0+$/, ''); };
const fmtDate = d => { if (!d) return '—'; const x = new Date(d + 'T00:00:00'); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); };
const defaults = { clients:[], groups:[], projectGroups:[], items:[], invoices:[], receipts:[], members:[], pending:[], settings:{ seller:{ name:'GIR — Get It Rendered', address:'', email:'', phone:'', taxId:'', bankDetails:'', bankAccounts:[], activeBankAccountId:'', logoData:'' }, url:'https://isdxybpeagloikchhsbp.supabase.co', key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzZHh5YnBlYWdsb2lrY2hoc2JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NzkzMjcsImV4cCI6MjEwODE1NTMyN30.ll1YG9uyrTqmLzE90miCk-O1Ab5VkBPfqrCPDDUc5u8', workspaceId:'17f39873-e10f-4bdf-93ee-1f92b3e25251', displayName:'Samuel', localPartner:'Mezrid', catType:'orange', zoom:100 } };
const GIR_WORKSPACE_ID='17f39873-e10f-4bdf-93ee-1f92b3e25251';
let data = structuredClone(defaults), tab = 'sheet', lastRenderedTab = null, lastRenderedClient = null, activeClient = null, selected = new Set(), selectionAnchor = null, selectionCell = null, collapsedGroups = new Set(), blankRows = 60, highlightUser = null, filter = 'all', clientApi = null, session = null, channel = null, syncing = false, toastTimer, syncTimer, lastSyncTime = Date.now(), importPreview = null, previewClientIndex = 0, migrating = false;
let authLoading=true,workspaceReady=false,workspaceResolving=false,accessMode='signin',accessError='',activeStatusMenu=null;
let desktopUpdate = { status: 'unavailable', message: 'Checking update support…' };
const navHistory = [];
let isNavigatingBack = false;
const openTrackerClients = new Set();
let trackerClientsInitialized = false;
let trackerClientFilter = 'active';
let trackerClientSearch = '';
let rowClipboard = { mode: null, items: [], sourceRowIds: [] };

function recordNav(prevTab, prevClient) {
  if (isNavigatingBack || !prevTab) return;
  const last = navHistory[navHistory.length - 1];
  if (last && last.tab === prevTab && last.client === prevClient) return;
  navHistory.push({ tab: prevTab, client: prevClient });
  if (navHistory.length > 50) navHistory.shift();
  updateBackBtn();
}

function updateBackBtn() {
  const btn = $('#topBackBtn');
  if (btn) btn.disabled = navHistory.length === 0;
}

function goBack() {
  if (!navHistory.length) return;
  isNavigatingBack = true;
  const prev = navHistory.pop();
  if (prev) {
    if (prev.tab) tab = prev.tab;
    if (prev.client && data.clients.some(c => c.id === prev.client)) {
      activeClient = prev.client;
    }
    render();
  }
  isNavigatingBack = false;
  updateBackBtn();
}

function toast(message) { const el = $('#toast'); if(!el)return; el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000); }
function showInAppNotification(title, body = '', icon = '🔔') {
  const el = $('#toast'); if(!el)return;
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;text-align:left;">
      <span style="font-size:16px;flex:none;">${esc(icon)}</span>
      <div style="display:flex;flex-direction:column;gap:2px;overflow:hidden;">
        <strong style="font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(title)}</strong>
        ${body ? `<span style="font-size:11px;color:#cbd5e1;line-height:1.3;">${esc(body)}</span>` : ''}
      </div>
    </div>
  `;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (window.desk?.write) {
      window.desk.write(data).catch(e => toast('Could not save locally: ' + e.message));
    }
  }, 60);
}
function saveImmediate() {
  clearTimeout(saveTimer);
  if (window.desk?.write) {
    return window.desk.write(data).catch(e => toast('Could not save locally: ' + e.message));
  }
}
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
function allClientActivities() {
  const map = new Map();
  for (let c of (data.clients||[])) map.set(c.id, { pending: 0, sent: 0, active: 0 });
  const items = data.items || [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const act = map.get(item.clientId);
    if (!act) continue;
    if (item.status === 'pending' || item.status === 'working' || item.status === 'changes') {
      act.pending++;
      act.active++;
    } else if (item.status === 'sent') {
      act.sent++;
      act.active++;
    }
  }
  return map;
}
function clientActivity(clientId) {
  let pending = 0, sent = 0;
  const items = data.items || [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.clientId === clientId) {
      if (item.status === 'pending' || item.status === 'working' || item.status === 'changes') pending++;
      else if (item.status === 'sent') sent++;
    }
  }
  return { pending, sent, active: pending + sent };
}
function sortedClients() {
  const acts = allClientActivities();
  return [...data.clients].sort((a, b) => {
    const actA = acts.get(a.id) || { pending: 0, sent: 0 };
    const actB = acts.get(b.id) || { pending: 0, sent: 0 };
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
  if (!r) return 0;
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
    const dealReceipts = (data.receipts || []).filter(x => x.referenceKind === 'deal' && x.referenceId === r.referenceId);
    if (dealReceipts.length > 1 && dealReceipts[0].id !== r.id) {
      return 0;
    }
    const g = data.groups.find(x => x.id === r.referenceId);
    const dealItems = data.items.filter(i => i.groupId === r.referenceId && i.status !== 'discarded');
    if (!dealItems.length) return num(r.amount);
    const paidItems = dealItems.filter(i => i.status === 'paid');
    if (!paidItems.length) return 0;
    if (paidItems.length === dealItems.length) {
      const total = dealItems.reduce((sum, i) => sum + num(i.quotedTotal), 0);
      const agreed = (g && g.agreedAmount != null && g.agreedAmount !== '') ? num(g.agreedAmount) : total;
      const advances = dealItems.reduce((sum, i) => sum + num(i.advanceAmount), 0);
      return Math.max(0, agreed - advances);
    }
    return paidItems.reduce((sum, i) => sum + Math.max(0, effectiveItemValue(i) - num(i.advanceAmount)), 0);
  }
  if (r.referenceKind === 'project' && r.referenceId) {
    const projReceipts = (data.receipts || []).filter(x => x.referenceKind === 'project' && x.referenceId === r.referenceId);
    if (projReceipts.length > 1 && projReceipts[0].id !== r.id) {
      return 0;
    }
    const nonDealItems = data.items.filter(i => i.projectGroupId === r.referenceId && !i.groupId && i.status !== 'discarded');
    if (!nonDealItems.length) return 0;
    const paidItems = nonDealItems.filter(i => i.status === 'paid');
    if (!paidItems.length) return 0;
    return paidItems.reduce((sum, i) => sum + Math.max(0, effectiveItemValue(i) - num(i.advanceAmount)), 0);
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
  if (r.referenceKind === 'deal' && r.referenceId) {
    const g = data.groups.find(x => x.id === r.referenceId);
    if (g?.label) return g.label;
  }
  if (r.referenceKind === 'project' && r.referenceId) {
    const pg = data.projectGroups?.find(x => x.id === r.referenceId);
    if (pg?.label) return pg.label;
  }
  return r.description || (r.source === 'historical_workbook' ? 'Historical payment' : 'Payment');
}
function receiptEffectiveClientName(r) {
  const item = receiptEffectiveItem(r);
  if (item) {
    const client = data.clients.find(c => c.id === item.clientId);
    if (client?.name) return client.name;
  }
  if (r.clientId) {
    const client = data.clients.find(c => c.id === r.clientId);
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
      if(val<=0)continue;
      amount.revenue+=val;
      month(receipt.receivedMonth,'received',val);
    }
  }
  return amount;
}
function counts() { const all = data.items.filter(i=>i.status!=='discarded'), todayValue = today(); return { total:all.length, discarded:data.items.length-all.length, done:all.filter(i => ['sent','paid'].includes(i.status)).length, working:all.filter(i => ['working','changes'].includes(i.status)).length, pending:all.filter(i => i.status === 'pending').length, overdue:all.filter(i => i.dueDate && i.dueDate < todayValue && !['sent','paid'].includes(i.status)).length }; }
function render() {
  closeStatusMenu();
  const main=$('#main'), sameTab = lastRenderedTab === tab;
  const sameSheet = tab==='sheet' && sameTab && lastRenderedClient===activeClient;
  const preservedMainScroll = (sameTab && main) ? main.scrollTop : 0;
  const sheetScroll = (sameSheet && main) ? {
    grid: main.querySelector('.sheet-viewport')?.scrollTop || 0,
    across: main.querySelector('.sheet-viewport')?.scrollLeft || 0
  } : null;
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
  if(sameTab && main) main.scrollTop = preservedMainScroll;
  if(sameSheet && sheetScroll){const grid=main.querySelector('.sheet-viewport');if(grid){grid.scrollTop=sheetScroll.grid;grid.scrollLeft=sheetScroll.across;}}
  const indicator = $('#tabIndicator'), active = $(`#tabs button[data-tab="${tab}"]`);
  requestAnimationFrame(() => { indicator.style.opacity = active ? '1' : '0'; if (active) { indicator.style.left = active.offsetLeft + 'px'; indicator.style.width = active.offsetWidth + 'px'; } });
  if (lastRenderedTab && (lastRenderedTab !== tab || (tab === 'sheet' && lastRenderedClient !== activeClient))) {
    recordNav(lastRenderedTab, lastRenderedClient);
  }
  if (lastRenderedTab !== tab) { const order = ['sheet','dashboard','tracker','groups','revenue','payments','invoices','client-details','settings']; const direction = order.indexOf(tab) >= order.indexOf(lastRenderedTab) ? 'tab-next' : 'tab-prev'; $('#main').classList.remove('tab-next','tab-prev'); void $('#main').offsetWidth; $('#main').classList.add(direction); lastRenderedTab = tab; }
  if(tab==='settings')showUpdateState(desktopUpdate);
  lastRenderedClient=activeClient;bindMain();updateSyncUI();updateBackBtn();
}
function $$(s) { return [...document.querySelectorAll(s)]; }
function renderAccess(){
  const busy=authLoading||(!workspaceReady&&!!session);
  const joining=!!session&&workspaceReady&&data.settings.workspaceId!==GIR_WORKSPACE_ID;
  const heading=busy?'Connecting to MeowSheet':joining?'Join MeowSheet workspace':accessMode==='signup'?'Create your account':'Welcome to MeowSheet';
  const body=busy?'<p>Checking your account and workspace…</p>':joining?`<p>Enter the MeowSheet workspace code to access the existing clients and work.</p><form id="joinForm"><label>Workspace code<input id="accessCode" autocomplete="off" spellcheck="false" required placeholder="12-character code"></label><button type="submit" class="access-primary">Join workspace</button></form><p class="access-note">Signed in as ${esc(session.user.email)}</p><button class="access-link" id="accessSignOut">Use another account</button>`:accessMode==='signup'?`<p>Create your personal account. After email confirmation, sign in and enter the MeowSheet workspace code.</p><form id="signupForm"><label>Your name<input id="accessName" autocomplete="name" required placeholder="Your name"></label><label>Email<input id="accessEmail" type="email" autocomplete="email" required></label><label>Password<input id="accessPassword" type="password" autocomplete="new-password" minlength="6" required></label><label>Confirm password<input id="accessConfirm" type="password" autocomplete="new-password" minlength="6" required></label><button type="submit" class="access-primary">Create account</button></form><button class="access-link" id="accessSwitch">Already have an account? Sign in</button>`:`<p>Sign in to continue to your shared worksheet.</p><form id="signinForm"><label>Email<input id="accessEmail" type="email" autocomplete="email" required></label><label>Password<input id="accessPassword" type="password" autocomplete="current-password" required></label><button type="submit" class="access-primary">Sign in</button></form><button class="access-link" id="accessSwitch">New teammate? Create account</button>`;
  return `<div class="access-wrap"><div class="access-card"><img class="access-logo" src="assets/gir-icon.png" alt="MeowSheet"><h1>${heading}</h1>${body}${accessError?`<p class="access-error">${esc(accessError)}</p>`:''}</div></div>`;
}
function bindAccess(){
  $('#accessSwitch')?.addEventListener('click',()=>{accessMode=accessMode==='signup'?'signin':'signup';accessError='';render();});
  $('#accessSignOut')?.addEventListener('click',signOut);
  $('#signinForm')?.addEventListener('submit',async e=>{e.preventDefault();const email=inputValue('accessEmail'),password=$('#accessPassword').value;const {data:auth,error}=await clientApi.auth.signInWithPassword({email,password});if(error){accessError=error.message;render();return;}session=auth.session;workspaceReady=false;accessError='';render();resolveWorkspace();});
  $('#signupForm')?.addEventListener('submit',async e=>{e.preventDefault();const email=inputValue('accessEmail'),password=$('#accessPassword').value,name=inputValue('accessName');if(password!==$('#accessConfirm').value){accessError='Passwords do not match';render();return;}const {data:auth,error}=await clientApi.auth.signUp({email,password,options:{data:{display_name:name}}});if(error){accessError=error.message;render();return;}data.settings.displayName=name;save();accessError='';if(auth.session){session=auth.session;workspaceReady=false;render();resolveWorkspace();}else{accessMode='signin';accessError='Account created. Confirm your email, then sign in.';render();}});
  $('#joinForm')?.addEventListener('submit',async e=>{e.preventDefault();const code=inputValue('accessCode').toUpperCase();const {data:id,error}=await clientApi.rpc('join_gir_workspace',{code,name:data.settings.displayName||session.user.user_metadata?.display_name||'Team member'});if(error){accessError=error.message;render();return;}if(id!==GIR_WORKSPACE_ID){accessError='This code does not match the MeowSheet workspace';render();return;}data.settings.workspaceId=id;workspaceReady=true;accessError='';save();await syncNow();});
}
function renderClients() {
  const nav=$('#clientList'), position=nav?.scrollLeft || 0;
  if(!nav)return;
  const list = sortedClients();
  const acts = allClientActivities();
  if(!activeClient && list.length) activeClient = list[0].id;
  nav.innerHTML = list.map(c => {
    const act = acts.get(c.id) || { pending: 0, sent: 0 };
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
  return `<tr class="sheet-group-header ${kind}"><td colspan="11"><div class="group-heading"><button data-group-collapse="${kind}:${group.id}" aria-expanded="${!folded}"><svg class="group-chevron ${folded?'collapsed':''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 5.75 4.5 4.5 4.5-4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><strong>${esc(group.label)}</strong><span>${done}/${active.length} complete${detail}</span></button><span class="group-status ${status.toLowerCase().replaceAll(' ','-')}">${status}</span><button class="group-quick" data-group-status="${kind}:${group.id}:sent" ${!active.length?'disabled':''}>Mark sent</button><button class="group-quick" data-group-status="${kind}:${group.id}:paid" ${!active.length?'disabled':''}>Mark paid</button>${kind==='project'?`<button class="group-add" data-group-add="${group.id}" title="Add work under this project">＋ Row</button>`:''}<button class="group-rename" data-group-rename="${kind}:${group.id}" title="Rename group">Rename</button><button class="group-ungroup" data-group-ungroup="${kind}:${group.id}" title="Ungroup (keep rows, remove group)">Ungroup</button></div></td></tr>`;
}
function groupStatus(items){const active=items.filter(i=>i.status!=='discarded');if(!active.length)return 'Discarded';if(active.every(i=>i.status==='paid'))return 'Paid';if(active.every(i=>['sent','paid'].includes(i.status)))return 'Sent';if(active.some(i=>['working','changes'].includes(i.status)))return 'Working';return 'Pending';}
function blankRowHtml(order) {
  const cell=key=>`<td><input data-blank-cell="${key}" data-blank-order="${order}" value="" readonly></td>`;
  return `<tr class="blank-row" data-blank-row="${order}"><td class="row-selector"></td><td class="serial-cell">${order+1}</td>${cell('workDate')}${cell('service')}${cell('quantity')}${cell('rate')}${cell('quotedTotal')}<td class="status-cell"></td>${cell('advanceAmount')}<td class="assignee-cell"></td>${cell('remarks')}</tr>`;
}
function groupedSheetItems(items) {
  if (!items || !items.length) return [];
  const seen = new Set();
  const ordered = [];
  
  const projectItemsMap = new Map();
  const standaloneDealItemsMap = new Map();
  
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (item.projectGroupId) {
      if (!projectItemsMap.has(item.projectGroupId)) projectItemsMap.set(item.projectGroupId, []);
      projectItemsMap.get(item.projectGroupId).push(item);
    } else if (item.groupId) {
      if (!standaloneDealItemsMap.has(item.groupId)) standaloneDealItemsMap.set(item.groupId, []);
      standaloneDealItemsMap.get(item.groupId).push(item);
    }
  }

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (seen.has(item.id)) continue;

    if (item.projectGroupId) {
      const pid = item.projectGroupId;
      const projItems = projectItemsMap.get(pid) || [];
      const projDealMap = new Map();
      for (let p = 0; p < projItems.length; p++) {
        const pItem = projItems[p];
        const did = pItem.groupId || '';
        if (!projDealMap.has(did)) projDealMap.set(did, []);
        projDealMap.get(did).push(pItem);
      }
      for (let p = 0; p < projItems.length; p++) {
        const pItem = projItems[p];
        if (seen.has(pItem.id)) continue;
        const did = pItem.groupId || '';
        const cluster = projDealMap.get(did) || [pItem];
        for (let c = 0; c < cluster.length; c++) {
          const ci = cluster[c];
          if (!seen.has(ci.id)) {
            seen.add(ci.id);
            ordered.push(ci);
          }
        }
      }
    } else if (item.groupId) {
      const did = item.groupId;
      const dealCluster = standaloneDealItemsMap.get(did) || [item];
      for (let c = 0; c < dealCluster.length; c++) {
        const ci = dealCluster[c];
        if (!seen.has(ci.id)) {
          seen.add(ci.id);
          ordered.push(ci);
        }
      }
    } else {
      seen.add(item.id);
      ordered.push(item);
    }
  }
  return ordered;
}
function renderSheet() {
  const cl=currentClient();
  if(!cl)return `<div class="empty"><h3>No client yet</h3><p>Create a client using the + button beside the bottom tabs.</p></div>`;
  const all=clientItems();
  const filtered = filter==='all' ? all : all.filter(i=>i.status===filter);
  const items=groupedSheetItems(filtered);
  let rows='',projectsSeen=new Set(),dealsSeen=new Set();

  const projectGroupMap = new Map((data.projectGroups||[]).map(g => [g.id, g]));
  const dealGroupMap = new Map((data.groups||[]).map(g => [g.id, g]));

  const projectItemsMap = new Map();
  const dealItemsMap = new Map();
  for (let idx = 0; idx < all.length; idx++) {
    const it = all[idx];
    if (it.projectGroupId) {
      if (!projectItemsMap.has(it.projectGroupId)) projectItemsMap.set(it.projectGroupId, []);
      projectItemsMap.get(it.projectGroupId).push(it);
    }
    if (it.groupId) {
      if (!dealItemsMap.has(it.groupId)) dealItemsMap.set(it.groupId, []);
      dealItemsMap.get(it.groupId).push(it);
    }
  }

  for(const i of items){
    const project = i.projectGroupId ? projectGroupMap.get(i.projectGroupId) : null;
    if(project&&!projectsSeen.has(project.id)){
      projectsSeen.add(project.id);
      rows+=groupHeader('project',project,projectItemsMap.get(project.id)||[]);
    }
    if(project&&collapsedGroups.has('project:'+project.id))continue;
    const deal = i.groupId ? dealGroupMap.get(i.groupId) : null;
    const dealHeaderKey=`${project?.id||''}:${deal?.id||''}`;
    if(deal&&!dealsSeen.has(dealHeaderKey)){
      dealsSeen.add(dealHeaderKey);
      rows+=groupHeader('deal',deal,dealItemsMap.get(deal.id)||[]);
    }
    if(deal&&collapsedGroups.has('deal:'+deal.id))continue;
    const own=['working','changes'].includes(i.status)&&i.assigneeId===currentUserId();
    const other=['working','changes'].includes(i.status)&&i.assigneeId&&i.assigneeId!==currentUserId();
    const value=(key,v,extra='')=>`<td><input data-cell="${key}" data-id="${i.id}" value="${esc(v??'')}" title="${esc(v??'')}" ${extra} readonly></td>`;
    rows+=`<tr data-row="${i.id}" class="${selected.has(i.id)?'selected':''} ${i.groupId?'grouped':''} ${i.status==='paid'&&i.groupId?'paid-group':''} ${i.status==='discarded'?'discarded-row':''} ${own?'working-own':''} ${other?'working-other':''} ${i.service?'has-entry':''}">
      <td class="row-selector"><input type="checkbox" data-check="${i.id}" ${selected.has(i.id)?'checked':''}></td>
      ${value('serial',cleanSerial(i.serial??(i.sortOrder+1)))}${value('workDate',i.workDate||'')}${value('service',i.service)}${value('quantity',i.quantity)}${value('rate',i.rate)}${value('quotedTotal',i.quotedTotal,'class="money-cell"')}
      <td class="status-cell ${i.status}"><button type="button" class="status-trigger" data-status-menu="${i.id}" aria-label="Change status from ${esc(displayStatus(i))}" aria-haspopup="listbox" aria-expanded="false"><span class="status-dot"></span><span>${esc(displayStatus(i))}</span><svg class="status-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></td>
      ${value('advanceAmount',i.advanceAmount||0,'class="money-cell"')}
      <td class="assignee-cell"><button type="button" class="assignee-button" data-assignee-pick="${i.id}" title="${esc(i.assigneeId?person(i.assigneeId):'Assign person')}">${i.assigneeId?avatar(i.assigneeId,person(i.assigneeId)):'<span>＋</span>'}</button></td>
      ${value('remarks',i.remarks||'')}</tr>`;
  }
  if(filter==='all')rows+=Array.from({length:blankRows},(_,n)=>blankRowHtml(all.length+n)).join('');
  return `<div class="sheet-shell"><div class="sheet-toolbar"><div class="actions"><button class="small-btn blue" data-action="assign" ${selected.size?'':'disabled'}>● Start work</button><button class="small-btn" data-action="complete" ${selected.size?'':'disabled'}>✓ Mark sent</button><button class="small-btn" data-action="invoice" ${selected.size?'':'disabled'}>▣ Create invoice</button><button class="small-btn danger" data-action="delete" title="Delete selected row(s) (Del)" ${selected.size?'':'disabled'}>🗑 Delete row</button><button class="small-btn" data-action="undo" title="Undo (Ctrl+Z)" ${undoStack.length?'':'disabled'}>↶ Undo</button><button class="small-btn" data-action="redo" title="Redo (Ctrl+Y)" ${redoStack.length?'':'disabled'}>↷ Redo</button><button class="small-btn" data-action="group" ${selected.size>1?'':'disabled'}>Group deal</button><button class="small-btn" data-action="project-group" ${selected.size?'':'disabled'}>Group project</button><button class="small-btn" data-action="ungroup" ${hasGroupedSelected()?'':'disabled'} title="Ungroup selected row(s)">Ungroup</button><select id="bulkStatus" aria-label="Set selected rows status" ${selected.size?'':'disabled'}><option value="">Set status…</option>${['pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}">${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}<option value="paid-date">Paid on date…</option></select><select id="workFilter" aria-label="Filter work">${['all','pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}" ${filter===s?'selected':''}>${s==='all'?'All work':s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></div><span class="hint" id="selectedCount">${selectionLabel()}</span></div>
    <div class="sheet-viewport"><table class="sheet"><thead><tr><th class="row-selector"><input type="checkbox" id="selectAll" aria-label="Select visible rows"></th><th>SR</th><th>DATE</th><th>SERVICE PROVIDED</th><th>QTY</th><th>RATE</th><th>TOTAL</th><th>STATUS</th><th>ADVANCE</th><th>ASSIGNED</th><th>REMARKS</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderDeadlines() {
  const rows=data.items.filter(i=>i.dueDate && i.status!=='discarded').sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  return `<div class="section-top"><div><h2>What needs to go out</h2><p>Deadlines set directly on work rows.</p></div></div>${rows.length?`<table class="table-list"><thead><tr><th>DUE</th><th>CLIENT</th><th>WORK</th><th>ASSIGNED</th><th>STATUS</th></tr></thead><tbody>${rows.map(i=>`<tr data-jump-item="${i.id}"><td><strong>${fmtDate(i.dueDate)}</strong></td><td>${esc(data.clients.find(c=>c.id===i.clientId)?.name)}</td><td>${esc(i.service)}</td><td>${esc(person(i.assigneeId))}</td><td><span class="pill ${i.dueDate<today()&&!['paid','sent'].includes(i.status)?'overdue':i.status}">${i.dueDate<today()&&!['paid','sent'].includes(i.status)?'Overdue':displayStatus(i)}</span></td></tr>`).join('')}</tbody></table>`:`<div class="empty"><h3>No deadlines yet</h3><p>Add a due date to any row in the work sheet. Upcoming work will appear here.</p></div>`}`;
}
function renderTracker() {
  const members=data.members.length?data.members:[{userId:'local-me',displayName:data.settings.displayName},{userId:'local-partner',displayName:data.settings.localPartner}];
  const working=data.items.filter(i=>['working','changes'].includes(i.status));
  const statusRank=s=>s==='changes'?1:s==='working'?2:s==='sent'?3:4;

  const allClients=data.clients||[];
  const clientGroups=allClients.map(c=>{
    const items=data.items.filter(i=>i.clientId===c.id&&!['discarded','paid'].includes(i.status));
    const pendingItems=items.filter(i=>['pending','changes'].includes(i.status));
    const workingItems=items.filter(i=>i.status==='working');
    const sentItems=items.filter(i=>i.status==='sent');
    const unassignedItems=items.filter(i=>!i.assigneeId);
    const unassignedPending=pendingItems.filter(i=>!i.assigneeId);
    const total=items.reduce((sum,i)=>sum+(i.quotedTotal||effectiveItemValue(i)),0);
    return {
      client:c,
      items,
      pendingItems,
      workingItems,
      sentItems,
      unassignedItems,
      unassignedPending,
      pendingCount:pendingItems.length,
      sentCount:sentItems.length,
      unassignedCount:unassignedItems.length,
      total
    };
  });

  const activeGroups=clientGroups.filter(g=>g.items.length>0);
  const pendingGroups=clientGroups.filter(g=>g.pendingCount>0);
  const unassignedGroups=clientGroups.filter(g=>g.unassignedCount>0);

  let displayGroups=activeGroups;
  if(trackerClientFilter==='pending')displayGroups=pendingGroups;
  else if(trackerClientFilter==='unassigned')displayGroups=unassignedGroups;
  else if(trackerClientFilter==='all')displayGroups=clientGroups;

  if(trackerClientSearch.trim()){
    const q=trackerClientSearch.trim().toLowerCase();
    displayGroups=displayGroups.filter(g=>g.client.name.toLowerCase().includes(q));
  }

  displayGroups.sort((a,b)=>(b.pendingCount-a.pendingCount)||(b.items.length-a.items.length)||a.client.name.localeCompare(b.client.name));

  if(!trackerClientsInitialized&&displayGroups.length){
    const firstWithPending=displayGroups.find(g=>g.pendingCount>0)||displayGroups[0];
    if(firstWithPending)openTrackerClients.add(firstWithPending.client.id);
    trackerClientsInitialized=true;
  }

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
        ${showStart&&!isWorking?`<button type="button" class="small-btn blue tracker-start-btn" data-tracker-start="${i.id}">▶ Start work</button>`:showStart&&isWorking?`<span class="pill working tracker-active-badge">● In progress</span>`:''}
        <button type="button" class="tracker-status-trigger ${i.status}" data-status-menu="${i.id}" aria-label="Change status from ${esc(displayStatus(i))}" aria-haspopup="listbox" aria-expanded="false">
          <span class="status-dot"></span>
          <span>${esc(displayStatus(i))}</span>
          <svg class="status-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="small-btn tracker-view-btn" data-jump-item="${i.id}">View sheet</button>
      </div>
    </div>`;
  };

  const renderClientItemCard=(i,clientName)=>{
    const amount=i.quotedTotal||effectiveItemValue(i);
    const rateText=i.rate?`${i.quantity>1?i.quantity+' × ':''}${money(i.rate)}`:'';
    const isWorking=i.status==='working';
    const assignedPersonName=i.assigneeId?person(i.assigneeId):null;
    return `<div class="tracker-card ${i.status}">
      <div class="tracker-card-head" data-jump-item="${i.id}" title="Click to open row in worksheet">
        <div class="tracker-card-title">
          <strong>${esc(i.service||'Unnamed work')}</strong>
          <span class="tracker-card-client">${esc(clientName)}</span>
        </div>
        <div class="tracker-card-price">
          <strong>${money(amount)}</strong>
          ${rateText?`<small>${rateText}</small>`:''}
        </div>
      </div>
      <div class="tracker-card-meta">
        <span class="pill ${i.status}">${esc(displayStatus(i))}</span>
        ${assignedPersonName
          ? `<span class="tracker-assignee-badge" title="Assigned to ${esc(assignedPersonName)}"><span class="tracker-assignee-avatar">${avatar(i.assigneeId,assignedPersonName)}</span> ${esc(assignedPersonName)}</span>`
          : '<span class="tracker-unassigned-tag">Unassigned</span>'}
        ${i.dueDate?`<span class="tracker-due ${i.dueDate<today()&&!['sent','paid'].includes(i.status)?'overdue':''}">Due ${fmtDate(i.dueDate)}</span>`:''}
      </div>
      <div class="tracker-card-actions">
        ${!isWorking?`<button type="button" class="small-btn blue tracker-start-btn" data-assignee-pick="${i.id}">${i.assigneeId?'Reassign':'Assign'}</button>`:`<span class="pill working tracker-active-badge">● In progress</span>`}
        <button type="button" class="tracker-status-trigger ${i.status}" data-status-menu="${i.id}" aria-label="Change status from ${esc(displayStatus(i))}" aria-haspopup="listbox" aria-expanded="false">
          <span class="status-dot"></span>
          <span>${esc(displayStatus(i))}</span>
          <svg class="status-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="small-btn tracker-view-btn" data-jump-item="${i.id}">View sheet</button>
      </div>
    </div>`;
  };

  return `<div class="section-top">
      <div>
        <h2>Work Tracker</h2>
        <p>Live team assignments, progress, and pending work across clients.</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;"><button type="button" class="cat-team-ping-btn" data-action="cat-quick-ping" title="Send a Cat Reaction ping to your teammate">🐾 Cat Reaction Ping</button><span class="pill working">${working.length} in progress</span></div>
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
    <div class="panel tracker-unassigned-section">
      <div class="tracker-clients-section-head">
        <div>
          <h3>Client Work & Assignments <span class="muted">· ${displayGroups.length} client${displayGroups.length===1?'':'s'}</span></h3>
          <p class="muted">Review client tasks, assign team members, and track pending or sent work.</p>
        </div>
      </div>
      <div class="tracker-clients-header-actions">
        <div class="tracker-filter-pills">
          <button type="button" class="tracker-pill-btn ${trackerClientFilter==='active'?'active':''}" data-tracker-filter="active">All active (${activeGroups.length})</button>
          <button type="button" class="tracker-pill-btn ${trackerClientFilter==='pending'?'active':''}" data-tracker-filter="pending">Pending work (${pendingGroups.length})</button>
          <button type="button" class="tracker-pill-btn ${trackerClientFilter==='unassigned'?'active':''}" data-tracker-filter="unassigned">Unassigned (${unassignedGroups.length})</button>
          <button type="button" class="tracker-pill-btn ${trackerClientFilter==='all'?'active':''}" data-tracker-filter="all">All clients (${clientGroups.length})</button>
        </div>
        <div class="tracker-header-right">
          <input type="search" class="tracker-search-input" id="trackerClientSearchInput" placeholder="Search client…" value="${esc(trackerClientSearch)}" aria-label="Search client">
          <button type="button" class="small-btn tracker-accordion-btn" id="expandAllTrackerClients">Expand all</button>
          <button type="button" class="small-btn tracker-accordion-btn" id="collapseAllTrackerClients">Collapse all</button>
        </div>
      </div>
      ${displayGroups.length?`<div class="tracker-client-groups">
        ${displayGroups.map(g=>{
          const isOpen=openTrackerClients.has(g.client.id);
          return `<div class="tracker-client-card ${isOpen?'open':''}">
            <div class="tracker-client-header" data-toggle-tracker-client="${esc(g.client.id)}" title="Click to ${isOpen?'collapse':'expand'} client tasks">
              <div class="tracker-client-title">
                <span class="tracker-client-dot ${g.pendingCount>0?'has-pending':''}"></span>
                <strong>${esc(g.client.name)}</strong>
                ${g.pendingCount>0?`<span class="pill pending">${g.pendingCount} pending</span>`:''}
                ${g.sentCount>0?`<span class="pill sent">${g.sentCount} sent</span>`:''}
                ${g.unassignedCount>0?`<span class="pill unassigned-badge">${g.unassignedCount} unassigned</span>`:''}
                <span class="tracker-client-total">${money(g.total)}</span>
              </div>
              <div class="tracker-client-controls">
                <button type="button" class="small-btn tracker-open-sheet-btn" data-client-open="${esc(g.client.id)}" onclick="event.stopPropagation()">Open sheet</button>
                <span class="tracker-client-chevron">
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
              </div>
            </div>
            ${isOpen?`<div class="tracker-client-items">
              ${g.pendingItems.length?`
                <div class="tracker-subgroup-title">
                  <span class="tracker-subgroup-dot pending"></span>
                  Pending work (${g.pendingItems.length})
                </div>
                <div class="tracker-grid">
                  ${g.pendingItems.map(i=>renderClientItemCard(i,g.client.name)).join('')}
                </div>
              `:''}
              ${g.workingItems.length?`
                <div class="tracker-subgroup-title">
                  <span class="tracker-subgroup-dot working"></span>
                  In progress (${g.workingItems.length})
                </div>
                <div class="tracker-grid">
                  ${g.workingItems.map(i=>renderClientItemCard(i,g.client.name)).join('')}
                </div>
              `:''}
              ${g.sentItems.length?`
                <div class="tracker-subgroup-title">
                  <span class="tracker-subgroup-dot sent"></span>
                  Sent to client (${g.sentItems.length})
                </div>
                <div class="tracker-grid">
                  ${g.sentItems.map(i=>renderClientItemCard(i,g.client.name)).join('')}
                </div>
              `:''}
              ${!g.items.length?`<p class="muted" style="padding:10px 4px;margin:0">No active work for this client. All rows are paid or completed.</p>`:''}
            </div>`:''}
          </div>`;
        }).join('')}
      </div>`:`<div class="empty"><h3>No clients match</h3><p>Try switching filter tabs or clearing your search query.</p></div>`}
    </div>`;
}
function renderGroups() {
  const groups=[...data.projectGroups.map(g=>({...g,kind:'project'})),...data.groups.map(g=>({...g,kind:'deal'}))];
  const cards=groups.map(g=>{
    const rows=data.items.filter(i=>(g.kind==='project'?i.projectGroupId:i.groupId)===g.id);
    const active=rows.filter(i=>i.status!=='discarded');
    const done=active.filter(i=>['sent','paid'].includes(i.status)).length;
    const amount=g.kind==='deal'&&g.agreedAmount!=null?`<span>Agreed ${money(g.agreedAmount)}</span>`:'';
    return `<div class="group-card"><button class="group-card-open" data-open-group="${g.kind}:${g.id}"><span class="group-badge">${g.kind==='project'?'PROJECT GROUP':'DEAL GROUP'}</span><strong>${esc(g.label)}</strong><small>${esc(data.clients.find(c=>c.id===g.clientId)?.name)} · ${done}/${active.length} complete · ${active.length-done} left · ${groupStatus(rows)}</small>${amount}<div class="bar"><span style="width:${active.length?done/active.length*100:0}%"></span></div></button><div class="group-card-actions"><button class="group-quick" data-group-status="${g.kind}:${g.id}:sent">Mark sent</button><button class="group-quick" data-group-status="${g.kind}:${g.id}:paid">Mark paid</button></div><button class="group-card-rename" data-rename-card="${g.kind}:${g.id}" title="Rename group">Rename</button><button class="group-card-rename" data-ungroup-card="${g.kind}:${g.id}" title="Ungroup group" style="margin-left:6px">Ungroup</button><div class="group-card-editor" hidden><label>Group name<input value="${esc(g.label)}" aria-label="Group name"></label><div><button type="button" data-save-card="${g.kind}:${g.id}">Save</button><button type="button" data-cancel-card>Cancel</button></div></div></div>`;
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
    if(amt<=0)continue;
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
function renderBankAccountsList() {
  ensureBankAccounts();
  const accounts = data.settings.seller.bankAccounts || [];
  const activeId = data.settings.seller.activeBankAccountId;

  return `<div class="bank-accounts-manager">
    <div class="bank-manager-header">
      <div>
        <h4 class="bank-manager-title">Bank accounts for client payments</h4>
        <p class="bank-manager-sub">The active account is automatically placed on new client invoices.</p>
      </div>
      <button type="button" class="small-btn blue" id="addBankAccBtn">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-1px;margin-right:4px;"><path d="M8 2.5v11M2.5 8h11"/></svg>
        Add account
      </button>
    </div>
    ${!accounts.length ? `
      <div class="bank-empty-state">
        <div class="bank-avatar-icon" style="width:42px;height:42px;margin:0 auto 10px;background:#eef6f1;color:#18814f;">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 21h18M3 10h18M5 10v11M9 10v11M15 10v11M19 10v11M12 3l9 7H3l9-7z"/>
          </svg>
        </div>
        <strong style="color:#1c3927;font-size:13px;display:block;margin-bottom:3px;">No bank account configured</strong>
        <p class="muted" style="margin:0 0 12px 0;font-size:12px;">Add your bank details or UPI ID so clients know where to send payments.</p>
        <button type="button" class="small-btn blue" id="addFirstBankAccBtn">+ Add bank account</button>
      </div>
    ` : `
      <div class="bank-accounts-list">
        ${accounts.map(acc => {
          const isActive = acc.id === activeId;
          return `<div class="bank-account-card ${isActive ? 'is-active' : ''}" data-bank-card="${esc(acc.id)}" data-set-active-bank="${esc(acc.id)}">
            <div class="bank-card-main">
              <div class="bank-card-badge-col">
                <div class="bank-avatar-icon ${isActive ? 'active' : ''}">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9">
                    <path d="M3 21h18M3 10h18M5 10v11M9 10v11M15 10v11M19 10v11M12 3l9 7H3l9-7z"/>
                  </svg>
                </div>
              </div>
              <div class="bank-card-content">
                <div class="bank-card-top-row">
                  <div class="bank-title-area">
                    <span class="bank-account-label">${esc(acc.label || acc.bankName || 'Bank Account')}</span>
                    ${acc.bankName && acc.label !== acc.bankName ? `<span class="bank-institution-name">${esc(acc.bankName)}</span>` : ''}
                    ${isActive ? `<span class="bank-active-pill"><svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg> Active on invoices</span>` : ''}
                  </div>
                  <div class="bank-actions-group">
                    ${!isActive ? `<button type="button" class="bank-btn-action activate" data-set-active-bank="${esc(acc.id)}" title="Make this account active for invoices">Set active</button>` : ''}
                    <button type="button" class="bank-btn-action edit" data-edit-bank="${esc(acc.id)}" title="Edit account details">
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" style="vertical-align:-1px;margin-right:3px;"><path d="M11.5 2.5a1.5 1.5 0 0 1 2 2L4.5 13.5 1.5 14.5l1-3 9-9z"/></svg>Edit
                    </button>
                  </div>
                </div>

                <div class="bank-meta-chips">
                  ${acc.holderName ? `
                    <div class="bank-chip">
                      <span class="chip-label">A/C Holder</span>
                      <strong class="chip-val">${esc(acc.holderName)}</strong>
                    </div>
                  ` : ''}
                  ${acc.accountNumber ? `
                    <div class="bank-chip">
                      <span class="chip-label">A/C Number</span>
                      <strong class="chip-val mono">${esc(acc.accountNumber)}</strong>
                      <button type="button" class="copy-chip-btn" data-copy-val="${esc(acc.accountNumber)}" title="Copy account number">
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M5 11H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  ` : ''}
                  ${acc.ifsc ? `
                    <div class="bank-chip">
                      <span class="chip-label">IFSC</span>
                      <strong class="chip-val mono">${esc(acc.ifsc)}</strong>
                      <button type="button" class="copy-chip-btn" data-copy-val="${esc(acc.ifsc)}" title="Copy IFSC code">
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M5 11H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  ` : ''}
                  ${acc.upiId ? `
                    <div class="bank-chip upi">
                      <span class="chip-label">UPI ID</span>
                      <strong class="chip-val">${esc(acc.upiId)}</strong>
                      <button type="button" class="copy-chip-btn" data-copy-val="${esc(acc.upiId)}" title="Copy UPI ID">
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M5 11H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  ` : ''}
                </div>

                ${acc.details ? `
                  <div class="bank-custom-notes">
                    <span class="chip-label">Notes:</span>
                    <span>${esc(acc.details)}</span>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    `}
  </div>`;
}

function renderSettings() { const s=data.settings; return `<div class="section-top"><div><h2>Workspace settings</h2><p>Business details, people and Supabase connection.</p></div></div><div class="grid-2"><div class="panel"><h3>Business on invoices</h3><div class="field"><label>Business name</label><input data-setting="seller.name" value="${esc(s.seller.name)}"></div><div class="field"><label>Address</label><textarea data-setting="seller.address" rows="3">${esc(s.seller.address)}</textarea></div><div class="field-grid"><div class="field"><label>Email</label><input data-setting="seller.email" value="${esc(s.seller.email)}"></div><div class="field"><label>Phone</label><input data-setting="seller.phone" value="${esc(s.seller.phone)}"></div></div><div class="field"><label>Tax / GST ID (optional)</label><input data-setting="seller.taxId" value="${esc(s.seller.taxId)}"></div><label class="invoice-logo-upload"><span class="invoice-logo-preview">${s.seller.logoData?`<img src="${esc(s.seller.logoData)}" alt="Company logo">`:`<img src="assets/gir-icon.png" alt="Default MeowSheet logo">`}</span><span>Choose company logo</span><input id="companyLogoUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>${renderBankAccountsList()}<button class="small-btn blue" data-action="save-settings" style="margin-top:6px;">Save business details</button></div><div class="panel"><h3>Your team</h3><label class="avatar-upload"><span class="avatar">${avatar(currentUserId(),s.displayName)}</span><span>Choose your avatar image</span><input id="avatarUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label><div class="field"><label>Your display name</label><input data-setting="displayName" value="${esc(s.displayName)}"></div><div class="field"><label>Your Cat Spirit (for animated reactions & pings)</label><select data-setting="catType"><option value="orange" ${s.catType!=='black'?'selected':''}>🐱 Orange Cat (Playful & Energetic)</option><option value="black" ${s.catType==='black'?'selected':''}>🐈‍⬛ Midnight Black Cat (Cool & Mysterious)</option></select></div>${!session?`<div class="field"><label>Second person (local view)</label><input data-setting="localPartner" value="${esc(s.localPartner)}"></div>`:''}<button class="small-btn blue" data-action="save-settings">Save names</button><div class="notice">When connected, both people sign in with their own Supabase accounts. Assignments and updates then appear live on both PCs.</div></div></div>
    <div class="panel"><h3>Supabase connection</h3><div class="field-grid"><div class="field"><label>Project URL</label><input id="supaUrl" placeholder="https://project.supabase.co" value="${esc(s.url)}"></div><div class="field"><label>Publishable / anon key</label><input id="supaKey" type="password" placeholder="Never enter a service-role key" value="${esc(s.key)}"></div></div><div class="actions"><button class="small-btn" data-action="save-connection">Save connection</button>${session?`<span class="pill paid">Signed in as ${esc(session.user.email)}</span><button class="small-btn" data-action="sign-out">Sign out</button>`:`<button class="small-btn blue" data-action="sign-in">Sign in</button><button class="small-btn" data-action="sign-up">Create account</button>`}</div>${session?`<div class="notice">Workspace code: <strong>${esc(s.joinCode||'Create or join a workspace')}</strong> · Share this code with your second team member. Workspace ID: ${esc(s.workspaceId||'none')}</div><div class="actions"><button class="small-btn blue" data-action="sync">Sync now</button></div>`:''}</div><div class="panel"><h3>Desktop app</h3><p class="muted">Changes sync automatically while connected.</p><div class="actions"><button class="small-btn" data-action="sync">Sync now</button><button class="small-btn blue" id="updateBtn">Check for updates</button><span id="appVersion"></span></div><p class="muted" id="updateStatus"></p></div>`; }

function bindMain() {
  $$('[data-action]').forEach(b=>b.onclick=()=>actions(b.dataset.action));
  const backBtn=$('#topBackBtn');if(backBtn)backBtn.onclick=goBack;
  $$('[data-toggle-tracker-client]').forEach(el=>{
    el.onclick=e=>{
      e.stopPropagation();
      const cid=el.dataset.toggleTrackerClient;
      if(openTrackerClients.has(cid))openTrackerClients.delete(cid);
      else openTrackerClients.add(cid);
      render();
    };
  });
  $$('[data-tracker-filter]').forEach(b=>{
    b.onclick=e=>{
      e.stopPropagation();
      trackerClientFilter=b.dataset.trackerFilter;
      render();
    };
  });
  const searchInp=$('#trackerClientSearchInput');
  if(searchInp){
    searchInp.oninput=()=>{
      trackerClientSearch=searchInp.value;
      render();
      const nextInp=$('#trackerClientSearchInput');
      if(nextInp){
        nextInp.focus();
        nextInp.setSelectionRange(trackerClientSearch.length,trackerClientSearch.length);
      }
    };
  }
  const expAll=$('#expandAllTrackerClients');
  if(expAll){
    expAll.onclick=e=>{
      e.stopPropagation();
      $$('[data-toggle-tracker-client]').forEach(el=>openTrackerClients.add(el.dataset.toggleTrackerClient));
      render();
    };
  }
  const collAll=$('#collapseAllTrackerClients');
  if(collAll){
    collAll.onclick=e=>{
      e.stopPropagation();
      openTrackerClients.clear();
      render();
    };
  }
  const addBankBtn=$('#addBankAccBtn');if(addBankBtn)addBankBtn.onclick=()=>bankAccountDialog();
  const addFirstBankBtn=$('#addFirstBankAccBtn');if(addFirstBankBtn)addFirstBankBtn.onclick=()=>bankAccountDialog();
  $$('[data-edit-bank]').forEach(b=>b.onclick=e=>{e.stopPropagation();bankAccountDialog(b.dataset.editBank);});
  $$('[data-set-active-bank]').forEach(el=>{
    if(el.tagName==='INPUT')el.onchange=()=>setActiveBankAccount(el.dataset.setActiveBank);
    else el.onclick=e=>{if(e.target.closest('[data-edit-bank]')||e.target.closest('[data-copy-val]'))return;e.stopPropagation();setActiveBankAccount(el.dataset.setActiveBank);};
  });
  $$('[data-copy-val]').forEach(b=>{
    b.onclick=async e=>{
      e.stopPropagation();
      const val=b.dataset.copyVal;
      if(!val)return;
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText){
          await navigator.clipboard.writeText(val);
        }
        toast('Copied '+val+' to clipboard');
      }catch(err){
        toast('Copied '+val);
      }
    };
  });
  $$('[data-preview-client]').forEach(b=>b.onclick=()=>{previewClientIndex=Number(b.dataset.previewClient);render();});
  $$('[data-preview-amount]').forEach(el=>el.onchange=()=>{const group=importPreview?.clients.flatMap(c=>c.groups).find(g=>g.id===el.dataset.previewAmount);if(group){group.agreedAmount=el.value.trim()===''?null:num(el.value);render();}});
  $$('[data-preview-advance]').forEach(el=>el.onchange=()=>{const item=importPreview?.clients.flatMap(c=>c.items).find(i=>i.id===el.dataset.previewAdvance);if(item){item.advanceAmount=Math.max(0,num(el.value));render();}});
  const workFilter=$('#workFilter');if(workFilter)workFilter.onchange=()=>{filter=workFilter.value;selected.clear();render();};
  const bulkStatus=$('#bulkStatus');if(bulkStatus)bulkStatus.onchange=()=>{const next=bulkStatus.value;bulkStatus.value='';if(next==='paid-date'){paidAtDialog([...selected]);}else if(next)bulkSetStatus(next);};
  $$('[data-cat-ping]').forEach(b=>b.onclick=e=>{e.stopPropagation();const itm=data.items.find(x=>x.id===b.dataset.catPing);openCatReactionPicker(itm);});
  $$('[data-tracker-start]').forEach(b=>b.onclick=e=>{e.stopPropagation();startTrackerItem(b.dataset.trackerStart);});
  $$('[data-tracker-status]').forEach(sel=>sel.onchange=e=>{e.stopPropagation();updateTrackerItemStatus(sel.dataset.trackerStatus,sel.value);});
  $$('[data-check]').forEach(b=>{b.onclick=e=>e.stopPropagation();b.onchange=()=>{b.checked?selected.add(b.dataset.check):selected.delete(b.dataset.check);selectionAnchor=b.dataset.check;refreshSelection();};});
  const all=$('#selectAll'); if(all) all.onchange=()=>{$$('[data-check]').forEach(b=>all.checked?selected.add(b.dataset.check):selected.delete(b.dataset.check));refreshSelection();};
  $$('[data-cell]').forEach(el=>{ el.onchange=()=>editCell(el.dataset.id,el.dataset.cell,el.value); if(el.tagName==='INPUT') el.onpaste=e=>pasteGrid(e,el); });
  $$('[data-status-menu]').forEach(button=>button.onclick=e=>{
    e.stopPropagation();
    if(tab==='sheet')selectSheetRow(button.dataset.statusMenu,false,false);
    openStatusMenu(button,button.dataset.statusMenu);
  });
  $$('[data-assignee-pick]').forEach(b=>b.onclick=()=>assignPersonDialog(b.dataset.assigneePick));
  $('#avatarUpload')?.addEventListener('change',e=>{if(e.target.files?.[0])saveAvatar(e.target.files[0]);});
  $('#companyLogoUpload')?.addEventListener('change',e=>{if(e.target.files?.[0])saveCompanyLogo(e.target.files[0]);});
  $$('[data-row]').forEach(row=>{
    row.onmousedown=e=>{if(e.button===0&&e.shiftKey&&!e.target.closest('button, input.editing, input[type=checkbox]'))e.preventDefault();};
    row.onclick=e=>{if(e.target.closest('button')||e.target.matches('[type=checkbox]'))return;const field=e.target.closest('td')?.querySelector('[data-cell]');selectionCell=field?{id:row.dataset.row,key:field.dataset.cell}:null;selectSheetRow(row.dataset.row,e.shiftKey,e.ctrlKey||e.metaKey);};
    row.ondblclick=e=>{const td=e.target.closest('td'),field=td?.querySelector('[data-cell]');if(field)activateSheetField(field);};
    row.oncontextmenu=e=>{
      e.preventDefault();
      if(!selected.has(row.dataset.row))selectSheetRow(row.dataset.row,false,false);
      const rowId=row.dataset.row;
      const hasClipboard=rowClipboard.items.length>0;
      const hasGrouped = hasGroupedSelected();
      const menu=$('#contextMenu')||document.createElement('div');
      menu.id='contextMenu';menu.className='context-menu';
      menu.innerHTML=`<button id="contextCut"><span class="context-icon">✂</span><span>Cut row</span><kbd>Ctrl+X</kbd></button>`+
        `<button id="contextCopy"><span class="context-icon">⎘</span><span>Copy row</span><kbd>Ctrl+C</kbd></button>`+
        `<button id="contextPaste" ${hasClipboard?'':'disabled'}><span class="context-icon">📋</span><span>Paste row</span><kbd>Ctrl+V</kbd></button>`+
        `<button id="contextDuplicate"><span class="context-icon">⧉</span><span>Duplicate row</span><kbd>Ctrl+D</kbd></button>`+
        `<div class="context-divider"></div>`+
        `<button id="contextDelete" class="context-danger"><span class="context-icon">🗑</span><span>${selected.size>1?`Delete ${selected.size} rows`:'Delete row'}</span><kbd>Del</kbd></button>`+
        `<div class="context-divider"></div>`+
        `<button id="contextUndo" ${undoStack.length?'':'disabled'}><span class="context-icon">↶</span><span>Undo</span><kbd>Ctrl+Z</kbd></button>`+
        `<button id="contextRedo" ${redoStack.length?'':'disabled'}><span class="context-icon">↷</span><span>Redo</span><kbd>Ctrl+Y</kbd></button>`+
        `<div class="context-divider"></div>`+
        `<button id="contextUngroup" ${hasGrouped?'':'disabled'}><span class="context-icon">⎘</span><span>Ungroup rows</span></button>`+
        `<button id="contextMoveSerial"><span class="context-icon">⇄</span><span>Move to serial #…</span></button>`+
        `<button id="contextMoveUp"><span class="context-icon">↑</span><span>Move row up</span><kbd>Alt+↑</kbd></button>`+
        `<button id="contextMoveDown"><span class="context-icon">↓</span><span>Move row down</span><kbd>Alt+↓</kbd></button>`+
        `<div class="context-divider"></div>`+
        `<button id="contextAssign"><span class="context-icon">●</span><span>Start work</span></button>`+
        `<button id="contextSent"><span class="context-icon">✓</span><span>Mark sent</span></button>`+
        `<button id="contextInvoice"><span class="context-icon">▣</span><span>Create invoice</span></button>`;
      document.body.appendChild(menu);
      menu.style.left=Math.max(8,Math.min(e.clientX,innerWidth-230))+'px';
      menu.style.top=Math.max(8,Math.min(e.clientY,innerHeight-450))+'px';
      $('#contextCut').onclick=()=>{menu.remove();copySelectedRows(true);};
      $('#contextCopy').onclick=()=>{menu.remove();copySelectedRows(false);};
      if($('#contextPaste'))$('#contextPaste').onclick=()=>{menu.remove();pasteCopiedRows(rowId);};
      $('#contextDuplicate').onclick=()=>{menu.remove();duplicateSelectedRow(rowId);};
      $('#contextDelete').onclick=()=>{menu.remove();deleteSelectedRows([...selected]);};
      if($('#contextUndo'))$('#contextUndo').onclick=()=>{menu.remove();undo();};
      if($('#contextRedo'))$('#contextRedo').onclick=()=>{menu.remove();redo();};
      if($('#contextUngroup'))$('#contextUngroup').onclick=()=>{menu.remove();ungroupSelectedRows();};
      $('#contextMoveSerial').onclick=()=>{menu.remove();moveRowDialog(rowId);};
      $('#contextMoveUp').onclick=()=>{menu.remove();moveRowByDelta(rowId,-1);};
      $('#contextMoveDown').onclick=()=>{menu.remove();moveRowByDelta(rowId,1);};
      $('#contextAssign').onclick=()=>{menu.remove();assign([...selected]);};
      $('#contextSent').onclick=()=>{menu.remove();markSent([...selected]);};
      $('#contextInvoice').onclick=()=>{menu.remove();invoiceDialog();};
      setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);
    };
  });
  $$('[data-blank-row]').forEach(row=>{
    row.onclick=e=>{const field=e.target.closest('td')?.querySelector('[data-blank-cell]');selectionCell=field?{blankOrder:Number(row.dataset.blankRow),key:field.dataset.blankCell}:null;};
    row.ondblclick=e=>{const field=e.target.closest('td')?.querySelector('[data-blank-cell]');if(field)activateSheetField(field);};
    row.oncontextmenu=e=>{
      e.preventDefault();
      const blankOrder=Number(row.dataset.blankRow);
      const menu=$('#contextMenu')||document.createElement('div');
      menu.id='contextMenu';menu.className='context-menu';
      menu.innerHTML=`<button id="contextPasteBlank" ${rowClipboard.items.length?'':'disabled'}><span class="context-icon">📋</span><span>Paste row here</span><kbd>Ctrl+V</kbd></button>`+
        `<div class="context-divider"></div>`+
        `<button id="contextUndoBlank" ${undoStack.length?'':'disabled'}><span class="context-icon">↶</span><span>Undo</span><kbd>Ctrl+Z</kbd></button>`+
        `<button id="contextRedoBlank" ${redoStack.length?'':'disabled'}><span class="context-icon">↷</span><span>Redo</span><kbd>Ctrl+Y</kbd></button>`;
      document.body.appendChild(menu);
      menu.style.left=Math.max(8,Math.min(e.clientX,innerWidth-220))+'px';
      menu.style.top=Math.max(8,Math.min(e.clientY,innerHeight-140))+'px';
      if($('#contextPasteBlank'))$('#contextPasteBlank').onclick=()=>{menu.remove();pasteCopiedRows(null,blankOrder);};
      if($('#contextUndoBlank'))$('#contextUndoBlank').onclick=()=>{menu.remove();undo();};
      if($('#contextRedoBlank'))$('#contextRedoBlank').onclick=()=>{menu.remove();redo();};
      setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);
    };
  });
  $$('[data-blank-cell]').forEach(el=>{el.onchange=()=>materializeBlankRow(el);el.onpaste=e=>pasteBlankGrid(e,el);});
  $$('[data-group-collapse]').forEach(b=>b.onclick=()=>{const id=b.dataset.groupCollapse;collapsedGroups.has(id)?collapsedGroups.delete(id):collapsedGroups.add(id);render();});
  $$('[data-group-add]').forEach(b=>b.onclick=()=>{const group=data.projectGroups.find(g=>g.id===b.dataset.groupAdd);if(!group)return;const item=newItem(group.clientId,clientItems(group.clientId).length);item.projectGroupId=group.id;mutate('items',item);setTimeout(()=>{const row=document.querySelector(`[data-row="${item.id}"]`);row?.scrollIntoView({block:'center'});const field=row?.querySelector('[data-cell="service"]');if(field)activateSheetField(field);},60);});
  $$('[data-group-rename]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.groupRename.split(':');renameGroup(kind,id);});
  $$('[data-group-ungroup]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.groupUngroup.split(':');ungroupDialog(kind,id);});
  $$('[data-ungroup-card]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.ungroupCard.split(':');ungroupDialog(kind,id);});
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
    `<button type="button" class="status-option paid-at" data-paid-at="${item.id}" role="option"><span class="status-dot"></span><span>Paid on date…</span></button>`;
  document.body.appendChild(menu);
  const rect=trigger.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))+'px';
  const menuHeight=menu.offsetHeight||245;
  if(innerHeight-rect.bottom<menuHeight&&rect.top>menuHeight){
    menu.style.top=Math.max(8,rect.top-menuHeight-4)+'px';
  }else{
    menu.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-menuHeight-8))+'px';
  }
  const outside=e=>{if(!menu.contains(e.target)&&e.target!==trigger)closeStatusMenu();};
  activeStatusMenu={menu,trigger,outside};trigger.setAttribute('aria-expanded','true');
  menu.querySelectorAll('[data-set-status]').forEach(button=>button.onclick=()=>{const next=button.dataset.setStatus;closeStatusMenu();if(next!==item.status)editCell(id,'status',next);});
  menu.querySelectorAll('[data-paid-at]').forEach(button=>button.onclick=()=>{closeStatusMenu();paidAtDialog([button.dataset.paidAt]);});
  setTimeout(()=>{if(activeStatusMenu?.menu===menu)document.addEventListener('pointerdown',outside,true);},0);
}
function hasGroupedSelected() {
  if (!selected || !selected.size) return false;
  return Array.from(selected).some(id => {
    const it = (data.items || []).find(i => i.id === id);
    return it && (it.groupId || it.projectGroupId);
  });
}
function refreshSelection() {
  const rows=$$('[data-row]');
  for(let idx=0;idx<rows.length;idx++){
    const row=rows[idx];
    const isSel=selected.has(row.dataset.row);
    row.classList.toggle('selected',isSel);
    row.classList.toggle('selection-start',isSel&&!rows[idx-1]?.classList.contains('selected'));
  }
  $$('[data-check]').forEach(box=>box.checked=selected.has(box.dataset.check));
  const count=$('#selectedCount');if(count)count.textContent=selectionLabel();
  const bulk=$('#bulkStatus');if(bulk)bulk.disabled=!selected.size;
  for(const action of ['assign','complete','invoice','delete']){const button=$(`[data-action="${action}"]`);if(button)button.disabled=!selected.size;}
  const group=$('[data-action="group"]');if(group)group.disabled=selected.size<2;
  const project=$('[data-action="project-group"]');if(project)project.disabled=!selected.size;
  const ungroup=$('[data-action="ungroup"]');if(ungroup)ungroup.disabled=!hasGroupedSelected();
  updateUndoRedoUI();
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
function copySelectedRows(isCut=false) {
  if (tab!=='sheet'||!selected.size) return false;
  const allCurrent=groupedSheetItems(clientItems());
  const selectedItems=allCurrent.filter(i=>selected.has(i.id));
  if (!selectedItems.length) return false;

  rowClipboard={
    mode: isCut ? 'cut' : 'copy',
    items: selectedItems.map(i=>structuredClone(i)),
    sourceRowIds: selectedItems.map(i=>i.id)
  };

  const columns=['serial','workDate','service','quantity','rate','quotedTotal','status','advanceAmount','remarks'];
  const tsv=selectedItems.map(item=>{
    return columns.map(k=>{
      if (k==='serial') return cleanSerial(item.serial??(item.sortOrder+1));
      return item[k]??'';
    }).join('\t');
  }).join('\n');
  try {
    if (navigator.clipboard&&navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv);
    }
  } catch {}

  $$('[data-row]').forEach(r=>r.classList.remove('row-cut-pending'));
  if (isCut) {
    rowClipboard.sourceRowIds.forEach(id=>{
      document.querySelector(`[data-row="${id}"]`)?.classList.add('row-cut-pending');
    });
    toast(selectedItems.length===1?'Row cut to clipboard (Ctrl+X)':`${selectedItems.length} rows cut to clipboard`);
  } else {
    toast(selectedItems.length===1?'Row copied (Ctrl+C)':`${selectedItems.length} rows copied`);
  }
  return true;
}

const undoStack = [];
const redoStack = [];
const MAX_UNDO_STACK = 50;

function snapshotState() {
  return JSON.stringify({
    items: data.items,
    groups: data.groups,
    projectGroups: data.projectGroups,
    receipts: data.receipts,
    pendingDeletes: data.pendingDeletes,
    activeClient,
    selected: [...selected]
  });
}

function pushUndo(actionName = 'Action') {
  try {
    undoStack.push({
      name: actionName,
      state: snapshotState()
    });
    if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoUI();
  } catch (e) {
    console.error('Failed to capture undo state:', e);
  }
}

function undo() {
  if (tab !== 'sheet' && tab !== 'tracker') return false;
  if (!undoStack.length) {
    toast('Nothing to undo');
    return false;
  }
  const current = snapshotState();
  const step = undoStack.pop();
  redoStack.push({
    name: step.name,
    state: current
  });
  restoreState(step.state);
  updateUndoRedoUI();
  toast(`Undone: ${step.name} (Ctrl+Z)`);
  return true;
}

function redo() {
  if (tab !== 'sheet' && tab !== 'tracker') return false;
  if (!redoStack.length) {
    toast('Nothing to redo');
    return false;
  }
  const current = snapshotState();
  const step = redoStack.pop();
  undoStack.push({
    name: step.name,
    state: current
  });
  restoreState(step.state);
  updateUndoRedoUI();
  toast(`Redone: ${step.name} (Ctrl+Y)`);
  return true;
}

function restoreState(jsonString) {
  try {
    const snap = JSON.parse(jsonString);
    data.items = snap.items || [];
    data.groups = snap.groups || [];
    data.projectGroups = snap.projectGroups || [];
    data.receipts = snap.receipts || [];
    data.pendingDeletes = snap.pendingDeletes || [];
    if (snap.activeClient && data.clients.some(c => c.id === snap.activeClient)) {
      activeClient = snap.activeClient;
    }
    selected = new Set((snap.selected || []).filter(id => data.items.some(i => i.id === id)));
    data.items.forEach(i => enqueue('items', i.id));
    save();
    render();
    scheduleSync();
  } catch (e) {
    console.error('Failed to restore undo state:', e);
    toast('Could not restore state');
  }
}

function updateUndoRedoUI() {
  const undoBtn = $('[data-action="undo"]');
  if (undoBtn) undoBtn.disabled = !undoStack.length;
  const redoBtn = $('[data-action="redo"]');
  if (redoBtn) redoBtn.disabled = !redoStack.length;
}

function deleteSelectedRows(idsToDelete = null) {
  if (tab !== 'sheet') return false;
  const targetIds = idsToDelete 
    ? (Array.isArray(idsToDelete) ? idsToDelete : [idsToDelete]) 
    : [...selected];
  
  if (!targetIds.length) {
    toast('Select row(s) to delete');
    return false;
  }

  const count = targetIds.length;
  pushUndo(count === 1 ? 'Delete row' : `Delete ${count} rows`);

  data.pendingDeletes ||= [];
  targetIds.forEach(id => {
    if (!data.pendingDeletes.some(d => d.table === 'items' && d.id === id)) {
      data.pendingDeletes.push({ table: 'items', id });
    }
    data.pending = data.pending.filter(p => !(p.table === 'items' && p.id === id));
  });

  const deleteSet = new Set(targetIds);
  data.items = data.items.filter(i => !deleteSet.has(i.id));

  const remaining = clientItems(activeClient);
  remaining.forEach((item, idx) => {
    item.sortOrder = idx;
    item.serial = cleanSerial(String(idx + 1));
    item.updatedAt = new Date().toISOString();
    enqueue('items', item.id);
  });

  targetIds.forEach(id => selected.delete(id));
  if (selectionCell && targetIds.includes(selectionCell.id)) selectionCell = null;
  if (rowClipboard.sourceRowIds.some(id => targetIds.includes(id))) {
    rowClipboard.sourceRowIds = rowClipboard.sourceRowIds.filter(id => !targetIds.includes(id));
    if (!rowClipboard.sourceRowIds.length) rowClipboard.mode = 'copy';
  }

  consolidateAllReceipts();
  save();
  render();
  scheduleSync();
  toast(count === 1 ? 'Row deleted (Ctrl+Z to undo)' : `${count} rows deleted (Ctrl+Z to undo)`);
  return true;
}

function pasteCopiedRows(targetId=null,targetBlankOrder=null) {
  if (tab!=='sheet') return false;
  if (!rowClipboard.items.length) {
    toast('No rows in clipboard to paste');
    return false;
  }
  const isCut=rowClipboard.mode==='cut';
  pushUndo(isCut ? 'Move row (pasted from cut)' : 'Paste rows');

  const items=groupedSheetItems(clientItems());
  let targetIndex=-1;
  if (targetId) {
    targetIndex=items.findIndex(i=>i.id===targetId);
  } else if (selected.size) {
    const firstSelected=[...selected][0];
    targetIndex=items.findIndex(i=>i.id===firstSelected);
  }

  if (targetIndex<0) {
    targetIndex=items.length;
  }

  const copiedItems=rowClipboard.items;

  copiedItems.forEach((copied,offset)=>{
    const destIndex=targetIndex+offset;
    let target=items[destIndex];
    if (!target) {
      target=newItem(activeClient,items.length);
      items.push(target);
      data.items.push(target);
    }
    target.service=copied.service||'';
    target.quantity=copied.quantity!=null?copied.quantity:1;
    target.rate=copied.rate!=null?copied.rate:0;
    target.quotedTotal=copied.quotedTotal!=null?copied.quotedTotal:(num(target.quantity)*num(target.rate));
    target.manualTotal=!!copied.manualTotal;
    target.status=copied.status||'pending';
    target.advanceAmount=copied.advanceAmount||0;
    target.assigneeId=copied.assigneeId||'';
    target.remarks=copied.remarks||'';
    target.dueDate=copied.dueDate||'';
    target.updatedAt=new Date().toISOString();
    enqueue('items',target.id);
  });

  if (isCut&&rowClipboard.sourceRowIds.length) {
    rowClipboard.sourceRowIds.forEach(srcId=>{
      if (copiedItems.some((_,o)=>items[targetIndex+o]?.id===srcId)) return;
      const src=data.items.find(i=>i.id===srcId);
      if (src) {
        src.service='';
        src.quantity=1;
        src.rate=0;
        src.quotedTotal=0;
        src.manualTotal=false;
        src.status='pending';
        src.advanceAmount=0;
        src.assigneeId='';
        src.remarks='';
        src.dueDate='';
        src.updatedAt=new Date().toISOString();
        enqueue('items',src.id);
      }
    });
    rowClipboard.mode='copy';
    $$('[data-row]').forEach(r=>r.classList.remove('row-cut-pending'));
    toast('Row moved (pasted from cut)');
  } else {
    toast(copiedItems.length===1?'Row pasted (Ctrl+V)':`${copiedItems.length} rows pasted`);
  }

  consolidateAllReceipts();
  save();
  render();
  scheduleSync();
  return true;
}

function duplicateSelectedRow(itemId) {
  const all=clientItems(activeClient);
  const index=all.findIndex(i=>i.id===itemId);
  if (index<0) return;
  pushUndo('Duplicate row');
  const original=all[index];
  const duplicate=structuredClone(original);
  duplicate.id=uid();
  duplicate.updatedAt=new Date().toISOString();
  all.splice(index+1,0,duplicate);
  data.items.push(duplicate);
  all.forEach((item,idx)=>{
    item.sortOrder=idx;
    item.serial=cleanSerial(String(idx+1));
    item.updatedAt=new Date().toISOString();
    enqueue('items',item.id);
  });
  consolidateAllReceipts();
  save();
  render();
  scheduleSync();
  setTimeout(()=>{
    const el=document.querySelector(`[data-row="${duplicate.id}"]`);
    el?.scrollIntoView({block:'center',behavior:'smooth'});
    selectSheetRow(duplicate.id,false,false);
  },60);
  toast('Row duplicated (Ctrl+D)');
}

function moveRowToPosition(itemId,targetPosition) {
  const all=clientItems(activeClient);
  const currentIndex=all.findIndex(i=>i.id===itemId);
  if (currentIndex<0) return;
  const newIndex=Math.max(0,Math.min(all.length-1,targetPosition-1));
  if (currentIndex===newIndex) return;

  pushUndo('Move row to #' + targetPosition);
  const [moved]=all.splice(currentIndex,1);
  all.splice(newIndex,0,moved);

  all.forEach((item,idx)=>{
    item.sortOrder=idx;
    item.serial=cleanSerial(String(idx+1));
    item.updatedAt=new Date().toISOString();
    enqueue('items',item.id);
  });

  consolidateAllReceipts();
  save();
  render();
  scheduleSync();
  setTimeout(()=>{
    const el=document.querySelector(`[data-row="${itemId}"]`);
    el?.scrollIntoView({block:'center',behavior:'smooth'});
    selectSheetRow(itemId,false,false);
  },60);
  toast(`Moved row to serial #${newIndex+1}`);
}

function moveRowByDelta(itemId,delta) {
  const all=clientItems(activeClient);
  const currentIndex=all.findIndex(i=>i.id===itemId);
  if (currentIndex<0) return;
  const targetIndex=currentIndex+delta;
  if (targetIndex<0||targetIndex>=all.length) return;
  moveRowToPosition(itemId,targetIndex+1);
}

function moveRowDialog(itemId) {
  const all=clientItems(activeClient);
  const index=all.findIndex(i=>i.id===itemId);
  if (index<0) return;
  const currentSerial=cleanSerial(all[index].serial??(index+1));
  const item=all[index];
  modal('Move row position', `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <p style="margin:0;font-size:13px;color:#283e30;">
        Moving: <strong>#${currentSerial} · ${esc(item.service||'Untitled row')}</strong>
      </p>
      <div class="field">
        <label for="moveRowSerialInput">Enter new serial number (1 to ${all.length}):</label>
        <input id="moveRowSerialInput" type="number" min="1" max="${all.length}" value="${currentSerial}" autofocus>
      </div>
    </div>
  `, `
    <div class="modal-actions">
      <button type="button" class="small-btn" id="cancelMoveRow">Cancel</button>
      <button type="button" class="small-btn blue" id="confirmMoveRow">Move row</button>
    </div>
  `);

  $('#cancelMoveRow').onclick=closeModal;
  const handleMove=()=>{
    const val=Number($('#moveRowSerialInput')?.value);
    if (!val||val<1||val>all.length) {
      toast(`Please enter a valid serial number between 1 and ${all.length}`);
      return;
    }
    closeModal();
    moveRowToPosition(itemId,val);
  };
  $('#confirmMoveRow').onclick=handleMove;
  $('#moveRowSerialInput')?.addEventListener('keydown',e=>{
    if (e.key==='Enter') {
      e.preventDefault();
      handleMove();
    }
  });
}

function newItem(clientId,order) { return { id:uid(), clientId, groupId:null, projectGroupId:null, sourceRow:null, sortOrder:order, serial:cleanSerial(String(order+1)), workDate:today(), dueDate:'', service:'', quantity:1, rate:0, quotedTotal:0, advanceAmount:0, status:'pending', revisionCount:0, assigneeId:'', remarks:'', manualTotal:false }; }
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
function syncDealReceipt(groupId, stamp = new Date().toISOString()) {
  if (!groupId || !Array.isArray(data.receipts)) return;
  const g = (data.groups || []).find(x => x.id === groupId);
  if (!g) return;
  const dealItems = (data.items || []).filter(i => i.groupId === groupId && i.status !== 'discarded');
  const paidItems = dealItems.filter(i => i.status === 'paid');
  const existing = data.receipts.filter(r => r.referenceKind === 'deal' && r.referenceId === groupId);

  if (!paidItems.length) {
    existing.forEach(r => removeReceipt(r.id));
    return;
  }

  let amount = 0;
  if (paidItems.length === dealItems.length && dealItems.length > 0) {
    const total = dealItems.reduce((sum, i) => sum + num(i.quotedTotal), 0);
    const agreed = (g.agreedAmount != null && g.agreedAmount !== '') ? num(g.agreedAmount) : total;
    const advances = dealItems.reduce((sum, i) => sum + num(i.advanceAmount), 0);
    amount = Math.max(0, agreed - advances);
  } else {
    amount = paidItems.reduce((sum, i) => sum + Math.max(0, effectiveItemValue(i) - num(i.advanceAmount)), 0);
  }
  amount = Math.round(amount * 100) / 100;

  const paidDates = paidItems.map(i => i.paidAt).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d || ''));
  paidDates.sort();
  const date = paidDates.length ? paidDates[paidDates.length - 1] : ((stamp && /^\d{4}-\d{2}-\d{2}/.test(stamp)) ? stamp.slice(0, 10) : today());
  const month = date.slice(0, 7) + '-01';
  const fullStamp = (stamp && stamp.length === 10 ? stamp + 'T12:00:00.000Z' : stamp);
  const client = (data.clients || []).find(c => c.id === g.clientId);
  const desc = g.label || 'Agreed deal';

  if (existing.length) {
    const primary = existing[0];
    const changed = primary.amount !== amount || primary.description !== desc || primary.receivedOn !== date || primary.receivedMonth !== month;
    primary.amount = amount;
    primary.description = desc;
    primary.receivedOn = date;
    primary.receivedMonth = month;
    primary.receivedAt = fullStamp;
    if (client?.name) primary.clientName = client.name;
    if (changed) enqueue('receipts', primary.id);
    for (let k = 1; k < existing.length; k++) {
      removeReceipt(existing[k].id);
    }
  } else if (amount > 0) {
    createReceipt(g.clientId, amount, desc, 'deal', groupId, fullStamp);
  }

  for (const item of dealItems) {
    const r = data.receipts.find(x => (x.referenceKind === 'item' && x.referenceId === item.id) || (x.source === 'app' && x.sourceKey === 'app:' + item.id));
    if (r) removeReceipt(r.id);
  }
}
function syncProjectReceipt(projectGroupId, stamp = new Date().toISOString()) {
  if (!projectGroupId || !Array.isArray(data.receipts)) return;
  const pg = (data.projectGroups || []).find(x => x.id === projectGroupId);
  if (!pg) return;
  const nonDealItems = (data.items || []).filter(i => i.projectGroupId === projectGroupId && !i.groupId && i.status !== 'discarded');
  const paidItems = nonDealItems.filter(i => i.status === 'paid');
  const existing = data.receipts.filter(r => r.referenceKind === 'project' && r.referenceId === projectGroupId);

  if (!paidItems.length) {
    existing.forEach(r => removeReceipt(r.id));
    return;
  }

  const amount = Math.round(paidItems.reduce((sum, i) => sum + Math.max(0, effectiveItemValue(i) - num(i.advanceAmount)), 0) * 100) / 100;
  const paidDates = paidItems.map(i => i.paidAt).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d || ''));
  paidDates.sort();
  const date = paidDates.length ? paidDates[paidDates.length - 1] : ((stamp && /^\d{4}-\d{2}-\d{2}/.test(stamp)) ? stamp.slice(0, 10) : today());
  const month = date.slice(0, 7) + '-01';
  const fullStamp = (stamp && stamp.length === 10 ? stamp + 'T12:00:00.000Z' : stamp);
  const client = (data.clients || []).find(c => c.id === pg.clientId);
  const desc = pg.label || 'Project';

  if (existing.length) {
    const primary = existing[0];
    const changed = primary.amount !== amount || primary.description !== desc || primary.receivedOn !== date || primary.receivedMonth !== month;
    primary.amount = amount;
    primary.description = desc;
    primary.receivedOn = date;
    primary.receivedMonth = month;
    primary.receivedAt = fullStamp;
    if (client?.name) primary.clientName = client.name;
    if (changed) enqueue('receipts', primary.id);
    for (let k = 1; k < existing.length; k++) {
      removeReceipt(existing[k].id);
    }
  } else if (amount > 0) {
    createReceipt(pg.clientId, amount, desc, 'project', projectGroupId, fullStamp);
  }

  for (const item of nonDealItems) {
    const r = data.receipts.find(x => (x.referenceKind === 'item' && x.referenceId === item.id) || (x.source === 'app' && x.sourceKey === 'app:' + item.id));
    if (r) removeReceipt(r.id);
  }
}
function consolidateAllReceipts() {
  if (!Array.isArray(data.receipts) || !data.receipts.length) return;
  const dealGroups = new Map();
  for (const r of data.receipts) {
    if (r.referenceKind === 'deal' && r.referenceId) {
      if (!dealGroups.has(r.referenceId)) dealGroups.set(r.referenceId, []);
      dealGroups.get(r.referenceId).push(r);
    }
  }
  for (const [gid] of dealGroups.entries()) {
    syncDealReceipt(gid);
  }
  const projectReceiptsMap = new Map();
  for (const r of data.receipts) {
    if (r.referenceKind === 'project' && r.referenceId) {
      if (!projectReceiptsMap.has(r.referenceId)) projectReceiptsMap.set(r.referenceId, []);
      projectReceiptsMap.get(r.referenceId).push(r);
    }
  }
  for (const [pid] of projectReceiptsMap.entries()) {
    syncProjectReceipt(pid);
  }
}
function syncItemReceipt(item) {
  if (!item || !Array.isArray(data.receipts)) return;
  if (item.groupId) {
    syncDealReceipt(item.groupId);
    return;
  }
  if (item.projectGroupId && data.receipts.some(r => r.referenceKind === 'project' && r.referenceId === item.projectGroupId)) {
    syncProjectReceipt(item.projectGroupId);
    return;
  }
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
function recordPaidItems(items, context = null, stamp = new Date().toISOString()) {
  const targetItems = items.filter(i => i.status === 'paid' || i.status !== 'discarded');
  if (!targetItems.length) return;

  const dealIds = new Set();
  const projectIds = new Set();
  const standaloneItems = [];

  for (const item of targetItems) {
    if (item.groupId) {
      dealIds.add(item.groupId);
    } else if (item.projectGroupId) {
      projectIds.add(item.projectGroupId);
    } else {
      standaloneItems.push(item);
    }
  }

  if (context && context.kind === 'deal' && context.id) dealIds.add(context.id);
  if (context && context.kind === 'project' && context.id) projectIds.add(context.id);

  for (const gid of dealIds) syncDealReceipt(gid, stamp);
  for (const pid of projectIds) syncProjectReceipt(pid, stamp);
  for (const item of standaloneItems) syncItemReceipt(item);
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
    for(const item of nonInvoicedItems){
      if(item.status!=='paid'||customPaidDate){
        item.paidAt=paidDay;
        item.paidAtTs=stamp;
      }
      item.status='paid';
      item.updatedAt=stamp;
      enqueue('items',item.id);
    }
    recordPaidItems(nonInvoicedItems,context,stamp);
  } else {
    const affectedDealIds = new Set();
    const affectedProjectIds = new Set();
    for(const item of items){
      const wasPaid = item.status === 'paid';
      let status=next;
      if(next==='working'&&item.status==='sent'){status='changes';item.revisionCount=(item.revisionCount||0)+1;}
      else if(next==='changes'&&item.status!=='changes')item.revisionCount=(item.revisionCount||0)+1;
      if(['working','changes'].includes(status))item.assigneeId ||= currentUserId();
      item.paidAt=null;
      item.paidAtTs=null;
      item.status=status;
      item.updatedAt=stamp;
      enqueue('items',item.id);

      if(wasPaid){
        if(item.groupId) affectedDealIds.add(item.groupId);
        else if(item.projectGroupId) affectedProjectIds.add(item.projectGroupId);
        else {
          const r=(data.receipts||[]).find(x=>(x.referenceKind==='item'&&x.referenceId===item.id)||(x.source==='app'&&x.sourceKey==='app:'+item.id));
          if(r)removeReceipt(r.id);
        }
      }
    }
    for(const gid of affectedDealIds) syncDealReceipt(gid, stamp);
    for(const pid of affectedProjectIds) syncProjectReceipt(pid, stamp);
  }
  selected.clear();save();scheduleSync();render();toast(`${items.length} row${items.length===1?'':'s'} updated`);
}

const CAT_REACTIONS = [
  { key: 'happy', title: 'Happy / Purring', action: 'Purr', message: 'The cat is happy and purring! 😸' },
  { key: 'working', title: 'Working / Grinding', action: 'Grind', message: 'The cat is grinding and focused! 💡' },
  { key: 'depressed', title: 'Depressed / Overwhelmed', action: 'Cry', message: 'The cat is crying and overwhelmed! 😿' },
  { key: 'angry', title: 'Angry / Rage Mode', action: 'Hiss', message: 'The cat is angry and hissing! 😾' },
  { key: 'sleepy', title: 'Sleepy / Napping', action: 'Zzz', message: 'The cat is taking a quick power nap! 💤' },
  { key: 'shocked', title: 'Shocked / Alert', action: 'Gasp', message: 'The cat is in shock! Production alert! 🙀' },
  { key: 'love', title: 'Love / Appreciated', action: 'Heart', message: 'The cat is sending huge love & thanks! 😻' }
];

let catLottieCache = {};
async function getCatLottie(color, key) {
  const cacheKey = color + ':' + key;
  if (catLottieCache[cacheKey]) return catLottieCache[cacheKey];
  try {
    const res = await fetch(`assets/cats/${color}/${key}.json`);
    const json = await res.json();
    catLottieCache[cacheKey] = json;
    return json;
  } catch (e) {
    console.error('Failed to load cat lottie:', color, key, e);
    return null;
  }
}
async function getBlackCatLottie(key) { return getCatLottie('black', key); }

function playCatChime(pitch = 587.33) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.09, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.39);
  } catch {}
}

let bannerHideTimer = null;
function displayCatReactionBanner(payload) {
  playCatChime(payload.catType === 'black' ? 659.25 : 523.25);
  let banner = document.getElementById('catLiveBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'catLiveBanner';
    banner.className = 'cat-live-banner';
    banner.onclick = () => banner.classList.remove('show');
    document.body.appendChild(banner);
  }
  
  const isBlack = payload.catType === 'black';
  banner.className = 'cat-live-banner ' + (isBlack ? 'banner-black' : '');
  
  banner.innerHTML = `
    <div class="cat-banner-anim" id="catBannerAnimBox"></div>
    <div class="cat-banner-text">
      <strong>${esc(payload.senderName || 'Teammate')} pinged you!</strong>
      <p>${esc(payload.message || 'Cat reaction sent!')}</p>
    </div>
  `;
  
  const animBox = document.getElementById('catBannerAnimBox');
  const catColor = payload.catType === 'black' ? 'black' : 'orange';
  if (window.bodymovin) {
    getCatLottie(catColor, payload.reactionKey).then(data => {
      if (data && animBox) {
        animBox.innerHTML = '';
        window.bodymovin.loadAnimation({
          container: animBox,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData: data
        });
      }
    });
  } else {
    animBox.innerHTML = `<img src="assets/cats/orange/${payload.reactionKey}.webp" alt="Cat reaction">`;
  }
  
  clearTimeout(bannerHideTimer);
  requestAnimationFrame(() => banner.classList.add('show'));
  bannerHideTimer = setTimeout(() => {
    banner.classList.remove('show');
  }, 4500);
}

async function triggerCatPing(reactionKey, catColor, contextItem = null, targetPartner = null) {
  const r = CAT_REACTIONS.find(x => x.key === reactionKey) || CAT_REACTIONS[0];
  const myName = data.settings.displayName || 'Me';
  const partnerName = targetPartner || data.settings.localPartner || 'Teammate';
  
  let msg = r.message;
  if (contextItem && contextItem.service) {
    msg = `"${contextItem.service}" · ${r.message}`;
  }
  
  const payload = {
    senderId: currentUserId(),
    senderName: myName,
    catType: catColor,
    reactionKey: r.key,
    title: r.title,
    action: r.action,
    message: msg,
    timestamp: Date.now()
  };
  
  // Show locally
  displayCatReactionBanner(payload);
  
  // Broadcast to partner over Supabase channel
  if (channel) {
    try {
      await channel.send({
        type: 'broadcast',
        event: 'cat_reaction',
        payload
      });
    } catch (e) {
      console.warn('Cat reaction broadcast error:', e);
    }
  }
  
  toast(`🐾 Sent ${r.action} ping to ${partnerName}!`);
}

function openCatReactionPicker(contextItem = null, targetName = null) {
  const partner = targetName || data.settings.localPartner || 'Teammate';
  let chosenCat = data.settings.catType || 'orange';
  const targetText = `to <strong>${esc(partner)}</strong>`;

  const renderPickerContent = () => `
    <div class="cat-type-toggle-bar">
      <button type="button" class="cat-toggle-pill ${chosenCat==='orange'?'active-orange':''}" id="pickerCatOrange">🐱 Orange Cat</button>
      <button type="button" class="cat-toggle-pill ${chosenCat==='black'?'active-black':''}" id="pickerCatBlack">🐈‍⬛ Midnight Black Cat</button>
    </div>
    <p class="muted" style="text-align:center;font-size:12px;margin-bottom:10px;">Select an animated cat state to ping ${targetText}:</p>
    <div class="cat-picker-grid">
      ${CAT_REACTIONS.map(r => `
        <div class="cat-picker-item ${chosenCat==='black'?'black-cat-active':''}" data-cat-pick="${r.key}">
          <div class="cat-picker-anim" id="picker-anim-${r.key}">
            <div class="lottie-slot" style="width:68px;height:68px;"></div>
          </div>
          <div class="cat-picker-title">${esc(r.title.split('/')[0].trim())}</div>
          <div class="cat-picker-action">${esc(r.action)} 🐾</div>
        </div>
      `).join('')}
    </div>
  `;

  modal('🐾 Animated Cat Reaction & Team Ping', renderPickerContent(), '');

  function initPickerAnimations() {
    if (window.bodymovin) {
      CAT_REACTIONS.forEach(r => {
        const slot = document.querySelector('#picker-anim-' + r.key + ' .lottie-slot');
        if (slot) {
          getCatLottie(chosenCat, r.key).then(animData => {
            if (animData && slot.parentElement) {
              slot.innerHTML = '';
              window.bodymovin.loadAnimation({
                container: slot,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                animationData: animData
              });
            }
          });
        }
      });
    }

    const oBtn = document.getElementById('pickerCatOrange');
    if (oBtn) oBtn.onclick = () => {
      chosenCat = 'orange';
      data.settings.catType = 'orange';
      save();
      updateModalBody();
    };
    const bBtn = document.getElementById('pickerCatBlack');
    if (bBtn) bBtn.onclick = () => {
      chosenCat = 'black';
      data.settings.catType = 'black';
      save();
      updateModalBody();
    };

    document.querySelectorAll('[data-cat-pick]').forEach(el => {
      el.onclick = () => {
        const key = el.dataset.catPick;
        closeModal();
        triggerCatPing(key, chosenCat, contextItem, partner);
      };
    });
  }

  function updateModalBody() {
    const bodyEl = document.querySelector('#modalRoot .modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = renderPickerContent();
      initPickerAnimations();
    }
  }

  initPickerAnimations();
}

// Low-level Windows desktop notification trigger
function sendNativeDesktopNotification(title, body) {
  try {
    if (window.desk?.notify) {
      window.desk.notify(title, body);
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch (err) {
    console.warn('Native desktop notification error:', err);
  }
}

// Dynamic focus and window state inspection at notification arrival time
async function isAppActivelyUsed() {
  let isAppFocused = false;
  try {
    if (window.desk?.isFocused) {
      isAppFocused = await window.desk.isFocused();
    } else {
      isAppFocused = document.hasFocus() && !document.hidden;
    }
  } catch {
    isAppFocused = false;
  }
  return isAppFocused;
}

// Centralized Smart Notification Engine
// Routes each notification strictly to EITHER In-App UI OR Windows Notification (Never Both)
async function smartNotify({ title, body, icon = '🔔', catPayload = null }) {
  const isAppActive = await isAppActivelyUsed();

  if (isAppActive) {
    // App is open, visible, and actively focused by user -> In-app UI only
    if (catPayload) {
      displayCatReactionBanner(catPayload);
    } else {
      showInAppNotification(title, body, icon);
    }
  } else {
    // App is minimized, blurred, or in background -> Native Windows notification only
    const nativeTitle = title || (catPayload ? `🐾 ${catPayload.senderName || 'Teammate'}` : 'MeowSheet');
    const nativeBody = body || (catPayload ? (catPayload.message || 'Cat reaction sent!') : '');
    sendNativeDesktopNotification(nativeTitle, nativeBody);
  }
}

// Backward-compatible desktopNotify helper that automatically routes intelligently
function desktopNotify(title, body, icon = '🔔') {
  smartNotify({ title, body, icon });
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
function ensureBankAccounts() {
  const seller = data.settings.seller ||= {};
  seller.bankAccounts ||= [];
  if (!seller.bankAccounts.length && seller.bankDetails && seller.bankDetails.trim()) {
    const defaultAcc = {
      id: uid(),
      label: 'Primary Account',
      holderName: seller.name || '',
      bankName: '',
      accountNumber: '',
      ifsc: '',
      upiId: '',
      details: seller.bankDetails.trim()
    };
    seller.bankAccounts.push(defaultAcc);
    seller.activeBankAccountId = defaultAcc.id;
  }
  // Deduplicate identical accounts (collapsing duplicates while maintaining active selection)
  if (seller.bankAccounts.length > 1) {
    const seen = new Set();
    const deduped = [];
    for (const acc of seller.bankAccounts) {
      const key = `${acc.bankName||''}|${acc.accountNumber||''}|${acc.ifsc||''}|${acc.upiId||''}|${acc.details||''}`.toLowerCase().trim();
      if (key && key !== '||||') {
        if (seen.has(key)) {
          if (seller.activeBankAccountId === acc.id && deduped.length > 0) {
            seller.activeBankAccountId = deduped[0].id;
          }
          continue;
        }
        seen.add(key);
      }
      deduped.push(acc);
    }
    seller.bankAccounts = deduped;
  }
  if (seller.bankAccounts.length && (!seller.activeBankAccountId || !seller.bankAccounts.some(a => a.id === seller.activeBankAccountId))) {
    seller.activeBankAccountId = seller.bankAccounts[0].id;
  }
}
function formatBankDetails(acc) {
  if (!acc) return '';
  if (acc.details && acc.details.trim()) return acc.details.trim();
  const parts = [];
  if (acc.holderName) parts.push(`A/C Holder: ${acc.holderName}`);
  if (acc.bankName) parts.push(`Bank: ${acc.bankName}`);
  if (acc.accountNumber) parts.push(`A/C No: ${acc.accountNumber}`);
  if (acc.ifsc) parts.push(`IFSC: ${acc.ifsc}`);
  if (acc.upiId) parts.push(`UPI ID: ${acc.upiId}`);
  return parts.join('\n');
}
function syncActiveBankDetails() {
  ensureBankAccounts();
  const seller = data.settings.seller;
  const active = seller.bankAccounts.find(a => a.id === seller.activeBankAccountId) || seller.bankAccounts[0];
  if (active) {
    seller.activeBankAccountId = active.id;
    seller.bankDetails = active.details && active.details.trim() ? active.details.trim() : formatBankDetails(active);
  } else {
    seller.bankDetails = '';
  }
}
function bankAccountDialog(accId = null) {
  ensureBankAccounts();
  const accounts = data.settings.seller.bankAccounts;
  const existing = accId ? accounts.find(a => a.id === accId) : null;
  const isEditing = !!existing;
  const isActive = isEditing ? (data.settings.seller.activeBankAccountId === accId) : (accounts.length === 0);

  modal(isEditing ? 'Edit bank account' : 'Add bank account', `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="field">
        <label for="bankAccLabel">Account nickname / label</label>
        <input id="bankAccLabel" placeholder="e.g. Samuel's Bank Info, Primary Current" value="${esc(existing?.label || '')}" autofocus>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="bankAccHolder">Account holder name</label>
          <input id="bankAccHolder" placeholder="e.g. Samuel Fernandes" value="${esc(existing?.holderName || (isEditing ? '' : data.settings.seller.name || ''))}">
        </div>
        <div class="field">
          <label for="bankAccBank">Bank name</label>
          <input id="bankAccBank" placeholder="e.g. Kotak Mahindra Bank, HDFC Bank, SBI" value="${esc(existing?.bankName || '')}">
        </div>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="bankAccNumber">Account number</label>
          <input id="bankAccNumber" placeholder="e.g. 2055521592" value="${esc(existing?.accountNumber || '')}">
        </div>
        <div class="field">
          <label for="bankAccIfsc">IFSC code</label>
          <input id="bankAccIfsc" placeholder="e.g. KKBK0000701" value="${esc(existing?.ifsc || '')}">
        </div>
      </div>
      <div class="field">
        <label for="bankAccUpi">UPI ID (optional)</label>
        <input id="bankAccUpi" placeholder="e.g. samuel@oksbi, username@upi" value="${esc(existing?.upiId || '')}">
      </div>
      <div class="field">
        <label for="bankAccDetails">Custom formatted details / notes (optional, overrides above)</label>
        <textarea id="bankAccDetails" rows="3" placeholder="Leave empty to auto-format from fields above">${esc(existing?.details || '')}</textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#1e3827;cursor:pointer;margin-top:4px">
        <input type="checkbox" id="bankAccMakeActive" ${isActive ? 'checked' : ''} style="width:16px;height:16px;accent-color:#168451">
        Set this account as active for client invoices
      </label>
    </div>
  `, `
    <div class="modal-actions" style="display:flex;justify-content:space-between;align-items:center">
      ${isEditing ? `<button type="button" class="small-btn" id="deleteBankAcc" style="color:#d32f2f;border-color:#fbc4c4">Delete account</button>` : '<div></div>'}
      <div style="display:flex;gap:8px">
        <button type="button" class="small-btn" id="cancelBankAcc">Cancel</button>
        <button type="button" class="small-btn blue" id="saveBankAcc">${isEditing ? 'Save changes' : 'Add account'}</button>
      </div>
    </div>
  `);

  $('#cancelBankAcc').onclick = closeModal;
  if ($('#deleteBankAcc')) {
    $('#deleteBankAcc').onclick = () => {
      deleteBankAccount(accId);
      closeModal();
    };
  }

  const handleSave = () => {
    const label = inputValue('bankAccLabel') || inputValue('bankAccBank') || 'Bank Account';
    const holderName = inputValue('bankAccHolder');
    const bankName = inputValue('bankAccBank');
    const accountNumber = inputValue('bankAccNumber');
    const ifsc = inputValue('bankAccIfsc');
    const upiId = inputValue('bankAccUpi');
    const details = $('#bankAccDetails')?.value.trim() || '';
    const makeActive = $('#bankAccMakeActive')?.checked;

    if (!accountNumber && !details && !bankName && !upiId && !inputValue('bankAccLabel')) {
      toast('Please enter at least an account number, bank name, UPI ID, or label');
      return;
    }

    if (isEditing) {
      existing.label = label;
      existing.holderName = holderName;
      existing.bankName = bankName;
      existing.accountNumber = accountNumber;
      existing.ifsc = ifsc;
      existing.upiId = upiId;
      existing.details = details;
      if (makeActive) data.settings.seller.activeBankAccountId = existing.id;
    } else {
      const newAcc = {
        id: uid(),
        label,
        holderName,
        bankName,
        accountNumber,
        ifsc,
        upiId,
        details
      };
      accounts.push(newAcc);
      if (makeActive || accounts.length === 1) {
        data.settings.seller.activeBankAccountId = newAcc.id;
      }
    }
    syncActiveBankDetails();
    save();
    if (clientApi && session && data.settings.workspaceId) {
      clientApi.from('workspaces').update({ business: data.settings.seller }).eq('id', data.settings.workspaceId).then(res => {
        if (res?.error) console.error('Workspace bank sync failed:', res.error);
      }).catch(err => console.error('Workspace bank sync network error:', err));
    }
    closeModal();
    render();
    toast(isEditing ? 'Bank account updated' : 'Bank account added');
  };

  $('#saveBankAcc').onclick = handleSave;
  ['bankAccLabel','bankAccHolder','bankAccBank','bankAccNumber','bankAccIfsc','bankAccUpi'].forEach(id => {
    const el = $('#' + id);
    if (el) el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } };
  });
}
function setActiveBankAccount(accId) {
  ensureBankAccounts();
  const acc = data.settings.seller.bankAccounts.find(a => a.id === accId);
  if (!acc) return;
  data.settings.seller.activeBankAccountId = accId;
  syncActiveBankDetails();
  save();
  if (clientApi && session && data.settings.workspaceId) {
    clientApi.from('workspaces').update({ business: data.settings.seller }).eq('id', data.settings.workspaceId).then(res => {
      if (res?.error) console.error('Workspace bank sync failed:', res.error);
    }).catch(err => console.error('Workspace bank sync network error:', err));
  }
  render();
  toast(`Active bank set to ${acc.label || acc.bankName || 'account'}`);
}
function deleteBankAccount(accId) {
  ensureBankAccounts();
  const accounts = data.settings.seller.bankAccounts;
  const ix = accounts.findIndex(a => a.id === accId);
  if (ix >= 0) {
    accounts.splice(ix, 1);
    if (data.settings.seller.activeBankAccountId === accId) {
      data.settings.seller.activeBankAccountId = accounts[0]?.id || '';
    }
    syncActiveBankDetails();
    save();
    if (clientApi && session && data.settings.workspaceId) {
      clientApi.from('workspaces').update({ business: data.settings.seller }).eq('id', data.settings.workspaceId).then(res => {
        if (res?.error) console.error('Workspace bank sync failed:', res.error);
      }).catch(err => console.error('Workspace bank sync network error:', err));
    }
    render();
    toast('Bank account deleted');
  }
}
function inputValue(id){return $('#'+id)?.value.trim()||'';}
async function saveSettings(){
  $$('[data-setting]').forEach(el=>{const path=el.dataset.setting.split('.');if(path.length===2)data.settings[path[0]][path[1]]=el.value;else data.settings[path[0]]=el.value;});
  syncActiveBankDetails();
  save();
  if(clientApi&&session&&data.settings.workspaceId){const [member,business]=await Promise.all([clientApi.from('members').update({display_name:data.settings.displayName}).eq('workspace_id',data.settings.workspaceId).eq('user_id',session.user.id),clientApi.from('workspaces').update({business:data.settings.seller}).eq('id',data.settings.workspaceId)]);if(member.error||business.error)toast('Saved locally; team sync failed: '+(member.error||business.error).message);else {const me=data.members.find(m=>m.userId===session.user.id);if(me)me.displayName=data.settings.displayName;}}
  render();toast('Settings saved');
}
function actions(action) {
  if(action==='import')return importWorkbook();
  if(action==='migrate')return migrateImport();
  if(action==='undo')return undo();
  if(action==='redo')return redo();
  if(action==='delete')return deleteSelectedRows([...selected]);
  if(action==='add-row'){const i=newItem(activeClient,clientItems().length);mutate('items',i);setTimeout(()=>document.querySelector(`[data-id="${i.id}"][data-cell="service"]`)?.focus(),80);return;}
  if(action==='assign')return assign([...selected]); if(action==='complete')return markSent([...selected]); if(action==='invoice')return invoiceDialog(); if(action==='group')return groupDialog();
  if(action==='project-group')return projectGroupDialog();
  if(action==='ungroup')return ungroupSelectedRows();
  if(action==='cat-quick-ping')return openCatReactionPicker();
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
function groupDialog(id){const chosen=id?data.items.filter(i=>i.groupId===id):data.items.filter(i=>selected.has(i.id));if(!chosen.length)return;const existing=id?data.groups.find(g=>g.id===id):null;const quote=chosen.reduce((n,i)=>n+num(i.quotedTotal),0);modal(existing?'Edit grouped deal':'Group selected rows',`<p>${chosen.length} rows · Original quote ${money(quote)}</p><div class="field"><label>Group name</label><input id="groupLabel" value="${esc(existing?.label||'Agreed deal')}"></div><div class="field"><label>Agreed final amount</label><input id="groupAmount" type="number" min="0" step="0.01" placeholder="Enter negotiated amount" value="${existing?.agreedAmount??''}"></div><div class="notice">This amount replaces the sum of row totals in revenue and payment estimates. Individual rows stay visible for work tracking.</div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveGroup">Save group</button></div>`);$('#saveGroup').onclick=()=>{pushUndo(existing?'Edit deal group':'Group deal');const value=inputValue('groupAmount');const g=existing||{id:uid(),clientId:activeClient};g.label=inputValue('groupLabel')||'Agreed deal';g.agreedAmount=value===''?null:num(value);if(!existing)chosen.forEach(i=>{i.groupId=g.id;queue('items',i.id);});mutate('groups',g);syncDealReceipt(g.id);selected.clear();closeModal();toast('Deal group saved');};}
function projectGroupDialog() {
  const chosen=data.items.filter(i=>selected.has(i.id));if(!chosen.length)return;
  if(new Set(chosen.map(i=>i.clientId)).size!==1){toast('Select rows from one client');return;}
  modal('Group project',`<p>Organize ${chosen.length} selected rows under one collapsible project heading.</p><div class="field"><label>Project group name</label><input id="projectGroupName" placeholder="For example, Sheena and Royston" autofocus></div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveProjectGroup">Create group</button></div>`);
  $('#saveProjectGroup').onclick=()=>{const name=inputValue('projectGroupName');if(!name){toast('Enter a group name');return;}pushUndo('Group project');const group={id:uid(),clientId:chosen[0].clientId,label:name};for(const item of chosen){item.projectGroupId=group.id;queue('items',item.id);}mutate('projectGroups',group);syncProjectReceipt(group.id);selected.clear();closeModal();toast('Project group created');};
}
function renameGroup(kind,id){const table=kind==='project'?'projectGroups':'groups',group=data[table].find(g=>g.id===id);if(!group)return;modal('Rename group',`<div class="field"><label>Group name</label><input id="renameGroupName" value="${esc(group.label)}" autofocus></div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveGroupName">Save name</button></div>`);const saveName=()=>{const label=inputValue('renameGroupName');if(!label){toast('Enter a group name');return;}group.label=label;mutate(table,group);closeModal();toast('Group renamed');};$('#saveGroupName').onclick=saveName;$('#renameGroupName').onkeydown=e=>{if(e.key==='Enter')saveName();};}
function ungroupDialog(kind, id) {
  const table = kind === 'project' ? 'projectGroups' : 'groups';
  const group = (data[table] || []).find(g => g.id === id);
  if (!group) return;
  const items = (data.items || []).filter(i => (kind === 'project' ? i.projectGroupId : i.groupId) === id);
  const typeLabel = kind === 'project' ? 'project group' : 'deal group';

  modal(
    `Ungroup ${group.label}`,
    `<p>Ungroup <strong>${esc(group.label)}</strong> (${items.length} row${items.length === 1 ? '' : 's'})?</p>
     <div class="notice">
       All rows will remain in your worksheet, but will no longer be linked to this ${typeLabel}.
       ${kind === 'deal' ? 'Any negotiated agreed amount will be removed, and row values will revert to their individual totals.' : ''}
     </div>`,
    `<div class="modal-actions">
       <button class="small-btn" id="cancelUngroup">Cancel</button>
       <button class="small-btn danger" id="confirmUngroup">Ungroup</button>
     </div>`
  );

  $('#cancelUngroup').onclick = closeModal;
  $('#confirmUngroup').onclick = () => {
    pushUndo(`Ungroup ${group.label}`);

    items.forEach(item => {
      if (kind === 'project') item.projectGroupId = null;
      else item.groupId = null;
      enqueue('items', item.id);
    });

    data[table] = (data[table] || []).filter(g => g.id !== id);
    data.pending = (data.pending || []).filter(p => !(p.table === table && p.id === id));
    data.pendingDeletes ||= [];
    if (!data.pendingDeletes.some(d => d.table === table && d.id === id)) {
      data.pendingDeletes.push({ table, id });
    }
    collapsedGroups.delete(kind + ':' + id);

    const receiptsToRemove = (data.receipts || []).filter(r => r.referenceKind === (kind === 'project' ? 'project' : 'deal') && r.referenceId === id);
    receiptsToRemove.forEach(r => removeReceipt(r.id));

    items.forEach(item => {
      syncItemReceipt(item);
      if (kind === 'deal' && item.projectGroupId) {
        syncProjectReceipt(item.projectGroupId);
      }
    });

    save();
    scheduleSync();
    closeModal();
    render();
    toast(`${kind === 'project' ? 'Project' : 'Deal'} group ungrouped`);
  };
}
function ungroupSelectedRows() {
  const chosen = (data.items || []).filter(i => selected.has(i.id) && (i.groupId || i.projectGroupId));
  if (!chosen.length) {
    toast('No grouped rows selected');
    return;
  }

  const hasDeal = chosen.some(i => i.groupId);
  const hasProj = chosen.some(i => i.projectGroupId);

  const performUngroup = (options = { deal: true, project: true }) => {
    pushUndo(`Ungroup ${chosen.length} row${chosen.length > 1 ? 's' : ''}`);

    const affectedDealIds = new Set();
    const affectedProjectIds = new Set();

    chosen.forEach(item => {
      if (options.deal && item.groupId) {
        affectedDealIds.add(item.groupId);
        item.groupId = null;
      }
      if (options.project && item.projectGroupId) {
        affectedProjectIds.add(item.projectGroupId);
        item.projectGroupId = null;
      }
      enqueue('items', item.id);
    });

    for (const gid of affectedDealIds) {
      const remaining = (data.items || []).filter(i => i.groupId === gid);
      if (!remaining.length) {
        data.groups = (data.groups || []).filter(g => g.id !== gid);
        data.pending = (data.pending || []).filter(p => !(p.table === 'groups' && p.id === gid));
        data.pendingDeletes ||= [];
        if (!data.pendingDeletes.some(d => d.table === 'groups' && d.id === gid)) {
          data.pendingDeletes.push({ table: 'groups', id: gid });
        }
        collapsedGroups.delete('deal:' + gid);
        const receiptsToRemove = (data.receipts || []).filter(r => r.referenceKind === 'deal' && r.referenceId === gid);
        receiptsToRemove.forEach(r => removeReceipt(r.id));
      } else {
        syncDealReceipt(gid);
      }
    }

    for (const pid of affectedProjectIds) {
      const remaining = (data.items || []).filter(i => i.projectGroupId === pid);
      if (!remaining.length) {
        data.projectGroups = (data.projectGroups || []).filter(g => g.id !== pid);
        data.pending = (data.pending || []).filter(p => !(p.table === 'projectGroups' && p.id === pid));
        data.pendingDeletes ||= [];
        if (!data.pendingDeletes.some(d => d.table === 'projectGroups' && d.id === pid)) {
          data.pendingDeletes.push({ table: 'projectGroups', id: pid });
        }
        collapsedGroups.delete('project:' + pid);
        const receiptsToRemove = (data.receipts || []).filter(r => r.referenceKind === 'project' && r.referenceId === pid);
        receiptsToRemove.forEach(r => removeReceipt(r.id));
      } else {
        syncProjectReceipt(pid);
      }
    }

    chosen.forEach(item => {
      syncItemReceipt(item);
      if (item.projectGroupId) syncProjectReceipt(item.projectGroupId);
    });

    save();
    scheduleSync();
    render();
    toast(`Ungrouped ${chosen.length} row${chosen.length > 1 ? 's' : ''}`);
  };

  if (hasDeal && hasProj) {
    modal(
      'Ungroup rows',
      `<p>The selected ${chosen.length} row${chosen.length > 1 ? 's are' : ' is'} part of both a project group and a deal group. What would you like to ungroup?</p>
       <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
         <button class="small-btn" id="ungroupBoth" style="padding:10px;text-align:left;font-weight:600">Ungroup from Both (Deal & Project)</button>
         <button class="small-btn" id="ungroupDealOnly" style="padding:10px;text-align:left">Ungroup from Deal Group only</button>
         <button class="small-btn" id="ungroupProjOnly" style="padding:10px;text-align:left">Ungroup from Project Group only</button>
       </div>`,
      `<div class="modal-actions"><button class="small-btn" id="cancelUngroupSelect">Cancel</button></div>`
    );
    $('#cancelUngroupSelect').onclick = closeModal;
    $('#ungroupBoth').onclick = () => { closeModal(); performUngroup({ deal: true, project: true }); };
    $('#ungroupDealOnly').onclick = () => { closeModal(); performUngroup({ deal: true, project: false }); };
    $('#ungroupProjOnly').onclick = () => { closeModal(); performUngroup({ deal: false, project: true }); };
  } else {
    performUngroup({ deal: hasDeal, project: hasProj });
  }
}
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
  if(table==='items')return {id:x.id,workspace_id:ws,client_id:x.clientId,group_id:x.groupId||null,project_group_id:x.projectGroupId||null,source_row:x.sourceRow||null,sort_order:x.sortOrder||0,serial:cleanSerial(String(x.serial||'')),work_date:validDate(x.workDate),due_date:validDate(x.dueDate),service:x.service||'',quantity:num(x.quantity),rate:num(x.rate),quoted_total:num(x.quotedTotal),advance_amount:num(x.advanceAmount),advance_received_at:validDate(x.advanceReceivedAt),paid_at:validDate(x.paidAt),paid_at_ts:x.paidAtTs||null,status:x.status,revision_count:x.revisionCount||0,assignee_id:x.assigneeId==='local-me'?currentUserId():isUuid(x.assigneeId)?x.assigneeId:null,remarks:x.remarks||'',updated_at:x.updatedAt||new Date().toISOString()};
  if(table==='invoices')return {id:x.id,workspace_id:ws,client_id:x.clientId,number:x.number,issue_date:validDate(x.issueDate)||today(),paid_at:validDate(x.paidAt),paid_at_ts:x.paidAtTs||null,item_ids:x.itemIds,lines:x.lines,subtotal:num(x.subtotal),discount:num(x.discount),final_amount:num(x.finalAmount),advance_amount:invoiceAdvance(x),status:x.status,seller:x.seller,buyer:x.buyer};
  if(table==='receipts')return {id:x.id,workspace_id:ws,client_id:x.clientId||null,client_name:x.clientName,amount:num(x.amount),received_month:x.receivedMonth,received_on:x.receivedOn||null,received_at:x.receivedAt||null,source:x.source,source_key:x.sourceKey,reference_kind:x.referenceKind||null,reference_id:x.referenceId||null,description:x.description||'',source_file:x.sourceFile||null,source_row:x.sourceRow||null,original_date:x.originalDate||null,date_quality:x.dateQuality||'exact'};
}
function localRow(table,x) {
  if(table==='clients')return {id:x.id,name:x.name,billing:x.billing||{},sortOrder:x.sort_order};
  if(table==='groups')return {id:x.id,clientId:x.client_id,label:x.label,agreedAmount:x.agreed_amount};
  if(table==='projectGroups')return {id:x.id,clientId:x.client_id,label:x.label};
  if(table==='items')return {id:x.id,clientId:x.client_id,groupId:x.group_id,projectGroupId:x.project_group_id,sourceRow:x.source_row,sortOrder:x.sort_order,serial:cleanSerial(x.serial)||cleanSerial(String((x.sort_order||0)+1)),workDate:x.work_date||'',dueDate:x.due_date||'',service:x.service,quantity:num(x.quantity),rate:num(x.rate),quotedTotal:num(x.quoted_total),advanceAmount:num(x.advance_amount),advanceReceivedAt:x.advance_received_at||null,paidAt:x.paid_at||null,paidAtTs:x.paid_at_ts||null,status:x.status,revisionCount:x.revision_count,assigneeId:x.assignee_id||'',remarks:x.remarks||'',manualTotal:true,updatedAt:x.updated_at};
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
async function ensureActiveSession() {
  if (!clientApi) return null;
  try {
    const { data: d, error } = await clientApi.auth.getSession();
    if (error || !d?.session) {
      const { data: refData, error: refErr } = await clientApi.auth.refreshSession();
      if (!refErr && refData?.session) {
        session = refData.session;
        return session;
      }
      return null;
    }
    const current = d.session;
    if (current.expires_at && (current.expires_at * 1000 - Date.now() < 120000)) {
      const { data: refData, error: refErr } = await clientApi.auth.refreshSession();
      if (!refErr && refData?.session) {
        session = refData.session;
        return session;
      }
    }
    session = current;
    return session;
  } catch (err) {
    console.warn('ensureActiveSession notice:', err);
    return session;
  }
}
async function resolveWorkspace(){
  if(workspaceResolving||!clientApi)return;
  await ensureActiveSession();
  if(!session)return;
  workspaceResolving=true;
  try{
    const {data:membership,error}=await clientApi.from('members').select('workspace_id,display_name').eq('workspace_id',GIR_WORKSPACE_ID).eq('user_id',session.user.id).maybeSingle();
    if(error)throw error;
    if(membership){
      data.settings.workspaceId=membership.workspace_id;
      if(membership.display_name)data.settings.displayName=membership.display_name;
    } else {
      // Auto-join with known code in background so user never gets prompted
      const {data:id}=await clientApi.rpc('join_gir_workspace',{code:'9A5FEDC53B0F',name:data.settings.displayName||session.user.user_metadata?.display_name||'Team member'});
      if(id)data.settings.workspaceId=id;
      else data.settings.workspaceId=GIR_WORKSPACE_ID;
    }
    workspaceReady=true;save();render();
    await syncNow();
  }catch(error){
    // Keep existing workspaceId on network error — NEVER wipe it!
    workspaceReady=true;
    if(!data.settings.workspaceId)data.settings.workspaceId=GIR_WORKSPACE_ID;
    console.warn('Workspace check note:', error.message);
    render();
  }
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
  if(syncing||!clientApi||!data.settings.workspaceId)return;
  await ensureActiveSession();
  if(!session)return;
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
      const queued=data.pending.filter(p=>p.table===table);
      if(!queued.length) continue;
      
      const records = [];
      const orphanedIds = new Set();
      for (const p of queued) {
        const rec = (data[table] || []).find(x => x.id === p.id);
        if (rec) records.push(rec);
        else orphanedIds.add(p.id);
      }
      
      // Clear orphaned IDs that were already deleted or missing locally
      if (orphanedIds.size > 0) {
        data.pending = data.pending.filter(p => !(p.table === table && orphanedIds.has(p.id)));
        save();
      }

      for(let start=0;start<records.length;start+=100){
        const chunk=records.slice(start,start+100);
        const {error}=await clientApi.from(remoteTable[table]).upsert(chunk.map(x=>remoteRow(table,x)),{onConflict:'id'});
        if(error)throw error;
        const ids=new Set(chunk.map(x=>x.id));
        data.pending=data.pending.filter(p=>!(p.table===table&&ids.has(p.id)));
        save();
      }
    }
    successful=true;
  } finally { syncing=false; if(successful&&data.pending.length)scheduleSync(); }
}
async function fetchAll(table){let out=[];for(let start=0;;start+=1000){const {data:rows,error}=await clientApi.from(table).select('*').eq('workspace_id',data.settings.workspaceId).order('id').range(start,start+999);if(error)throw error;out.push(...rows);if(rows.length<1000)break;}return out;}
async function pullRemote(){
  if(!clientApi||!data.settings.workspaceId)return;
  await ensureActiveSession();
  if(!session)return;
  const ws=data.settings.workspaceId;
  const [w,m,...tables]=await Promise.all([
    clientApi.from('workspaces').select('*').eq('id',ws).single(),
    clientApi.from('members').select('*').eq('workspace_id',ws),
    ...['clients','deal_groups','project_groups','work_items','invoices','payment_receipts'].map(fetchAll)
  ]);
  if(w.error)throw w.error;
  if(m.error)throw m.error;
  data.settings.joinCode=w.data.join_code;
  if(w.data.business&&Object.keys(w.data.business).length){
    const localAccounts=(data.settings.seller.bankAccounts||[]).slice();
    const localActiveId=data.settings.seller.activeBankAccountId;
    data.settings.seller={...defaults.settings.seller,...data.settings.seller,...w.data.business};
    if(!w.data.business.bankAccounts?.length&&localAccounts.length){
      data.settings.seller.bankAccounts=localAccounts;
      data.settings.seller.activeBankAccountId=localActiveId||localAccounts[0].id;
    }
    if(!data.settings.workspaceId)data.settings.workspaceId=GIR_WORKSPACE_ID;
    ensureBankAccounts();
    syncActiveBankDetails();
  }
  data.members=(m?.data||[]).map(x=>({userId:x.user_id,displayName:x.display_name,avatarData:x.avatar_data||''}));
  ['clients','groups','projectGroups','items','invoices','receipts'].forEach((table,k)=>{
    const pending=new Set(data.pending.filter(p=>p.table===table).map(p=>p.id));
    const pendingDeletes=new Set((data.pendingDeletes||[]).filter(p=>p.table===table).map(p=>p.id));
    const locals=(data[table]||[]).filter(x=>pending.has(x.id));
    data[table]=(tables[k]||[]).filter(x=>!pendingDeletes.has(x.id)).map(x=>localRow(table,x));
    for(const local of locals){
      const ix=data[table].findIndex(x=>x.id===local.id);
      if(ix<0)data[table].push(local);else data[table][ix]=local;
    }
  });
  consolidateAllReceipts();
  if(!activeClient || !data.clients.some(c=>c.id===activeClient))activeClient=sortedClients()[0]?.id||null;
  lastSyncTime=Date.now();
  save();
  render();
  updateSyncUI();
}
function subscribe(){
  if(!clientApi||!session||!data.settings.workspaceId)return;
  if(channel)clientApi.removeChannel(channel);
  let timer;
  channel=clientApi.channel('gir-ledger-'+data.settings.workspaceId);
  channel.on('broadcast', { event: 'cat_reaction' }, async ({ payload }) => {
    if(!payload || payload.senderId === currentUserId()) return;
    await smartNotify({
      title: '🐾 ' + (payload.senderName || 'Teammate'),
      body: payload.message || 'Cat reaction sent!',
      catPayload: payload
    });
  });
  
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
            desktopNotify('Work in progress',`${assigneeName} started working on "${workName}"${clientName}`,'⚡');
          }else if(item.status==='changes'){
            desktopNotify('Changes requested',`${assigneeName} marked "${workName}"${clientName} for changes`,'✏️');
          }else if(item.status==='sent'){
            desktopNotify('Work sent',`${assigneeName} marked "${workName}"${clientName} as sent to client`,'🚀');
          }else if(item.status==='paid'){
            desktopNotify('Payment recorded',`${assigneeName} marked "${workName}"${clientName} as paid`,'💰');
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
  if(!clientApi){toast('Connecting to Supabase...');return;}
  await ensureActiveSession();
  if(!session){toast('Session expired. Please sign in to Supabase in Settings');return;}
  if(!data.settings.workspaceId){toast('Create or join a workspace first');return;}
  syncing=true;updateSyncUI();
  try{
    await flushPending();
    await pullRemote();
    subscribe();
    lastSyncTime=Date.now();
    toast('Workspace synced');
  }catch(e){
    if(e?.message?.includes('JWT expired')||e?.code==='PGRST303'){
      try{
        const {data:refData}=await clientApi.auth.refreshSession();
        if(refData?.session){
          session=refData.session;
          await flushPending();
          await pullRemote();
          subscribe();
          lastSyncTime=Date.now();
          toast('Workspace synced');
          return;
        }
      }catch(retryErr){
        console.warn('Retry refresh error:', retryErr);
      }
    }
    toast('Sync failed: '+(e.message||'Unknown error'));
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
document.addEventListener('keydown',e=>{
  if(e.ctrlKey&&(e.key==='+'||e.key==='='||e.key==='-')){
    e.preventDefault();
    data.settings.zoom=Math.max(70,Math.min(150,data.settings.zoom+(e.key==='-'?-10:10)));
    save();render();return;
  }
  if(e.key==='Escape'){
    closeStatusMenu();closeModal();
    if(rowClipboard.mode==='cut'){
      rowClipboard.mode='copy';
      $$('[data-row]').forEach(r=>r.classList.remove('row-cut-pending'));
    }
    return;
  }
  if(tab==='sheet'&&!$('#modalRoot').children.length){
    const focused=document.activeElement;
    const isEditing=focused?.matches('input:not([readonly]),textarea,select')||focused?.isContentEditable;
    if(!isEditing){
      const isCtrl=e.ctrlKey||e.metaKey;
      const key=e.key.toLowerCase();
      if(isCtrl&&!e.shiftKey&&key==='z'){
        e.preventDefault();undo();return;
      }
      if((isCtrl&&key==='y')||(isCtrl&&e.shiftKey&&key==='z')){
        e.preventDefault();redo();return;
      }
      if((e.key==='Delete'||e.key==='Del')&&selected.size){
        e.preventDefault();deleteSelectedRows([...selected]);return;
      }
      if(isCtrl&&key==='c'&&selected.size){
        e.preventDefault();copySelectedRows(false);return;
      }
      if(isCtrl&&key==='x'&&selected.size){
        e.preventDefault();copySelectedRows(true);return;
      }
      if(isCtrl&&key==='v'&&rowClipboard.items.length){
        e.preventDefault();
        const targetId=selected.size?[...selected][0]:null;
        pasteCopiedRows(targetId,selectionCell?.blankOrder);
        return;
      }
      if(isCtrl&&key==='d'&&selected.size){
        e.preventDefault();duplicateSelectedRow([...selected][0]);return;
      }
      if(e.altKey&&e.key==='ArrowUp'&&selected.size){
        e.preventDefault();moveRowByDelta([...selected][0],-1);return;
      }
      if(e.altKey&&e.key==='ArrowDown'&&selected.size){
        e.preventDefault();moveRowByDelta([...selected][0],1);return;
      }
    }
  }
});
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('beforeunload', () => saveImmediate());
}
document.addEventListener('paste',e=>{
  if(tab!=='sheet'||activeStatusMenu||$('#modalRoot').children.length)return;
  if(e.target?.matches?.('[data-cell],[data-blank-cell]'))return;
  const focused=document.activeElement;
  if(focused?.matches('input:not([readonly]),textarea,select')||focused?.isContentEditable)return;
  if(rowClipboard.items.length&&selected.size){
    e.preventDefault();
    pasteCopiedRows([...selected][0],selectionCell?.blankOrder);
    return;
  }
  if(!selectionCell)return;
  const value=e.clipboardData?.getData('text/plain');if(!value)return;
  if(selectionCell.blankOrder!=null){pasteBlankGrid(e,{dataset:{blankOrder:String(selectionCell.blankOrder),blankCell:selectionCell.key}});return;}
  if(!selectionCell.id)return;
  if(value.includes('\t')||value.includes('\n'))pasteGrid(e,{dataset:{id:selectionCell.id,cell:selectionCell.key}});
  else{e.preventDefault();editCell(selectionCell.id,selectionCell.key,value);}
});
(async()=>{try{const saved=await window.desk.read();if(saved)data={...structuredClone(defaults),...saved,settings:{...structuredClone(defaults.settings),...(saved.settings||{}),seller:{...defaults.settings.seller,...(saved.settings?.seller||{})}}};(data.items||[]).forEach(i=>{if(i.serial)i.serial=cleanSerial(i.serial);});consolidateAllReceipts();ensureBankAccounts();syncActiveBankDetails();const topClient=sortedClients()[0]?.id;if(topClient)activeClient=topClient;render();setupSupabase();}catch(e){render();toast('Could not load local data: '+e.message);}})();
