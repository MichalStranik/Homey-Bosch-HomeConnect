const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const browser = process.env.STATS_TEST_BROWSER ||
  ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
   'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
test('settings dashboard renders HTML, periods, paging, multiple devices and API errors',
  {skip:!browser,timeout:45000}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'homeconnect-stats-'));
  try {
    const root = path.resolve(__dirname,'..');
    const labels = JSON.parse(fs.readFileSync(path.join(root,'locales/en.json'),'utf8'));
    const totals = {completed:25,aborted:1,unknown:1,durationMinutes:2500,timedCycles:25,
      programs:{'<img src=x onerror=alert(1)>':25},temperatures:{GC40:25},spinSpeeds:{RPM800:25},speedPerfect:3};
    const stats = {version:1,trackingSince:'2026-01-01T12:00:00Z',totals,months:{'2026-11':totals},
      history:Array.from({length:25},() => ({startedAt:'2026-11-01T08:00:00Z',endedAt:'2026-11-01T10:00:00Z',
        outcome:'completed',program:'Cotton',temperature:'GC40',spinSpeed:'RPM800',durationMinutes:120,partial:false})),active:null};
    const second = structuredClone(stats);second.history=[];second.totals={...totals,completed:0,programs:{}};
    const mock = {timeZone:'Europe/Prague',
      devices:[{id:'one',name:'Washer One',statistics:stats},{id:'two',name:'Washer Two',statistics:second}]};
    function browserHarness() {
      window.addEventListener('load', () => {
        let fail=false;
        const homey = {
          __: key => key.split('.').reduce((obj,part) => obj[part],window.labels),
          on:()=>{},
          api:(method,url,body,callback) => {
            if (url === '/statistics') callback(fail ? new Error('Offline') : null,window.sample);
            else callback(null,{devices:[],hasRefreshToken:false});
          },
          ready:()=> {
            document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=homey.__(el.dataset.i18n));
            setTimeout(async () => {
              const $=id=>document.getElementById(id);
              const check=(ok,message)=>{if(!ok)throw new Error(message);};
              const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
              const change=id=>$(id).dispatchEvent(new Event('change'));
              try {
                document.querySelector('[data-tab="statistics"]').click();await tick();
                check(!$('stats-content').hidden,'content hidden');
                check($('stats-cards').children.length===8,'summary cards');
                check($('stats-cards').textContent.includes('40 °C'),'temperature formatting');
                check($('stats-chart').children.length===12,'monthly chart');
                check($('stats-programs').querySelectorAll('img').length===0,'unsafe program injection');
                check($('stats-programs').textContent.includes('<img'),'program displayed as text');
                check($('stats-history').children.length===20,'first page');
                $('stats-next').click();check($('stats-history').children.length===5,'second page');
                $('stats-period').value='2026-11';change('stats-period');
                check($('stats-history').children.length===20,'period resets page');
                $('stats-device').value='two';change('stats-device');
                check(!$('stats-empty-history').hidden,'empty device history');
                fail=true;$('stats-refresh').click();await tick();
                check($('stats-content').hidden,'stale content hidden after error');
                check($('stats-message').textContent.includes('Offline'),'error visible');
                fail=false;window.sample.devices=[];$('stats-refresh').click();await tick();
                check($('stats-controls').hidden && $('stats-content').hidden,'no paired washers');
                check($('stats-message').textContent.includes('No paired'),'empty state');
                document.body.setAttribute('data-test-result','passed');
              } catch(error) {document.body.setAttribute('data-test-result',error.message);}
            },50);
          }
        };
        onHomeyReady(homey);
      });
    }
    const harness='window.labels='+JSON.stringify(labels)+';window.sample='+JSON.stringify(mock)+';('+browserHarness.toString()+')();';
    const dashboard=fs.readFileSync(path.join(root,'settings/statistics.js'),'utf8');
    const html=fs.readFileSync(path.join(root,'settings/index.html'),'utf8')
      .replace('<script type="text/javascript" src="/homey.js" data-origin="settings"></script>',()=>'<script>'+harness+'</script>')
      .replace('<script type="text/javascript" src="statistics.js"></script>',()=>'<script>'+dashboard+'</script>');
    const fixture=path.join(temporary,'index.html');fs.writeFileSync(fixture,html);
    const result=spawnSync(browser,['--headless','--disable-gpu','--no-first-run',
      '--user-data-dir='+path.join(temporary,'profile'),'--dump-dom','--virtual-time-budget=2000',
      require('node:url').pathToFileURL(fixture).href],{encoding:'utf8',timeout:35000,maxBuffer:2*1024*1024});
    assert.ifError(result.error);
    assert.match(result.stdout,/data-test-result="passed"/,
      (result.stdout.match(/data-test-result="([^"]+)"/)||[])[1] || result.stderr);
  } finally {fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
