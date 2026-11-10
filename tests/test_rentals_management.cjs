const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

console.log('Testing Rentals Management System (v0.2.80)...');

const repoDir = path.join(__dirname, '..');
const appJsPath = path.join(repoDir, 'app.js');
const indexHtmlPath = path.join(repoDir, 'index.html');
const extrasCssPath = path.join(repoDir, 'extras.css');

const appSource = fs.readFileSync(appJsPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const extrasCss = fs.readFileSync(extrasCssPath, 'utf8');

// Test 1: Navigation and Markup
console.log('--- Test 1: Navigation and index.html markup ---');
assert(indexHtml.includes('<button data-tab="rentals">Rentals</button>'), 'index.html must have Rentals tab button');
assert(appSource.includes("rentals:renderRentals"), 'app.js tab map must include rentals:renderRentals');
assert(appSource.includes("'rentals'"), 'app.js tab order must include rentals');
console.log('✓ Test 1: Navigation button and tab routing verified');

// Test 2: CSS Styles for Calendar, Cards, and Dark Mode
console.log('--- Test 2: CSS styling and Dark Mode ---');
assert(extrasCss.includes('.rentals-wrap'), 'extras.css must include .rentals-wrap');
assert(extrasCss.includes('.rental-cal-grid'), 'extras.css must include .rental-cal-grid');
assert(extrasCss.includes('.rental-cal-cell'), 'extras.css must include .rental-cal-cell');
assert(extrasCss.includes('.rental-cal-card'), 'extras.css must include .rental-cal-card');
assert(extrasCss.includes('.rental-cal-cell.drag-over-date'), 'extras.css must include drag-over-date style');
assert(extrasCss.includes('[data-theme="dark"] .rental-cal-wrap'), 'extras.css must include dark mode styles for calendar');
assert(extrasCss.includes('.highlight-panel-rentals'), 'extras.css must include dashboard rentals styles');
console.log('✓ Test 2: CSS styles for calendar grid, drag-over, and dark mode verified');

// Setup VM sandbox with app.js core functions
const context = {
  console,
  setTimeout: (fn) => fn(),
  clearTimeout: () => {},
  Date,
  Math,
  Number,
  parseInt,
  String,
  Array,
  Set,
  Map,
  window: {},
  document: {
    querySelector: () => null,
    querySelectorAll: () => []
  },
  toast: () => {},
  closeModal: () => {},
  modal: () => {},
  fmtDate: d => d || '—',
  esc: s => String(s ?? ''),
  money: n => '₹' + Number(n || 0).toLocaleString('en-IN'),
  num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
  today: () => '2026-11-10',
  uid: () => 'uid-' + Math.random().toString(36).slice(2, 9),
  render: () => {},
  save: () => {}
};

vm.createContext(context);

// Extract relevant rentals functions from appSource
const neededFunctions = [
  'ensureDefaultRentalItems',
  'parseRentalDateInput',
  'checkDateAvailability',
  'checkItemBookingConflict',
  'syncRentalsToSeller',
  'rentalFinancials',
  'saveRentalBooking',
  'deleteRentalBooking',
  'markRentalPaid',
  'rescheduleRental',
  'saveRentalItem',
  'deleteRentalItem'
];

let sandboxCode = `
let data = {
  rentals: [],
  rentalItems: [],
  clients: [{ id: 'c1', name: 'Junoon by the Sea' }, { id: 'c2', name: 'Purple Tree' }],
  settings: { seller: {} }
};
`;

for (const fnName of neededFunctions) {
  const startRegex = new RegExp(`function\\s+${fnName}\\s*\\(`);
  const match = startRegex.exec(appSource);
  assert(match, `Function ${fnName} must exist in app.js`);
  const startIdx = match.index;
  // find matching end of function block by scanning braces
  let braceCount = 0;
  let inFn = false;
  let endIdx = startIdx;
  for (let i = startIdx; i < appSource.length; i++) {
    if (appSource[i] === '{') {
      braceCount++;
      inFn = true;
    } else if (appSource[i] === '}') {
      braceCount--;
      if (inFn && braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  sandboxCode += '\n' + appSource.slice(startIdx, endIdx) + '\n';
}

vm.runInContext(sandboxCode, context);

// Test 3: Equipment Catalog Defaults
console.log('--- Test 3: Default Equipment Inventory ---');
vm.runInContext('ensureDefaultRentalItems()', context);
const initialItems = vm.runInContext('data.rentalItems', context);
assert(initialItems.length >= 5, 'Default rental catalog must have at least 5 items');
assert(initialItems.some(i => i.name.includes('Aputure') && i.category === 'Lighting'), 'Aputure lighting must exist in catalog');
assert(initialItems.some(i => i.name.includes('JBL') && i.category === 'Sound'), 'JBL sound system must exist in catalog');
console.log(`✓ Test 3: Catalog initialized with ${initialItems.length} default equipment items`);

// Test 4: Natural Date Parsing
console.log('--- Test 4: Natural Date Parsing ---');
assert.equal(vm.runInContext('parseRentalDateInput("2026-11-15")', context), '2026-11-15');
assert.equal(vm.runInContext('parseRentalDateInput("today")', context), '2026-11-10');
assert.equal(vm.runInContext('parseRentalDateInput("15 Nov")', context), '2026-11-15');
assert.equal(vm.runInContext('parseRentalDateInput("3rd Nov")', context), '2026-11-03');
assert.equal(vm.runInContext('parseRentalDateInput("Nov 4")', context), '2026-11-04');
console.log('✓ Test 4: parseRentalDateInput handles ISO, relative dates, and plain word dates (3rd Nov, Nov 4)');

// Test 5: Booking Creation and Bargained Rate Handling
console.log('--- Test 5: Booking Creation with Bargained Amount ---');
const booking1 = {
  itemId: initialItems[0].id,
  itemName: initialItems[0].name,
  clientName: 'Junoon by the Sea',
  bookingDate: '2026-11-15',
  hours: 8,
  standardRate: 4500,
  settledAmount: 4000, // Client bargained ₹500 discount
  paymentStatus: 'advance',
  advanceAmount: 1500,
  expectedPaymentDate: '2026-11-15',
  status: 'booked'
};

vm.runInContext(`saveRentalBooking(${JSON.stringify(booking1)})`, context);
let rentalsList = vm.runInContext('data.rentals', context);
assert.equal(rentalsList.length, 1, 'Booking must be added to data.rentals');
assert.equal(rentalsList[0].settledAmount, 4000, 'Settled bargained amount must be preserved');
assert.equal(rentalsList[0].advanceAmount, 1500, 'Advance amount must be preserved');
console.log('✓ Test 5: Booking created with bargained amount and advance payment');

// Test 6: Conflict and Availability Checking
console.log('--- Test 6: Conflict and Availability Checking ---');
const conflictResult = vm.runInContext(
  `checkItemBookingConflict("${initialItems[0].id}", "${initialItems[0].name}", "2026-11-15")`,
  context
);
assert(conflictResult != null, 'Conflict must be detected when booking the same item on 2026-11-15');
assert(conflictResult.message.includes('already booked on'), 'Warning message must notify user of existing booking');

const noConflict = vm.runInContext(
  `checkItemBookingConflict("${initialItems[0].id}", "${initialItems[0].name}", "2026-11-16")`,
  context
);
assert.equal(noConflict, null, 'No conflict on a different date');

const availNov15 = vm.runInContext('checkDateAvailability("2026-11-15")', context);
assert.equal(availNov15.isBlocked, true, 'Date 2026-11-15 must show as blocked');
assert.equal(availNov15.blockedRentals.length, 1, '1 rental is blocked on 2026-11-15');
assert(availNov15.availableItems.every(i => i.id !== initialItems[0].id), 'Booked item must be excluded from available items');

const availNov20 = vm.runInContext('checkDateAvailability("2026-11-20")', context);
assert.equal(availNov20.isBlocked, false, 'Date 2026-11-20 must have zero conflicts');
assert.equal(availNov20.availableItems.length, initialItems.length, 'All items must be available on unbooked date');
console.log('✓ Test 6: Conflict detection and date availability checker verified');

// Test 7: Drag & Drop Rescheduling
console.log('--- Test 7: Drag and Drop Rescheduling ---');
const bookingId = rentalsList[0].id;
vm.runInContext(`rescheduleRental("${bookingId}", "2026-11-18")`, context);
rentalsList = vm.runInContext('data.rentals', context);
assert.equal(rentalsList[0].bookingDate, '2026-11-18', 'Booking date must update to 2026-11-18 after reschedule');
assert.equal(rentalsList[0].expectedPaymentDate, '2026-11-18', 'Payment expectation date must update after reschedule');

// Now 2026-11-15 is free again!
const recheckNov15 = vm.runInContext('checkDateAvailability("2026-11-15")', context);
assert.equal(recheckNov15.isBlocked, false, 'Previous date 2026-11-15 must now be unblocked');
console.log('✓ Test 7: Rescheduling via drag and drop updates booking date and clears previous blocked date');

// Test 8: Financial Calculations and Revenue Wiring
console.log('--- Test 8: Financial Calculations and Revenue Wiring ---');
// Add another fully paid booking
const booking2 = {
  itemId: initialItems[1].id,
  itemName: initialItems[1].name,
  clientName: 'Purple Tree',
  bookingDate: '2026-11-22',
  hours: 12,
  standardRate: 6000,
  settledAmount: 6000,
  paymentStatus: 'paid',
  advanceAmount: 6000,
  expectedPaymentDate: '2026-11-22',
  status: 'booked'
};
vm.runInContext(`saveRentalBooking(${JSON.stringify(booking2)})`, context);

const rf = vm.runInContext('rentalFinancials()', context);
// Booking 1: settled 4000, advance 1500 (awaiting 2500)
// Booking 2: settled 6000, paid 6000 (awaiting 0)
assert.equal(rf.totalBookings, 2, 'Total active bookings must be 2');
assert.equal(rf.totalBooked, 10000, 'Total booked revenue value must be 10000 (4000 + 6000)');
assert.equal(rf.received, 7500, 'Cash received must be 7500 (1500 advance + 6000 paid)');
assert.equal(rf.awaiting, 2500, 'Awaiting cashflow must be 2500 (4000 - 1500)');
assert.equal(rf.upcomingSchedule.length, 2, 'Upcoming cashflow schedule must have 2 entries');
assert.equal(rf.upcomingSchedule[0].bookingDate, '2026-11-18', 'Schedule must be chronologically ordered');
console.log('✓ Test 8: Financials correctly compute total booked (₹10,000), cash received (₹7,500), and awaiting (₹2,500)');

// Test 9: Mark Paid
console.log('--- Test 9: Mark Paid Action ---');
vm.runInContext(`markRentalPaid("${bookingId}")`, context);
const rfAfterPaid = vm.runInContext('rentalFinancials()', context);
assert.equal(rfAfterPaid.received, 10000, 'After marking paid, full 10,000 is received');
assert.equal(rfAfterPaid.awaiting, 0, 'After marking paid, awaiting balance is 0');
console.log('✓ Test 9: Mark Paid action updates revenue and clears outstanding balance');

// Test 10: Delete Booking CRUD Operation
console.log('--- Test 10: Delete Booking CRUD Operation ---');
vm.runInContext(`deleteRentalBooking("${bookingId}", true)`, context);
const rfAfterDelete = vm.runInContext('rentalFinancials()', context);
assert.equal(rfAfterDelete.totalBookings, 1, 'After delete, total bookings must be 1');
assert.equal(rfAfterDelete.totalBooked, 6000, 'Total booked value must drop by deleted booking');
console.log('✓ Test 10: Delete rental booking cleanly removes booking and updates revenue');

// Test 11: Catalog Item Add and Delete
console.log('--- Test 11: Equipment Catalog CRUD ---');
const newEquip = {
  id: 'equip-smoke-1',
  name: 'Dry Ice Low Fog Machine',
  category: 'Effects',
  rate: 3500,
  rateType: 'day',
  description: 'Creates heavy cloud-like ground fog'
};
vm.runInContext(`saveRentalItem(${JSON.stringify(newEquip)})`, context);
let updatedCatalog = vm.runInContext('data.rentalItems', context);
assert(updatedCatalog.some(i => i.id === 'equip-smoke-1'), 'New equipment must be in catalog');

vm.runInContext('deleteRentalItem("equip-smoke-1")', context);
updatedCatalog = vm.runInContext('data.rentalItems', context);
assert(!updatedCatalog.some(i => i.id === 'equip-smoke-1'), 'Deleted equipment must be removed from catalog');
console.log('✓ Test 11: Adding and deleting items in equipment catalog verified');

// Test 12: Individual Customer Booking (Zero Client Tab Pollution)
console.log('--- Test 12: Individual Customer Rental (Zero Worksheet Contamination) ---');
const clientsBefore = vm.runInContext('data.clients.length', context);
const indBooking = {
  itemId: initialItems[0].id,
  itemName: initialItems[0].name,
  clientName: 'Sanjay Deshmukh (One-off individual renter)',
  bookingDate: '2026-11-25',
  hours: 6,
  standardRate: 4500,
  settledAmount: 4500,
  paymentStatus: 'pending',
  status: 'booked'
};
vm.runInContext(`saveRentalBooking(${JSON.stringify(indBooking)})`, context);
const clientsAfter = vm.runInContext('data.clients.length', context);
assert.equal(clientsAfter, clientsBefore, 'Individual rental customer must NOT add a client worksheet tab');
const recordedRental = vm.runInContext('data.rentals.find(r => r.clientName.includes("Sanjay Deshmukh"))', context);
assert(recordedRental != null, 'Rental record with individual name must be saved in data.rentals');
console.log('✓ Test 12: Individual customer booking safely recorded without creating worksheet tabs');

// Test 13: CSS Verification for Month Badge and Schedule View
console.log('--- Test 13: CSS Verification for Green Month Badge & Schedule ---');
assert(extrasCss.includes('.rental-month-badge'), 'extras.css must include .rental-month-badge');
assert(extrasCss.includes('background-color: #16a34a') || extrasCss.includes('background: #16a34a'), 'Month badge must have green circle background');
assert(extrasCss.includes('.rental-schedule-wrap'), 'extras.css must include .rental-schedule-wrap');
assert(extrasCss.includes('.rental-schedule-card'), 'extras.css must include .rental-schedule-card');
assert(extrasCss.includes('.rental-detail-modal'), 'extras.css must include .rental-detail-modal');
assert(extrasCss.includes('.catalog-table'), 'extras.css must include .catalog-table');
console.log('✓ Test 13: Green month badge and schedule CSS classes verified');

console.log('\nALL 13 RENTALS MANAGEMENT TESTS PASSED SUCCESSFULLY! 🎉📦📅');
