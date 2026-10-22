const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const take=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const context={
  data:{clients:[{id:'c',name:'Client'}],groups:[{id:'g',label:'Deal',agreedAmount:900}],projectGroups:[],
    items:[{id:'a',clientId:'c',groupId:'g',status:'sent',quotedTotal:600,advanceAmount:100},{id:'b',clientId:'c',groupId:'g',status:'sent',quotedTotal:600,advanceAmount:0}],invoices:[],receipts:[]},
  selected:new Set(['a','b']),num:v=>Number(v)||0,uid:(()=>{let n=0;return()=>`receipt-${++n}`;})(),today:()=> '2026-10-22',
  currentUserId:()=> 'user',enqueue:()=>{},save:()=>{},scheduleSync:()=>{},render:()=>{},toast:()=>{},invoiceAdvance:()=>0,
};
vm.createContext(context);
vm.runInContext(take('function effectiveItemValue(', 'function assign(')+take('function bulkSetStatus(', 'function modal('),context);
vm.runInContext("bulkSetStatus('paid',null,{kind:'deal',id:'g',label:'Deal'})",context);
assert.equal(context.data.receipts.length,1,'group payment creates one receipt');
assert.equal(context.data.receipts[0].amount,800,'negotiated amount minus advance');
assert.equal(context.data.receipts[0].description,'Deal');
assert.equal(context.data.items.every(i=>i.status==='paid'&&i.paidAtTs),true,'every group row is paid and timestamped');
context.selected=new Set(['a','b']);
vm.runInContext("bulkSetStatus('paid')",context);
assert.equal(context.data.receipts.length,1,'marking paid twice does not duplicate cash');
console.log('Payment receipt rules passed');
