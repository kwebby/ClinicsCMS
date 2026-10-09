/* Author: ramanpal singh | URL: https://kwebby.com */
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createDatabase } from '../../../packages/persistence/src/index.js';
import { ClinicService } from '../../../packages/core/src/index.js';
import { ThemeService,LocalFileStorage,PublicAssetService } from '../../../packages/platform/src/index.js';
import { AuthService } from './auth.js';
import { Secrets,RateLimiter,installationId,organizationId } from './security.js';
import { IntegrationService,PaymentService } from './integrations.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

@Injectable()
export class Runtime {
 readonly db=createDatabase();
 readonly redis=new Redis(process.env.REDIS_URL??'redis://127.0.0.1:6379',{maxRetriesPerRequest:2});
 readonly secrets=new Secrets();
 readonly auth=new AuthService(this.db,this.redis,this.secrets);
 readonly clinic=new ClinicService(this.db);
 readonly integrations=new IntegrationService(this.db,this.secrets);
 readonly payments=new PaymentService(this.db,this.integrations);
 readonly themes=new ThemeService(this.db,{root:process.env.PRIVATE_STORAGE_ROOT??'.runtime/files'});
 readonly files=new LocalFileStorage(this.db,{root:process.env.PRIVATE_STORAGE_ROOT??'.runtime/files'});
 readonly publicAssets=new PublicAssetService(this.db,{root:process.env.PRIVATE_STORAGE_ROOT??'.runtime/files'});
 readonly limiter=new RateLimiter(this.redis,`clinic:${installationId()}:api-limits:`);
 readonly org=organizationId();
 async onModuleInit(){if(process.env.MAINTENANCE_MODE==='true'||existsSync(resolve(process.env.PRIVATE_STORAGE_ROOT??'.runtime/files','.restore-incomplete')))throw new Error('The clinic is in maintenance or has an incomplete restore. Keep API/workers stopped until recovery verification is complete.');await this.db.initialize();await this.redis.ping();}
 async onModuleDestroy(){await this.db.close();await this.redis.quit();}
}
