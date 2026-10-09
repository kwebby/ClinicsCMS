/* Author: ramanpal singh | URL: https://kwebby.com */
export interface Actor { id: string; name: string; email: string; organizationId: string; roles: string[]; branchIds: string[]; patientIds: string[] }
export interface Session { user: Actor; csrfToken: string; expiresAt: string; mfaRequired?: boolean }
export interface RecordData { id: string; version: number; createdAt?: string; updatedAt?: string; [key: string]: unknown }
export type FieldType = 'text'|'email'|'tel'|'number'|'date'|'datetime-local'|'textarea'|'select'|'boolean'|'json'|'blocks'|'lines'|'password';
export interface Field { key: string; label: string; type?: FieldType; required?: boolean; options?: string[]; hint?: string; default?: unknown; reference?: string; full?: boolean; min?: number; max?: number }
export interface ActionDefinition { action: string; label: string; fields?: Field[]; roles?: string[]; hint?: string; match?: Record<string,string[]>; idKey?: string }
export interface ModuleDefinition { title: string; singular: string; description: string; icon: string; group: string; roles?: string[]; fields: Field[]; columns: { key:string; label:string }[]; actions?: ActionDefinition[]; readonly?: boolean }
