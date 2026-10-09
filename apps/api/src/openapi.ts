/* Author: ramanpal singh | URL: https://kwebby.com */
import { z } from 'zod';
import { schemas,actionSchemas } from '../../../packages/core/src/schemas.js';
import type { OpenAPIObject } from '@nestjs/swagger';
/** Auth routes usable without a session. All others (session, logout, MFA, team, invite, revoke) need the session cookie, and CSRF for mutations. */
const publicAuthRoute=/\/auth\/(status|bootstrap|register|login|accept-invite|reset-password|consume-token)$/;
export function enrichOpenApi(document:OpenAPIObject){
 const all={...Object.fromEntries(Object.entries(schemas).map(([k,v])=>[`Create_${k}`,v])),...Object.fromEntries(Object.entries(actionSchemas).map(([k,v])=>[`Action_${k}`,v]))};
 document.components??={};document.components.schemas??={};
 for(const [name,schema]of Object.entries(all))document.components.schemas[name]=z.toJSONSchema(schema,{target:'openapi-3.0',unrepresentable:'any'}) as any;
 document.components.securitySchemes={session:{type:'apiKey',in:'cookie',name:process.env.NODE_ENV==='production'?'__Host-clinic-session':'clinic-session'}};
 document.components.schemas.ApiError={type:'object',required:['error','requestId'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'}}},requestId:{type:'string',format:'uuid'}}};
 for(const [path,methods]of Object.entries(document.paths))for(const [method,operation]of Object.entries(methods)){if(!operation||typeof operation!=='object'||!('responses'in operation))continue;const op=operation as any;const publicRoute=path.includes('/public/')||publicAuthRoute.test(path)||path.includes('/webhooks/')||/\/(health|ready)$/.test(path);if(!publicRoute){op.security=[{session:[]}];if(!['get','head'].includes(method)){op.parameters??=[];op.parameters.push({name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}});}}op.responses['400']={description:'Validation or business rule rejected',content:{'application/json':{schema:{$ref:'#/components/schemas/ApiError'}}}};op.responses['403']={description:'Permission, MFA, origin or CSRF denied'};op.responses['409']={description:'Concurrent edit, lifecycle or idempotency conflict'};}
 const create=document.paths['/api/v1/records/{collection}']?.post;
 if(create)create.requestBody={required:true,content:{'application/json':{schema:{oneOf:Object.keys(schemas).map(name=>({$ref:`#/components/schemas/Create_${name}`}))}}}};
 const action=document.paths['/api/v1/actions/{action}']?.post;
 if(action)action.requestBody={required:true,content:{'application/json':{schema:{oneOf:Object.keys(actionSchemas).map(name=>({$ref:`#/components/schemas/Action_${name}`}))}}}};
 return document;
}
