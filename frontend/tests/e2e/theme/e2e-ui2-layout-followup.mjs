import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
async function request(path, token, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(`${api}${path}`, {method, headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.ok(r.ok, `${path}: ${r.status}`); return r.status === 204 ? null : r.json();
}
async function fixture(role) {
  const auth = await request('/auth/register', null, {nickname:`layout_${crypto.randomUUID().slice(0,12)}`,displayName:'Автор проверки отступов',password:'test-password-123'});
  const fixtureAuth = role ? {...auth,user:{...auth.user,role}} : auth;
  const {team} = await request('/teams',auth.token,{name:'Команда проверки отступов'});
  const browser = await chromium.launch(); const context = await browser.newContext({viewport:{width:1366,height:1100}});
  await context.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('auth_user',JSON.stringify(user));},fixtureAuth);
  return {auth:fixtureAuth,team,browser,page:await context.newPage()};
}
async function settle(page, mode, width) {
  await page.setViewportSize({width,height:1100});
  await page.evaluate(mode=>{localStorage.setItem('interview-online:ui-theme',mode);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:mode}));},mode);
  await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);
  await page.evaluate(async()=>{await document.fonts.ready;document.getAnimations().filter(a=>a.effect?.target instanceof Element && Number.isFinite(a.effect.getComputedTiming().endTime)).forEach(a=>a.finish());await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
}
async function gap(first,second,label) {
  const [a,b]=await Promise.all([first.boundingBox(),second.boundingBox()]);
  assert.ok(a&&b,`${label}: visible pair`);
  const separation=Math.max(b.y-a.y-a.height,b.x-a.x-a.width);
  assert.ok(separation>=7.9,`${label}: meaningful gap, actual ${separation}px`);
}
async function textAxis(locator) {
  return locator.evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.textContent.trim()){const r=document.createRange();r.selectNodeContents(n);const box=r.getBoundingClientRect();if(box.width)return box.y+box.height/2;}}throw Error('visible text not found');});
}
test('team roster and invitation descriptions have explicit spacing, including empty and revoked states',async()=>{
 const {auth,team,browser,page}=await fixture();
 try {
  await page.goto(`${web}/workspace/teams/${team.id}/members`);
  for(const width of [1366,1024,768]) for(const mode of ['light','dark']) {
   await settle(page,mode,width);
   await gap(page.getByText('Состав команды',{exact:true}),page.getByText('Видны только активные участники этой команды.',{exact:true}),'roster title/description');
   await gap(page.getByText('Ссылка ещё не выпущена',{exact:true}),page.getByText('Ожидающая ссылка не добавляет сотрудника до явного принятия.',{exact:true}),'empty invitation title/description');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  const {invitation}=await request(`/teams/${team.id}/invitations`,auth.token,{});
  await request(`/teams/${team.id}/invitations/${invitation.id}/revoke`,auth.token,{});
  await page.reload();await page.getByText('Ссылка для вступления в команду',{exact:true}).waitFor();
  for(const mode of ['light','dark']) {
   await settle(page,mode,1366);
   await gap(page.getByText('Ссылка для вступления в команду',{exact:true}),page.getByText('Отозвано',{exact:true}),'invitation title/state');
   await page.screenshot({path:`.run/layout-members-${mode}-1366.png`,fullPage:true});
  }
 } finally {await browser.close();}
});
test('workspace logout visible text shares the profile axis, and themes remain last at every width',async()=>{
 const {team,browser,page}=await fixture();
 try {
  for(const path of ['/workspace/personal/interviews',`/workspace/teams/${team.id}/interviews`]) for(const width of [1366,1024,768]) for(const mode of ['light','dark']) {
   await page.goto(`${web}${path}`);await page.getByRole('button',{name:/Команды:/}).waitFor();await settle(page,mode,width);
   const header=page.locator('header');const profile=header.getByRole('link',{name:/Открыть профиль/});const logout=header.getByRole('button',{name:'Выйти',exact:true});
   const axis=await Promise.all([profile,logout].map(textAxis));assert.ok(Math.abs(axis[0]-axis[1])<=2,`${path}/${width}/${mode}: visible text axis ${axis}`);
   const boxes=await Promise.all([profile,logout].map(x=>x.boundingBox()));assert.ok(Math.abs(boxes[0].height-boxes[1].height)<=1,'equal click area heights');
   const theme=header.getByRole('button',{name:/^(Светлая|Тёмная) тема$/});const b=await theme.boundingBox();assert.ok(b.x>=boxes[1].x+boxes[1].width,'theme is rightmost');
  }
 } finally {await browser.close();}
});
test('personal and team library controls and selected tabs remain compact and aligned in both themes',async()=>{
 const {team,browser,page}=await fixture();
 try {
  for(const [scope,path,name] of [['personal','/workspace/personal/library','Язык задач'],['team',`/workspace/teams/${team.id}/library`,'Фильтр языка задач']]) for(const width of [1366,1024,768]) for(const mode of ['light','dark']) {
   await page.goto(`${web}${path}`);const filter=page.getByRole('combobox',{name,exact:true});await filter.waitFor();await settle(page,mode,width);
   const r=await filter.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]').boundingBox();assert.ok(r.height>=32&&r.height<=40,`${scope}: single select height ${r.height}`);assert.ok(r.width>=190&&r.width<=210,`${scope}: language filter width ${r.width}`);
   const tabs=page.getByRole('tab');const first=tabs.filter({hasText:/^Задачи$/});const second=tabs.filter({hasText:/^Наборы задач$/});const [a,b]=await Promise.all([first,second].map(tab=>tab.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-tabs-tab ")][1]').boundingBox()));assert.ok(Math.abs(a.y+a.height/2-b.y-b.height/2)<=1,'tabs share axis');assert.ok(b.x-a.x-a.width<=9,'tab spacing has no duplicated gutter');
   const active=page.getByRole('tab',{selected:true});const before=await active.evaluate(el=>getComputedStyle(el).color);await active.hover();await active.evaluate(el=>el.getAnimations().forEach(a=>a.finish()));assert.equal(await active.evaluate(el=>getComputedStyle(el).color),before,'selected tab keeps its color on hover');
   await second.click();assert.equal(await second.getAttribute('aria-selected'),'true');await first.click();await filter.waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:`.run/layout-${scope}-library-${mode}-${width}.png`,fullPage:true});
  }
 } finally {await browser.close();}
});
test('landing and room themes appear after navigation in visual and DOM order',async()=>{
 const {auth,browser,page}=await fixture();const room=await request('/rooms',auth.token,{title:'Проверка шапки комнаты',taskIds:[]});
 try {
  for(const width of [1366,1024,768]) for(const mode of ['light','dark']) for(const [surface,path,name] of [['landing','/','Личный кабинет'],['room',`/room/${room.inviteCode}`,'Главная']]) {
   await page.goto(`${web}${path}`);const navigation=page.getByRole('link',{name,exact:true});await navigation.waitFor();await settle(page,mode,width);
   const theme=page.getByRole('button',{name:/^(Светлая|Тёмная) тема$/});const [a,b]=await Promise.all([navigation.boundingBox(),theme.boundingBox()]);assert.ok(b.x>=a.x+a.width||b.y>=a.y+a.height,'theme follows navigation visually');
   assert.equal(await navigation.evaluate(el=>{const theme=document.querySelector('button[aria-label="Светлая тема"],button[aria-label="Тёмная тема"]');return Boolean(el.compareDocumentPosition(theme)&Node.DOCUMENT_POSITION_FOLLOWING);}),true,'theme follows navigation in DOM/keyboard order');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
 }finally{await browser.close();}
});
test('empty interview and archived track or vacancy title pairs have readable separated lines',async()=>{
 const {auth,team,browser,page}=await fixture();
 try {
  await page.goto(`${web}/workspace/personal/interviews`);await page.getByText('У вас пока нет интервью',{exact:true}).waitFor();
  for(const mode of ['light','dark']) {await settle(page,mode,1366);await gap(page.getByText('У вас пока нет интервью',{exact:true}),page.getByText('Создайте первое интервью — оно появится в этом списке.',{exact:true}),'empty personal interview');}
  const {track}=await request(`/teams/${team.id}/tracks`,auth.token,{name:'Архивный трек для отступов'});
  const {vacancy}=await request(`/teams/${team.id}/tracks/${track.id}/vacancies`,auth.token,{title:'Архивная вакансия для отступов'});
  await request(`/teams/${team.id}/tracks/${track.id}/vacancies/${vacancy.id}/archive`,auth.token,{});
  await page.goto(`${web}/workspace/teams/${team.id}/tracks`);await page.getByRole('tab',{name:'Архив',exact:true}).click();
  const card=page.getByRole('region',{name:'Архивная вакансия Архивная вакансия для отступов',exact:true});await card.waitFor();
  for(const mode of ['light','dark']) {await settle(page,mode,1366);await gap(card.getByText('Архивная вакансия для отступов',{exact:true}),card.getByText('Трек: Архивный трек для отступов',{exact:true}),'archive vacancy title/meta');}
  await request(`/teams/${team.id}/tracks/${track.id}/archive`,auth.token,{});
  await page.reload();await page.getByRole('tab',{name:'Архив',exact:true}).click();const trackCard=page.getByRole('region',{name:'Архивный трек Архивный трек для отступов',exact:true});await trackCard.waitFor();
  for(const mode of ['light','dark']) {await settle(page,mode,1366);await gap(trackCard.getByText('Архивный трек для отступов',{exact:true}),trackCard.getByText(/Архивный трек ·/),'archive track title/meta');}
 }finally{await browser.close();}
});
test('legacy administrative header keeps the nickname, logout text and theme on the same axis',async()=>{
 const {auth,browser,page}=await fixture('admin');
 try {
  // Geometry only through the legacy admin route; no admin mutations or permission claims.
  await page.route('**/api/me/profile',route=>route.fulfill({json:{...auth.user,role:'admin'}}));
  await page.route('**/api/admin/users',route=>route.fulfill({json:[]}));
  await page.goto(`${web}/dashboard/admin`);const header=page.locator('header');const logout=header.getByRole('button',{name:'Выйти',exact:true});await logout.waitFor();
  for(const width of [1366,1024,768]) for(const mode of ['light','dark']) {
   await settle(page,mode,width);const name=header.getByText(`@${auth.user.nickname}`,{exact:true});const axes=await Promise.all([name,logout].map(textAxis));assert.ok(Math.abs(axes[0]-axes[1])<=2,'legacy text axis');
   assert.equal(Math.round((await logout.boundingBox()).height),36,'legacy logout has same36px target');
   const theme=header.getByRole('button',{name:/^(Светлая|Тёмная) тема$/});const [a,b]=await Promise.all([logout.boundingBox(),theme.boundingBox()]);assert.ok(b.x>=a.x+a.width,'legacy theme last');
  }
 }finally{await browser.close();}
});
test('task set heading icon and title share an axis with compact aligned toolbar controls',async()=>{
 const {browser,page}=await fixture();
 try {
  await page.goto(`${web}/workspace/personal/library?tab=sets`);const title=page.getByRole('heading',{name:'Наборы задач',exact:true});await title.waitFor();
  for(const width of [1366,1024,768]) for(const mode of ['light','dark']) {
   await settle(page,mode,width);const icon=title.locator('xpath=preceding-sibling::span[@aria-hidden="true"]');const [a,b]=await Promise.all([title.boundingBox(),icon.boundingBox()]);assert.ok(Math.abs(a.y+a.height/2-b.y-b.height/2)<=2,`bookmark and heading axis: title${JSON.stringify(a)} icon${JSON.stringify(b)}`);
   const create=page.getByRole('button',{name:'Создать набор',exact:true});const importing=page.getByRole('button',{name:'Импортировать',exact:true});assert.equal(await page.getByRole('tab',{name:'Архив',exact:true}).count(),0);const [c,d]=await Promise.all([create.boundingBox(),importing.boundingBox()]);if(width>=1024)assert.ok(Math.abs(c.y+c.height/2-d.y-d.height/2)<=2,'toolbar controls share axis on desktop');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`.run/layout-personal-sets-${mode}-${width}.png`,fullPage:true});
  }
 }finally{await browser.close();}
});
test('login and invitation theme controls remain at the right edge in both themes',async()=>{
 const browser=await chromium.launch();const context=await browser.newContext();const page=await context.newPage();
 try {
  for(const path of ['/login','/join/team/']) for(const width of [1366,768]) for(const mode of ['light','dark']) {
   await page.goto(`${web}${path}`);const theme=page.getByRole('button',{name:/^(Светлая|Тёмная) тема$/});await theme.waitFor();await settle(page,mode,width);const r=await theme.boundingBox();assert.ok(r.x+r.width>=width-40,'theme is at header right');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(path==='/login') {const brand=page.getByRole('link',{name:'На главную страницу InterHub',exact:true});assert.equal(await brand.evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('header button'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'login theme follows brand in DOM');}
  }
 }finally{await browser.close();}
});
test('workspace content and header retain comfortable side padding on tablet widths',async()=>{
 const {team,browser,page}=await fixture();
 try {
  for(const path of ['/workspace/personal/library',`/workspace/teams/${team.id}/library`]) for(const width of [1024,768]) for(const mode of ['light','dark']) {
   await page.goto(`${web}${path}`);const heading=page.getByRole('heading',{name:'Библиотека',exact:true});await heading.waitFor();await settle(page,mode,width);const r=await heading.boundingBox();assert.ok(r.x>=16,'content has16px side padding');const workspace=page.getByRole('button',{name:/Команды:/});const h=await workspace.boundingBox();assert.ok(h.x>=60,'brand plus16px header padding');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
 }finally{await browser.close();}
});
