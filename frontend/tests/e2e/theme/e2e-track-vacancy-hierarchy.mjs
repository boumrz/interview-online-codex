import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
const api=process.env.E2E_API_URL??'http://localhost:8080/api';
const web=process.env.E2E_BASE_URL??'http://localhost:5173';
async function req(path,token,body,method=body?'POST':'GET'){
 const response=await fetch(api+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.ok(response.ok,`${method} ${path}: ${response.status}`);return response.status===204?null:response.json();
}
async function fixture(){
 const auth=await req('/auth/register',null,{nickname:`trackux_${crypto.randomUUID().slice(0,10)}`,displayName:'Дизайнер треков',password:'test-password-123'});
 const {team}=await req('/teams',auth.token,{name:'UX иерархия треков'});
 const {track}=await req(`/teams/${team.id}/tracks`,auth.token,{name:'Разработка интерфейсов'});
 const {vacancy:first}=await req(`/teams/${team.id}/tracks/${track.id}/vacancies`,auth.token,{title:'Frontend разработчик'});
 const {vacancy:second}=await req(`/teams/${team.id}/tracks/${track.id}/vacancies`,auth.token,{title:'Ведущий frontend разработчик'});
 const {task:trackTask}=await req(`/teams/${team.id}/tasks`,auth.token,{title:'Архитектура компонентов',description:'Проверка структуры',language:'nodejs'});
 const {task:vacancyTask}=await req(`/teams/${team.id}/tasks`,auth.token,{title:'Разбор UI-состояний',description:'Проверка состояний',language:'nodejs'});
 const trackDraft=await req(`/teams/${team.id}/tracks/${track.id}/programme/draft`,auth.token,{taskIds:[trackTask.id]},'PATCH');
 await req(`/teams/${team.id}/tracks/${track.id}/programme/publish`,auth.token,{revision:trackDraft.programme.revision});
 const vacancyDraft=await req(`/teams/${team.id}/tracks/${track.id}/vacancies/${first.id}/programme/draft`,auth.token,{taskIds:[vacancyTask.id]},'PATCH');
 await req(`/teams/${team.id}/tracks/${track.id}/vacancies/${first.id}/programme/publish`,auth.token,{revision:vacancyDraft.programme.revision});
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1366,height:1000}});
 await context.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('auth_user',JSON.stringify(user));},auth);
 return{auth,team,track,first,second,browser,page:await context.newPage()};
}
async function settled(page,theme,width){
 await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{localStorage.setItem('interview-online:ui-theme',theme);window.dispatchEvent(new StorageEvent('storage',{key:'interview-online:ui-theme',newValue:theme}));},theme);
 await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
 await page.evaluate(async()=>{await document.fonts.ready;document.getAnimations().filter(a=>a.effect?.target instanceof Element&&Number.isFinite(a.effect.getComputedTiming().endTime)).forEach(a=>a.finish());await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
}
for(const theme of ['light','dark'])test(`track and vacancy are distinct nested surfaces with contained actions in ${theme}`,async()=>{
 const {browser,page,team}=await fixture();page.setDefaultTimeout(6000);
 try{
  await page.goto(`${web}/workspace/teams/${team.id}/tracks`);const parent=page.getByRole('region',{name:'Трек Разработка интерфейсов',exact:true});await parent.waitFor();
  const children=parent.getByTestId('team-track-vacancy-row');assert.equal(await children.count(),2);
  await children.filter({has:page.getByText('Frontend разработчик',{exact:true})}).getByText('Разбор UI-состояний',{exact:true}).waitFor();
  await children.filter({has:page.getByText('Ведущий frontend разработчик',{exact:true})}).getByText('Архитектура компонентов',{exact:true}).waitFor();
  for(const width of[1366,768]){
   await settled(page,theme,width);
   const parentBackground=await parent.evaluate(el=>getComputedStyle(el).backgroundColor),parentBox=await parent.boundingBox();const boxes=[];
   for(const child of await children.all()){
    const appearance=await child.evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,border:s.borderTopWidth,borderStyle:s.borderTopStyle,borderColor:s.borderTopColor,radius:s.borderRadius,paddingTop:s.paddingTop,paddingLeft:s.paddingLeft};});
    assert.ok(parseFloat(appearance.border)>=1&&appearance.borderStyle==='solid',`vacancy has its own calm boundary; actual ${JSON.stringify(appearance)}`);
    assert.notEqual(appearance.background,parentBackground,'vacancy surface differs from track surface');
    assert.ok(parseFloat(appearance.radius)>=8,'vacancy boundary has consistent rounded corners');assert.ok(parseFloat(appearance.paddingTop)>=12&&parseFloat(appearance.paddingLeft)>=12,'vacancy content is inset');
    const b=await child.boundingBox();boxes.push(b);assert.ok(b.x>=parentBox.x+12&&b.x+b.width<=parentBox.x+parentBox.width-12,'vacancy is visibly nested inside track');
    for(const button of await child.getByRole('button').all())if(await button.isVisible()){const a=await button.boundingBox();assert.ok(a.x>=b.x+8&&a.x+a.width<=b.x+b.width-8,'vacancy actions remain within their own card');}
   }
   assert.ok(boxes[1].y-boxes[0].y-boxes[0].height>=11.9,'vacancies have at least12px separation');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page has no horizontal overflow');
   await page.screenshot({path:`.run/track-vacancy-${theme}-${width}.png`,fullPage:true});
  }
 }finally{await browser.close();}
});
test('track hierarchy preserves separate vacancy and parent archive/restore controls',async()=>{
 const {auth,team,track,first,browser,page}=await fixture();page.setDefaultTimeout(6000);
 try{
  await req(`/teams/${team.id}/tracks/${track.id}/vacancies/${first.id}/archive`,auth.token,{});
  await page.goto(`${web}/workspace/teams/${team.id}/tracks`);const trackCard=page.getByRole('region',{name:'Трек Разработка интерфейсов',exact:true});await trackCard.waitFor();assert.equal(await trackCard.getByTestId('team-track-vacancy-row').count(),1);
  await page.getByRole('tab',{name:'Архив',exact:true}).click();const archivedVacancy=page.getByRole('region',{name:'Архивная вакансия Frontend разработчик',exact:true});await archivedVacancy.waitFor();await archivedVacancy.getByRole('button',{name:'Восстановить вакансию Frontend разработчик',exact:true}).click();await archivedVacancy.waitFor({state:'hidden'});
  await page.getByRole('tab',{name:'Активные',exact:true}).click();await trackCard.waitFor();assert.equal(await trackCard.getByTestId('team-track-vacancy-row').count(),2);
  await trackCard.getByRole('button',{name:'Архивировать трек Разработка интерфейсов',exact:true}).click();await trackCard.waitFor({state:'hidden'});
  await page.getByRole('tab',{name:'Архив',exact:true}).click();const archivedTrack=page.getByRole('region',{name:'Архивный трек Разработка интерфейсов',exact:true});await archivedTrack.waitFor();await archivedTrack.getByRole('button',{name:'Восстановить трек Разработка интерфейсов',exact:true}).click();await archivedTrack.waitFor({state:'hidden'});
  await page.getByRole('tab',{name:'Активные',exact:true}).click();await trackCard.waitFor();assert.equal(await trackCard.getByTestId('team-track-vacancy-row').count(),2);
 }finally{await browser.close();}
});
