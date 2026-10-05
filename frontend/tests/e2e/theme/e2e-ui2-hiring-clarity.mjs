import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const api=process.env.E2E_API_URL??'http://localhost:8080/api';
const web=process.env.E2E_BASE_URL??'http://localhost:5173';
async function req(path,token,body,method=body?'POST':'GET'){
 const r=await fetch(api+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.ok(r.ok,`${method} ${path}: ${r.status}`);return r.status===204?null:r.json();
}
async function account(){return req('/auth/register',null,{nickname:`clarity_${crypto.randomUUID().slice(0,12)}`,displayName:'Участник найма',password:'test-password-123',isHr:true});}
async function open(auth,path){const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1366,height:1000},acceptDownloads:true});await context.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('auth_user',JSON.stringify(user));},auth);const page=await context.newPage();page.setDefaultTimeout(6000);await page.goto(web+path);return{browser,page};}
async function waitForModalGeometry(locator) {
 await locator.evaluate(async node => {
  await document.fonts.ready;
  const wrap = node.closest('.ant-modal-wrap');
  if (!wrap) return;
  const modal = node.closest('.ant-modal') ?? wrap.querySelector('.ant-modal');
  const deadline = performance.now() + 6000;
  let stableFrames = 0;
  let previousBounds;
  while (performance.now() < deadline) {
   await new Promise(resolve => requestAnimationFrame(resolve));
   // rc-motion PREPARE/START can precede the zoom's WebAnimation.
   const inMotionPhase = [...(modal?.classList ?? [])].some(name => /-(appear|enter|leave)(?:-(prepare|start|active))?$/.test(name));
   const hasAnimation = wrap.getAnimations({subtree:true}).some(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)
    && (animation.pending || animation.playState === 'running' || animation.playState === 'paused'));
   const rect = modal?.getBoundingClientRect();
   const bounds = rect && [rect.left, rect.top, rect.width, rect.height];
   const unchanged = bounds && previousBounds && bounds.every((value,index) => Math.abs(value-previousBounds[index]) < 0.1);
   stableFrames = !inMotionPhase && !hasAnimation && rect?.width > 0 && rect?.height > 0 && unchanged ? stableFrames+1 : 0;
   previousBounds = bounds;
   if (stableFrames >= 2) return;
  }
  throw new Error('MODAL_ENTRY_GEOMETRY_DID_NOT_SETTLE');
 });
}
test('profile keeps hiring switch concise without repeating switch state',async()=>{
 const auth=await account();const{browser,page}=await open(auth,'/profile');try{
  await page.getByRole('switch',{name:'Я участвую в найме',exact:true}).waitFor();
  assert.equal(await page.getByText(/личному ID/).count(),0);
  assert.equal(await page.getByText(/Включите, если вас приглашают/).count(),0);
  assert.equal(await page.getByText(/Функции нанимающего/).count(),0);
  const toggle=page.getByRole('switch',{name:'Я участвую в найме',exact:true});await toggle.click();await page.getByText('Сохранено',{exact:true}).waitFor();assert.equal(await toggle.isChecked(),false);await page.reload();assert.equal(await toggle.isChecked(),false);
 }finally{await browser.close();}
});
test('hiring period is compact and controls stay aligned on errors in both themes',async()=>{
 const auth=await account();const{browser,page}=await open(auth,'/workspace/personal/candidates');try{
  await page.getByRole('heading',{name:'Кандидаты и интервью',exact:true}).waitFor();
  const from=page.getByLabel('С',{exact:true}),to=page.getByLabel('По',{exact:true}),apply=page.getByRole('button',{name:'Применить период',exact:true});await from.waitFor();
  assert.equal(await page.getByText('Выберите дату в календаре',{exact:true}).count(),0);assert.equal(await page.getByText(/Границы периода включительны/).count(),0);
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>{localStorage.setItem('interview-online:ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:theme}));},theme);
   await from.fill('2030-10-13');await apply.click();await page.getByText('Укажите обе даты периода',{exact:true}).waitFor();
   const boxes=await Promise.all([from,to,apply].map(x=>x.boundingBox()));const centers=boxes.map(r=>r.y+r.height/2);assert.ok(Math.max(...centers)-Math.min(...centers)<=2,'error must not move a single control');
  }
  const hint=page.getByRole('button',{name:'Как выбирается период',exact:true});await hint.hover();await page.getByRole('tooltip').filter({hasText:'Москве'}).waitFor();
 }finally{await browser.close();}
});
test('notes explain privacy through a heading informer on hover and focus at desktop and tablet',async()=>{
 const auth=await account();const room=await req('/rooms',auth.token,{title:'Заметки проверки',taskIds:[]});const{browser,page}=await open(auth,`/room/${room.inviteCode}`);try{
  await page.getByRole('tab',{name:'Мои заметки',exact:true}).click();
  assert.equal(await page.getByText('Только для вас',{exact:true}).count(),0);
  for(const width of [1366,768])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{localStorage.setItem('interview-online:ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:theme}));},theme);
   const hint=page.getByRole('button',{name:'Кто видит мои заметки',exact:true});await hint.waitFor();assert.equal(await hint.locator('xpath=ancestor::button').count(),0,'informer must not be inside another tab button');
   await page.mouse.move(0,0);await hint.blur();await page.getByRole('tooltip').filter({hasText:'Заметки видны только вам'}).waitFor({state:'hidden'});
   await hint.hover();await page.getByRole('tooltip').filter({hasText:'Заметки видны только вам'}).waitFor();
   await page.mouse.move(0,0);await hint.blur();await page.getByRole('tooltip').filter({hasText:'Заметки видны только вам'}).waitFor({state:'hidden'});
   await hint.focus();await page.getByRole('tooltip').filter({hasText:'Заметки видны только вам'}).waitFor();
   assert.equal(await page.getByTestId('room-private-notes-export').isVisible(),true);
   const [panel,exportButton]=await Promise.all([page.getByRole('region',{name:'Мои заметки',exact:true}).boundingBox(),page.getByTestId('room-private-notes-export').boundingBox()]);assert.ok(panel.x+panel.width-exportButton.x-exportButton.width<=24,'notes export remains at the right edge');
  }
 }finally{await browser.close();}
});
test('team candidates and downloaded Excel use the current team and applied period only',async()=>{
 const auth=await account();const a=(await req('/teams',auth.token,{name:'Команда A проверки'})).team,b=(await req('/teams',auth.token,{name:'Команда B проверки'})).team;
 const ra=(await req(`/teams/${a.id}/interviews`,auth.token,{title:'TEAM-A-XLSX',taskIds:[]})).interview;
 const rb=(await req(`/teams/${b.id}/interviews`,auth.token,{title:'TEAM-B-PRIVATE',taskIds:[]})).interview;
 await req('/rooms',auth.token,{title:'PERSONAL-PRIVATE',taskIds:[]});
 for(const r of [ra,rb]){await req(`/rooms/${r.inviteCode}/interview-metadata`,auth.token,{candidateName:'Кандидат Excel',position:'Инженер',scheduledAt:'2030-10-12T11:30:00Z',revision:0},'PUT');await req(`/rooms/${r.inviteCode}/verdict`,auth.token,{verdict:'HIRE',verdictComment:'Проверка результатов'});}
 const{browser,page}=await open(auth,`/workspace/teams/${a.id}/interviews`);const directory=await mkdtemp(join(tmpdir(),'team-xlsx-'));
 try{
  await page.getByRole('navigation',{name:'Разделы команды',exact:true}).waitFor();
  const candidates=page.getByRole('link',{name:'Кандидаты',exact:true});if(await candidates.count())await candidates.click();else{await page.getByRole('button',{name:/Меню разделов/}).click();await page.getByRole('menuitem',{name:'Кандидаты',exact:true}).click();}
  await page.waitForURL(`**/workspace/teams/${a.id}/candidates`);
  await page.getByRole('heading',{name:'Кандидаты и интервью',exact:true}).waitFor();await page.getByRole('cell',{name:'TEAM-A-XLSX',exact:true}).waitFor();assert.equal(await page.getByText('TEAM-B-PRIVATE',{exact:true}).count(),0);assert.equal(await page.getByText('PERSONAL-PRIVATE',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Результаты',exact:true}).click();const results=page.getByRole('dialog',{name:'Результаты интервью',exact:true});await results.getByText('HIRE',{exact:true}).waitFor();await waitForModalGeometry(results);const [label,value]=await Promise.all([results.getByText('Вердикт',{exact:true}).boundingBox(),results.getByText('HIRE',{exact:true}).boundingBox()]);assert.ok(value.y-label.y-label.height>=3.9,'result labels and values have separate rows');await results.getByRole('button',{name:'Закрыть',exact:true}).last().click();
  await page.getByLabel('С',{exact:true}).fill('2030-10-12');await page.getByLabel('По',{exact:true}).fill('2030-10-12');await page.getByRole('button',{name:'Применить период',exact:true}).click();
  await page.getByRole('cell',{name:'TEAM-A-XLSX',exact:true}).waitFor();await page.getByLabel('С',{exact:true}).fill('2030-10-13');
  const requested=page.waitForRequest(r=>r.url().includes('/me/hr/rooms/export'));const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать Excel',exact:true}).click();
  const url=new URL((await requested).url());assert.equal(url.searchParams.get('teamId'),a.id);assert.equal(url.searchParams.get('from'),'2030-10-12','export uses applied range, not edited draft');
  const download=await downloaded;assert.equal(await download.failure(),null);const file=join(directory,'team.xlsx');await download.saveAs(file);
  const xml=execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print("\\n".join(z.read(n).decode() for n in z.namelist() if n.startswith("xl/") and n.endswith(".xml")))',file],{encoding:'utf8'});
  assert.ok(xml.includes('TEAM-A-XLSX'));assert.ok(!xml.includes('TEAM-B-PRIVATE'));assert.ok(!xml.includes('PERSONAL-PRIVATE'));
  await page.goto(`${web}/workspace/teams/${b.id}/candidates`);await page.getByRole('cell',{name:'TEAM-B-PRIVATE',exact:true}).waitFor();assert.equal(await page.getByText('TEAM-A-XLSX',{exact:true}).count(),0);assert.equal(await page.getByLabel('С',{exact:true}).inputValue(),'','switching team resets old filter');
 }finally{await browser.close();await rm(directory,{recursive:true,force:true});}
});
test('switching the workspace aborts a pending team workbook and prevents a late download',async()=>{
 const auth=await account();const a=(await req('/teams',auth.token,{name:'Экспорт A'})).team,b=(await req('/teams',auth.token,{name:'Экспорт B'})).team;
 const{browser,page}=await open(auth,`/workspace/teams/${a.id}/candidates`);let release;const gate=new Promise(resolve=>{release=resolve});let handled;const routeDone=new Promise(resolve=>{handled=resolve});let downloads=0;
 try{
  await page.getByRole('button',{name:'Скачать Excel',exact:true}).waitFor();page.on('download',()=>{downloads+=1});
  await page.route('**/api/me/hr/rooms/export?*',async route=>{try{const response=await route.fetch();await gate;await route.fulfill({response});}catch{}finally{handled();}});
  const requested=page.waitForRequest(r=>r.url().includes('/me/hr/rooms/export'));
  const aborted=page.waitForEvent('requestfailed',{predicate:r=>r.url().includes('/me/hr/rooms/export')});
  await page.getByRole('button',{name:'Скачать Excel',exact:true}).click();assert.equal(new URL((await requested).url()).searchParams.get('teamId'),a.id);
  await page.getByRole('button',{name:/Команды:/}).click();await page.getByRole('menuitemradio',{name:'Экспорт B',exact:true}).click();
  await page.waitForURL(`**/workspace/teams/${b.id}/interviews`);await aborted;release();await routeDone;assert.equal(downloads,0,'old workspace must not produce a late file');
 }finally{release?.();await browser.close();}
});
test('hiring result actions contain their labels on desktop and tablet in both themes',async()=>{
 const auth=await account();await req('/rooms',auth.token,{title:'Результаты для геометрии',taskIds:[]});const{browser,page}=await open(auth,'/workspace/personal/candidates');try{
  const button=page.getByRole('button',{name:'Открыть комнату',exact:true});await button.waitFor();
  for(const width of [1366,768])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{localStorage.setItem('interview-online:ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:theme}));},theme);
   const [outer,label]=await Promise.all([button.boundingBox(),button.locator('.app-compat-button-label').boundingBox()]);assert.ok(label.x>=outer.x+3&&label.x+label.width<=outer.x+outer.width-3,'action text must fit inside its button');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'table scrolling must not overflow the page');
  }
 }finally{await browser.close();}
});
