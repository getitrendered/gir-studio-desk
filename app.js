/* MeowSheet: renderer state, sheet interaction, and Supabase sync. */
const $ = s => document.querySelector(s);
const uid = () => crypto.randomUUID();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const cleanSerial = v => { if (v == null || v === '') return ''; const s = String(v).trim(), n = Number(s); if (!isNaN(n) && Number.isInteger(n) && !s.includes('e') && !s.includes('E')) return String(n); return s.replace(/\.0+$/, ''); };
const fmtDate = d => { if (!d) return '—'; const x = new Date(d + 'T00:00:00'); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); };
const defaults = { clients:[], groups:[], projectGroups:[], items:[], invoices:[], receipts:[], members:[], chatMessages:[], tasks:[], deletedTaskIds:[], activityLog:[], pending:[], rentals:[], rentalItems:[], settings:{ seller:{ name:'GIR — Get It Rendered', address:'', email:'', phone:'', taxId:'', bankDetails:'', bankAccounts:[], activeBankAccountId:'', logoData:'' }, url:'https://isdxybpeagloikchhsbp.supabase.co', key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzZHh5YnBlYWdsb2lrY2hoc2JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NzkzMjcsImV4cCI6MjEwODE1NTMyN30.ll1YG9uyrTqmLzE90miCk-O1Ab5VkBPfqrCPDDUc5u8', workspaceId:'17f39873-e10f-4bdf-93ee-1f92b3e25251', displayName:'Samuel', localPartner:'Mezrid', avatarData:'', partnerAvatarData:'', catType:'orange', zoom:100, theme:'light' } };
const GIR_WORKSPACE_ID='17f39873-e10f-4bdf-93ee-1f92b3e25251';

function getEffectiveTheme(themeSetting) {
  const pref = themeSetting || data?.settings?.theme || 'light';
  if (pref === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }
  return pref;
}

function applyTheme(theme) {
  if (theme) {
    if (!data.settings) data.settings = {};
    data.settings.theme = theme;
  }
  const effective = getEffectiveTheme(data?.settings?.theme);
  const isDark = effective === 'dark';
  if (typeof document !== 'undefined') {
    if (document.documentElement && typeof document.documentElement.setAttribute === 'function') {
      document.documentElement.setAttribute('data-theme', effective);
    }
    if (document.body && document.body.classList && typeof document.body.classList.toggle === 'function') {
      document.body.classList.toggle('dark-theme', isDark);
    }
    const toggleBtn = $('#themeToggleBtn');
    if (toggleBtn) {
      toggleBtn.innerHTML = isDark
        ? '<span class="theme-icon">☀️</span>'
        : '<span class="theme-icon">🌙</span>';
      toggleBtn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
      if (typeof toggleBtn.setAttribute === 'function') {
        toggleBtn.setAttribute('aria-label', toggleBtn.title);
      }
    }
    const themeSelect = $('#settingsThemeSelect');
    if (themeSelect && themeSelect.value !== (data.settings.theme || 'light')) {
      themeSelect.value = data.settings.theme || 'light';
    }
  }
  if (typeof window !== 'undefined' && window.desk?.setTheme) {
    window.desk.setTheme(data?.settings?.theme || 'light').catch(() => {});
  }
  return effective;
}

function toggleTheme() {
  const current = getEffectiveTheme(data?.settings?.theme);
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  save();
  toast(next === 'dark' ? 'Dark mode enabled 🌙' : 'Light mode enabled ☀️');
}

if (typeof window !== 'undefined' && window.matchMedia) {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (data?.settings?.theme === 'system') {
        applyTheme('system');
      }
    });
  } catch {}
}
let data = structuredClone(defaults), tab = 'sheet', lastRenderedTab = null, lastRenderedClient = null, activeClient = null, selected = new Set(), selectionAnchor = null, selectionCell = null, collapsedGroups = new Set(), blankRows = 25, highlightUser = null, filter = 'all', clientApi = null, session = null, channel = null, syncing = false, toastTimer, syncTimer, lastSyncTime = Date.now(), importPreview = null, previewClientIndex = 0, migrating = false;
let goalFilter = 'active', goalSearchQuery = '';
const recentLocalPushes = new Map();
let isDeferredRemotePull = false;
let isRowDragSelecting = false, hasRowDragged = false, justDraggedSelection = false, dragStartRowId = null, dragTargetRowId = null, dragStartCellKey = null, dragStartShift = false, dragStartWithCtrl = false, dragInitialSelected = null;
let pendingChatAttachment = null, chatDraftText = '', activeStickerTab = 'stickers', stickerSearchQuery = '', lastPartnerOnlineTime = 0, unreadChatCount = 0, chatSyncTimer = null, noticeBoardSyncTimer = null;
let rentalViewMode = 'calendar', rentalFilter = 'all', rentalCalendarMonth = '', rentalSearchDate = '', rentalSearchQuery = '', rentalDraggedId = null;
let lastCellClick = { rowId: null, cellKey: null, blankOrder: null, time: 0 };
let authLoading=true,workspaceReady=false,workspaceResolving=false,accessMode='signin',accessError='',activeStatusMenu=null;
let desktopUpdate = { status: 'unavailable', message: 'Checking update support…' };
const navHistory = [];
let isNavigatingBack = false;
const openTrackerClients = new Set();
let trackerClientsInitialized = false;
let trackerClientFilter = 'active';
let trackerClientSearch = '';
let rowClipboard = { mode: null, items: [], sourceRowIds: [] };
let activityFilter = 'all';
let activitySearchQuery = '';
let activityDisplayLimit = 50;

function updateBulkActions() {
  refreshSelection();
}

function insertRowAt(targetRowId, position = 'above') {
  if (tab !== 'sheet' || !activeClient) return false;
  const all = clientItems(activeClient);
  const targetIdx = all.findIndex(i => i.id === targetRowId);
  if (targetIdx < 0) return false;
  const targetItem = all[targetIdx];

  const insertIndex = position === 'above' ? targetIdx : targetIdx + 1;
  const inserted = newItem(activeClient, insertIndex);

  if (targetItem.groupId) inserted.groupId = targetItem.groupId;
  if (targetItem.projectGroupId) inserted.projectGroupId = targetItem.projectGroupId;
  if (targetItem.workDate) inserted.workDate = targetItem.workDate;

  const dataTargetIdx = data.items.findIndex(i => i.id === targetRowId);
  if (dataTargetIdx >= 0) {
    const dataInsertIdx = position === 'above' ? dataTargetIdx : dataTargetIdx + 1;
    data.items.splice(dataInsertIdx, 0, inserted);
  } else {
    data.items.push(inserted);
  }

  const updatedAll = clientItems(activeClient);
  updatedAll.forEach((it, idx) => {
    it.sortOrder = idx;
    if (it.serial && !isNaN(Number(it.serial))) {
      it.serial = String(idx + 1);
    }
    enqueue('items', it.id);
  });
  inserted.serial = String(insertIndex + 1);
  enqueue('items', inserted.id);

  pushUndo(`Insert row ${position}`);
  const client = data.clients?.find(c => c.id === activeClient);
  if (typeof logActivity === 'function') {
    logActivity('add', `Inserted row ${position} "${targetItem.service || 'Row'}" in ${client?.name || 'client'}`, {
      item: JSON.parse(JSON.stringify(inserted)),
      clientId: activeClient,
      clientName: client?.name || ''
    });
  }

  selected.clear();
  selected.add(inserted.id);
  selectionCell = { id: inserted.id, key: 'service' };
  save();
  scheduleSync();
  render();

  setTimeout(() => {
    const row = document.querySelector(`[data-row="${inserted.id}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    const field = row?.querySelector('[data-cell="service"]');
    if (field) activateSheetField(field);
  }, 40);
  return true;
}

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
  }, 350);
}
function saveImmediate() {
  clearTimeout(saveTimer);
  if (window.desk?.write) {
    return window.desk.write(data).catch(e => toast('Could not save locally: ' + e.message));
  }
}
function enqueue(table,id) { const key=table+':'+id; if(!data.pending.some(p=>p.key===key))data.pending.push({key,table,id}); }
function scheduleSync(){if(!clientApi||!session||!data.settings.workspaceId)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>flushPending().catch(e=>toast('Sync waiting: '+e.message)),800);}
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
function selectionLabelHtml() {
  if (!selected.size) return '';
  const selectedItems = (data.items || []).filter(i => selected.has(i.id));
  const total = selectedItems.reduce((sum, i) => sum + num(i.quotedTotal), 0);
  return `
    <span class="sel-badge-active" title="Total amount of selected rows">
      <span class="sel-total-wrap">
        <span class="sel-total-label">TOTAL:</span>
        <strong class="sel-total-amount">${money(total)}</strong>
      </span>
    </span>
  `;
}
function avatar(id,name,size='',customSrc='') { const isMe=id===currentUserId()||id==='local-me'; const isPartner=id==='local-partner'||id==='partner'; const member=(data.members||[]).find(m=>m.userId===id)||(!isMe?(data.members||[]).find(m=>m.userId!==currentUserId()):null); let src=customSrc; if(!src){ if(isMe){ src=data.settings.avatarData||member?.avatarData||''; }else if(isPartner){ src=member?.avatarData||data.settings.partnerAvatarData||''; }else{ src=member?.avatarData||(id===currentUserId()?data.settings.avatarData:''); } } const isValidImg=src&&(/^data:image\/(?:png|jpeg|webp);base64,/i.test(src)||src.startsWith('http')||src.startsWith('assets/')); return isValidImg?`<img class="avatar-image ${size}" src="${esc(src)}" alt="${esc(name)}">`:`<span>${esc(initials(name))}</span>`; }
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
    if (item.groupId) return 0;
    return Math.max(0, effectiveItemValue(item) - num(item.advanceAmount));
  }
  if (r.referenceKind === 'item' || (r.source === 'app' && r.sourceKey && r.sourceKey.startsWith('app:'))) {
    const dealItems = (data.items || []).filter(i => i.groupId);
    if (dealItems.some(di => di.clientId === r.clientId && di.service && di.service.trim().toLowerCase() === (r.description || '').trim().toLowerCase())) {
      return 0;
    }
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
  const rentalsList = Array.isArray(data.rentals) ? data.rentals : [];
  let rRev = 0, rAwaiting = 0, rTotal = 0;
  for (const r of rentalsList) {
    if (r.status === 'cancelled') continue;
    const settled = Math.max(0, num(r.settledAmount != null ? r.settledAmount : r.rate));
    const adv = Math.min(settled, Math.max(0, num(r.advanceAmount)));
    rTotal += settled;
    if (r.paymentStatus === 'paid') {
      rRev += settled;
    } else if (r.paymentStatus === 'advance') {
      rRev += adv;
      rAwaiting += Math.max(0, settled - adv);
    } else {
      rAwaiting += settled;
    }
  }
  amount.rentals = { revenue: rRev, awaiting: rAwaiting, total: rTotal };
  return amount;
}
function counts() {
  const items = data.items || [];
  const todayValue = today();
  let total = 0, discarded = 0, done = 0, working = 0, pending = 0, overdue = 0;
  for (let idx = 0; idx < items.length; idx++) {
    const i = items[idx];
    if (i.status === 'discarded') {
      discarded++;
      continue;
    }
    total++;
    const s = i.status;
    if (s === 'sent' || s === 'paid') done++;
    else if (s === 'working' || s === 'changes') working++;
    else if (s === 'pending') pending++;
    if (i.dueDate && i.dueDate < todayValue && s !== 'sent' && s !== 'paid') overdue++;
  }
  return { total, discarded, done, working, pending, overdue };
}
function render() {
  closeStatusMenu();
  applyTheme();
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
  $('#app').classList.toggle('chat-mode', tab==='chat');
  const currentChatInput = document.getElementById('chatInputText');
  if (currentChatInput) {
    chatDraftText = currentChatInput.value;
  }
  const live = !!(clientApi && session && data.settings.workspaceId);
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderClients();
  main.innerHTML = ({ dashboard:renderDashboard, sheet:renderSheet, tracker:renderTracker, tasks:renderTasks, chat:renderChat, groups:renderGroups, goals:renderGoals, revenue:renderRevenue, rentals:renderRentals, payments:renderPayments, invoices:renderInvoices, 'client-details':renderClientDetails, activity:renderActivity, settings:renderSettings, 'import-preview':renderImportPreview }[tab] || renderSheet)();
  if(sameTab && main) main.scrollTop = preservedMainScroll;
  if(sameSheet && sheetScroll){const grid=main.querySelector('.sheet-viewport');if(grid){grid.scrollTop=sheetScroll.grid;grid.scrollLeft=sheetScroll.across;}}
  const indicator = $('#tabIndicator'), active = $(`#tabs button[data-tab="${tab}"]`);
  requestAnimationFrame(() => { indicator.style.opacity = active ? '1' : '0'; if (active) { indicator.style.left = active.offsetLeft + 'px'; indicator.style.width = active.offsetWidth + 'px'; } });
  if (lastRenderedTab && (lastRenderedTab !== tab || (tab === 'sheet' && lastRenderedClient !== activeClient))) {
    recordNav(lastRenderedTab, lastRenderedClient);
  }
  if (lastRenderedTab !== tab) { const order = ['sheet','dashboard','tracker','tasks','chat','groups','revenue','rentals','invoices','client-details','settings']; const direction = order.indexOf(tab) >= order.indexOf(lastRenderedTab) ? 'tab-next' : 'tab-prev'; $('#main').classList.remove('tab-next','tab-prev'); void $('#main').offsetWidth; $('#main').classList.add(direction); lastRenderedTab = tab; }
  if(tab==='settings')showUpdateState(desktopUpdate);
  if(tab==='chat'){ unreadChatCount = 0; updateChatUnreadBadge(); initChatInteractions(); }
  if(tab==='tasks'){ updateTasksDueBadge(); }
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

  const clientDue = (cid) => {
    return (f.outstandingItems || []).filter(o => o.clientId === cid).reduce((sum, o) => sum + num(o.balance), 0);
  };

  const closestClients = data.clients.map(cl => {
    const its = clientItems(cl.id).filter(i => i.status !== 'discarded');
    const done = its.filter(i => ['sent', 'paid'].includes(i.status)).length;
    const pending = unfinishedCount(cl.id);
    const due = clientDue(cl.id);
    return { cl, total: its.length, done, pending, due };
  }).filter(x => x.total > 0 && x.pending > 0).sort((a,b) => a.pending - b.pending || (b.done/b.total - a.done/a.total) || a.cl.name.localeCompare(b.cl.name)).slice(0, 6);

  const allGroups = [
    ...(data.projectGroups || []).map(g => ({ ...g, isProject: true, kind: 'project' })),
    ...(data.groups || []).map(g => ({ ...g, isProject: false, kind: 'deal' }))
  ];

  const sentGroups = [];
  const nearlyDoneGroups = [];

  for (const g of allGroups) {
    const cl = data.clients.find(c => c.id === g.clientId);
    if (!cl) continue;
    const items = (data.items || []).filter(i => (g.isProject ? i.projectGroupId : i.groupId) === g.id && i.status !== 'discarded');
    if (!items.length) continue;

    const gItemIds = new Set(items.map(i => i.id));
    const groupDue = (f.outstandingItems || []).filter(o => (o.itemIds || []).some(id => gItemIds.has(id))).reduce((sum, o) => sum + num(o.balance), 0);

    const sentCount = items.filter(i => i.status === 'sent').length;
    const paidCount = items.filter(i => i.status === 'paid').length;
    const pendingCount = items.filter(i => !['sent', 'paid'].includes(i.status)).length;

    if (pendingCount === 0 && sentCount > 0 && groupDue > 0) {
      sentGroups.push({
        group: g,
        client: cl,
        total: items.length,
        sentCount,
        due: groupDue
      });
    } else if (pendingCount > 0 && pendingCount <= 2 && items.length >= 2 && groupDue > 0) {
      nearlyDoneGroups.push({
        group: g,
        client: cl,
        total: items.length,
        doneCount: sentCount + paidCount,
        pendingCount,
        due: groupDue
      });
    }
  }

  sentGroups.sort((a,b) => b.due - a.due);
  nearlyDoneGroups.sort((a,b) => a.pendingCount - b.pendingCount || b.due - a.due);

  const totalClosestDue = closestClients.reduce((sum, x) => sum + x.due, 0);
  const totalSentGroupsDue = sentGroups.reduce((sum, x) => sum + x.due, 0);

  // Notice Board & Upcoming Meetings gist
  const allTasks = Array.isArray(data.tasks) ? data.tasks : [];
  const activeTasks = allTasks.filter(t => !t.completed);
  const overdueTasks = activeTasks.filter(t => getTaskCategory(t) === 'overdue').sort((a,b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
  const trendingTasks = activeTasks.filter(t => getTaskCategory(t) === 'active').sort((a,b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
  const upcomingTasks = activeTasks.filter(t => getTaskCategory(t) === 'upcoming').sort((a,b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
  const featuredTasks = [...overdueTasks, ...trendingTasks, ...upcomingTasks].slice(0, 4);

  const noticeBoardGistHtml = `
    <div class="panel highlight-panel-notice dashboard-notice-panel">
      <div class="panel-header-with-badge">
        <div class="panel-title-wrap">
          <span class="panel-icon">📌</span>
          <div>
            <h3>Notice Board &amp; Upcoming Meetings</h3>
            <p class="panel-sub">Scheduled team meetings, upcoming deadlines, and live countdown timers</p>
          </div>
        </div>
        <div class="dashboard-notice-header-actions">
          ${overdueTasks.length ? `<span class="badge-notice-overdue">🚨 ${overdueTasks.length} Overdue</span>` : ''}
          ${trendingTasks.length ? `<span class="badge-notice-focus">⚡ ${trendingTasks.length} In Focus</span>` : ''}
          <button type="button" class="small-btn" data-dashboard-add-task title="Pin a new meeting or reminder">+ Add Notice</button>
          <button type="button" class="small-btn blue" data-open-notice-board title="Open the full Notice Board">Open Notice Board (${activeTasks.length}) →</button>
        </div>
      </div>
      ${featuredTasks.length ? `
        <div class="dashboard-notice-grid">
          ${featuredTasks.map(t => {
            const cat = getTaskCategory(t);
            const isOverdue = cat === 'overdue';
            const isTrending = cat === 'active';
            const dtText = formatTaskDateTime(t.remindAt);
            const cdText = formatTaskCountdown(t.remindAt);
            return `
              <div class="dashboard-notice-card card-${cat}" data-task-id="${t.id}">
                <div class="dashboard-notice-card-header">
                  <div class="dashboard-notice-pills">
                    ${isOverdue ? `<span class="notice-pill pill-overdue">🚨 OVERDUE</span>` : ''}
                    ${isTrending ? `<span class="notice-pill pill-trending">⚡ IN FOCUS</span>` : ''}
                    ${!isOverdue && !isTrending ? `<span class="notice-pill pill-normal">📌 NOTICE</span>` : ''}
                    <span class="dashboard-notice-date">📅 ${esc(dtText)}</span>
                  </div>
                  <div class="task-countdown dashboard-timer timer-${cat}" data-remind-at="${t.remindAt}" data-category="${cat}">
                    ${cdText}
                  </div>
                </div>
                <div class="dashboard-notice-card-body">
                  <h4 class="dashboard-notice-title">${esc(t.title)}</h4>
                  ${t.description ? `<p class="dashboard-notice-desc">${esc(t.description)}</p>` : ''}
                </div>
                <div class="dashboard-notice-card-footer">
                  <div class="dashboard-notice-author">
                    ${t.createdBy ? `<span>👤 ${esc(t.createdBy)}</span>` : ''}
                  </div>
                  <div class="dashboard-notice-actions">
                    <button type="button" class="small-btn ${isOverdue ? 'danger' : 'green'} task-btn-complete" data-task-action="complete" data-task-id="${t.id}" title="Mark completed">✓ Complete</button>
                    <button type="button" class="small-btn" data-task-jump="${t.id}" title="View in Notice Board">View →</button>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        ${activeTasks.length > featuredTasks.length ? `
          <div class="dashboard-notice-more">
            <button type="button" class="dashboard-notice-more-btn" data-open-notice-board>
              <span>+ View ${activeTasks.length - featuredTasks.length} more notice${(activeTasks.length - featuredTasks.length) === 1 ? '' : 's'} on Notice Board</span>
              <span>→</span>
            </button>
          </div>
        ` : ''}
      ` : `
        <div class="dashboard-notice-empty">
          <div class="dashboard-notice-empty-content">
            <span class="empty-pin-icon">📌</span>
            <div class="empty-notice-text">
              <strong>Notice Board is all clear</strong>
              <p class="muted">No upcoming meetings or pending reminders scheduled right now.</p>
            </div>
          </div>
          <button type="button" class="small-btn blue" data-dashboard-add-task>+ Add Meeting / Reminder</button>
        </div>
      `}
    </div>
  `;

  const rf = typeof rentalFinancials === 'function' ? rentalFinancials() : { totalBookings: 0, received: 0, awaiting: 0, totalBooked: 0, upcomingSchedule: [] };
  const upcomingRentals = (data.rentals || []).filter(r => r.status !== 'cancelled' && (r.bookingDate >= today() || r.paymentStatus !== 'paid')).sort((a,b)=>(a.bookingDate||'').localeCompare(b.bookingDate||'')).slice(0, 4);

  const rentalsDashboardHtml = `
    <div class="panel highlight-panel highlight-panel-rentals">
      <div class="panel-header-with-badge">
        <div class="panel-title-wrap">
          <span class="panel-icon">📦</span>
          <div>
            <h3>Upcoming Equipment Rentals</h3>
            <p class="panel-sub">Blocked gear dates, hours, and incoming rental payments.</p>
          </div>
        </div>
        <div class="dashboard-header-actions">
          <span class="panel-counter-badge">${rf.totalBookings} booked</span>
          <button type="button" class="small-btn blue" data-jump-rentals>Manage Rentals ↗</button>
        </div>
      </div>
      ${upcomingRentals.length ? `
        <div class="dashboard-rentals-grid">
          ${upcomingRentals.map(r => {
            const isToday = r.bookingDate === today();
            return `
              <div class="dashboard-rental-card ${r.paymentStatus}" data-rental-id="${r.id}">
                <div class="dashboard-rental-top">
                  <span class="dashboard-rental-date ${isToday ? 'today' : ''}">📅 ${fmtDate(r.bookingDate)}${isToday ? ' (Today)' : ''}</span>
                  <span class="pill ${r.paymentStatus === 'paid' ? 'paid' : r.paymentStatus === 'advance' ? 'working' : 'pending'}">${r.paymentStatus === 'paid' ? 'Paid' : r.paymentStatus === 'advance' ? 'Advance' : 'Due'}</span>
                </div>
                <strong class="dashboard-rental-item">${esc(r.itemName)}</strong>
                <div class="dashboard-rental-sub muted font-11">
                  <span>👤 ${esc(r.clientName)}</span> · <span>⏱ ${r.hours ? r.hours + ' hrs' : 'Full day'}</span>
                </div>
                <div class="dashboard-rental-amount">
                  <span>Settled: <strong>${money(r.settledAmount != null ? r.settledAmount : r.rate)}</strong></span>
                  ${r.advanceAmount ? `<small class="muted font-11">(Adv: ${money(r.advanceAmount)})</small>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="dashboard-notice-empty">
          <div class="dashboard-notice-empty-content">
            <span class="empty-pin-icon">📦</span>
            <div class="empty-notice-text">
              <strong>No active rentals booked</strong>
              <p class="muted">Add rental gear and block booking dates in the Rentals tab.</p>
            </div>
          </div>
          <button type="button" class="small-btn blue" data-jump-rentals>+ Book Rental</button>
        </div>
      `}
    </div>
  `;

  return `<div class="section-top"><div><h2>Your studio at a glance</h2><p>Live progress across ${data.clients.length} clients.</p></div></div>
    <div class="cards"><div class="card blue"><div class="card-label">Completed work</div><div class="card-value">${completion}%</div><div class="card-foot">${c.done} of ${c.total} tasks sent or paid</div></div><div class="card"><div class="card-label">In progress</div><div class="card-value">${c.working}</div><div class="card-foot">${c.pending} waiting to start</div></div><div class="card amber"><div class="card-label">Work sent expected</div><div class="card-value">${money(f.awaiting)}</div><div class="card-foot">Sent or invoiced balances due</div></div><div class="card green"><div class="card-label">Revenue received</div><div class="card-value">${money(f.revenue)}</div><div class="card-foot">Paid work and open-work advances</div></div></div>

    ${noticeBoardGistHtml}

    ${rentalsDashboardHtml}

    <div class="dashboard-insights-container">
      <div class="panel highlight-panel">
        <div class="panel-header-with-badge">
          <div class="panel-title-wrap">
            <span class="panel-icon">🎯</span>
            <div>
              <h3>Clients Closest to Completion</h3>
              <p class="panel-sub">Finish the last few rows to collect payment immediately</p>
            </div>
          </div>
          ${totalClosestDue > 0 ? `<span class="badge-pipeline">💰 Total: ${money(totalClosestDue)}</span>` : ''}
        </div>
        <div class="insights-list">
          ${closestClients.length ? closestClients.map(x => `
            <div class="dashboard-insight-card closest-card">
              <div class="insight-statement-wrap">
                <p class="insight-statement-text">${
                  x.pending === 1
                    ? `<strong>${esc(x.cl.name)}:</strong> Only <strong>1 work</strong> is left (${x.done}/${x.total} complete) — total amount to receive is <span class="amount-highlight">${money(x.due)}</span>.`
                    : `<strong>${esc(x.cl.name)}:</strong> Only <strong>${x.pending} works</strong> left (${x.done}/${x.total} complete) — total amount to receive is <span class="amount-highlight">${money(x.due)}</span>.`
                }</p>
                <div class="insight-progress-mini"><span style="width:${Math.round(x.done/x.total*100)}%"></span></div>
              </div>
              <button type="button" class="small-btn blue" data-client-open="${x.cl.id}">Open sheet →</button>
            </div>
          `).join('') : '<p class="muted" style="padding:10px 0">All clients are 100% finished or no pending work!</p>'}
        </div>
      </div>

      <div class="panel highlight-panel-amber">
        <div class="panel-header-with-badge">
          <div class="panel-title-wrap">
            <span class="panel-icon">📬</span>
            <div>
              <h3>All-Sent Events & Quick Cash</h3>
              <p class="panel-sub">Work sent, waiting for confirmation or changes before payment</p>
            </div>
          </div>
          ${totalSentGroupsDue > 0 ? `<span class="badge-pipeline-amber">⏳ Total Awaiting: ${money(totalSentGroupsDue)}</span>` : ''}
        </div>
        <div class="insights-list">
          ${sentGroups.length ? sentGroups.map(x => `
            <div class="dashboard-insight-card sent-card">
              <div class="insight-statement-wrap">
                <p class="insight-statement-text"><strong>${esc(x.group.label)}</strong> (${esc(x.client.name)}): All ${x.total} works sent! Waiting for confirmation or changes — <span class="amount-highlight">${money(x.due)}</span> to receive.</p>
              </div>
              <button type="button" class="small-btn" data-client-open="${x.client.id}">View in sheet →</button>
            </div>
          `).join('') : (nearlyDoneGroups.length ? nearlyDoneGroups.map(x => `
            <div class="dashboard-insight-card amber-card">
              <div class="insight-statement-wrap">
                <p class="insight-statement-text"><strong>${esc(x.group.label)}</strong> (${esc(x.client.name)}): Only <strong>${x.pendingCount} work${x.pendingCount === 1 ? '' : 's'}</strong> left — <span class="amount-highlight">${money(x.due)}</span> to receive!</p>
                <div class="insight-progress-mini"><span style="width:${Math.round(x.doneCount/x.total*100)}%"></span></div>
              </div>
              <button type="button" class="small-btn blue" data-client-open="${x.client.id}">Finish work →</button>
            </div>
          `).join('') : '<p class="muted" style="padding:10px 0">No sent groups currently awaiting confirmation.</p>')}
        </div>
      </div>
    </div>

    <div class="grid-2"><div class="panel"><h3>Clients with most pending work</h3>${priority.length?priority.map(x=>`<div class="list-row"><div><strong>${esc(x.cl.name)}</strong><small>${x.items.length} unfinished rows</small></div><button class="small-btn" data-client-open="${x.cl.id}">Open sheet</button></div>`).join(''):'<p class="muted">No pending work right now.</p>'}</div>
    <div class="panel"><h3>Work overview by client</h3>${closestClients.length?closestClients.map(x=>`<div class="metric-row"><div style="width:100%"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong>${esc(x.cl.name)}</strong><span class="muted">${x.pending} left · ${x.done}/${x.total}</span></div><div class="bar"><span style="width:${Math.round(x.done/x.total*100)}%"></span></div></div></div>`).join(''):'<p class="muted">No unfinished client work right now.</p>'}</div></div>`;
}
function groupTotalValue(kind, group, items) {
  const active = (items || []).filter(i => i.status !== 'discarded');
  if (kind === 'deal') {
    if (group.agreedAmount != null && group.agreedAmount !== '') {
      const agreed = num(group.agreedAmount);
      const isAllPaid = active.length > 0 && active.every(i => i.status === 'paid');
      return { agreed: true, total: agreed, paid: isAllPaid ? agreed : 0 };
    }
    const total = active.reduce((s, i) => s + num(i.quotedTotal), 0);
    const paid = active.filter(i => i.status === 'paid').reduce((s, i) => s + num(i.quotedTotal), 0);
    return { agreed: false, total, paid };
  }
  let total = 0;
  let paid = 0;
  const dealsHandled = new Set();
  for (const it of active) {
    if (it.groupId) {
      if (!dealsHandled.has(it.groupId)) {
        dealsHandled.add(it.groupId);
        const d = (data.groups || []).find(g => g.id === it.groupId);
        const dItems = active.filter(x => x.groupId === it.groupId);
        if (d && d.agreedAmount != null && d.agreedAmount !== '') {
          const agreed = num(d.agreedAmount);
          total += agreed;
          if (dItems.length > 0 && dItems.every(x => x.status === 'paid')) paid += agreed;
        } else {
          total += dItems.reduce((s, x) => s + num(x.quotedTotal), 0);
          paid += dItems.filter(x => x.status === 'paid').reduce((s, x) => s + num(x.quotedTotal), 0);
        }
      }
    } else {
      total += num(it.quotedTotal);
      if (it.status === 'paid') paid += num(it.quotedTotal);
    }
  }
  return { agreed: false, total, paid };
}
function groupHeader(kind,group,items) {
  const done=items.filter(i=>['sent','paid'].includes(i.status)).length;
  const active=items.filter(i=>i.status!=='discarded');
  const folded=collapsedGroups.has(kind+':'+group.id);
  const gVal=groupTotalValue(kind,group,items);
  let detail='';
  if(gVal.agreed){
    detail=` · Agreed ${money(gVal.total)}`;
  } else if(gVal.total>0){
    if(gVal.paid>0 && gVal.paid<gVal.total){
      detail=` · Total ${money(gVal.total)} (${money(gVal.paid)} paid)`;
    } else {
      detail=` · Total ${money(gVal.total)}`;
    }
  }
  const status=groupStatus(items);
  const isPaid = active.length > 0 && status === 'Paid';
  const paidSeal = isPaid ? `<span class="group-paid-seal"><svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06 0z"/></svg> Paid in full</span>` : '';
  const actionButtons = isPaid ? `
    <button class="group-date-btn" data-group-paid-date="${kind}:${group.id}" title="Set or modify payment date for this group">Paid date</button>
  ` : `
    <button class="group-quick" data-group-status="${kind}:${group.id}:sent" ${!active.length?'disabled':''}>Mark sent</button>
    <button class="group-quick" data-group-status="${kind}:${group.id}:paid" ${!active.length?'disabled':''}>Mark paid</button>
    <button class="group-deal-btn" data-group-deal="${kind}:${group.id}" title="Make or edit group deal">Group deal</button>
    <button class="group-date-btn" data-group-paid-date="${kind}:${group.id}" title="Set or modify payment date for this group">Paid date</button>
  `;
  return `<tr class="sheet-group-header ${kind} ${isPaid ? 'is-paid-group-row' : ''}" data-sheet-group="${kind}:${group.id}"><td colspan="11"><div class="group-heading"><button data-group-collapse="${kind}:${group.id}" aria-expanded="${!folded}"><svg class="group-chevron ${folded?'collapsed':''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 5.75 4.5 4.5 4.5-4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><strong>${esc(group.label)}</strong><span>${done}/${active.length} complete${detail}</span></button><span class="group-status ${status.toLowerCase().replaceAll(' ','-')}">${status}</span>${paidSeal}${actionButtons}${kind==='project'?`<button class="group-add" data-group-add="${group.id}" title="Add work under this project">＋ Row</button>`:''}<button class="group-rename" data-group-rename="${kind}:${group.id}" title="Rename group">Rename</button><button class="group-ungroup" data-group-ungroup="${kind}:${group.id}" title="Ungroup (keep rows, remove group)">Ungroup</button></div></td></tr>`;
}
function groupStatus(items){const active=items.filter(i=>i.status!=='discarded');if(!active.length)return 'Discarded';if(active.every(i=>i.status==='paid'))return 'Paid';if(active.every(i=>['sent','paid'].includes(i.status)))return 'Sent';if(active.some(i=>['working','changes'].includes(i.status)))return 'Working';return 'Pending';}
function updateGroupHeaderDOM(item) {
  if (!item) return;
  const entries = [];
  if (item.projectGroupId) { const pg = (data.projectGroups || []).find(g => g.id === item.projectGroupId); if (pg) entries.push({ kind: 'project', group: pg }); }
  if (item.groupId) { const dg = (data.groups || []).find(g => g.id === item.groupId); if (dg) entries.push({ kind: 'deal', group: dg }); }
  for (const { kind, group } of entries) {
    const headerRow = document.querySelector(`[data-sheet-group="${kind}:${group.id}"]`);
    if (!headerRow) continue;
    const items = (data.items || []).filter(i => (kind === 'project' ? i.projectGroupId : i.groupId) === group.id);
    const active = items.filter(i => i.status !== 'discarded');
    const done = items.filter(i => ['sent', 'paid'].includes(i.status)).length;
    const gVal = groupTotalValue(kind, group, items);
    let detail = '';
    if (gVal.agreed) { detail = ` · Agreed ${money(gVal.total)}`; }
    else if (gVal.total > 0) { detail = gVal.paid > 0 && gVal.paid < gVal.total ? ` · Total ${money(gVal.total)} (${money(gVal.paid)} paid)` : ` · Total ${money(gVal.total)}`; }
    const span = headerRow.querySelector('[data-group-collapse] span');
    if (span) span.textContent = `${done}/${active.length} complete${detail}`;
  }
}
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
  return `<div class="sheet-shell"><div class="sheet-toolbar"><div class="actions"><button type="button" class="small-btn icon-btn" data-action="undo" title="Undo (Ctrl+Z)" ${undoStack.length?'':'disabled'} aria-label="Undo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg></button><button type="button" class="small-btn icon-btn" data-action="redo" title="Redo (Ctrl+Y)" ${redoStack.length?'':'disabled'} aria-label="Redo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg></button><button class="small-btn green" data-action="add-multiples" title="Add multiple rows from formatted WhatsApp/text">➕ Add Multiples</button><button class="small-btn purple" data-action="smart-update" title="Find words and bulk update rate or status across rows">⚡ Smart Update</button><button class="small-btn blue" data-action="assign" ${selected.size?'':'disabled'}>● Start work</button><button class="small-btn" data-action="complete" ${selected.size?'':'disabled'}>✓ Mark sent</button><button class="small-btn" data-action="invoice" ${selected.size?'':'disabled'}>▣ Create invoice</button><button class="small-btn" data-action="share-chat" ${selected.size?'':'disabled'} title="Share selected row(s) in Team Chat">💬 Share in chat</button><button class="small-btn danger" data-action="delete" title="Delete selected row(s) (Del)" ${selected.size?'':'disabled'}>🗑 Delete row</button><button type="button" class="small-btn" data-action="insert-above" title="Insert row above selected (Ctrl+Shift+Enter)" ${selected.size===1?'':'disabled'}>⬆ Row Above</button><button type="button" class="small-btn" data-action="insert-below" title="Insert row below selected (Ctrl+Alt+Enter)" ${selected.size===1?'':'disabled'}>⬇ Row Below</button><button class="small-btn" data-action="group" ${selected.size>1?'':'disabled'}>Group deal</button><button class="small-btn" data-action="project-group" ${selected.size?'':'disabled'}>Group project</button><select id="bulkStatus" aria-label="Set selected rows status" ${selected.size?'':'disabled'}><option value="">Set status…</option>${['pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}">${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}<option value="paid-date">Paid on date…</option></select><select id="workFilter" aria-label="Filter work">${['all','pending','working','changes','sent','paid','discarded'].map(s=>`<option value="${s}" ${filter===s?'selected':''}>${s==='all'?'All work':s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select><span class="hint" id="selectedCount">${selectionLabelHtml()}</span></div></div>
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

// -------------------------------------------------------------
// Tasks & Reminders Manager
// -------------------------------------------------------------

function getTaskCategory(task) {
  if (task.completed) return 'completed';
  const now = Date.now();
  const taskTime = new Date(task.remindAt).getTime();
  const diff = taskTime - now;

  if (diff <= 0) {
    // Past scheduled time -> OVERDUE (Red card, stays on top)
    return 'overdue';
  } else if (diff <= 30 * 60 * 1000) {
    // Within 30 minutes before task -> TRENDING / IN FOCUS (Green card)
    return 'active';
  } else {
    // More than 30 minutes away -> UPCOMING (Normal card)
    return 'upcoming';
  }
}

function formatTaskDateTime(remindAtStr) {
  if (!remindAtStr) return '—';
  const d = new Date(remindAtStr);
  if (isNaN(d.getTime())) return remindAtStr;

  const hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = (hours % 12) || 12;
  const timeStr = `${h12}:${mins} ${ampm}`;

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const dayAfter = new Date(now);
  dayAfter.setDate(now.getDate() + 2);
  const isDayAfter = d.toDateString() === dayAfter.toDateString();

  if (isToday) return `Today at ${timeStr}`;
  if (isTomorrow) return `Tomorrow at ${timeStr}`;
  if (isDayAfter) return `Day after tomorrow at ${timeStr}`;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} at ${timeStr}`;
}

function formatTaskCountdown(remindAtStr) {
  if (!remindAtStr) return '';
  const now = Date.now();
  const remindTime = new Date(remindAtStr).getTime();
  const diff = remindTime - now;

  if (diff <= 0) {
    // Overdue: Large prominent indicator
    const overdueMs = -diff;
    const totalSecs = Math.floor(overdueMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) return `⚠️ OVERDUE by ${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `⚠️ OVERDUE by ${mins}m ${secs}s`;
    return `⚠️ OVERDUE by ${secs}s`;
  } else if (diff <= 30 * 60 * 1000) {
    // Trending / Focus (< 30 minutes away)
    const totalSecs = Math.floor(diff / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `⚡ ${mins}m ${secs}s remaining`;
  } else {
    // Upcoming (> 30 minutes)
    const totalSecs = Math.floor(diff / 1000);
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (days > 0) return `⏳ in ${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `⏳ in ${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `⏳ in ${mins}m ${secs}s`;
    return `⏳ in ${secs}s`;
  }
}

function recordDeletedTaskIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  data.deletedTaskIds = Array.isArray(data.deletedTaskIds) ? data.deletedTaskIds : [];
  const set = new Set(data.deletedTaskIds);
  for (const id of ids) {
    if (id) set.add(id);
  }
  data.deletedTaskIds = Array.from(set).slice(-250);
}

function broadcastNoticeBoard(action, payload = {}) {
  if (typeof channel !== 'undefined' && channel) {
    try {
      channel.send({
        type: 'broadcast',
        event: 'notice_board_update',
        payload: {
          action,
          ...payload,
          senderId: currentUserId(),
          senderName: data.settings.displayName || session?.user?.user_metadata?.display_name || 'Teammate',
          timestamp: Date.now()
        }
      });
    } catch (e) {
      console.warn('Notice board broadcast warning:', e);
    }
  }
}

function scheduleNoticeBoardCloudSync() {
  data.tasksPendingSync = true;
  if (typeof clientApi === 'undefined' || !clientApi || !session || !data?.settings?.workspaceId) return;
  clearTimeout(noticeBoardSyncTimer);
  noticeBoardSyncTimer = setTimeout(async () => {
    try {
      data.settings.seller = data.settings.seller || {};
      data.settings.seller.notice_board = (data.tasks || []).slice(0, 300);
      data.settings.seller.deleted_task_ids = (data.deletedTaskIds || []).slice(-250);
      await clientApi.from('workspaces').update({ business: data.settings.seller }).eq('id', data.settings.workspaceId);
      data.tasksPendingSync = false;
    } catch (err) {
      console.warn('Notice board cloud sync warning:', err);
    }
  }, 600);
}

function handleIncomingNoticeBoardUpdate(payload) {
  if (!payload || !payload.action) return;
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const sender = payload.senderName || 'Teammate';
  let notifyTitle = '';
  let notifyBody = '';

  if (payload.action === 'upsert' && payload.task) {
    const remote = payload.task;
    if (data.deletedTaskIds && data.deletedTaskIds.includes(remote.id)) return;
    const idx = data.tasks.findIndex(t => t.id === remote.id);
    if (idx < 0) {
      data.tasks.push(remote);
      notifyTitle = `📌 ${sender} pinned a notice`;
      notifyBody = `"${remote.title}" scheduled for ${formatTaskDateTime(remote.remindAt)}`;
    } else {
      const local = data.tasks[idx];
      const remoteTime = new Date(remote.updatedAt || remote.createdAt || 0).getTime();
      const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
      if (remoteTime >= localTime) {
        const wasNotified = local.notified;
        const wasOverdue = local.overdueNotified;
        const lastTrending = local.lastTrendingNotifyAt;
        data.tasks[idx] = { ...remote };
        if (local.remindAt === remote.remindAt) {
          data.tasks[idx].notified = wasNotified;
          data.tasks[idx].overdueNotified = wasOverdue;
          data.tasks[idx].lastTrendingNotifyAt = lastTrending;
        }
        if (remote.completed && !local.completed) {
          notifyTitle = `✓ Notice completed by ${sender}`;
          notifyBody = `"${remote.title}" marked as complete! 🎉`;
        }
      }
    }
  } else if (payload.action === 'delete' && payload.taskId) {
    data.tasks = data.tasks.filter(t => t.id !== payload.taskId);
    recordDeletedTaskIds([payload.taskId]);
  } else if (payload.action === 'clear_completed' && Array.isArray(payload.taskIds)) {
    const idSet = new Set(payload.taskIds);
    data.tasks = data.tasks.filter(t => !idSet.has(t.id));
    recordDeletedTaskIds(payload.taskIds);
  }

  save();
  updateTasksDueBadge();
  if (tab === 'tasks') {
    render();
  }
  if (notifyTitle && notifyBody) {
    desktopNotify(notifyTitle, notifyBody, '📌');
  }
}

function mergeRemoteNoticeBoard(remoteTasks) {
  if (!Array.isArray(remoteTasks)) return;
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const deletedSet = new Set(data.deletedTaskIds || []);
  const taskMap = new Map();

  for (const t of data.tasks) {
    if (!deletedSet.has(t.id)) {
      taskMap.set(t.id, t);
    }
  }

  let hasLocalAdditions = false;
  for (const r of remoteTasks) {
    if (!r || !r.id || deletedSet.has(r.id)) continue;
    if (!taskMap.has(r.id)) {
      taskMap.set(r.id, r);
    } else {
      const l = taskMap.get(r.id);
      const rTime = new Date(r.updatedAt || r.createdAt || 0).getTime();
      const lTime = new Date(l.updatedAt || l.createdAt || 0).getTime();
      if (rTime > lTime) {
        const wasNotified = l.notified;
        const wasOverdue = l.overdueNotified;
        const lastTrending = l.lastTrendingNotifyAt;
        const merged = { ...r };
        if (l.remindAt === r.remindAt) {
          merged.notified = wasNotified;
          merged.overdueNotified = wasOverdue;
          merged.lastTrendingNotifyAt = lastTrending;
        }
        taskMap.set(r.id, merged);
      } else if (lTime > rTime) {
        hasLocalAdditions = true;
      }
    }
  }

  for (const [id] of taskMap) {
    if (!remoteTasks.some(r => r.id === id)) {
      hasLocalAdditions = true;
    }
  }

  data.tasks = Array.from(taskMap.values());
  if (hasLocalAdditions) {
    scheduleNoticeBoardCloudSync();
  }
}

function updateTasksDueBadge(count = null) {
  const badge = $('#tasksDueCount');
  if (!badge) return;
  if (count === null) {
    const now = Date.now();
    // Count overdue and trending (<30m) notices
    count = (data.tasks || []).filter(t => {
      if (t.completed) return false;
      const taskTime = new Date(t.remindAt).getTime();
      return (taskTime - now) <= 30 * 60 * 1000;
    }).length;
  }
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function checkTaskReminders() {
  if (!data.tasks || !Array.isArray(data.tasks) || !data.tasks.length) return;
  const now = Date.now();
  let changed = false;
  let dueCount = 0;

  for (const t of data.tasks) {
    if (t.completed) continue;
    const taskTime = new Date(t.remindAt).getTime();
    const diff = taskTime - now;

    if (diff <= 0) {
      // Past reminder time: OVERDUE
      dueCount++;
      if (!t.overdueNotified) {
        t.overdueNotified = true;
        t.notified = true;
        changed = true;
        const bodyText = t.description ? `${t.description} • Scheduled for ${formatTaskDateTime(t.remindAt)}` : `Scheduled for ${formatTaskDateTime(t.remindAt)}`;
        smartNotify({
          title: `🚨 OVERDUE: ${t.title}`,
          body: bodyText,
          icon: '🚨'
        });
      }
    } else if (diff <= 30 * 60 * 1000) {
      // Within 30 minutes before task / meeting: TRENDING & IN FOCUS
      dueCount++;
      const lastNotified = t.lastTrendingNotifyAt ? new Date(t.lastTrendingNotifyAt).getTime() : 0;
      // Send reminder notifications every ~10 minutes
      if (!lastNotified || (now - lastNotified >= 9.5 * 60 * 1000)) {
        t.lastTrendingNotifyAt = new Date(now).toISOString();
        t.notified = true;
        changed = true;
        const minsLeft = Math.max(1, Math.round(diff / 60000));
        const bodyText = t.description ? `${t.description} • Starts in ${minsLeft}m (${formatTaskDateTime(t.remindAt)})` : `Starts in ${minsLeft}m (${formatTaskDateTime(t.remindAt)})`;
        smartNotify({
          title: `⚡ In Focus (${minsLeft}m left): ${t.title}`,
          body: bodyText,
          icon: '⏰'
        });
      }
    }
  }

  updateTasksDueBadge(dueCount);

  if (changed) {
    save();
    if (tab === 'tasks') {
      render();
    }
  }
}

function updateLiveTaskCountdowns() {
  if (tab !== 'tasks' && tab !== 'dashboard') return;
  const elements = $$('.task-countdown[data-remind-at]');
  const now = Date.now();
  let needsRerender = false;

  elements.forEach(el => {
    const remindAtStr = el.dataset.remindAt;
    if (!remindAtStr) return;
    const remindTime = new Date(remindAtStr).getTime();
    const diff = remindTime - now;
    const prevCat = el.dataset.category;
    const currentCat = diff <= 0 ? 'overdue' : (diff <= 30 * 60 * 1000 ? 'active' : 'upcoming');
    if (prevCat && prevCat !== currentCat) {
      needsRerender = true;
    }
    el.textContent = formatTaskCountdown(remindAtStr);
  });

  if (needsRerender) {
    render();
  }
}

function renderTasks() {
  const allTasks = Array.isArray(data.tasks) ? data.tasks : [];
  const now = Date.now();

  const overdueTasks = [];
  const trendingTasks = [];
  const upcomingTasks = [];
  const completedTasks = [];

  allTasks.forEach(t => {
    if (t.completed) {
      completedTasks.push(t);
      return;
    }
    const cat = getTaskCategory(t);
    if (cat === 'overdue') overdueTasks.push(t);
    else if (cat === 'active') trendingTasks.push(t);
    else upcomingTasks.push(t);
  });

  // Strict sorting:
  // 1. Red (Overdue) stays ALWAYS ON TOP: sorted by oldest overdue first
  overdueTasks.sort((a,b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
  // 2. Green (Trending / Focus within 30m): sorted by closest deadline first
  trendingTasks.sort((a,b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
  // 3. Normal (Upcoming > 30m): sorted by closest deadline first
  upcomingTasks.sort((a,b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
  // 4. Completed: most recently completed first
  completedTasks.sort((a,b) => new Date(b.completedAt || b.remindAt).getTime() - new Date(a.completedAt || a.remindAt).getTime());

  // One long unified stack: Red on top, then Green, then Normal cards
  const activeNotices = [...overdueTasks, ...trendingTasks, ...upcomingTasks];

  const renderNoticeCard = (t, index) => {
    const cat = getTaskCategory(t);
    const isOverdue = cat === 'overdue';
    const isTrending = cat === 'active';
    const cardClass = isOverdue ? 'card-overdue' : (isTrending ? 'card-trending' : 'card-normal');
    const cdText = formatTaskCountdown(t.remindAt);
    const dtText = formatTaskDateTime(t.remindAt);

    // Dynamic pushpin colors: ruby pin for overdue/normal, emerald pin for trending
    const pinHeadFill = isTrending ? '#059669' : '#dc2626';
    const pinStroke = isTrending ? '#047857' : '#991b1b';

    return `
      <div class="notice-card ${cardClass}" data-task-id="${t.id}" data-category="${cat}">
        <!-- Authentic Notice Board Pushpin Visual -->
        <div class="notice-pin" aria-hidden="true" title="Pinned to Notice Board">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" class="pin-svg">
            <ellipse cx="12" cy="21" rx="4.5" ry="1.8" fill="rgba(0,0,0,0.28)"/>
            <path d="M12 13v7.5" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>
            <path d="M7 5.5c0-1.657 2.239-3 5-3s5 1.343 5 3c0 .828-.56 1.579-1.464 2.121L16 12.5H8l.464-4.879C7.56 7.079 7 6.328 7 5.5z" fill="${pinHeadFill}" stroke="${pinStroke}" stroke-width="1.2"/>
            <ellipse cx="10.5" cy="4.8" rx="2" ry="0.8" fill="rgba(255,255,255,0.7)"/>
          </svg>
        </div>

        <div class="notice-card-top">
          <div class="notice-meta-left">
            ${isOverdue ? `<span class="notice-pill pill-overdue">🚨 OVERDUE</span>` : ''}
            ${isTrending ? `<span class="notice-pill pill-trending">⚡ FOCUS #${index} • TRENDING</span>` : ''}
            ${!isOverdue && !isTrending ? `<span class="notice-pill pill-normal">📌 NOTICE #${index}</span>` : ''}
            <span class="notice-date-badge">📅 ${esc(dtText)}</span>
            ${t.createdBy ? `<span class="notice-author-badge" title="Pinned by ${esc(t.createdBy)}">👤 ${esc(t.createdBy)}</span>` : ''}
          </div>
          <!-- Prominent Bold Live Countdown Timer -->
          <div class="task-countdown notice-timer timer-${cat}" data-remind-at="${t.remindAt}" data-category="${cat}">
            ${cdText}
          </div>
        </div>

        <div class="notice-card-body">
          <h3 class="notice-title">${esc(t.title)}</h3>
          ${t.description ? `<p class="notice-desc">${esc(t.description)}</p>` : ''}
        </div>

        <div class="notice-card-footer">
          <div class="notice-footer-left">
            <button type="button" class="small-btn ${isOverdue ? 'danger' : 'green'} task-btn-complete" data-task-action="complete" data-task-id="${t.id}">
              ✓ Complete
            </button>
            <button type="button" class="small-btn task-btn-snooze" data-task-action="snooze" data-task-id="${t.id}" title="Snooze 15 minutes">
              ⏰ +15m Snooze
            </button>
          </div>
          <div class="notice-footer-right">
            <button type="button" class="small-btn task-btn-edit" data-task-action="edit" data-task-id="${t.id}" title="Edit reminder details">✏️ Edit</button>
            <button type="button" class="small-btn danger task-btn-delete" data-task-action="delete" data-task-id="${t.id}" title="Delete reminder">🗑️</button>
          </div>
        </div>
      </div>
    `;
  };

  const renderNoticeCompletedCard = t => {
    return `
      <div class="notice-card card-completed" data-task-id="${t.id}">
        <div class="notice-card-top">
          <div class="notice-meta-left">
            <span class="notice-pill pill-completed">✓ COMPLETED</span>
            <span class="notice-date-badge">${t.completedAt ? 'Finished ' + formatTaskDateTime(t.completedAt) : formatTaskDateTime(t.remindAt)}</span>
            ${t.completedBy ? `<span class="notice-author-badge" title="Finished by ${esc(t.completedBy)}">✓ ${esc(t.completedBy)}</span>` : (t.createdBy ? `<span class="notice-author-badge" title="Pinned by ${esc(t.createdBy)}">👤 ${esc(t.createdBy)}</span>` : '')}
          </div>
        </div>
        <div class="notice-card-body">
          <h3 class="notice-title is-completed">${esc(t.title)}</h3>
          ${t.description ? `<p class="notice-desc is-completed">${esc(t.description)}</p>` : ''}
        </div>
        <div class="notice-card-footer">
          <div class="notice-footer-left">
            <span class="completed-note">Originally scheduled for ${formatTaskDateTime(t.remindAt)}</span>
          </div>
          <div class="notice-footer-right">
            <button type="button" class="small-btn task-btn-restore" data-task-action="restore" data-task-id="${t.id}">↩ Restore</button>
            <button type="button" class="small-btn danger task-btn-delete" data-task-action="delete" data-task-id="${t.id}" title="Delete reminder">🗑️</button>
          </div>
        </div>
      </div>
    `;
  };

  return `
    <div class="tasks-shell notice-board-shell">
      <div class="tasks-header">
        <div class="tasks-title-block">
          <h2>📌 Notice Board & Reminders</h2>
          <p>Unified board of all active reminders • Red stays on top if overdue • Green is trending within 30m • Prominent live timers</p>
        </div>
        <div class="tasks-header-actions">
          <div class="tasks-stats-pills">
            ${overdueTasks.length ? `<span class="task-stat-badge overdue" title="Overdue reminders (past deadline)">🚨 ${overdueTasks.length} Overdue</span>` : ''}
            ${trendingTasks.length ? `<span class="task-stat-badge active" title="Trending / In Focus (< 30 minutes away)">⚡ ${trendingTasks.length} Trending</span>` : ''}
            <span class="task-stat-badge upcoming" title="Scheduled reminders (> 30 minutes away)">⏳ ${upcomingTasks.length} Scheduled</span>
            ${completedTasks.length ? `<span class="task-stat-badge completed" title="Finished reminders">✓ ${completedTasks.length} Done</span>` : ''}
          </div>
          <button type="button" class="primary tasks-add-btn" id="openAddTaskBtn">+ Add Reminder</button>
        </div>
      </div>

      <!-- Single Long List: All active reminders stacked in strict priority order -->
      ${activeNotices.length === 0 ? `
        <div class="empty notice-board-empty">
          <div class="empty-pin-icon">📌</div>
          <h3>Notice Board is Clear</h3>
          <p>No pending reminders or deadlines right now. Click <strong>+ Add Reminder</strong> on top to pin a new notice.</p>
        </div>
      ` : `
        <div class="notice-board-list">
          ${activeNotices.map((t, idx) => renderNoticeCard(t, idx + 1)).join('')}
        </div>
      `}

      <!-- Collapsible Completed Archive -->
      ${completedTasks.length ? `
        <details class="tasks-completed-accordion">
          <summary class="tasks-completed-summary">
            <span>✓ Completed Reminders (${completedTasks.length})</span>
            <button type="button" class="clear-completed-link" id="clearAllCompletedTasksBtn" title="Clear all finished reminders">Clear completed</button>
          </summary>
          <div class="notice-board-completed-list" style="margin-top:12px">
            ${completedTasks.map(t => renderNoticeCompletedCard(t)).join('')}
          </div>
        </details>
      ` : ''}
    </div>
  `;
}

function openTaskModal(editTaskId = null) {
  const existing = editTaskId ? (data.tasks || []).find(t => t.id === editTaskId) : null;

  let initialDate = '';
  let initialHour12 = 4;
  let initialMinute = 0;
  let initialPeriod = 'PM';

  const now = new Date();
  if (existing) {
    initialDate = existing.dueDate;
    if (existing.dueTime) {
      const [h24, m] = existing.dueTime.split(':').map(Number);
      initialHour12 = (h24 % 12) || 12;
      initialMinute = isNaN(m) ? 0 : m;
      initialPeriod = h24 >= 12 ? 'PM' : 'AM';
    }
  } else {
    const rounded = new Date(now.getTime() + 60 * 60 * 1000);
    rounded.setMinutes(0, 0, 0);
    initialDate = rounded.toISOString().slice(0, 10);
    const h24 = rounded.getHours();
    initialHour12 = (h24 % 12) || 12;
    initialMinute = 0;
    initialPeriod = h24 >= 12 ? 'PM' : 'AM';
  }

  let selectedDate = initialDate;
  let selectedHour12 = initialHour12;
  let selectedMinute = initialMinute;
  let selectedPeriod = initialPeriod;

  const modalTitle = existing ? 'Edit Notice Reminder' : 'Pin Reminder to Notice Board';

  const modalHtml = `
    <form id="taskProgramForm" onsubmit="return false;">
      <div class="field">
        <label for="taskTitleInput">Reminder Title *</label>
        <input type="text" id="taskTitleInput" value="${esc(existing?.title || '')}" placeholder="e.g. Meeting with Purple Tree, Send print proof, Follow up on payment" required autofocus>
      </div>

      <div class="field">
        <label for="taskDescInput">Description / Notes (Optional)</label>
        <textarea id="taskDescInput" rows="2" placeholder="Add relevant details, contact notes, or checklist...">${esc(existing?.description || '')}</textarea>
      </div>

      <div class="field">
        <label>Reminder Date</label>
        <div class="task-date-shortcuts" id="taskDateShortcuts">
          <button type="button" class="date-chip" data-offset="0">📅 Today</button>
          <button type="button" class="date-chip" data-offset="1">☀️ Tomorrow</button>
          <button type="button" class="date-chip" data-offset="2">🌅 Day After Tomorrow</button>
          <button type="button" class="date-chip" data-offset="3">🗓️ In 3 Days</button>
          <button type="button" class="date-chip" data-offset="7">📆 Next Week</button>
        </div>
        <input type="date" id="taskDateInput" value="${selectedDate}" style="margin-top:8px">
      </div>

      <div class="field">
        <label>Reminder Time (Artistic Dials & Clock)</label>
        <div class="artistic-time-picker">
          <!-- Left: SVG Analog Clock Face -->
          <div class="clock-display-wrap">
            <svg id="modalClockSvg" viewBox="0 0 150 150" class="analog-clock-face" title="Click clock face to adjust time">
              <circle cx="75" cy="75" r="70" class="clock-bezel"/>
              <circle cx="75" cy="75" r="66" class="clock-inner-dial"/>
              <!-- Hour tick marks -->
              ${Array.from({length: 12}).map((_, i) => {
                const rad = i * 30 * Math.PI / 180;
                const isMajor = i % 3 === 0;
                const innerR = isMajor ? 54 : 58;
                const outerR = 64;
                const x1 = 75 + innerR * Math.sin(rad);
                const y1 = 75 - innerR * Math.cos(rad);
                const x2 = 75 + outerR * Math.sin(rad);
                const y2 = 75 - outerR * Math.cos(rad);
                return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="clock-tick ${isMajor ? 'major' : ''}"/>`;
              }).join('')}
              <!-- Numerals for 12, 3, 6, 9 -->
              <text x="75" y="26" class="clock-num" text-anchor="middle">12</text>
              <text x="127" y="79" class="clock-num" text-anchor="middle">3</text>
              <text x="75" y="133" class="clock-num" text-anchor="middle">6</text>
              <text x="23" y="79" class="clock-num" text-anchor="middle">9</text>
              <!-- Hands -->
              <line id="modalClockHour" x1="75" y1="75" x2="75" y2="43" class="clock-hand-hour"/>
              <line id="modalClockMinute" x1="75" y1="75" x2="75" y2="25" class="clock-hand-minute"/>
              <circle cx="75" cy="75" r="5" class="clock-jewel-outer"/>
              <circle cx="75" cy="75" r="2.5" class="clock-jewel-inner"/>
            </svg>
            <div class="clock-hint">Click clock face or scroll dials</div>
          </div>

          <!-- Right: Interactive Scroll Dials -->
          <div class="dials-control-wrap">
            <div class="digital-time-display">
              <span id="digHours">04</span> : <span id="digMinutes">00</span> <span id="digPeriod">PM</span>
            </div>

            <div class="dials-row">
              <!-- Hours Dial -->
              <div class="dial-column" id="hoursDialCol">
                <button type="button" class="dial-arrow-btn" id="hourUpBtn" title="Hour +1">▲</button>
                <div class="dial-drum" id="hourDrum" title="Scroll wheel to adjust hour">
                  <span class="drum-num prev" id="hourPrev">03</span>
                  <span class="drum-num current" id="hourCurr">04</span>
                  <span class="drum-num next" id="hourNext">05</span>
                </div>
                <button type="button" class="dial-arrow-btn" id="hourDownBtn" title="Hour -1">▼</button>
                <span class="dial-label">HOURS</span>
              </div>

              <span class="dial-sep">:</span>

              <!-- Minutes Dial -->
              <div class="dial-column" id="minutesDialCol">
                <button type="button" class="dial-arrow-btn" id="minuteUpBtn" title="Minute +1">▲</button>
                <div class="dial-drum" id="minuteDrum" title="Scroll wheel to adjust minutes">
                  <span class="drum-num prev" id="minutePrev">59</span>
                  <span class="drum-num current" id="minuteCurr">00</span>
                  <span class="drum-num next" id="minuteNext">01</span>
                </div>
                <button type="button" class="dial-arrow-btn" id="minuteDownBtn" title="Minute -1">▼</button>
                <span class="dial-label">MINS</span>
              </div>

              <!-- Period Switch -->
              <div class="dial-column period-col">
                <div class="period-toggle-group">
                  <button type="button" class="period-btn" id="periodAmBtn">AM</button>
                  <button type="button" class="period-btn" id="periodPmBtn">PM</button>
                </div>
                <span class="dial-label">AM / PM</span>
              </div>
            </div>

            <!-- Quick Minute Snaps -->
            <div class="minute-snaps">
              <span class="snap-label">Snap:</span>
              <button type="button" class="snap-btn" data-snap="0">:00</button>
              <button type="button" class="snap-btn" data-snap="15">:15</button>
              <button type="button" class="snap-btn" data-snap="30">:30</button>
              <button type="button" class="snap-btn" data-snap="45">:45</button>
            </div>
          </div>
        </div>

        <div class="reminder-schedule-preview" id="schedulePreviewText">
          ⏰ Calculating schedule...
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="modal-actions">
      <button type="button" class="small-btn" id="cancelTaskModalBtn">Cancel</button>
      <button type="button" class="small-btn green" id="saveTaskModalBtn">${existing ? 'Update Reminder' : 'Pin to Notice Board'}</button>
    </div>
  `;

  modal(modalTitle, modalHtml, footerHtml, true);

  const hourHand = $('#modalClockHour');
  const minuteHand = $('#modalClockMinute');
  const clockSvg = $('#modalClockSvg');
  const dateInput = $('#taskDateInput');
  const previewText = $('#schedulePreviewText');

  const updateVisuals = () => {
    const h24 = (selectedHour12 % 12) + (selectedPeriod === 'PM' ? 12 : 0);
    const dueTime = `${String(h24).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}`;
    const dateStr = dateInput ? dateInput.value : selectedDate;

    const digH = $('#digHours');
    const digM = $('#digMinutes');
    const digP = $('#digPeriod');
    if (digH) digH.textContent = String(selectedHour12).padStart(2, '0');
    if (digM) digM.textContent = String(selectedMinute).padStart(2, '0');
    if (digP) digP.textContent = selectedPeriod;

    const prevH = selectedHour12 === 1 ? 12 : selectedHour12 - 1;
    const nextH = selectedHour12 === 12 ? 1 : selectedHour12 + 1;
    const hPrevEl = $('#hourPrev');
    const hCurrEl = $('#hourCurr');
    const hNextEl = $('#hourNext');
    if (hPrevEl) hPrevEl.textContent = String(prevH).padStart(2, '0');
    if (hCurrEl) hCurrEl.textContent = String(selectedHour12).padStart(2, '0');
    if (hNextEl) hNextEl.textContent = String(nextH).padStart(2, '0');

    const prevM = selectedMinute === 0 ? 59 : selectedMinute - 1;
    const nextM = selectedMinute === 59 ? 0 : selectedMinute + 1;
    const mPrevEl = $('#minutePrev');
    const mCurrEl = $('#minuteCurr');
    const mNextEl = $('#minuteNext');
    if (mPrevEl) mPrevEl.textContent = String(prevM).padStart(2, '0');
    if (mCurrEl) mCurrEl.textContent = String(selectedMinute).padStart(2, '0');
    if (mNextEl) mNextEl.textContent = String(nextM).padStart(2, '0');

    const amBtn = $('#periodAmBtn');
    const pmBtn = $('#periodPmBtn');
    if (amBtn) amBtn.classList.toggle('active', selectedPeriod === 'AM');
    if (pmBtn) pmBtn.classList.toggle('active', selectedPeriod === 'PM');

    const hourAngle = ((selectedHour12 % 12) + selectedMinute / 60) * 30;
    const minuteAngle = selectedMinute * 6;
    if (hourHand) hourHand.setAttribute('transform', `rotate(${hourAngle.toFixed(1)} 75 75)`);
    if (minuteHand) minuteHand.setAttribute('transform', `rotate(${minuteAngle.toFixed(1)} 75 75)`);

    if (dateStr && previewText) {
      const scheduledIso = `${dateStr}T${dueTime}:00`;
      const dtFormatted = formatTaskDateTime(scheduledIso);
      const cdFormatted = formatTaskCountdown(scheduledIso);
      previewText.innerHTML = `⏰ <strong>Reminder scheduled for:</strong> ${esc(dtFormatted)} <span class="preview-cd">(${esc(cdFormatted)})</span>`;
    }
  };

  const incHour = (delta = 1) => {
    selectedHour12 += delta;
    if (selectedHour12 > 12) selectedHour12 = 1;
    if (selectedHour12 < 1) selectedHour12 = 12;
    updateVisuals();
  };

  const incMinute = (delta = 1) => {
    selectedMinute = (selectedMinute + delta + 60) % 60;
    updateVisuals();
  };

  const hUp = $('#hourUpBtn'); if (hUp) hUp.onclick = () => incHour(1);
  const hDown = $('#hourDownBtn'); if (hDown) hDown.onclick = () => incHour(-1);
  const mUp = $('#minuteUpBtn'); if (mUp) mUp.onclick = () => incMinute(1);
  const mDown = $('#minuteDownBtn'); if (mDown) mDown.onclick = () => incMinute(-1);

  const hDrum = $('#hourDrum');
  if (hDrum) {
    hDrum.onwheel = e => {
      e.preventDefault();
      incHour(e.deltaY < 0 ? 1 : -1);
    };
  }

  const mDrum = $('#minuteDrum');
  if (mDrum) {
    mDrum.onwheel = e => {
      e.preventDefault();
      incMinute(e.deltaY < 0 ? 1 : -1);
    };
  }

  const amBtn = $('#periodAmBtn'); if (amBtn) amBtn.onclick = () => { selectedPeriod = 'AM'; updateVisuals(); };
  const pmBtn = $('#periodPmBtn'); if (pmBtn) pmBtn.onclick = () => { selectedPeriod = 'PM'; updateVisuals(); };

  $$('.snap-btn').forEach(b => {
    b.onclick = () => {
      selectedMinute = Number(b.dataset.snap);
      updateVisuals();
    };
  });

  $$('.date-chip').forEach(b => {
    b.onclick = () => {
      const offset = Number(b.dataset.offset || 0);
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + offset);
      if (dateInput) dateInput.value = targetDate.toISOString().slice(0, 10);
      $$('.date-chip').forEach(c => c.classList.remove('active'));
      b.classList.add('active');
      updateVisuals();
    };
  });

  if (dateInput) {
    dateInput.onchange = () => {
      $$('.date-chip').forEach(c => c.classList.remove('active'));
      updateVisuals();
    };
  }

  if (clockSvg) {
    clockSvg.onclick = e => {
      const rect = clockSvg.getBoundingClientRect();
      const x = e.clientX - rect.left - 75;
      const y = e.clientY - rect.top - 75;
      const dist = Math.sqrt(x * x + y * y);
      if (dist > 70) return;

      let rad = Math.atan2(y, x) + Math.PI / 2;
      if (rad < 0) rad += 2 * Math.PI;
      const fraction = rad / (2 * Math.PI);

      if (dist < 46) {
        let h = Math.round(fraction * 12);
        if (h === 0) h = 12;
        selectedHour12 = h;
      } else {
        let m = Math.round(fraction * 60) % 60;
        selectedMinute = m;
      }
      updateVisuals();
    };
  }

  const cancelBtn = $('#cancelTaskModalBtn'); if (cancelBtn) cancelBtn.onclick = closeModal;

  const saveBtn = $('#saveTaskModalBtn');
  if (saveBtn) {
    saveBtn.onclick = () => {
      const titleInp = $('#taskTitleInput');
      const title = titleInp ? titleInp.value.trim() : '';
      if (!title) {
        if (titleInp) titleInp.focus();
        toast('Please enter a reminder title');
        return;
      }
      const descInp = $('#taskDescInput');
      const description = descInp ? descInp.value.trim() : '';
      const dueDate = dateInput ? dateInput.value : selectedDate;
      if (!dueDate) {
        toast('Please select a reminder date');
        return;
      }
      const h24 = (selectedHour12 % 12) + (selectedPeriod === 'PM' ? 12 : 0);
      const dueTime = `${String(h24).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}`;
      const remindAt = new Date(`${dueDate}T${dueTime}:00`).toISOString();

      data.tasks = Array.isArray(data.tasks) ? data.tasks : [];

      const authorName = data.settings.displayName || session?.user?.user_metadata?.display_name || 'Team member';
      if (existing) {
        existing.title = title;
        existing.description = description;
        existing.dueDate = dueDate;
        existing.dueTime = dueTime;
        existing.remindAt = remindAt;
        existing.updatedAt = new Date().toISOString();
        existing.updatedBy = authorName;
        existing.updatedById = currentUserId();
        if (new Date(remindAt).getTime() > Date.now()) {
          existing.notified = false;
          existing.overdueNotified = false;
          existing.lastTrendingNotifyAt = null;
        }
        broadcastNoticeBoard('upsert', { task: existing });
        scheduleNoticeBoardCloudSync();
        toast(`⏰ Reminder updated for ${formatTaskDateTime(remindAt)}!`);
      } else {
        const newTask = {
          id: 'task_' + uid(),
          title,
          description,
          dueDate,
          dueTime,
          remindAt,
          createdAt: new Date().toISOString(),
          createdBy: authorName,
          createdById: currentUserId(),
          updatedAt: new Date().toISOString(),
          updatedBy: authorName,
          updatedById: currentUserId(),
          completed: false,
          completedAt: null,
          completedBy: null,
          notified: false,
          overdueNotified: false,
          lastTrendingNotifyAt: null,
          snoozedUntil: null
        };
        data.tasks.push(newTask);
        broadcastNoticeBoard('upsert', { task: newTask });
        scheduleNoticeBoardCloudSync();
        toast(`⏰ Reminder programmed for ${formatTaskDateTime(remindAt)}!`);
      }

      save();
      closeModal();
      render();
    };
  }

  updateVisuals();
}
function renderGroups() {
  const groups=[...data.projectGroups.map(g=>({...g,kind:'project'})),...data.groups.map(g=>({...g,kind:'deal'}))];
  const cards=groups.map(g=>{
    const rows=data.items.filter(i=>(g.kind==='project'?i.projectGroupId:i.groupId)===g.id);
    const active=rows.filter(i=>i.status!=='discarded');
    const done=active.filter(i=>['sent','paid'].includes(i.status)).length;
    const gVal=groupTotalValue(g.kind,g,rows);
    let amount='';
    if(gVal.agreed){
      amount=`<span>Agreed ${money(gVal.total)}</span>`;
    } else if(gVal.total>0){
      if(gVal.paid>0 && gVal.paid<gVal.total){
        amount=`<span>Total ${money(gVal.total)} (${money(gVal.paid)} paid)</span>`;
      } else {
        amount=`<span>Total ${money(gVal.total)}</span>`;
      }
    }
    const status=groupStatus(rows);
    const isPaid = active.length > 0 && status === 'Paid';
    const paidSeal = isPaid ? `<span class="group-paid-seal"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06 0z"/></svg> Paid in full</span>` : '';
    const actions = isPaid ? `
      <div class="group-card-actions"><button class="group-quick" data-group-paid-date="${g.kind}:${g.id}">Paid date</button></div>
    ` : `
      <div class="group-card-actions"><button class="group-quick" data-group-status="${g.kind}:${g.id}:sent">Mark sent</button><button class="group-quick" data-group-status="${g.kind}:${g.id}:paid">Mark paid</button><button class="group-quick" data-group-deal-card="${g.kind}:${g.id}">Group deal</button><button class="group-quick" data-group-paid-date="${g.kind}:${g.id}">Paid date</button></div>
    `;
    return `<div class="group-card ${isPaid ? 'is-paid-group' : ''}"><button class="group-card-open" data-open-group="${g.kind}:${g.id}"><div class="group-card-top-row"><span class="group-badge">${g.kind==='project'?'PROJECT GROUP':'DEAL GROUP'}</span>${paidSeal}</div><strong>${esc(g.label)}</strong><small>${esc(data.clients.find(c=>c.id===g.clientId)?.name)} · ${done}/${active.length} complete · ${active.length-done} left · ${status}</small>${amount}<div class="bar"><span style="width:${active.length?done/active.length*100:0}%"></span></div></button>${actions}<div class="group-card-top-actions"><button class="group-card-rename" data-rename-card="${g.kind}:${g.id}" title="Rename group">Rename</button><button class="group-card-ungroup" data-ungroup-card="${g.kind}:${g.id}" title="Ungroup group">Ungroup</button></div><div class="group-card-editor" hidden><label>Group name<input value="${esc(g.label)}" aria-label="Group name"></label><div><button type="button" data-save-card="${g.kind}:${g.id}">Save</button><button type="button" data-cancel-card>Cancel</button></div></div></div>`;
  }).join('');
  return `<div class="section-top"><div><h2>Groups</h2><p>Project folders and negotiated deals across clients.</p></div></div>${groups.length?`<div class="group-grid">${cards}</div>`:'<div class="empty"><h3>No groups yet</h3><p>Select rows on a worksheet to create a project group or grouped deal.</p></div>'}`;
}
function renderGoals() {
  const allGroups = [
    ...data.projectGroups.map(g => ({ ...g, kind: 'project' })),
    ...data.groups.map(g => ({ ...g, kind: 'deal' }))
  ];

  let totalPendingTasks = 0;
  let totalCompletedTasks = 0;
  let totalTasks = 0;

  const groupStats = allGroups.map(g => {
    const rows = (data.items || []).filter(i => (g.kind === 'project' ? i.projectGroupId : i.groupId) === g.id);
    const active = rows.filter(i => i.status !== 'discarded');
    const pending = active.filter(i => i.status === 'pending').length;
    const working = active.filter(i => ['working', 'changes'].includes(i.status)).length;
    const sent = active.filter(i => i.status === 'sent').length;
    const paid = active.filter(i => i.status === 'paid').length;
    const completed = sent + paid;
    const remaining = active.length - completed;
    const percent = active.length ? Math.round((completed / active.length) * 100) : 0;
    const gVal = groupTotalValue(g.kind, g, rows);
    const isPaidInFull = active.length > 0 && active.every(i => i.status === 'paid');
    const isAllSentOrPaid = active.length > 0 && active.every(i => ['sent', 'paid'].includes(i.status));

    totalPendingTasks += remaining;
    totalCompletedTasks += completed;
    totalTasks += active.length;

    const client = (data.clients || []).find(c => c.id === g.clientId);

    return {
      group: g,
      client,
      rows,
      active,
      pending,
      working,
      sent,
      paid,
      completed,
      remaining,
      percent,
      gVal,
      isPaidInFull,
      isAllSentOrPaid
    };
  });

  const overallRate = totalTasks ? Math.round((totalCompletedTasks / totalTasks) * 100) : 0;
  const activeGroupsCount = groupStats.filter(s => s.remaining > 0).length;

  let filtered = groupStats;
  if (goalFilter === 'active') {
    filtered = filtered.filter(s => s.remaining > 0);
  } else if (goalFilter === 'completed') {
    filtered = filtered.filter(s => s.remaining === 0 && s.active.length > 0);
  }

  if (goalSearchQuery) {
    const q = goalSearchQuery.toLowerCase();
    filtered = filtered.filter(s => 
      (s.group.label || '').toLowerCase().includes(q) ||
      (s.client?.name || '').toLowerCase().includes(q)
    );
  }

  const circumference = 2 * Math.PI * 44; // ~276.46

  const cardsHtml = filtered.map(s => {
    const g = s.group;
    const clientName = s.client?.name || 'Client';
    const offset = circumference - (s.percent / 100) * circumference;
    const isDone = s.remaining === 0;

    let valueText = '';
    if (s.gVal.agreed) {
      valueText = `Agreed ${money(s.gVal.total)}`;
    } else if (s.gVal.total > 0) {
      if (s.gVal.paid > 0 && s.gVal.paid < s.gVal.total) {
        valueText = `Total ${money(s.gVal.total)} (${money(s.gVal.paid)} paid)`;
      } else {
        valueText = `Total ${money(s.gVal.total)}`;
      }
    }

    return `
      <div class="goal-card ${isDone ? 'is-completed' : ''} ${s.isPaidInFull ? 'is-paid' : ''}" data-goal-id="${g.kind}:${g.id}">
        <div class="goal-card-header">
          <div class="goal-card-title-wrap">
            <div class="goal-tag-row">
              <span class="goal-kind-badge">${g.kind === 'project' ? 'PROJECT' : 'DEAL'}</span>
              <span class="goal-client-pill">${esc(clientName)}</span>
              ${s.isPaidInFull ? `<span class="group-paid-seal"><svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06 0z"/></svg> Paid</span>` : ''}
            </div>
            <h3 class="goal-title">${esc(g.label)}</h3>
          </div>
          <span class="goal-pct-badge ${s.percent === 100 ? 'done' : ''}">${s.percent}% done</span>
        </div>

        <div class="goal-progress-section">
          <div class="goal-ring-wrap" title="${s.percent}% complete · ${s.remaining} tasks remaining">
            <svg class="goal-ring-svg" viewBox="0 0 104 104">
              <circle class="goal-ring-track" cx="52" cy="52" r="44"/>
              <circle class="goal-ring-bar ${s.percent === 100 ? 'done' : ''}" cx="52" cy="52" r="44" style="stroke-dasharray:${circumference};stroke-dashoffset:${offset};"/>
            </svg>
            <div class="goal-ring-content">
              <span class="goal-ring-num">${s.remaining}</span>
              <span class="goal-ring-text">${s.remaining === 1 ? 'task left' : 'tasks left'}</span>
            </div>
          </div>
          <div class="goal-meta-col">
            <div class="goal-stat-chips">
              <span class="goal-chip pending" title="Pending work">⏳ ${s.pending} pending</span>
              <span class="goal-chip working" title="In progress">🔨 ${s.working} working</span>
              <span class="goal-chip sent" title="Sent to client">🚀 ${s.sent} sent</span>
              <span class="goal-chip paid" title="Paid">💰 ${s.paid} paid</span>
            </div>
            ${valueText ? `<div class="goal-value-badge"><span class="goal-value-label">Financials:</span> <span class="goal-value-num">${valueText}</span></div>` : ''}
            <div class="goal-quick-info">
              ${s.remaining > 0 ? `<span class="goal-active-msg">🎯 Today's Goal: Reduce this to 0</span>` : `<span class="goal-done-msg">✓ All work completed!</span>`}
            </div>
          </div>
        </div>

        <div class="goal-actions">
          <button type="button" class="small-btn blue goal-view-pending-btn" data-goal-pending="${g.kind}:${g.id}" title="Jump directly to pending tasks in worksheet">⚡ View Pending (${s.remaining})</button>
          <button type="button" class="small-btn goal-view-sheet-btn" data-goal-sheet="${g.kind}:${g.id}" title="View entire group in worksheet">View in Sheet →</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="goals-page">
      <div class="section-top">
        <div>
          <h2>Goals & Targets</h2>
          <p>Track unfinished tasks across groups and hit your daily completion targets.</p>
        </div>
      </div>

      <div class="goals-hero">
        <div class="goal-hero-card target">
          <div class="goal-hero-icon">🎯</div>
          <div class="goal-hero-info">
            <span class="goal-hero-label">Remaining Work Target</span>
            <span class="goal-hero-val">${totalPendingTasks}</span>
            <span class="goal-hero-sub">tasks left to finish across all groups</span>
          </div>
        </div>
        <div class="goal-hero-card completed">
          <div class="goal-hero-icon">✓</div>
          <div class="goal-hero-info">
            <span class="goal-hero-label">Completed Tasks</span>
            <span class="goal-hero-val">${totalCompletedTasks}</span>
            <span class="goal-hero-sub">marked sent or paid</span>
          </div>
        </div>
        <div class="goal-hero-card active-groups">
          <div class="goal-hero-icon">📁</div>
          <div class="goal-hero-info">
            <span class="goal-hero-label">Active Groups</span>
            <span class="goal-hero-val">${activeGroupsCount}</span>
            <span class="goal-hero-sub">with work in progress</span>
          </div>
        </div>
        <div class="goal-hero-card rate">
          <div class="goal-hero-icon">📈</div>
          <div class="goal-hero-info">
            <span class="goal-hero-label">Overall Completion</span>
            <span class="goal-hero-val">${overallRate}%</span>
            <span class="goal-hero-sub">${totalCompletedTasks} of ${totalTasks} total tasks</span>
          </div>
        </div>
      </div>

      <div class="goals-filter-bar">
        <div class="goal-search-box">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="5"/><path d="m11 11 3.5 3.5"/></svg>
          <input type="text" id="goalSearchInput" placeholder="Search goals or clients…" value="${esc(goalSearchQuery)}">
        </div>
        <div class="goal-filter-pills">
          <button type="button" class="goal-pill ${goalFilter === 'active' ? 'active' : ''}" data-goal-filter="active">Active Targets (${groupStats.filter(s => s.remaining > 0).length})</button>
          <button type="button" class="goal-pill ${goalFilter === 'all' ? 'active' : ''}" data-goal-filter="all">All Groups (${groupStats.length})</button>
          <button type="button" class="goal-pill ${goalFilter === 'completed' ? 'active' : ''}" data-goal-filter="completed">Completed (${groupStats.filter(s => s.remaining === 0 && s.active.length > 0).length})</button>
        </div>
      </div>

      ${filtered.length ? `<div class="goals-grid">${cardsHtml}</div>` : `<div class="empty"><h3>No goals match this filter</h3><p>Try switching to "All Groups" or clearing your search term.</p></div>`}
    </div>
  `;
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
  const rf = typeof rentalFinancials === 'function' ? rentalFinancials() : { totalBookings: 0, received: 0, awaiting: 0, totalBooked: 0, upcomingSchedule: [], paidCount: 0, advanceCount: 0, pendingCount: 0 };
  const totalCombinedReceived = f.revenue + rf.received;
  return `<div class="section-top"><div><h2>Revenue</h2><p>Money received is recorded by payment date and client. Estimated incoming is unpaid active work.</p></div></div>
    <div class="cards"><div class="card green"><div class="card-label">Received</div><div class="card-value">${money(f.revenue)}</div><div class="card-foot">Recorded cash receipts</div></div><div class="card blue"><div class="card-label">Paid work value</div><div class="card-value">${money(f.closed)}</div><div class="card-foot">Value marked paid on worksheets</div></div><div class="card amber"><div class="card-label">Open-work advances</div><div class="card-value">${money(f.openAdvances)}</div><div class="card-foot">Already received; included in historical receipts where recorded</div></div><div class="card"><div class="card-label">Discarded project value</div><div class="card-value">${money(f.discarded)}</div><div class="card-foot">Excluded from income estimates</div></div></div>
    <div class="cards"><div class="card amber"><div class="card-label">Work sent expected</div><div class="card-value">${money(f.awaiting)}</div><div class="card-foot">Sent or invoiced balances still due</div></div><div class="card blue"><div class="card-label">Estimated incoming</div><div class="card-value">${money(f.estimated)}</div><div class="card-foot">All unpaid active work, including sent</div></div><div class="card green"><div class="card-label">Rentals cash received</div><div class="card-value">${money(rf.received)}</div><div class="card-foot">${rf.paidCount} paid · ${rf.advanceCount} advance</div></div><div class="card blue"><div class="card-label">Combined studio revenue</div><div class="card-value">${money(totalCombinedReceived)}</div><div class="card-foot">Services + rentals combined</div></div></div>
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
                  <thead><tr><th>DATE</th><th>CLIENT</th><th>PAYMENT / SERVICE</th><th style="text-align:right">AMOUNT</th><th style="text-align:right">ACTIONS</th></tr></thead>
                  <tbody>
                    ${m.receipts.map(r=>`<tr><td>${r.receivedOn?fmtDate(r.receivedOn):'<span class="muted">Day unconfirmed</span>'}</td><td><strong>${esc(r.effectiveClientName||r.clientName)}</strong></td><td>${esc(r.effectiveDescription||r.description||(r.source==='historical_workbook'?'Historical payment':'Payment'))}</td><td style="text-align:right"><strong>${money(r.effectiveAmount!=null?r.effectiveAmount:r.amount)}</strong></td><td style="text-align:right"><div class="revenue-row-actions"><button class="small-btn" data-receipt-date="${r.id}" title="Modify date of payment">📅 Date</button>${r.clientId?`<button class="small-btn" data-receipt-jump="${r.id}" title="Go to worksheet of this group">↗ View</button>`:''}${(r.referenceKind==='deal'||r.referenceKind==='project')?`<button class="small-btn" data-receipt-ungroup="${r.id}" title="Go to worksheet and ungroup this group">Ungroup</button>`:''}<button class="small-btn danger" data-receipt-delete="${r.id}" title="Delete this payment receipt">🗑 Delete</button></div></td></tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </details>
          `).join('')}
        </div>
      `:'<p class="muted">No payment receipts recorded.</p>'}
    </div>
    <div class="panel">
      <div class="panel-header-with-badge">
        <div class="panel-title-wrap">
          <span class="panel-icon">📦</span>
          <div>
            <h3>Upcoming Rental Cashflow Schedule</h3>
            <p class="muted">Forecast of exactly when rental money will come in based on booking dates and payment milestones.</p>
          </div>
        </div>
        <button type="button" class="small-btn blue" data-jump-rentals>Manage Rentals ↗</button>
      </div>
      ${rf.upcomingSchedule.length ? `
        <table class="table-list">
          <thead>
            <tr>
              <th>EXPECTED INFLOW DATE</th>
              <th>CLIENT / EVENT</th>
              <th>RENTED EQUIPMENT</th>
              <th>DURATION</th>
              <th style="text-align:right">SETTLED AMOUNT</th>
              <th style="text-align:right">ADVANCE PAID</th>
              <th style="text-align:right">EXPECTED INFLOW</th>
              <th>PAYMENT STATUS</th>
              <th style="text-align:right">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            ${rf.upcomingSchedule.map(s => `
              <tr>
                <td><strong>${fmtDate(s.expectedPaymentDate || s.bookingDate)}</strong></td>
                <td><strong>${esc(s.clientName)}</strong></td>
                <td>${esc(s.itemName)}</td>
                <td>${s.hours ? s.hours + ' hrs' : 'Full day'}</td>
                <td style="text-align:right">${money(s.settledAmount)}</td>
                <td style="text-align:right">${s.advanceAmount ? money(s.advanceAmount) : '—'}</td>
                <td style="text-align:right"><strong style="color:var(--blue, #168451)">${money(s.balanceDue)}</strong></td>
                <td><span class="pill ${s.paymentStatus === 'paid' ? 'paid' : s.paymentStatus === 'advance' ? 'working' : 'pending'}">${s.paymentStatus === 'paid' ? 'Paid' : s.paymentStatus === 'advance' ? 'Advance Paid' : 'Pending'}</span></td>
                <td style="text-align:right">
                  <div style="display:inline-flex;gap:4px;">
                    ${s.paymentStatus !== 'paid' ? `<button type="button" class="small-btn blue" data-rental-mark-paid="${s.id}" title="Mark Paid">✓ Mark Paid</button>` : ''}
                    <button type="button" class="small-btn" data-rental-edit="${s.id}" title="Edit Booking">Edit</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : `
        <p class="muted">No upcoming rental payments pending. Schedule rentals in the <button class="small-btn" data-jump-rentals style="display:inline;padding:2px 8px;">Rentals</button> tab.</p>
      `}
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

// ==========================================
// RENTALS MANAGEMENT ENGINE (v0.2.80)
// ==========================================

function ensureDefaultRentalItems() {
  if (!Array.isArray(data.rentalItems) || !data.rentalItems.length) {
    data.rentalItems = [
      { id: 'item-light-600d', name: 'Aputure 600d Pro Light Kit', category: 'Lighting', rate: 4500, rateType: 'day', description: 'Daylight LED with fresnel, softbox & C-stand' },
      { id: 'item-sound-jbl', name: 'JBL EON One Pro Sound System & Mics', category: 'Sound', rate: 6000, rateType: 'day', description: 'Line array PA system with 2 wireless handheld mics' },
      { id: 'item-proj-4k', name: '4K Laser Projector (5000 Lumens) + 120" Screen', category: 'Video', rate: 5500, rateType: 'day', description: 'High brightness projector with motorized folding screen' },
      { id: 'item-par-led', name: 'LED Par Cans (Set of 8) with DMX', category: 'Lighting', rate: 3500, rateType: 'day', description: 'RGBW wash lights with DMX controller & cables' },
      { id: 'item-cstands', name: 'Heavy Duty C-Stands & Booms (Pair)', category: 'Grip', rate: 1200, rateType: 'day', description: 'Stainless steel 40" C-stands with grip heads and arms' },
      { id: 'item-fog-haze', name: 'Fog & Haze Machine with Fluid', category: 'Effects', rate: 2000, rateType: 'day', description: 'Dual fog/hazer with wireless remote and quick dispersion' },
      { id: 'item-mic-lav', name: 'Wireless Lavalier Mic Kit (Sennheiser)', category: 'Audio', rate: 2500, rateType: 'day', description: 'Dual transmitter and receiver kit with clip mics' }
    ];
  }
  if (!Array.isArray(data.rentals)) {
    data.rentals = [];
  }
}

function rentalFinancials() {
  const rentals = Array.isArray(data.rentals) ? data.rentals : [];
  let totalBooked = 0, received = 0, awaiting = 0, paidCount = 0, pendingCount = 0, advanceCount = 0;
  const byMonth = new Map();
  const upcomingSchedule = [];

  for (const r of rentals) {
    if (r.status === 'cancelled') continue;
    const settled = Math.max(0, num(r.settledAmount != null ? r.settledAmount : r.rate));
    const adv = Math.min(settled, Math.max(0, num(r.advanceAmount)));
    totalBooked += settled;

    let balanceDue = 0;
    if (r.paymentStatus === 'paid') {
      received += settled;
      paidCount++;
    } else if (r.paymentStatus === 'advance') {
      received += adv;
      balanceDue = Math.max(0, settled - adv);
      awaiting += balanceDue;
      advanceCount++;
    } else {
      balanceDue = settled;
      awaiting += balanceDue;
      pendingCount++;
    }

    const payDate = r.expectedPaymentDate || r.bookingDate || '';
    if (payDate) {
      const mKey = payDate.slice(0, 7);
      const mObj = byMonth.get(mKey) || { total: 0, received: 0, awaiting: 0, count: 0 };
      mObj.total += settled;
      mObj.received += (r.paymentStatus === 'paid' ? settled : adv);
      mObj.awaiting += balanceDue;
      mObj.count++;
      byMonth.set(mKey, mObj);
    }

    upcomingSchedule.push({
      id: r.id,
      itemId: r.itemId,
      itemName: r.itemName || 'Equipment',
      clientName: r.clientName || 'Client',
      bookingDate: r.bookingDate || '',
      expectedPaymentDate: payDate,
      hours: r.hours || 0,
      settledAmount: settled,
      advanceAmount: adv,
      balanceDue: balanceDue,
      paymentStatus: r.paymentStatus || 'pending',
      status: r.status || 'booked',
      notes: r.notes || ''
    });
  }

  upcomingSchedule.sort((a, b) => {
    const da = a.expectedPaymentDate || a.bookingDate || '9999';
    const db = b.expectedPaymentDate || b.bookingDate || '9999';
    return da.localeCompare(db);
  });

  return {
    totalBookings: rentals.filter(r => r.status !== 'cancelled').length,
    totalBooked,
    received,
    awaiting,
    paidCount,
    pendingCount,
    advanceCount,
    byMonth,
    upcomingSchedule
  };
}

function parseRentalDateInput(str) {
  if (!str) return today();
  const s = String(str).trim().toLowerCase();
  const t = new Date();
  if (s === 'today') return today();
  if (s === 'tomorrow') {
    const tom = new Date(t.getTime() + 86400000);
    return `${tom.getFullYear()}-${String(tom.getMonth()+1).padStart(2,'0')}-${String(tom.getDate()).padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  let match = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const mStr = match[2];
    const yr = match[3] ? parseInt(match[3], 10) : t.getFullYear();
    let mIdx = months.findIndex(m => mStr.startsWith(m));
    if (mIdx !== -1) {
      return `${yr}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  match = s.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
  if (match) {
    const mStr = match[1];
    const day = parseInt(match[2], 10);
    const yr = match[3] ? parseInt(match[3], 10) : t.getFullYear();
    let mIdx = months.findIndex(m => mStr.startsWith(m));
    if (mIdx !== -1) {
      return `${yr}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
  }
  return str;
}

function checkDateAvailability(targetDate) {
  ensureDefaultRentalItems();
  const normalized = parseRentalDateInput(targetDate);
  const rentals = Array.isArray(data.rentals) ? data.rentals : [];
  const catalog = Array.isArray(data.rentalItems) ? data.rentalItems : [];
  
  const blockedRentals = rentals.filter(r => {
    if (r.status === 'cancelled') return false;
    const start = r.bookingDate;
    const end = r.endDate || r.bookingDate;
    return normalized >= start && normalized <= end;
  });

  const blockedItemIds = new Set(blockedRentals.map(r => r.itemId).filter(Boolean));
  const blockedItemNames = new Set(blockedRentals.map(r => (r.itemName || '').trim().toLowerCase()));

  const availableItems = catalog.filter(it => !blockedItemIds.has(it.id) && !blockedItemNames.has((it.name || '').trim().toLowerCase()));

  return {
    date: normalized,
    isBlocked: blockedRentals.length > 0,
    blockedRentals,
    blockedItemIds,
    availableItems,
    totalCatalogCount: catalog.length
  };
}

function checkItemBookingConflict(itemId, itemName, targetDate, excludeBookingId = null) {
  if (!targetDate) return null;
  const rentals = Array.isArray(data.rentals) ? data.rentals : [];
  const normDate = parseRentalDateInput(targetDate);
  const lowerName = (itemName || '').trim().toLowerCase();

  for (const r of rentals) {
    if (excludeBookingId && r.id === excludeBookingId) continue;
    if (r.status === 'cancelled') continue;
    const start = r.bookingDate;
    const end = r.endDate || r.bookingDate;
    if (normDate >= start && normDate <= end) {
      const matchId = itemId && r.itemId && r.itemId === itemId;
      const matchName = lowerName && (r.itemName || '').trim().toLowerCase() === lowerName;
      if (matchId || matchName) {
        return {
          conflictRental: r,
          message: `⚠️ Warning: "${r.itemName}" is already booked on ${fmtDate(normDate)} by "${r.clientName}" (${r.hours ? r.hours + ' hrs' : 'full day'})!`
        };
      }
    }
  }
  return null;
}

function syncRentalsToSeller() {
  data.settings = data.settings || {};
  data.settings.seller = data.settings.seller || {};
  data.settings.seller.rentals = data.rentals || [];
  data.settings.seller.rental_items = data.rentalItems || [];
}

function saveRentalBooking(bookingData) {
  ensureDefaultRentalItems();
  data.rentals = data.rentals || [];
  const now = new Date().toISOString();
  if (bookingData.id) {
    const idx = data.rentals.findIndex(r => r.id === bookingData.id);
    if (idx !== -1) {
      data.rentals[idx] = { ...data.rentals[idx], ...bookingData, updatedAt: now };
    } else {
      data.rentals.push({ ...bookingData, id: bookingData.id || uid(), createdAt: now, updatedAt: now });
    }
  } else {
    data.rentals.push({ ...bookingData, id: uid(), createdAt: now, updatedAt: now });
  }
  syncRentalsToSeller();
  save();
  render();
}

function deleteRentalBooking(id, skipConfirm = false) {
  if (!id) return;
  const item = (data.rentals || []).find(r => r.id === id);
  if (!item) return;
  if (!skipConfirm && typeof window !== 'undefined' && window.confirm && !confirm(`Delete rental booking for "${item.itemName || 'Equipment'}" (${item.clientName || 'Client'})?`)) {
    return;
  }
  data.rentals = (data.rentals || []).filter(r => r.id !== id);
  syncRentalsToSeller();
  save();
  closeModal();
  render();
  toast(`Rental booking deleted 🗑️`);
}

function markRentalPaid(id) {
  const r = (data.rentals || []).find(x => x.id === id);
  if (!r) return;
  r.paymentStatus = 'paid';
  r.updatedAt = new Date().toISOString();
  syncRentalsToSeller();
  save();
  render();
  toast(`Rental payment marked as Paid! ✓ 💵`);
}

function rescheduleRental(rentalId, newDateStr) {
  if (!rentalId || !newDateStr) return;
  const r = (data.rentals || []).find(x => x.id === rentalId);
  if (!r) return;
  r.bookingDate = newDateStr;
  r.expectedPaymentDate = newDateStr;
  r.updatedAt = new Date().toISOString();
  syncRentalsToSeller();
  save();
  render();
  toast(`Rescheduled ${r.itemName} to ${fmtDate(newDateStr)} 📅`);
}

function saveRentalItem(itemData) {
  ensureDefaultRentalItems();
  data.rentalItems = data.rentalItems || [];
  const now = new Date().toISOString();
  if (itemData.id) {
    const idx = data.rentalItems.findIndex(i => i.id === itemData.id);
    if (idx !== -1) {
      data.rentalItems[idx] = { ...data.rentalItems[idx], ...itemData, updatedAt: now };
    } else {
      data.rentalItems.push({ ...itemData, id: itemData.id || uid(), createdAt: now, updatedAt: now });
    }
  } else {
    data.rentalItems.push({ ...itemData, id: uid(), createdAt: now, updatedAt: now });
  }
  syncRentalsToSeller();
  save();
}

function deleteRentalItem(id, fromModal = false) {
  ensureDefaultRentalItems();
  const item = (data.rentalItems || []).find(i => i.id === id);
  if (!item) return;
  if (typeof window !== 'undefined' && window.confirm && !confirm(`Delete "${item.name}" from equipment catalog?`)) {
    return;
  }
  data.rentalItems = (data.rentalItems || []).filter(i => i.id !== id);
  syncRentalsToSeller();
  save();
  render();
  if (fromModal || (typeof document !== 'undefined' && document.querySelector('.rental-catalog-manager'))) {
    openRentalCatalogModal();
  }
  toast(`Removed "${item.name}" from catalog 🗑️`);
}

function fmtDayName(dStr) {
  if (!dStr) return '';
  try {
    const d = new Date(dStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { weekday: 'short' });
  } catch (e) {
    return '';
  }
}

function fmtDayAndMonth(dStr) {
  if (!dStr) return '—';
  try {
    const d = new Date(dStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch (e) {
    return dStr;
  }
}

function getBookingsOnDate(targetDate, excludeBookingId = null) {
  if (!targetDate) return [];
  const rentals = Array.isArray(data.rentals) ? data.rentals : [];
  const normDate = parseRentalDateInput(targetDate);
  return rentals.filter(r => {
    if (excludeBookingId && r.id === excludeBookingId) return false;
    if (r.status === 'cancelled') return false;
    const start = r.bookingDate;
    const end = r.endDate || r.bookingDate;
    return normDate >= start && normDate <= end;
  });
}

function renderRentals() {
  ensureDefaultRentalItems();
  return `
    <div class="rentals-wrap">
      ${rentalViewMode === 'schedule' ? renderRentalsScheduleView() : renderRentalsCalendarView()}
    </div>
  `;
}

function renderRentalsCalendarView() {
  if (!rentalCalendarMonth) {
    rentalCalendarMonth = today().slice(0, 7);
  }
  const [yearStr, monthStr] = rentalCalendarMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const currentMonthDate = new Date(year, month, 1);
  const monthTitle = currentMonthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const firstDayIndex = currentMonthDate.getDay();
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const prevMonthStr = month === 0 ? `${year - 1}-12` : `${year}-${String(month).padStart(2, '0')}`;
  const nextMonthStr = month === 11 ? `${year + 1}-01` : `${year}-${String(month + 2).padStart(2, '0')}`;

  const rentals = data.rentals || [];
  const activeRentals = rentals.filter(r => r.status !== 'cancelled');

  // Month bookings count for the green badge
  const monthPrefix = rentalCalendarMonth;
  const monthRentals = activeRentals.filter(r => (r.bookingDate || '').startsWith(monthPrefix));
  const monthBookingsCount = monthRentals.length;
  const monthTotalRents = monthRentals.reduce((sum, r) => sum + num(r.settledAmount != null ? r.settledAmount : r.rate), 0);

  const rf = typeof rentalFinancials === 'function' ? rentalFinancials() : { totalBookings: 0, received: 0, awaiting: 0, totalBooked: 0 };
  const catalog = data.rentalItems || [];

  let daysGridHtml = '';
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dNum = daysInPrevMonth - i;
    const dStr = `${prevMonthStr}-${String(dNum).padStart(2, '0')}`;
    daysGridHtml += renderCalendarCell(dStr, dNum, true, activeRentals);
  }

  for (let d = 1; d <= daysInCurrentMonth; d++) {
    const dStr = `${rentalCalendarMonth}-${String(d).padStart(2, '0')}`;
    daysGridHtml += renderCalendarCell(dStr, d, false, activeRentals);
  }

  const totalCellsSoFar = firstDayIndex + daysInCurrentMonth;
  const trailingCount = (7 - (totalCellsSoFar % 7)) % 7;
  for (let t = 1; t <= trailingCount; t++) {
    const dStr = `${nextMonthStr}-${String(t).padStart(2, '0')}`;
    daysGridHtml += renderCalendarCell(dStr, t, true, activeRentals);
  }

  return `
    <div class="rental-cal-wrap">
      <div class="rental-cal-top-bar">
        <div class="rental-cal-nav-left">
          <button type="button" class="small-btn" id="rentalCalPrevBtn" data-month="${prevMonthStr}" title="Previous Month">◀</button>
          <button type="button" class="small-btn" id="rentalCalTodayBtn">Today</button>
          <button type="button" class="small-btn" id="rentalCalNextBtn" data-month="${nextMonthStr}" title="Next Month">▶</button>
          <h3 class="rental-cal-title">
            ${monthTitle}
            ${monthBookingsCount > 0 ? `<span class="rental-month-badge" title="${monthBookingsCount} booking${monthBookingsCount === 1 ? '' : 's'} in ${monthTitle}">${monthBookingsCount}</span>` : ''}
          </h3>
        </div>

        <div class="rental-cal-stats-strip">
          <span class="rental-stat-pill green" title="Total amount of all booked rentals">
            <span class="stat-lbl">Total Rents:</span>
            <strong>${money(rf.totalBooked)}</strong>
          </span>
          <span class="rental-stat-pill blue" title="Total active booked rentals">
            <span class="stat-lbl">Bookings:</span>
            <strong>${rf.totalBookings}</strong>
          </span>
          ${monthBookingsCount > 0 ? `
            <span class="rental-stat-pill emerald" title="Bookings in ${monthTitle}">
              <span class="stat-lbl">${monthTitle.split(' ')[0]}:</span>
              <strong>${money(monthTotalRents)}</strong>
            </span>
          ` : ''}
        </div>

        <div class="rental-cal-actions-right">
          <button type="button" class="small-btn" id="rentalOpenCatalogBtn" title="View & manage equipment items">📦 Items (${catalog.length})</button>
          <button type="button" class="small-btn" id="rentalToggleScheduleBtn" title="View all bookings in chronological order">📋 All Bookings</button>
          <button type="button" class="small-btn green" id="rentalNewBookingBtn" style="font-weight:700;">＋ Rent an Item</button>
        </div>
      </div>

      <div class="rental-cal-days-header">
        <div class="rental-cal-day-col">Sun</div>
        <div class="rental-cal-day-col">Mon</div>
        <div class="rental-cal-day-col">Tue</div>
        <div class="rental-cal-day-col">Wed</div>
        <div class="rental-cal-day-col">Thu</div>
        <div class="rental-cal-day-col">Fri</div>
        <div class="rental-cal-day-col">Sat</div>
      </div>

      <div class="rental-cal-grid">
        ${daysGridHtml}
      </div>
    </div>
  `;
}

function renderCalendarCell(dateStr, dayNum, isOtherMonth, activeRentals) {
  const isToday = dateStr === today();
  const dayRentals = activeRentals.filter(r => {
    const start = r.bookingDate;
    const end = r.endDate || r.bookingDate;
    return dateStr >= start && dateStr <= end;
  });

  const dayTotal = dayRentals.reduce((sum, r) => sum + num(r.settledAmount != null ? r.settledAmount : r.rate), 0);

  return `
    <div class="rental-cal-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-cal-date="${dateStr}">
      <div class="rental-cal-cell-header">
        <span class="rental-cal-day-num">${dayNum}</span>
        ${dayRentals.length > 0 ? `
          <span class="rental-cal-day-badge ${dayRentals.length > 1 ? 'multi' : ''}" title="${dayRentals.length} bookings on ${fmtDate(dateStr)}, total ${money(dayTotal)}">
            ${dayRentals.length === 1 ? '1 Booked' : `${dayRentals.length} Bookings`}
          </span>
        ` : ''}
        <button type="button" class="rental-cal-add-btn" data-cal-add="${dateStr}" title="Add booking on ${fmtDate(dateStr)}">＋</button>
      </div>
      <div class="rental-cal-cards">
        ${dayRentals.map(r => `
          <div class="rental-cal-card ${r.paymentStatus}" draggable="true" data-rental-id="${r.id}" title="${esc(r.itemName)} · ${esc(r.clientName)} (${r.hours ? r.hours + ' hrs' : 'Full day'}) · ${money(r.settledAmount != null ? r.settledAmount : r.rate)} · Click for details, drag to reschedule">
            <div class="rental-card-top">
              <span class="rental-card-item-name">${esc(r.itemName)}</span>
              <span class="pill ${r.paymentStatus === 'paid' ? 'paid' : r.paymentStatus === 'advance' ? 'working' : 'pending'}" style="font-size:9px;padding:1px 4px;">${r.paymentStatus === 'paid' ? 'Paid' : r.paymentStatus === 'advance' ? 'Adv' : 'Due'}</span>
            </div>
            <div class="rental-card-client">${esc(r.clientName)}</div>
            <div class="rental-card-bottom">
              <span class="rental-card-hours">${r.hours ? r.hours + 'h' : 'Day'}</span>
              <span class="rental-card-amount">${money(r.settledAmount != null ? r.settledAmount : r.rate)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderRentalsScheduleView() {
  const rentals = data.rentals || [];
  const activeRentals = rentals.filter(r => r.status !== 'cancelled');
  const todayStr = today();

  let filtered = [...activeRentals];
  if (rentalFilter === 'upcoming') {
    filtered = filtered.filter(r => (r.bookingDate || '') >= todayStr);
  } else if (rentalFilter === 'past') {
    filtered = filtered.filter(r => (r.bookingDate || '') < todayStr);
  } else if (rentalFilter === 'paid') {
    filtered = filtered.filter(r => r.paymentStatus === 'paid');
  } else if (rentalFilter === 'pending') {
    filtered = filtered.filter(r => r.paymentStatus !== 'paid');
  }

  // Ordered chronologically from nearest upcoming to later dates
  filtered.sort((a, b) => (a.bookingDate || '').localeCompare(b.bookingDate || ''));

  const rf = typeof rentalFinancials === 'function' ? rentalFinancials() : { totalBookings: 0, received: 0, awaiting: 0, totalBooked: 0 };
  const catalog = data.rentalItems || [];

  return `
    <div class="rental-schedule-wrap">
      <div class="rental-schedule-top-bar">
        <div class="rental-schedule-left">
          <button type="button" class="small-btn blue" id="rentalBackToCalBtn">◀ Back to Calendar</button>
          <div>
            <h3 style="margin:0;">Rental Bookings Schedule</h3>
            <span class="muted font-11">Ordered chronologically from sooner to later dates</span>
          </div>
        </div>

        <div class="rental-schedule-filters">
          <button type="button" class="small-btn ${rentalFilter === 'all' ? 'active-filter' : ''}" data-rental-filter="all">All (${activeRentals.length})</button>
          <button type="button" class="small-btn ${rentalFilter === 'upcoming' ? 'active-filter' : ''}" data-rental-filter="upcoming">Upcoming</button>
          <button type="button" class="small-btn ${rentalFilter === 'past' ? 'active-filter' : ''}" data-rental-filter="past">Past</button>
          <button type="button" class="small-btn ${rentalFilter === 'pending' ? 'active-filter' : ''}" data-rental-filter="pending">Pending Payment</button>
          <button type="button" class="small-btn ${rentalFilter === 'paid' ? 'active-filter' : ''}" data-rental-filter="paid">Paid</button>
        </div>

        <div class="rental-cal-actions-right">
          <button type="button" class="small-btn" id="rentalOpenCatalogBtn">📦 Items (${catalog.length})</button>
          <button type="button" class="small-btn green" id="rentalNewBookingBtn" style="font-weight:700;">＋ Rent an Item</button>
        </div>
      </div>

      <div class="rental-schedule-cards-list">
        ${filtered.length ? filtered.map(r => {
          const stdRate = num(r.standardRate || r.rate);
          const settled = num(r.settledAmount != null ? r.settledAmount : r.rate);
          const isBargained = settled < stdRate && stdRate > 0;
          const advance = num(r.advanceAmount) || 0;
          const balance = Math.max(0, settled - advance);
          const isUpcoming = (r.bookingDate || '') >= todayStr;
          const isTodayDate = r.bookingDate === todayStr;

          return `
            <div class="rental-schedule-card ${r.paymentStatus} ${isTodayDate ? 'is-today' : ''}" data-rental-id="${r.id}">
              <div class="schedule-card-date-col">
                <span class="schedule-card-day-name">${fmtDayName(r.bookingDate)}</span>
                <span class="schedule-card-day-num">${fmtDayAndMonth(r.bookingDate)}</span>
                <span class="schedule-card-rel-pill ${isTodayDate ? 'today' : isUpcoming ? 'upcoming' : 'past'}">
                  ${isTodayDate ? 'Today!' : isUpcoming ? 'Upcoming' : 'Past'}
                </span>
              </div>

              <div class="schedule-card-main-col">
                <div class="schedule-card-title-row">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <strong class="schedule-card-item-name">${esc(r.itemName)}</strong>
                    <span class="pill ${r.paymentStatus === 'paid' ? 'paid' : r.paymentStatus === 'advance' ? 'working' : 'pending'}">${r.paymentStatus === 'paid' ? 'Paid' : r.paymentStatus === 'advance' ? 'Advance' : 'Due'}</span>
                  </div>
                  <div class="schedule-card-amount-box">
                    <strong class="schedule-card-amount">${money(settled)}</strong>
                    ${isBargained ? `<span class="bargain-badge font-10">(-${money(stdRate - settled)})</span>` : ''}
                  </div>
                </div>

                <div class="schedule-card-details-row">
                  <span class="schedule-detail-chip">👤 <strong>${esc(r.clientName)}</strong></span>
                  <span class="schedule-detail-chip">⏱️ ${r.hours ? r.hours + ' hrs' : 'Full Day'}</span>
                  ${advance > 0 && r.paymentStatus !== 'paid' ? `<span class="schedule-detail-chip advance">Adv: ${money(advance)} · Due: ${money(balance)}</span>` : ''}
                  ${r.notes ? `<span class="schedule-detail-chip muted font-11">📍 ${esc(r.notes)}</span>` : ''}
                </div>
              </div>

              <div class="schedule-card-actions-col">
                <button type="button" class="small-btn" data-rental-details="${r.id}" title="View Details">👁️ Details</button>
                <button type="button" class="small-btn" data-rental-edit="${r.id}" title="Edit Booking">✏️ Edit</button>
                ${r.paymentStatus !== 'paid' ? `<button type="button" class="small-btn green" data-rental-mark-paid="${r.id}" title="Mark as fully paid">✓ Paid</button>` : ''}
                <button type="button" class="small-btn danger" data-rental-delete="${r.id}" title="Delete booking">🗑️</button>
              </div>
            </div>
          `;
        }).join('') : `
          <div class="empty">
            <h3>No rental bookings found</h3>
            <p>Click "＋ Rent an Item" to schedule a rental.</p>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderRentalsListView() {
  return renderRentalsScheduleView();
}

function renderAvailabilityResults(targetDate, searchQuery) {
  const avail = checkDateAvailability(targetDate);
  let availableItems = avail.availableItems;
  let blockedRentals = avail.blockedRentals;

  if (searchQuery) {
    const q = searchQuery.toLowerCase().trim();
    availableItems = availableItems.filter(i => (i.name || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q));
    blockedRentals = blockedRentals.filter(r => (r.itemName || '').toLowerCase().includes(q) || (r.clientName || '').toLowerCase().includes(q));
  }

  if (blockedRentals.length === 0) {
    return `
      <div class="rental-avail-banner available">
        <span>🟢 All ${availableItems.length} Equipment Items Available on ${fmtDate(avail.date)}! (Zero Conflicts)</span>
        <button type="button" class="small-btn green" data-cal-add="${avail.date}">＋ Book on ${fmtDate(avail.date)}</button>
      </div>
    `;
  }

  return `
    <div class="rental-avail-banner blocked">
      <span>🔴 ${blockedRentals.length} Equipment Item${blockedRentals.length === 1 ? '' : 's'} BLOCKED on ${fmtDate(avail.date)}</span>
      <span class="font-11">${availableItems.length} items still free to rent</span>
    </div>
  `;
}

function bindRentals() {
  $('#rentalBackToCalBtn')?.addEventListener('click', () => { rentalViewMode = 'calendar'; render(); });
  $('#rentalToggleScheduleBtn')?.addEventListener('click', () => { rentalViewMode = 'schedule'; render(); });
  $('#rentalOpenCatalogBtn')?.addEventListener('click', () => openRentalCatalogModal());
  $('#rentalNewBookingBtn')?.addEventListener('click', () => openRentalBookingModal());

  $('#rentalCalPrevBtn')?.addEventListener('click', e => {
    rentalCalendarMonth = e.currentTarget.dataset.month;
    render();
  });
  $('#rentalCalNextBtn')?.addEventListener('click', e => {
    rentalCalendarMonth = e.currentTarget.dataset.month;
    render();
  });
  $('#rentalCalTodayBtn')?.addEventListener('click', () => {
    rentalCalendarMonth = today().slice(0, 7);
    render();
  });

  $$('[data-rental-filter]').forEach(btn => {
    btn.onclick = () => {
      rentalFilter = btn.dataset.rentalFilter;
      render();
    };
  });

  $$('.rental-cal-card[draggable="true"]').forEach(card => {
    card.ondragstart = e => {
      rentalDraggedId = card.dataset.rentalId;
      card.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', card.dataset.rentalId);
        e.dataTransfer.effectAllowed = 'move';
      }
    };
    card.ondragend = () => {
      card.classList.remove('dragging');
      $$('.rental-cal-cell').forEach(c => c.classList.remove('drag-over-date'));
    };
    card.onclick = e => {
      e.stopPropagation();
      openRentalDetailsModal(card.dataset.rentalId);
    };
  });

  $$('.rental-cal-cell').forEach(cell => {
    cell.ondragover = e => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      cell.classList.add('drag-over-date');
    };
    cell.ondragleave = () => {
      cell.classList.remove('drag-over-date');
    };
    cell.ondrop = e => {
      e.preventDefault();
      cell.classList.remove('drag-over-date');
      const rId = e.dataTransfer?.getData('text/plain') || rentalDraggedId;
      const targetDate = cell.dataset.calDate;
      if (rId && targetDate) {
        rescheduleRental(rId, targetDate);
      }
    };
    cell.onclick = e => {
      if (e.target.closest('.rental-cal-card') || e.target.closest('.rental-cal-add-btn')) return;
      const targetDate = cell.dataset.calDate;
      if (targetDate) {
        openRentalBookingModal(null, targetDate);
      }
    };
  });

  $$('[data-cal-add]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    openRentalBookingModal(null, b.dataset.calAdd);
  });

  $$('[data-rental-details]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    openRentalDetailsModal(b.dataset.rentalDetails);
  });
  $$('[data-rental-mark-paid]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    markRentalPaid(b.dataset.rentalMarkPaid);
  });
  $$('[data-rental-edit]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    openRentalBookingModal(b.dataset.rentalEdit);
  });
  $$('[data-rental-delete]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    deleteRentalBooking(b.dataset.rentalDelete);
  });
}

function openRentalDetailsModal(rentalId) {
  const rental = (data.rentals || []).find(r => r.id === rentalId);
  if (!rental) return;
  const stdRate = num(rental.standardRate || rental.rate);
  const settled = num(rental.settledAmount != null ? rental.settledAmount : rental.rate);
  const isBargained = settled < stdRate && stdRate > 0;
  const advance = num(rental.advanceAmount) || 0;
  const balanceDue = Math.max(0, settled - advance);

  const modalHtml = `
    <div class="rental-detail-modal">
      <div class="rental-detail-hero">
        <div class="rental-detail-item-title">
          <span class="rental-detail-icon">📦</span>
          <div>
            <h3>${esc(rental.itemName)}</h3>
            <span class="muted font-12">${fmtDate(rental.bookingDate)} · ${rental.hours ? rental.hours + ' hrs' : 'Full Day'}</span>
          </div>
        </div>
        <div class="rental-detail-badges">
          <span class="pill ${rental.paymentStatus === 'paid' ? 'paid' : rental.paymentStatus === 'advance' ? 'working' : 'pending'}">${rental.paymentStatus === 'paid' ? '✓ Fully Paid' : rental.paymentStatus === 'advance' ? '⚡ Advance Paid' : '⏳ Pending Payment'}</span>
          <span class="pill ${rental.status === 'booked' ? 'pending' : rental.status === 'active' ? 'working' : 'paid'}">${rental.status === 'booked' ? '📅 Scheduled' : rental.status === 'active' ? '⚡ Out on Rent' : '✓ Completed'}</span>
        </div>
      </div>

      <div class="rental-detail-grid">
        <div class="rental-detail-field">
          <span class="rental-detail-label">Client / Renter</span>
          <strong class="rental-detail-value">${esc(rental.clientName)}</strong>
        </div>
        <div class="rental-detail-field">
          <span class="rental-detail-label">Booking Date</span>
          <strong class="rental-detail-value">${fmtDate(rental.bookingDate)}</strong>
        </div>
        <div class="rental-detail-field">
          <span class="rental-detail-label">Standard Rate</span>
          <span class="rental-detail-value muted">${stdRate ? money(stdRate) : '—'}</span>
        </div>
        <div class="rental-detail-field">
          <span class="rental-detail-label">Agreed / Settled Rate</span>
          <strong class="rental-detail-value" style="color:#16a34a;font-size:15px;">${money(settled)}</strong>
          ${isBargained ? `<small class="font-11" style="color:#f97316;">(Bargained -${money(stdRate - settled)})</small>` : ''}
        </div>
        <div class="rental-detail-field">
          <span class="rental-detail-label">Advance Received</span>
          <span class="rental-detail-value">${advance ? money(advance) : '₹0'}</span>
        </div>
        <div class="rental-detail-field">
          <span class="rental-detail-label">Balance Outstanding</span>
          <strong class="rental-detail-value" style="color:${balanceDue > 0 ? '#ef4444' : '#16a34a'};">${balanceDue > 0 ? money(balanceDue) : 'Cleared ✓'}</strong>
        </div>
        <div class="rental-detail-field">
          <span class="rental-detail-label">Expected Payment Inflow</span>
          <span class="rental-detail-value">${fmtDate(rental.expectedPaymentDate || rental.bookingDate)}</span>
        </div>
        <div class="rental-detail-field">
          <span class="rental-detail-label">Venue / Setup Notes</span>
          <span class="rental-detail-value">${esc(rental.notes || 'No venue or notes recorded')}</span>
        </div>
      </div>
    </div>
  `;

  const footerHtml = `
    <div class="modal-actions-spread">
      <div>
        <button type="button" class="small-btn danger" id="rentalDetailDeleteBtn">🗑️ Delete Booking</button>
      </div>
      <div class="modal-actions-right">
        ${rental.paymentStatus !== 'paid' ? `<button type="button" class="small-btn green" id="rentalDetailPaidBtn">✓ Mark as Paid</button>` : ''}
        <button type="button" class="small-btn blue" id="rentalDetailEditBtn">✏️ Edit Booking</button>
        <button type="button" class="small-btn" id="rentalDetailCloseBtn">Close</button>
      </div>
    </div>
  `;

  modal(`Rental Booking · ${rental.itemName}`, modalHtml, footerHtml, true);

  $('#rentalDetailDeleteBtn')?.addEventListener('click', () => {
    deleteRentalBooking(rental.id);
  });
  $('#rentalDetailPaidBtn')?.addEventListener('click', () => {
    markRentalPaid(rental.id);
    closeModal();
  });
  $('#rentalDetailEditBtn')?.addEventListener('click', () => {
    closeModal();
    openRentalBookingModal(rental.id);
  });
  $('#rentalDetailCloseBtn')?.addEventListener('click', closeModal);
}

function openRentalBookingModal(rentalId = null, prefilledDate = null, prefilledItemId = null) {
  ensureDefaultRentalItems();
  const rental = rentalId ? (data.rentals || []).find(r => r.id === rentalId) : null;
  const isEdit = !!rental;
  const catalog = data.rentalItems || [];
  
  const defaultDate = rental ? rental.bookingDate : (prefilledDate || today());
  const selectedItemId = rental ? rental.itemId : (prefilledItemId || (catalog[0]?.id || ''));
  const selItem = catalog.find(i => i.id === selectedItemId);
  const defaultRate = rental ? (rental.standardRate || selItem?.rate || 0) : (selItem?.rate || 0);
  const defaultSettled = rental ? (rental.settledAmount != null ? rental.settledAmount : defaultRate) : defaultRate;
  const defaultClient = rental ? rental.clientName : '';
  const defaultHours = rental ? (rental.hours || 8) : 8;
  const defaultPaymentStatus = rental ? (rental.paymentStatus || 'pending') : 'pending';
  const defaultAdvance = rental ? (rental.advanceAmount || 0) : 0;
  const defaultExpectedDate = rental ? (rental.expectedPaymentDate || defaultDate) : defaultDate;
  const defaultNotes = rental ? (rental.notes || '') : '';
  const defaultStatus = rental ? (rental.status || 'booked') : 'booked';

  const modalHtml = `
    <form id="rentalBookingForm" class="rental-modal-form">
      <input type="hidden" id="rentalId" value="${rental ? rental.id : ''}">
      
      <div class="rental-form-section">
        <div class="rental-form-section-title">📦 Equipment & Renter Information</div>
        
        <div class="form-row">
          <label class="form-group">
            <span class="form-label">Equipment / Rented Item <strong class="req">*</strong></span>
            <select id="rentalItemSelect" class="form-control" required>
              ${catalog.map(it => `<option value="${it.id}" data-rate="${it.rate}" data-name="${esc(it.name)}" ${it.id === selectedItemId ? 'selected' : ''}>${esc(it.name)} (${esc(it.category || 'Rental')} · ₹${it.rate}/${it.rateType || 'day'})</option>`).join('')}
              <option value="custom" ${rental && !rental.itemId ? 'selected' : ''}>＋ Other / Custom Equipment...</option>
            </select>
          </label>
        </div>

        <div class="form-row" id="customItemNameRow" style="${(rental && !rental.itemId) ? '' : 'display:none;'}">
          <label class="form-group">
            <span class="form-label">Custom Equipment Name</span>
            <input type="text" id="rentalCustomItemName" class="form-control" placeholder="Enter custom equipment name" value="${rental && !rental.itemId ? esc(rental.itemName) : ''}">
          </label>
        </div>

        <div class="form-grid-2">
          <label class="form-group">
            <span class="form-label">Client / Individual Customer Name <strong class="req">*</strong></span>
            <input type="text" id="rentalClientName" class="form-control" placeholder="e.g. Rahul Sharma or Event Company" value="${esc(defaultClient)}" required list="rentalClientList" autocomplete="off">
            <datalist id="rentalClientList">
              ${data.clients.map(c => `<option value="${esc(c.name)}">`).join('')}
            </datalist>
            <span class="form-hint">Type any individual person or pick a client (won't affect worksheet tabs)</span>
          </label>

          <label class="form-group">
            <span class="form-label">Booking Date <strong class="req">*</strong></span>
            <input type="date" id="rentalBookingDate" class="form-control" value="${defaultDate}" required>
          </label>
        </div>
      </div>

      <div class="rental-form-section">
        <div class="rental-form-section-title">💰 Pricing, Duration & Status</div>

        <div class="form-grid-2">
          <label class="form-group">
            <span class="form-label">Standard Catalog Rate</span>
            <div class="input-with-prefix">
              <span class="prefix">₹</span>
              <input type="number" id="rentalStandardRate" class="form-control-nested input-readonly" value="${defaultRate}" step="1" readonly>
            </div>
          </label>

          <label class="form-group">
            <span class="form-label">Hours Booked</span>
            <div class="input-with-suffix">
              <input type="number" id="rentalHours" class="form-control-nested" min="1" max="168" value="${defaultHours}" placeholder="8">
              <span class="suffix">hours</span>
            </div>
          </label>
        </div>

        <div class="form-grid-2">
          <label class="form-group">
            <span class="form-label">Agreed / Settled Amount <strong class="req">*</strong> <small class="form-sublabel">(if bargained, adjust here)</small></span>
            <div class="input-with-prefix">
              <span class="prefix">₹</span>
              <input type="number" id="rentalSettledAmount" class="form-control-nested" value="${defaultSettled}" min="0" step="1" required>
            </div>
          </label>

          <label class="form-group">
            <span class="form-label">Booking Status</span>
            <select id="rentalBookingStatus" class="form-control">
              <option value="booked" ${defaultStatus === 'booked' ? 'selected' : ''}>📅 Booked / Scheduled</option>
              <option value="active" ${defaultStatus === 'active' ? 'selected' : ''}>⚡ Active / Out on Rent</option>
              <option value="completed" ${defaultStatus === 'completed' ? 'selected' : ''}>✓ Completed & Returned</option>
              <option value="cancelled" ${defaultStatus === 'cancelled' ? 'selected' : ''}>✕ Cancelled</option>
            </select>
          </label>
        </div>

        <div class="form-grid-2">
          <label class="form-group">
            <span class="form-label">Payment Status</span>
            <select id="rentalPaymentStatus" class="form-control">
              <option value="pending" ${defaultPaymentStatus === 'pending' ? 'selected' : ''}>⏳ Pending Payment</option>
              <option value="advance" ${defaultPaymentStatus === 'advance' ? 'selected' : ''}>⚡ Advance Received</option>
              <option value="paid" ${defaultPaymentStatus === 'paid' ? 'selected' : ''}>✓ Fully Paid</option>
            </select>
          </label>

          <label class="form-group" id="rentalAdvanceGroup" style="${defaultPaymentStatus === 'advance' ? '' : 'display:none;'}">
            <span class="form-label">Advance Amount Received</span>
            <div class="input-with-prefix">
              <span class="prefix">₹</span>
              <input type="number" id="rentalAdvanceAmount" class="form-control-nested" value="${defaultAdvance}" min="0" step="1">
            </div>
          </label>
        </div>
      </div>

      <div class="rental-form-section">
        <div class="rental-form-section-title">📍 Logistics & Expected Cashflow</div>

        <div class="form-grid-2">
          <label class="form-group">
            <span class="form-label">Expected Payment Date <small class="form-sublabel">(When money will come in)</small></span>
            <input type="date" id="rentalExpectedPayDate" class="form-control" value="${defaultExpectedDate}">
          </label>

          <label class="form-group">
            <span class="form-label">Notes / Venue / Location</span>
            <input type="text" id="rentalNotes" class="form-control" placeholder="Setup location, contact person, pickup time..." value="${esc(defaultNotes)}">
          </label>
        </div>
      </div>

      <div id="rentalConflictNotice" class="rental-conflict-banner" style="display:none;"></div>
    </form>
  `;

  const footerHtml = `
    <div class="modal-actions-spread">
      <div>
        ${isEdit ? `<button type="button" class="small-btn danger" id="deleteRentalModalBtn" title="Delete this booking">🗑️ Delete Booking</button>` : ''}
      </div>
      <div class="modal-actions-right">
        <button type="button" class="small-btn" id="cancelRentalModalBtn">Cancel</button>
        <button type="button" class="small-btn green" id="saveRentalModalBtn" style="font-weight:700;">💾 ${isEdit ? 'Save Changes' : 'Confirm Booking'}</button>
      </div>
    </div>
  `;

  modal(isEdit ? 'Edit Rental Booking' : 'New Rental Booking', modalHtml, footerHtml, true);
  bindRentalBookingModalEvents(rental);
}

function bindRentalBookingModalEvents(rental) {
  const itemSelect = $('#rentalItemSelect');
  const customRow = $('#customItemNameRow');
  const customInput = $('#rentalCustomItemName');
  const rateInput = $('#rentalStandardRate');
  const settledInput = $('#rentalSettledAmount');
  const dateInput = $('#rentalBookingDate');
  const conflictNotice = $('#rentalConflictNotice');
  const payStatusSelect = $('#rentalPaymentStatus');
  const advanceGroup = $('#rentalAdvanceGroup');
  const advanceInput = $('#rentalAdvanceAmount');
  const catalog = data.rentalItems || [];

  function updateItemRate() {
    if (itemSelect.value === 'custom') {
      if (customRow) customRow.style.display = '';
      if (!rental) {
        rateInput.value = 0;
        settledInput.value = 0;
      }
    } else {
      if (customRow) customRow.style.display = 'none';
      const sel = catalog.find(i => i.id === itemSelect.value);
      if (sel) {
        rateInput.value = sel.rate;
        if (!rental) {
          settledInput.value = sel.rate;
        }
      }
    }
    checkConflictLive();
  }

  function checkConflictLive() {
    if (!conflictNotice) return;
    const selVal = itemSelect.value;
    const isCustom = selVal === 'custom';
    const itName = isCustom ? (customInput?.value || '') : (catalog.find(i => i.id === selVal)?.name || '');
    const dateVal = dateInput.value;
    const conflict = checkItemBookingConflict(isCustom ? null : selVal, itName, dateVal, rental ? rental.id : null);
    const sameDay = getBookingsOnDate(dateVal, rental ? rental.id : null);

    if (conflict) {
      conflictNotice.className = 'rental-conflict-banner warning';
      conflictNotice.style.display = '';
      conflictNotice.innerHTML = conflict.message;
    } else if (sameDay.length > 0) {
      conflictNotice.className = 'rental-conflict-banner info';
      conflictNotice.style.display = '';
      conflictNotice.innerHTML = `ℹ️ <strong>${sameDay.length} other booking(s)</strong> already scheduled on ${fmtDate(dateVal)}: ${sameDay.map(s => `<strong>${esc(s.itemName)}</strong> (${esc(s.clientName)})`).join(', ')}`;
    } else {
      conflictNotice.style.display = 'none';
    }
  }

  if (itemSelect) itemSelect.onchange = updateItemRate;
  if (customInput) customInput.oninput = checkConflictLive;
  if (dateInput) dateInput.onchange = checkConflictLive;

  if (payStatusSelect) {
    payStatusSelect.onchange = () => {
      if (payStatusSelect.value === 'advance') {
        if (advanceGroup) advanceGroup.style.display = '';
      } else {
        if (advanceGroup) advanceGroup.style.display = 'none';
        if (payStatusSelect.value === 'paid' && advanceInput) {
          advanceInput.value = settledInput.value;
        }
      }
    };
  }

  checkConflictLive();

  $('#cancelRentalModalBtn')?.addEventListener('click', closeModal);

  $('#deleteRentalModalBtn')?.addEventListener('click', () => {
    if (rental) deleteRentalBooking(rental.id);
  });

  $('#saveRentalModalBtn')?.addEventListener('click', () => {
    const isCustom = itemSelect.value === 'custom';
    const selItem = catalog.find(i => i.id === itemSelect.value);
    const itemName = isCustom ? (customInput?.value.trim() || 'Custom Equipment') : (selItem?.name || 'Equipment');
    const clientName = $('#rentalClientName')?.value.trim();
    const bDate = dateInput?.value;
    const hours = num($('#rentalHours')?.value) || 8;
    const stdRate = num(rateInput?.value) || 0;
    const settledAmount = num(settledInput?.value) || 0;
    const bookingStatus = $('#rentalBookingStatus')?.value || 'booked';
    const paymentStatus = payStatusSelect?.value || 'pending';
    const advanceAmount = paymentStatus === 'advance' ? num(advanceInput?.value) : (paymentStatus === 'paid' ? settledAmount : 0);
    const expectedPayDate = $('#rentalExpectedPayDate')?.value || bDate;
    const notes = $('#rentalNotes')?.value.trim() || '';

    if (!clientName) {
      toast('Please enter a client or customer name');
      $('#rentalClientName')?.focus();
      return;
    }
    if (!bDate) {
      toast('Please select a booking date');
      dateInput?.focus();
      return;
    }

    saveRentalBooking({
      id: rental ? rental.id : uid(),
      itemId: isCustom ? null : selItem?.id,
      itemName,
      clientName,
      bookingDate: bDate,
      endDate: bDate,
      hours,
      standardRate: stdRate,
      settledAmount,
      status: bookingStatus,
      paymentStatus,
      advanceAmount,
      expectedPaymentDate: expectedPayDate,
      notes
    });

    closeModal();
    toast(rental ? `Rental booking updated! 💾` : `Rental booked for ${itemName}! 🎉`);
  });
}

function openRentalCatalogModal() {
  ensureDefaultRentalItems();
  const catalog = data.rentalItems || [];

  const modalHtml = `
    <div class="rental-catalog-manager">
      <div class="catalog-add-box">
        <div class="catalog-add-box-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">✨</span>
            <div>
              <h4 style="margin:0;font-size:14px;font-weight:700;">Add New Equipment to Catalog</h4>
              <span class="muted font-11">Register gear, lights, sound systems, or cameras into your reusable inventory</span>
            </div>
          </div>
        </div>
        <div class="catalog-add-form">
          <div class="form-grid-2">
            <label class="form-group">
              <span class="form-label">Equipment Name <strong class="req">*</strong></span>
              <input type="text" id="newEquipName" class="form-control" placeholder="e.g. Nanlite Forza 500, Sony FX3, Fog Machine" required>
            </label>
            <label class="form-group">
              <span class="form-label">Category</span>
              <select id="newEquipCategory" class="form-control">
                <option value="Lighting">Lighting</option>
                <option value="Sound">Sound / Audio</option>
                <option value="Video & Projection">Video & Projection</option>
                <option value="Grip & Stands">Grip & Stands</option>
                <option value="Cameras & Lenses">Cameras & Lenses</option>
                <option value="Effects & Atmosphere">Effects & Atmosphere</option>
                <option value="Stage & Truss">Stage & Truss</option>
                <option value="Power & Cables">Power & Cables</option>
                <option value="Other">Other Equipment</option>
              </select>
            </label>
          </div>

          <div class="form-grid-3">
            <label class="form-group">
              <span class="form-label">Standard Rate <strong class="req">*</strong></span>
              <div class="input-with-prefix">
                <span class="prefix">₹</span>
                <input type="number" id="newEquipRate" class="form-control-nested" placeholder="e.g. 4500" min="0" step="1" required>
              </div>
            </label>
            <label class="form-group">
              <span class="form-label">Rate Billing Unit</span>
              <select id="newEquipRateType" class="form-control">
                <option value="day">per day / event</option>
                <option value="hour">per hour</option>
                <option value="event">per event</option>
              </select>
            </label>
            <label class="form-group">
              <span class="form-label">Specs / Included Accessories</span>
              <input type="text" id="newEquipDesc" class="form-control" placeholder="e.g. Flight case, 2 batteries, clamps">
            </label>
          </div>

          <div style="display:flex;justify-content:flex-end;margin-top:10px;">
            <button type="button" class="small-btn green" id="addNewEquipBtn" style="font-weight:700;padding:8px 18px;font-size:12.5px;display:inline-flex;align-items:center;gap:6px;">
              <span>＋</span> Add Equipment to Inventory
            </button>
          </div>
        </div>
      </div>

      <div class="catalog-items-section">
        <div class="catalog-items-section-header">
          <h4 style="margin:0;">Equipment Inventory (${catalog.length} items)</h4>
          <span class="muted font-11">All items in your catalog available for bookings</span>
        </div>

        <div class="catalog-table-wrap">
          <table class="catalog-table">
            <thead>
              <tr>
                <th>EQUIPMENT NAME</th>
                <th>CATEGORY</th>
                <th>STANDARD RATE</th>
                <th>SPECS / NOTES</th>
                <th>BOOKINGS</th>
                <th style="text-align:right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              ${catalog.map(it => {
                const activeBookingsCount = (data.rentals || []).filter(r => r.itemId === it.id && r.status !== 'cancelled').length;
                return `
                  <tr data-catalog-row="${it.id}">
                    <td><strong>${esc(it.name)}</strong></td>
                    <td><span class="catalog-cat-badge">${esc(it.category || 'Rental')}</span></td>
                    <td><strong class="catalog-rate-value">₹${Number(it.rate || 0).toLocaleString('en-IN')}</strong> <span class="muted font-11">/${esc(it.rateType || 'day')}</span></td>
                    <td class="muted font-11">${esc(it.description || '—')}</td>
                    <td><span class="pill ${activeBookingsCount > 0 ? 'working' : 'pending'}" style="font-size:10px;">${activeBookingsCount} booked</span></td>
                    <td style="text-align:right">
                      <div style="display:inline-flex;gap:6px;">
                        <button type="button" class="small-btn blue" data-catalog-book="${it.id}" title="Book this item">＋ Rent</button>
                        <button type="button" class="small-btn danger" data-catalog-delete="${it.id}" title="Delete this item from inventory">🗑️ Delete</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  modal(`📦 Equipment Catalog & Items (${catalog.length})`, modalHtml, `<div class="modal-actions"><button type="button" class="small-btn" id="closeCatalogModalBtn">Close</button></div>`, true);
  bindRentalCatalogModalEvents();
}

function bindRentalCatalogModalEvents() {
  $('#closeCatalogModalBtn')?.addEventListener('click', closeModal);

  $('#addNewEquipBtn')?.addEventListener('click', () => {
    const name = $('#newEquipName')?.value.trim();
    const category = $('#newEquipCategory')?.value.trim() || 'Equipment';
    const rate = num($('#newEquipRate')?.value) || 0;
    const rateType = $('#newEquipRateType')?.value || 'day';
    const description = $('#newEquipDesc')?.value.trim() || '';

    if (!name) {
      toast('Please enter equipment name');
      $('#newEquipName')?.focus();
      return;
    }

    saveRentalItem({
      id: 'equip-' + uid().slice(0, 8),
      name,
      category,
      rate,
      rateType,
      description
    });

    toast(`Added "${name}" to equipment catalog! 📦`);
    openRentalCatalogModal();
  });

  $$('[data-catalog-book]').forEach(b => {
    b.onclick = () => {
      closeModal();
      openRentalBookingModal(null, today(), b.dataset.catalogBook);
    };
  });

  $$('[data-catalog-delete]').forEach(b => {
    b.onclick = () => {
      deleteRentalItem(b.dataset.catalogDelete, true);
    };
  });
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

function fmtTimeAgo(isoString) {
  if (!isoString) return '—';
  try {
    const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (isNaN(diffSec) || diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return isoString.slice(0, 10);
  } catch {
    return '—';
  }
}

function broadcastActivityLog(action, payload = {}) {
  if (typeof channel !== 'undefined' && channel) {
    try {
      channel.send({
        type: 'broadcast',
        event: 'activity_log_update',
        payload: {
          action,
          senderId: typeof currentUserId === 'function' ? currentUserId() : 'local-me',
          timestamp: new Date().toISOString(),
          ...payload
        }
      });
    } catch (e) {
      console.warn('Activity log broadcast warning:', e);
    }
  }
}

function handleIncomingActivityLogUpdate(payload) {
  if (!payload) return;
  data.activityLog = data.activityLog || [];
  if (payload.action === 'rollback' && payload.activityId) {
    const act = data.activityLog.find(a => a.id === payload.activityId);
    if (act) act.rolledBack = true;
  } else if (payload.entry) {
    const existingIdx = data.activityLog.findIndex(a => a.id === payload.entry.id);
    if (existingIdx >= 0) {
      data.activityLog[existingIdx] = payload.entry;
    } else {
      data.activityLog.unshift(payload.entry);
      if (data.activityLog.length > 500) data.activityLog.length = 500;
    }
  }
  if (tab === 'activity' || tab === 'settings') render();
}

function mergeRemoteActivityLog(remoteEntries) {
  if (!Array.isArray(remoteEntries) || !remoteEntries.length) return;
  data.activityLog = data.activityLog || [];
  const map = new Map();
  for (const entry of data.activityLog) {
    if (entry && entry.id) map.set(entry.id, entry);
  }
  for (const remote of remoteEntries) {
    if (!remote || !remote.id) continue;
    const local = map.get(remote.id);
    if (!local) {
      map.set(remote.id, remote);
    } else {
      if (remote.rolledBack && !local.rolledBack) local.rolledBack = true;
    }
  }
  data.activityLog = Array.from(map.values()).sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return tb - ta;
  }).slice(0, 500);
}

function logActivity(type, description, details = {}) {
  try {
    data.activityLog = data.activityLog || [];
    const entry = {
      id: uid(),
      timestamp: new Date().toISOString(),
      userName: (data.settings && data.settings.displayName) || 'Team Member',
      userId: typeof currentUserId === 'function' ? currentUserId() : 'local-me',
      type, // 'add' | 'update' | 'delete' | 'paste' | 'smart-update' | 'status'
      description: description || 'Workspace activity',
      clientId: details.clientId || (typeof activeClient !== 'undefined' ? activeClient : null),
      clientName: details.clientName || (data.clients && data.clients.find(c => c.id === (details.clientId || activeClient))?.name) || '',
      items: details.items ? JSON.parse(JSON.stringify(details.items)) : undefined,
      item: details.item ? JSON.parse(JSON.stringify(details.item)) : undefined,
      previousItem: details.previousItem ? JSON.parse(JSON.stringify(details.previousItem)) : undefined,
      previousItems: details.previousItems ? JSON.parse(JSON.stringify(details.previousItems)) : undefined,
      itemId: details.itemId || undefined,
      field: details.field || undefined,
      previousValue: details.previousValue !== undefined ? details.previousValue : undefined,
      newValue: details.newValue !== undefined ? details.newValue : undefined,
      rolledBack: false
    };
    data.activityLog.unshift(entry);
    if (data.activityLog.length > 500) data.activityLog.length = 500;
    data.activityLogPendingSync = true;
    broadcastActivityLog('new_entry', { entry });
    if (typeof scheduleSync === 'function') scheduleSync();
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

function rollbackActivity(activityId) {
  data.activityLog = data.activityLog || [];
  const act = data.activityLog.find(a => a.id === activityId);
  if (!act) {
    toast('Activity not found');
    return false;
  }
  if (act.rolledBack) {
    toast('This activity has already been rolled back');
    return false;
  }

  pushUndo(`Rollback: ${act.description}`);

  let restoredDesc = '';
  if (act.type === 'delete') {
    const itemsToRestore = act.items || (act.item ? [act.item] : []);
    if (!itemsToRestore.length) {
      toast('No row data found to restore');
      return false;
    }
    const restoreIds = new Set(itemsToRestore.map(r => r.id));
    data.pendingDeletes = (data.pendingDeletes || []).filter(d => !restoreIds.has(d.id));
    itemsToRestore.forEach(restored => {
      restored.updatedAt = new Date().toISOString();
      const existingIdx = data.items.findIndex(i => i.id === restored.id);
      if (existingIdx >= 0) {
        data.items[existingIdx] = restored;
      } else {
        data.items.push(restored);
      }
      enqueue('items', restored.id);
    });
    restoredDesc = `Restored ${itemsToRestore.length} deleted row${itemsToRestore.length === 1 ? '' : 's'}`;
  } else if (act.type === 'add' || act.type === 'paste') {
    const itemsToRemove = act.items || (act.item ? [act.item] : []);
    if (!itemsToRemove.length) {
      toast('No row data to remove');
      return false;
    }
    data.pendingDeletes = data.pendingDeletes || [];
    const removeIds = new Set(itemsToRemove.map(r => r.id));
    itemsToRemove.forEach(rem => {
      if (!data.pendingDeletes.some(d => d.table === 'items' && d.id === rem.id)) {
        data.pendingDeletes.push({ table: 'items', id: rem.id });
      }
      enqueue('items', rem.id);
    });
    data.items = data.items.filter(i => !removeIds.has(i.id));
    restoredDesc = `Removed ${itemsToRemove.length} added row${itemsToRemove.length === 1 ? '' : 's'}`;
  } else if (act.type === 'update') {
    if (act.previousItem) {
      const prev = act.previousItem;
      const curr = data.items.find(i => i.id === prev.id);
      if (curr) {
        Object.assign(curr, prev);
        curr.updatedAt = new Date().toISOString();
        enqueue('items', curr.id);
        restoredDesc = `Reverted changes on "${curr.service || 'Row'}"`;
      } else {
        toast('Row not found');
        return false;
      }
    } else if (act.itemId && act.field && act.previousValue !== undefined) {
      const item = data.items.find(i => i.id === act.itemId);
      if (item) {
        item[act.field] = act.previousValue;
        item.updatedAt = new Date().toISOString();
        enqueue('items', item.id);
        restoredDesc = `Reverted ${act.field} to ${act.previousValue}`;
      } else {
        toast('Row not found');
        return false;
      }
    }
  } else if (act.type === 'status' || act.type === 'smart-update') {
    if (act.previousItems && act.previousItems.length) {
      act.previousItems.forEach(prev => {
        const curr = data.items.find(i => i.id === prev.id);
        if (curr) {
          Object.assign(curr, prev);
          curr.updatedAt = new Date().toISOString();
          enqueue('items', curr.id);
        }
      });
      restoredDesc = `Reverted updates on ${act.previousItems.length} row${act.previousItems.length === 1 ? '' : 's'}`;
    }
  }

  act.rolledBack = true;
  data.activityLogPendingSync = true;
  broadcastActivityLog('rollback', { activityId, entry: act });
  save();
  render();
  scheduleSync();
  toast(`✓ ${restoredDesc || 'Activity rolled back'}`);
  return true;
}

function clearActivityLog() {
  if (!data.activityLog || !data.activityLog.length) return;
  if (confirm('Clear all recorded activity history? This cannot be undone.')) {
    data.activityLog = [];
    data.activityLogPendingSync = true;
    save();
    render();
    scheduleSync();
    toast('Activity log cleared');
  }
}

function renderActivity() {
  const log = (data.activityLog || []).slice();
  const query = (activitySearchQuery || '').toLowerCase().trim();
  const filtered = log.filter(entry => {
    if (activityFilter !== 'all' && entry.type !== activityFilter) return false;
    if (!query) return true;
    const matchDesc = (entry.description || '').toLowerCase().includes(query);
    const matchUser = (entry.userName || '').toLowerCase().includes(query);
    const matchClient = (entry.clientName || '').toLowerCase().includes(query);
    return matchDesc || matchUser || matchClient;
  });

  const typeIcons = {
    add: '➕',
    update: '✏️',
    delete: '🗑️',
    paste: '📋',
    status: '🏷️'
  };

  const counts = {
    all: log.length,
    add: log.filter(e => e.type === 'add').length,
    update: log.filter(e => e.type === 'update').length,
    delete: log.filter(e => e.type === 'delete').length,
    paste: log.filter(e => e.type === 'paste').length,
    status: log.filter(e => e.type === 'status').length
  };

  const displayed = filtered.slice(0, activityDisplayLimit);
  const hasMore = filtered.length > activityDisplayLimit;

  const pill = (type, label) => `
    <button type="button" class="activity-pill-btn ${activityFilter === type ? 'active' : ''}" data-activity-filter="${type}">
      ${label} (${counts[type] || 0})
    </button>
  `;

  let rowsHtml = '';
  if (!displayed.length) {
    rowsHtml = `
      <div class="empty" style="padding:48px 20px;">
        <h3>No activities match</h3>
        <p class="muted">Try choosing another filter or clearing the search query.</p>
      </div>
    `;
  } else {
    rowsHtml = displayed.map(act => {
      const icon = typeIcons[act.type] || '📝';
      const timeStr = fmtTimeAgo(act.timestamp);
      return `
        <div class="activity-card ${act.rolledBack ? 'rolled-back-card' : ''}" data-activity-item="${act.id}">
          <div class="activity-card-icon">${icon}</div>
          <div class="activity-card-body">
            <div class="activity-card-desc">${esc(act.description)}</div>
            <div class="activity-card-meta">
              <span class="activity-badge ${act.type}">${act.type}</span>
              <span><strong>${esc(act.userName || 'Team member')}</strong></span>
              <span>•</span>
              <span title="${esc(act.timestamp)}">${timeStr}</span>
              ${act.clientName ? `<span>•</span><span class="activity-client-tag">${esc(act.clientName)}</span>` : ''}
              ${act.rolledBack ? `<span class="pill-danger" style="padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;">ROLLED BACK</span>` : ''}
            </div>
          </div>
          <div class="activity-card-actions">
            ${!act.rolledBack ? `<button type="button" class="small-btn quiet" data-rollback-id="${act.id}" title="Roll back this action">↩ Roll back</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  return `
    <div class="activity-page">
      <div class="section-top" style="margin-bottom:0;">
        <div>
          <h2>Team Activity Tracker</h2>
          <p>Live sync of additions, cell edits, deletions, and pastes with instant one-click rollback.</p>
        </div>
        <div style="display:flex;gap:8px;">
          ${log.length ? `<button type="button" class="small-btn quiet" id="clearActivityLogBtn" style="font-size:11.5px;">Clear Log</button>` : ''}
        </div>
      </div>

      <div class="activity-toolbar">
        <div class="activity-search-wrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" id="activitySearchInput" placeholder="Search activities, services, team members..." value="${esc(activitySearchQuery)}">
        </div>
        <div class="activity-filter-pills">
          ${pill('all', 'All')}
          ${pill('add', 'Adds')}
          ${pill('update', 'Edits')}
          ${pill('delete', 'Deletions')}
          ${pill('paste', 'Pastes')}
          ${pill('status', 'Status')}
        </div>
      </div>

      <div class="activity-list">
        ${rowsHtml}
        ${hasMore ? `
          <button type="button" class="activity-load-more" id="activityLoadMoreBtn">
            Load more (${filtered.length - activityDisplayLimit} remaining)
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderActivityHistoryPanel() {
  const log = data.activityLog || [];
  const typeIcons = {
    add: '➕',
    delete: '🗑️',
    update: '✏️',
    paste: '📋',
    'smart-update': '⚡',
    status: '🏷️'
  };
  const typeBadges = {
    add: 'pill-success',
    delete: 'pill-danger',
    update: 'pill-info',
    paste: 'pill-purple',
    'smart-update': 'pill-warning',
    status: 'pill-info'
  };

  let rowsHtml = '';
  if (!log.length) {
    rowsHtml = `<div class="empty" style="padding:28px 16px;"><p class="muted" style="margin:0;font-size:13px;">No activity recorded yet. Edits, deletions, additions, and copy-pastes will be tracked here in real time with instant rollback capability.</p></div>`;
  } else {
    rowsHtml = `<div class="activity-log-table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:110px;">ACTION</th>
            <th>DETAILS</th>
            <th style="width:130px;">CLIENT</th>
            <th style="width:110px;">BY</th>
            <th style="width:100px;">TIME</th>
            <th style="width:110px;text-align:right;">ROLLBACK</th>
          </tr>
        </thead>
        <tbody>
          ${log.slice(0, 100).map(act => {
            const icon = typeIcons[act.type] || '📝';
            const badgeClass = typeBadges[act.type] || 'pill';
            const timeAgo = fmtTimeAgo(act.timestamp);
            const isRolledBack = !!act.rolledBack;
            return `<tr>
              <td><span class="pill ${badgeClass}" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;">${icon} ${act.type.toUpperCase()}</span></td>
              <td><strong>${esc(act.description)}</strong></td>
              <td><span class="muted" style="font-size:12px;">${esc(act.clientName || '—')}</span></td>
              <td><span style="font-size:12px;">👤 ${esc(act.userName || 'Member')}</span></td>
              <td><span class="muted" style="font-size:12px;" title="${esc(act.timestamp)}">${timeAgo}</span></td>
              <td style="text-align:right;">
                ${isRolledBack 
                  ? `<span class="pill" style="opacity:0.6;font-size:11px;">✓ Rolled back</span>`
                  : `<button type="button" class="small-btn danger" data-rollback-id="${act.id}" style="padding:3px 8px;font-size:11px;font-weight:600;" title="Revert this action">↶ Rollback</button>`
                }
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  return `<div class="panel" style="margin-top:16px;grid-column:1/-1;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div>
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;"><span>📜 Activity Tracker & Rollback</span> <span class="pill" style="font-size:11px;padding:2px 8px;">${log.length} actions logged</span></h3>
        <p class="muted" style="margin:4px 0 0 0;font-size:13px;">Tracks all edits, additions, deletions, and copy-pastes across all clients. Accidentally deleted or overwritten rows can be restored instantly with one click.</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="button" class="small-btn blue" data-action="go-activity" style="font-size:11.5px;font-weight:700;">Open Activity Tracker Page →</button>
        ${log.length ? `<button type="button" class="small-btn quiet" id="clearActivityLogBtn" style="font-size:11px;">Clear Log</button>` : ''}
      </div>
    </div>
    ${rowsHtml}
  </div>`;
}

function renderSettings() { const s=data.settings; return `<div class="section-top"><div><h2>Workspace settings</h2><p>Business details, team members, activity history and Supabase connection.</p></div></div><div class="grid-2"><div class="panel"><h3>Business on invoices</h3><div class="field"><label>Business name</label><input data-setting="seller.name" value="${esc(s.seller.name)}"></div><div class="field"><label>Address</label><textarea data-setting="seller.address" rows="3">${esc(s.seller.address)}</textarea></div><div class="field-grid"><div class="field"><label>Email</label><input data-setting="seller.email" value="${esc(s.seller.email)}"></div><div class="field"><label>Phone</label><input data-setting="seller.phone" value="${esc(s.seller.phone)}"></div></div><div class="field"><label>Tax / GST ID (optional)</label><input data-setting="seller.taxId" value="${esc(s.seller.taxId)}"></div><label class="invoice-logo-upload"><span class="invoice-logo-preview">${s.seller.logoData?`<img src="${esc(s.seller.logoData)}" alt="Company logo">`:`<img src="assets/gir-icon.png" alt="Default MeowSheet logo">`}</span><span>Choose company logo</span><input id="companyLogoUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>${renderBankAccountsList()}<button class="small-btn blue" data-action="save-settings" style="margin-top:6px;">Save business details</button></div><div class="panel"><h3>Your team</h3><div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><label class="avatar-upload" style="margin:0;flex:1"><span class="avatar">${avatar(currentUserId(),s.displayName,'',s.avatarData)}</span><span>${s.avatarData?'Change your avatar image':'Choose your avatar image'}</span><input id="avatarUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>${s.avatarData?`<button type="button" class="small-btn quiet" id="removeAvatarBtn" title="Remove custom avatar">Remove</button>`:''}</div><div class="field"><label>Your display name</label><input data-setting="displayName" value="${esc(s.displayName)}"></div><div class="field"><label>Your Cat Spirit (for animated reactions & pings)</label><select data-setting="catType"><option value="orange" ${s.catType!=='black'?'selected':''}>🐱 Orange Cat (Playful & Energetic)</option><option value="black" ${s.catType==='black'?'selected':''}>🐈‍⬛ Midnight Black Cat (Cool & Mysterious)</option></select></div>${!session?`<div class="field" style="margin-top:14px;border-top:1px dashed #e2e8f0;padding-top:12px"><label>Second person (local view)</label><div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><label class="avatar-upload" style="margin:0;flex:1"><span class="avatar">${avatar('local-partner',s.localPartner,'',s.partnerAvatarData)}</span><span>${s.partnerAvatarData?'Change partner avatar':'Choose partner avatar image'}</span><input id="partnerAvatarUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>${s.partnerAvatarData?`<button type="button" class="small-btn quiet" id="removePartnerAvatarBtn" title="Remove partner avatar">Remove</button>`:''}</div><input data-setting="localPartner" value="${esc(s.localPartner)}" placeholder="Second person name"></div>`:''}<button class="small-btn blue" data-action="save-settings" style="margin-top:8px">Save names</button><div class="notice">When connected, both people sign in with their own Supabase accounts. Assignments, names, and avatar images update automatically on both PCs.</div></div></div>${renderActivityHistoryPanel()}
    <div class="panel"><h3>Supabase connection</h3><div class="field-grid"><div class="field"><label>Project URL</label><input id="supaUrl" placeholder="https://project.supabase.co" value="${esc(s.url)}"></div><div class="field"><label>Publishable / anon key</label><input id="supaKey" type="password" placeholder="Never enter a service-role key" value="${esc(s.key)}"></div></div><div class="actions"><button class="small-btn" data-action="save-connection">Save connection</button>${session?`<span class="pill paid">Signed in as ${esc(session.user.email)}</span><button class="small-btn" data-action="sign-out">Sign out</button>`:`<button class="small-btn blue" data-action="sign-in">Sign in</button><button class="small-btn" data-action="sign-up">Create account</button>`}</div>${session?`<div class="notice">Workspace code: <strong>${esc(s.joinCode||'Create or join a workspace')}</strong> · Share this code with your second team member. Workspace ID: ${esc(s.workspaceId||'none')}</div><div class="actions"><button class="small-btn blue" data-action="sync">Sync now</button></div>`:''}</div><div class="panel"><h3>Desktop app</h3><div class="field" style="margin-bottom:12px"><label>Appearance / Theme</label><select data-setting="theme" id="settingsThemeSelect"><option value="light" ${(s.theme||'light')==='light'?'selected':''}>☀️ Light Mode</option><option value="dark" ${(s.theme||'light')==='dark'?'selected':''}>🌙 Dark Mode</option><option value="system" ${(s.theme||'light')==='system'?'selected':''}>💻 System Default (Match OS)</option></select></div><p class="muted">Changes sync automatically while connected.</p><div class="actions"><button class="small-btn" data-action="sync">Sync now</button><button class="small-btn blue" id="updateBtn">Check for updates</button><span id="appVersion"></span></div><p class="muted" id="updateStatus"></p></div>`; }

function positionContextMenu(menu, clientX, clientY) {
  $('#contextMenu')?.remove();
  document.body.appendChild(menu);
  const menuWidth = menu.offsetWidth || 235;
  const menuHeight = menu.offsetHeight || 420;
  const winW = (typeof window !== 'undefined' ? window.innerWidth : 1200) || document.documentElement?.clientWidth || 1200;
  const winH = (typeof window !== 'undefined' ? window.innerHeight : 800) || document.documentElement?.clientHeight || 800;
  let x = clientX;
  let y = clientY;
  if (x + menuWidth > winW - 10) x = Math.max(10, winW - menuWidth - 10);
  else x = Math.max(10, x);
  if (y + menuHeight > winH - 12) y = Math.max(10, winH - menuHeight - 12);
  else y = Math.max(10, y);
  menu.style.left = Math.round(x) + 'px';
  menu.style.top = Math.round(y) + 'px';
}

function bindMain() {
  $$('[data-action]').forEach(b=>b.onclick=()=>actions(b.dataset.action));
  const backBtn=$('#topBackBtn');if(backBtn)backBtn.onclick=goBack;
  const themeToggle=$('#themeToggleBtn');if(themeToggle)themeToggle.onclick=toggleTheme;
  const themeSelect=$('#settingsThemeSelect');if(themeSelect)themeSelect.onchange=e=>{applyTheme(e.target.value);save();};
  $$('[data-rollback-id]').forEach(b=>{b.onclick=e=>{e.stopPropagation();rollbackActivity(b.dataset.rollbackId);};});
  const clearActBtn=$('#clearActivityLogBtn');if(clearActBtn)clearActBtn.onclick=()=>clearActivityLog();
  const actSearch = $('#activitySearchInput');
  if (actSearch) {
    actSearch.oninput = e => {
      activitySearchQuery = e.target.value;
      activityDisplayLimit = 50;
      render();
      const input = $('#activitySearchInput');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    };
  }
  $$('[data-activity-filter]').forEach(btn => {
    btn.onclick = () => {
      activityFilter = btn.dataset.activityFilter;
      activityDisplayLimit = 50;
      render();
    };
  });
  const actLoadMore = $('#activityLoadMoreBtn');
  if (actLoadMore) {
    actLoadMore.onclick = () => {
      activityDisplayLimit += 50;
      render();
    };
  }
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

  // Tasks Tab action bindings
  const openTaskBtn = $('#openAddTaskBtn');
  if (openTaskBtn) openTaskBtn.onclick = () => openTaskModal();

  const clearCompletedBtn = $('#clearAllCompletedTasksBtn');
  if (clearCompletedBtn) {
    clearCompletedBtn.onclick = e => {
      e.stopPropagation();
      const clearedIds = (data.tasks || []).filter(t => t.completed).map(t => t.id);
      data.tasks = (data.tasks || []).filter(t => !t.completed);
      recordDeletedTaskIds(clearedIds);
      broadcastNoticeBoard('clear_completed', { taskIds: clearedIds });
      scheduleNoticeBoardCloudSync();
      save();
      render();
      toast('Completed tasks cleared');
    };
  }

  $$('[data-task-action]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const action = btn.dataset.taskAction;
      const tid = btn.dataset.taskId;
      const task = (data.tasks || []).find(t => t.id === tid);
      if (!task) return;
      const authorName = data.settings.displayName || session?.user?.user_metadata?.display_name || 'Team member';

      if (action === 'complete') {
        task.completed = true;
        task.completedAt = new Date().toISOString();
        task.completedBy = authorName;
        task.updatedAt = new Date().toISOString();
        task.updatedBy = authorName;
        task.updatedById = currentUserId();
        broadcastNoticeBoard('upsert', { task });
        scheduleNoticeBoardCloudSync();
        save();
        render();
        toast('✓ Reminder marked complete! 🎉');
      } else if (action === 'snooze') {
        const snoozeDate = new Date(Date.now() + 15 * 60 * 1000);
        task.remindAt = snoozeDate.toISOString();
        task.dueDate = snoozeDate.toISOString().slice(0, 10);
        const h24 = snoozeDate.getHours();
        const mins = snoozeDate.getMinutes();
        task.dueTime = `${String(h24).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        task.notified = false;
        task.overdueNotified = false;
        task.lastTrendingNotifyAt = null;
        task.updatedAt = new Date().toISOString();
        task.updatedBy = authorName;
        task.updatedById = currentUserId();
        broadcastNoticeBoard('upsert', { task });
        scheduleNoticeBoardCloudSync();
        save();
        render();
        toast('⏰ Reminder snoozed for 15 minutes');
      } else if (action === 'edit') {
        openTaskModal(tid);
      } else if (action === 'delete') {
        data.tasks = (data.tasks || []).filter(t => t.id !== tid);
        recordDeletedTaskIds([tid]);
        broadcastNoticeBoard('delete', { taskId: tid });
        scheduleNoticeBoardCloudSync();
        save();
        render();
        toast('Reminder deleted');
      } else if (action === 'restore') {
        task.completed = false;
        task.completedAt = null;
        task.completedBy = null;
        task.updatedAt = new Date().toISOString();
        task.updatedBy = authorName;
        task.updatedById = currentUserId();
        broadcastNoticeBoard('upsert', { task });
        scheduleNoticeBoardCloudSync();
        save();
        render();
        toast('Reminder restored to Notice Board');
      }
    };
  });
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
  $$('[data-cell]').forEach(el=>{
    el.onchange=()=>editCell(el.dataset.id,el.dataset.cell,el.value, true);
    if(el.tagName==='INPUT') {
      el.onpaste=e=>pasteGrid(e,el);
      el.addEventListener('input', () => {
        const id = el.dataset.id, key = el.dataset.cell;
        if (!id || !key) return;
        const i = (data.items || []).find(x => x.id === id);
        if (!i) return;
        let val = el.value;
        if (['quantity', 'rate', 'quotedTotal', 'advanceAmount'].includes(key)) val = Math.max(0, num(val));
        if (i[key] === val) return;
        i[key] = val;
        if (key === 'quantity' || key === 'rate') {
          i.manualTotal = false;
          i.quotedTotal = num(i.quantity) * num(i.rate);
          const ti = el.closest('tr')?.querySelector('[data-cell="quotedTotal"]');
          if (ti) ti.value = i.quotedTotal;
        } else if (key === 'quotedTotal') {
          i.manualTotal = true;
        }
        i.updatedAt = new Date().toISOString();
        queue('items', i.id);
        refreshSelection();
        updateGroupHeaderDOM(i);
      });
      el.addEventListener('focus', () => {
        if (el.readOnly || !el.classList.contains('editing')) {
          activateSheetField(el);
        }
      });
    }
  });
  $$('[data-status-menu]').forEach(button=>button.onclick=e=>{
    e.stopPropagation();
    if(tab==='sheet')selectSheetRow(button.dataset.statusMenu,false,false);
    openStatusMenu(button,button.dataset.statusMenu);
  });
  $$('[data-assignee-pick]').forEach(b=>b.onclick=()=>assignPersonDialog(b.dataset.assigneePick));
  $('#avatarUpload')?.addEventListener('change',e=>{if(e.target.files?.[0])saveAvatar(e.target.files[0]);});
  $('#removeAvatarBtn')?.addEventListener('click',async ()=>{
    data.settings.avatarData='';save();
    if(clientApi&&session&&data.settings.workspaceId){
      await clientApi.from('members').update({avatar_data:''}).eq('workspace_id',data.settings.workspaceId).eq('user_id',session.user.id);
      const me=data.members.find(m=>m.userId===session.user.id);if(me)me.avatarData='';
    }
    render();toast('Avatar removed');
  });
  $('#partnerAvatarUpload')?.addEventListener('change',e=>{if(e.target.files?.[0])savePartnerAvatar(e.target.files[0]);});
  $('#removePartnerAvatarBtn')?.addEventListener('click',()=>{
    data.settings.partnerAvatarData='';save();render();toast('Partner avatar removed');
  });
  $('#companyLogoUpload')?.addEventListener('change',e=>{if(e.target.files?.[0])saveCompanyLogo(e.target.files[0]);});
  if (typeof window !== 'undefined' && !window._rowDragEndRegistered) {
    window._rowDragEndRegistered = true;
    window.addEventListener('mouseup', e => handleRowDragEnd(e));
  }

  if (typeof window !== 'undefined' && !window._editBlurRegistered) {
    window._editBlurRegistered = true;
    document.addEventListener('mousedown', e => {
      const active = document.querySelector('input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing');
      if (active) {
        if (active.contains(e.target) || e.target.closest('td')?.contains(active)) {
          return;
        }
        // If clicking directly into another editable sheet cell, pass it as exceptEl so it doesn't get wiped abruptly
        const targetCell = e.target.closest('td')?.querySelector('[data-cell], [data-blank-cell]');
        if (targetCell) {
          deactivateAllEditingFields(targetCell);
          return;
        }
        deactivateAllEditingFields();
      }
    }, true);
  }

  $$('[data-row]').forEach(row=>{
    row.onmousedown = e => {
      if (e.button !== 0) return;
      const activeEditing = document.querySelector('input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing');
      if (activeEditing && !activeEditing.contains(e.target)) {
        deactivateAllEditingFields();
      }
      $$('.sheet tr.blank-row').forEach(r => r.classList.remove('blank-selected'));
      if (e.target.closest('button, input[type=checkbox]')) return;

      // 1. Shift+Click or Ctrl+Click multi-row selection
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        deactivateAllEditingFields();
        handleRowDragStart(row.dataset.row, e);
        e.preventDefault();
        return;
      }

      const field = e.target.closest('td')?.querySelector('[data-cell]');
      selectionCell = field ? { id: row.dataset.row, key: field.dataset.cell } : null;

      // Direct editing on single click (instant typing for cost, service, etc.)
      if (field) {
        activateSheetField(field);
        if (e.target !== field && typeof field.focus === 'function') {
          field.focus();
        }
      }

      handleRowDragStart(row.dataset.row, e);
      if (!field) {
        e.preventDefault();
      }
    };
    row.onmouseenter = e => {
      if (isRowDragSelecting && (e.buttons === 1 || e.which === 1)) {
        handleRowDragOver(row.dataset.row, e);
      }
    };
    row.onmousemove = e => {
      if (isRowDragSelecting && (e.buttons === 1 || e.which === 1)) {
        handleRowDragOver(row.dataset.row, e);
      }
    };
    row.onclick = e => {
      if (justDraggedSelection) {
        justDraggedSelection = false;
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        selectSheetRow(row.dataset.row, e.shiftKey, e.ctrlKey || e.metaKey);
        return;
      }
      // If clicked inside an editable cell (directly on input or on td), ensure active and NEVER select row
      const cellField = e.target.closest('td')?.querySelector('[data-cell]');
      if (e.target.closest('button, input.editing') || cellField) {
        if (cellField && !cellField.classList.contains('editing')) {
          activateSheetField(cellField);
          if (typeof cellField.focus === 'function') cellField.focus();
        }
        return;
      }
      if (e.target.matches('[type=checkbox], [data-cell], [data-blank-cell]')) return;
      const field = e.target.closest('td')?.querySelector('[data-cell]');
      selectionCell = field ? { id: row.dataset.row, key: field.dataset.cell } : null;

      const now = Date.now();
      const isSameCell = lastCellClick.rowId === row.dataset.row &&
                         lastCellClick.cellKey === field?.dataset?.cell &&
                         field;
      const timeDiff = now - lastCellClick.time;

      if (isSameCell && timeDiff < 900) {
        activateSheetField(field);
        lastCellClick = { rowId: null, cellKey: null, blankOrder: null, time: 0 };
        return;
      }

      lastCellClick = { rowId: row.dataset.row, cellKey: field?.dataset?.cell || null, blankOrder: null, time: now };
      selectSheetRow(row.dataset.row, e.shiftKey, e.ctrlKey || e.metaKey);
    };
    row.ondblclick = e => {
      const td = e.target.closest('td'), field = td?.querySelector('[data-cell]');
      if (field) {
        activateSheetField(field);
        lastCellClick = { rowId: null, cellKey: null, blankOrder: null, time: 0 };
        if (typeof field.focus === 'function') field.focus();
        if (typeof field.select === 'function') field.select();
      }
    };
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
        `<button id="contextInsertAbove"><span class="context-icon">⬆</span><span>Insert row above</span><kbd>Ctrl+Shift+Enter</kbd></button>`+
        `<button id="contextInsertBelow"><span class="context-icon">⬇</span><span>Insert row below</span><kbd>Ctrl+Alt+Enter</kbd></button>`+
        `<button id="contextDuplicate"><span class="context-icon">⧉</span><span>Duplicate row</span><kbd>Ctrl+D</kbd></button>`+
        `<button id="contextAddMulti"><span class="context-icon">➕</span><span>Add multiples…</span></button>`+
        `<button id="contextSmartUpdate"><span class="context-icon">⚡</span><span>Smart Update…</span></button>`+
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
      positionContextMenu(menu, e.clientX, e.clientY);
      $('#contextCut').onclick=()=>{menu.remove();copySelectedRows(true);};
      $('#contextCopy').onclick=()=>{menu.remove();copySelectedRows(false);};
      if($('#contextPaste'))$('#contextPaste').onclick=()=>{menu.remove();pasteCopiedRows(rowId);};
      if($('#contextInsertAbove'))$('#contextInsertAbove').onclick=()=>{menu.remove();insertRowAt(rowId,'above');};
      if($('#contextInsertBelow'))$('#contextInsertBelow').onclick=()=>{menu.remove();insertRowAt(rowId,'below');};
      $('#contextDuplicate').onclick=()=>{menu.remove();duplicateSelectedRow(rowId);};
      if($('#contextAddMulti'))$('#contextAddMulti').onclick=()=>{menu.remove();addMultiplesDialog();};
      if($('#contextSmartUpdate'))$('#contextSmartUpdate').onclick=()=>{menu.remove();smartUpdateDialog();};
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
    row.onmousedown=e=>{
      if (e.button !== 0) return;
      selected.clear();
      $$('.sheet tr.selected').forEach(r=>r.classList.remove('selected'));
      $$('.sheet tr.blank-row').forEach(r=>r.classList.remove('blank-selected'));
      row.classList.add('blank-selected');
      refreshSelection();
      const activeEditing = document.querySelector('input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing');
      if (activeEditing && !activeEditing.contains(e.target) && !e.target.closest('td')?.contains(activeEditing)) {
        deactivateAllEditingFields();
      }
      const field=e.target.closest('td')?.querySelector('[data-blank-cell]');
      selectionCell={blankOrder:Number(row.dataset.blankRow),key:field?.dataset?.blankCell||'service'};
      if (field) {
        activateSheetField(field);
        if (e.target !== field && typeof field.focus === 'function') {
          field.focus();
        }
      }
    };
    row.onclick=e=>{
      const field=e.target.closest('td')?.querySelector('[data-blank-cell]');
      if (field && !field.classList.contains('editing')) {
        activateSheetField(field);
        if (typeof field.focus === 'function') field.focus();
      }
    };
    row.ondblclick=e=>{
      selected.clear();
      $$('.sheet tr.selected').forEach(r=>r.classList.remove('selected'));
      $$('.sheet tr.blank-row').forEach(r=>r.classList.remove('blank-selected'));
      row.classList.add('blank-selected');
      refreshSelection();
      const field=e.target.closest('td')?.querySelector('[data-blank-cell]');
      if(field) {
        activateSheetField(field);
        if(typeof field.focus === 'function') field.focus();
        if(typeof field.select === 'function') field.select();
      }
    };
    row.oncontextmenu=e=>{
      e.preventDefault();
      selected.clear();
      $$('.sheet tr.selected').forEach(r=>r.classList.remove('selected'));
      $$('.sheet tr.blank-row').forEach(r=>r.classList.remove('blank-selected'));
      row.classList.add('blank-selected');
      refreshSelection();
      const blankOrder=Number(row.dataset.blankRow);
      selectionCell={blankOrder,key:'service'};
      const menu=$('#contextMenu')||document.createElement('div');
      menu.id='contextMenu';menu.className='context-menu';
      menu.innerHTML=`<button id="contextPasteBlank" ${rowClipboard.items.length?'':'disabled'}><span class="context-icon">📋</span><span>Paste row here</span><kbd>Ctrl+V</kbd></button>`+
        `<button id="contextAddMultiBlank"><span class="context-icon">➕</span><span>Add multiples…</span></button>`+
        `<div class="context-divider"></div>`+
        `<button id="contextUndoBlank" ${undoStack.length?'':'disabled'}><span class="context-icon">↶</span><span>Undo</span><kbd>Ctrl+Z</kbd></button>`+
        `<button id="contextRedoBlank" ${redoStack.length?'':'disabled'}><span class="context-icon">↷</span><span>Redo</span><kbd>Ctrl+Y</kbd></button>`;
      positionContextMenu(menu, e.clientX, e.clientY);
      if($('#contextPasteBlank'))$('#contextPasteBlank').onclick=()=>{menu.remove();pasteCopiedRows(null,blankOrder);};
      if($('#contextAddMultiBlank'))$('#contextAddMultiBlank').onclick=()=>{menu.remove();addMultiplesDialog();};
      if($('#contextUndoBlank'))$('#contextUndoBlank').onclick=()=>{menu.remove();undo();};
      if($('#contextRedoBlank'))$('#contextRedoBlank').onclick=()=>{menu.remove();redo();};
      setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);
    };
  });
  $$('[data-blank-cell]').forEach(el=>{
    el.onchange=()=>materializeBlankRow(el);
    el.onpaste=e=>pasteBlankGrid(e,el);
    el.addEventListener('focus', () => {
      if (el.readOnly || !el.classList.contains('editing')) {
        activateSheetField(el);
      }
    });
  });
  $$('[data-group-collapse]').forEach(b=>b.onclick=()=>{const id=b.dataset.groupCollapse;collapsedGroups.has(id)?collapsedGroups.delete(id):collapsedGroups.add(id);render();});
  $$('[data-group-add]').forEach(b=>b.onclick=()=>{const group=data.projectGroups.find(g=>g.id===b.dataset.groupAdd);if(!group)return;const item=newItem(group.clientId,clientItems(group.clientId).length);item.projectGroupId=group.id;mutate('items',item);setTimeout(()=>{const row=document.querySelector(`[data-row="${item.id}"]`);row?.scrollIntoView({block:'center'});const field=row?.querySelector('[data-cell="service"]');if(field)activateSheetField(field);},60);});
  $$('[data-group-rename]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.groupRename.split(':');renameGroup(kind,id);});
  $$('[data-group-deal]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.groupDeal.split(':');openGroupDealDialog(kind,id);});
  $$('[data-group-deal-card]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.groupDealCard.split(':');openGroupDealDialog(kind,id);});
  $$('[data-group-ungroup]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.groupUngroup.split(':');ungroupDialog(kind,id);});
  $$('[data-ungroup-card]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.ungroupCard.split(':');ungroupDialog(kind,id);});
  $$('.sheet-group-header').forEach(headerRow => {
    headerRow.oncontextmenu = e => {
      e.preventDefault();
      const targetGroup = headerRow.dataset.sheetGroup || headerRow.querySelector('[data-group-collapse]')?.dataset?.groupCollapse;
      if (!targetGroup) return;
      const [kind, id] = targetGroup.split(':');
      const table = kind === 'project' ? 'projectGroups' : 'groups';
      const group = (data[table] || []).find(g => g.id === id);
      if (!group) return;

      const groupItems = (data.items || []).filter(i => (kind === 'project' ? i.projectGroupId : i.groupId) === id && i.status !== 'discarded');
      const canMarkSent = groupItems.length > 0 && groupItems.some(i => !['sent', 'paid'].includes(i.status));
      const canMarkPaid = groupItems.length > 0 && groupItems.some(i => i.status !== 'paid');

      const isGroupPaid = groupItems.length > 0 && groupStatus(groupItems) === 'Paid';
      const menu = $('#contextMenu') || document.createElement('div');
      menu.id = 'contextMenu';
      menu.className = 'context-menu';
      menu.innerHTML = `
        <button id="contextGroupUngroup"><span class="context-icon">⎘</span><span>Ungroup ${kind === 'project' ? 'project' : 'deal'}</span></button>
        ${isGroupPaid ? '' : `<button id="contextGroupDeal"><span class="context-icon">🏷️</span><span>Group deal…</span></button>`}
        <button id="contextGroupRename"><span class="context-icon">✏️</span><span>Rename group</span></button>
        <div class="context-divider"></div>
        ${kind === 'project' ? `<button id="contextGroupAddRow"><span class="context-icon">➕</span><span>Add row in project</span></button>` : ''}
        ${isGroupPaid ? '' : `<button id="contextGroupMarkSent" ${canMarkSent ? '' : 'disabled'}><span class="context-icon">✓</span><span>Mark all sent</span></button>`}
        ${isGroupPaid ? '' : `<button id="contextGroupMarkPaid" ${canMarkPaid ? '' : 'disabled'}><span class="context-icon">₹</span><span>Mark all paid</span></button>`}
        <button id="contextGroupPaidDate"><span class="context-icon">📅</span><span>Set paid date…</span></button>
      `;
      positionContextMenu(menu, e.clientX, e.clientY);

      $('#contextGroupUngroup').onclick = () => { menu.remove(); ungroupDialog(kind, id); };
      if ($('#contextGroupDeal')) $('#contextGroupDeal').onclick = () => { menu.remove(); openGroupDealDialog(kind, id); };
      $('#contextGroupRename').onclick = () => { menu.remove(); renameGroup(kind, id); };
      if ($('#contextGroupAddRow')) {
        $('#contextGroupAddRow').onclick = () => {
          menu.remove();
          const item = newItem(group.clientId, clientItems(group.clientId).length);
          item.projectGroupId = group.id;
          mutate('items', item);
          setTimeout(() => {
            const row = document.querySelector(`[data-row="${item.id}"]`);
            row?.scrollIntoView({ block: 'center' });
            const field = row?.querySelector('[data-cell="service"]');
            if (field) activateSheetField(field);
          }, 60);
        };
      }
      $('#contextGroupMarkSent').onclick = () => {
        menu.remove();
        const rows = groupItems.filter(i => !['sent', 'paid'].includes(i.status));
        if (rows.length) bulkSetStatus('sent', rows.map(i => i.id), { kind, id, label: group.label });
      };
      $('#contextGroupMarkPaid').onclick = () => {
        menu.remove();
        const rows = groupItems.filter(i => i.status !== 'paid');
        if (rows.length) bulkSetStatus('paid', rows.map(i => i.id), { kind, id, label: group.label });
      };
      $('#contextGroupPaidDate').onclick = () => { menu.remove(); setGroupPaidDateDialog(kind, id); };
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    };
  });
  $$('[data-group-status]').forEach(b=>b.onclick=()=>{const [kind,id,status]=b.dataset.groupStatus.split(':');const group=(kind==='project'?data.projectGroups:data.groups).find(g=>g.id===id);if(!group)return;const rows=data.items.filter(i=>(kind==='project'?i.projectGroupId:i.groupId)===id&&i.status!=='discarded'&&(status==='paid'?i.status!=='paid':!['sent','paid'].includes(i.status)));if(!rows.length){if(status==='paid'){setGroupPaidDateDialog(kind,id);return;}toast('Group is already '+status);return;}bulkSetStatus(status,rows.map(i=>i.id),{kind,id,label:group.label});});
  $$('[data-group-paid-date]').forEach(b=>{b.onclick=()=>{const [kind,id]=b.dataset.groupPaidDate.split(':');setGroupPaidDateDialog(kind,id);};});
  $$('[data-receipt-date]').forEach(b=>b.onclick=()=>modifyReceiptDateDialog(b.dataset.receiptDate));
  $$('[data-receipt-delete]').forEach(b=>b.onclick=()=>deleteReceiptDialog(b.dataset.receiptDelete));
  $$('[data-receipt-jump]').forEach(b=>b.onclick=()=>jumpToReceiptWorksheet(b.dataset.receiptJump));
  $$('[data-receipt-ungroup]').forEach(b=>b.onclick=()=>jumpAndUngroupReceipt(b.dataset.receiptUngroup));
  // Fixed blankRows buffer prevents disruptive DOM destruction and layout freezing during fast scrolling
  $$('[data-group-edit]').forEach(b=>b.onclick=()=>groupDialog(b.dataset.groupEdit));
  $$('[data-rename-card]').forEach(b=>{const card=b.closest('.group-card');card.querySelector('[data-open-group]').hidden=true;const topActions=card.querySelector('.group-card-top-actions');if(topActions)topActions.hidden=true;b.hidden=true;const editor=card.querySelector('.group-card-editor');editor.hidden=false;const input=editor.querySelector('input');if (typeof input.focus === 'function') input.focus();input.select();});
  $$('[data-cancel-card]').forEach(b=>{const card=b.closest('.group-card');card.querySelector('.group-card-editor').hidden=true;card.querySelector('[data-open-group]').hidden=false;const topActions=card.querySelector('.group-card-top-actions');if(topActions)topActions.hidden=false;card.querySelector('[data-rename-card]').hidden=false;});
  $$('[data-save-card]').forEach(b=>{const saveName=()=>{const [kind,id]=b.dataset.saveCard.split(':'),table=kind==='project'?'projectGroups':'groups',group=data[table].find(g=>g.id===id),name=b.closest('.group-card-editor').querySelector('input').value.trim();if(!group)return;if(!name){toast('Enter a group name');return;}if(name===group.label){b.closest('.group-card-editor').querySelector('[data-cancel-card]').click();return;}const scroll=$('#main').scrollTop;group.label=name;mutate(table,group);$('#main').scrollTop=scroll;toast('Group renamed');};b.onclick=saveName;b.closest('.group-card-editor').querySelector('input').onkeydown=e=>{if(e.key==='Enter')saveName();if(e.key==='Escape')b.closest('.group-card-editor').querySelector('[data-cancel-card]').click();};});
  $$('[data-open-group]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.openGroup.split(':');const group=(kind==='project'?data.projectGroups:data.groups).find(g=>g.id===id);if(!group)return;activeClient=group.clientId;filter='all';collapsedGroups.delete(kind+':'+id);tab='sheet';render();setTimeout(()=>document.querySelector(`[data-group-collapse="${kind}:${id}"]`)?.scrollIntoView({block:'center'}),50);});
  $$('[data-goal-pending]').forEach(b => b.onclick = () => {
    const [kind, id] = b.dataset.goalPending.split(':');
    const table = kind === 'project' ? 'projectGroups' : 'groups';
    const group = (data[table] || []).find(g => g.id === id);
    if (!group) return;
    activeClient = group.clientId;
    filter = 'all';
    collapsedGroups.delete(kind + ':' + id);
    selected.clear();
    const pendingItems = (data.items || []).filter(i => (kind === 'project' ? i.projectGroupId : i.groupId) === id && !['sent', 'paid', 'discarded'].includes(i.status));
    pendingItems.forEach(i => selected.add(i.id));
    tab = 'sheet';
    render();
    setTimeout(() => {
      const targetEl = pendingItems.length ? document.querySelector(`[data-row="${pendingItems[0].id}"]`) : document.querySelector(`[data-sheet-group="${kind}:${id}"]`);
      targetEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  });
  $$('[data-goal-sheet]').forEach(b => b.onclick = () => {
    const [kind, id] = b.dataset.goalSheet.split(':');
    const table = kind === 'project' ? 'projectGroups' : 'groups';
    const group = (data[table] || []).find(g => g.id === id);
    if (!group) return;
    activeClient = group.clientId;
    filter = 'all';
    collapsedGroups.delete(kind + ':' + id);
    selected.clear();
    tab = 'sheet';
    render();
    setTimeout(() => {
      const headerRow = document.querySelector(`[data-sheet-group="${kind}:${id}"]`);
      headerRow?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  });
  $$('[data-goal-filter]').forEach(b => b.onclick = () => {
    goalFilter = b.dataset.goalFilter;
    render();
  });
  const goalSearch = $('#goalSearchInput');
  if (goalSearch) {
    goalSearch.oninput = () => {
      goalSearchQuery = goalSearch.value.trim().toLowerCase();
      render();
      const nextInput = $('#goalSearchInput');
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
    };
  }
  $$('[data-billing-edit]').forEach(b=>b.onclick=()=>billingDialog(b.dataset.billingEdit));
  $$('[data-jump-rentals]').forEach(b => b.onclick = () => { tab = 'rentals'; render(); });
  if (tab === 'rentals') {
    bindRentals();
  }
  $$('[data-open-notice-board]').forEach(b => b.onclick = () => { tab = 'tasks'; render(); });
  $$('[data-dashboard-add-task]').forEach(b => b.onclick = () => { openTaskModal(); });
  $$('[data-task-jump]').forEach(b => b.onclick = () => {
    const tid = b.dataset.taskJump;
    tab = 'tasks';
    render();
    setTimeout(() => {
      const el = document.querySelector(`[data-task-id="${tid}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.classList.add('group-highlight-flash');
      setTimeout(() => el?.classList.remove('group-highlight-flash'), 2500);
    }, 80);
  });
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
  const count=$('#selectedCount');if(count)count.innerHTML=selectionLabelHtml();
  const bulk=$('#bulkStatus');if(bulk)bulk.disabled=!selected.size;
  for(const action of ['assign','complete','invoice','share-chat','delete']){const button=$(`[data-action="${action}"]`);if(button)button.disabled=!selected.size;}
  const group=$('[data-action="group"]');if(group)group.disabled=selected.size<2;
  const project=$('[data-action="project-group"]');if(project)project.disabled=!selected.size;
  const ungroup=$('[data-action="ungroup"]');if(ungroup)ungroup.disabled=!hasGroupedSelected();
  const insertAbove=$('[data-action="insert-above"]');if(insertAbove)insertAbove.disabled=selected.size!==1;
  const insertBelow=$('[data-action="insert-below"]');if(insertBelow)insertBelow.disabled=selected.size!==1;
  updateUndoRedoUI();
}
function clearCellDragHighlights() {
  $$('.cell-fill-drag').forEach(el => el.classList.remove('cell-fill-drag'));
  $$('.row-fill-drag').forEach(el => el.classList.remove('row-fill-drag'));
}

function handleRowDragStart(rowId, e = {}) {
  isRowDragSelecting = true;
  hasRowDragged = false;
  dragStartRowId = rowId;
  dragTargetRowId = rowId;
  dragStartShift = !!e.shiftKey;
  dragStartWithCtrl = !!(e.ctrlKey || e.metaKey);
  dragInitialSelected = dragStartWithCtrl ? new Set(selected) : new Set();

  const targetTd = e.target?.closest?.('td');
  const field = targetTd?.querySelector?.('[data-cell]');
  const isRowSelector = !!targetTd?.classList?.contains('row-selector');

  if (isRowSelector || field?.dataset?.cell === 'serial') {
    dragStartCellKey = null;
  } else {
    dragStartCellKey = field?.dataset?.cell || null;
  }

  if (e.shiftKey && selectionAnchor) {
    selectSheetRow(rowId, true, false);
  } else if (dragStartWithCtrl) {
    if (selected.has(rowId)) {
      selected.delete(rowId);
    } else {
      selected.add(rowId);
    }
    selectionAnchor = rowId;
    refreshSelection();
  } else {
    selected.clear();
    selected.add(rowId);
    selectionAnchor = rowId;
    refreshSelection();
  }

  if (typeof document !== 'undefined' && document.body?.classList) {
    document.body.classList.add('row-drag-selecting');
  }
}

function handleRowDragOver(targetRowId, e = {}) {
  if (!isRowDragSelecting || !dragStartRowId || !targetRowId) return;

  if (targetRowId !== dragStartRowId) {
    hasRowDragged = true;
    deactivateAllEditingFields();
  }
  dragTargetRowId = targetRowId;
  if (e.shiftKey) dragStartShift = true;

  const allRowIds = $$('[data-row]').map(r => r.dataset.row);
  const startIdx = allRowIds.indexOf(dragStartRowId);
  const currentIdx = allRowIds.indexOf(targetRowId);

  if (startIdx !== -1 && currentIdx !== -1) {
    const minIdx = Math.min(startIdx, currentIdx);
    const maxIdx = Math.max(startIdx, currentIdx);
    const rangeIds = allRowIds.slice(minIdx, maxIdx + 1);

    if (dragStartWithCtrl) {
      selected = new Set([...dragInitialSelected, ...rangeIds]);
    } else {
      selected = new Set(rangeIds);
    }
    refreshSelection();
    clearCellDragHighlights();
  }
}

function handleRowDragEnd(e = {}) {
  if (isRowDragSelecting) {
    isRowDragSelecting = false;
    if (typeof document !== 'undefined' && document.body?.classList) {
      document.body.classList.remove('row-drag-selecting');
    }
    clearCellDragHighlights();

    if (hasRowDragged && dragStartRowId && dragTargetRowId && dragStartRowId !== dragTargetRowId) {
      justDraggedSelection = true;
      setTimeout(() => { justDraggedSelection = false; }, 150);

      const allRowIds = $$('[data-row]').map(r => r.dataset.row);
      const startIdx = allRowIds.indexOf(dragStartRowId);
      const currentIdx = allRowIds.indexOf(dragTargetRowId);

      if (startIdx !== -1 && currentIdx !== -1) {
        const minIdx = Math.min(startIdx, currentIdx);
        const maxIdx = Math.max(startIdx, currentIdx);
        const rangeIds = allRowIds.slice(minIdx, maxIdx + 1);

        // Safe Excel-style row range selection: strictly selects rows, NEVER overwrites data!
        selected = new Set(rangeIds);
        selectionAnchor = dragStartRowId;
        refreshSelection();
      }
    }

    dragStartRowId = null;
    dragTargetRowId = null;
    dragStartCellKey = null;
    dragStartShift = false;
    dragInitialSelected = null;
  }
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
function deactivateAllEditingFields(exceptEl = null) {
  const editings = document.querySelectorAll('input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing');
  editings.forEach(el => {
    if (exceptEl && el === exceptEl) return;
    const isInput = el.tagName === 'INPUT';
    const val = el.value ?? '';
    el.classList.remove('editing');
    if (isInput) {
      el.readOnly = true;
    } else {
      el.style.pointerEvents = '';
      el.tabIndex = -1;
    }
    if (document.activeElement === el && typeof el.blur === 'function') {
      try { el.blur(); } catch {}
    }
    if (el.dataset.id && el.dataset.cell) {
      const it = (data.items || []).find(x => x.id === el.dataset.id);
      if (it && String(it[el.dataset.cell] ?? '') !== String(val)) {
        editCell(el.dataset.id, el.dataset.cell, val, true);
      }
    } else if (el.dataset.blankOrder && el.dataset.blankCell && val.trim()) {
      materializeBlankRow(el);
    }
  });
  if (isDeferredRemotePull) {
    isDeferredRemotePull = false;
    setTimeout(() => { if (typeof pullRemote === 'function') pullRemote().catch(() => {}); }, 300);
  }
}

const SHEET_EDIT_COLS = ['workDate', 'service', 'quantity', 'rate', 'quotedTotal', 'advanceAmount', 'remarks'];

function activateSheetField(field) {
  if (!field) return;
  deactivateAllEditingFields(field);
  if (field.tagName === 'INPUT') {
    field.readOnly = false;
    field.classList.add('editing');
    if (typeof field.focus === 'function') field.focus();
    field.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const currentTr = field.closest('tr');
        const cellKey = field.dataset.cell || field.dataset.blankCell;
        deactivateAllEditingFields();
        const nextTr = currentTr?.nextElementSibling;
        if (nextTr) {
          const nextField = nextTr.querySelector(`[data-cell="${cellKey}"], [data-blank-cell="${cellKey}"]`);
          if (nextField) {
            activateSheetField(nextField);
            if (typeof nextField.select === 'function') nextField.select();
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const currentTr = field.closest('tr');
        const cellKey = field.dataset.cell || field.dataset.blankCell;
        const colIdx = SHEET_EDIT_COLS.indexOf(cellKey);
        deactivateAllEditingFields();
        if (colIdx >= 0) {
          const delta = e.shiftKey ? -1 : 1;
          const nextIdx = colIdx + delta;
          if (nextIdx >= 0 && nextIdx < SHEET_EDIT_COLS.length) {
            const nextKey = SHEET_EDIT_COLS[nextIdx];
            const nextField = currentTr.querySelector(`[data-cell="${nextKey}"], [data-blank-cell="${nextKey}"]`);
            if (nextField) {
              activateSheetField(nextField);
              if (typeof nextField.select === 'function') nextField.select();
            }
          } else if (!e.shiftKey && nextIdx >= SHEET_EDIT_COLS.length) {
            const nextTr = currentTr.nextElementSibling;
            if (nextTr) {
              const nextField = nextTr.querySelector(`[data-cell="${SHEET_EDIT_COLS[0]}"], [data-blank-cell="${SHEET_EDIT_COLS[0]}"]`);
              if (nextField) {
                activateSheetField(nextField);
                if (typeof nextField.select === 'function') nextField.select();
              }
            }
          } else if (e.shiftKey && nextIdx < 0) {
            const prevTr = currentTr.previousElementSibling;
            if (prevTr) {
              const lastKey = SHEET_EDIT_COLS[SHEET_EDIT_COLS.length - 1];
              const prevField = prevTr.querySelector(`[data-cell="${lastKey}"], [data-blank-cell="${lastKey}"]`);
              if (prevField) {
                activateSheetField(prevField);
                if (typeof prevField.select === 'function') prevField.select();
              }
            }
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (field.dataset.id && field.dataset.cell) {
          const it = (data.items || []).find(x => x.id === field.dataset.id);
          if (it) field.value = it[field.dataset.cell] ?? '';
        } else if (field.dataset.blankCell) {
          field.value = '';
        }
        field.classList.remove('editing');
        field.readOnly = true;
        field.blur();
      }
    };
    field.onblur = () => {
      if (field.classList.contains('editing')) {
        deactivateAllEditingFields();
      }
    };
  } else {
    field.style.pointerEvents = 'auto';
    field.tabIndex = 0;
    field.classList.add('editing');
    if (typeof field.focus === 'function') field.focus();
    try { field.showPicker?.(); } catch {}
    field.onblur = () => {
      field.style.pointerEvents = '';
      field.tabIndex = -1;
      field.classList.remove('editing');
    };
  }
}
function materializeBlankRow(field, targetNextKey = null) {
  const value=field.value.trim();if(!value)return;
  const order=Number(field.dataset.blankOrder),key=field.dataset.blankCell;
  const item=newItem(activeClient,order);
  item[key]=['quantity','rate','quotedTotal','advanceAmount'].includes(key)?Math.max(0,num(value)):value;
  if(key==='quotedTotal')item.manualTotal=true;
  if(key==='rate'||key==='quantity')item.quotedTotal=num(item.quantity)*num(item.rate);
  mutate('items',item);
  const client = data.clients?.find(c => c.id === activeClient);
  if (typeof logActivity === 'function') {
    logActivity('add', `Added row: "${item.service || 'Row'}" in ${client?.name || 'client'}`, {
      item: JSON.parse(JSON.stringify(item)),
      clientId: activeClient,
      clientName: client?.name || ''
    });
  }
  const nextKey = targetNextKey || (key === 'service' ? 'rate' : key);
  setTimeout(() => {
    const rowEl = document.querySelector(`[data-row="${item.id}"]`);
    if (rowEl) {
      const nextField = rowEl.querySelector(`[data-cell="${nextKey}"]`);
      if (nextField) {
        activateSheetField(nextField);
        if (typeof nextField.focus === 'function') nextField.focus();
        if (typeof nextField.select === 'function') nextField.select();
      }
    }
  }, 20);
}
function pasteBlankGrid(event,field) {
  const raw=event.clipboardData.getData('text/plain');if(!raw)return;event.preventDefault();
  pushUndo('Paste rows');
  const columns=['serial','workDate','service','quantity','rate','quotedTotal','status','advanceAmount','assigneeId','remarks'];
  let start=columns.indexOf(field.dataset.blankCell);
  const startOrder=Number(field.dataset.blankOrder);
  const lines = raw.trimEnd().split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return;

  const firstCols = lines[0].split('\t');
  if (firstCols.length >= 4 || (/^\d+$/.test(firstCols[0].trim()) && firstCols.length >= 2)) {
    start = 0;
  }
  if (start < 0) start = 2;

  const added = [];
  for(const [offset,line] of lines.entries()){
    const item=newItem(activeClient,startOrder+offset);
    line.split('\t').forEach((value,index)=>{
      const key=columns[start+index];
      if(!key)return;
      item[key]=['quantity','rate','quotedTotal','advanceAmount'].includes(key)?Math.max(0,num(value)):key==='status'?(value.trim()==='-'?'discarded':value.trim().toLowerCase()||'pending'):value;
    });
    if(!line.split('\t').some((_,index)=>columns[start+index]==='quotedTotal'))item.quotedTotal=num(item.quantity)*num(item.rate);
    data.items.push(item);added.push(item);if(item.status==='paid'){recordPaidItems([{...item,status:'pending'}]);item.paidAt=today();item.paidAtTs=new Date().toISOString();}if(num(item.advanceAmount)>0&&item.status!=='paid'){createReceipt(item.clientId,num(item.advanceAmount),`Advance · ${item.service}`,'advance',item.id);item.advanceReceivedAt=today();}enqueue('items',item.id);
  }
  const client = data.clients?.find(c => c.id === activeClient);
  if (added.length && typeof logActivity === 'function') {
    logActivity('paste', `Pasted ${added.length} row${added.length === 1 ? '' : 's'} via grid into ${client?.name || 'client'}`, {
      items: added.map(i => JSON.parse(JSON.stringify(i))),
      clientId: activeClient,
      clientName: client?.name || ''
    });
  }
  save();scheduleSync();render();
}
function editCell(id, key, value, skipRender = false) {
  const i=data.items.find(x=>x.id===id); if(!i)return;
  if(key==='status'){bulkSetStatus(value,[id]);return;}
  if(['quantity','rate','quotedTotal','advanceAmount'].includes(key)) value=Math.max(0,num(value));
  if(key==='advanceAmount'&&value>num(i.advanceAmount))createReceipt(i.clientId,value-num(i.advanceAmount),`Advance · ${i.service}`,'advance',i.id);
  if(key==='advanceAmount'&&value>0&&!i.advanceReceivedAt)i.advanceReceivedAt=today();
  if(i[key] !== value) {
    const prevItem = JSON.parse(JSON.stringify(i));
    const prevVal = i[key];
    i[key]=value;
    if(key==='quantity'||key==='rate') { i.manualTotal=false; i.quotedTotal=num(i.quantity)*num(i.rate); }
    if(key==='quotedTotal')i.manualTotal=true;
    const client = data.clients?.find(c => c.id === i.clientId);
    if (typeof logActivity === 'function') {
      logActivity('update', `Updated ${key} on "${i.service || 'Row'}" (${prevVal ?? 'empty'} → ${value}) in ${client?.name || 'client'}`, {
        itemId: id,
        field: key,
        previousValue: prevVal,
        newValue: value,
        previousItem: prevItem,
        item: JSON.parse(JSON.stringify(i)),
        clientId: i.clientId,
        clientName: client?.name || ''
      });
    }
  }
  if(skipRender) {
    i.updatedAt = new Date().toISOString();
    queue('items', i.id);
    const rowEl = document.querySelector(`[data-row="${id}"]`);
    if (rowEl) {
      const input = rowEl.querySelector(`[data-cell="${key}"]`);
      if (input && input.value !== String(value)) input.value = value;
      if (key === 'quantity' || key === 'rate') {
        const totalInput = rowEl.querySelector('[data-cell="quotedTotal"]');
        if (totalInput) totalInput.value = i.quotedTotal;
      }
    }
    refreshSelection();
    updateGroupHeaderDOM(i);
  } else {
    mutate('items',i);
  }
  if(i.status==='paid'||data.receipts?.some(r=>(r.referenceKind==='item'&&r.referenceId===i.id)||(r.source==='app'&&r.sourceKey==='app:'+i.id))) {
    syncItemReceipt(i);
  }
}
function pasteGrid(e,el) {
  const text=e.clipboardData.getData('text/plain'); if(!text.includes('\t')&&!text.includes('\n'))return;
  pushUndo('Paste from clipboard');
  e.preventDefault();
  const columns=['serial','workDate','service','quantity','rate','quotedTotal','status','advanceAmount','assigneeId','remarks'];
  let startCol=columns.indexOf(el.dataset.cell);
  if(startCol<0)return;
  const rows=text.trimEnd().split(/\r?\n/).map(r=>r.split('\t'));
  if (rows[0].length >= 5 && (/^\d+$/.test(rows[0][0].trim()) || /^\d{4}-\d{2}-\d{2}$/.test(rows[0][1]?.trim()))) {
    startCol = 0;
  }
  const items=groupedSheetItems(clientItems());
  let start=items.findIndex(i=>i.id===el.dataset.id);
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

  const deleteSet = new Set(targetIds);
  const deletedItems = data.items.filter(i => deleteSet.has(i.id)).map(i => JSON.parse(JSON.stringify(i)));

  data.pendingDeletes ||= [];
  targetIds.forEach(id => {
    if (!data.pendingDeletes.some(d => d.table === 'items' && d.id === id)) {
      data.pendingDeletes.push({ table: 'items', id });
    }
    data.pending = data.pending.filter(p => !(p.table === 'items' && p.id === id));
  });

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

  const client = data.clients?.find(c => c.id === activeClient);
  if (typeof logActivity === 'function') {
    logActivity('delete', count === 1 ? `Deleted row: "${deletedItems[0]?.service || 'Row'}" in ${client?.name || 'client'}` : `Deleted ${count} rows in ${client?.name || 'client'}`, {
      items: deletedItems,
      clientId: activeClient,
      clientName: client?.name || ''
    });
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

  const allItems = clientItems(activeClient);
  const isBlankTarget = targetBlankOrder != null || (targetId == null && !selected.size);

  let targetIndex = -1;
  if (!isBlankTarget && targetId) {
    targetIndex = allItems.findIndex(i => i.id === targetId);
  } else if (!isBlankTarget && selected.size) {
    const firstSelected = [...selected][0];
    targetIndex = allItems.findIndex(i => i.id === firstSelected);
  }

  const copiedItems = rowClipboard.items;
  const addedItems = [];
  const modifiedItems = [];
  const previousItems = [];

  copiedItems.forEach((copied, offset) => {
    const destIndex = targetIndex + offset;
    let target = isBlankTarget ? null : allItems[destIndex];
    if (!target) {
      target = newItem(activeClient, allItems.length);
      allItems.push(target);
      data.items.push(target);
      addedItems.push(target);
    } else {
      previousItems.push({ ...target });
      modifiedItems.push(target);
    }
    target.service = copied.service || '';
    target.quantity = copied.quantity != null ? copied.quantity : 1;
    target.rate = copied.rate != null ? copied.rate : 0;
    target.quotedTotal = copied.quotedTotal != null ? copied.quotedTotal : (num(target.quantity) * num(target.rate));
    target.manualTotal = !!copied.manualTotal;
    target.status = copied.status || 'pending';
    target.advanceAmount = copied.advanceAmount || 0;
    target.assigneeId = copied.assigneeId || '';
    target.remarks = copied.remarks || '';
    target.dueDate = copied.dueDate || '';
    target.updatedAt = new Date().toISOString();
    enqueue('items', target.id);
  });

  // Re-index serials cleanly (1, 2, 3...)
  const updatedAll = clientItems(activeClient);
  updatedAll.forEach((it, idx) => {
    it.sortOrder = idx;
    if (it.serial && !isNaN(Number(it.serial))) {
      it.serial = String(idx + 1);
    }
    enqueue('items', it.id);
  });

  if (isCut && rowClipboard.sourceRowIds.length) {
    rowClipboard.sourceRowIds.forEach(srcId => {
      if (copiedItems.some((_, o) => allItems[targetIndex + o]?.id === srcId)) return;
      const src = data.items.find(i => i.id === srcId);
      if (src) {
        src.service = '';
        src.quantity = 1;
        src.rate = 0;
        src.quotedTotal = 0;
        src.manualTotal = false;
        src.status = 'pending';
        src.advanceAmount = 0;
        src.assigneeId = '';
        src.remarks = '';
        src.dueDate = '';
        src.updatedAt = new Date().toISOString();
        enqueue('items', src.id);
      }
    });
    rowClipboard.mode = 'copy';
    rowClipboard.sourceRowIds = [];
    $$('[data-row]').forEach(r => r.classList.remove('row-cut-pending'));
    toast('Row moved (pasted from cut)');
  } else {
    toast(copiedItems.length === 1 ? 'Row pasted (Ctrl+V)' : `${copiedItems.length} rows pasted`);
  }

  selected.clear();
  if (addedItems.length) {
    addedItems.forEach(i => selected.add(i.id));
    selectionCell = { id: addedItems[0].id, key: 'service' };
  } else if (modifiedItems.length) {
    modifiedItems.forEach(i => selected.add(i.id));
    selectionCell = { id: modifiedItems[0].id, key: 'service' };
  }

  const client = data.clients?.find(c => c.id === activeClient);
  if (typeof logActivity === 'function') {
    if (addedItems.length) {
      logActivity('paste', `Pasted ${addedItems.length} new row${addedItems.length === 1 ? '' : 's'} (${addedItems.map(i => i.service || 'Row').join(', ')}) in ${client?.name || 'client'}`, {
        items: addedItems.map(i => JSON.parse(JSON.stringify(i))),
        clientId: activeClient,
        clientName: client?.name || ''
      });
    } else if (modifiedItems.length) {
      logActivity('paste', `Pasted over ${modifiedItems.length} row${modifiedItems.length === 1 ? '' : 's'} in ${client?.name || 'client'}`, {
        items: modifiedItems.map(i => JSON.parse(JSON.stringify(i))),
        previousItems,
        clientId: activeClient,
        clientName: client?.name || ''
      });
    }
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

function getNextWorksheetSerial(clientId = activeClient) {
  const existing = clientItems(clientId);
  if (!existing.length) return 1;
  let maxSerial = 0;
  for (const it of existing) {
    const s = cleanSerial(it.serial);
    const n = parseInt(s, 10);
    if (!isNaN(n) && n > maxSerial) maxSerial = n;
  }
  return Math.max(existing.length + 1, maxSerial + 1);
}

function parseMultiRowLine(rawLine, nextSerial = 1, defaultDate = today(), defaultStatus = 'pending') {
  if (!rawLine || !rawLine.trim()) return null;

  let text = rawLine.trim();

  // 1. Check for tab-separated (TSV spreadsheet paste)
  if (text.includes('\t')) {
    const cols = text.split('\t').map(c => c.trim());
    if (cols.length >= 2) {
      let workDate = defaultDate;
      let service = '';
      let qty = 1;
      let rate = 0;
      let total = 0;
      let status = defaultStatus;
      let remarks = '';

      let startIdx = 0;
      if (/^\d+$/.test(cols[0]) && cols.length >= 3) {
        startIdx = 1;
      }
      if (validDate(cols[startIdx])) {
        workDate = validDate(cols[startIdx]);
        startIdx++;
      }

      const rest = cols.slice(startIdx);
      if (rest.length === 1) {
        service = rest[0];
      } else if (rest.length === 2) {
        service = rest[0];
        const val = num(rest[1]);
        rate = val;
        total = val;
      } else if (rest.length >= 3) {
        service = rest[0];
        qty = num(rest[1]) || 1;
        rate = num(rest[2]);
        total = qty * rate;
        if (rest[3] && !isNaN(num(rest[3]))) total = num(rest[3]);
        if (rest[4]) status = rest[4].toLowerCase();
        if (rest[5]) remarks = rest[5];
      }

      return {
        serial: cleanSerial(String(nextSerial)),
        workDate,
        service: service || 'Service',
        quantity: qty,
        rate,
        quotedTotal: total,
        status: ['pending', 'working', 'changes', 'sent', 'paid', 'discarded'].includes(status) ? status : defaultStatus,
        remarks
      };
    }
  }

  // 2. Strip leading list numbering/bullets (e.g. "1. ", "1) ", "1 - ", "* ", "- ")
  const numPrefixMatch = text.match(/^(\d+)[\.\)\-:]\s+(.+)$/);
  if (numPrefixMatch) {
    text = numPrefixMatch[2].trim();
  } else {
    text = text.replace(/^[-*•]\s+/, '').trim();
  }

  // 3. Extract bracketed remarks at the end e.g. (approved by client) or [urgent]
  let remarks = '';
  const remarksMatch = text.match(/\s*[\(\[]([^\)\]]+)[\)\]]\s*$/);
  if (remarksMatch) {
    remarks = remarksMatch[1].trim();
    text = text.slice(0, remarksMatch.index).trim();
  }

  // 4. Check for leading date e.g. "2026-10-31 - Service..." or "31-10-2026 Service..."
  let workDate = defaultDate;
  const datePrefixMatch = text.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*[-–—:\s]\s*(.+)$/);
  if (datePrefixMatch) {
    const parsedD = validDate(datePrefixMatch[1]);
    if (parsedD) {
      workDate = parsedD;
      text = datePrefixMatch[2].trim();
    }
  }

  let service = text;
  let qty = 1;
  let rate = 0;
  let total = 0;
  let status = defaultStatus;

  // 5. Pattern A: Qty x Rate (e.g. "HALDI - FLOOR FLEX 2 × 400", "3D CARNIVAL 1 × 13,500", "Arch 2 * 400", "Console 2 @ 400")
  const qtyRateMatch = text.match(/^(.*?)(?:[-–—:,|/\s]+|\s+)(\d+(?:\.\d+)?)\s*(?:[xX*×@]|nos?\.?\s*@?)\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*$/i);
  if (qtyRateMatch && qtyRateMatch[1].trim()) {
    service = qtyRateMatch[1].trim();
    qty = num(qtyRateMatch[2]) || 1;
    rate = num(qtyRateMatch[3].replace(/,/g, ''));
    total = qty * rate;
  } else {
    // 6. Pattern B: Comma or pipe separated: "HALDI - FLOOR FLEX, 2, 400"
    if (text.includes(',') || text.includes('|')) {
      const parts = text.split(/[,|]/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3 && !isNaN(num(parts[parts.length - 2])) && !isNaN(num(parts[parts.length - 1]))) {
        rate = num(parts.pop().replace(/,/g, ''));
        qty = num(parts.pop()) || 1;
        service = parts.join(' ');
        total = qty * rate;
      } else if (parts.length === 2 && !isNaN(num(parts[1]))) {
        rate = num(parts[1].replace(/,/g, ''));
        qty = 1;
        service = parts[0];
        total = rate;
      }
    }

    // 7. Pattern C: Service followed by single amount (e.g. "Stage Design - 5000", "Mandap 12000/-", "Entrance: ₹15,000")
    if (!total && !rate) {
      const singleAmountMatch = text.match(/^(.*?)(?:[-–—:,|/\s]+|\s+)(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?$/i);
      if (singleAmountMatch && singleAmountMatch[1].trim()) {
        const parsedAmt = num(singleAmountMatch[2].replace(/,/g, ''));
        if (parsedAmt > 0) {
          service = singleAmountMatch[1].trim();
          qty = 1;
          rate = parsedAmt;
          total = parsedAmt;
        }
      }
    }
  }

  // Cleanup service name: strip trailing/leading punctuation
  service = service.replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '').trim();
  if (!service) service = 'Service';

  return {
    serial: cleanSerial(String(nextSerial)),
    workDate,
    service,
    quantity: qty,
    rate,
    quotedTotal: total,
    status,
    remarks
  };
}

function parseMultiRowText(rawText, startSerial = 1, defaultDate = today(), defaultStatus = 'pending') {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.split(/\r?\n/);
  const rows = [];
  let currentSerial = parseInt(startSerial, 10) || 1;

  for (const line of lines) {
    if (!line.trim()) continue;
    const row = parseMultiRowLine(line, currentSerial, defaultDate, defaultStatus);
    if (row) {
      rows.push(row);
      currentSerial++;
    }
  }
  return rows;
}

function addMultiplesDialog() {
  const client = currentClient();
  if (!client) {
    toast('Select a client first');
    return;
  }

  const nextSerial = getNextWorksheetSerial(activeClient);
  const defDate = today();
  const defStatus = 'pending';

  const bodyHtml = `
    <div class="multi-modal-wrap">
      <p class="multi-modal-desc">
        Paste your WhatsApp message, notes, or list below for <strong>${esc(client.name)}</strong>. Every new line is automatically detected as a new row.
      </p>

      <div class="multi-split-grid">
        <!-- Left: Input Pane -->
        <div class="multi-input-pane">
          <div class="multi-pane-header">
            <span class="multi-pane-title">Input Text</span>
            <button class="small-btn text-btn" id="multiClearBtn" style="padding:2px 8px; font-size:11px;">Clear</button>
          </div>
          <textarea id="multiRowInput" class="multi-textarea" placeholder="Paste formatted WhatsApp text here...

Examples:
LINE DRAWING - HALDI BALLROOM ENTRANCE ARCH 1 × 300
HALDI - FLOOR FLEX 2 × 400
HALDI - INSIDE CONSOLE 2 × 400
HALDI - SIGNAGE 3 × 100
3D CARNIVAL 1 × 13,500
Stage Design 5000
Mandap Setup - 12000/-
Passage Decor (night render)"></textarea>

          <div class="multi-controls-bar">
            <div class="multi-control-group">
              <label for="multiStartSerial">Start Serial #</label>
              <input id="multiStartSerial" type="number" min="1" value="${nextSerial}">
            </div>
            <div class="multi-control-group">
              <label for="multiDefaultDate">Default Date</label>
              <input id="multiDefaultDate" type="date" value="${defDate}">
            </div>
            <div class="multi-control-group">
              <label for="multiDefaultStatus">Default Status</label>
              <select id="multiDefaultStatus">
                <option value="pending" selected>Pending</option>
                <option value="working">Working</option>
                <option value="changes">Changes</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>

          <div class="multi-hint-box">
            💡 Supports WhatsApp formats like <code>2 × 400</code>, <code>1 x 13,500</code>, <code>@ 400</code>, single amounts like <code>5000</code> or <code>12000/-</code>, remarks in brackets <code>(render)</code>, and Excel tabs.
          </div>
        </div>

        <!-- Right: Live Preview Pane -->
        <div class="multi-preview-pane">
          <div class="multi-pane-header">
            <span class="multi-pane-title">Live Preview</span>
            <div class="multi-preview-badges" id="multiBadgesArea">
              <span class="multi-badge multi-badge-blue">0 rows</span>
              <span class="multi-badge multi-badge-green">₹0</span>
              <span class="multi-badge multi-badge-purple">Start #${nextSerial}</span>
            </div>
          </div>

          <div class="multi-table-wrap" id="multiPreviewContainer">
            <div class="multi-preview-empty">
              <p>No rows detected yet</p>
              <small>Paste or type formatted text on the left to see live preview.</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const footerHtml = `
    <div class="modal-actions" style="display:flex; justify-content:space-between; align-items:center;">
      <button class="small-btn" id="cancelMultiModal">Cancel</button>
      <button class="small-btn blue" id="insertMultiRowsBtn" disabled>Insert in Worksheet (0 rows)</button>
    </div>
  `;

  modal('Add Multiple Rows', bodyHtml, footerHtml, true);

  const inputEl = $('#multiRowInput');
  const startSerialEl = $('#multiStartSerial');
  const defaultDateEl = $('#multiDefaultDate');
  const defaultStatusEl = $('#multiDefaultStatus');
  const badgesEl = $('#multiBadgesArea');
  const previewContainer = $('#multiPreviewContainer');
  const insertBtn = $('#insertMultiRowsBtn');
  const cancelBtn = $('#cancelMultiModal');
  const clearBtn = $('#multiClearBtn');

  let currentParsedRows = [];

  function updatePreview() {
    const raw = inputEl.value;
    const startNum = parseInt(startSerialEl.value, 10) || nextSerial;
    const dDate = defaultDateEl.value || defDate;
    const dStatus = defaultStatusEl.value || defStatus;

    currentParsedRows = parseMultiRowText(raw, startNum, dDate, dStatus);
    const count = currentParsedRows.length;
    const totalAmount = currentParsedRows.reduce((sum, r) => sum + num(r.quotedTotal), 0);

    badgesEl.innerHTML = `
      <span class="multi-badge multi-badge-blue">${count} row${count === 1 ? '' : 's'}</span>
      <span class="multi-badge multi-badge-green">${money(totalAmount)}</span>
      <span class="multi-badge multi-badge-purple">Start #${startNum}</span>
    `;

    if (!count) {
      previewContainer.innerHTML = `
        <div class="multi-preview-empty">
          <p>No rows detected yet</p>
          <small>Paste or type formatted text on the left to see live preview.</small>
        </div>
      `;
      insertBtn.disabled = true;
      insertBtn.textContent = 'Insert in Worksheet (0 rows)';
    } else {
      let tableHtml = `
        <table class="multi-preview-table">
          <thead>
            <tr>
              <th style="text-align:center; width:36px;">SR</th>
              <th>DATE</th>
              <th>SERVICE</th>
              <th style="text-align:right;">QTY</th>
              <th style="text-align:right;">RATE</th>
              <th style="text-align:right;">TOTAL</th>
              <th>STATUS</th>
              <th>REMARKS</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const row of currentParsedRows) {
        tableHtml += `
          <tr>
            <td class="multi-preview-sr">${esc(row.serial)}</td>
            <td>${esc(fmtDate(row.workDate))}</td>
            <td class="multi-preview-service">${esc(row.service)}</td>
            <td class="multi-preview-num">${row.quantity}</td>
            <td class="multi-preview-num">${money(row.rate)}</td>
            <td class="multi-preview-total">${money(row.quotedTotal)}</td>
            <td><span class="pill ${row.status}">${esc(row.status[0].toUpperCase() + row.status.slice(1))}</span></td>
            <td><small style="color:#64748b;">${esc(row.remarks || '-')}</small></td>
          </tr>
        `;
      }

      tableHtml += `</tbody></table>`;
      previewContainer.innerHTML = tableHtml;
      insertBtn.disabled = false;
      insertBtn.textContent = `Insert in Worksheet (${count} row${count === 1 ? '' : 's'} · ${money(totalAmount)})`;
    }
  }

  inputEl.addEventListener('input', updatePreview);
  startSerialEl.addEventListener('input', updatePreview);
  defaultDateEl.addEventListener('change', updatePreview);
  defaultStatusEl.addEventListener('change', updatePreview);

  if (clearBtn) {
    clearBtn.onclick = () => {
      inputEl.value = '';
      inputEl.focus();
      updatePreview();
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = closeModal;
  }

  if (insertBtn) {
    insertBtn.onclick = () => {
      if (!currentParsedRows.length) return;

      const existing = clientItems(activeClient);
      const maxSortOrder = existing.length ? Math.max(...existing.map(i => Number(i.sortOrder) || 0)) : -1;
      const startSortOrder = maxSortOrder + 1;

      pushUndo(`Add ${currentParsedRows.length} rows`);

      const addedItems = [];
      currentParsedRows.forEach((parsedRow, idx) => {
        const item = newItem(activeClient, startSortOrder + idx);
        item.serial = cleanSerial(parsedRow.serial);
        item.sortOrder = startSortOrder + idx;
        item.workDate = parsedRow.workDate;
        item.service = parsedRow.service;
        item.quantity = parsedRow.quantity;
        item.rate = parsedRow.rate;
        item.quotedTotal = parsedRow.quotedTotal;
        item.manualTotal = true;
        item.status = parsedRow.status;
        item.remarks = parsedRow.remarks;
        item.updatedAt = new Date().toISOString();

        data.items.push(item);
        enqueue('items', item.id);
        addedItems.push(item);
      });

      const client = data.clients?.find(c => c.id === activeClient);
      if (typeof logActivity === 'function') {
        logActivity('add', `Added ${addedItems.length} row${addedItems.length === 1 ? '' : 's'} via Add Multiples in ${client?.name || 'client'}`, {
          items: addedItems.map(i => JSON.parse(JSON.stringify(i))),
          clientId: activeClient,
          clientName: client?.name || ''
        });
      }

      save();
      scheduleSync();
      closeModal();

      selected = new Set(addedItems.map(i => i.id));
      if (addedItems.length) selectionAnchor = addedItems[0].id;

      render();

      setTimeout(() => {
        if (addedItems.length) {
          const firstRow = document.querySelector(`[data-row="${addedItems[0].id}"]`);
          firstRow?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 100);

      toast(`Added ${addedItems.length} row${addedItems.length === 1 ? '' : 's'} to worksheet`);
    };
  }

  setTimeout(() => inputEl.focus(), 80);
}

const SMART_UPDATE_PRESETS = ['FLEX', 'FOAM BOARD', 'WELCOME BOARD', 'BOARD', 'SIGNAGE'];

function smartUpdateDialog() {
  const client = currentClient();
  if (!client) {
    toast('Select a client first');
    return;
  }

  const items = clientItems(activeClient);
  if (!items.length) {
    toast('No rows in this client worksheet');
    return;
  }

  const serialNums = items.map(i => parseInt(cleanSerial(i.serial), 10)).filter(n => !isNaN(n));
  const minSerial = serialNums.length ? Math.min(...serialNums) : 1;
  const maxSerial = serialNums.length ? Math.max(...serialNums) : items.length;

  let defaultScope = 'all';
  let defaultFromSerial = minSerial;
  let defaultToSerial = maxSerial;

  if (selected.size > 0) {
    const selItems = items.filter(i => selected.has(i.id));
    const selSerials = selItems.map(i => parseInt(cleanSerial(i.serial), 10)).filter(n => !isNaN(n));
    if (selSerials.length) {
      defaultFromSerial = Math.min(...selSerials);
      defaultToSerial = Math.max(...selSerials);
      defaultScope = 'range';
    }
  }

  let currentKeyword = 'FLEX';
  let currentScope = defaultScope;
  let fromSerialVal = defaultFromSerial;
  let toSerialVal = defaultToSerial;
  let updateRateEnabled = true;
  let newRateVal = '';
  let updateStatusEnabled = false;
  let newStatusVal = 'pending';
  let updateQtyEnabled = false;
  let newQtyVal = '';

  const bodyHtml = `
    <div class="smart-update-wrap">
      <p class="smart-update-desc">
        Search for words across rows for <strong>${esc(client.name)}</strong> and bulk-update their rate, status, or quantity.
      </p>

      <!-- 1. Word to find -->
      <div class="smart-section">
        <label class="smart-section-label">1. Word to find (case-insensitive)</label>
        <div class="smart-preset-chips" id="smartPresetChips">
          ${SMART_UPDATE_PRESETS.map(preset => `
            <button type="button" class="smart-chip ${preset === currentKeyword ? 'active' : ''}" data-preset="${esc(preset)}">
              ${esc(preset)}
            </button>
          `).join('')}
        </div>
        <div style="margin-top:8px;">
          <input id="smartKeywordInput" class="smart-input" value="${esc(currentKeyword)}" placeholder="Type word (e.g. FLEX, BOARD, SIGNAGE)...">
        </div>
      </div>

      <!-- 2. Target row scope -->
      <div class="smart-section">
        <label class="smart-section-label">2. Target row range</label>
        <div class="smart-scope-options">
          <label class="smart-radio-label">
            <input type="radio" name="smartScope" value="all" ${currentScope === 'all' ? 'checked' : ''}>
            <span>All rows in sheet (#${minSerial} to #${maxSerial})</span>
          </label>
          <label class="smart-radio-label">
            <input type="radio" name="smartScope" value="range" ${currentScope === 'range' ? 'checked' : ''}>
            <span>Specific Serial Range:</span>
          </label>
          <div class="smart-range-inputs" id="smartRangeInputsArea" style="${currentScope === 'range' ? '' : 'opacity:0.5; pointer-events:none;'}">
            <label>From #</label>
            <input type="number" id="smartFromSerial" class="smart-mini-input" value="${fromSerialVal}" min="1">
            <label>to #</label>
            <input type="number" id="smartToSerial" class="smart-mini-input" value="${toSerialVal}" min="1">
          </div>
          ${selected.size > 0 ? `
            <label class="smart-radio-label" style="margin-top:2px;">
              <input type="radio" name="smartScope" value="selected" ${currentScope === 'selected' ? 'checked' : ''}>
              <span>Selected rows only (${selected.size} selected)</span>
            </label>
          ` : ''}
        </div>
      </div>

      <!-- 3. What to update -->
      <div class="smart-section">
        <label class="smart-section-label">3. What to update</label>
        <div class="smart-update-fields">
          <div class="smart-field-row">
            <label class="smart-check-label">
              <input type="checkbox" id="smartCheckRate" ${updateRateEnabled ? 'checked' : ''}>
              <span>Update Rate (₹):</span>
            </label>
            <input type="number" id="smartRateVal" class="smart-val-input" placeholder="e.g. 400" value="${newRateVal}" min="0" step="0.01" ${updateRateEnabled ? '' : 'disabled'}>
          </div>

          <div class="smart-field-row">
            <label class="smart-check-label">
              <input type="checkbox" id="smartCheckStatus" ${updateStatusEnabled ? 'checked' : ''}>
              <span>Update Status:</span>
            </label>
            <select id="smartStatusVal" class="smart-val-select" ${updateStatusEnabled ? '' : 'disabled'}>
              <option value="pending" ${newStatusVal==='pending'?'selected':''}>Pending</option>
              <option value="working" ${newStatusVal==='working'?'selected':''}>Working</option>
              <option value="changes" ${newStatusVal==='changes'?'selected':''}>Changes</option>
              <option value="sent" ${newStatusVal==='sent'?'selected':''}>Sent</option>
              <option value="paid" ${newStatusVal==='paid'?'selected':''}>Paid</option>
              <option value="discarded" ${newStatusVal==='discarded'?'selected':''}>Discarded</option>
            </select>
          </div>

          <div class="smart-field-row">
            <label class="smart-check-label">
              <input type="checkbox" id="smartCheckQty" ${updateQtyEnabled ? 'checked' : ''}>
              <span>Update Quantity:</span>
            </label>
            <input type="number" id="smartQtyVal" class="smart-val-input" placeholder="New quantity" value="${newQtyVal}" min="1" ${updateQtyEnabled ? '' : 'disabled'}>
          </div>
        </div>
      </div>

      <!-- 4. Matching preview -->
      <div class="smart-section">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <label class="smart-section-label" style="margin:0;">4. Matching rows preview</label>
          <span id="smartMatchBadge" class="smart-badge">0 matching rows</span>
        </div>
        <div class="smart-preview-wrap" id="smartPreviewList">
        </div>
      </div>
    </div>
  `;

  const footerHtml = `
    <div class="modal-actions" style="display:flex; justify-content:space-between; align-items:center;">
      <button class="small-btn" id="cancelSmartModal">Cancel</button>
      <button class="small-btn blue" id="applySmartBtn" disabled>Apply Smart Update (0 rows)</button>
    </div>
  `;

  modal('⚡ Smart Update', bodyHtml, footerHtml, true);

  const keywordInput = $('#smartKeywordInput');
  const scopeRadios = $$('input[name="smartScope"]');
  const rangeInputsArea = $('#smartRangeInputsArea');
  const fromSerialInput = $('#smartFromSerial');
  const toSerialInput = $('#smartToSerial');
  const checkRate = $('#smartCheckRate');
  const rateValInput = $('#smartRateVal');
  const checkStatus = $('#smartCheckStatus');
  const statusValInput = $('#smartStatusVal');
  const checkQty = $('#smartCheckQty');
  const qtyValInput = $('#smartQtyVal');
  const matchBadge = $('#smartMatchBadge');
  const previewList = $('#smartPreviewList');
  const applyBtn = $('#applySmartBtn');
  const cancelBtn = $('#cancelSmartModal');

  let currentMatchedItems = [];

  function updateSmartPreview() {
    currentKeyword = keywordInput.value.trim();
    const selScope = $('input[name="smartScope"]:checked')?.value || 'all';
    currentScope = selScope;

    if (rangeInputsArea) {
      if (currentScope === 'range') {
        rangeInputsArea.style.opacity = '1';
        rangeInputsArea.style.pointerEvents = 'auto';
      } else {
        rangeInputsArea.style.opacity = '0.5';
        rangeInputsArea.style.pointerEvents = 'none';
      }
    }

    fromSerialVal = parseInt(fromSerialInput?.value, 10);
    toSerialVal = parseInt(toSerialInput?.value, 10);

    updateRateEnabled = checkRate?.checked;
    rateValInput.disabled = !updateRateEnabled;
    newRateVal = rateValInput.value;

    updateStatusEnabled = checkStatus?.checked;
    statusValInput.disabled = !updateStatusEnabled;
    newStatusVal = statusValInput.value;

    updateQtyEnabled = checkQty?.checked;
    qtyValInput.disabled = !updateQtyEnabled;
    newQtyVal = qtyValInput.value;

    let candidateItems = items;
    if (currentScope === 'selected' && selected.size > 0) {
      candidateItems = items.filter(i => selected.has(i.id));
    } else if (currentScope === 'range') {
      candidateItems = items.filter(i => {
        const s = parseInt(cleanSerial(i.serial), 10);
        if (isNaN(s)) return false;
        if (!isNaN(fromSerialVal) && s < fromSerialVal) return false;
        if (!isNaN(toSerialVal) && s > toSerialVal) return false;
        return true;
      });
    }

    const kw = currentKeyword.toLowerCase();
    if (!kw) {
      currentMatchedItems = [];
    } else {
      currentMatchedItems = candidateItems.filter(i => {
        const svc = String(i.service || '').toLowerCase();
        const rem = String(i.remarks || '').toLowerCase();
        return svc.includes(kw) || rem.includes(kw);
      });
    }

    $$('#smartPresetChips .smart-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.preset.toLowerCase() === kw);
    });

    const count = currentMatchedItems.length;
    let totalPreviewAmount = 0;
    currentMatchedItems.forEach(i => {
      const effRate = (updateRateEnabled && newRateVal !== '') ? num(newRateVal) : num(i.rate);
      const effQty = (updateQtyEnabled && newQtyVal !== '') ? num(newQtyVal) : num(i.quantity);
      totalPreviewAmount += effRate * effQty;
    });

    matchBadge.textContent = `${count} matching row${count === 1 ? '' : 's'}`;

    if (!count) {
      previewList.innerHTML = `
        <div style="padding:24px 16px; text-align:center; color:#94a3b8; font-size:12px;">
          ${!kw ? 'Type or pick a word above to preview matching rows.' : `No rows matching "${esc(currentKeyword)}" found in the selected range.`}
        </div>
      `;
      applyBtn.disabled = true;
      applyBtn.textContent = 'Apply Smart Update (0 rows)';
    } else {
      const hasAction = (updateRateEnabled && newRateVal !== '') || updateStatusEnabled || (updateQtyEnabled && newQtyVal !== '');
      applyBtn.disabled = !hasAction;
      applyBtn.textContent = hasAction 
        ? `Apply Smart Update (${count} row${count === 1 ? '' : 's'} · ${money(totalPreviewAmount)})`
        : `Choose what to update above (${count} row${count === 1 ? '' : 's'})`;

      let tableHtml = `
        <table class="smart-preview-table">
          <thead>
            <tr>
              <th style="width:36px; text-align:center;">SR</th>
              <th>SERVICE</th>
              <th style="text-align:right;">RATE</th>
              <th style="text-align:center;">STATUS</th>
              <th style="text-align:right;">TOTAL</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const i of currentMatchedItems) {
        const effRate = (updateRateEnabled && newRateVal !== '') ? num(newRateVal) : num(i.rate);
        const effQty = (updateQtyEnabled && newQtyVal !== '') ? num(newQtyVal) : num(i.quantity);
        const effTotal = effRate * effQty;

        const escapedService = esc(i.service);
        const highlightRegex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        const highlightedService = escapedService.replace(highlightRegex, '<span class="smart-highlight-match">$1</span>');

        tableHtml += `
          <tr>
            <td style="font-weight:700; color:#3b82f6; text-align:center;">${esc(cleanSerial(i.serial))}</td>
            <td>${highlightedService}</td>
            <td style="text-align:right; font-variant-numeric:tabular-nums;">
              ${(updateRateEnabled && newRateVal !== '') 
                ? `<span style="color:#64748b; text-decoration:line-through; font-size:10px;">${money(i.rate)}</span> ➔ <strong style="color:#047857">${money(effRate)}</strong>`
                : money(i.rate)}
            </td>
            <td style="text-align:center;">
              ${updateStatusEnabled 
                ? `<span class="pill ${i.status}" style="font-size:10px;">${i.status}</span> ➔ <span class="pill ${newStatusVal}" style="font-size:10px;">${newStatusVal}</span>`
                : `<span class="pill ${i.status}" style="font-size:10px;">${i.status}</span>`}
            </td>
            <td style="text-align:right; font-weight:700; color:#047857; font-variant-numeric:tabular-nums;">
              ${money(effTotal)}
            </td>
          </tr>
        `;
      }

      tableHtml += `</tbody></table>`;
      previewList.innerHTML = tableHtml;
    }
  }

  $$('#smartPresetChips .smart-chip').forEach(chip => {
    chip.onclick = () => {
      keywordInput.value = chip.dataset.preset;
      updateSmartPreview();
      keywordInput.focus();
    };
  });

  keywordInput.addEventListener('input', updateSmartPreview);
  scopeRadios.forEach(r => r.addEventListener('change', updateSmartPreview));
  fromSerialInput?.addEventListener('input', updateSmartPreview);
  toSerialInput?.addEventListener('input', updateSmartPreview);
  checkRate.addEventListener('change', updateSmartPreview);
  rateValInput.addEventListener('input', updateSmartPreview);
  checkStatus.addEventListener('change', updateSmartPreview);
  statusValInput.addEventListener('change', updateSmartPreview);
  checkQty.addEventListener('change', updateSmartPreview);
  qtyValInput.addEventListener('input', updateSmartPreview);

  if (cancelBtn) cancelBtn.onclick = closeModal;

  if (applyBtn) {
    applyBtn.onclick = () => {
      if (!currentMatchedItems.length) return;
      const hasAction = (updateRateEnabled && newRateVal !== '') || updateStatusEnabled || (updateQtyEnabled && newQtyVal !== '');
      if (!hasAction) return;

      pushUndo(`Smart update "${currentKeyword}" (${currentMatchedItems.length} rows)`);

      const previousItems = currentMatchedItems.map(i => JSON.parse(JSON.stringify(i)));
      currentMatchedItems.forEach(i => {
        if (updateRateEnabled && newRateVal !== '') {
          i.rate = num(newRateVal);
          i.quotedTotal = num(i.quantity) * num(i.rate);
          i.manualTotal = true;
        }
        if (updateStatusEnabled) {
          i.status = newStatusVal;
        }
        if (updateQtyEnabled && newQtyVal !== '') {
          i.quantity = num(newQtyVal) || 1;
          i.quotedTotal = num(i.quantity) * num(i.rate);
          i.manualTotal = true;
        }
        i.updatedAt = new Date().toISOString();
        enqueue('items', i.id);
      });

      const client = data.clients?.find(c => c.id === activeClient);
      if (typeof logActivity === 'function') {
        logActivity('smart-update', `Smart updated ${currentMatchedItems.length} row${currentMatchedItems.length === 1 ? '' : 's'} in ${client?.name || 'client'} (keyword: "${currentKeyword || 'all'}")`, {
          items: currentMatchedItems.map(i => JSON.parse(JSON.stringify(i))),
          previousItems,
          clientId: activeClient,
          clientName: client?.name || ''
        });
      }

      save();
      scheduleSync();
      closeModal();

      selected = new Set(currentMatchedItems.map(i => i.id));
      if (currentMatchedItems.length) selectionAnchor = currentMatchedItems[0].id;

      render();

      setTimeout(() => {
        if (currentMatchedItems.length) {
          const firstRow = document.querySelector(`[data-row="${currentMatchedItems[0].id}"]`);
          firstRow?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 100);

      toast(`Smart Update applied to ${currentMatchedItems.length} row${currentMatchedItems.length > 1 ? 's' : ''}`);
    };
  }

  updateSmartPreview();
  setTimeout(() => rateValInput.focus(), 80);
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

  const dealItems = (data.items || []).filter(i => i.groupId);
  const receiptsToRemove = [];
  for (const r of data.receipts) {
    if (r.referenceKind === 'deal' || r.referenceKind === 'project' || r.referenceKind === 'invoice') continue;
    const item = (r.referenceKind === 'item' && r.referenceId)
      ? data.items.find(i => i.id === r.referenceId)
      : (r.source === 'app' && r.sourceKey && r.sourceKey.startsWith('app:') ? data.items.find(i => i.id === r.sourceKey.slice(4)) : null);
    if (item && item.groupId) {
      receiptsToRemove.push(r.id);
    } else if (!item && (r.referenceKind === 'item' || (r.source === 'app' && r.sourceKey && r.sourceKey.startsWith('app:')))) {
      const match = dealItems.find(di => di.clientId === r.clientId && di.service && di.service.trim().toLowerCase() === (r.description || '').trim().toLowerCase());
      if (match) receiptsToRemove.push(r.id);
    }
  }
  for (const rid of receiptsToRemove) {
    removeReceipt(rid);
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
  const previousItems = items.map(i => JSON.parse(JSON.stringify(i)));
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
  const client = data.clients?.find(c => c.id === (items[0]?.clientId || activeClient));
  if (typeof logActivity === 'function') {
    logActivity('status', `Changed status to "${next}" on ${items.length} row${items.length===1?'':'s'} in ${client?.name || 'client'}`, {
      items: items.map(i => JSON.parse(JSON.stringify(i))),
      previousItems,
      clientId: items[0]?.clientId,
      clientName: client?.name || ''
    });
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
  { key: 'love', title: 'Love / Appreciated', action: 'Heart', message: 'The cat is sending huge love & thanks! 😻' },
  { key: 'shy', title: 'Shy / Blushing', action: 'Blush', message: 'The cat is blushing shyly! 😳' },
  { key: 'proud', title: 'Proud / Overjoyed', action: 'Cheer', message: 'The cat is so proud of this work! 🌟' },
  { key: 'pleading', title: 'Pleading / Begging', action: 'Beg', message: 'Pretty please with tuna on top? 🥺' },
  { key: 'sparkle', title: 'Amazed / Starry Eyes', action: 'Dazzle', message: 'Starstruck and sparkling with awe! ✨' },
  { key: 'chill', title: 'Chill / Relaxed', action: 'Relax', message: 'Total chill vibes, zero stress today! 🌸' },
  { key: 'curious', title: 'Curious / Head Tilt', action: 'Inspect', message: "Curious head tilt: what's going on here? 🧐" },
  { key: 'confused', title: 'Confused / Question Marks', action: 'Ponder', message: 'Thoroughly confused... need explanation??? ❓' },
  { key: 'idea', title: 'Idea / Eureka Alert', action: 'Notice', message: 'Alert! A brilliant idea just struck! 💡' },
  { key: 'derp', title: 'Derp / Silly Goof', action: 'Goof', message: 'No thoughts, head completely empty! 🤪' },
  { key: 'dizzy', title: 'Dizzy / Spiral Eyes', action: 'Spin', message: 'Looking at too many spreadsheets, eyes spinning! 🌀' },
  { key: 'sweating', title: 'Nervous / Awkward Giggle', action: 'Nervous', message: 'Hehe... smiling through the deadline sweat! 😅' },
  { key: 'freeze', title: 'Freezing / Shivering Panic', action: 'Shiver', message: 'Freezing cold panic! Production freeze! 🥶' },
  { key: 'singing', title: 'Singing / Meow Anthem', action: 'Sing', message: 'Singing the work victory anthem at top volume! 🎤' },
  { key: 'gentleman', title: 'Gentleman / Sir Paws', action: 'Fancy', message: 'Quite distinguished! Very classy gentleman! 🎩' },
  { key: 'confident', title: 'Confident / Smooth Wink', action: 'Wink', message: 'Nailed it smoothly! Looking sharp! 😎' },
  { key: 'wave', title: 'Waving / Hello Paw', action: 'Wave', message: 'The cat waves a warm hello paw! 🐾' },
  { key: 'facepalm', title: 'Facepalm / Sigh', action: 'Sigh', message: 'Cat facepalm... oh boy! 🤦' },
  { key: 'cool', title: 'Cool / Shades On', action: 'Cool', message: 'Too cool for bugs, sunglasses on! 😎' },
  { key: 'snack', title: 'Snacking / Nom Nom', action: 'Snack', message: 'Munching on tasty tuna snacks! 🐟' },
  { key: 'party', title: 'Party / Celebration', action: 'Party', message: "Party time! Let's celebrate! 🎉" },
  { key: 'hug', title: 'Hug / Comfort', action: 'Hug', message: 'Sending a warm fuzzy cat hug! 🫂' },
  { key: 'peek', title: 'Peeking / Sneaky', action: 'Peek', message: 'Sneaky cat peeking around the corner! 👀' },
  { key: 'thumbsup', title: 'Thumbs Up / Approved', action: 'Approve', message: 'Paws up! 100% approved! 👍' }
];

// 51 Unique Non-Repeating Animated Moving Stickers (Zero duplicates)
const CAT_STICKER_COLORS = [
  { id: 'orange', name: 'Ginger Cat' },
  { id: 'black', name: 'Midnight Cat' },
  { id: 'calico', name: 'Calico Cat' },
  { id: 'white', name: 'Snow Persian' }
];

const CORE_BREED_KEYS = ['happy', 'working', 'depressed', 'angry', 'sleepy', 'shocked', 'love'];

const ALL_CAT_STICKERS = [];

// 1. 7 Ginger Cats (Orange)
CORE_BREED_KEYS.forEach(k => {
  const r = CAT_REACTIONS.find(x => x.key === k);
  if (r) {
    ALL_CAT_STICKERS.push({
      id: `orange:${k}`,
      key: k,
      color: 'orange',
      colorName: 'Ginger Cat',
      title: `${r.title.split('/')[0].trim()} (Ginger)`,
      action: r.action,
      message: r.message,
      format: 'image',
      url: `assets/cats/moving/orange/${k}.webp`,
      isAnimated: true
    });
  }
});

// 2. 7 Midnight Cats (Black)
CORE_BREED_KEYS.forEach(k => {
  const r = CAT_REACTIONS.find(x => x.key === k);
  if (r) {
    ALL_CAT_STICKERS.push({
      id: `black:${k}`,
      key: k,
      color: 'black',
      colorName: 'Midnight Cat',
      title: `${r.title.split('/')[0].trim()} (Midnight)`,
      action: r.action,
      message: r.message,
      format: 'image',
      url: `assets/cats/moving/black/${k}.webp`,
      isAnimated: true
    });
  }
});

// 3. 7 Calico Cats (Calico)
CORE_BREED_KEYS.forEach(k => {
  const r = CAT_REACTIONS.find(x => x.key === k);
  if (r) {
    ALL_CAT_STICKERS.push({
      id: `calico:${k}`,
      key: k,
      color: 'calico',
      colorName: 'Calico Cat',
      title: `${r.title.split('/')[0].trim()} (Calico)`,
      action: r.action,
      message: r.message,
      format: 'image',
      url: `assets/cats/moving/calico/${k}.webp`,
      isAnimated: true
    });
  }
});

// 4. 7 Snow Persian Cats (White)
CORE_BREED_KEYS.forEach(k => {
  const r = CAT_REACTIONS.find(x => x.key === k);
  if (r) {
    ALL_CAT_STICKERS.push({
      id: `white:${k}`,
      key: k,
      color: 'white',
      colorName: 'Snow Persian',
      title: `${r.title.split('/')[0].trim()} (Snow)`,
      action: r.action,
      message: r.message,
      format: 'image',
      url: `assets/cats/moving/white/${k}.webp`,
      isAnimated: true
    });
  }
});

// 5. 23 Kuro Black Cat Emotion Animations
CAT_REACTIONS.slice(7).forEach(r => {
  ALL_CAT_STICKERS.push({
    id: `black:${r.key}`,
    key: r.key,
    color: 'black',
    colorName: 'Midnight Cat',
    title: `${r.title.split('/')[0].trim()} (Kuro)`,
    action: r.action,
    message: r.message,
    format: 'image',
    url: `assets/cats/moving/black/${r.key}.webp`,
    isAnimated: true
  });
});

const ALL_CAT_MOVING_STICKERS = ALL_CAT_STICKERS;
const ALL_CAT_STATIC_STICKERS = ALL_CAT_STICKERS;

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

let bannerRightTimer = null;
let bannerLeftTimer = null;

function displayCatReactionBanner(payload) {
  playCatChime(payload.catType === 'black' ? 659.25 : 523.25);
  const isMe = payload.senderId === currentUserId();
  const bannerId = isMe ? 'catLiveBannerRight' : 'catLiveBannerLeft';
  const sideClass = isMe ? 'banner-right' : 'banner-left';
  const isBlack = payload.catType === 'black';

  let banner = document.getElementById(bannerId);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = bannerId;
    banner.className = `cat-live-banner ${sideClass}`;
    banner.onclick = () => banner.classList.remove('show');
    document.body.appendChild(banner);
  }

  banner.className = `cat-live-banner ${sideClass} ${isBlack ? 'banner-black' : ''}`;
  const animBoxId = isMe ? 'catBannerAnimBoxRight' : 'catBannerAnimBoxLeft';

  const heading = isMe 
    ? `You sent a cat reaction!` 
    : `${esc(payload.senderName || 'Teammate')} pinged you!`;

  banner.innerHTML = `
    <div class="cat-banner-anim" id="${animBoxId}"></div>
    <div class="cat-banner-text">
      <strong>${heading}</strong>
      <p>${esc(payload.message || 'Cat reaction sent!')}</p>
    </div>
  `;

  const animBox = document.getElementById(animBoxId);
  const catColor = payload.catType || 'orange';
  if (animBox) {
    animBox.innerHTML = `<img src="assets/cats/moving/${catColor}/${payload.reactionKey}.webp" alt="Cat reaction" style="width:100%;height:100%;object-fit:contain;">`;
  }

  if (isMe) {
    clearTimeout(bannerRightTimer);
    requestAnimationFrame(() => banner.classList.add('show'));
    bannerRightTimer = setTimeout(() => banner.classList.remove('show'), 4500);
  } else {
    clearTimeout(bannerLeftTimer);
    requestAnimationFrame(() => banner.classList.add('show'));
    bannerLeftTimer = setTimeout(() => banner.classList.remove('show'), 4500);
  }
}

async function triggerCatPing(reactionKey, catColor, contextItem = null, targetPartner = null) {
  const chosenColor = (catColor && catColor !== 'all') ? catColor : (data.settings.catType || 'orange');
  const r = ALL_CAT_STICKERS.find(x => x.key === reactionKey && (x.color === chosenColor || !chosenColor))
         || ALL_CAT_STICKERS.find(x => x.key === reactionKey)
         || CAT_REACTIONS.find(x => x.key === reactionKey) 
         || CAT_REACTIONS[0];
  const myName = data.settings.displayName || 'Me';
  const partnerName = targetPartner || data.settings.localPartner || 'Teammate';
  
  let msg = r.message;
  if (contextItem && contextItem.service) {
    msg = `"${contextItem.service}" · ${r.message}`;
  }
  
  const payload = {
    senderId: currentUserId(),
    senderName: myName,
    catType: r.color || chosenColor,
    reactionKey: r.key,
    title: r.title,
    action: r.action || 'Ping',
    message: msg,
    timestamp: Date.now()
  };
  
  // Show locally
  displayCatReactionBanner(payload);
  
  // Broadcast to partner over Supabase channel
  if (typeof channel !== 'undefined' && channel) {
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
  
  toast(`🐾 Sent ${r.action || 'cat'} ping to ${partnerName}!`);
}

// --- TEAM CHAT & WORK SHARING APPLICATION ---

function chatTimeStr(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function chatDateStr(ts) {
  if (!ts) return 'Today';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date();
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return fmtDate(d.toISOString().slice(0, 10));
}

function playChatChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880.00, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {}
}

function getPartnerInfo() {
  const partnerMember = (data.members || []).find(m => m.userId && m.userId !== currentUserId());
  const name = partnerMember?.displayName || data.settings.localPartner || 'Teammate';
  const cat = partnerMember?.catType || (data.settings.catType === 'black' ? 'orange' : 'black');
  const isOnline = (Date.now() - lastPartnerOnlineTime) < 180000;
  const avatarData = partnerMember?.avatarData || data.settings.partnerAvatarData || '';
  const userId = partnerMember?.userId || 'local-partner';
  return { name, cat, isOnline, member: partnerMember, avatarData, userId };
}

function updateChatUnreadBadge() {
  const badge = $('#chatUnreadCount');
  if (!badge) return;
  if (unreadChatCount > 0 && tab !== 'chat') {
    badge.textContent = unreadChatCount > 99 ? '99+' : unreadChatCount;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
    if (tab === 'chat') unreadChatCount = 0;
  }
}

function renderChat() {
  const partner = getPartnerInfo();
  data.chatMessages = data.chatMessages || [];
  const messages = data.chatMessages;
  const myName = data.settings.displayName || 'Samuel';

  return `
    <div class="chat-container">
      <div class="chat-header">
        <div class="chat-peer-info">
          <div class="chat-avatar-wrap">
            <span class="chat-peer-avatar">${avatar(partner.userId, partner.name, '', partner.avatarData)}</span>
            <span class="chat-status-dot ${partner.isOnline ? 'online' : ''}" title="${partner.isOnline ? 'Online' : 'Offline'}"></span>
          </div>
          <div class="chat-peer-details">
            <div class="chat-peer-name">
              <strong>${esc(partner.name)}</strong>
              <span class="chat-cat-tag ${partner.cat}">🐱 ${partner.cat === 'black' ? 'Black Cat' : partner.cat === 'calico' ? 'Calico Cat' : partner.cat === 'white' ? 'Snow Persian' : 'Ginger Cat'}</span>
            </div>
            <div class="chat-online-label">
              ${partner.isOnline 
                ? '<span class="status-online"><span class="pulse-dot"></span> Online now</span>' 
                : '<span>Offline / In background</span>'}
            </div>
          </div>
        </div>

        <div class="chat-header-actions">
          <button type="button" class="small-btn blue" id="attachWorkTopBtn" title="Attach and discuss rows from any client worksheet">📎 Share Work</button>
          <button type="button" class="small-btn" id="chatClearBtn" title="Clear chat messages">🗑️ Clear</button>
        </div>
      </div>

      <div class="chat-messages-viewport" id="chatMessagesViewport">
        ${renderChatMessagesList(messages)}
      </div>

      <div class="chat-attachment-bar" id="chatAttachmentBar" style="${pendingChatAttachment ? '' : 'display:none'}">
        ${pendingChatAttachment ? `
          <div class="attachment-preview">
            <span class="attachment-icon">📋</span>
            <div class="attachment-meta">
              <strong>${esc(pendingChatAttachment.clientName)} (${pendingChatAttachment.items.length} row${pendingChatAttachment.items.length === 1 ? '' : 's'})</strong>
              <span>Total: ${money(pendingChatAttachment.totalAmount)}</span>
            </div>
            <button type="button" class="attachment-remove-btn" id="removeChatAttachment" title="Remove attachment">✕</button>
          </div>
        ` : ''}
      </div>

      <div class="chat-sticker-drawer" id="chatStickerDrawer" style="display:none">
        <div class="sticker-drawer-header">
          <div class="sticker-header-title">
            <span>🐾</span>
            <strong>Stickers</strong>
            <span class="sticker-count-badge">${ALL_CAT_STICKERS.length}</span>
          </div>
          <input type="text" class="sticker-search-input" id="stickerSearchInput" placeholder="Search animated stickers..." value="${esc(stickerSearchQuery)}" />
          <button type="button" class="sticker-drawer-close" id="closeStickerDrawer" title="Close drawer">✕</button>
        </div>
        <div class="sticker-grid" id="stickerDrawerGrid">
          ${renderStickerDrawerContent()}
        </div>
      </div>

      <div class="chat-input-bar">
        <button type="button" class="chat-icon-btn" id="chatAttachBtn" title="Attach work from worksheet">📎</button>
        <button type="button" class="chat-icon-btn" id="chatStickerBtn" title="Open cat stickers drawer">🐱</button>
        <div class="chat-input-box">
          <textarea id="chatInputText" placeholder="Message ${esc(partner.name)} as ${esc(myName)}... (Enter to send, Shift+Enter for newline)" rows="1" autofocus>${esc(chatDraftText || '')}</textarea>
        </div>
        <button type="button" class="chat-send-btn" id="chatSendBtn" title="Send message">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function renderChatMessagesList(messages, initialLastDate = '') {
  const partner = getPartnerInfo();
  const myName = data.settings.displayName || 'Samuel';

  if (!messages || !messages.length) {
    return `
      <div class="chat-empty-state" style="text-align:center;padding:40px 20px;color:#94a3b8">
        <div style="font-size:42px;margin-bottom:10px">💬🐾</div>
        <h3 style="color:#f8fafc;font-size:16px;margin:0 0 6px 0">MeowSheet Team Chat</h3>
        <p style="font-size:13px;max-width:380px;margin:0 auto 12px;line-height:1.5">
          Real-time chat between <strong>${esc(myName)}</strong> and <strong>${esc(partner.name)}</strong>.
        </p>
        <p style="font-size:12px;color:#64748b;max-width:360px;margin:0 auto">
          Send messages, use animated cat stickers, or attach worksheet rows to discuss numbers directly!
        </p>
      </div>
    `;
  }

  let html = '';
  let lastDate = initialLastDate;

  for (const m of messages) {
    const isMe = m.senderId === currentUserId() || m.senderId === 'local-me';
    const dStr = chatDateStr(m.timestamp);
    if (dStr !== lastDate) {
      html += `<div class="chat-date-divider"><span class="chat-date-pill">${esc(dStr)}</span></div>`;
      lastDate = dStr;
    }

    const rowClass = isMe ? 'out' : 'in';
    const time = chatTimeStr(m.timestamp);

    // Resolve proper sender name and avatar image from profile / settings
    const member = (data.members || []).find(mem => mem.userId && (mem.userId === m.senderId || mem.displayName === m.senderName));
    const senderName = isMe
      ? myName
      : (member?.displayName || m.senderName || partner.name || 'Partner');
      
    const senderAvatarSrc = isMe
      ? (data.settings.avatarData || m.senderAvatar || '')
      : (member?.avatarData || m.senderAvatar || partner.avatarData || '');

    const avatarHtml = `
      <div class="chat-msg-avatar" title="${esc(senderName)}">
        ${avatar(isMe ? currentUserId() : (member?.userId || m.senderId || partner.userId), senderName, '', senderAvatarSrc)}
      </div>
    `;

    let contentHtml = '';
    const isSticker = m.type === 'sticker';

    if (m.type === 'text') {
      contentHtml = `<div class="chat-text">${esc(m.text || '')}</div>`;
    } else if (m.type === 'sticker') {
      const stickerUrl = m.sticker?.url || `assets/cats/moving/${m.sticker?.color || 'orange'}/${m.sticker?.key || 'happy'}.webp`;
      contentHtml = `
        <img src="${esc(stickerUrl)}" class="chat-sticker-img" alt="Sticker" title="${esc(m.sticker?.title || 'Cat sticker')}" />
      `;
    } else if (m.type === 'work_card' && m.workCard) {
      const card = m.workCard;
      contentHtml = `
        <div class="chat-work-card">
          <div class="work-card-top">
            <div class="work-card-client">
              <span class="card-icon">📋</span>
              <div>
                <strong>${esc(card.clientName || 'Client')}</strong>
                <small>${card.itemCount} row${card.itemCount === 1 ? '' : 's'} · Total: ${money(card.totalAmount)}</small>
              </div>
            </div>
            <button type="button" class="work-card-jump-btn" data-jump-work-card="${esc(card.clientId)}" data-jump-items="${esc((card.items || []).map(x => x.id).join(','))}">View in sheet →</button>
          </div>
          ${m.text ? `<div class="work-card-comment">${esc(m.text)}</div>` : ''}
          <div class="work-card-items-preview">
            ${(card.items || []).slice(0, 3).map(it => `
              <div class="work-card-row-preview">
                <span class="row-serv">${esc(it.service)}</span>
                <span class="row-rate">${it.quantity} × ${money(it.rate)} = ${money(it.quotedTotal)}</span>
              </div>
            `).join('')}
            ${(card.items || []).length > 3 ? `<div class="work-card-more">+${card.items.length - 3} more row${card.items.length - 3 === 1 ? '' : 's'}</div>` : ''}
          </div>
        </div>
      `;
    }

    html += `
      <div class="chat-msg-row ${rowClass} ${isSticker ? 'msg-sticker' : ''}">
        ${avatarHtml}
        <div class="chat-bubble ${rowClass} ${isSticker ? 'chat-sticker-bubble' : ''}">
          <div class="chat-bubble-sender ${rowClass} chat-sender-name">${esc(senderName)}${isMe ? ' (You)' : ''}</div>
          ${contentHtml}
          <div class="chat-bubble-footer chat-meta">
            <span class="chat-time">${esc(time)}</span>
            ${isMe ? '<span class="chat-ticks checkmarks">✓✓</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  return html;
}

function renderStickerDrawerContent() {
  const query = (stickerSearchQuery || '').toLowerCase().trim();
  const list = ALL_CAT_STICKERS;
  const filtered = query 
    ? list.filter(s => s.key.includes(query) || s.title.toLowerCase().includes(query) || s.colorName.toLowerCase().includes(query))
    : list;

  if (!filtered.length) {
    return `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#94a3b8;font-size:12px">No stickers matching "${esc(query)}"</div>`;
  }

  return filtered.map(s => `
    <button type="button" class="sticker-item-btn" data-send-sticker="${esc(s.id)}" data-sticker-type="${s.format}" title="${esc(s.title)}">
      <div class="sticker-preview-box">
        <img src="${esc(s.url)}" alt="${esc(s.title)}" loading="lazy" />
      </div>
      <span class="sticker-label">${esc(s.title.split('(')[0].trim())}</span>
    </button>
  `).join('');
}

function updateChatOnlineStatusUI() {
  const partner = getPartnerInfo();
  const dot = $('.chat-status-dot');
  const label = $('.chat-online-label');
  if (dot) {
    dot.classList.toggle('online', partner.isOnline);
    dot.title = partner.isOnline ? 'Online' : 'Offline';
  }
  if (label) {
    label.innerHTML = partner.isOnline
      ? '<span class="status-online"><span class="pulse-dot"></span> Online now</span>'
      : '<span>Offline / In background</span>';
  }
}

function appendChatMessageToViewport(msg) {
  const vp = $('#chatMessagesViewport');
  if (!vp || !vp.querySelector) return;
  const empty = vp.querySelector('.chat-empty-state');
  if (empty) empty.remove();

  const pills = vp.querySelectorAll('.chat-date-pill');
  const lastDate = pills.length ? pills[pills.length - 1].textContent.trim() : '';

  const temp = document.createElement('div');
  temp.innerHTML = renderChatMessagesList([msg], lastDate);
  while (temp.firstChild) {
    vp.appendChild(temp.firstChild);
  }
  vp.scrollTop = vp.scrollHeight;

  vp.querySelectorAll('[data-jump-work-card]').forEach(btn => {
    btn.onclick = () => {
      const cid = btn.dataset.jumpWorkCard;
      const itemIds = (btn.dataset.jumpItems || '').split(',').filter(Boolean);
      jumpToWorkCardInSheet(cid, itemIds);
    };
  });
}

function initChatInteractions() {
  const viewport = $('#chatMessagesViewport');
  if (viewport) {
    setTimeout(() => { viewport.scrollTop = viewport.scrollHeight; }, 30);
  }

  const sendBtn = $('#chatSendBtn');
  if (sendBtn) sendBtn.onclick = handleSendChatMessage;

  const input = $('#chatInputText');
  if (input) {
    input.value = chatDraftText || '';
    input.oninput = e => {
      chatDraftText = e.target.value;
    };
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendChatMessage();
      }
    };
    if (typeof input.focus === 'function') input.focus();
  }

  const attachBtn = $('#chatAttachBtn');
  if (attachBtn) attachBtn.onclick = openAttachWorkDialog;

  const attachTopBtn = $('#attachWorkTopBtn');
  if (attachTopBtn) attachTopBtn.onclick = openAttachWorkDialog;

  const stickerBtn = $('#chatStickerBtn');
  const drawer = $('#chatStickerDrawer');
  if (stickerBtn && drawer) {
    stickerBtn.onclick = () => {
      const isHidden = drawer.style.display === 'none';
      drawer.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) {
        const sInput = $('#stickerSearchInput');
        if (sInput) sInput.focus();
      } else {
        const ci = $('#chatInputText'); if (ci && typeof ci.focus === 'function') ci.focus();
      }
    };
  }

  const closeDrawer = $('#closeStickerDrawer');
  if (closeDrawer && drawer) {
    closeDrawer.onclick = () => {
      drawer.style.display = 'none';
      const ci = $('#chatInputText'); if (ci && typeof ci.focus === 'function') ci.focus();
    };
  }

  const searchInp = $('#stickerSearchInput');
  if (searchInp) {
    searchInp.oninput = () => {
      stickerSearchQuery = searchInp.value;
      const grid = $('#stickerDrawerGrid');
      if (grid) {
        grid.innerHTML = renderStickerDrawerContent();
        bindStickerClicks();
      }
    };
  }

  function bindStickerClicks() {
    $$('[data-send-sticker]').forEach(btn => {
      btn.onclick = () => {
        const stickerId = btn.dataset.sendSticker;
        const sticker = ALL_CAT_STICKERS.find(s => s.id === stickerId);
        if (sticker) {
          sendStickerChatMessage(sticker);
          if (drawer) drawer.style.display = 'none';
        }
      };
    });
  }
  bindStickerClicks();

  $$('[data-jump-work-card]').forEach(btn => {
    btn.onclick = () => {
      const cid = btn.dataset.jumpWorkCard;
      const itemIds = (btn.dataset.jumpItems || '').split(',').filter(Boolean);
      jumpToWorkCardInSheet(cid, itemIds);
    };
  });

  const removeAttBtn = $('#removeChatAttachment');
  if (removeAttBtn) {
    removeAttBtn.onclick = () => {
      pendingChatAttachment = null;
      render();
    };
  }

  const clearBtn = $('#chatClearBtn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (!confirm('Clear chat messages from this window?')) return;
      data.chatMessages = [];
      save();
      render();
      toast('Chat cleared');
    };
  }
}

function handleSendChatMessage() {
  const input = $('#chatInputText');
  const text = (input ? input.value : chatDraftText || '').trim();
  if (!text && !pendingChatAttachment) return;

  let msg = null;
  if (pendingChatAttachment) {
    msg = {
      id: uid(),
      senderId: currentUserId(),
      senderName: data.settings.displayName || 'Samuel',
      senderAvatar: data.settings.avatarData || '',
      catType: data.settings.catType || 'orange',
      timestamp: Date.now(),
      type: 'work_card',
      text: text || '',
      workCard: pendingChatAttachment
    };
    pendingChatAttachment = null;
    const bar = $('#chatAttachmentBar');
    if (bar) bar.style.display = 'none';
  } else {
    msg = {
      id: uid(),
      senderId: currentUserId(),
      senderName: data.settings.displayName || 'Samuel',
      senderAvatar: data.settings.avatarData || '',
      catType: data.settings.catType || 'orange',
      timestamp: Date.now(),
      type: 'text',
      text
    };
  }

  chatDraftText = '';
  if (input) {
    input.value = '';
    if (input.style) input.style.height = 'auto';
  }
  sendChatMessage(msg);
  appendChatMessageToViewport(msg);

  setTimeout(() => {
    const inp = $('#chatInputText');
    if (inp && typeof inp.focus === 'function') inp.focus();
  }, 10);
}

function sendStickerChatMessage(sticker) {
  const msg = {
    id: uid(),
    senderId: currentUserId(),
    senderName: data.settings.displayName || 'Samuel',
    senderAvatar: data.settings.avatarData || '',
    catType: sticker.color || data.settings.catType || 'orange',
    timestamp: Date.now(),
    type: 'sticker',
    sticker: {
      key: sticker.key,
      color: sticker.color,
      isAnimated: sticker.isAnimated,
      format: sticker.format,
      url: sticker.url,
      title: sticker.title
    }
  };

  sendChatMessage(msg);
  appendChatMessageToViewport(msg);

  displayCatReactionBanner({
    senderId: currentUserId(),
    senderName: 'You',
    catType: sticker.color || 'orange',
    reactionKey: sticker.key,
    title: sticker.title,
    action: sticker.action || 'Sticker',
    message: `Sent ${sticker.title} 🐾`,
    timestamp: Date.now()
  });

  setTimeout(() => {
    const inp = $('#chatInputText');
    if (inp && typeof inp.focus === 'function') inp.focus();
  }, 10);
}

function sendChatMessage(msg) {
  data.chatMessages = data.chatMessages || [];
  data.chatMessages.push(msg);
  if (data.chatMessages.length > 300) {
    data.chatMessages = data.chatMessages.slice(-250);
  }
  save();

  if (typeof channel !== 'undefined' && channel) {
    try {
      channel.send({
        type: 'broadcast',
        event: 'chat_message',
        payload: msg
      });
    } catch (e) {
      console.warn('Chat broadcast error:', e);
    }
  }

  scheduleChatHistorySync();
}

function handleIncomingChatMessage(payload) {
  data.chatMessages = data.chatMessages || [];
  if (!data.chatMessages.some(m => m.id === payload.id)) {
    data.chatMessages.push(payload);
    save();
  }

  lastPartnerOnlineTime = Date.now();

  let snippet = payload.text || '';
  if (payload.type === 'sticker') snippet = 'Sent a cat sticker: ' + (payload.sticker?.title || '🐱');
  if (payload.type === 'work_card') snippet = `Shared ${payload.workCard?.itemCount || ''} work rows (${payload.workCard?.clientName || ''})`;

  const catPayload = {
    senderId: payload.senderId,
    senderName: payload.senderName || 'Teammate',
    catType: payload.catType || payload.sticker?.color || 'orange',
    reactionKey: payload.sticker?.key || 'happy',
    title: payload.sticker?.title || 'Cat reaction',
    action: 'Ping',
    message: snippet,
    timestamp: payload.timestamp || Date.now()
  };

  if (tab === 'chat') {
    appendChatMessageToViewport(payload);
    playChatChime();

    if (payload.type === 'sticker') {
      displayCatReactionBanner(catPayload);
    }

    if (typeof isAppActivelyUsed === 'function') {
      isAppActivelyUsed().then(isActive => {
        if (!isActive) {
          sendNativeDesktopNotification('💬 ' + (payload.senderName || 'Teammate'), snippet, catPayload);
        }
      });
    }
  } else {
    unreadChatCount++;
    updateChatUnreadBadge();
    playChatChime();

    smartNotify({
      title: '💬 ' + (payload.senderName || 'Teammate'),
      body: snippet,
      catPayload
    });
  }
}

function shareSelectedRowsInChat() {
  if (!selected.size) {
    toast('Select row(s) to share in chat');
    return;
  }
  const client = currentClient();
  const allCurrent = groupedSheetItems(clientItems());
  const selectedItems = allCurrent.filter(i => selected.has(i.id));
  if (!selectedItems.length) {
    toast('No rows selected');
    return;
  }

  const clientName = client?.name || 'Client';
  const totalVal = selectedItems.reduce((s, i) => s + num(i.quotedTotal), 0);

  modal(
    'Share in Team Chat',
    `<p>Share <strong>${selectedItems.length} selected row${selectedItems.length === 1 ? '' : 's'}</strong> from <strong>${esc(clientName)}</strong> (Total: <strong>${money(totalVal)}</strong>) in Chat for reference & discussion.</p>
     <div class="field" style="margin-top:12px">
       <label for="shareChatNote">Add reference note or question (optional)</label>
       <textarea id="shareChatNote" rows="2" placeholder="e.g. Can you check these rates before we send?" autofocus></textarea>
     </div>
     <div class="preview-list" style="max-height:160px;overflow-y:auto;margin-top:10px">
       ${selectedItems.map((it, idx) => `
         <div class="list-row" style="padding:6px 8px;font-size:12px">
           <div><strong>${idx + 1}. ${esc(it.service || 'Item')}</strong> <small>(${it.quantity || 1} × ${money(it.rate || 0)})</small></div>
           <div><span class="pill ${it.status}">${esc(displayStatus(it))}</span> <strong>${money(it.quotedTotal || 0)}</strong></div>
         </div>
       `).join('')}
     </div>`,
    `<div class="modal-actions">
       <button type="button" class="small-btn" id="cancelShareChat">Cancel</button>
       <button type="button" class="small-btn blue" id="confirmShareChat">💬 Send to Chat</button>
     </div>`
  );

  $('#cancelShareChat').onclick = closeModal;
  $('#confirmShareChat').onclick = () => {
    const note = inputValue('shareChatNote');
    const msg = {
      id: uid(),
      senderId: currentUserId(),
      senderName: data.settings.displayName || 'Samuel',
      senderAvatar: data.settings.avatarData || '',
      catType: data.settings.catType || 'orange',
      timestamp: Date.now(),
      type: 'work_card',
      text: note,
      workCard: {
        clientId: activeClient,
        clientName,
        itemCount: selectedItems.length,
        totalAmount: totalVal,
        items: selectedItems.map(i => ({
          id: i.id,
          service: i.service || 'Item',
          quantity: num(i.quantity) || 1,
          rate: num(i.rate) || 0,
          quotedTotal: num(i.quotedTotal) || 0,
          status: i.status || 'pending',
          workDate: i.workDate || '',
          remarks: i.remarks || ''
        }))
      }
    };

    closeModal();
    sendChatMessage(msg);
    tab = 'chat';
    render();
    toast(`Shared ${selectedItems.length} row(s) in Chat`);
  };
}

function openAttachWorkDialog() {
  let chosenClient = activeClient || data.clients[0]?.id;
  let clientRowsSearch = '';
  const checkedRowIds = new Set();

  function renderAttachModalContent() {
    const client = data.clients.find(c => c.id === chosenClient);
    const rows = (data.items || []).filter(i => i.clientId === chosenClient && i.status !== 'discarded');
    const filteredRows = clientRowsSearch
      ? rows.filter(r => (r.service || '').toLowerCase().includes(clientRowsSearch.toLowerCase()) || (r.remarks || '').toLowerCase().includes(clientRowsSearch.toLowerCase()))
      : rows;

    return `
      <p>Select rows from any client worksheet to attach and discuss in chat.</p>
      <div class="field-grid" style="margin:12px 0">
        <div class="field">
          <label>Select client</label>
          <select id="attachClientSelect">
            ${data.clients.map(c => `<option value="${c.id}" ${c.id === chosenClient ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Search rows</label>
          <input type="text" id="attachRowSearch" placeholder="Filter by service..." value="${esc(clientRowsSearch)}" />
        </div>
      </div>
      <div class="attach-work-table-wrap">
        ${filteredRows.length ? filteredRows.map(r => `
          <label class="attach-work-row ${checkedRowIds.has(r.id) ? 'selected' : ''}">
            <input type="checkbox" data-attach-row="${r.id}" ${checkedRowIds.has(r.id) ? 'checked' : ''} />
            <div class="attach-work-info">
              <strong class="attach-work-service">${esc(r.service || 'Item')}</strong>
              <span class="attach-work-meta">${r.quantity || 1} × ${money(r.rate || 0)}</span>
            </div>
            <span class="pill ${r.status}">${esc(displayStatus(r))}</span>
            <strong class="attach-work-price">${money(r.quotedTotal || 0)}</strong>
          </label>
        `).join('') : '<div class="attach-work-empty">No rows found for this client</div>'}
      </div>
    `;
  }

  modal(
    'Attach Work to Chat',
    `<div id="attachModalRoot">${renderAttachModalContent()}</div>`,
    `<div class="modal-actions">
       <button type="button" class="small-btn" id="cancelAttachWork">Cancel</button>
       <button type="button" class="small-btn blue" id="confirmAttachWork">Attach selected rows</button>
     </div>`
  );

  function bindAttachModalEvents() {
    const sel = $('#attachClientSelect');
    if (sel) {
      sel.onchange = () => {
        chosenClient = sel.value;
        checkedRowIds.clear();
        refreshModal();
      };
    }
    const search = $('#attachRowSearch');
    if (search) {
      search.oninput = () => {
        clientRowsSearch = search.value;
        refreshModal();
        const next = $('#attachRowSearch');
        if (next) {
          next.focus();
          next.setSelectionRange(clientRowsSearch.length, clientRowsSearch.length);
        }
      };
    }
    $$('[data-attach-row]').forEach(box => {
      box.onchange = () => {
        const id = box.dataset.attachRow;
        if (box.checked) {
          checkedRowIds.add(id);
          box.closest('.attach-work-row')?.classList.add('selected');
        } else {
          checkedRowIds.delete(id);
          box.closest('.attach-work-row')?.classList.remove('selected');
        }
      };
    });
  }

  function refreshModal() {
    const root = $('#attachModalRoot');
    if (root) {
      root.innerHTML = renderAttachModalContent();
      bindAttachModalEvents();
    }
  }

  bindAttachModalEvents();

  $('#cancelAttachWork').onclick = closeModal;
  $('#confirmAttachWork').onclick = () => {
    if (!checkedRowIds.size) {
      toast('Please select at least one row');
      return;
    }
    const client = data.clients.find(c => c.id === chosenClient);
    const chosenItems = (data.items || []).filter(i => checkedRowIds.has(i.id));

    pendingChatAttachment = {
      clientId: chosenClient,
      clientName: client?.name || 'Client',
      itemCount: chosenItems.length,
      totalAmount: chosenItems.reduce((s, i) => s + num(i.quotedTotal), 0),
      items: chosenItems.map(i => ({
        id: i.id,
        service: i.service || 'Item',
        quantity: num(i.quantity) || 1,
        rate: num(i.rate) || 0,
        quotedTotal: num(i.quotedTotal) || 0,
        status: i.status || 'pending',
        workDate: i.workDate || '',
        remarks: i.remarks || ''
      }))
    };

    closeModal();
    if (tab !== 'chat') tab = 'chat';
    render();
    toast(`Attached ${chosenItems.length} row(s). Type an optional message and send!`);
  };
}

function jumpToWorkCardInSheet(clientId, itemIds) {
  if (!clientId) return;
  tab = 'sheet';
  activeClient = clientId;
  filter = 'all';
  selected = new Set(itemIds || []);

  if (itemIds && itemIds.length) {
    const items = (data.items || []).filter(i => itemIds.includes(i.id));
    for (const it of items) {
      if (it.projectGroupId) collapsedGroups.delete('project:' + it.projectGroupId);
      if (it.groupId) collapsedGroups.delete('deal:' + it.groupId);
    }
  }

  render();

  setTimeout(() => {
    if (itemIds && itemIds.length) {
      const firstRow = document.querySelector(`[data-row="${itemIds[0]}"]`);
      if (firstRow) {
        firstRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
        itemIds.forEach(id => {
          const el = document.querySelector(`[data-row="${id}"]`);
          if (el) {
            el.classList.add('group-highlight-flash');
            setTimeout(() => el.classList.remove('group-highlight-flash'), 2500);
          }
        });
      }
    }
  }, 100);
}

function scheduleChatHistorySync() {
  if (typeof clientApi === 'undefined' || !clientApi || !session || !data?.settings?.workspaceId) return;
  clearTimeout(chatSyncTimer);
  chatSyncTimer = setTimeout(async () => {
    try {
      const recent = (data.chatMessages || []).slice(-80);
      data.settings.seller = data.settings.seller || {};
      data.settings.seller.chat_history = recent;
      await clientApi.from('workspaces').update({ business: data.settings.seller }).eq('id', data.settings.workspaceId);
    } catch (err) {
      console.warn('Chat history cloud sync warning:', err);
    }
  }, 1200);
}

function openCatReactionPicker(contextItem = null, targetName = null) {
  const partner = targetName || data.settings.localPartner || 'Teammate';
  let chosenCat = data.settings.catType || 'orange';
  const targetText = `to <strong>${esc(partner)}</strong>`;

  const renderPickerContent = () => {
    let pickerList = [];
    if (chosenCat === 'orange') {
      pickerList = ALL_CAT_STICKERS.filter(s => s.color === 'orange');
    } else if (chosenCat === 'black') {
      pickerList = ALL_CAT_STICKERS.filter(s => s.color === 'black');
    } else if (chosenCat === 'calico') {
      pickerList = ALL_CAT_STICKERS.filter(s => s.color === 'calico');
    } else if (chosenCat === 'white') {
      pickerList = ALL_CAT_STICKERS.filter(s => s.color === 'white');
    } else {
      pickerList = ALL_CAT_STICKERS;
    }

    return `
    <div id="catPickerRoot">
      <div class="cat-type-toggle-bar">
        <button type="button" class="cat-toggle-pill ${chosenCat==='orange'?'active-orange':''}" id="pickerCatOrange">🐱 Ginger Cat (${ALL_CAT_STICKERS.filter(s => s.color === 'orange').length})</button>
        <button type="button" class="cat-toggle-pill ${chosenCat==='black'?'active-black':''}" id="pickerCatBlack">🐈‍⬛ Midnight Cat (${ALL_CAT_STICKERS.filter(s => s.color === 'black').length})</button>
        <button type="button" class="cat-toggle-pill ${chosenCat==='calico'?'active-calico':''}" id="pickerCatCalico">🐾 Calico Cat (${ALL_CAT_STICKERS.filter(s => s.color === 'calico').length})</button>
        <button type="button" class="cat-toggle-pill ${chosenCat==='white'?'active-white':''}" id="pickerCatWhite">🤍 Snow Persian (${ALL_CAT_STICKERS.filter(s => s.color === 'white').length})</button>
        <button type="button" class="cat-toggle-pill ${chosenCat==='all'?'active-all':''}" id="pickerCatAll">🐾 All (${ALL_CAT_STICKERS.length})</button>
      </div>
      <p class="muted" style="text-align:center;font-size:12px;margin-bottom:10px;">Select an animated cat state to ping ${targetText}:</p>
      <div class="cat-picker-grid">
        ${pickerList.map(s => `
          <div class="cat-picker-item ${s.color==='black'?'black-cat-active':''}" data-cat-pick="${s.key}" data-cat-color="${s.color}">
            <div class="cat-picker-anim" id="picker-anim-${s.key}">
              <img src="${s.url}" alt="${esc(s.title)}" loading="lazy" />
            </div>
            <div class="cat-picker-title">${esc(s.title.split('/')[0].trim())}</div>
            <div class="cat-picker-action">${esc(s.action || 'Ping')} 🐾</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  };

  modal('🐾 Animated Cat Reaction & Team Ping', renderPickerContent(), '', true);

  function initPickerAnimations() {
    const oBtn = document.getElementById('pickerCatOrange');
    if (oBtn) oBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (chosenCat === 'orange') return;
      chosenCat = 'orange';
      data.settings.catType = 'orange';
      save();
      updateModalBody();
    };
    const bBtn = document.getElementById('pickerCatBlack');
    if (bBtn) bBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (chosenCat === 'black') return;
      chosenCat = 'black';
      data.settings.catType = 'black';
      save();
      updateModalBody();
    };
    const cBtn = document.getElementById('pickerCatCalico');
    if (cBtn) cBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (chosenCat === 'calico') return;
      chosenCat = 'calico';
      data.settings.catType = 'calico';
      save();
      updateModalBody();
    };
    const wBtn = document.getElementById('pickerCatWhite');
    if (wBtn) wBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (chosenCat === 'white') return;
      chosenCat = 'white';
      data.settings.catType = 'white';
      save();
      updateModalBody();
    };
    const aBtn = document.getElementById('pickerCatAll');
    if (aBtn) aBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (chosenCat === 'all') return;
      chosenCat = 'all';
      updateModalBody();
    };

    document.querySelectorAll('[data-cat-pick]').forEach(el => {
      el.onclick = () => {
        const key = el.dataset.catPick;
        const color = el.dataset.catColor || chosenCat;
        closeModal();
        triggerCatPing(key, color, contextItem, partner);
      };
    });
  }

  function updateModalBody() {
    const root = document.getElementById('catPickerRoot');
    if (root) {
      root.outerHTML = renderPickerContent();
      initPickerAnimations();
    }
  }

  initPickerAnimations();
}

// Low-level Windows desktop notification trigger
function sendNativeDesktopNotification(title, body, catPayload = null) {
  try {
    if (window.desk?.notify) {
      window.desk.notify(title, body, catPayload);
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
    sendNativeDesktopNotification(nativeTitle, nativeBody, catPayload);
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
      else {
        const member=data.members.find(m=>m.userId===session.user.id);
        if(member)member.avatarData=avatarData;
        else data.members.push({userId:session.user.id,displayName:data.settings.displayName,avatarData});
      }
    }
    render();toast('Avatar updated');
  } catch(error){toast('Could not read that image');}
  finally{URL.revokeObjectURL(url);}
}
async function savePartnerAvatar(file) {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5_000_000){toast('Choose a PNG, JPG or WebP image under 5 MB');return;}
  const url=URL.createObjectURL(file), image=new Image();
  try {
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
    const side=Math.min(image.naturalWidth,image.naturalHeight),x=(image.naturalWidth-side)/2,y=(image.naturalHeight-side)/2;
    canvas.getContext('2d').drawImage(image,x,y,side,side,0,0,96,96);
    const avatarData=canvas.toDataURL('image/jpeg',0.82);data.settings.partnerAvatarData=avatarData;save();
    render();toast('Partner avatar updated');
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
  if(action==='add-multiples')return addMultiplesDialog();
  if(action==='smart-update')return smartUpdateDialog();
  if(action==='assign')return assign([...selected]); if(action==='complete')return markSent([...selected]); if(action==='invoice')return invoiceDialog(); if(action==='group')return groupDialog();
  if(action==='project-group')return projectGroupDialog();
  if(action==='ungroup')return ungroupSelectedRows();
  if(action==='share-chat')return shareSelectedRowsInChat();
  if(action==='cat-quick-ping')return openCatReactionPicker();
  if(action==='insert-above'){if(selected.size===1)insertRowAt([...selected][0],'above');return;}
  if(action==='insert-below'){if(selected.size===1)insertRowAt([...selected][0],'below');return;}
  if(action==='go-activity'){tab='activity';render();return;}
  if(action==='go-settings'){tab='settings';render();return;}
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
function openGroupDealDialog(kind, id) {
  const isProj = kind === 'project';
  const table = isProj ? 'projectGroups' : 'groups';
  const group = (data[table] || []).find(g => g.id === id);
  if (!group) return;

  const activeItems = (data.items || []).filter(i => (isProj ? i.projectGroupId : i.groupId) === id && i.status !== 'discarded');
  const allItems = activeItems.length ? activeItems : (data.items || []).filter(i => (isProj ? i.projectGroupId : i.groupId) === id);
  if (!allItems.length) {
    toast('Group has no rows');
    return;
  }

  const quote = allItems.reduce((sum, i) => sum + num(i.quotedTotal), 0);
  const currentAgreed = (!isProj && group.agreedAmount != null) ? group.agreedAmount : '';

  modal(
    isProj ? 'Make Group Deal' : 'Edit Group Deal',
    `<p><strong>${esc(group.label)}</strong> · ${allItems.length} rows · Original quote ${money(quote)}</p>
     <div class="field">
       <label>Group name</label>
       <input id="groupDealLabel" value="${esc(group.label || 'Agreed deal')}">
     </div>
     <div class="field">
       <label>Agreed final deal amount</label>
       <input id="groupDealAmount" type="number" min="0" step="0.01" placeholder="Enter negotiated amount" value="${currentAgreed}" autofocus>
     </div>
     <div class="notice">
       This amount replaces the sum of row totals in revenue and payment estimates. Individual rows stay visible for work tracking.
     </div>`,
    `<div class="modal-actions">
       <button class="small-btn" id="cancelGroupDeal">Cancel</button>
       <button class="small-btn blue" id="saveGroupDeal">Save group deal</button>
     </div>`
  );

  $('#cancelGroupDeal').onclick = closeModal;

  const submitDeal = () => {
    pushUndo(isProj ? 'Convert to group deal' : 'Edit group deal');
    const label = inputValue('groupDealLabel').trim() || group.label || 'Agreed deal';
    const rawVal = inputValue('groupDealAmount').trim();
    const agreedAmount = rawVal === '' ? null : num(rawVal);
    if (agreedAmount !== null && (!Number.isFinite(agreedAmount) || agreedAmount < 0)) {
      toast('Please enter a valid deal amount');
      return;
    }

    if (isProj) {
      const dealGroup = {
        id: group.id,
        clientId: group.clientId,
        label,
        agreedAmount
      };
      mutate('groups', dealGroup);

      allItems.forEach(i => {
        i.groupId = dealGroup.id;
        i.projectGroupId = null;
        enqueue('items', i.id);
      });

      data.projectGroups = (data.projectGroups || []).filter(g => g.id !== id);
      data.pending = (data.pending || []).filter(p => !(p.table === 'projectGroups' && p.id === id));
      data.pendingDeletes ||= [];
      if (!data.pendingDeletes.some(d => d.table === 'projectGroups' && d.id === id)) {
        data.pendingDeletes.push({ table: 'projectGroups', id });
      }
      collapsedGroups.delete('project:' + id);

      const receiptsToRemove = (data.receipts || []).filter(r => r.referenceKind === 'project' && r.referenceId === id);
      receiptsToRemove.forEach(r => removeReceipt(r.id));

      data.groups = (data.groups || []).filter(g => g.id === dealGroup.id || (data.items || []).some(i => i.groupId === g.id));

      syncDealReceipt(dealGroup.id);
      save();
      scheduleSync();
      closeModal();
      render();
      toast('Group converted to group deal');
    } else {
      group.label = label;
      group.agreedAmount = agreedAmount;
      mutate('groups', group);
      syncDealReceipt(group.id);
      save();
      scheduleSync();
      closeModal();
      render();
      toast('Group deal saved');
    }
  };

  $('#saveGroupDeal').onclick = submitDeal;
  const onKey = e => { if (e.key === 'Enter') submitDeal(); };
  $('#groupDealLabel').onkeydown = onKey;
  $('#groupDealAmount').onkeydown = onKey;
}
function modifyReceiptDateDialog(id) {
  const r = (data.receipts || []).find(x => x.id === id);
  if (!r) return;
  const clientName = r.effectiveClientName || r.clientName || 'Client';
  const desc = r.effectiveDescription || r.description || (r.source === 'historical_workbook' ? 'Historical payment' : 'Payment');
  const amount = money(r.effectiveAmount != null ? r.effectiveAmount : r.amount);
  const currentDate = r.receivedOn || today();

  modal(
    'Modify Payment Date',
    `<p>Update payment date for <strong>${esc(desc)}</strong> (${esc(clientName)}) — <strong>${amount}</strong>.</p>
     <div class="field">
       <label for="modifyReceiptDateInput">Received on date</label>
       <input type="date" id="modifyReceiptDateInput" value="${currentDate}" autofocus>
     </div>
     <div class="notice">
       Updating the date will adjust which month this revenue appears under, and update the payment date on any linked worksheet items.
     </div>`,
    `<div class="modal-actions">
       <button type="button" class="small-btn" id="cancelReceiptDate">Cancel</button>
       <button type="button" class="small-btn blue" id="saveReceiptDate">Save payment date</button>
     </div>`
  );

  $('#cancelReceiptDate').onclick = closeModal;

  const handleSave = () => {
    const val = $('#modifyReceiptDateInput')?.value?.trim();
    if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      toast('Please choose a valid date (YYYY-MM-DD)');
      return;
    }
    pushUndo('Modify payment date');
    const month = val.slice(0, 7) + '-01';
    const stamp = val + 'T12:00:00.000Z';

    r.receivedOn = val;
    r.receivedMonth = month;
    r.receivedAt = stamp;
    enqueue('receipts', r.id);

    if (r.referenceKind === 'deal' && r.referenceId) {
      const items = (data.items || []).filter(i => i.groupId === r.referenceId && i.status === 'paid');
      items.forEach(i => {
        i.paidAt = val;
        i.paidAtTs = stamp;
        enqueue('items', i.id);
      });
    } else if (r.referenceKind === 'project' && r.referenceId) {
      const items = (data.items || []).filter(i => i.projectGroupId === r.referenceId && i.status === 'paid');
      items.forEach(i => {
        i.paidAt = val;
        i.paidAtTs = stamp;
        enqueue('items', i.id);
      });
    } else if (r.referenceKind === 'item' && r.referenceId) {
      const it = (data.items || []).find(i => i.id === r.referenceId);
      if (it && it.status === 'paid') {
        it.paidAt = val;
        it.paidAtTs = stamp;
        enqueue('items', it.id);
      }
    }

    save();
    scheduleSync();
    closeModal();
    render();
    toast(`Payment date updated to ${fmtDate(val)}`);
  };

  $('#saveReceiptDate').onclick = handleSave;
  const modifyDateInput = $('#modifyReceiptDateInput');
  if (modifyDateInput) {
    modifyDateInput.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    };
  }
}

function deleteReceiptDialog(id) {
  const r = (data.receipts || []).find(x => x.id === id);
  if (!r) return;
  const clientName = r.effectiveClientName || r.clientName || 'Client';
  const desc = r.effectiveDescription || r.description || (r.source === 'historical_workbook' ? 'Historical payment' : 'Payment');
  const amount = money(r.effectiveAmount != null ? r.effectiveAmount : r.amount);
  const dateStr = r.receivedOn ? fmtDate(r.receivedOn) : 'Unconfirmed date';

  const hasLinkedActiveWork = (
    (r.referenceKind === 'deal' && (data.items || []).some(i => i.groupId === r.referenceId && i.status === 'paid')) ||
    (r.referenceKind === 'project' && (data.items || []).some(i => i.projectGroupId === r.referenceId && i.status === 'paid')) ||
    (r.referenceKind === 'item' && (data.items || []).some(i => i.id === r.referenceId && i.status === 'paid'))
  );

  modal(
    'Delete Payment Receipt',
    `<p>Are you sure you want to delete this payment receipt?</p>
     <div style="background:#f8fafc;padding:12px;border-radius:8px;margin:12px 0;border:1px solid #e2e8f0;font-size:12px;line-height:1.6">
       <div><strong>Description:</strong> ${esc(desc)}</div>
       <div><strong>Client:</strong> ${esc(clientName)}</div>
       <div><strong>Date:</strong> ${esc(dateStr)}</div>
       <div><strong>Amount:</strong> <span style="color:#168451;font-weight:700">${amount}</span></div>
     </div>
     ${hasLinkedActiveWork ? `
       <label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-size:12px;cursor:pointer">
         <input type="checkbox" id="unmarkWorkCheckbox" checked>
         <span>Also unmark this work as unpaid in the worksheet (revert to Sent)</span>
       </label>
     ` : `
       <div class="notice">
         This receipt will be permanently removed from your recorded revenue totals.
       </div>
     `}`,
    `<div class="modal-actions">
       <button type="button" class="small-btn" id="cancelDeleteReceipt">Cancel</button>
       <button type="button" class="small-btn danger" id="confirmDeleteReceipt">Delete receipt</button>
     </div>`
  );

  $('#cancelDeleteReceipt').onclick = closeModal;

  $('#confirmDeleteReceipt').onclick = () => {
    pushUndo('Delete payment receipt');
    const shouldUnmark = $('#unmarkWorkCheckbox')?.checked;

    if (shouldUnmark) {
      if (r.referenceKind === 'deal' && r.referenceId) {
        const items = (data.items || []).filter(i => i.groupId === r.referenceId && i.status === 'paid');
        items.forEach(i => {
          i.status = 'sent';
          i.paidAt = null;
          i.paidAtTs = null;
          enqueue('items', i.id);
        });
      } else if (r.referenceKind === 'project' && r.referenceId) {
        const items = (data.items || []).filter(i => i.projectGroupId === r.referenceId && i.status === 'paid');
        items.forEach(i => {
          i.status = 'sent';
          i.paidAt = null;
          i.paidAtTs = null;
          enqueue('items', i.id);
        });
      } else if (r.referenceKind === 'item' && r.referenceId) {
        const it = (data.items || []).find(i => i.id === r.referenceId);
        if (it && it.status === 'paid') {
          it.status = 'sent';
          it.paidAt = null;
          it.paidAtTs = null;
          enqueue('items', it.id);
        }
      }
    }

    removeReceipt(r.id);
    save();
    scheduleSync();
    closeModal();
    render();
    toast('Payment receipt deleted');
  };
}

function jumpToReceiptWorksheet(id) {
  const r = (data.receipts || []).find(x => x.id === id);
  if (!r) return;

  const targetClientId = r.clientId || (data.items || []).find(i => i.id === r.referenceId || i.groupId === r.referenceId || i.projectGroupId === r.referenceId)?.clientId;
  if (!targetClientId) {
    toast('No linked client found for this payment');
    return;
  }

  activeClient = targetClientId;
  filter = 'all';
  tab = 'sheet';

  if (r.referenceKind === 'deal' && r.referenceId) {
    collapsedGroups.delete('deal:' + r.referenceId);
    const it = (data.items || []).find(i => i.groupId === r.referenceId && i.projectGroupId);
    if (it) collapsedGroups.delete('project:' + it.projectGroupId);
  } else if (r.referenceKind === 'project' && r.referenceId) {
    collapsedGroups.delete('project:' + r.referenceId);
  } else if (r.referenceKind === 'item' && r.referenceId) {
    const it = (data.items || []).find(i => i.id === r.referenceId);
    if (it?.projectGroupId) collapsedGroups.delete('project:' + it.projectGroupId);
    if (it?.groupId) collapsedGroups.delete('deal:' + it.groupId);
  }

  render();

  setTimeout(() => {
    let target = null;
    if (r.referenceKind === 'deal' && r.referenceId) {
      target = document.querySelector(`[data-group-collapse="deal:${r.referenceId}"]`)?.closest('tr');
    } else if (r.referenceKind === 'project' && r.referenceId) {
      target = document.querySelector(`[data-group-collapse="project:${r.referenceId}"]`)?.closest('tr');
    } else if (r.referenceKind === 'item' && r.referenceId) {
      target = document.querySelector(`[data-row="${r.referenceId}"]`);
    }

    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('group-highlight-flash');
      setTimeout(() => target.classList.remove('group-highlight-flash'), 2500);
    }
  }, 80);
}

function jumpAndUngroupReceipt(id) {
  const r = (data.receipts || []).find(x => x.id === id);
  if (!r || !(r.referenceKind === 'deal' || r.referenceKind === 'project')) {
    toast('This payment is not linked to a group');
    return;
  }
  jumpToReceiptWorksheet(id);
  setTimeout(() => {
    ungroupDialog(r.referenceKind, r.referenceId);
  }, 220);
}

function setGroupPaidDateDialog(kind, id) {
  const table = kind === 'project' ? 'projectGroups' : 'groups';
  const group = (data[table] || []).find(g => g.id === id);
  if (!group) return;

  const items = (data.items || []).filter(i => (kind === 'project' ? i.projectGroupId : i.groupId) === id && i.status !== 'discarded');
  if (!items.length) {
    toast('Group has no rows');
    return;
  }

  const existingPaidItem = items.find(i => i.paidAt);
  const currentPaidDate = existingPaidItem?.paidAt || today();
  const allAlreadyPaid = items.every(i => i.status === 'paid');

  modal(
    allAlreadyPaid ? `Modify Payment Date for ${group.label}` : `Set Payment Date for ${group.label}`,
    `<p>${allAlreadyPaid ? 'Modify' : 'Set'} the date of payment for <strong>${esc(group.label)}</strong> (${items.length} rows).</p>
     <div class="field">
       <label for="groupPaidDateInput">Payment date</label>
       <input type="date" id="groupPaidDateInput" value="${currentPaidDate}" autofocus>
     </div>
     <div class="notice">
       ${allAlreadyPaid
         ? 'This will update the payment date on all paid rows in this group and update your revenue tracking month.'
         : 'This will mark all active rows in this group as Paid on this date and record revenue in your selected month.'}
     </div>`,
    `<div class="modal-actions">
       <button type="button" class="small-btn" id="cancelGroupPaidDate">Cancel</button>
       <button type="button" class="small-btn blue" id="saveGroupPaidDate">Save payment date</button>
     </div>`
  );

  $('#cancelGroupPaidDate').onclick = closeModal;

  const handleSave = () => {
    const chosenDate = $('#groupPaidDateInput')?.value?.trim();
    if (!chosenDate || !/^\d{4}-\d{2}-\d{2}$/.test(chosenDate)) {
      toast('Please choose a valid date (YYYY-MM-DD)');
      return;
    }

    pushUndo(`Set payment date for ${group.label}`);
    const stamp = chosenDate + 'T12:00:00.000Z';

    items.forEach(i => {
      i.status = 'paid';
      i.paidAt = chosenDate;
      i.paidAtTs = stamp;
      enqueue('items', i.id);
    });

    if (kind === 'deal') syncDealReceipt(id, chosenDate);
    else syncProjectReceipt(id, chosenDate);

    save();
    scheduleSync();
    closeModal();
    render();
    toast(`Payment date set to ${fmtDate(chosenDate)}`);
  };

  $('#saveGroupPaidDate').onclick = handleSave;
  const groupDateInput = $('#groupPaidDateInput');
  if (groupDateInput) {
    groupDateInput.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    };
  }
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
function invoiceDialog() {
  const items = data.items.filter(i => selected.has(i.id));
  if (!items.length) return;
  const notReady = items.filter(i => i.status !== 'sent');
  if (notReady.length) { toast('Select rows marked Sent for a new invoice'); return; }
  if (items.some(i => billedIds().has(i.id))) { toast('One or more rows are already invoiced'); return; }
  if (new Set(items.map(i => i.clientId)).size !== 1) { toast('Choose rows from one client'); return; }

  const subtotal = items.reduce((n, i) => n + num(i.quotedTotal), 0);
  const next = String(data.invoices.length + 1).padStart(4, '0');

  // Check if any selected items belong to a group deal
  const dealGroupIds = new Set(items.map(i => i.groupId).filter(Boolean));
  const hasGroupDeal = dealGroupIds.size > 0;
  let initialDeal = null;
  if (hasGroupDeal) {
    const firstDealId = [...dealGroupIds][0];
    initialDeal = (data.groups || []).find(g => g.id === firstDealId);
  }

  // By default: if group deal -> Show as Lump Sum; otherwise -> Show Breakup
  let isLumpSum = hasGroupDeal;
  let lumpSumDescription = (initialDeal && initialDeal.label) || `${currentClient()?.name || 'Project'} Services`;
  let lumpSumAmount = (initialDeal && initialDeal.agreedAmount != null && initialDeal.agreedAmount !== '') 
    ? num(initialDeal.agreedAmount) 
    : subtotal;

  let currentInvNumber = `GIR-${new Date().getFullYear()}-${next}`;
  let currentInvDate = today();
  let currentDiscount = 0;
  let currentInvFinal = '';

  const renderModalContent = () => `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <p style="margin:0; color:#64748b; font-size:13px;">${items.length} finished row${items.length === 1 ? '' : 's'} from <strong>${esc(currentClient()?.name)}</strong></p>
      <button type="button" class="small-btn blue" id="toggleInvoiceMode" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        ${isLumpSum ? '📋 Show Breakup' : '💰 Show as Lump Sum'}
      </button>
    </div>

    ${isLumpSum ? `
      <div class="lump-sum-row-card" style="background:#f8faff; border:2px dashed #93c5fd; border-radius:10px; padding:14px; margin-bottom:14px;">
        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div style="flex:1;">
            <label style="font-size:11px; font-weight:800; color:#1e40af; display:block; margin-bottom:5px;">LUMP SUM SERVICE / DEAL NAME</label>
            <input id="lumpSumService" value="${esc(lumpSumDescription)}" style="width:100%; font-weight:700; font-size:13px; border:1px solid #93c5fd; border-radius:6px; padding:7px 10px; background:#fff;" placeholder="Enter service description for invoice" />
          </div>
          <div style="width:170px;">
            <label style="font-size:11px; font-weight:800; color:#1e40af; display:block; margin-bottom:5px;">LUMP SUM AMOUNT (₹)</label>
            <input id="lumpSumAmount" type="number" min="0" step="0.01" value="${lumpSumAmount}" style="width:100%; font-weight:800; font-size:14px; text-align:right; border:1px solid #93c5fd; border-radius:6px; padding:7px 10px; background:#fff;" />
          </div>
        </div>
        <small style="display:block; color:#64748b; font-size:11px; margin-top:8px;">
          💡 Single line item will appear on the invoice. You can edit the description and full amount directly above.
        </small>
      </div>
    ` : `
      <div class="preview-list" style="max-height:220px; overflow-y:auto; border:1px solid var(--line); border-radius:8px;">
        ${items.map((i, n) => `
          <div class="list-row" style="display:flex; justify-content:space-between; padding:8px 12px; border-bottom:1px solid #f1f5f9;">
            <div>
              <strong>${n + 1}. ${esc(i.service)}</strong>
              <small style="display:block; color:#64748b;">${i.quantity} × ${money(i.rate)}</small>
            </div>
            <strong>${money(i.quotedTotal)}</strong>
          </div>
        `).join('')}
      </div>
    `}

    <div class="field-grid" style="margin-top:15px">
      <div class="field"><label>Invoice number</label><input id="invNumber" value="${esc(currentInvNumber)}"></div>
      <div class="field"><label>Issue date</label><input id="invDate" type="date" value="${currentInvDate}"></div>
      <div class="field"><label>Discount</label><input id="invDiscount" type="number" min="0" step="0.01" value="${currentDiscount}"></div>
      <div class="field"><label>Agreed final amount (overrides discount)</label><input id="invFinal" type="number" min="0" step="0.01" placeholder="Optional" value="${currentInvFinal}"></div>
    </div>
    <div class="notice">
      ${isLumpSum 
        ? `Lump sum amount ${money(lumpSumAmount)}. Advances already received: ${money(items.reduce((n, i) => n + num(i.advanceAmount), 0))}. The final amount is the full agreed price; the invoice will show advances separately and deduct them from the balance due.`
        : `Subtotal ${money(subtotal)}. Advances already received: ${money(items.reduce((n, i) => n + num(i.advanceAmount), 0))}. The final amount is the full agreed price; the invoice will show advances separately and deduct them from the balance due.`}
    </div>
  `;

  modal('Create invoice', renderModalContent(), `<div class="modal-actions"><button class="small-btn" id="cancelInvoice">Cancel</button><button class="small-btn blue" id="createInvoice">Create invoice</button></div>`, true);

  function syncFormInputs() {
    currentInvNumber = inputValue('invNumber') || currentInvNumber;
    currentInvDate = inputValue('invDate') || currentInvDate;
    currentDiscount = inputValue('invDiscount') !== '' ? num(inputValue('invDiscount')) : currentDiscount;
    currentInvFinal = inputValue('invFinal') || currentInvFinal;
    if (document.getElementById('lumpSumService')) {
      lumpSumDescription = inputValue('lumpSumService').trim() || lumpSumDescription;
    }
    if (document.getElementById('lumpSumAmount') && inputValue('lumpSumAmount') !== '') {
      lumpSumAmount = num(inputValue('lumpSumAmount'));
    }
  }

  function bindInvoiceModalEvents() {
    const cancelBtn = $('#cancelInvoice');
    if (cancelBtn) cancelBtn.onclick = closeModal;

    const toggleBtn = $('#toggleInvoiceMode');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        syncFormInputs();
        isLumpSum = !isLumpSum;
        modal('Create invoice', renderModalContent(), `<div class="modal-actions"><button class="small-btn" id="cancelInvoice">Cancel</button><button class="small-btn blue" id="createInvoice">Create invoice</button></div>`, true);
        bindInvoiceModalEvents();
      };
    }

    const createBtn = $('#createInvoice');
    if (createBtn) {
      createBtn.onclick = () => {
        syncFormInputs();
        const effSubtotal = isLumpSum ? lumpSumAmount : subtotal;
        const discount = num(inputValue('invDiscount'));
        const final = inputValue('invFinal');
        if (discount > effSubtotal) {
          toast('Discount exceeds subtotal');
          return;
        }
        const amount = final === '' ? effSubtotal - discount : num(final);

        const originalLines = items.map((i, n) => ({
          serial: n + 1,
          service: i.service,
          quantity: num(i.quantity),
          rate: num(i.rate),
          total: num(i.quotedTotal)
        }));

        const lines = isLumpSum
          ? [{
              serial: 1,
              service: lumpSumDescription || 'Lump sum service',
              quantity: 1,
              rate: effSubtotal,
              total: effSubtotal
            }]
          : originalLines;

        const sellerMeta = structuredClone(data.settings.seller || {});
        sellerMeta.lumpSum = {
          isLumpSum,
          lumpSumDescription,
          originalLines
        };

        const invoice = {
          id: uid(),
          clientId: items[0].clientId,
          number: inputValue('invNumber') || `GIR-${next}`,
          issueDate: inputValue('invDate') || today(),
          itemIds: items.map(i => i.id),
          isLumpSum,
          lumpSumDescription,
          originalLines,
          lines,
          subtotal: effSubtotal,
          discount: final === '' ? discount : effSubtotal - amount,
          finalAmount: amount,
          advanceAmount: items.reduce((n, i) => n + num(i.advanceAmount), 0),
          status: 'issued',
          seller: sellerMeta,
          buyer: structuredClone(currentClient()?.billing || {})
        };

        mutate('invoices', invoice);
        selected.clear();
        closeModal();
        viewInvoice(invoice.id);
      };
    }
  }

  bindInvoiceModalEvents();
}

function invoiceAdvance(i) {
  return i.advanceAmount == null
    ? (i.itemIds || []).reduce((sum, id) => sum + num(data.items.find(item => item.id === id)?.advanceAmount), 0)
    : num(i.advanceAmount);
}

function invoiceHtml(i) {
  return `<div class="invoice-paper">
    <div class="invoice-top">
      <div>
        <img class="invoice-company-logo" src="${esc(i.seller?.logoData || 'assets/gir-icon.png')}" alt="${esc(i.seller?.name || 'GIR')} logo">
        <h1>Invoice</h1>
        <div class="muted">${esc(i.seller?.name || 'GIR')}</div>
      </div>
      <div class="invoice-meta">
        <div class="label">INVOICE NO.</div>
        <strong>${esc(i.number)}</strong>
        <p>${fmtDate(i.issueDate)}</p>
        <span class="pill ${i.status === 'paid' ? 'paid' : 'sent'}">${i.status === 'paid' ? 'PAID' : 'ISSUED'}</span>
        ${i.isLumpSum ? '<span class="pill blue" style="margin-left:4px;">LUMP SUM</span>' : ''}
      </div>
    </div>
    <div class="invoice-parties">
      <div>
        <div class="label">FROM</div>
        <strong>${esc(i.seller?.name || '')}</strong>
        <p>${esc(i.seller?.address || '').replace(/\n/g, '<br>')}<br>${esc(i.seller?.email || '')} ${esc(i.seller?.phone || '')}<br>${esc(i.seller?.taxId || '')}</p>
      </div>
      <div>
        <div class="label">BILL TO</div>
        <strong>${esc(i.buyer?.name || '')}</strong>
        <p>${esc(i.buyer?.address || '').replace(/\n/g, '<br>')}<br>${esc(i.buyer?.email || '')} ${esc(i.buyer?.phone || '')}<br>${esc(i.buyer?.taxId || '')}</p>
      </div>
    </div>
    <table>
      <thead><tr><th>#</th><th>SERVICE</th><th>QTY</th><th>RATE</th><th>TOTAL</th></tr></thead>
      <tbody>
        ${(i.lines || []).map(l => `<tr><td>${l.serial}</td><td>${esc(l.service)}</td><td>${l.quantity}</td><td>${money(l.rate)}</td><td>${money(l.total)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><strong>${money(i.subtotal)}</strong></div>
      <div><span>Discount / adjustment</span><strong>${money(i.discount)}</strong></div>
      <div><span>Final agreed amount</span><strong>${money(i.finalAmount)}</strong></div>
      <div><span>Advance received</span><strong>− ${money(invoiceAdvance(i))}</strong></div>
      <div class="grand"><span>Balance due</span><strong>${money(i.status === 'paid' ? 0 : Math.max(0, num(i.finalAmount) - invoiceAdvance(i)))}</strong></div>
    </div>
    ${i.seller?.bankDetails ? `<div class="invoice-bank"><div class="label">BANK DETAILS · PAY GIR</div>${esc(i.seller.bankDetails).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="thankyou">Thank you for working with ${esc(i.seller?.name || 'GIR')}.</div>
  </div>`;
}

function viewInvoice(id) {
  const i = data.invoices.find(x => x.id === id);
  if (!i) return;

  const renderModal = () => {
    const isLump = !!i.isLumpSum;
    const actionsHtml = `
      <div class="modal-actions">
        <button class="small-btn blue" id="downloadInvoicePdf" style="display:inline-flex;align-items:center;gap:6px;font-weight:700">📥 Download PDF</button>
        <button class="small-btn" id="printInvoice" title="Open OS Print Dialog">🖨️ Print</button>
        <button class="small-btn" id="toggleViewInvoiceMode" title="Switch between lump sum and itemized breakup on this invoice">
          ${isLump ? '📋 Show Breakup' : '💰 Show as Lump Sum'}
        </button>
        <button class="small-btn" id="deleteInvoice">Delete invoice</button>
        ${i.status === 'issued' ? `<button class="small-btn green" id="recordPayment">Record paid</button>` : ''}
      </div>
    `;

    modal('Invoice preview', `<div id="invoicePreview">${invoiceHtml(i)}</div>`, actionsHtml, true);

    const triggerSavePdf = async () => {
      const existing = $('#printArea');
      if (existing && typeof existing.remove === 'function') existing.remove();
      const div = document.createElement('div');
      div.id = 'printArea';
      div.className = 'print-only';
      div.innerHTML = invoiceHtml(i);
      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(div);
      }

      const client = data.clients.find(c => c.id === i.clientId);
      const clientName = (client?.name || i.buyer?.name || 'Client').replace(/[/\\?%*:|"<>]/g, '_');
      const invNum = (i.number || 'INV').replace(/[/\\?%*:|"<>]/g, '_');
      const defaultFileName = `Invoice_${invNum}_${clientName}`;

      try {
        if (window.desk && typeof window.desk.savePdf === 'function') {
          const res = await window.desk.savePdf({ defaultFileName });
          if (res && res.success) {
            const fileName = res.filePath.split(/[/\\]/).pop();
            toast(`✅ Invoice saved to Downloads: ${fileName}`);
          } else if (res && !res.canceled && res.error) {
            toast(`Failed to save PDF: ${res.error}`);
          }
        } else if (window.desk && typeof window.desk.print === 'function') {
          await window.desk.print();
        } else {
          window.print();
        }
      } catch (err) {
        toast(`Error saving PDF: ${err.message}`);
      } finally {
        setTimeout(() => {
          if (div && typeof div.remove === 'function') div.remove();
        }, 600);
      }
    };

    const dlBtn = $('#downloadInvoicePdf');
    if (dlBtn) dlBtn.onclick = triggerSavePdf;

    $('#printInvoice').onclick = () => {
      const existing = $('#printArea');
      if (existing && typeof existing.remove === 'function') existing.remove();
      const div = document.createElement('div');
      div.id = 'printArea';
      div.className = 'print-only';
      div.innerHTML = invoiceHtml(i);
      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(div);
      }
      if (window.desk && window.desk.print) {
        window.desk.print().finally(() => setTimeout(() => {
          if (div && typeof div.remove === 'function') div.remove();
        }, 500));
      } else {
        window.print();
        setTimeout(() => {
          if (div && typeof div.remove === 'function') div.remove();
        }, 500);
      }
    };

    const toggleBtn = $('#toggleViewInvoiceMode');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        if (i.isLumpSum) {
          // Switch to Breakup
          i.isLumpSum = false;
          if (i.originalLines && i.originalLines.length) {
            i.lines = structuredClone(i.originalLines);
          } else if (i.seller?.lumpSum?.originalLines && i.seller.lumpSum.originalLines.length) {
            i.lines = structuredClone(i.seller.lumpSum.originalLines);
          }
          i.seller = i.seller || {};
          i.seller.lumpSum = i.seller.lumpSum || {};
          i.seller.lumpSum.isLumpSum = false;
          mutate('invoices', i);
          renderModal();
          toast('Switched to itemized breakup');
        } else {
          // Switch to Lump Sum
          i.isLumpSum = true;
          if (!i.originalLines || !i.originalLines.length) {
            i.originalLines = structuredClone(i.lines);
          }
          const lumpDesc = i.lumpSumDescription || i.seller?.lumpSum?.lumpSumDescription || i.lines[0]?.service || 'Lump sum service';
          const lumpAmt = num(i.finalAmount);
          i.lines = [{
            serial: 1,
            service: lumpDesc,
            quantity: 1,
            rate: lumpAmt,
            total: lumpAmt
          }];
          i.seller = i.seller || {};
          i.seller.lumpSum = i.seller.lumpSum || {};
          i.seller.lumpSum.isLumpSum = true;
          i.seller.lumpSum.lumpSumDescription = lumpDesc;
          i.seller.lumpSum.originalLines = structuredClone(i.originalLines);
          mutate('invoices', i);
          renderModal();
          toast('Switched to lump sum');
        }
      };
    }

    $('#deleteInvoice').onclick = () => deleteInvoiceDialog(i.id);
    if ($('#recordPayment')) $('#recordPayment').onclick = () => { markInvoicePaid(i.id); closeModal(); };
  };

  renderModal();
}

function deleteInvoiceDialog(id) {
  const invoice = data.invoices.find(i => i.id === id);
  if (!invoice) return;
  modal('Delete invoice', `<p>Delete invoice <strong>${esc(invoice.number)}</strong>? This removes the invoice from the shared workspace and frees its rows for another invoice.</p>${invoice.status === 'paid' ? '<div class="notice">The recorded payment and paid work will remain in revenue.</div>' : ''}`, `<div class="modal-actions"><button class="small-btn" id="cancelDeleteInvoice">Cancel</button><button class="small-btn" id="confirmDeleteInvoice">Delete invoice</button></div>`);
  $('#cancelDeleteInvoice').onclick = closeModal;
  $('#confirmDeleteInvoice').onclick = async () => {
    const button = $('#confirmDeleteInvoice');
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      if (!clientApi || !session || !data.settings.workspaceId) throw new Error('Connect to the workspace before deleting an invoice');
      await flushPending();
      const { data: deleted, error } = await clientApi.from('invoices').delete().eq('id', id).eq('workspace_id', data.settings.workspaceId).select('id');
      if (error) throw error;
      if (!deleted?.length) throw new Error('Invoice was not deleted. Check workspace permissions and sync again.');
      data.invoices = data.invoices.filter(i => i.id !== id);
      data.pending = data.pending.filter(p => !(p.table === 'invoices' && p.id === id));
      save();
      closeModal();
      render();
      toast('Invoice deleted');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Delete invoice';
      toast('Delete failed: ' + error.message);
    }
  };
}

function markInvoicePaid(id) {
  const i = data.invoices.find(x => x.id === id);
  if (!i || i.status === 'paid') return;
  const stamp = new Date().toISOString();
  createReceipt(i.clientId, Math.max(0, num(i.finalAmount) - invoiceAdvance(i)), `Invoice ${i.number}`, 'invoice', i.id, stamp);
  i.status = 'paid';
  i.paidAt = today();
  i.paidAtTs = stamp;
  mutate('invoices', i);
  i.itemIds.forEach(itemId => {
    const item = data.items.find(x => x.id === itemId);
    if (item) {
      item.status = 'paid';
      item.paidAt = i.paidAt;
      item.paidAtTs = stamp;
      queue('items', itemId);
    }
  });
  render();
  toast('Payment recorded');
}

const remoteTable = { clients:'clients', groups:'deal_groups', projectGroups:'project_groups', items:'work_items', invoices:'invoices', receipts:'payment_receipts' };
function remoteRow(table, x) {
  const ws=data.settings.workspaceId;
  if(table==='clients')return {id:x.id,workspace_id:ws,name:x.name,billing:x.billing||{},sort_order:x.sortOrder||0};
  if(table==='groups')return {id:x.id,workspace_id:ws,client_id:x.clientId,label:x.label,agreed_amount:x.agreedAmount};
  if(table==='projectGroups')return {id:x.id,workspace_id:ws,client_id:x.clientId,label:x.label};
  if(table==='items')return {id:x.id,workspace_id:ws,client_id:x.clientId,group_id:x.groupId||null,project_group_id:x.projectGroupId||null,source_row:x.sourceRow||null,sort_order:x.sortOrder||0,serial:cleanSerial(String(x.serial||'')),work_date:validDate(x.workDate),due_date:validDate(x.dueDate),service:x.service||'',quantity:num(x.quantity),rate:num(x.rate),quoted_total:num(x.quotedTotal),advance_amount:num(x.advanceAmount),advance_received_at:validDate(x.advanceReceivedAt),paid_at:validDate(x.paidAt),paid_at_ts:x.paidAtTs||null,status:x.status,revision_count:x.revisionCount||0,assignee_id:x.assigneeId==='local-me'?currentUserId():isUuid(x.assigneeId)?x.assigneeId:null,remarks:x.remarks||'',updated_at:x.updatedAt||new Date().toISOString()};
  if(table==='invoices')return {id:x.id,workspace_id:ws,client_id:x.clientId,number:x.number,issue_date:validDate(x.issueDate)||today(),paid_at:validDate(x.paidAt),paid_at_ts:x.paidAtTs||null,item_ids:x.itemIds,lines:x.lines,subtotal:num(x.subtotal),discount:num(x.discount),final_amount:num(x.finalAmount),advance_amount:invoiceAdvance(x),status:x.status,seller:{...(x.seller||{}),lumpSum:{isLumpSum:!!x.isLumpSum,lumpSumDescription:x.lumpSumDescription||'',originalLines:x.originalLines||[]}},buyer:x.buyer};
  if(table==='receipts')return {id:x.id,workspace_id:ws,client_id:x.clientId||null,client_name:x.clientName,amount:num(x.amount),received_month:x.receivedMonth,received_on:x.receivedOn||null,received_at:x.receivedAt||null,source:x.source,source_key:x.sourceKey,reference_kind:x.referenceKind||null,reference_id:x.referenceId||null,description:x.description||'',source_file:x.sourceFile||null,source_row:x.sourceRow||null,original_date:x.originalDate||null,date_quality:x.dateQuality||'exact'};
}
function localRow(table,x) {
  if(table==='clients')return {id:x.id,name:x.name,billing:x.billing||{},sortOrder:x.sort_order};
  if(table==='groups')return {id:x.id,clientId:x.client_id,label:x.label,agreedAmount:x.agreed_amount};
  if(table==='projectGroups')return {id:x.id,clientId:x.client_id,label:x.label};
  if(table==='items')return {id:x.id,clientId:x.client_id,groupId:x.group_id,projectGroupId:x.project_group_id,sourceRow:x.source_row,sortOrder:x.sort_order,serial:cleanSerial(x.serial)||cleanSerial(String((x.sort_order||0)+1)),workDate:x.work_date||'',dueDate:x.due_date||'',service:x.service,quantity:num(x.quantity),rate:num(x.rate),quotedTotal:num(x.quoted_total),advanceAmount:num(x.advance_amount),advanceReceivedAt:x.advance_received_at||null,paidAt:x.paid_at||null,paidAtTs:x.paid_at_ts||null,status:x.status,revisionCount:x.revision_count,assigneeId:x.assignee_id||'',remarks:x.remarks||'',manualTotal:true,updatedAt:x.updated_at};
  if(table==='invoices')return {id:x.id,clientId:x.client_id,number:x.number,issueDate:x.issue_date,paidAt:x.paid_at||null,paidAtTs:x.paid_at_ts||null,itemIds:x.item_ids||[],lines:x.lines||[],isLumpSum:x.seller?.lumpSum?.isLumpSum??x.isLumpSum??false,lumpSumDescription:x.seller?.lumpSum?.lumpSumDescription||x.lumpSumDescription||'',originalLines:x.seller?.lumpSum?.originalLines||x.originalLines||[],subtotal:num(x.subtotal),discount:num(x.discount),finalAmount:num(x.final_amount),advanceAmount:num(x.advance_amount),status:x.status,seller:x.seller||{},buyer:x.buyer||{}};
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
        const now = Date.now();
        for(const r of chunk) recentLocalPushes.set(`${table}:${r.id}`, now);
        const ids=new Set(chunk.map(x=>x.id));
        data.pending=data.pending.filter(p=>!(p.table===table&&ids.has(p.id)));
      }
      save();
      const pushCutoff = Date.now() - 20000;
      for (const [k, ts] of recentLocalPushes.entries()) {
        if (ts < pushCutoff) recentLocalPushes.delete(k);
      }
    }
    if ((data.tasksPendingSync || data.activityLogPendingSync) && data.settings.workspaceId && clientApi) {
      try {
        data.settings.seller = data.settings.seller || {};
        if (data.tasksPendingSync) {
          data.settings.seller.notice_board = (data.tasks || []).slice(0, 300);
          data.settings.seller.deleted_task_ids = (data.deletedTaskIds || []).slice(-250);
        }
        if (data.activityLogPendingSync) {
          data.settings.seller.activity_log = (data.activityLog || []).slice(0, 500);
        }
        await clientApi.from('workspaces').update({ business: data.settings.seller }).eq('id', data.settings.workspaceId);
        data.tasksPendingSync = false;
        data.activityLogPendingSync = false;
      } catch (err) {
        console.warn('Notice board flush sync warning:', err);
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
  const activeEditing = (typeof document !== 'undefined') && (
    document.querySelector('input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing') ||
    (document.activeElement?.matches?.('input[data-cell], input[data-blank-cell]') ? document.activeElement : null)
  );
  if (activeEditing && tab === 'sheet') {
    isDeferredRemotePull = true;
    return;
  }
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
  if (Array.isArray(w.data?.business?.chat_history)) {
    data.chatMessages = data.chatMessages || [];
    const knownIds = new Set(data.chatMessages.map(m => m.id));
    let added = false;
    for (const remoteMsg of w.data.business.chat_history) {
      if (!knownIds.has(remoteMsg.id)) {
        data.chatMessages.push(remoteMsg);
        knownIds.add(remoteMsg.id);
        added = true;
      }
    }
    if (added) {
      data.chatMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }
  }
  if (Array.isArray(w.data?.business?.deleted_task_ids)) {
    recordDeletedTaskIds(w.data.business.deleted_task_ids);
  }
  if (Array.isArray(w.data?.business?.notice_board) || Array.isArray(w.data?.business?.tasks)) {
    const remoteTasks = w.data.business.notice_board || w.data.business.tasks || [];
    mergeRemoteNoticeBoard(remoteTasks);
  }
  if (Array.isArray(w.data?.business?.activity_log)) {
    mergeRemoteActivityLog(w.data.business.activity_log);
  }
  if (Array.isArray(w.data?.business?.rentals)) {
    data.rentals = data.rentals || [];
    const knownR = new Set(data.rentals.map(r => r.id));
    for (const r of w.data.business.rentals) {
      if (!knownR.has(r.id)) {
        data.rentals.push(r);
        knownR.add(r.id);
      }
    }
  }
  if (Array.isArray(w.data?.business?.rental_items)) {
    data.rentalItems = data.rentalItems || [];
    const knownI = new Set(data.rentalItems.map(i => i.id));
    for (const i of w.data.business.rental_items) {
      if (!knownI.has(i.id)) {
        data.rentalItems.push(i);
        knownI.add(i.id);
      }
    }
  }
  ['clients','groups','projectGroups','items','invoices','receipts'].forEach((table,k)=>{
    const pending=new Set(data.pending.filter(p=>p.table===table).map(p=>p.id));
    const pendingDeletes=new Set((data.pendingDeletes||[]).filter(p=>p.table===table).map(p=>p.id));
    const locals=(data[table]||[]).filter(x=>pending.has(x.id));
    const oldLocal = new Map((data[table]||[]).map(x=>[x.id,x]));
    data[table]=(tables[k]||[]).filter(x=>!pendingDeletes.has(x.id)).map(x=>{
      const remote = localRow(table,x);
      if (table === 'items') {
        const prev = oldLocal.get(remote.id);
        if (prev && !pending.has(remote.id)) {
          if (prev.updatedAt && remote.updatedAt && new Date(prev.updatedAt) > new Date(remote.updatedAt)) {
            return prev;
          }
          if (num(prev.rate) > 0 && num(remote.rate) === 0) {
            return { ...remote, rate: prev.rate, quotedTotal: prev.quotedTotal || (num(remote.quantity) * num(prev.rate)) };
          }
        }
      }
      return remote;
    });
    for(const local of locals){
      const ix=data[table].findIndex(x=>x.id===local.id);
      if(ix<0)data[table].push(local);else data[table][ix]=local;
    }
  });
  consolidateAllReceipts();
  if(!activeClient || !data.clients.some(c=>c.id===activeClient))activeClient=sortedClients()[0]?.id||null;
  lastSyncTime=Date.now();
  save();
  const stillEditing = (typeof document !== 'undefined') && (
    document.querySelector('input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing') ||
    (document.activeElement?.matches?.('input[data-cell], input[data-blank-cell]') ? document.activeElement : null)
  );
  if (stillEditing && tab === 'sheet') {
    isDeferredRemotePull = true;
    updateSyncUI();
    return;
  }
  render();
  updateSyncUI();
}
const lastOnlineAlerts = {};
async function handleUserOnline({ userId, displayName, catType, replyRequested }) {
  if (!userId || userId === currentUserId()) return;
  lastPartnerOnlineTime = Date.now();
  if (tab === 'chat') updateChatOnlineStatusUI();
  const now = Date.now();
  if (lastOnlineAlerts[userId] && now - lastOnlineAlerts[userId] < 60000) {
    return;
  }
  lastOnlineAlerts[userId] = now;

  const partnerName = displayName || data.settings.localPartner || 'Teammate';
  await smartNotify({
    title: `🐾 ${partnerName} is online!`,
    body: `${partnerName} is online on MeowSheet. Meow~ 🐾`,
    icon: '🐾',
    catPayload: {
      senderId: userId,
      senderName: partnerName,
      catType: catType || 'orange',
      reactionKey: 'happy',
      message: `${partnerName} is online on MeowSheet! Meow~ 🐾`
    }
  });

  // Reply back if the newcomer requested replies, so they learn we are already active!
  if (replyRequested && channel) {
    try {
      await channel.send({
        type: 'broadcast',
        event: 'user_online',
        payload: {
          userId: currentUserId(),
          displayName: data.settings.displayName || 'Samuel',
          catType: data.settings.catType || 'orange',
          timestamp: Date.now(),
          replyRequested: false
        }
      });
    } catch {}
  }
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

  channel.on('broadcast', { event: 'user_online' }, async ({ payload }) => {
    if (!payload) return;
    lastPartnerOnlineTime = Date.now();
    if (tab === 'chat') updateChatOnlineStatusUI();
    await handleUserOnline(payload);
  });

  channel.on('broadcast', { event: 'chat_message' }, async ({ payload }) => {
    if (!payload || payload.senderId === currentUserId()) return;
    handleIncomingChatMessage(payload);
  });

  channel.on('broadcast', { event: 'notice_board_update' }, async ({ payload }) => {
    if (!payload || payload.senderId === currentUserId()) return;
    handleIncomingNoticeBoardUpdate(payload);
  });

  channel.on('broadcast', { event: 'activity_log_update' }, async ({ payload }) => {
    if (!payload || payload.senderId === currentUserId()) return;
    handleIncomingActivityLogUpdate(payload);
  });

  channel.on('presence', { event: 'join' }, async ({ newPresences }) => {
    if (!Array.isArray(newPresences)) return;
    lastPartnerOnlineTime = Date.now();
    if (tab === 'chat') updateChatOnlineStatusUI();
    for (const p of newPresences) {
      if (p.userId && p.userId !== currentUserId()) {
        await handleUserOnline({
          userId: p.userId,
          displayName: p.displayName || p.userName,
          catType: p.catType,
          replyRequested: false
        });
      }
    }
  });
  
  for(const table of ['clients','deal_groups','project_groups','work_items','invoices','payment_receipts','members']){
    channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`workspace_id=eq.${data.settings.workspaceId}`},(payload)=>{
      const localTable = table === 'work_items' ? 'items' : table === 'deal_groups' ? 'groups' : table === 'project_groups' ? 'projectGroups' : table === 'payment_receipts' ? 'receipts' : table;
      const recId = payload?.new?.id || payload?.old?.id;
      if (recId) {
        const lastPushed = recentLocalPushes.get(`${localTable}:${recId}`);
        if (lastPushed && (Date.now() - lastPushed < 10000)) {
          // Ignore echo of local save to prevent freezing and redundant re-pulls
          return;
        }
      }
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
      timer=setTimeout(()=>{
        if (typeof document !== 'undefined' && document.querySelector('input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing')) {
          isDeferredRemotePull = true;
          return;
        }
        pullRemote().catch(e=>console.warn('Live refresh warning: '+e.message));
      },800);
    });
  }
  channel.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      try {
        await channel.track({
          userId: currentUserId(),
          displayName: data.settings.displayName || 'Samuel',
          catType: data.settings.catType || 'orange',
          onlineAt: Date.now()
        });
      } catch {}

      try {
        await channel.send({
          type: 'broadcast',
          event: 'user_online',
          payload: {
            userId: currentUserId(),
            displayName: data.settings.displayName || 'Samuel',
            catType: data.settings.catType || 'orange',
            timestamp: Date.now(),
            replyRequested: true
          }
        });
      } catch (err) {
        console.warn('Presence broadcast error:', err);
      }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      toast('Live connection interrupted; use Sync now');
    }
  });
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
if(typeof setInterval!=='undefined'){
  setInterval(updateSyncUI,15000);
  setInterval(checkTaskReminders,5000);
  setInterval(updateLiveTaskCountdowns,1000);
}

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
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==='D'||e.key==='d')){
    e.preventDefault();
    toggleTheme();
    return;
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
        const isBlank = selectionCell?.blankOrder != null;
        const targetId = (!isBlank && selected.size) ? [...selected][0] : null;
        pasteCopiedRows(targetId, selectionCell?.blankOrder);
        return;
      }
      if(isCtrl&&key==='d'&&selected.size){
        e.preventDefault();duplicateSelectedRow([...selected][0]);return;
      }
      if(isCtrl&&e.shiftKey&&e.key==='Enter'&&selected.size===1){
        e.preventDefault();insertRowAt([...selected][0],'above');return;
      }
      if(isCtrl&&e.key==='Enter'&&selected.size===1){
        e.preventDefault();insertRowAt([...selected][0],'below');return;
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
  if(rowClipboard.items.length){
    const isBlank = selectionCell?.blankOrder != null;
    const targetId = (!isBlank && selected.size) ? [...selected][0] : null;
    if (isBlank || targetId) {
      e.preventDefault();
      pasteCopiedRows(targetId, selectionCell?.blankOrder);
      return;
    }
  }
  if(!selectionCell)return;
  const value=e.clipboardData?.getData('text/plain');if(!value)return;
  if(selectionCell.blankOrder!=null){pasteBlankGrid(e,{dataset:{blankOrder:String(selectionCell.blankOrder),blankCell:selectionCell.key}});return;}
  if(!selectionCell.id)return;
  if(value.includes('\t')||value.includes('\n'))pasteGrid(e,{dataset:{id:selectionCell.id,cell:selectionCell.key}});
  else{e.preventDefault();editCell(selectionCell.id,selectionCell.key,value);}
});
(async()=>{try{const saved=await window.desk.read();if(saved)data={...structuredClone(defaults),...saved,rentals:saved.rentals||[],rentalItems:saved.rentalItems||[],settings:{...structuredClone(defaults.settings),...(saved.settings||{}),seller:{...defaults.settings.seller,...(saved.settings?.seller||{})}}};ensureDefaultRentalItems();(data.items||[]).forEach(i=>{if(i.serial)i.serial=cleanSerial(i.serial);});consolidateAllReceipts();ensureBankAccounts();syncActiveBankDetails();const topClient=sortedClients()[0]?.id;if(topClient)activeClient=topClient;render();setupSupabase();}catch(e){render();toast('Could not load local data: '+e.message);}})();
