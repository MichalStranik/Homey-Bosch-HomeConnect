const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file,requireFn,extra={}) {
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:requireFn,structuredClone,Intl,Date,...extra},{filename:file});
  return module.exports;
}
const logic=load('lib/wash-statistics.ts',require);
let currentTime='2026-11-01T08:00:00Z';
class ClockDate extends Date {constructor(...args){super(...(args.length?args:[currentTime]));}}
class Base {
  constructor(store={}) {
    this.store=store;this.capabilities={};this.events=[];this.intervals=new Set();this.errors=[];
    this.error=error=>this.errors.push(error);
    this.homey={
      clock:{getTimezone:()=> 'Europe/Prague'},
      __:key=>key,
      setInterval:callback=>{this.intervals.add(callback);return callback;},
      clearInterval:callback=>this.intervals.delete(callback),
      flow:{getDeviceTriggerCard:()=>({trigger:async(device,tokens)=>{
        assert.equal(device.store.washStatistics.totals.completed,tokens.completed);
        this.events.push(tokens);
      }})},
    };
  }
  getStoreValue(key){return this.store[key];}
  async setStoreValue(key,value){if(this.failStore)throw new Error('Storage failed');this.store[key]=structuredClone(value);}
  hasCapability(key){return Object.hasOwn(this.capabilities,key);}
  async addCapability(key){this.capabilities[key]=null;}
  getCapabilityValue(key){return this.capabilities[key];}
  async setCapabilityValue(key,value){this.capabilities[key]=value;}
  async onInit(){this.onConnectionOpened();}
  async onUninit(){}
  async onDeleted(){}
}
const Washer=load('drivers/washer/device.ts',id=>{
  if(id.endsWith('/appliance-device'))return {ApplianceDevice:Base};
  if(id.endsWith('/wash-statistics'))return logic;
  throw new Error('Unexpected import '+id);
},{Date:ClockDate});
const STATE='BSH.Common.Status.OperationState';
test('existing devices migrate counters; persisted cycle updates device/Flow and survives restart',async()=>{
  currentTime='2026-11-01T08:00:00Z';
  const device=new Washer();await device.onInit();
  assert.equal(device.capabilities.homeconnect_washes_completed,0);
  await device.onValuesReceived({[STATE]:'Ready'});
  await device.onValuesReceived({[STATE]:'Run',
    'BSH.Common.Root.ActiveProgram':'Cotton','LaundryCare.Washer.Option.Temperature':'GC40'});
  const restored=new Washer(device.store);await restored.onInit();
  await restored.onValuesReceived({[STATE]:'Run'});
  currentTime='2026-11-01T10:00:00Z';
  await restored.onValuesReceived({[STATE]:'Finished'});
  assert.equal(restored.capabilities.homeconnect_washes_completed,1);
  assert.equal(restored.capabilities.homeconnect_washes_month,1);
  assert.equal(restored.capabilities.homeconnect_last_wash,'Cotton · 40 °C');
  assert.equal(restored.events.length,1);
  await restored.onValuesReceived({[STATE]:'Finished'});
  assert.equal(restored.events.length,1);
  const snapshot=restored.getWashStatistics();snapshot.totals.completed=999;
  assert.equal(restored.getWashStatistics().totals.completed,1);
  currentTime='2026-12-01T00:00:00Z';
  for(const callback of restored.intervals)await callback();
  // Timer deliberately catches errors; allow capability writes to complete.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(restored.capabilities.homeconnect_washes_month,0);
  await restored.onUninit();assert.equal(restored.intervals.size,0);
});
test('failed persistence publishes neither speculative counters nor Flow events',async()=>{
  currentTime='2026-11-01T08:00:00Z';
  const device=new Washer();await device.onInit();
  await device.onValuesReceived({[STATE]:'Ready'});
  await device.onValuesReceived({[STATE]:'Run'});
  device.failStore=true;
  await assert.rejects(device.onValuesReceived({[STATE]:'Finished'}),/Storage failed/);
  assert.equal(device.getWashStatistics().totals.completed,0);
  assert.equal(device.capabilities.homeconnect_washes_completed,0);
  assert.equal(device.events.length,0);
  device.failStore=false;
  await device.onValuesReceived({[STATE]:'Finished'});
  assert.equal(device.capabilities.homeconnect_washes_completed,1);
});
test('all new UI and capability labels exist across target locales',()=>{
  const root=path.resolve(__dirname,'..');
  const strings=['en','nl','de'].map(locale=>JSON.parse(fs.readFileSync(path.join(root,'locales',locale+'.json'),'utf8')));
  const keys=Object.keys(strings[0].statistics).sort();
  for(const data of strings)assert.deepEqual(Object.keys(data.statistics).sort(),keys);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'.homeycompose/app.json'),'utf8'));
  assert.equal(manifest.api.getStatistics.public,false);
  for(const id of logic.STATISTICS_CAPABILITIES){
    const cap=JSON.parse(fs.readFileSync(path.join(root,'.homeycompose/capabilities',id+'.json'),'utf8'));
    for(const language of ['en','nl','de'])assert.ok(cap.title[language]);
  }
});
