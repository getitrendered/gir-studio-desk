const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setupTestEnvironment() {
  const context = {
    data: {
      clients: [{ id: 'c1', name: 'Bling it on' }, { id: 'c2', name: 'TAYARI EVENTS' }],
      groups: [],
      projectGroups: [],
      items: [
        { id: 'i1', clientId: 'c1', service: '3D MANDAP', quantity: 1, rate: 3000, quotedTotal: 3000, status: 'sent' },
        { id: 'i2', clientId: 'c1', service: 'STAGE DESIGN', quantity: 2, rate: 4000, quotedTotal: 8000, status: 'working' },
        { id: 'i3', clientId: 'c2', service: 'LIGHTING', quantity: 1, rate: 7000, quotedTotal: 7000, status: 'paid' }
      ],
      invoices: [],
      receipts: [],
      members: [
        { userId: 'user-me', displayName: 'Samuel', avatarData: '' },
        { userId: 'user-partner', displayName: 'Mezrid', avatarData: '', catType: 'black' }
      ],
      chatMessages: [],
      pending: [],
      pendingDeletes: [],
      settings: { workspaceId: 'ws-test', displayName: 'Samuel', localPartner: 'Mezrid', catType: 'orange' }
    },
    selected: new Set(),
    collapsedGroups: new Set(),
    tab: 'sheet',
    activeClient: 'c1',
    filter: 'all',
    unreadChatCount: 0,
    lastPartnerOnlineTime: 0,
    pendingChatAttachment: null,
    activeStickerTab: 'moving',
    stickerSearchQuery: '',
    uid: (() => { let n = 0; return () => `uid-${++n}`; })(),
    undoStack: [],
    redoStack: [],
    money: n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
    num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
    esc: v => String(v ?? ''),
    cleanSerial: v => String(v || ''),
    fmtDate: d => d ? `${d.slice(8,10)} ${d.slice(5,7)} ${d.slice(0,4)}` : '—',
    displayStatus: it => (it.status || 'pending').toUpperCase(),
    person: id => id || 'Someone',
    initials: name => String(name || '?').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase(),
    avatar: (id, name, size = '', customSrc = '') => {
      const isMe = id === context.currentUserId() || id === 'local-me';
      const isPartner = id === 'local-partner' || id === 'partner';
      const member = (context.data.members || []).find(m => m.userId === id) || (!isMe ? (context.data.members || []).find(m => m.userId !== context.currentUserId()) : null);
      let src = customSrc;
      if (!src) {
        if (isMe) src = context.data.settings.avatarData || member?.avatarData || '';
        else if (isPartner) src = member?.avatarData || context.data.settings.partnerAvatarData || '';
        else src = member?.avatarData || (id === context.currentUserId() ? context.data.settings.avatarData : '');
      }
      const isValid = src && (/^data:image\/(?:png|jpeg|webp);base64,/i.test(src) || src.startsWith('http') || src.startsWith('assets/'));
      return isValid ? `<img class="avatar-image ${size}" src="${src}" alt="${name}">` : `<span>${context.initials(name)}</span>`;
    },
    currentClient: () => context.data.clients.find(c => c.id === context.activeClient),
    clientItems: () => context.data.items.filter(i => i.clientId === context.activeClient),
    groupedSheetItems: items => items,
    today: () => '2026-10-29',
    currentUserId: () => 'user-me',
    save: () => {},
    scheduleSync: () => {},
    render: () => {},
    toast: msg => { context.lastToast = msg; },
    inputValue: id => context.elements['#' + id]?.value || '',
    smartNotify: async opts => { context.lastSmartNotify = opts; },
    playCatChime: () => {},
    playChatChime: () => {},
    getCatLottie: async () => ({}),
    modalHtml: '',
    modalTitle: '',
    modal: (title, body, actions) => {
      context.modalTitle = title;
      context.modalHtml = body + (actions || '');
    },
    closeModal: () => {
      context.modalTitle = '';
      context.modalHtml = '';
    },
    elements: {},
    $: selector => {
      if (!context.elements[selector]) {
        context.elements[selector] = {
          value: '',
          style: {},
          classList: {
            add: () => {},
            remove: () => {},
            toggle: () => {}
          },
          addEventListener: () => {},
          removeEventListener: () => {}
        };
      }
      return context.elements[selector];
    },
    $$: selector => [],
    window: { bodymovin: null },
    document: {
      getElementById: id => context.elements['#' + id] || null,
      createElement: tag => {
        const el = {
          tagName: tag,
          id: '',
          className: '',
          innerHTML: '',
          style: {},
          classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); el.className += ' ' + c; },
            remove(c) { this.classes.delete(c); el.className = [...this.classes].join(' '); },
            contains(c) { return this.classes.has(c); }
          }
        };
        return el;
      },
      body: {
        appendChild: el => {
          if (el.id) context.elements['#' + el.id] = el;
        }
      },
      querySelector: () => null,
      querySelectorAll: () => []
    },
    requestAnimationFrame: fn => fn(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id)
  };

  vm.createContext(context);

  const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

  const codeToRun =
    take('const CAT_REACTIONS = [', 'let catLottieCache = {};')
      .replace('const CAT_REACTIONS =', 'CAT_REACTIONS =')
      .replace('const ALL_CAT_MOVING_STICKERS =', 'ALL_CAT_MOVING_STICKERS =')
      .replace('const ALL_CAT_STATIC_STICKERS =', 'ALL_CAT_STATIC_STICKERS =') +
    take('// --- TEAM CHAT & WORK SHARING APPLICATION ---', 'function openCatReactionPicker(') +
    take('let bannerRightTimer = null;', 'async function triggerCatPing(');

  vm.runInContext(codeToRun, context);
  return context;
}

