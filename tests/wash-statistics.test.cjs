const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const filename = require('node:path').resolve(__dirname, '../lib/wash-statistics.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,filename);
const {newStatistics,observeStatistics,monthKey,periodTotals,HISTORY_LIMIT} = compiled.exports;
const STATE='BSH.Common.Status.OperationState', ACTIVE='BSH.Common.Root.ActiveProgram',
  SELECTED='BSH.Common.Root.SelectedProgram', TEMP='LaundryCare.Washer.Option.Temperature',
  SPIN='LaundryCare.Washer.Option.SpinSpeed', COUNT='BSH.Common.Status.Program.All.Count.Started';
const initial = () => newStatistics(new Date('2026-11-01T08:00:00Z'));
function observe(stats,state,minute=0,extras={},continuous=true) {
  return observeStatistics(stats,{...(state?{[STATE]:state}:{}),...extras},
    new Date(Date.parse('2026-11-01T08:00:00Z')+minute*60000),'Europe/Prague',continuous);
}
function start(extras={}) {
  return observe(observe(initial(),'Ready',0,extras),'Run',1,{[ACTIVE]:'LaundryCare.Washer.Program.Cotton',
    [TEMP]:'GC40',[SPIN]:'RPM800'});
}
test('completed cycle captures options independent of batch order and pause/resume counts once',()=>{
  let s=start();
  s=observe(s,'Pause',20);s=observe(s,'Run',25);
  s=observe(s,'Finished',91,{[TEMP]:'GC60',[ACTIVE]:'None'});
  assert.equal(s.totals.completed,1);
  assert.equal(s.totals.programs.Cotton,1);
  assert.equal(s.history[0].temperature,'GC40');
  assert.equal(s.history[0].durationMinutes,90);
  assert.equal(s.history[0].spinSpeed,'RPM800');
  const before=structuredClone(s);
  s=observe(s,'Finished',92);
  assert.equal(s.history.length,1);
  assert.deepEqual(before.totals,s.totals);
});
test('terminal state at installation does not fabricate a cycle',()=>{
  assert.equal(observe(initial(),'Finished',0,{},false).totals.completed,0);
});
test('restart while running resumes persisted cycle and excludes uncertain duration',()=>{
  let s=JSON.parse(JSON.stringify(start()));
  s=observe(s,'Run',40,{},false);
  s=observe(s,'Finished',100);
  assert.equal(s.totals.completed,1);assert.equal(s.totals.timedCycles,0);
  assert.equal(s.history[0].partial,true);
  s=observe(JSON.parse(JSON.stringify(s)),'Finished',120,{},false);
  assert.equal(s.totals.completed,1);
});
test('restart after a completed cycle counts once and omits uncertain end time duration',()=>{
  const s=observe(start(),'Finished',140,{},false);
  assert.equal(s.totals.completed,1);
  assert.equal(s.history[0].durationMinutes,null);
});
test('installing during a run captures a partial cycle',()=>{
  const s=observe(observe(initial(),'Run',5,{[ACTIVE]:'Cotton'},false),'Finished',100);
  assert.equal(s.totals.completed,1);assert.equal(s.totals.timedCycles,0);
});
test('abort and missing terminal state remain separate from completed washes',()=>{
  let s=observe(start(),'Aborting',10);
  s=observe(s,'Ready',11);s=observe(s,'Run',12);s=observe(s,'Inactive',30);
  assert.equal(s.totals.completed,0);assert.equal(s.totals.aborted,1);assert.equal(s.totals.unknown,1);
  assert.deepEqual(s.totals.programs,{});
});
test('delayed start is not a wash until Run',()=>{
  let s=observe(initial(),'Ready');
  s=observe(s,'DelayedStart',1);
  assert.equal(s.active,null);
  s=observe(s,'Ready',5);
  assert.equal(s.history.length,0);
});
test('late counter increment belongs to the current cycle; a further increment reveals a missed cycle',()=>{
  let s=start({[COUNT]:10});
  s=observe(s,null,5,{[COUNT]:11});
  assert.equal(s.history.length,0);
  assert.equal(s.active.startedCounter,11);
  s=observe(s,'Run',200,{[COUNT]:12});
  assert.equal(s.totals.unknown,1);
  assert.ok(s.active);
  assert.equal(s.active.partial,true);
  s=observe(s,'Finished',260);
  assert.equal(s.totals.completed,1);assert.equal(s.totals.unknown,1);
});
test('program/options arriving after Run update the active cycle, selection alone does not change it',()=>{
  let s=observe(observe(initial(),'Ready',0,{[SELECTED]:'Cotton'}),'Run',1);
  s=observe(s,null,2,{[ACTIVE]:'Eco4060',[TEMP]:'GC40',[SPIN]:'RPM1200',
    'LaundryCare.Common.Option.VarioPerfect':'SpeedPerfect'});
  s=observe(s,null,3,{[SELECTED]:'Rinse'});
  s=observe(s,'Finished',100);
  assert.equal(s.totals.programs.Eco4060,1);
  assert.equal(s.totals.speedPerfect,1);
  assert.equal(s.history[0].spinSpeed,'RPM1200');
});
test('month boundaries use Homey time zone and period aggregation includes only selected periods',()=>{
  assert.equal(monthKey(new Date('2026-10-31T23:30:00Z'),'Europe/Prague'),'2026-11');
  assert.equal(monthKey(new Date('2026-10-31T23:30:00Z'),'America/New_York'),'2026-10');
  let s=observe(start(),'Finished',10);
  s.months['2025-11']={...s.months['2026-11'],completed:7};
  assert.equal(periodTotals(s,'2026').completed,1);
  assert.equal(periodTotals(s,'2026-11').completed,1);
  assert.equal(periodTotals(s,'2027').completed,0);
});
test('history cap never discards lifetime/month totals or last completed wash',()=>{
  let s=observe(start(),'Finished',10);
  for(let i=0;i<HISTORY_LIMIT+1;i++){
    s=observe(s,'Ready',11+i*3);s=observe(s,'Run',12+i*3);
    s=observe(s,'Aborting',13+i*3);
  }
  assert.equal(s.history.length,HISTORY_LIMIT);
  assert.equal(s.totals.completed,1);assert.equal(s.totals.aborted,HISTORY_LIMIT+1);
  assert.equal(s.lastCompleted.program,'Cotton');
});
test('reducer does not mutate persisted input',()=>{
  const s=start(), before=JSON.stringify(s);
  observe(s,'Finished',50);
  assert.equal(JSON.stringify(s),before);
});
