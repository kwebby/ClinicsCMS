/* Author: ramanpal singh | URL: https://kwebby.com */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Module,Catch,ExceptionFilter,ArgumentsHost,HttpException } from '@nestjs/common';
import { SwaggerModule,DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { Request,Response,NextFunction } from 'express';
import { DomainError } from '../../../packages/contracts/src/index.js';
import { Runtime } from './runtime.js';
import { AuthController,ClinicController,PublicController } from './controllers.js';
import { MultipartAccessGuard } from './guards.js';
import { ClinicGateway } from './gateway.js';
import { enrichOpenApi } from './openapi.js';
import { allowedOrigins,publicOrigin } from './security.js';

@Catch()
class ApiErrors implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){const context=host.switchToHttp(),res=context.getResponse<Response>();const status=error instanceof DomainError?error.status:error instanceof ZodError?400:error instanceof HttpException?error.getStatus():500;const code=error instanceof DomainError?error.code:error instanceof ZodError?'VALIDATION':status===500?'INTERNAL':'REQUEST';const message=error instanceof DomainError?error.message:error instanceof ZodError?`Check these fields: ${error.issues.map(i=>i.path.join('.')).filter(Boolean).slice(0,8).join(', ')||'request'}`:status===500?'The request could not be completed. Use the request ID when contacting support.':'The request was rejected.';if(status>=500)console.error(JSON.stringify({event:'api.error',requestId:res.getHeader('X-Request-ID'),code,errorType:error instanceof Error?error.name:'unknown'}));res.status(status).json({error:{code,message},requestId:res.getHeader('X-Request-ID')});}
}
@Module({controllers:[AuthController,ClinicController,PublicController],providers:[Runtime,ClinicGateway,MultipartAccessGuard]})
export class AppModule {}
export async function createApp(){
 if(process.env.NODE_ENV==='production'){if(!publicOrigin().startsWith('https://'))throw new Error('Production PUBLIC_URL must use HTTPS');if(process.env.REQUIRE_STAFF_MFA==='false')throw new Error('Staff MFA cannot be disabled in production');if(process.env.FIRESTORE_EMULATOR_HOST)throw new Error('The Firestore emulator is forbidden in production');}
 const app=await NestFactory.create(AppModule,{rawBody:true,bodyParser:true,logger:['error','warn','log']});
 const express=app.getHttpAdapter().getInstance();express.disable('x-powered-by');express.set('trust proxy',process.env.TRUST_PROXY_HOPS?Number(process.env.TRUST_PROXY_HOPS):false);
 app.use(helmet());app.use(cookieParser());
 app.use((req:Request,res:Response,next:NextFunction)=>{res.setHeader('X-Request-ID',randomUUID());res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Robots-Tag','noindex, nofollow');next();});
 app.enableCors({origin:(origin:string|undefined,cb:(err:Error|null,allowed:boolean)=>void)=>cb(null,!!origin&&allowedOrigins().has(origin)),credentials:true,allowedHeaders:['Content-Type','X-CSRF-Token'],methods:['GET','POST','PATCH','PUT','OPTIONS']});
 const runtime=app.get(Runtime);
 app.use((req:Request,res:Response,next:NextFunction)=>{runtime.limiter.take(`request:${req.ip}`,300,60).then(()=>next()).catch((error:unknown)=>{const limited=error instanceof DomainError&&error.status===429;res.status(limited?429:503).json(limited?{error:{code:'RATE_LIMIT',message:'Too many requests. Try again shortly.'}}:{error:{code:'UNAVAILABLE',message:'The service is temporarily unavailable. Try again shortly.'}});});});
 app.useGlobalFilters(new ApiErrors());app.enableShutdownHooks();
 const spec=enrichOpenApi(SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('ClinicsCMS API').setDescription('Versioned clinic operations. Opaque cookie session and X-CSRF-Token required for authenticated mutations. See docs/API-CONTRACT.md and docs/DOMAIN-API.md for strict schemas.').setVersion('1.0').addCookieAuth('clinic-session').build()));
 if(process.env.OPENAPI_ENABLED==='true')SwaggerModule.setup('api/docs',app,spec);
 return app;
}
if(!process.env.VITEST){const app=await createApp();await app.listen(Number(process.env.API_PORT??4000),process.env.API_HOST??'127.0.0.1');console.log(`ClinicsCMS API listening on ${process.env.API_PORT??4000}`);}
