import '../e2e/support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// This witness connects to a disposable Linux guest. CDP is used ONLY for
// page setup, UI buttons and observation. ALL canvas pen input enters through
// /dev/uinput -> Linux evdev -> Xorg/libinput -> headed Chromium.
const api = process.env.E2E_API_URL, web = process.env.E2E_BASE_URL;
const guestWeb = new URL(web); guestWeb.hostname = '127.0.0.1';
const controller = 'http://127.0.0.1:44924';
const proofDir = fileURLToPath(new URL('../../../.run/virtual-tablet-validation/', import.meta.url));
const visible = scene => scene.elements.filter(element => !element.isDeleted);
function panel(page) { return page.getByRole('region', { name: 'Доска интервью', exact: true }); }
async function saved(page) { await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor(); }
async function scene(room) {
 const response = await fetch(`${api}/rooms/${room.inviteCode}/whiteboard`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
 assert.equal(response.status,200); return response.json();
}
async function waitScene(room,predicate) {
 const deadline=Date.now()+45000;let current;
 do { current=await scene(room);if(predicate(current))return current;await new Promise(r=>setTimeout(r,150)); } while(Date.now()<deadline);
 assert.fail(`Native uinput document did not reach intended state: sequence=${current?.sequence}, strokes=${JSON.stringify(visible(current).map(e=>({type:e.type,simulatePressure:e.simulatePressure,points:e.points?.length,pressureMin:e.pressures?.length?Math.min(...e.pressures):null,pressureMax:e.pressures?.length?Math.max(...e.pressures):null})))}`);
}
async function reverseFrontend() {
 assert.ok(guestWeb.port && !['5173','8080'].includes(guestWeb.port));
 const child=spawn('ssh',['-T','-i',`${proofDir}guest-key`,'-p','44922','-o','ExitOnForwardFailure=yes','-o',`UserKnownHostsFile=${proofDir}known_hosts`,'-R',`127.0.0.1:${guestWeb.port}:127.0.0.1:${guestWeb.port}`,'root@127.0.0.1','echo INTERHUB_FORWARD_READY; sleep 300'],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Guest frontend reverse-forward timeout')),15000);child.stdout.on('data',data=>{if(data.toString().includes('INTERHUB_FORWARD_READY')){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error(`Guest frontend reverse-forward exited ${code}`));});});
 return child;
}
async function frames(values) {
 const response=await fetch(`${controller}/frame`,{method:'POST',headers:{'Content-Type':'application/json','X-InterHub-Input-Source':'uinput-witness'},body:JSON.stringify(values)});
 assert.equal(response.status,200);assert.equal((await response.json()).source,'linux-uinput');
}
async function tool(page,name) {
 const radio=page.getByRole('group',{name:'Инструменты доски'}).getByTestId(`toolbar-${name}`);await radio.locator('..').click();assert.equal(await radio.isChecked(),true);
}
async function position(page,dx=0) {
 const bounds=await page.getByTestId('room-whiteboard-canvas').locator('canvas.interactive').boundingBox();
 const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,outerWidth,outerHeight,screenX,screenY}));
 assert.equal(viewport.width,1280);assert.equal(viewport.height,900);assert.equal(viewport.screenX,0);assert.equal(viewport.screenY,0);
 assert.ok(bounds);
 const x=Math.round(Math.max(0,bounds.x)+(Math.min(1280,bounds.x+bounds.width)-Math.max(0,bounds.x))*.65+dx);
 const y=Math.round(Math.max(0,bounds.y)+(Math.min(900,bounds.y+bounds.height)-Math.max(0,bounds.y))*.67);
 await page.waitForFunction(({x,y})=>document.elementFromPoint(x,y)?.matches('canvas.interactive'),{x,y});
 return {x,y};
}
async function stroke(page,start,eraser=false) {
 await tool(page,eraser?'eraser':'freedraw');
 const values=[{x:start.x-8,y:start.y-8,contact:false,pressure:0},{...start,contact:false,pressure:0},{...start,contact:true,pressure:.18}];
 for(let i=1;i<=18;i++)values.push({x:start.x+i*4,y:start.y+Math.round(Math.sin(i/2)*16),contact:true,pressure:i<9?.18:.86});
 values.push({x:start.x+72,y:start.y+7,contact:false,pressure:0});
 await frames(values);
}
async function exported(page,label) {
 await panel(page).getByRole('button',{name:'Скачать',exact:true}).click();
 const pending=page.waitForEvent('download');await panel(page).getByRole('menuitem',{name:label,exact:true}).click();
 const chunks=[];for await(const chunk of await(await pending).createReadStream())chunks.push(chunk);return Buffer.concat(chunks);
}
function fixedWidthStroke(element) {
 return element.type==='freedraw' && element.lastCommittedPoint && !element.simulatePressure &&
  element.pressures.length===element.points.length && element.pressures.every(p=>p===.5);
}

