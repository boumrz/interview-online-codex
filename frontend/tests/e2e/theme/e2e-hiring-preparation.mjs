import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
async function req(path, token, body, method = body ? 'POST' : 'GET') {
 const r = await fetch(`${api}${path}`, { method, headers: { 'Content-Type':'application/json', 'Idempotency-Key':crypto.randomUUID(), ...(token ? {Authorization:`Bearer ${token}`} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
 assert.ok(r.ok, `${path}: ${r.status}`); return r.status === 204 ? null : r.json();
}
async function account(label) { return req('/auth/register', null, {nickname:`hire_${crypto.randomUUID().slice(0,12)}`,displayName:label,password:'test-password-123'}); }
async function open(auth) { const browser=await chromium.launch(); const context=await browser.newContext({viewport:{width:1366,height:1000}}); await context.addInitScript(({token,user})=>{ localStorage.setItem('auth_token',token);localStorage.setItem('auth_user',JSON.stringify(user)); },auth);return {browser,page:await context.newPage()}; }
async function settleModal(page) {
 await page.evaluate(async()=>{await document.fonts.ready;for(const animation of document.getAnimations())if(Number.isFinite(animation.effect?.getComputedTiming().endTime))animation.finish();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await page.waitForFunction(()=>[...document.querySelectorAll('.ant-modal')].every(el=>!el.getClientRects().length||getComputedStyle(el).transform==='none'));
}
async function teamMember(owner,team,person) {
 const {invitation}=await req(`/teams/${team.id}/invitations`,owner.token,{});
 const {url}=await req(`/teams/${team.id}/invitations/${invitation.id}/link`,owner.token);
 const token=new URL(url,web).hash.slice('#token='.length);
 assert.ok(token, 'fixture invitation token'); await req('/team-invitations/accept',person.token,{token});
}
test('personal preparation uses a compact UUID selector and retains tasks only inside the selector',async()=>{
 const auth=await account('Автор формы'); const task=await req('/me/tasks',auth.token,{title:'Выбранная задача',description:'Условие',starterCode:'',language:'nodejs'});
 const {browser,page}=await open(auth);
 try {
  await page.goto(`${web}/workspace/personal/interviews`);await page.getByRole('button',{name:'Создать интервью',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Создать интервью',exact:true});await dialog.waitFor();await settleModal(page);
  const input=dialog.getByRole('combobox',{name:'Нанимающий',exact:true});
  await page.waitForFunction(el=>Math.abs(el.getBoundingClientRect().height-36)<1,await input.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]').elementHandle());
  const selector=await input.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]').boundingBox();assert.equal(Math.round(selector.height),36,'UUID selector uses the ordinary compact control height');
  assert.equal(await dialog.getByRole('button',{name:'Добавить',exact:true}).count(),0,'UUID preview is selected directly without a duplicate add button');
  const tasks=dialog.getByRole('combobox',{name:/Задачи/});await tasks.click();await tasks.fill('Выбранная');await page.locator('.ant-select-item-option').filter({hasText:'Выбранная задача'}).click();
  assert.equal(await dialog.getByTestId('selected-task-preview').count(),0,'chosen task not duplicated beneath selector');
  assert.equal(await dialog.getByRole('combobox',{name:'Нанимающие из команды',exact:true}).count(),0);
  for(const mode of ['light','dark']) {await page.evaluate(mode=>{localStorage.setItem('interview-online:ui-theme',mode);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:mode}));},mode); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 } finally {await browser.close();}
});
test('team interview creation and existing room support external UUID hiring invitations',async()=>{
 const owner=await account('Владелец команды');const hr=await account('Нанимающий команды');const hr2=await account('Второй нанимающий');
 await req('/me/profile',hr.token,{displayName:hr.user.displayName,isHr:true},'PATCH');await req('/me/profile',hr2.token,{displayName:hr2.user.displayName,isHr:true},'PATCH');
 const {team}=await req('/teams',owner.token,{name:'Команда проверки нанимающих'});await teamMember(owner,team,hr);await teamMember(owner,team,hr2);
 const external=await req('/auth/register',null,{nickname:`hire_ext_${crypto.randomUUID().slice(0,12)}`,displayName:'Первый внешний нанимающий',password:'test-password-123',isHr:true});
 const external2=await req('/auth/register',null,{nickname:`hire_ext_${crypto.randomUUID().slice(0,12)}`,displayName:'Второй внешний нанимающий',password:'test-password-123',isHr:true});
 const {browser,page}=await open(owner);
 try {
  await page.goto(`${web}/workspace/teams/${team.id}/interviews/new`);const dialog=page.getByRole('dialog',{name:'Создать интервью',exact:true});await dialog.waitFor();await settleModal(page);
  for (const width of [1366,768]) for (const mode of ['light','dark']) {
   await page.setViewportSize({width,height:1000});await page.evaluate(mode=>{localStorage.setItem('interview-online:ui-theme',mode);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:mode}));},mode);
   const [track,vacancy]=await Promise.all(['Трек интервью','Вакансия'].map(name=>dialog.getByRole('combobox',{name,exact:true}).locator('xpath=ancestor::*[contains(@class,"ant-select")][1]').boundingBox()));
   assert.ok(Math.abs(track.y+track.height/2-vacancy.y-vacancy.height/2)<=2,'context selectors share axis');
   assert.ok(Math.abs(track.width-vacancy.width)<=1,'context selectors have equal width');
   assert.equal(await dialog.locator('.ant-select-content').evaluateAll(elements=>elements.every(el=>getComputedStyle(el).backgroundColor==='rgba(0, 0, 0, 0)')),true,'no mismatching rectangles inside selects');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:1366,height:1000});
  await dialog.getByRole('textbox',{name:'Название интервью',exact:true}).fill('Интервью с нанимающими');
  assert.equal(await dialog.getByRole('combobox',{name:'Нанимающие из команды',exact:true}).count(),0);
  await dialog.getByRole('combobox',{name:'Внешний нанимающий (необязательно)',exact:true}).fill(hr.user.id);
  await dialog.getByRole('alert').filter({hasText:/не найден или недоступен/}).waitFor();
  await dialog.getByRole('combobox',{name:'Внешний нанимающий (необязательно)',exact:true}).fill(external.user.id);await page.locator('.ant-select-item-option').filter({hasText:external.user.displayName}).click();await dialog.getByText(external.user.displayName,{exact:true}).waitFor();
  const created=page.waitForResponse(r=>r.url().endsWith(`/api/teams/${team.id}/interviews`)&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'Создать интервью',exact:true}).click();const response=await created;assert.equal(response.status(),201);const room=(await response.json()).interview;await page.waitForURL(`**/room/${room.inviteCode}`);
  await page.goto(`${web}/workspace/teams/${team.id}/interviews`);await page.getByRole('button',{name:'Редактировать интервью Интервью с нанимающими',exact:true}).click();const info=page.getByRole('dialog',{name:'Редактировать интервью',exact:true});await info.waitFor();await info.getByText(external.user.displayName,{exact:true}).waitFor();
  await info.getByRole('combobox',{name:'Внешний нанимающий (необязательно)',exact:true}).fill(external2.user.id);await page.locator('.ant-select-item-option').filter({hasText:external2.user.displayName}).click();await info.getByText(external2.user.displayName,{exact:true}).waitFor();
  assert.deepEqual((await req(`/rooms/${room.inviteCode}/hr-managers`,owner.token)).map(person=>person.userId).sort(),[external.user.id,external2.user.id].sort(),'TEAM external hiring additions persist before metadata save');
  await info.getByRole('textbox',{name:'Имя кандидата',exact:true}).fill('Кандидат 234');await info.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Интервью сохранено',{exact:true}).waitFor();
  await info.getByRole('button',{name:'Отмена',exact:true}).click();await info.waitFor({state:'hidden'});
  await page.getByRole('textbox',{name:'Поиск интервью',exact:true}).fill('234');await page.getByText('Интервью с нанимающими',{exact:true}).waitFor();
  const outsider=await account('Внешний нанимающий');await req('/me/profile',outsider.token,{displayName:outsider.user.displayName,isHr:true},'PATCH');
  await page.goto(`${web}/workspace/personal/interviews`);await page.getByRole('button',{name:'Создать интервью',exact:true}).click();
  const personal=page.getByRole('dialog',{name:'Создать интервью',exact:true});await personal.getByRole('textbox',{name:'Название интервью',exact:true}).fill('Личное интервью с нанимающими');
  await personal.getByRole('combobox',{name:'Нанимающий',exact:true}).fill(hr2.user.id);await page.locator('.ant-select-item-option').filter({hasText:hr2.user.displayName}).click();await personal.getByText(hr2.user.displayName,{exact:true}).waitFor();
  // Delayed preview must block room creation until the chosen identity is confirmed.
  let releasePreview; const previewGate=new Promise(resolve=>{releasePreview=resolve});
  await page.route('**/api/me/hiring-manager-preview',async route=>{await previewGate;await route.continue()},{times:1});
  await personal.getByRole('combobox',{name:'Нанимающий',exact:true}).fill(outsider.user.id);
  assert.equal(await personal.getByRole('button',{name:'Создать интервью',exact:true}).isDisabled(),true);
  releasePreview();await page.locator('.ant-select-item-option').filter({hasText:'Внешний нанимающий'}).click();await personal.getByText('Внешний нанимающий',{exact:true}).waitFor();
  const personalCreated=page.waitForResponse(r=>r.url().endsWith('/api/rooms')&&r.request().method()==='POST');
  await personal.getByRole('button',{name:'Создать интервью',exact:true}).click();const personalResponse=await personalCreated;assert.ok(personalResponse.ok());const personalRoom=await personalResponse.json();await page.waitForURL(`**/room/${personalRoom.inviteCode}`);
  const managers=await req(`/rooms/${personalRoom.inviteCode}/hr-managers`,owner.token);assert.deepEqual(managers.map(person=>person.userId).sort(),[hr2.user.id,outsider.user.id].sort());
  await page.reload();await page.getByRole('button',{name:'Кандидат и нанимающие',exact:true}).click();const personalInfo=page.getByRole('dialog',{name:'Кандидат и нанимающие',exact:true});await personalInfo.getByText('Внешний нанимающий',{exact:true}).waitFor();

 }finally{await browser.close();}
});