console.log('Testing Team Chat, Work Sharing, and Cat Stickers...');

// Test 1: Catalogs have 30 reactions and 120+ moving and static stickers
{
  const ctx = setupTestEnvironment();
  assert.equal(ctx.CAT_REACTIONS.length, 30, 'Should have all 30 reactions');
  assert.equal(ctx.ALL_CAT_MOVING_STICKERS.length, 120, 'Should have 120 moving stickers (30 x 4 colors)');
  assert.equal(ctx.ALL_CAT_STATIC_STICKERS.length, 120, 'Should have 120 static stickers (30 x 4 colors)');
  
  // Verify moving stickers point to assets/cats/moving/ and isAnimated is true
  ctx.ALL_CAT_MOVING_STICKERS.forEach(s => {
    assert.equal(s.isAnimated, true, `${s.id} moving must be animated`);
    assert(s.url.startsWith('assets/cats/moving/'), `${s.id} url must point to assets/cats/moving/`);
    assert(fs.existsSync(path.join(__dirname, '..', s.url)), `${s.url} must exist on disk`);
  });

  // Verify static stickers point to assets/cats/static/ and isAnimated is false
  ctx.ALL_CAT_STATIC_STICKERS.forEach(s => {
    assert.equal(s.isAnimated, false, `${s.id} static must not be animated`);
    assert(s.url.startsWith('assets/cats/static/'), `${s.id} url must point to assets/cats/static/`);
    assert(fs.existsSync(path.join(__dirname, '..', s.url)), `${s.url} must exist on disk`);
  });

  console.log(`✓ Test 1: Cat catalogs verified (30 reactions, ${ctx.ALL_CAT_MOVING_STICKERS.length} moving, ${ctx.ALL_CAT_STATIC_STICKERS.length} static on disk)`);
}

// Test 2: Dual in-app reaction banners position on right for self and left for partner
{
  const ctx = setupTestEnvironment();

  // Self ping
  ctx.displayCatReactionBanner({
    senderId: 'user-me',
    senderName: 'Samuel',
    catType: 'orange',
    reactionKey: 'shy',
    title: 'Shy / Blushing',
    message: 'The cat is blushing shyly! 😳'
  });

  const rightBanner = ctx.elements['#catLiveBannerRight'];
  assert(rightBanner, 'Self sent reaction must create #catLiveBannerRight');
  assert(rightBanner.className.includes('banner-right'), 'Must have banner-right class');
  assert(rightBanner.innerHTML.includes('You sent a cat reaction!'));

  // Partner ping
  ctx.displayCatReactionBanner({
    senderId: 'user-partner',
    senderName: 'Mezrid',
    catType: 'black',
    reactionKey: 'love',
    title: 'Love / Appreciated',
    message: 'Sending love!'
  });

  const leftBanner = ctx.elements['#catLiveBannerLeft'];
  assert(leftBanner, 'Partner sent reaction must create #catLiveBannerLeft');
  assert(leftBanner.className.includes('banner-left'), 'Must have banner-left class');
  assert(leftBanner.className.includes('banner-black'), 'Black cat must have banner-black class');
  assert(leftBanner.innerHTML.includes('Mezrid pinged you!'));

  console.log('✓ Test 2: Dual banner alignment verified (right for self, left for partner, zero overlap)');
}

