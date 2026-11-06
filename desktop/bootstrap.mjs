import {createApp} from './src/server.js';
import {openSync,writeFileSync,closeSync,unlinkSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(process.env.SOURCEWATCH_DATA),lock=join(root,'.sourcewatch-desktop.lock');mkdirSync(root,{recursive:true});
if(existsSync(lock)){let pid;try{pid=Number(readFileSync(lock,'utf8'));process.kill(pid,0);throw Error('DATA_FOLDER_IN_USE');}catch(error){if(error.message==='DATA_FOLDER_IN_USE'||error.code==='EPERM')throw Error('This data folder is already open in another desktop service.');if(error.code!=='ESRCH')throw error;unlinkSync(lock);}}
const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);
let service;let closing=false;
async function shutdown(){if(closing)return;closing=true;try{await service?.app.close();}finally{try{unlinkSync(lock);}catch{}process.exit(0);}}
process.on('message',message=>{if(message?.type==='shutdown')void shutdown();});process.on('disconnect',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
try{service=await createApp({root,desktopToken:process.env.SOURCEWATCH_DESKTOP_TOKEN,distRoot:resolve('dist')});await service.app.listen({host:'127.0.0.1',port:0});process.send?.({type:'ready',url:'http://127.0.0.1:'+service.app.server.address().port});}catch(error){try{unlinkSync(lock);}catch{}throw error;}
