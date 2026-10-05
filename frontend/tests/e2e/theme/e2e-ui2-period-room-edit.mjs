import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
const api=process.env.E2E_API_URL??'http://localhost:8080/api';
const web=process.env.E2E_BASE_URL??'http://localhost:5173';
async function req(path,token,body,method=body?'POST':'GET'){
 const r=await fetch(api+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.ok(r.ok,`${method} ${path}: ${r.status}`);return r.status===204?null:r.json();
}
async function account(){return req('/auth/register',null,{nickname:`clarity_${crypto.randomUUID().slice(0,12)}`,displayName:'Участник найма',password:'test-password-123',isHr:true});}
async function open(auth,path){const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1366,height:1000},acceptDownloads:true});await context.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('auth_user',JSON.stringify(user));},auth);const page=await context.newPage();page.setDefaultTimeout(6000);await page.goto(web+path);return{browser,page};}
async function settleDialog(page) {
 await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 await page.waitForFunction(()=>[...document.querySelectorAll('.ant-modal')].every(el=>!el.getClientRects().length||getComputedStyle(el).transform==='none'));
}
test('period tooltip stays anchored and readable throughout hover, scrolling and focus',async()=>{
 const auth=await account();const{browser,page}=await open(auth,'/workspace/personal/candidates');try{
  await page.getByRole('heading',{name:'Кандидаты и интервью',exact:true}).waitFor();
  for(const width of [1366,768])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:650});await page.evaluate(theme=>{localStorage.setItem('interview-online:ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:theme}));},theme);
   const hint=page.getByRole('button',{name:'Как выбирается период',exact:true});await hint.scrollIntoViewIfNeeded();
   for(let cycle=0;cycle<3;cycle++){
    await page.mouse.move(0,0);await hint.blur();const tip=page.getByRole('tooltip').filter({hasText:'Москве'});await tip.waitFor({state:'hidden'});await hint.locator('svg').hover();
    await tip.waitFor();await page.waitForTimeout(350);
    for(let frame=0;frame<10;frame++){
     const [h,t]=await Promise.all([hint.boundingBox(),tip.boundingBox()]);assert.ok(t,'tooltip must stay visible');assert.ok(t.x>=0&&t.x+t.width<=width+1&&t.y>=0&&t.y+t.height<=650+1,'tooltip remains inside the viewport');
     assert.ok(Math.abs((h.x+h.width/2)-(t.x+t.width/2))<220,`tooltip must be near its informer, width ${width}, theme ${theme}: hint ${JSON.stringify(h)}, tooltip ${JSON.stringify(t)}`);
     assert.ok(Math.min(Math.abs(t.y+t.height-h.y),Math.abs(h.y+h.height-t.y))<35,'tooltip should be beside informer');
     const opacity=await tip.evaluate(el=>Number(getComputedStyle(el.closest('.ant-tooltip')??el).opacity));assert.ok(opacity>.9,'tooltip must remain readable, not flash and disappear');await page.waitForTimeout(200);
    }
    await tip.hover();await page.waitForTimeout(250);assert.ok(await tip.isVisible(),'moving into tooltip must preserve it');
    await page.mouse.move(0,0);await hint.blur();await tip.waitFor({state:'hidden'});
   }
   await hint.focus();await page.getByRole('tooltip').filter({hasText:'Москве'}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.ant-tooltip')].some(el=>getComputedStyle(el).opacity==='1'&&el.getBoundingClientRect().x>=0));
   await page.screenshot({path:`.run/period-stable-${theme}-${width}.png`});await hint.blur();
  }
 }finally{await browser.close();}
});
for(const kind of ['personal','team'])test(`${kind} interview list edits applicable candidate and team hiring data without entering the room`,async()=>{
 const auth=await account();let team,room;
 if(kind==='team'){team=(await req('/teams',auth.token,{name:'Сведения команды'})).team;room=(await req(`/teams/${team.id}/interviews`,auth.token,{title:'Интервью для сведений',taskIds:[]})).interview;}
 else room=await req('/rooms',auth.token,{title:'Интервью для сведений',taskIds:[]});
 const path=kind==='team'?`/workspace/teams/${team.id}/interviews`:'/workspace/personal/interviews';const{browser,page}=await open(auth,path);try{
  const area=kind==='team'?page.getByRole('region',{name:'Командное интервью Интервью для сведений',exact:true}):page.getByRole('region',{name:'Личное интервью Интервью для сведений',exact:true});
  await area.getByRole('button',{name:'Редактировать интервью Интервью для сведений',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Редактировать интервью',exact:true});const name=dialog.getByLabel('Имя кандидата',{exact:true});await name.waitFor();
  await name.fill('Кандидат список 234');await dialog.getByLabel('Позиция',{exact:true}).fill('Backend инженер');await dialog.getByLabel('Дата и время интервью (МСК)',{exact:true}).fill('2030-10-12T14:30');
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Интервью сохранено',{exact:true}).waitFor();
  assert.ok(page.url().endsWith(path),'editing must not navigate to room');let metadata=await req(`/rooms/${room.inviteCode}/interview-metadata`,auth.token);assert.equal(metadata.candidateName,'Кандидат список 234');assert.equal(metadata.position,'Backend инженер');assert.equal(metadata.scheduledAt,'2030-10-12T11:30:00Z');
  await dialog.getByRole('button',{name:'Отмена',exact:true}).last().click();await page.reload();await area.getByRole('button',{name:'Редактировать интервью Интервью для сведений',exact:true}).click();await name.waitFor();assert.equal(await name.inputValue(),'Кандидат список 234');
  await page.route(kind==='team'?`**/api/teams/${team.id}/interviews/${room.id}/details`:`**/api/me/rooms/${room.id}/details`,route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{error:'Ошибка проверки'}}):route.continue(),{times:1});
  await name.fill('Черновик после ошибки');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await name.inputValue(),'Черновик после ошибки');
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Интервью сохранено',{exact:true}).waitFor();
  if(kind==='team') {
   const hr=await req('/auth/register',null,{nickname:`edit_hr_${crypto.randomUUID().slice(0,10)}`,displayName:'Дополнительный нанимающий',password:'test-password-123',isHr:true});
   await dialog.getByRole('combobox',{name:'Внешний нанимающий (необязательно)',exact:true}).fill(hr.user.nickname);await page.locator('.ant-select-item-option').filter({hasText:hr.user.displayName}).click();
   const remove=dialog.getByRole('button',{name:`Снять роль нанимающего у ${hr.user.displayName}`,exact:true});await remove.waitFor();assert.ok((await req(`/rooms/${room.inviteCode}/hr-managers`,auth.token)).some(x=>x.userId===hr.user.id));await remove.click();await remove.waitFor({state:'hidden'});assert.ok(!(await req(`/rooms/${room.inviteCode}/hr-managers`,auth.token)).some(x=>x.userId===hr.user.id));
  } else {
   assert.equal(await dialog.getByRole('combobox',{name:/нанимающ/i}).count(),0,'personal edit has no external hiring assignment');
  }

  // A stale revision must not replace the candidate draft or silently overwrite another manager.
  metadata=await req(`/rooms/${room.inviteCode}/interview-metadata`,auth.token);await req(`/rooms/${room.inviteCode}/interview-metadata`,auth.token,{...metadata,candidateName:'Сведения другого менеджера'},'PUT');await name.fill('Черновик при конфликте');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await dialog.getByRole('button',{name:'Загрузить актуальные сведения',exact:true}).waitFor();assert.equal(await name.inputValue(),'Черновик при конфликте');await dialog.getByRole('button',{name:'Загрузить актуальные сведения',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(el=>el.value==='Сведения другого менеджера'));

 }finally{await browser.close();}
});
test('active team colleague can manage interview details without an individual room assignment',async()=>{
 const owner=await account(),colleague=await req('/auth/register',null,{nickname:`edit_colleague_${crypto.randomUUID().slice(0,10)}`,displayName:'Коллега без отдельного назначения',password:'test-password-123'});const {team}=await req('/teams',owner.token,{name:'Команда прав сведений'});const {invitation}=await req(`/teams/${team.id}/invitations`,owner.token,{});const {url}=await req(`/teams/${team.id}/invitations/${invitation.id}/link`,owner.token);await req('/team-invitations/accept',colleague.token,{token:new URL(url,web).hash.slice('#token='.length)});const {interview}=await req(`/teams/${team.id}/interviews`,owner.token,{title:'Сведения команды',taskIds:[]});
 const{browser,page}=await open(colleague,`/workspace/teams/${team.id}/interviews`);try{const card=page.getByRole('region',{name:'Командное интервью Сведения команды',exact:true});await card.waitFor();await card.getByRole('button',{name:'Редактировать интервью Сведения команды',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Редактировать интервью',exact:true});await dialog.getByLabel('Имя кандидата',{exact:true}).waitFor();const response=await fetch(`${api}/rooms/${interview.inviteCode}/interview-metadata`,{headers:{Authorization:`Bearer ${colleague.token}`}});assert.equal(response.status,200,'ACTIVE membership grants shared TEAM authority');}finally{await browser.close();}
});
test('external public candidate has no interview details action and cannot read private metadata',async()=>{
 const owner=await account(),candidate=await req('/auth/register',null,{nickname:`edit_candidate_${crypto.randomUUID().slice(0,10)}`,displayName:'Внешний кандидат без управления',password:'test-password-123'});const {team}=await req('/teams',owner.token,{name:'Команда закрытых сведений'});const {interview}=await req(`/teams/${team.id}/interviews`,owner.token,{title:'Закрытые сведения',taskIds:[]});
 const{browser,page}=await open(candidate,`/room/${interview.inviteCode}`);try{await page.getByTestId('room-code-editor-host').locator('.cm-editor').waitFor();assert.equal(await page.getByRole('button',{name:'Кандидат и нанимающие',exact:true}).count(),0);const response=await fetch(`${api}/rooms/${interview.inviteCode}/interview-metadata`,{headers:{Authorization:`Bearer ${candidate.token}`}});assert.ok([403,404].includes(response.status),'public admission does not grant private metadata');}finally{await browser.close();}
});
test('list details actions and forms remain aligned in both workspaces and themes',async()=>{
 const auth=await account();await req('/rooms',auth.token,{title:'Сведения геометрии',taskIds:[]});const {team}=await req('/teams',auth.token,{name:'Команда геометрии сведений'});await req(`/teams/${team.id}/interviews`,auth.token,{title:'Сведения геометрии',taskIds:[]});const{browser,page}=await open(auth,'/workspace/personal/interviews');try{
  for(const path of ['/workspace/personal/interviews',`/workspace/teams/${team.id}/interviews`])for(const width of [1366,768])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.goto(web+path);await page.evaluate(theme=>{localStorage.setItem('interview-online:ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:theme}));},theme);
   const action=page.getByRole('button',{name:'Редактировать интервью Сведения геометрии',exact:true});await action.waitFor();const bounds=await action.evaluate(el=>{const r=el.getBoundingClientRect(),t=el.querySelector('.app-compat-button-label').getBoundingClientRect();return{left:t.left-r.left,right:r.right-t.right};});assert.ok(bounds.left>=8&&bounds.right>=8,'action text fits with padding');await action.click();const dialog=page.getByRole('dialog',{name:'Редактировать интервью',exact:true});await dialog.getByLabel('Имя кандидата',{exact:true}).waitFor();await settleDialog(page);const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'details modal stays inside viewport');await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});const input=await (path.includes('/teams/')?dialog.getByRole('combobox',{name:'Внешний нанимающий (необязательно)',exact:true}).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]'):dialog.getByLabel('Имя кандидата',{exact:true})).boundingBox();assert.equal(Math.round(input.height),36,'applicable editor field keeps the ordinary compact control height');assert.equal(await dialog.getByRole('button',{name:'Добавить',exact:true}).count(),0,'selector confirms the identity without a duplicate add button');await page.screenshot({path:`.run/list-details-${path.includes('/teams/')?'team':'personal'}-${theme}-${width}.png`});await dialog.getByRole('button',{name:'Отмена',exact:true}).last().click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
 }finally{await browser.close();}
});
test('personal interview details footer never covers the focused candidate input',async()=>{
 const auth=await account();await req('/rooms',auth.token,{title:'Сведения без перекрытия',taskIds:[]});const{browser,page}=await open(auth,'/workspace/personal/interviews');try{
  for(const width of [1366,768])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:800});await page.evaluate(theme=>{localStorage.setItem('interview-online:ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:theme}));},theme);await page.getByRole('button',{name:'Редактировать интервью Сведения без перекрытия',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Редактировать интервью',exact:true});const input=dialog.getByLabel('Имя кандидата',{exact:true});await input.waitFor();await page.evaluate(async()=>{await document.fonts.ready;document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await input.focus();await input.scrollIntoViewIfNeeded();const hit=await input.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{readable:el===hit||el.contains(hit),hitText:hit?.textContent?.slice(0,100)};});assert.ok(hit.readable,`focused input must not be covered: ${JSON.stringify(hit)}`);await input.fill('Личный кандидат без перекрытия');assert.equal(await input.inputValue(),'Личный кандидат без перекрытия');await dialog.getByRole('button',{name:'Отмена',exact:true}).last().click();
  }
 }finally{await browser.close();}
});
