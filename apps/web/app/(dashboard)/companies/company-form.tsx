"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import type { CompanyInput, CrmCompany } from "@/lib/crm-companies-api";

const fields = [
  { key: "name", label: "Tên doanh nghiệp", max: 200 },
  { key: "taxCode", label: "Mã số thuế", max: 32 },
  { key: "website", label: "Website", max: 500 },
  { key: "phone", label: "Điện thoại", max: 40 },
  { key: "email", label: "Email", max: 320 },
  { key: "address", label: "Địa chỉ", max: 500 },
] as const;

export function CompanyForm({ company, busy, onSave }: { company?: CrmCompany; busy: boolean; onSave: (input: CompanyInput) => Promise<void> }) {
  const [input, setInput] = useState<CompanyInput>(() => ({ name: company?.name ?? "", taxCode: company?.taxCode ?? "", website: company?.website ?? "", phone: company?.phone ?? "", email: company?.email ?? "", address: company?.address ?? "", notes: company?.notes ?? "" }));
  function submit(event: FormEvent) { event.preventDefault(); if (input.name.trim() && !busy) void onSave({ ...input, name: input.name.trim() }); }
  return <form onSubmit={submit} className="max-h-[65vh] space-y-3 overflow-y-auto p-1">
    {fields.map(({ key, label, max }) => <label key={key} className="block space-y-1 text-sm"><span>{label}{key === "name" ? " *" : ""}</span><Input required={key === "name"} type={key === "email" ? "email" : "text"} maxLength={max} disabled={busy} value={input[key] ?? ""} onChange={(e) => setInput((prev) => ({ ...prev, [key]: e.target.value }))} /></label>)}
    <label className="block space-y-1 text-sm"><span>Ghi chú</span><Textarea maxLength={2000} disabled={busy} value={input.notes} onChange={(e) => setInput((prev) => ({ ...prev, notes: e.target.value }))} /></label>
    <Button type="submit" disabled={busy || !input.name.trim()}>{busy ? "Đang lưu..." : "Lưu doanh nghiệp"}</Button>
  </form>;
}
