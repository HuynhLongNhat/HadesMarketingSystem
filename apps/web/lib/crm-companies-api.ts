import { apiFetch } from "./api-client";

export type CompanyInput = {
  name: string;
  taxCode?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};
export type CrmCompany = {
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
export type CompanyContact = { id: string; displayName: string | null; email: string | null; phone: string | null };
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
  unlink: (id: string, contactId: string) => apiFetch<{ success: boolean }>(path(id) + "/contacts/" + encodeURIComponent(contactId), { method: "DELETE" }),
};
