/* Author: ramanpal singh | URL: https://kwebby.com */
export type Role = 'owner' | 'admin' | 'manager' | 'doctor' | 'nurse' | 'receptionist' | 'accountant' | 'hr' | 'editor' | 'employee' | 'patient';
export interface Actor { id: string; organizationId: string; roles: Role[]; branchIds: string[]; patientIds: string[]; name: string; email: string; }
export interface Entity { id: string; organizationId: string; version: number; createdAt: string; updatedAt: string; [key: string]: unknown; }
export type FilterValue = string | number | boolean | null;
export interface Query { eq?: Record<string, FilterValue>; limit?: number; after?: string; }
export interface Repository {
 get<T extends Entity = Entity>(collection: string, id: string): Promise<T | null>;
 list<T extends Entity = Entity>(collection: string, query?: Query): Promise<T[]>;
 put<T extends Entity = Entity>(collection: string, value: T, expectedVersion?: number): Promise<T>;
 remove(collection: string, id: string, expectedVersion?: number): Promise<void>;
}
export interface Database extends Repository {
 driver: string;
 transaction<T>(keys: string[], fn: (tx: Repository) => Promise<T>): Promise<T>;
 initialize(): Promise<void>;
 close(): Promise<void>;
}
export interface OutboxEvent extends Entity { type: string; status: 'pending' | 'processing' | 'completed' | 'failed'; payload: Record<string, unknown>; attempts: number; nextAttemptAt: string; }
export class DomainError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'DomainError'; } }
export const collections = ['patients','appointments','encounters','prescriptions','results','referrals','tasks','leads','employees','invoices','payments','refunds','payroll','documents','pages','templates','themes','publications','conversations','messages','notifications','consents','settings','availability','leave','services'] as const;
export type Collection = typeof collections[number];
export const isCollection = (value: string): value is Collection => (collections as readonly string[]).includes(value);
export type ActionInput = Record<string, unknown>;
export interface SessionView { user: Actor; csrfToken: string; expiresAt: string; }
export interface FileReference extends Entity { storageKey: string; originalName: string; mime: string; size: number; sha256: string; visibility: 'private' | 'public'; scanStatus: 'pending' | 'clean' | 'rejected'; ownerId: string; patientId?: string; }
export function assert(condition: unknown, code: string, message: string, status=400): asserts condition { if (!condition) throw new DomainError(code, message, status); }
