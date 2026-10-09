/* Author: ramanpal singh | URL: https://kwebby.com */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paceApiRequests } from './network-pacing.js';

type DemoAccess={password:string;accounts:{name:string;email:string;roles:string[]}[]};
const fixture=resolve(process.env.DEMO_ACCESS_FILE||'.runtime/demo-access.json');
const access:DemoAccess|null=existsSync(fixture)?JSON.parse(readFileSync(fixture,'utf8')):null;
// Keep the shared fictional-owner session in process memory to avoid testing login limits repeatedly.
let ownerCookies:Awaited<ReturnType<BrowserContext['cookies']>>|undefined;

async function login(page:Page,role='owner'){
 if(!access)throw new Error('Seed an isolated fictional installation before running workspace tests.');
 const account=access.accounts.find(account=>account.roles.includes(role));
 if(!account)throw new Error(`Fictional ${role} account is missing.`);
 await page.goto('/login');
 await page.getByLabel('Email address',{exact:true}).fill(account.email);
 await page.getByLabel('Password',{exact:true}).fill(access.password);
 const signedIn=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/v1/auth/login'));
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 const response=await signedIn;
 expect(response.ok(),`Fictional ${role} sign-in returned HTTP ${response.status()}`).toBeTruthy();
 await page.waitForURL('**/workspace');
}
const noPopup=(page:Page)=>expect(page.locator('dialog:modal')).toHaveCount(0);
async function mobileScreenshot(page:Page,path:string){
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('navigation',{name:'Workspace navigation',exact:true})).not.toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
 await page.screenshot({path,fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:1440,height:1050});
}
async function createTask(page:Page,title:string){
 await page.goto('/workspace/tasks');
 await page.getByRole('link',{name:'New task',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace\/tasks\/new$/);
 await expect(page.getByRole('heading',{level:1,name:'New task',exact:true})).toBeVisible();
 await noPopup(page);
 await page.getByLabel(/^Task(?:\s*\*)?$/).fill(title);
 await page.getByLabel(/^Assigned to(?:\s*\*)?$/).selectOption({label:access!.accounts.find(account=>account.roles.includes('owner'))!.name});
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/v1/records/tasks',async route=>{await pending;await route.fallback()},{times:1});
 const submitted=page.waitForRequest(request=>request.method()==='POST'&&request.url().endsWith('/api/v1/records/tasks'));
 try{
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await submitted;
  await expect(page.getByLabel(/^Task(?:\s*\*)?$/)).toBeDisabled();
  await expect(page.locator('form.record-form > fieldset')).toHaveAttribute('inert','');
  await expect(page.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();
 }finally{release();}
 await expect(page).toHaveURL(/\/workspace\/tasks\/[A-Za-z0-9_-]+$/);
 await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
 await expect(page.locator('.detail-meta .status')).toHaveText('open');
 await noPopup(page);
 return new URL(page.url()).pathname;
}

test.beforeEach(async({page,context})=>{
 test.skip(!access,'Run pnpm seed:demo against an isolated disposable database before these UI tests.');
 await paceApiRequests(context);
 if(ownerCookies){
  await context.addCookies(ownerCookies);
  await page.goto('/workspace');
  await expect(page.getByRole('heading',{name:'Your clinic, today.',exact:true})).toBeVisible();
 }else{
  await login(page);
  ownerCookies=await context.cookies();
 }
});

test('task pages survive reloads and table status shortcuts update the Kanban board',async({page},testInfo)=>{
 const title=`Fictional navigation task ${Date.now()}`;
 const detailPath=await createTask(page,title);
 await page.reload();
 await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Edit task',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`${detailPath}/edit$`));
 await expect(page.getByRole('heading',{level:1,name:'Edit task',exact:true})).toBeVisible();
 await page.getByLabel('Description',{exact:true}).fill('Fictional work, edited on its own page.');
 await expect(page.getByLabel(/^Assigned to(?:\s*\*)?$/).locator('option:checked')).toHaveText(access!.accounts.find(account=>account.roles.includes('owner'))!.name);
 await page.screenshot({path:testInfo.outputPath('task-edit-desktop.png'),fullPage:true,animations:'disabled'});
 await mobileScreenshot(page,testInfo.outputPath('task-edit-mobile.png'));
 const detailsDirectory=page.waitForResponse(response=>response.url().endsWith('/api/v1/directory'));
 await page.getByRole('button',{name:'Save task',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
 await expect(page.getByText('Fictional work, edited on its own page.',{exact:true})).toBeVisible();
 await detailsDirectory;
 // A selected reference must remain valid even when its options have not returned yet.
 let releaseDirectory!:()=>void;
 const directoryPending=new Promise<void>(resolve=>{releaseDirectory=resolve});
 await page.route('**/api/v1/directory',async route=>{await directoryPending;await route.fallback()},{times:1});
 const directoryRequested=page.waitForRequest(request=>request.url().endsWith('/api/v1/directory'));
 try{
  await page.getByRole('link',{name:'Edit task',exact:true}).click();
  await directoryRequested;
  await page.getByLabel('Description',{exact:true}).fill('Saved while the staff directory is loading.');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  await expect(page.getByText('Saved while the staff directory is loading.',{exact:true})).toBeVisible();
 }finally{releaseDirectory();}
 await page.getByRole('link',{name:'Back to care tasks',exact:true}).click();
 const status=page.getByRole('combobox',{name:`Update status for ${title}`,exact:true});
 await expect(status).toHaveValue('open');
 const change=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/v1/actions/tasks.status'));
 await status.selectOption('in-progress');
 expect((await change).ok()).toBeTruthy();
 await expect(status).toHaveValue('in-progress');
 await noPopup(page);
 await page.goto('/workspace/tasks?view=board');
 await expect(page).toHaveURL(/\/workspace\/tasks\?view=board$/);
 const board=page.getByRole('region',{name:'Task progress board',exact:true});
 await expect(board).toBeVisible();
 await expect(board.getByRole('region',{name:/^In progress, /}).getByRole('link',{name:title,exact:true})).toBeVisible();
 const move=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/v1/actions/tasks.status'));
 await board.getByRole('combobox',{name:`Move ${title}`,exact:true}).selectOption('blocked');
 expect((await move).ok()).toBeTruthy();
 await expect(board.getByRole('region',{name:/^Blocked, /}).getByRole('link',{name:title,exact:true})).toBeVisible();
 const card=board.getByRole('article').filter({has:page.getByRole('link',{name:title,exact:true})});
 await expect(card).toHaveAttribute('draggable','true');
 await expect(card).toHaveAttribute('aria-busy','false');
 await page.evaluate(()=>{
  const events:{kind:string;types:string[];recordId:string}[]=[];
  (window as typeof window&{clinicDragEvents:typeof events}).clinicDragEvents=events;
  for(const kind of ['dragstart','drop'])document.addEventListener(kind,event=>{
   const transfer=(event as DragEvent).dataTransfer;
   events.push({kind,types:Array.from(transfer?.types||[]),recordId:transfer?.getData('application/x-clinic-record')||''});
  },{once:true});
 });
 const drop=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/v1/actions/tasks.status'));
 // Use the noninteractive card header and lane header, not a link/select or the
 // center of a lane that can extend well below the viewport as tasks accumulate.
 await card.dragTo(board.getByRole('region',{name:/^Open, /}),{sourcePosition:{x:25,y:18},targetPosition:{x:25,y:20}});
 expect((await drop).ok()).toBeTruthy();
 const dragEvents=await page.evaluate(()=>(window as typeof window&{clinicDragEvents:{kind:string;types:string[];recordId:string}[]}).clinicDragEvents);
 for(const kind of ['dragstart','drop'])expect(dragEvents).toContainEqual({kind,types:expect.arrayContaining(['application/x-clinic-record']),recordId:detailPath.split('/').pop()});
 await expect(board.getByRole('region',{name:/^Open, /}).getByRole('link',{name:title,exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('task-kanban-desktop.png'),fullPage:true,animations:'disabled'});
 await mobileScreenshot(page,testInfo.outputPath('task-kanban-mobile.png'));
 await noPopup(page);
 await page.reload();
 await expect(page.locator(`a[href="${detailPath}"]`).first()).toBeVisible();
 await page.locator(`a[href="${detailPath}"]`).first().click();
 await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
 await expect(page.locator('.detail-meta .status')).toHaveText('open');
});

test('appointment calendar has month navigation, current-date reset and refreshable view URLs',async({page},testInfo)=>{
 await page.goto('/workspace/appointments?view=calendar');
 await expect(page).toHaveURL(/\/workspace\/appointments\?view=calendar$/);
 const calendar=page.getByRole('region',{name:'Appointments calendar',exact:true});
 await expect(calendar).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('calendar-desktop.png'),fullPage:true,animations:'disabled'});
 const period=calendar.getByRole('heading',{level:2});
 const currentMonth=await period.innerText();
 await calendar.getByRole('button',{name:'Next month',exact:true}).click();
 await expect(period).not.toHaveText(currentMonth);
 await calendar.getByRole('button',{name:'Previous month',exact:true}).click();
 await expect(period).toHaveText(currentMonth);
 await calendar.getByRole('button',{name:'Previous month',exact:true}).click();
 await expect(period).not.toHaveText(currentMonth);
 await calendar.getByRole('button',{name:'Today',exact:true}).click();
 await expect(period).toHaveText(currentMonth);
 await noPopup(page);
 await page.reload();
 await expect(calendar).toBeVisible();
 await expect(period).toHaveText(currentMonth);
 await calendar.getByRole('group',{name:'Calendar period',exact:true}).getByRole('button',{name:'week',exact:true}).click();
 await expect(calendar.getByRole('button',{name:'Previous week',exact:true})).toBeVisible();
 await calendar.getByRole('group',{name:'Calendar period',exact:true}).getByRole('button',{name:'day',exact:true}).click();
 await expect(calendar.getByRole('button',{name:'Next day',exact:true})).toBeVisible();
 await calendar.getByRole('group',{name:'Calendar period',exact:true}).getByRole('button',{name:'month',exact:true}).click();
 await mobileScreenshot(page,testInfo.outputPath('calendar-mobile.png'));
 await noPopup(page);
});

test('same-tab navigation restores an unfinished draft and sign-out clears it',async({page})=>{
 const title=`Fictional temporary draft ${Date.now()}`;
 const detailPath=await createTask(page,title);
 const dialogs:string[]=[];
 page.on('dialog',dialog=>{dialogs.push(dialog.type());void dialog.dismiss()});
 await page.getByRole('link',{name:'Edit task',exact:true}).click();
 await page.getByLabel('Description',{exact:true}).fill('Draft kept while visiting the task list');
 await page.getByRole('link',{name:'Back to care tasks',exact:true}).click();
 await page.locator(`a[href="${detailPath}"]`).first().click();
 await page.getByRole('link',{name:'Edit task',exact:true}).click();
 await expect(page.getByLabel('Description',{exact:true})).toHaveValue('Draft kept while visiting the task list');
 await page.getByRole('button',{name:'Save task',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
 await page.getByRole('link',{name:'Edit task',exact:true}).click();
 await page.getByLabel('Description',{exact:true}).fill('Unsaved draft that must clear on sign-out');
 await page.getByRole('link',{name:'Back to care tasks',exact:true}).click();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await page.waitForURL('**/login');
 // Stay in the same browser document so a reload cannot accidentally clear the cache for the test.
 const owner=access!.accounts.find(account=>account.roles.includes('owner'))!;
 await page.getByLabel('Email address',{exact:true}).fill(owner.email);
 await page.getByLabel('Password',{exact:true}).fill(access!.password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.waitForURL('**/workspace');
 ownerCookies=await page.context().cookies();
 await page.getByRole('link',{name:'Care tasks',exact:true}).click();
 await page.locator(`a[href="${detailPath}"]`).first().click();
 await page.getByRole('link',{name:'Edit task',exact:true}).click();
 await expect(page.getByLabel('Description',{exact:true})).toHaveValue('Draft kept while visiting the task list');
 await noPopup(page);
 expect(dialogs).toEqual([]);
});

test('visible tasks assigned to another employee offer navigation without status controls',async({page,context})=>{
 const title=`Fictional restricted progress ${Date.now()}`;
 const detailPath=await createTask(page,title);
 await context.clearCookies();
 await login(page,'doctor');
 await page.goto('/workspace/tasks');
 await expect(page.locator(`a[href="${detailPath}"]`).first()).toBeVisible();
 await expect(page.getByRole('combobox',{name:`Update status for ${title}`,exact:true})).toHaveCount(0);
 await page.goto('/workspace/tasks?view=board');
 const board=page.getByRole('region',{name:'Task progress board',exact:true});
 const card=board.getByRole('article').filter({has:page.getByRole('link',{name:title,exact:true})});
 await expect(card).toBeVisible();
 await expect(card).toHaveAttribute('draggable','false');
 await expect(card.getByRole('combobox',{name:`Move ${title}`,exact:true})).toHaveCount(0);
 await card.getByRole('link',{name:title,exact:true}).click();
 await expect(page.getByRole('heading',{name:title,level:1,exact:true})).toBeVisible();
 await noPopup(page);
});

test('two dedicated edit pages show a conflict without overwriting the newer task',async({page,context})=>{
 const title=`Fictional conflict task ${Date.now()}`;
 const detailPath=await createTask(page,title);
 await page.getByRole('link',{name:'Edit task',exact:true}).click();
 await expect(page.getByLabel(/^Task(?:\s*\*)?$/)).toHaveValue(title);
 const second=await context.newPage();
 try{
  await second.goto(`${detailPath}/edit`);
  await expect(second.getByLabel(/^Task(?:\s*\*)?$/)).toHaveValue(title);
  await second.getByLabel('Description',{exact:true}).fill('Older unsaved draft');
  await page.getByLabel('Description',{exact:true}).fill('Newer saved update');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  const conflict=second.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith(detailPath.replace('/workspace','/api/v1/records')));
  await second.getByRole('button',{name:'Save task',exact:true}).click();
  expect((await conflict).status()).toBe(409);
  await expect(second.locator('.record-form [role="alert"]')).toContainText(/changed this record|record changed|latest version/i);
  await expect(second.getByLabel('Description',{exact:true})).toHaveValue('Older unsaved draft');
  await noPopup(second);
  await page.reload();
  await expect(page.getByText('Newer saved update',{exact:true})).toBeVisible();
 }finally{await second.close();}
});