test('Linux uinput TABLET -> native pen -> actual room board, peer, erase/Undo, reconnect and exports', {timeout:300000}, async()=>{
 await mkdir(proofDir,{recursive:true});
 const capabilities=await(await fetch(`${controller}/status`)).json();assert.equal(capabilities.nativeInput,true);
 const created=await fetch(`${api}/public/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Native OS tablet witness',ownerDisplayName:'Перо ОС',language:'nodejs'})});
 assert.equal(created.status,200);const room=await created.json();
 const forwarding=await reverseFrontend();
 const browser=await chromium.connectOverCDP('http://127.0.0.1:44926',{timeout:45000});
 const context=await browser.newContext({viewport:null,acceptDownloads:true});
 await context.addInitScript(({room})=>{
  localStorage.setItem(`owner_token_${room.inviteCode}`,room.ownerToken);
  localStorage.setItem(`guest_display_name_${room.inviteCode}`,'Перо ОС');localStorage.setItem('display_name','Перо ОС');localStorage.setItem('interview-online:ui-theme','light');
  window.__nativeTabletEvents=[];window.__nativeTabletSources=[];window.__nativeTabletGeneration=-1;
  const Native=window.EventSource;window.EventSource=class extends Native{constructor(...args){super(...args);window.__nativeTabletSources.push(this);this.addEventListener('message',event=>{try{if(JSON.parse(event.data).type==='state_sync')window.__nativeTabletGeneration=window.__nativeTabletSources.indexOf(this);}catch{}});}};
  for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,event=>{if(event.target?.matches?.('canvas.interactive'))window.__nativeTabletEvents.push({type,pointerType:event.pointerType,pressure:event.pressure,buttons:event.buttons,trusted:event.isTrusted,x:event.clientX,y:event.clientY});},true);
 },{room});
 const page=await context.newPage();page.setDefaultTimeout(60000);
 const setup=await context.newCDPSession(page);const {targetInfo}=await setup.send('Target.getTargetInfo');const {windowId}=await setup.send('Browser.getWindowForTarget',{targetId:targetInfo.targetId});await setup.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'fullscreen'}});const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 let writes=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/whiteboard/changes'))writes++;});
 const peerBrowser=await chromium.launch({headless:true});
 try{
  await page.goto(`${guestWeb.origin}/room/${room.inviteCode}`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  const switcher=page.getByTestId('room-editor-mode-switch');await switcher.click();const id=await switcher.getByRole('combobox').getAttribute('aria-controls');
  await page.locator('.ant-select-dropdown').filter({has:page.locator(`[id=${JSON.stringify(id)}]`)}).getByText('Доска',{exact:true}).click();
  await page.getByRole('dialog',{name:'Изменить режим комнаты?'}).getByRole('button',{name:'Изменить режим',exact:true}).click();
  await page.locator('.ant-modal-wrap').filter({has:page.getByText('Изменить режим комнаты?',{exact:true})}).waitFor({state:'hidden'});
  await saved(page);await page.bringToFront();await tool(page,'freedraw');
  const ownColor=await panel(page).getByTestId('room-drawing-color').getAttribute('data-color');
  const peerContext=await peerBrowser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  await peerContext.addInitScript(({room})=>{localStorage.setItem(`guest_display_name_${room.inviteCode}`,'Наблюдатель');localStorage.setItem('display_name','Наблюдатель');},{room});
  const peer=await peerContext.newPage();peer.setDefaultTimeout(30000);await peer.goto(`${web}/room/${room.inviteCode}`,{waitUntil:'domcontentloaded'});await saved(peer);
  const point=await position(page);const before=await scene(room),beforeWrites=writes;
  await frames([{x:point.x-12,y:point.y-9,contact:false,pressure:0},{...point,contact:false,pressure:0}]);
  await page.getByTestId('whiteboard-pen-hover').waitFor({state:'visible'});
  const bounds=await page.getByTestId('whiteboard-pen-hover').boundingBox();assert.ok(bounds&&Math.abs(bounds.x+bounds.width/2-point.x)<=2&&Math.abs(bounds.y+bounds.height/2-point.y)<=2);
  assert.equal((await scene(room)).sequence,before.sequence);assert.equal(writes,beforeWrites);
  await page.screenshot({path:`${proofDir}native-app-hover.png`});console.log('NATIVE_STAGE hover-no-write PASS');
  await stroke(page,point);
  const drawn=await waitScene(room,s=>visible(s).length===1&&fixedWidthStroke(visible(s)[0]));const first=visible(drawn)[0];
  console.log('NATIVE_STAGE fixed-stroke-durable PASS',{min:Math.min(...first.pressures),max:Math.max(...first.pressures),points:first.points.length});
  assert.equal(first.strokeColor.toUpperCase(),ownColor);assert.equal(first.pressures.length,first.points.length);await Promise.all([saved(page),saved(peer)]);
  await peer.waitForFunction(color=>{
   const r=parseInt(color.slice(1,3),16),g=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16);
   for(const canvas of document.querySelectorAll('[data-testid="room-whiteboard-canvas"] canvas')){
    const pixels=canvas.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data;if(!pixels)continue;
    let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>200&&Math.abs(pixels[i]-r)<8&&Math.abs(pixels[i+1]-g)<8&&Math.abs(pixels[i+2]-b)<8)count++;
    if(count>25)return true;
   }return false;
  },ownColor);
  console.log('NATIVE_STAGE peer-visible-canvas PASS');
  await page.screenshot({path:`${proofDir}native-app-pressure.png`});await peer.screenshot({path:`${proofDir}native-peer-pressure.png`});
  await stroke(page,point,true);await waitScene(room,s=>visible(s).length===0);await saved(page);console.log('NATIVE_STAGE eraser-durable PASS',{undo:await page.getByTestId('button-undo').isEnabled(),events:await page.evaluate(()=>window.__nativeTabletEvents.length)});
  await page.getByTestId('button-undo').click();await waitScene(room,s=>visible(s).some(e=>e.id===first.id)&&visible(s).length===1);await saved(page);
  console.log('NATIVE_STAGE eraser-undo PASS');
  const generation=await page.evaluate(()=>window.__nativeTabletGeneration);
  await context.setOffline(true);await page.evaluate(()=>window.__nativeTabletSources.at(-1).dispatchEvent(new Event('error')));
  await page.waitForFunction(()=>document.querySelector('[data-testid="room-connection-status"]')?.getAttribute('data-state')!=='online');
  await stroke(page,await position(page,-125));await context.setOffline(false);
  await page.waitForFunction(previous=>window.__nativeTabletGeneration>previous&&window.__nativeTabletGeneration===window.__nativeTabletSources.length-1,generation);
  const recovered=await waitScene(room,s=>visible(s).length===2&&visible(s).every(fixedWidthStroke));await Promise.all([saved(page),saved(peer)]);
  console.log('NATIVE_STAGE offline-reconnect PASS');
  const nativeEvents=await page.evaluate(()=>window.__nativeTabletEvents);
  assert.ok(nativeEvents.some(e=>e.type==='pointerdown'));assert.ok(nativeEvents.every(e=>e.trusted&&e.pointerType==='pen'),'native canvas input contains no CDP/mouse fallback');
  assert.ok(nativeEvents.some(e=>e.buttons===1&&e.pressure>.1&&e.pressure<.35)&&nativeEvents.some(e=>e.buttons===1&&e.pressure>.7));
  const json=JSON.parse((await exported(peer,'.excalidraw')).toString('utf8'));assert.deepEqual(visible(json).map(e=>e.id).sort(),visible(recovered).map(e=>e.id).sort());assert.ok(visible(json).every(fixedWidthStroke));
  const png=await exported(peer,'PNG');assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const svg=(await exported(peer,'SVG')).toString('utf8');assert.match(svg,/<svg/);assert.match(svg,/<path/);
  await page.reload({waitUntil:'domcontentloaded'});await saved(page);assert.equal(await panel(page).getByTestId('room-drawing-color').getAttribute('data-color'),ownColor);
  assert.deepEqual(pageErrors,[]);
  const proof={passed:true,chain:'Linux uinput -> evdev -> udev Tablet -> Xorg/libinput TABLET -> headed Chromium -> InterHub',device:capabilities,canvasInput:'native-uinput-only',cdpDrawingDispatches:0,hoverNoWrite:true,variableInputPressure:true,fixedStrokeWidth:true,peerRendered:true,eraserUndo:true,reconnect:true,reload:true,exports:['excalidraw','PNG','SVG'],exportsExecutedIn:'peer application browser, from the confirmed native-uinput drawing',nativeEvents,confirmedElements:visible(recovered).map(e=>({id:e.id,type:e.type,color:e.strokeColor,points:e.points.length,pressures:e.pressures})),physicalVendorHardwareTested:false};
  await writeFile(`${proofDir}native-app-result.json`,JSON.stringify(proof,null,2)+'\n');console.log('NATIVE_UINPUT_WITNESS_PASS',{events:nativeEvents.length,elements:proof.confirmedElements.length});
 }catch(error){await writeFile(`${proofDir}native-app-failure.json`,JSON.stringify({message:error.message,pageErrors,nativeEvents:await page.evaluate(()=>window.__nativeTabletEvents).catch(()=>[])},null,2)+'\n');throw error;}finally{await peerBrowser.close();await context.close();await browser.close();forwarding.kill('SIGTERM');}
});
