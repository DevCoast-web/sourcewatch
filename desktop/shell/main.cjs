const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const { spawn,execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { join, resolve } = require('node:path');
const { mkdirSync, readFileSync, writeFileSync, createWriteStream,statSync } = require('node:fs');
let window,backend,origin='',quitting=false,dataRoot,enginePath;
const testRoot=process.env.SOURCEWATCH_DESKTOP_TEST_ROOT;
if(testRoot) app.setPath('userData',resolve(testRoot));
app.setName('SourceWatch');
app.setAppUserModelId('org.sourcewatch.desktop');
const token=randomBytes(32).toString('hex');
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;void stopBackend().finally(()=>app.quit());});
app.whenReady().then(start).catch(error=>{if(testRoot)writeFileSync(join(testRoot,'desktop-error.json'),JSON.stringify({error:String(error.message||error)}));else dialog.showErrorBox('SourceWatch could not start',String(error.message||error));quitting=true;void stopBackend().finally(()=>app.quit());});
}
function preferences(){try{return JSON.parse(readFileSync(join(app.getPath('userData'),'desktop.json'),'utf8'));}catch{return {};}}
async function stopBackend(){if(!backend||backend.exitCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>{backend.kill();resolve();},60000);backend.once('exit',()=>{clearTimeout(timer);resolve();});if(backend.connected)backend.send({type:'shutdown'});else backend.kill();});}
async function chooseData(){const selected=await dialog.showOpenDialog(window,{title:'Choose an existing SourceWatch data folder',properties:['openDirectory']});if(selected.canceled)return;const confirm=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Use this folder and restart'],defaultId:0,cancelId:0,message:'Use the selected research data folder?',detail:'Save your work and stop any other SourceWatch service using this folder first. Existing evidence stays in this folder. The desktop app will use it after restarting.'});if(confirm.response!==1)return;writeFileSync(join(app.getPath('userData'),'desktop.json'),JSON.stringify({dataRoot:selected.filePaths[0]},null,2));await stopBackend();app.relaunch();quitting=true;app.exit();}
async function verifyEvidence(){
 const selected=await dialog.showOpenDialog(window,{title:'Choose an extracted evidence bundle folder',properties:['openDirectory']});if(selected.canceled)return;
 try{const folder=selected.filePaths[0],manifest=join(folder,'manifest.json');if(statSync(manifest).size>4*1024*1024)throw Error('Manifest exceeds the verification size limit');const format=JSON.parse(readFileSync(manifest,'utf8')).format;const verifier=format==='sourcewatch-workspace-v1'?'verify-workspace.mjs':'verify.mjs';
 execFile(join(enginePath,'node.exe'),[join(enginePath,'scripts',verifier),folder],{windowsHide:true,timeout:60000,maxBuffer:1024*1024},(error,stdout,stderr)=>{let result;try{result=JSON.parse(stdout);}catch{result={ok:false,error:String(stderr||error?.message||'Could not parse verification result')};}void dialog.showMessageBox(window,{type:result.ok?'info':'warning',message:result.ok?'Integrity check passed':'Evidence needs attention',detail:JSON.stringify(result,null,2).slice(0,12000)+'\n\nThis checks file consistency, not website authenticity or independently certified timestamps.'});});
 }catch(error){await dialog.showMessageBox(window,{type:'error',message:'Could not verify this folder',detail:String(error.message||error)});}
}
async function start(){
 const state=app.getPath('userData');mkdirSync(state,{recursive:true});dataRoot=resolve(preferences().dataRoot||join(state,'research'));mkdirSync(dataRoot,{recursive:true});
 const engine=app.isPackaged?join(process.resourcesPath,'engine'):resolve(__dirname,'../../work/desktop-runtime');
 enginePath=engine;
 const browsers=app.isPackaged?join(process.resourcesPath,'browsers'):resolve(__dirname,'../../.browsers');
 const log=createWriteStream(join(state,'desktop.log'),{flags:'a'});
 backend=spawn(join(engine,'node.exe'),[join(engine,'bootstrap.mjs')],{cwd:engine,env:{...process.env,SOURCEWATCH_DATA:dataRoot,SOURCEWATCH_DESKTOP_TOKEN:token,PLAYWRIGHT_BROWSERS_PATH:browsers},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});backend.stdout.pipe(log,{end:false});backend.stderr.pipe(log,{end:false});
 const ready=await new Promise((resolveReady,reject)=>{const timer=setTimeout(()=>reject(Error('The local research service did not start within 30 seconds. See desktop.log in the application data folder.')),30000);backend.once('error',reject);backend.once('exit',code=>{clearTimeout(timer);reject(Error('The local service stopped during startup (code '+code+'). Check the data folder and desktop.log.'));});backend.on('message',message=>{if(message?.type==='ready'){clearTimeout(timer);resolveReady(message);}});});
 const parsed=new URL(ready.url);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||!parsed.port)throw Error('Invalid local service address');origin=parsed.origin;
 session.defaultSession.webRequest.onBeforeSendHeaders({urls:[origin+'/*']},(details,callback)=>{details.requestHeaders['X-SourceWatch-Desktop-Token']=token;callback({requestHeaders:details.requestHeaders});});
 session.defaultSession.setPermissionCheckHandler((_webContents,permission,requestingOrigin)=>requestingOrigin===origin&&(permission==='clipboard-sanitized-write'||permission==='media'));
 session.defaultSession.setPermissionRequestHandler(async(contents,permission,callback,details)=>{if(contents.getURL().startsWith(origin+'/')&&permission==='media'&&details.mediaTypes?.every(type=>type==='audio')){const choice=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Allow microphone'],defaultId:0,cancelId:0,message:'Allow SourceWatch to record microphone audio?',detail:'Recording is initiated by you and saved locally.'});callback(choice.response===1);}else callback(permission==='clipboard-sanitized-write'&&contents.getURL().startsWith(origin+'/'));});
 window=new BrowserWindow({width:1480,height:960,minWidth:940,minHeight:680,show:!testRoot,backgroundColor:'#f4f6f8',icon:join(__dirname,'icon.png'),title:'SourceWatch',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,spellcheck:true}});
 window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
 window.webContents.setWindowOpenHandler(({url})=>{try{const u=new URL(url);if(u.origin===origin&&/^\/api\/(workspace\/attachments|captures)\//.test(u.pathname))window.webContents.downloadURL(url);else if(u.protocol==='https:'||u.protocol==='http:'){void dialog.showMessageBox(window,{type:'question',message:'Open this website in your browser?',detail:u.href,buttons:['Cancel','Open browser'],defaultId:0,cancelId:0}).then(result=>{if(result.response===1)void shell.openExternal(u.href);});}}catch{/* Invalid URLs are ignored. */}return {action:'deny'};});
 window.webContents.on('will-prevent-unload',event=>{const response=dialog.showMessageBoxSync(window,{type:'question',buttons:['Keep editing','Discard and close'],defaultId:0,cancelId:0,message:'There are unsaved research changes.'});if(response===1)event.preventDefault();});
 backend.on('exit',code=>{if(!quitting&&window&&!window.isDestroyed()){dialog.showErrorBox('SourceWatch service stopped','The research service exited with code '+code+'. Your saved data remains in '+dataRoot+'. Restart the application.');window.close();}});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{label:'Open data folder',click:()=>shell.openPath(dataRoot)},{label:'Use existing data folder…',click:()=>void chooseData()},{type:'separator'},{label:'Export workspace',click:()=>window.webContents.downloadURL(origin+'/api/workspace/export')},{label:'Verify extracted evidence…',click:()=>void verifyEvidence()},{type:'separator'},{role:'quit'}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},{label:'Help',submenu:[{label:'About SourceWatch',click:()=>dialog.showMessageBox(window,{message:'SourceWatch '+app.getVersion(),detail:'The internet changes. Keep the receipts.\nLocal-first capture, evidence and research workspace.\nData: '+dataRoot})}]}]));
 await window.loadURL(origin+'/?workspace=overview');
 if(testRoot){writeFileSync(join(testRoot,'desktop-ready.json'),JSON.stringify({version:app.getVersion(),packaged:app.isPackaged,origin,nodeIntegration:window.webContents.getLastWebPreferences().nodeIntegration,contextIsolation:window.webContents.getLastWebPreferences().contextIsolation,sandbox:window.webContents.getLastWebPreferences().sandbox},null,2));if(process.env.SOURCEWATCH_DESKTOP_SMOKE_EXIT==='1')app.quit();}

}