// Test 3: Chat Tab Rendering
{
  const ctx = setupTestEnvironment();
  ctx.lastPartnerOnlineTime = Date.now(); // partner is online
  const html = ctx.renderChat();
  assert(html.includes('chat-container'), 'Should render chat container');
  assert(html.includes('Mezrid'), 'Should display partner name');
  assert(html.includes('Online now'), 'Should display green online indicator');
  assert(html.includes('chatInputText'), 'Should include chat input textarea');
  assert(html.includes('chatSendBtn'), 'Should include send button');
  assert(html.includes('attachWorkTopBtn'), 'Should include share work button');
  console.log('✓ Test 3: renderChat UI structure verified');
}

// Test 4: Sending and receiving text messages
{
  const ctx = setupTestEnvironment();
  let broadcastMsg = null;
  ctx.channel = {
    send: ({ payload }) => { broadcastMsg = payload; }
  };

  // Self sends text
  ctx.elements['#chatInputText'] = { value: 'Hey Mezrid, can we review Bling it on numbers?' };
  ctx.handleSendChatMessage();

  assert.equal(ctx.data.chatMessages.length, 1);
  const sent = ctx.data.chatMessages[0];
  assert.equal(sent.type, 'text');
  assert.equal(sent.text, 'Hey Mezrid, can we review Bling it on numbers?');
  assert.equal(sent.senderId, 'user-me');
  assert.deepEqual(broadcastMsg, sent, 'Must broadcast over channel');

  // Partner sends reply
  ctx.tab = 'sheet'; // currently looking at worksheet
  ctx.handleIncomingChatMessage({
    id: 'm-2',
    senderId: 'user-partner',
    senderName: 'Mezrid',
    catType: 'black',
    timestamp: Date.now(),
    type: 'text',
    text: 'Yes! Checking now.'
  });

  assert.equal(ctx.data.chatMessages.length, 2);
  assert.equal(ctx.unreadChatCount, 1, 'Should increment unread count');
  assert(ctx.lastSmartNotify, 'Should trigger smart notification when not on chat tab');
  console.log('✓ Test 4: Real-time text messaging and unread notification badge verified');
}

// Test 5: Sending and rendering sticker messages
{
  const ctx = setupTestEnvironment();
  const sticker = ctx.ALL_CAT_MOVING_STICKERS.find(s => s.key === 'party');
  ctx.sendStickerChatMessage(sticker);

  assert.equal(ctx.data.chatMessages.length, 1);
  const msg = ctx.data.chatMessages[0];
  assert.equal(msg.type, 'sticker');
  assert.equal(msg.sticker.key, 'party');
  assert.equal(msg.sticker.format, 'image');
  assert.equal(msg.sticker.isAnimated, true);
  assert.equal(msg.sticker.url, 'assets/cats/moving/orange/party.webp');

  const threadHtml = ctx.renderChatMessagesList(ctx.data.chatMessages);
  assert(threadHtml.includes('assets/cats/moving/orange/party.webp'));
  assert(threadHtml.includes('chat-sticker-img'));
  console.log('✓ Test 5: Cat sticker messaging and WebP bubble rendering verified');
}

// Test 6: Worksheet multi-row "Share in chat" and jump back
{
  const ctx = setupTestEnvironment();
  ctx.selected.add('i1');
  ctx.selected.add('i2');

  ctx.elements['#shareChatNote'] = { value: 'Are these two quotes approved?' };
  ctx.shareSelectedRowsInChat();

  assert(ctx.modalTitle.includes('Share in Team Chat'));
  ctx.$('#confirmShareChat').onclick();

  assert.equal(ctx.tab, 'chat', 'Should switch to chat tab');
  assert.equal(ctx.data.chatMessages.length, 1);
  const workCardMsg = ctx.data.chatMessages[0];
  assert.equal(workCardMsg.type, 'work_card');
  assert.equal(workCardMsg.workCard.clientId, 'c1');
  assert.equal(workCardMsg.workCard.itemCount, 2);
  assert.equal(workCardMsg.workCard.totalAmount, 11000); // 3000 + 8000
  assert.equal(workCardMsg.text, 'Are these two quotes approved?');

  // Verify jump to sheet
  ctx.jumpToWorkCardInSheet('c1', ['i1', 'i2']);
  assert.equal(ctx.tab, 'sheet');
  assert.equal(ctx.activeClient, 'c1');
  assert(ctx.selected.has('i1'));
  assert(ctx.selected.has('i2'));
  console.log('✓ Test 6: Worksheet multi-row "Share in chat" and "View in sheet" jump verified');
}

