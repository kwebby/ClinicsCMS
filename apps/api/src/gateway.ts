/* Author: ramanpal singh | URL: https://kwebby.com */
import { Inject } from '@nestjs/common';
import { WebSocketGateway,WebSocketServer } from '@nestjs/websockets';
import { Server,Socket } from 'socket.io';
import type { Request } from 'express';
import { Runtime } from './runtime.js';
import { allowedOrigins,installationId,sessionCookie } from './security.js';
import { assert,type Actor } from '../../../packages/contracts/src/index.js';
import { baseVisible } from '../../../packages/core/src/access.js';
/** How long a socket's authorization is reused before the session is re-checked (revocation, sessionVersion, disablement, expiry). */
export const SOCKET_AUTH_TTL_MS=30000;
type SocketAuth={actor:Actor;checkedAt:number};
@WebSocketGateway({maxHttpBufferSize:65536,transports:['websocket','polling']})
export class ClinicGateway {
 @WebSocketServer() server!:Server;
 private subscriber?:ReturnType<Runtime['redis']['duplicate']>;
 constructor(@Inject(Runtime) private r:Runtime){}
 private request(client:Socket):Request {const cookie=client.handshake.headers.cookie??'';const cookies=Object.fromEntries(cookie.split(';').map(x=>x.trim().split('=')));return {method:'POST',cookies,get:(name:string)=>name==='origin'?client.handshake.headers.origin:name==='x-csrf-token'?client.handshake.auth.csrfToken:undefined} as unknown as Request;}
 /** Socket traffic never extends the HTTP session's idle timeout; a revoked or idle-expired session stops receiving events within the cache window. */
 async actor(client:Socket,now=Date.now()):Promise<Actor|null>{
  const cached=client.data.auth as SocketAuth|undefined;if(cached&&now-cached.checkedAt<SOCKET_AUTH_TTL_MS)return cached.actor;
  const actor=await this.r.auth.peek(sessionCookie(this.request(client)));if(!actor||actor.id!==client.data.userId){client.data.auth=undefined;client.disconnect(true);return null;}
  client.data.auth={actor,checkedAt:now} satisfies SocketAuth;return actor;
 }
 async afterInit(){this.r.auth.setRevoker(id=>{for(const socket of this.server.sockets.sockets.values())if(socket.data.userId===id)socket.disconnect(true);});this.subscriber=this.r.redis.duplicate();await this.subscriber.subscribe(`clinic:${installationId()}:events`);this.subscriber.on('message',(_channel,value)=>{void this.broadcast(value);});}
 async handleConnection(client:Socket){try{assert(allowedOrigins().has(client.handshake.headers.origin??''),'ORIGIN','Origin denied',403);const actor=await this.r.auth.require(this.request(client),{mutation:true});client.data.userId=actor.id;client.data.auth={actor,checkedAt:Date.now()} satisfies SocketAuth;}catch{client.disconnect(true);}}
 async broadcast(value:string){
  let event:{type:string;payload:Record<string,string>};try{event=JSON.parse(value);}catch{return;}
  if(event.type==='message.created'){
   // One read per event; each socket's access is then decided in memory from its cached authorization.
   const id=String(event.payload?.conversationId??''),conversation=id?await this.r.db.get('conversations',id):null;if(!conversation)return;
   for(const client of this.server.sockets.sockets.values()){try{const actor=await this.actor(client);if(actor&&conversation.organizationId===actor.organizationId&&baseVisible('conversations',conversation,actor))client.emit('message',{conversationId:id});}catch{/* No record data is sent to revoked or unrelated accounts. */}}
  }else if(event.type==='notification.created'){
   for(const client of this.server.sockets.sockets.values()){if(client.data.userId!==event.payload?.userId)continue;try{if(await this.actor(client))client.emit('notification',{notificationId:event.payload.notificationId});}catch{/* Skip sockets whose session cannot be confirmed. */}}
  }
 }
 async onModuleDestroy(){await this.subscriber?.quit();}
}
