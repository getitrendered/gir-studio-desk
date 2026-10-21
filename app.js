/* GIR Studio Desk: renderer state, sheet interaction, and Supabase sync. */
const $ = s => document.querySelector(s);
const uid = () => crypto.randomUUID();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmtDate = d => { if (!d) return '—'; const x = new Date(d + 'T00:00:00'); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); };
const defaults = { clients:[], groups:[], projectGroups:[], items:[], invoices:[], members:[], pending:[], settings:{ seller:{ name:'GIR — Get It Rendered', address:'', email:'', phone:'', taxId:'' }, url:'https://isdxybpeagloikchhsbp.supabase.co', key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzZHh5YnBlYWdsb2lrY2hoc2JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NzkzMjcsImV4cCI6MjEwODE1NTMyN30.ll1YG9uyrTqmLzE90miCk-O1Ab5VkBPfqrCPDDUc5u8', workspaceId:'', displayName:'Samuel', localPartner:'Mezrid', zoom:100 } };
const GIR_WORKSPACE_ID='17f39873-e10f-4bdf-93ee-1f92b3e25251';
let data = structuredClone(defaults), tab = 'sheet', lastRenderedTab = null, lastRenderedClient = null, activeClient = null, selected = new Set(), selectionAnchor = null, collapsedGroups = new Set(), blankRows = 60, highlightUser = null, filter = 'all', clientApi = null, session = null, channel = null, syncing = false, toastTimer, syncTimer, importPreview = null, previewClientIndex = 0, migrating = false;
let authLoading=true,workspaceReady=false,workspaceResolving=false,accessMode='signin',accessError='';
let desktopUpdate = { status: 'unavailable', message: 'Checking update support…' };

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000); }
function save() { window.desk.write(data).catch(e => toast('Could not save locally: ' + e.message)); }
function enqueue(table,id) { const key=table+':'+id; if(!data.pending.some(p=>p.key===key))data.pending.push({key,table,id}); }
function scheduleSync(){if(!clientApi||!session||!data.settings.workspaceId)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>flushPending().catch(e=>toast('Sync waiting: '+e.message)),400);}
function queue(table, id) { enqueue(table,id); save(); scheduleSync(); }
function mutate(table, record) { record.updatedAt = new Date().toISOString(); const list = data[table]; const ix = list.findIndex(x => x.id === record.id); if (ix < 0) list.push(record); else list[ix] = record; queue(table, record.id); render(); }
function currentClient() { return data.clients.find(c => c.id === activeClient); }
function clientItems(id = activeClient) { return data.items.filter(i => i.clientId === id).sort((a,b) => a.sortOrder - b.sortOrder); }
function displayStatus(i) { return i.status === 'changes' ? 'Changes ' + (i.revisionCount || 1) : i.status[0].toUpperCase() + i.status.slice(1); }
function currentUserId() { return session?.user?.id || 'local-me'; }
function person(id) { return data.members.find(m => m.userId === id)?.displayName || (id === 'local-me' ? data.settings.displayName : id === 'local-partner' ? data.settings.localPartner : 'Team member'); }
function initials(name) { return String(name || '?').split(/\s+/).map(s => s[0]).join('').slice(0,2).toUpperCase(); }
function unfinishedCount(clientId) { return data.items.filter(i=>i.clientId===clientId && !['sent','paid','discarded'].includes(i.status)).length; }
function avatar(id,name,size='') { const src=data.members.find(m=>m.userId===id)?.avatarData || (id===currentUserId()?data.settings.avatarData:''); return src&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(src)?`<img class="avatar-image ${size}" src="${esc(src)}" alt="${esc(name)}">`:`<span>${esc(initials(name))}</span>`; }
function billedIds() { return new Set(data.invoices.flatMap(inv => inv.itemIds || [])); }
function financials() {
  const billed = billedIds(), amount = { revenue:0, awaiting:0, estimated:0, quoted:0, advances:0, openAdvances:0, discarded:0, closed:0, months:{} };
  const month = (date,field,value) => { const key=/^\d{4}-\d{2}/.test(date||'')?date.slice(0,7):'Undated'; const m=amount.months[key] ||= {received:0,closed:0,advances:0,discarded:0};m[field]+=value; };
  for (const inv of data.invoices) {
    const value=num(inv.finalAmount), advance=invoiceAdvance(inv);
    if(inv.status==='paid'){amount.revenue+=value;amount.closed+=value;month(inv.paidAt||inv.issueDate,'received',value);month(inv.paidAt||inv.issueDate,'closed',value);}
    else {amount.revenue+=advance;amount.openAdvances+=advance;amount.awaiting+=Math.max(0,value-advance);month(inv.issueDate,'received',advance);month(inv.issueDate,'advances',advance);}
  }
  for (const i of data.items) {
    if (i.status === 'discarded') { const advance=num(i.advanceAmount);amount.discarded+=num(i.quotedTotal);amount.advances+=advance;amount.revenue+=advance;month(i.workDate,'discarded',num(i.quotedTotal));month(i.advanceReceivedAt||i.workDate,'received',advance);month(i.advanceReceivedAt||i.workDate,'advances',advance);continue; }
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
    if(i.status==='paid'){amount.revenue+=value;amount.closed+=value;month(i.paidAt||i.workDate,'received',value);month(i.paidAt||i.workDate,'closed',value);}
    else {amount.revenue+=advance;amount.openAdvances+=advance;amount[i.status==='sent'?'awaiting':'estimated']+=Math.max(0,value-advance);month(i.advanceReceivedAt||i.workDate,'received',advance);month(i.advanceReceivedAt||i.workDate,'advances',advance);}
  }
  return amount;
}
function counts() { const all = data.items.filter(i=>i.status!=='discarded'), todayValue = today(); return { total:all.length, discarded:data.items.length-all.length, done:all.filter(i => ['sent','paid'].includes(i.status)).length, working:all.filter(i => ['working','changes'].includes(i.status)).length, pending:all.filter(i => i.status === 'pending').length, overdue:all.filter(i => i.dueDate && i.dueDate < todayValue && !['sent','paid'].includes(i.status)).length }; }
function render() {
  const main=$('#main'), sameSheet=tab==='sheet'&&lastRenderedTab==='sheet'&&lastRenderedClient===activeClient;
  const scroll=sameSheet?{main:main.scrollTop,grid:main.querySelector('.sheet-viewport')?.scrollTop||0,across:main.querySelector('.sheet-viewport')?.scrollLeft||0}:null;
  document.documentElement.style.setProperty('--grid-size', Math.round(12 * data.settings.zoom / 100) + 'px');
  document.documentElement.style.setProperty('--grid-height', Math.round(29 * data.settings.zoom / 100) + 'px');
  if(authLoading||!session||!workspaceReady||data.settings.workspaceId!==GIR_WORKSPACE_ID){
    $('#app').classList.remove('sheet-mode');$('#app').classList.add('access-mode');
    $('#tabs').hidden=true;$('.client-tabs').hidden=true;main.innerHTML=renderAccess();bindAccess();return;
  }
  $('#app').classList.remove('access-mode');$('#tabs').hidden=false;$('.client-tabs').hidden=false;
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
  lastRenderedClient=activeClient;bindMain();
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
  const list = [...data.clients].sort((a,b) => a.sortOrder-b.sortOrder || a.name.localeCompare(b.name));
  nav.innerHTML = list.map(c => `<button class="client-tab ${activeClient===c.id && tab==='sheet'?'active':''}" data-client="${c.id}" title="${unfinishedCount(c.id)} unfinished rows">${esc(c.name)}<small>${unfinishedCount(c.id)}</small></button>`).join('');
  nav.scrollLeft=position;
  $$('#clientList [data-client]').forEach(b => b.onclick = () => { activeClient = b.dataset.client; selected.clear();selectionAnchor=null;blankRows=60; tab='sheet'; render(); });
}
function renderTeam() {
  const members = data.members.length ? data.members : [{ userId:'local-me', displayName:data.settings.displayName }, { userId:'local-partner', displayName:data.settings.localPartner }];
  $('#teamList').innerHTML = members.map(m => { const works = data.items.filter(i => i.assigneeId === m.userId && ['working','changes'].includes(i.status)); return `<div class="member ${highlightUser===m.userId?'active':''}" data-member="${esc(m.userId)}"><div class="member-top"><div class="avatar">${avatar(m.userId,m.displayName)}</div><span class="member-name">${esc(m.displayName)}</span><span class="member-count">${works.length}</span></div><div class="member-rows">${works.slice(0,5).map(i=>`<button data-jump="${i.id}">${esc(data.clients.find(c=>c.id===i.clientId)?.name || '')} · ${esc(i.service)}</button>`).join('') || '<span class="muted">Available</span>'}</div></div>`; }).join('');
  $$('#teamList [data-member]').forEach(el => el.onclick = e => { const jump = e.target.closest('[data-jump]'); if (jump) { const item = data.items.find(i=>i.id===jump.dataset.jump); activeClient=item.clientId; tab='sheet'; highlightUser=item.assigneeId; render(); setTimeout(()=>document.querySelector(`[data-row="${item.id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'}),100); } else { highlightUser = highlightUser === el.dataset.member ? null : el.dataset.member; if (highlightUser) { const first=data.items.find(i=>i.assigneeId===highlightUser && ['working','changes'].includes(i.status)); if(first){activeClient=first.clientId;tab='sheet';} } render(); } });
  const c=counts(), f=financials(); $('#quickView').innerHTML = `<div class="qstat"><span>WORK IN PROGRESS</span><b>${c.working} tasks</b></div><div class="qstat"><span>AWAITING PAYMENT</span><b>${money(f.awaiting)}</b></div><div class="qstat"><span>OVERDUE</span><b>${c.overdue} tasks</b></div>`;
}
function renderDashboard() {
  const c=counts(), f=financials(), completion=c.total?Math.round(c.done/c.total*100):0;
  const priority=data.clients.map(cl=>({cl,items:clientItems(cl.id).filter(i=>!['sent','paid','discarded'].includes(i.status))})).filter(x=>x.items.length).sort((a,b)=>b.items.length-a.items.length).slice(0,6);
  const byClient=data.clients.map(cl=>{ const its=clientItems(cl.id).filter(i=>i.status!=='discarded');return {cl,total:its.length,done:its.filter(i=>['sent','paid'].includes(i.status)).length,pending:unfinishedCount(cl.id)};}).filter(x=>x.pending>0).sort((a,b)=>a.pending-b.pending || b.done/b.total-a.done/a.total || a.cl.name.localeCompare(b.cl.name)).slice(0,5);
  return `<div class="section-top"><div><h2>Your studio at a glance</h2><p>Live progress across ${data.clients.length} clients.</p></div></div>
    <div class="cards"><div class="card blue"><div class="card-label">Completed work</div><div class="card-value">${completion}%</div><div class="card-foot">${c.done} of ${c.total} tasks sent or paid</div></div><div class="card"><div class="card-label">In progress</div><div class="card-value">${c.working}</div><div class="card-foot">${c.pending} waiting to start</div></div><div class="card amber"><div class="card-label">Awaiting payment</div><div class="card-value">${money(f.awaiting)}</div><div class="card-foot">Sent or invoiced work</div></div><div class="card green"><div class="card-label">Revenue received</div><div class="card-value">${money(f.revenue)}</div><div class="card-foot">Recorded payments</div></div></div>
    <div class="grid-2"><div class="panel"><h3>Clients with most pending work</h3>${priority.length?priority.map(x=>`<div class="list-row"><div><strong>${esc(x.cl.name)}</strong><small>${x.items.length} unfinished rows</small></div><button class="small-btn" data-client-open="${x.cl.id}">Open sheet</button></div>`).join(''):'<p class="muted">No pending work right now.</p>'}</div>
    <div class="panel"><h3>Clients closest to completion</h3>${byClient.length?byClient.map(x=>`<div class="metric-row"><div style="width:100%"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong>${esc(x.cl.name)}</strong><span class="muted">${x.pending} left · ${x.done}/${x.total}</span></div><div class="bar"><span style="width:${x.done/x.total*100}%"></span></div></div></div>`).join(''):'<p class="muted">No unfinished client work right now.</p>'}</div></div>`;
}
function groupHeader(kind,group,items) {
  const done=items.filter(i=>['sent','paid'].includes(i.status)).length;
  const active=items.filter(i=>i.status!=='discarded');
  const folded=collapsedGroups.has(kind+':'+group.id);
  const detail=kind==='deal'&&group.agreedAmount!=null?` · Agreed ${money(group.agreedAmount)}`:'';
  return `<tr class="sheet-group-header ${kind}"><td colspan="11"><div class="group-heading"><button data-group-collapse="${kind}:${group.id}" aria-expanded="${!folded}">${folded?'▸':'▾'} <strong>${esc(group.label)}</strong><span>${done}/${active.length} complete${detail}</span></button>${kind==='project'?`<button class="group-add" data-group-add="${group.id}" title="Add work under this project">＋ Row</button><button class="group-rename" data-group-rename="${group.id}" title="Rename project group">Rename</button>`:''}</div></td></tr>`;
}
function blankRowHtml(order) {
  const cell=(key,placeholder='')=>`<td><input data-blank-cell="${key}" data-blank-order="${order}" value="" placeholder="${placeholder}" readonly></td>`;
  return `<tr class="blank-row" data-blank-row="${order}"><td class="row-selector"></td><td class="serial-cell">${order+1}</td>${cell('workDate','dd/mm/yyyy')}${cell('service')}${cell('quantity')}${cell('rate')}${cell('quotedTotal')}<td class="status-cell"></td>${cell('advanceAmount')}<td class="assignee-cell"></td>${cell('remarks')}</tr>`;
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
      <td class="status-cell ${i.status}"><select class="${i.status}" data-cell="status" data-id="${i.id}" tabindex="-1">${['pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}" ${s===i.status?'selected':''}>${s==='changes'?'Changes '+(i.revisionCount||1):s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></td>
      ${value('advanceAmount',i.advanceAmount||0,'class="money-cell"')}
      <td class="assignee-cell"><button type="button" class="assignee-button" data-assignee-pick="${i.id}" title="${esc(i.assigneeId?person(i.assigneeId):'Assign person')}">${i.assigneeId?avatar(i.assigneeId,person(i.assigneeId)):'<span>＋</span>'}</button></td>
      ${value('remarks',i.remarks||'')}</tr>`;
  }
  if(filter==='all')rows+=Array.from({length:blankRows},(_,n)=>blankRowHtml(all.length+n)).join('');
  return `<div class="sheet-shell"><div class="sheet-toolbar"><div class="actions"><button class="small-btn blue" data-action="assign" ${selected.size?'':'disabled'}>● Start work</button><button class="small-btn" data-action="complete" ${selected.size?'':'disabled'}>✓ Mark sent</button><button class="small-btn" data-action="invoice" ${selected.size?'':'disabled'}>▣ Create invoice</button><button class="small-btn" data-action="group" ${selected.size>1?'':'disabled'}>Group deal</button><button class="small-btn" data-action="project-group" ${selected.size?'':'disabled'}>Group project</button><select id="workFilter" aria-label="Filter work">${['all','pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}" ${filter===s?'selected':''}>${s==='all'?'All work':s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></div><span class="hint" id="selectedCount">${selected.size} selected</span></div>
    <div class="sheet-viewport"><table class="sheet"><thead><tr><th class="row-selector"><input type="checkbox" id="selectAll" aria-label="Select visible rows"></th><th>SR</th><th>DATE</th><th>SERVICE PROVIDED</th><th>QTY</th><th>RATE</th><th>TOTAL</th><th>STATUS</th><th>ADVANCE</th><th>ASSIGNED</th><th>REMARKS</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderDeadlines() {
  const rows=data.items.filter(i=>i.dueDate && i.status!=='discarded').sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  return `<div class="section-top"><div><h2>What needs to go out</h2><p>Deadlines set directly on work rows.</p></div></div>${rows.length?`<table class="table-list"><thead><tr><th>DUE</th><th>CLIENT</th><th>WORK</th><th>ASSIGNED</th><th>STATUS</th></tr></thead><tbody>${rows.map(i=>`<tr data-jump-item="${i.id}"><td><strong>${fmtDate(i.dueDate)}</strong></td><td>${esc(data.clients.find(c=>c.id===i.clientId)?.name)}</td><td>${esc(i.service)}</td><td>${esc(person(i.assigneeId))}</td><td><span class="pill ${i.dueDate<today()&&!['paid','sent'].includes(i.status)?'overdue':i.status}">${i.dueDate<today()&&!['paid','sent'].includes(i.status)?'Overdue':displayStatus(i)}</span></td></tr>`).join('')}</tbody></table>`:`<div class="empty"><h3>No deadlines yet</h3><p>Add a due date to any row in the work sheet. Upcoming work will appear here.</p></div>`}`;
}
function renderTracker() {
  const members=data.members.length?data.members:[{userId:'local-me',displayName:data.settings.displayName},{userId:'local-partner',displayName:data.settings.localPartner}];
  const working=data.items.filter(i=>['working','changes'].includes(i.status));
  const pending=data.items.filter(i=>i.status==='pending');
  return `<div class="section-top"><div><h2>Work Tracker</h2><p>Live assignments and unfinished work across clients.</p></div><span class="pill working">${working.length} being worked on</span></div>
    <div class="tracker-grid">${members.map(m=>{const work=working.filter(i=>i.assigneeId===m.userId);return `<div class="panel"><h3><span class="tracker-avatar">${avatar(m.userId,m.displayName)}</span>${esc(m.displayName)} <span class="muted">${work.length}</span></h3>${work.length?work.map(i=>`<button class="tracker-item" data-jump-item="${i.id}"><strong>${esc(i.service)}</strong><small>${esc(data.clients.find(c=>c.id===i.clientId)?.name)} · ${esc(displayStatus(i))}</small></button>`).join(''):'<p class="muted">Available</p>'}</div>`;}).join('')}</div>
    <div class="panel"><h3>Not started · ${pending.length}</h3>${pending.slice(0,30).map(i=>`<button class="tracker-item" data-jump-item="${i.id}"><strong>${esc(i.service)}</strong><small>${esc(data.clients.find(c=>c.id===i.clientId)?.name)}</small></button>`).join('')||'<p class="muted">No pending rows.</p>'}</div>`;
}
function renderGroups() {
  const groups=[...data.projectGroups.map(g=>({...g,kind:'project'})),...data.groups.map(g=>({...g,kind:'deal'}))];
  const cards=groups.map(g=>{
    const rows=data.items.filter(i=>(g.kind==='project'?i.projectGroupId:i.groupId)===g.id);
    const active=rows.filter(i=>i.status!=='discarded');
    const done=active.filter(i=>['sent','paid'].includes(i.status)).length;
    const amount=g.kind==='deal'&&g.agreedAmount!=null?`<span>Agreed ${money(g.agreedAmount)}</span>`:'';
    return `<button class="group-card" data-open-group="${g.kind}:${g.id}"><span class="group-badge">${g.kind==='project'?'PROJECT GROUP':'DEAL GROUP'}</span><strong>${esc(g.label)}</strong><small>${esc(data.clients.find(c=>c.id===g.clientId)?.name)} · ${done}/${active.length} complete · ${active.length-done} left</small>${amount}<div class="bar"><span style="width:${active.length?done/active.length*100:0}%"></span></div></button>`;
  }).join('');
  return `<div class="section-top"><div><h2>Groups</h2><p>Project folders and negotiated deals across clients.</p></div></div>${groups.length?`<div class="group-grid">${cards}</div>`:'<div class="empty"><h3>No groups yet</h3><p>Select rows on a worksheet to create a project group or grouped deal.</p></div>'}`;
}function renderClientDetails() {
  return `<div class="section-top"><div><h2>Client Details</h2><p>Billing information used on invoices.</p></div></div><div class="panel">${data.clients.length?data.clients.map(c=>`<div class="list-row"><div><strong>${esc(c.name)}</strong><small>${esc(c.billing?.name||'No billing name')} · ${esc(c.billing?.email||'No email')}</small></div><button class="small-btn" data-billing-edit="${c.id}">Edit details</button></div>`).join(''):'<p class="muted">Add a client using the + button in the bottom tab bar.</p>'}</div>`;
}
function renderRevenue() {
  const f=financials(), months=Object.entries(f.months).sort(([a],[b])=>b.localeCompare(a));
  return `<div class="section-top"><div><h2>Revenue</h2><p>Received cash includes advances on ongoing work. Closed value counts paid work.</p></div></div>
    <div class="cards"><div class="card green"><div class="card-label">Received</div><div class="card-value">${money(f.revenue)}</div><div class="card-foot">Paid work and open-work advances</div></div><div class="card blue"><div class="card-label">Successfully closed</div><div class="card-value">${money(f.closed)}</div><div class="card-foot">Paid projects at their final value</div></div><div class="card amber"><div class="card-label">Ongoing advances</div><div class="card-value">${money(f.openAdvances)}</div><div class="card-foot">Already received on open projects</div></div><div class="card"><div class="card-label">Discarded project value</div><div class="card-value">${money(f.discarded)}</div><div class="card-foot">Excluded from pending income</div></div></div>
    <div class="cards"><div class="card amber"><div class="card-label">Awaiting payment</div><div class="card-value">${money(f.awaiting)}</div><div class="card-foot">Sent work after advances</div></div><div class="card blue"><div class="card-label">Estimated incoming</div><div class="card-value">${money(f.estimated)}</div><div class="card-foot">Ongoing work after advances</div></div><div class="card"><div class="card-label">Original active quote</div><div class="card-value">${money(f.quoted)}</div></div></div>
    <div class="panel"><h3>Revenue by month</h3><p class="muted">Imported payments and advances use the worksheet date because the old workbook has no separate receipt date. New payments use the date recorded in the app.</p>${months.length?`<table class="table-list"><thead><tr><th>MONTH</th><th>RECEIVED</th><th>CLOSED</th><th>ADVANCES ON OPEN WORK</th><th>DISCARDED VALUE</th></tr></thead><tbody>${months.map(([key,m])=>`<tr><td><strong>${esc(key)}</strong></td><td>${money(m.received)}</td><td>${money(m.closed)}</td><td>${money(m.advances)}</td><td>${money(m.discarded)}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Import a workbook or record payments to see monthly totals.</p>'}</div>`;
}
function renderPayments() { const f=financials(), issued=data.invoices.filter(i=>i.status==='issued'), sent=data.items.filter(i=>i.status==='sent'&&!billedIds().has(i.id)); return `<div class="section-top"><div><h2>Payment tracking</h2><p>Only sent work and issued invoices are due for payment.</p></div></div><div class="cards"><div class="card amber"><div class="card-label">Awaiting payment</div><div class="card-value">${money(f.awaiting)}</div></div><div class="card blue"><div class="card-label">Work not sent yet</div><div class="card-value">${money(f.estimated)}</div></div></div><div class="panel"><h3>Issued invoices</h3>${issued.length?issued.map(i=>`<div class="list-row"><div><strong>${esc(i.number)}</strong><small>${esc(data.clients.find(c=>c.id===i.clientId)?.name)} · ${fmtDate(i.issueDate)}</small></div><div class="actions"><strong>${money(Math.max(0,num(i.finalAmount)-invoiceAdvance(i)))}</strong><button class="small-btn" data-invoice-view="${i.id}">View</button><button class="small-btn blue" data-invoice-paid="${i.id}">Record paid</button></div></div>`).join(''):'<p class="muted">No invoices waiting for payment.</p>'}</div><div class="panel"><h3>Sent work not yet invoiced</h3>${sent.length?sent.slice(0,20).map(i=>`<div class="list-row"><div><strong>${esc(i.service)}</strong><small>${esc(data.clients.find(c=>c.id===i.clientId)?.name)}</small></div><span>${money(Math.max(0,num(i.quotedTotal)-num(i.advanceAmount)))}</span></div>`).join(''):'<p class="muted">None at the moment.</p>'}</div>`; }
function renderInvoices() { return `<div class="section-top"><div><h2>Invoices</h2><p>Create an invoice from finished rows on a client work sheet.</p></div></div>${data.invoices.length?`<table class="table-list"><thead><tr><th>NUMBER</th><th>CLIENT</th><th>ISSUED</th><th>ROWS</th><th>FINAL AMOUNT</th><th>STATUS</th><th></th></tr></thead><tbody>${[...data.invoices].reverse().map(i=>`<tr><td><strong>${esc(i.number)}</strong></td><td>${esc(data.clients.find(c=>c.id===i.clientId)?.name)}</td><td>${fmtDate(i.issueDate)}</td><td>${i.itemIds.length}</td><td><strong>${money(i.finalAmount)}</strong></td><td><span class="pill ${i.status==='paid'?'paid':'sent'}">${i.status==='paid'?'Paid':'Issued'}</span></td><td><button class="small-btn" data-invoice-view="${i.id}">View</button></td></tr>`).join('')}</tbody></table>`:`<div class="empty"><h3>No invoices yet</h3><p>Select sent rows on a client sheet, then choose Create invoice.</p></div>`}`; }
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
function renderSettings() { const s=data.settings; return `<div class="section-top"><div><h2>Workspace settings</h2><p>Business details, people and Supabase connection.</p></div></div><div class="grid-2"><div class="panel"><h3>Business on invoices</h3><div class="field"><label>Business name</label><input data-setting="seller.name" value="${esc(s.seller.name)}"></div><div class="field"><label>Address</label><textarea data-setting="seller.address" rows="3">${esc(s.seller.address)}</textarea></div><div class="field-grid"><div class="field"><label>Email</label><input data-setting="seller.email" value="${esc(s.seller.email)}"></div><div class="field"><label>Phone</label><input data-setting="seller.phone" value="${esc(s.seller.phone)}"></div></div><div class="field"><label>Tax / GST ID (optional)</label><input data-setting="seller.taxId" value="${esc(s.seller.taxId)}"></div><button class="small-btn blue" data-action="save-settings">Save business details</button></div><div class="panel"><h3>Your team</h3><label class="avatar-upload"><span class="avatar">${avatar(currentUserId(),s.displayName)}</span><span>Choose your avatar image</span><input id="avatarUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label><div class="field"><label>Your display name</label><input data-setting="displayName" value="${esc(s.displayName)}"></div>${!session?`<div class="field"><label>Second person (local view)</label><input data-setting="localPartner" value="${esc(s.localPartner)}"></div>`:''}<button class="small-btn blue" data-action="save-settings">Save names</button><div class="notice">When connected, both people sign in with their own Supabase accounts. Assignments and updates then appear live on both PCs.</div></div></div>
    <div class="panel"><h3>Supabase connection</h3><div class="field-grid"><div class="field"><label>Project URL</label><input id="supaUrl" placeholder="https://project.supabase.co" value="${esc(s.url)}"></div><div class="field"><label>Publishable / anon key</label><input id="supaKey" type="password" placeholder="Never enter a service-role key" value="${esc(s.key)}"></div></div><div class="actions"><button class="small-btn" data-action="save-connection">Save connection</button>${session?`<span class="pill paid">Signed in as ${esc(session.user.email)}</span><button class="small-btn" data-action="sign-out">Sign out</button>`:`<button class="small-btn blue" data-action="sign-in">Sign in</button><button class="small-btn" data-action="sign-up">Create account</button>`}</div>${session?`<div class="notice">Workspace code: <strong>${esc(s.joinCode||'Create or join a workspace')}</strong> · Share this code with your second team member. Workspace ID: ${esc(s.workspaceId||'none')}</div><div class="actions"><button class="small-btn blue" data-action="sync">Sync now</button></div>`:''}</div><div class="panel"><h3>Desktop app</h3><p class="muted">Changes sync automatically while connected.</p><div class="actions"><button class="small-btn" data-action="sync">Sync now</button><button class="small-btn blue" id="updateBtn">Check for updates</button><span id="appVersion"></span></div><p class="muted" id="updateStatus"></p></div>`; }

function bindMain() {
  $$('[data-action]').forEach(b=>b.onclick=()=>actions(b.dataset.action));
  $$('[data-preview-client]').forEach(b=>b.onclick=()=>{previewClientIndex=Number(b.dataset.previewClient);render();});
  $$('[data-preview-amount]').forEach(el=>el.onchange=()=>{const group=importPreview?.clients.flatMap(c=>c.groups).find(g=>g.id===el.dataset.previewAmount);if(group){group.agreedAmount=el.value.trim()===''?null:num(el.value);render();}});
  $$('[data-preview-advance]').forEach(el=>el.onchange=()=>{const item=importPreview?.clients.flatMap(c=>c.items).find(i=>i.id===el.dataset.previewAdvance);if(item){item.advanceAmount=Math.max(0,num(el.value));render();}});
  const workFilter=$('#workFilter');if(workFilter)workFilter.onchange=()=>{filter=workFilter.value;selected.clear();render();};
  $$('[data-check]').forEach(b=>{b.onclick=e=>e.stopPropagation();b.onchange=()=>{b.checked?selected.add(b.dataset.check):selected.delete(b.dataset.check);selectionAnchor=b.dataset.check;refreshSelection();};});
  const all=$('#selectAll'); if(all) all.onchange=()=>{$$('[data-check]').forEach(b=>all.checked?selected.add(b.dataset.check):selected.delete(b.dataset.check));refreshSelection();};
  $$('[data-cell]').forEach(el=>{ el.onchange=()=>editCell(el.dataset.id,el.dataset.cell,el.value); if(el.tagName==='INPUT') el.onpaste=e=>pasteGrid(e,el); });
  $$('[data-assignee-pick]').forEach(b=>b.onclick=()=>assignPersonDialog(b.dataset.assigneePick));
  $('#avatarUpload')?.addEventListener('change',e=>{if(e.target.files?.[0])saveAvatar(e.target.files[0]);});
  $$('[data-row]').forEach(row=>{
    row.onclick=e=>{if(e.target.closest('button')||e.target.matches('[type=checkbox]'))return;selectSheetRow(row.dataset.row,e.shiftKey,e.ctrlKey||e.metaKey);};
    row.ondblclick=e=>{const td=e.target.closest('td'),field=td?.querySelector('[data-cell]');if(field)activateSheetField(field);};
    row.oncontextmenu=e=>{e.preventDefault();if(!selected.has(row.dataset.row))selectSheetRow(row.dataset.row,false,false);const menu=$('#contextMenu')||document.createElement('div');menu.id='contextMenu';menu.className='context-menu';menu.innerHTML='<button id="contextInvoice">▣ &nbsp; Create invoice</button><button id="contextAssign">● &nbsp; Start work</button><button id="contextSent">✓ &nbsp; Mark sent</button>';document.body.appendChild(menu);menu.style.left=Math.min(e.clientX,innerWidth-190)+'px';menu.style.top=Math.min(e.clientY,innerHeight-135)+'px';$('#contextInvoice').onclick=()=>{menu.remove();invoiceDialog();};$('#contextAssign').onclick=()=>{menu.remove();assign([...selected]);};$('#contextSent').onclick=()=>{menu.remove();markSent([...selected]);};setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);};
  });
  $$('[data-blank-row]').forEach(row=>{row.onclick=()=>{$$('[data-blank-row]').forEach(r=>r.classList.remove('blank-selected'));row.classList.add('blank-selected');};row.ondblclick=e=>{const field=e.target.closest('td')?.querySelector('[data-blank-cell]');if(field)activateSheetField(field);};});
  $$('[data-blank-cell]').forEach(el=>{el.onchange=()=>materializeBlankRow(el);el.onpaste=e=>pasteBlankGrid(e,el);});
  $$('[data-group-collapse]').forEach(b=>b.onclick=()=>{const id=b.dataset.groupCollapse;collapsedGroups.has(id)?collapsedGroups.delete(id):collapsedGroups.add(id);render();});
  $$('[data-group-add]').forEach(b=>b.onclick=()=>{const group=data.projectGroups.find(g=>g.id===b.dataset.groupAdd);if(!group)return;const item=newItem(group.clientId,clientItems(group.clientId).length);item.projectGroupId=group.id;mutate('items',item);setTimeout(()=>{const row=document.querySelector(`[data-row="${item.id}"]`);row?.scrollIntoView({block:'center'});const field=row?.querySelector('[data-cell="service"]');if(field)activateSheetField(field);},60);});
  $$('[data-group-rename]').forEach(b=>b.onclick=()=>renameProjectGroup(b.dataset.groupRename));
  const viewport=$('.sheet-viewport');if(tab==='sheet'&&viewport)viewport.onscroll=()=>{if(filter==='all'&&viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<700){blankRows+=40;render();}};
  $$('[data-group-edit]').forEach(b=>b.onclick=()=>groupDialog(b.dataset.groupEdit));
  $$('[data-open-group]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.openGroup.split(':');const group=(kind==='project'?data.projectGroups:data.groups).find(g=>g.id===id);if(!group)return;activeClient=group.clientId;filter='all';collapsedGroups.delete(kind+':'+id);tab='sheet';render();setTimeout(()=>document.querySelector(`[data-group-collapse="${kind}:${id}"]`)?.scrollIntoView({block:'center'}),50);});
  $$('[data-billing-edit]').forEach(b=>b.onclick=()=>billingDialog(b.dataset.billingEdit));
  $$('[data-client-open]').forEach(b=>b.onclick=()=>{activeClient=b.dataset.clientOpen;tab='sheet';render();});
  if($('#updateBtn'))$('#updateBtn').onclick=updateApp;
  $$('[data-invoice-view]').forEach(b=>b.onclick=()=>viewInvoice(b.dataset.invoiceView));
  $$('[data-invoice-paid]').forEach(b=>b.onclick=()=>markInvoicePaid(b.dataset.invoicePaid));
  $$('[data-jump-item]').forEach(r=>r.onclick=()=>{const i=data.items.find(x=>x.id===r.dataset.jumpItem);activeClient=i.clientId;tab='sheet';render();setTimeout(()=>document.querySelector(`[data-row="${i.id}"]`)?.scrollIntoView({block:'center'}),100);});
}
function refreshSelection() {
  $$('[data-row]').forEach(row=>row.classList.toggle('selected',selected.has(row.dataset.row)));
  $$('[data-check]').forEach(box=>box.checked=selected.has(box.dataset.check));
  const count=$('#selectedCount');if(count)count.textContent=`${selected.size} selected`;
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
    data.items.push(item);enqueue('items',item.id);
  }
  save();scheduleSync();render();
}
function editCell(id, key, value) {
  const i=data.items.find(x=>x.id===id); if(!i)return;
  if(['quantity','rate','quotedTotal','advanceAmount'].includes(key)) value=Math.max(0,num(value));
  if(key==='status') { if(value==='working'&&i.status==='sent') { value='changes';i.revisionCount=(i.revisionCount||0)+1; } if(value==='changes'&&i.status!=='changes') i.revisionCount=(i.revisionCount||0)+1; if(value==='working'||value==='changes') i.assigneeId ||= currentUserId(); }
  if(key==='status'&&value==='paid'&&i.status!=='paid')i.paidAt=today();
  if(key==='advanceAmount'&&value>0&&!i.advanceReceivedAt)i.advanceReceivedAt=today();
  i[key]=value;
  if(key==='quantity'||key==='rate') { i.manualTotal=false; i.quotedTotal=num(i.quantity)*num(i.rate); }
  if(key==='quotedTotal')i.manualTotal=true;
  mutate('items',i);
}
function pasteGrid(e,el) {
  const text=e.clipboardData.getData('text/plain'); if(!text.includes('\t')&&!text.includes('\n'))return;
  e.preventDefault(); const columns=['serial','workDate','service','quantity','rate','quotedTotal','status','advanceAmount','assigneeId','remarks']; const startCol=columns.indexOf(el.dataset.cell); if(startCol<0)return;
  const rows=text.trimEnd().split(/\r?\n/).map(r=>r.split('\t')); const items=clientItems(); let start=items.findIndex(i=>i.id===el.dataset.id);
  for(const cells of rows) { let item=items[start]; if(!item){item=newItem(activeClient,items.length);items.push(item);data.items.push(item);} cells.forEach((v,c)=>{const key=columns[startCol+c];if(!key)return;if(['quantity','rate','quotedTotal','advanceAmount'].includes(key))v=Math.max(0,num(v));if(key==='status'){v=v.trim()==='-'?'discarded':v.trim().toLowerCase()||'pending';if(v==='paid'&&item.status!=='paid')item.paidAt=today();}if(key==='advanceAmount'&&v>0&&!item.advanceReceivedAt)item.advanceReceivedAt=today();item[key]=v;}); if(!item.manualTotal && cells.length && !cells.some((_,c)=>columns[startCol+c]==='quotedTotal'))item.quotedTotal=num(item.quantity)*num(item.rate); enqueue('items',item.id);start++; }
  save();scheduleSync();
  toast(`Pasted ${rows.length} row${rows.length===1?'':'s'}`);render();
}
function newItem(clientId,order) { return { id:uid(), clientId, groupId:null, projectGroupId:null, sourceRow:null, sortOrder:order, serial:String(order+1), workDate:today(), dueDate:'', service:'', quantity:1, rate:0, quotedTotal:0, advanceAmount:0, status:'pending', revisionCount:0, assigneeId:'', remarks:'', manualTotal:false }; }
function assign(ids) { ids.forEach(id=>{const i=data.items.find(x=>x.id===id);if(!i||i.status==='discarded')return;if(i.status==='sent'){i.status='changes';i.revisionCount=(i.revisionCount||0)+1;}else if(i.status!=='changes')i.status='working';i.assigneeId=currentUserId();queue('items',id);});selected.clear();render(); }
function markSent(ids) { ids.forEach(id=>{const i=data.items.find(x=>x.id===id);if(!i||i.status==='discarded')return;i.status='sent';queue('items',id);});selected.clear();render();toast('Work marked sent'); }
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
function inputValue(id){return $('#'+id)?.value.trim()||'';}
async function saveSettings(){
  $$('[data-setting]').forEach(el=>{const path=el.dataset.setting.split('.');if(path.length===2)data.settings[path[0]][path[1]]=el.value;else data.settings[path[0]]=el.value;});
  save();
  if(clientApi&&session&&data.settings.workspaceId){const {error}=await clientApi.from('members').update({display_name:data.settings.displayName}).eq('workspace_id',data.settings.workspaceId).eq('user_id',session.user.id);if(error)toast('Saved locally; team name sync failed: '+error.message);else {const me=data.members.find(m=>m.userId===session.user.id);if(me)me.displayName=data.settings.displayName;}}
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
function groupDialog(id){const chosen=id?data.items.filter(i=>i.groupId===id):data.items.filter(i=>selected.has(i.id));if(!chosen.length)return;const existing=id?data.groups.find(g=>g.id===id):null;const quote=chosen.reduce((n,i)=>n+num(i.quotedTotal),0);modal(existing?'Edit grouped deal':'Group selected rows',`<p>${chosen.length} rows · Original quote ${money(quote)}</p><div class="field"><label>Group name</label><input id="groupLabel" value="${esc(existing?.label||'Agreed deal')}"></div><div class="field"><label>Agreed final amount</label><input id="groupAmount" type="number" min="0" step="0.01" placeholder="Enter negotiated amount" value="${existing?.agreedAmount??''}"></div><div class="notice">This amount replaces the sum of row totals in revenue and payment estimates. Individual rows stay visible for work tracking.</div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveGroup">Save group</button></div>`);$('#saveGroup').onclick=()=>{const value=inputValue('groupAmount');const g=existing||{id:uid(),clientId:activeClient};g.label=inputValue('groupLabel')||'Agreed deal';g.agreedAmount=value===''?null:num(value);if(!existing)chosen.forEach(i=>{i.groupId=g.id;queue('items',i.id);});mutate('groups',g);selected.clear();closeModal();toast('Deal group saved');};}
function projectGroupDialog() {
  const chosen=data.items.filter(i=>selected.has(i.id));if(!chosen.length)return;
  if(new Set(chosen.map(i=>i.clientId)).size!==1){toast('Select rows from one client');return;}
  modal('Group project',`<p>Organize ${chosen.length} selected rows under one collapsible project heading.</p><div class="field"><label>Project group name</label><input id="projectGroupName" placeholder="For example, Sheena and Royston" autofocus></div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveProjectGroup">Create group</button></div>`);
  $('#saveProjectGroup').onclick=()=>{const name=inputValue('projectGroupName');if(!name){toast('Enter a group name');return;}const group={id:uid(),clientId:chosen[0].clientId,label:name};for(const item of chosen){item.projectGroupId=group.id;queue('items',item.id);}mutate('projectGroups',group);selected.clear();closeModal();toast('Project group created');};
}
function renameProjectGroup(id){const group=data.projectGroups.find(g=>g.id===id);if(!group)return;modal('Rename project group',`<div class="field"><label>Project group name</label><input id="renameProject" value="${esc(group.label)}"></div>`,`<div class="modal-actions"><button class="small-btn blue" id="saveProjectName">Save name</button></div>`);$('#saveProjectName').onclick=()=>{const label=inputValue('renameProject');if(!label)return;group.label=label;mutate('projectGroups',group);closeModal();};}
function invoiceDialog(){const items=data.items.filter(i=>selected.has(i.id));if(!items.length)return;const notReady=items.filter(i=>i.status!=='sent');if(notReady.length){toast('Select rows marked Sent for a new invoice');return;}if(items.some(i=>billedIds().has(i.id))){toast('One or more rows are already invoiced');return;}if(new Set(items.map(i=>i.clientId)).size!==1){toast('Choose rows from one client');return;}const subtotal=items.reduce((n,i)=>n+num(i.quotedTotal),0);const next=String(data.invoices.length+1).padStart(4,'0');modal('Create invoice',`<p>${items.length} finished rows from ${esc(currentClient()?.name)}.</p><div class="preview-list">${items.map((i,n)=>`<div class="list-row"><div><strong>${n+1}. ${esc(i.service)}</strong><small>${i.quantity} × ${money(i.rate)}</small></div><strong>${money(i.quotedTotal)}</strong></div>`).join('')}</div><div class="field-grid" style="margin-top:15px"><div class="field"><label>Invoice number</label><input id="invNumber" value="GIR-${new Date().getFullYear()}-${next}"></div><div class="field"><label>Issue date</label><input id="invDate" type="date" value="${today()}"></div><div class="field"><label>Discount</label><input id="invDiscount" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Agreed final amount (overrides discount)</label><input id="invFinal" type="number" min="0" step="0.01" placeholder="Optional"></div></div><div class="notice">Subtotal ${money(subtotal)}. Advances already received: ${money(items.reduce((n,i)=>n+num(i.advanceAmount),0))}. The final amount is the full agreed price; the invoice will show advances separately and deduct them from the balance due.</div>`,`<div class="modal-actions"><button class="small-btn" id="cancelInvoice">Cancel</button><button class="small-btn blue" id="createInvoice">Create invoice</button></div>`,true);$('#cancelInvoice').onclick=closeModal;$('#createInvoice').onclick=()=>{const discount=num(inputValue('invDiscount')),final=inputValue('invFinal');if(discount>subtotal){toast('Discount exceeds subtotal');return;}const amount=final===''?subtotal-discount:num(final);const invoice={id:uid(),clientId:items[0].clientId,number:inputValue('invNumber')||`GIR-${next}`,issueDate:inputValue('invDate')||today(),itemIds:items.map(i=>i.id),lines:items.map((i,n)=>({serial:n+1,service:i.service,quantity:num(i.quantity),rate:num(i.rate),total:num(i.quotedTotal)})),subtotal,discount:final===''?discount:subtotal-amount,finalAmount:amount,advanceAmount:items.reduce((n,i)=>n+num(i.advanceAmount),0),status:'issued',seller:structuredClone(data.settings.seller),buyer:structuredClone(currentClient()?.billing||{})};mutate('invoices',invoice);selected.clear();closeModal();viewInvoice(invoice.id);};}
function invoiceAdvance(i){return i.advanceAmount==null?(i.itemIds||[]).reduce((sum,id)=>sum+num(data.items.find(item=>item.id===id)?.advanceAmount),0):num(i.advanceAmount);}
function invoiceHtml(i){return `<div class="invoice-paper"><div class="invoice-top"><div><div class="mark">G<span>I</span>R</div><h1>Invoice</h1><div class="muted">${esc(i.seller.name||'GIR')}</div></div><div class="invoice-meta"><div class="label">INVOICE NO.</div><strong>${esc(i.number)}</strong><p>${fmtDate(i.issueDate)}</p><span class="pill ${i.status==='paid'?'paid':'sent'}">${i.status==='paid'?'PAID':'ISSUED'}</span></div></div><div class="invoice-parties"><div><div class="label">FROM</div><strong>${esc(i.seller.name||'')}</strong><p>${esc(i.seller.address||'').replace(/\n/g,'<br>')}<br>${esc(i.seller.email||'')} ${esc(i.seller.phone||'')}<br>${esc(i.seller.taxId||'')}</p></div><div><div class="label">BILL TO</div><strong>${esc(i.buyer.name||'')}</strong><p>${esc(i.buyer.address||'').replace(/\n/g,'<br>')}<br>${esc(i.buyer.email||'')} ${esc(i.buyer.phone||'')}<br>${esc(i.buyer.taxId||'')}</p></div></div><table><thead><tr><th>#</th><th>SERVICE</th><th>QTY</th><th>RATE</th><th>TOTAL</th></tr></thead><tbody>${i.lines.map(l=>`<tr><td>${l.serial}</td><td>${esc(l.service)}</td><td>${l.quantity}</td><td>${money(l.rate)}</td><td>${money(l.total)}</td></tr>`).join('')}</tbody></table><div class="totals"><div><span>Subtotal</span><strong>${money(i.subtotal)}</strong></div><div><span>Discount / adjustment</span><strong>${money(i.discount)}</strong></div><div><span>Final agreed amount</span><strong>${money(i.finalAmount)}</strong></div><div><span>Advance received</span><strong>− ${money(invoiceAdvance(i))}</strong></div><div class="grand"><span>Balance due</span><strong>${money(i.status==='paid'?0:Math.max(0,num(i.finalAmount)-invoiceAdvance(i)))}</strong></div></div><div class="thankyou">Thank you for working with GIR.</div></div>`;}
function viewInvoice(id){const i=data.invoices.find(x=>x.id===id);if(!i)return;modal('Invoice preview',`<div id="invoicePreview">${invoiceHtml(i)}</div>`,`<div class="modal-actions"><button class="small-btn" id="printInvoice">Print / save PDF</button>${i.status==='issued'?`<button class="small-btn blue" id="recordPayment">Record paid</button>`:''}</div>`,true);$('#printInvoice').onclick=()=>{$('#printArea')?.remove();const div=document.createElement('div');div.id='printArea';div.className='print-only';div.innerHTML=invoiceHtml(i);document.body.appendChild(div);window.desk.print().finally(()=>setTimeout(()=>div.remove(),500));};if($('#recordPayment'))$('#recordPayment').onclick=()=>{markInvoicePaid(i.id);closeModal();};}
function markInvoicePaid(id){const i=data.invoices.find(x=>x.id===id);if(!i||i.status==='paid')return;i.status='paid';i.paidAt=today();mutate('invoices',i);i.itemIds.forEach(itemId=>{const item=data.items.find(x=>x.id===itemId);if(item){item.status='paid';item.paidAt=i.paidAt;queue('items',itemId);}});render();toast('Payment recorded');}

const remoteTable = { clients:'clients', groups:'deal_groups', projectGroups:'project_groups', items:'work_items', invoices:'invoices' };
function remoteRow(table, x) {
  const ws=data.settings.workspaceId;
  if(table==='clients')return {id:x.id,workspace_id:ws,name:x.name,billing:x.billing||{},sort_order:x.sortOrder||0};
  if(table==='groups')return {id:x.id,workspace_id:ws,client_id:x.clientId,label:x.label,agreed_amount:x.agreedAmount};
  if(table==='projectGroups')return {id:x.id,workspace_id:ws,client_id:x.clientId,label:x.label};
  if(table==='items')return {id:x.id,workspace_id:ws,client_id:x.clientId,group_id:x.groupId||null,project_group_id:x.projectGroupId||null,source_row:x.sourceRow||null,sort_order:x.sortOrder||0,serial:String(x.serial||''),work_date:validDate(x.workDate),due_date:validDate(x.dueDate),service:x.service||'',quantity:num(x.quantity),rate:num(x.rate),quoted_total:num(x.quotedTotal),advance_amount:num(x.advanceAmount),advance_received_at:validDate(x.advanceReceivedAt),paid_at:validDate(x.paidAt),status:x.status,revision_count:x.revisionCount||0,assignee_id:x.assigneeId==='local-me'?currentUserId():isUuid(x.assigneeId)?x.assigneeId:null,remarks:x.remarks||'',updated_at:x.updatedAt||new Date().toISOString()};
  if(table==='invoices')return {id:x.id,workspace_id:ws,client_id:x.clientId,number:x.number,issue_date:validDate(x.issueDate)||today(),paid_at:validDate(x.paidAt),item_ids:x.itemIds,lines:x.lines,subtotal:num(x.subtotal),discount:num(x.discount),final_amount:num(x.finalAmount),advance_amount:invoiceAdvance(x),status:x.status,seller:x.seller,buyer:x.buyer};
}
function localRow(table,x) {
  if(table==='clients')return {id:x.id,name:x.name,billing:x.billing||{},sortOrder:x.sort_order};
  if(table==='groups')return {id:x.id,clientId:x.client_id,label:x.label,agreedAmount:x.agreed_amount};
  if(table==='projectGroups')return {id:x.id,clientId:x.client_id,label:x.label};
  if(table==='items')return {id:x.id,clientId:x.client_id,groupId:x.group_id,projectGroupId:x.project_group_id,sourceRow:x.source_row,sortOrder:x.sort_order,serial:x.serial||String((x.sort_order||0)+1),workDate:x.work_date||'',dueDate:x.due_date||'',service:x.service,quantity:num(x.quantity),rate:num(x.rate),quotedTotal:num(x.quoted_total),advanceAmount:num(x.advance_amount),advanceReceivedAt:x.advance_received_at||null,paidAt:x.paid_at||null,status:x.status,revisionCount:x.revision_count,assigneeId:x.assignee_id||'',remarks:x.remarks||'',manualTotal:true,updatedAt:x.updated_at};
  if(table==='invoices')return {id:x.id,clientId:x.client_id,number:x.number,issueDate:x.issue_date,paidAt:x.paid_at||null,itemIds:x.item_ids||[],lines:x.lines||[],subtotal:num(x.subtotal),discount:num(x.discount),finalAmount:num(x.final_amount),advanceAmount:num(x.advance_amount),status:x.status,seller:x.seller||{},buyer:x.buyer||{}};
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
    for(const table of ['clients','groups','projectGroups','items','invoices']) {
      const queued=data.pending.filter(p=>p.table===table), records=queued.map(p=>data[table].find(x=>x.id===p.id)).filter(Boolean);
      for(let start=0;start<records.length;start+=100){const chunk=records.slice(start,start+100);const {error}=await clientApi.from(remoteTable[table]).upsert(chunk.map(x=>remoteRow(table,x)),{onConflict:'id'});if(error)throw error;const ids=new Set(chunk.map(x=>x.id));data.pending=data.pending.filter(p=>!(p.table===table&&ids.has(p.id)));save();}
    }
    successful=true;
  } finally { syncing=false; if(successful&&data.pending.length)scheduleSync(); }
}
async function fetchAll(table){let out=[];for(let start=0;;start+=1000){const {data:rows,error}=await clientApi.from(table).select('*').eq('workspace_id',data.settings.workspaceId).order('id').range(start,start+999);if(error)throw error;out.push(...rows);if(rows.length<1000)break;}return out;}
async function pullRemote(){if(!clientApi||!session||!data.settings.workspaceId)return;const ws=data.settings.workspaceId;const [w,m,...tables]=await Promise.all([clientApi.from('workspaces').select('*').eq('id',ws).single(),clientApi.from('members').select('*').eq('workspace_id',ws),...['clients','deal_groups','project_groups','work_items','invoices'].map(fetchAll)]);if(w.error)throw w.error;if(m.error)throw m.error;data.settings.joinCode=w.data.join_code;data.members=m.data.map(x=>({userId:x.user_id,displayName:x.display_name,avatarData:x.avatar_data||''}));['clients','groups','projectGroups','items','invoices'].forEach((table,k)=>{const pending=new Set(data.pending.filter(p=>p.table===table).map(p=>p.id));const locals=data[table].filter(x=>pending.has(x.id));data[table]=tables[k].map(x=>localRow(table,x));for(const local of locals){const ix=data[table].findIndex(x=>x.id===local.id);if(ix<0)data[table].push(local);else data[table][ix]=local;}});if(!activeClient&&data.clients.length)activeClient=data.clients[0].id;save();render();}
function subscribe(){if(!clientApi||!session||!data.settings.workspaceId)return;if(channel)clientApi.removeChannel(channel);let timer;channel=clientApi.channel('gir-ledger-'+data.settings.workspaceId);for(const table of ['clients','deal_groups','project_groups','work_items','invoices','members'])channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`workspace_id=eq.${data.settings.workspaceId}`},()=>{clearTimeout(timer);timer=setTimeout(()=>pullRemote().catch(e=>toast('Live refresh failed: '+e.message)),250);});channel.subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')toast('Live connection interrupted; use Sync now');});}
async function syncNow(){if(!clientApi||!session){toast('Sign in to Supabase first');return;}if(!data.settings.workspaceId){toast('Create or join a workspace first');return;}try{await flushPending();await pullRemote();subscribe();toast('Workspace synced');}catch(e){toast('Sync failed: '+e.message);}}

$('#newClientBtn').onclick=newClientDialog;
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
document.addEventListener('keydown',e=>{if(e.ctrlKey&&(e.key==='+'||e.key==='='||e.key==='-')){e.preventDefault();data.settings.zoom=Math.max(70,Math.min(150,data.settings.zoom+(e.key==='-'?-10:10)));save();render();}if(e.key==='Escape')closeModal();});
(async()=>{try{const saved=await window.desk.read();if(saved)data={...structuredClone(defaults),...saved,settings:{...structuredClone(defaults.settings),...(saved.settings||{}),seller:{...defaults.settings.seller,...(saved.settings?.seller||{})}}};if(!activeClient&&data.clients.length)activeClient=data.clients[0].id;render();setupSupabase();}catch(e){render();toast('Could not load local data: '+e.message);}})();
