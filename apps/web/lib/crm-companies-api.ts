import { apiFetch } from "./api-client";

export type LifecycleStage = "prospect" | "qualified" | "customer" | "former_customer";
export type ProfileInput = { source?: string; lifecycleStage?: LifecycleStage | ""; ownerMemberId?: string };
export const lifecycleLabels: Record<LifecycleStage, string> = { prospect:"Tiềm năng", qualified:"Đủ điều kiện", customer:"Khách hàng", former_customer:"Khách hàng cũ" };
export type ProfileFields = {source:string|null; lifecycleStage:LifecycleStage|null; ownerMemberId:string|null};
export type CompanyInput = ProfileInput & {
  industry?: string; employeeRange?: string; tags?: string[];
  name: string;
  taxCode?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};
export type CrmCompany = ProfileFields & {
  industry:string|null; employeeRange:string|null; tags:string[];
  id: string;
  name: string;
  taxCode: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  archivedAt: string | null;
  updatedAt: string;
};
export type RelationshipInput = { jobTitle?:string; department?:string; relationshipRole?:string; isPrimary?:boolean };
export type CompanyContact = { jobTitle:string|null; department:string|null; relationshipRole:string|null; isPrimary:boolean; archivedAt:string|null; id: string; displayName: string | null; email: string | null; phone: string | null };
export type CompanyDetail = CrmCompany & { contacts: CompanyContact[] };
const path = (id: string) => "/crm/companies/" + encodeURIComponent(id);

export const crmCompaniesApi = {
  list: (search: string, page: number, status: "active" | "archived") =>
    apiFetch<{ items: CrmCompany[]; total: number; page: number; limit: number }>("/crm/companies?" + new URLSearchParams({ search, page: String(page), limit: "20", status })),
  create: (input: CompanyInput) => apiFetch<CrmCompany>("/crm/companies", { method: "POST", body: JSON.stringify(input) }),
  get: (id: string) => apiFetch<CompanyDetail>(path(id)),
  update: (id: string, input: CompanyInput) => apiFetch<CrmCompany>(path(id), { method: "PATCH", body: JSON.stringify(input) }),
  archive: (id: string) => apiFetch<CrmCompany>(path(id) + "/archive", { method: "POST" }),
  restore: (id: string) => apiFetch<CrmCompany>(path(id) + "/restore", { method: "POST" }),
  link: (id: string, contactId: string) => apiFetch<{ success: boolean }>(path(id) + "/contacts", { method: "POST", body: JSON.stringify({ contactId }) }),
  updateContact: (id:string, contactId:string, input:RelationshipInput) => apiFetch<unknown>(path(id)+"/contacts/"+encodeURIComponent(contactId),{method:"PATCH",body:JSON.stringify(input)}),
  unlink: (id: string, contactId: string) => apiFetch<{ success: boolean }>(path(id) + "/contacts/" + encodeURIComponent(contactId), { method: "DELETE" }),
};
