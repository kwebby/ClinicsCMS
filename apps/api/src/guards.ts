/* Author: ramanpal singh | URL: https://kwebby.com */
import { applyDecorators, CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { assert, type Role } from '../../../packages/contracts/src/index.js';
import { Runtime } from './runtime.js';

/** Nest runs guards before upload interceptors, so untrusted callers cannot allocate multipart buffers. */
@Injectable()
export class MultipartAccessGuard implements CanActivate {
 constructor(@Inject(Runtime) private readonly runtime:Runtime) {}
 async canActivate(context:ExecutionContext):Promise<boolean> {
  const req=context.switchToHttp().getRequest<Request>();
  const actor=await this.runtime.auth.require(req,{mutation:true});
  const roles=(Reflect.getMetadata('clinic.upload.roles',context.getHandler())??[]) as Role[];
  assert(!roles.length||roles.some(role=>actor.roles.includes(role)),'FORBIDDEN','Your account cannot upload this file',403);
  await this.runtime.limiter.take(`upload:${actor.id}`,30,300);
  return true;
 }
}
export const SecureUpload=(...roles:Role[])=>applyDecorators(SetMetadata('clinic.upload.roles',roles),UseGuards(MultipartAccessGuard));