// Test 7: Attach work from any client modal
{
  const ctx = setupTestEnvironment();
  ctx.openAttachWorkDialog();
  assert(ctx.modalTitle.includes('Attach Work to Chat'));
  assert(ctx.modalHtml.includes('attach-work-table-wrap'), 'Must use attach-work-table-wrap container');
  assert(ctx.modalHtml.includes('attach-work-row'), 'Must use attach-work-row items');
  assert(ctx.modalHtml.includes('attach-work-service'), 'Must style service name legibly');
  assert(ctx.modalHtml.includes('attach-work-price'), 'Must style price legibly');

  // Attach row i3 from c2
  ctx.pendingChatAttachment = {
    clientId: 'c2',
    clientName: 'TAYARI EVENTS',
    itemCount: 1,
    totalAmount: 7000,
    items: [{ id: 'i3', service: 'LIGHTING', quantity: 1, rate: 7000, quotedTotal: 7000, status: 'paid' }]
  };

  ctx.elements['#chatInputText'] = { value: 'Paid for lighting' };
  ctx.handleSendChatMessage();

  assert.equal(ctx.data.chatMessages.length, 1);
  const msg = ctx.data.chatMessages[0];
  assert.equal(msg.type, 'work_card');
  assert.equal(msg.workCard.clientName, 'TAYARI EVENTS');
  assert.equal(msg.text, 'Paid for lighting');
  assert.equal(ctx.pendingChatAttachment, null, 'Attachment should clear after sending');
  console.log('✓ Test 7: Attach work modal UI readability and selection verified');
}

// Test 8: Display proper names and profile avatar images in chat header and message bubbles
{
  const ctx = setupTestEnvironment();
  ctx.data.settings.displayName = 'Samuel Profile';
  ctx.data.settings.avatarData = 'data:image/jpeg;base64,samuelProfileImgBase64';

  const partnerMember = ctx.data.members.find(m => m.userId === 'user-partner');
  partnerMember.displayName = 'Mezrid Partner';
  partnerMember.avatarData = 'data:image/jpeg;base64,mezridProfileImgBase64';

  // Render chat
  const chatHtml = ctx.renderChat();
  assert(chatHtml.includes('Samuel Profile'), 'Header must show own profile name');
  assert(chatHtml.includes('Mezrid Partner'), 'Header must show partner profile name');
  assert(chatHtml.includes('samuelProfileImgBase64'), 'Header must show own avatar image from settings');
  assert(chatHtml.includes('mezridProfileImgBase64'), 'Header must show partner avatar image');
  assert(chatHtml.includes('chat-self-badge'), 'Header must include self profile chip');

  // Send message from self
  ctx.elements['#chatInputText'] = { value: 'Checking the profile integration' };
  ctx.handleSendChatMessage();

  // Receive message from partner
  ctx.handleIncomingChatMessage({
    id: 'm-partner-1',
    senderId: 'user-partner',
    senderName: 'Mezrid Partner',
    senderAvatar: 'data:image/jpeg;base64,mezridProfileImgBase64',
    catType: 'black',
    timestamp: Date.now(),
    type: 'text',
    text: 'Profile avatar and name are working!'
  });

  const threadHtml = ctx.renderChatMessagesList(ctx.data.chatMessages);
  // Self message checks
  assert(threadHtml.includes('Samuel Profile (You)'), 'Outgoing bubble must show proper display name with (You)');
  assert(threadHtml.includes('samuelProfileImgBase64'), 'Outgoing bubble must display profile avatar image');

  // Partner message checks
  assert(threadHtml.includes('Mezrid Partner'), 'Incoming bubble must show partner proper display name');
  assert(threadHtml.includes('mezridProfileImgBase64'), 'Incoming bubble must display partner profile avatar image');

  console.log('✓ Test 8: Profile names and avatar images verified in chat header & thread');
}

console.log('\nALL CHAT, WORK SHARING, AND CAT STICKER TESTS PASSED! 🎉');
