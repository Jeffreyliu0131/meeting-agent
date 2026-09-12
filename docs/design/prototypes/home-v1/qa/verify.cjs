const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const out=__dirname;
fs.mkdirSync(out,{recursive:true});
app.setPath('userData',fs.mkdtempSync('/private/tmp/meeting-home-preview-qa-'));
const errors=[]; const result={environment:'macOS / Electron Chromium; standalone local HTML',url:'http://127.0.0.1:4178/',captures:[],checks:[],errors};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const w=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 w.webContents.on('console-message',(event)=>{if(event.level==='error')errors.push(event.message)});
 w.webContents.on('render-process-gone',(_e,details)=>errors.push(details.reason));
 const run=code=>w.webContents.executeJavaScript(code);
 const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
 async function check(name,code){const pass=await run(code);result.checks.push({name,pass:Boolean(pass)});if(!pass)throw new Error('Check failed: '+name)}
 async function capture(name,width,height){w.setContentSize(width,height);await pause(220);const layout=await run(`({viewport:[innerWidth,innerHeight],scrollWidth:document.documentElement.scrollWidth,hero:document.querySelector('.hero').getBoundingClientRect().toJSON(),recent:document.querySelector('.empty-state').getBoundingClientRect().toJSON(),primary:document.querySelector('#startButton').getBoundingClientRect().toJSON()})`);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());result.captures.push({name,...layout});if(layout.scrollWidth>width)throw new Error('Horizontal overflow '+name)}
 try{
  await w.loadURL(result.url);await check('initial preview rendered',`document.querySelector('#sampleOutput h2')?.textContent.includes('先从小范围')`);
  await capture('home-desktop',1440,1000);
  await capture('home-standard',1180,808);
  await capture('home-small',800,600);
  await check('small viewport CTA and empty state fully visible',`document.querySelector('#startButton').getBoundingClientRect().bottom<innerHeight && document.querySelector('#emptyState').getBoundingClientRect().bottom<innerHeight-60`);
  await click('#mobileExample');await check('small example expands',`getComputedStyle(document.querySelector('#exampleWrap')).display!=='none'`);
  await capture('home-mobile',390,844);
  await click('#resetButton');
  await click('#settingsButton');await check('settings dialog opens',`document.querySelector('#audioDialog').open`);
  await capture('settings-mobile',390,844);
  await click('#computerToggle');await check('computer audio scope updates',`document.querySelector('#computerSummary').textContent==='电脑声音开启'&&document.querySelector('#computerToggle').getAttribute('aria-checked')==='true'`);
  await click('#audioDone');await check('settings close without starting',`!document.querySelector('#audioDialog').open&&document.querySelector('#status').textContent==='未录音'`);
  await click('#nextExample');await check('comparison sample renders',`document.querySelector('.comparison')?.rows.length===3`);
  await click('#nextExample');await check('personal sample labeled',`document.querySelector('.personal-label').textContent.includes('非会议决定')`);
  await click('#viewSource');await check('source matches current sample',`document.querySelector('#sourceDialog').open && document.querySelector('#originalQuote').textContent.includes('两名支持人员')`);
  await capture('source-dialog',1180,808);await click('[data-close="sourceDialog"]');
  await click('[data-mode="setup"]');await check('setup state changes CTA',`!document.querySelector('#setupNote').hidden && document.querySelector('#startButton').textContent.includes('完成音频设置')`);
  await capture('needs-setup',1180,808);
  await click('#startButton');await check('setup CTA opens audio dialog',`document.querySelector('#audioDialog').open`);
  await click('#audioDone');await check('setup completion does not record',`document.querySelector('#status').textContent==='未录音'&&document.querySelector('#setupNote').hidden`);
  await click('#startButton');await check('start has loading state',`document.querySelector('#startButton').disabled`);await pause(850);
  await check('simulated active state labeled',`document.querySelector('#status').textContent.includes('演示')&&document.querySelector('#startButton').textContent.includes('打开当前会议')`);
  await capture('active-demo',1180,808);
  await click('[data-mode="history"]');await check('history records labeled synthetic',`!document.querySelector('#historyBadge').hidden&&document.querySelectorAll('.meeting-row').length===3`);
  await capture('history',1180,808);await check('history introduction is compact',`document.querySelector('.hero').getBoundingClientRect().height<290`);
  await run(`document.querySelector('#searchInput').value='上线';document.querySelector('#searchInput').dispatchEvent(new Event('input'))`);
  await check('history search filters',`document.querySelectorAll('.meeting-row').length===1&&document.querySelector('.meeting-row').textContent.includes('上线')`);
  await click('[data-filter="active"]');await check('empty filtered state',`!!document.querySelector('.no-results')`);
  await click('#resetButton');
  w.setContentSize(800,600);w.webContents.setZoomFactor(2);await pause(200);
  await check('200 percent zoom no horizontal overflow',`document.documentElement.scrollWidth<=innerWidth`);
  fs.writeFileSync(path.join(out,'home-200-percent.png'),(await w.webContents.capturePage()).toPNG());
  w.webContents.setZoomFactor(1);await pause(150);
  await capture('home-mobile-initial',390,844);
  await check('no network or audio integration in HTML',`!document.querySelector('script[src],link[href^="http"],audio,video,iframe')`);
  result.result='passed';
 }catch(e){result.result='failed';result.failure=String(e)}
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));app.exit(result.result==='passed'?0:1);
});
setTimeout(()=>app.exit(2),45000);
