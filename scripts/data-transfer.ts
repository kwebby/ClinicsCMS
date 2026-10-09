/* Author: ramanpal singh | URL: https://kwebby.com */
import 'dotenv/config';
import { createDatabase } from '../packages/persistence/src/index.js';
import { exportInstallation,importInstallation } from '../packages/persistence/src/transfer.js';

const [operation,file]=process.argv.slice(2);
if(!['export','import'].includes(operation)||!file)throw new Error('Usage: pnpm data:export /absolute/path/clinic.backup (or data:import). Stop API/workers first; MAINTENANCE_MODE=true and OUTBOUND_WORKERS_ENABLED=false are required.');
// Optional: TRANSFER_SCRATCH_DIR (private working directory for decrypted import data; default beside PRIVATE_STORAGE_ROOT)
// and TRANSFER_MAX_EXPANDED_BYTES (decompressed size ceiling; default 32x the archive size, at least 2 GiB).
const maxExpanded=process.env.TRANSFER_MAX_EXPANDED_BYTES||undefined;
if(maxExpanded!==undefined&&!/^[1-9]\d{0,15}$/.test(maxExpanded))throw new Error('TRANSFER_MAX_EXPANDED_BYTES must be a positive whole number of bytes.');
const db=createDatabase();
try{
 await db.initialize();const options={database:db,storageRoot:process.env.PRIVATE_STORAGE_ROOT??'.runtime/files',file,transferKey:process.env.DATA_TRANSFER_KEY??'',appEncryptionKey:process.env.APP_ENCRYPTION_KEY??'',maintenance:process.env.MAINTENANCE_MODE==='true',outboundEnabled:process.env.OUTBOUND_WORKERS_ENABLED==='true',...(process.env.TRANSFER_SCRATCH_DIR?{scratchDir:process.env.TRANSFER_SCRATCH_DIR}:{}),...(maxExpanded?{maxExpandedBytes:Number(maxExpanded)}:{})};
 const result=operation==='export'?await exportInstallation(options):await importInstallation(options);
 console.log(JSON.stringify({operation,...result},null,2));
 if(operation==='import')console.log('Restore verified. Keep outbound workers disabled until payment and notification queues have been reconciled.');
}finally{await db.close();}
