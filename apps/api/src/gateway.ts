/* Author: ramanpal singh | URL: https://kwebby.com */
import { Inject } from '@nestjs/common';
import { WebSocketGateway,WebSocketServer,SubscribeMessage,ConnectedSocket,MessageBody } from '@nestjs/websockets';
import { Server,Socket } from 'socket.io';
import type { Request } from 'express';
import { Runtime } from './runtime.js';
import { allowedOrigins } from './security.js';
import { assert } from '../../../packages/contracts/src/index.js';
@WebSocketGateway({maxHttpBufferSize:65536,transports:['websocket','polling']})
export class ClinicGateway {
 @WebSocketServer() server!:Server;
 private subscriber?:ReturnType<Runtime['redis']['duplicate']>;
 constructor(@Inject(Runtime) private r:Runtime){}
 private request(client:Socket):Request {const cookie=client.handshake.headers.cookie??'';const cookies=Object.fromEntries(cookie.split(';').map(x=>x.trim().split('=')));return {method:'POST',cookies,get:(name:string)=>name==='origin'?client.handshake.headers.origin:name==='x-csrf-token'?client.handshake.auth.csrfToken:undefined} as unknown as Request;}
 private async actor(client:Socket){return this.r.auth.require(this.request(client),{mutation:true});}
 async afterInit(){this.r.auth.setRevoker(id=>{for(const socket of this.server.sockets.sockets.values())if(socket.data.userId===id)socket.disconnect(true);});this.subscriber=this.r.redis.duplicate();await this.subscriber.subscribe(`clinic:${process.env.INSTALLATION_ID??'local'}:events`);this.subscriber.on('message',(_channel,value)=>{void this.broadcast(value);});}
 async handleConnection(client:Socket){try{assert(allowedOrigins().has(client.handshake.headers.origin??''),'ORIGIN','Origin denied',403);const actor=await this.actor(client);client.data.userId=actor.id;}catch{client.disconnect(true);}}
 @SubscribeMessage('conversation.join') async join(@ConnectedSocket() client:Socket,@MessageBody() body:{conversationId:string}){try{const actor=await this.actor(client);await this.r.clinic.get('conversations',String(body?.conversationId),actor);await client.join(`conversation:${body.conversationId}`);return {ok:true};}catch{client.disconnect(true);return {ok:false};}}
 private async broadcast(value:string){let event:{type:string;payload:Record<string,string>};try{event=JSON.parse(value);}catch{return;}for(const client of this.server.sockets.sockets.values()){try{const actor=await this.actor(client);if(event.type==='message.created'){const id=event.payload.conversationId;await this.r.clinic.get('conversations',id,actor);client.emit('message',{conversationId:id});}else if(event.type==='notification.created'&&event.payload.userId===actor.id)client.emit('notification',{notificationId:event.payload.notificationId});}catch{/* No record data is sent to revoked or unrelated accounts. */}}}
 async onModuleDestroy(){await this.subscriber?.quit();}
}
