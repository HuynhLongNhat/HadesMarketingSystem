"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import type { CompanyInput, CrmCompany } from "@/lib/crm-companies-api";

import { ProfileFields } from "../crm-profile-fields";

const fields = [
  { key: "industry", label: "Ngành nghề", max:120 },
  { key: "employeeRange", label: "Quy mô nhân sự", max:40 },
  { key: "name", label: "Tên doanh nghiệp", max: 200 },
  { key: "taxCode", label: "Mã số thuế", max: 32 },
  { key: "website", label: "Website", max: 500 },
  { key: "phone", label: "Điện thoại", max: 40 },
  { key: "email", label: "Email", max: 320 },
  { key: "address", label: "Địa chỉ", max: 500 },
] as const;

export function CompanyForm({ company, busy, onSave }: { company?: CrmCompany; busy: boolean; onSave: (input: CompanyInput) => Promise<void> }) {
  const [input, setInput] = useState<CompanyInput>(() => ({ name: company?.name ?? "", industry:company?.industry??"", employeeRange:company?.employeeRange??"", source:company?.source??"", lifecycleStage:company?.lifecycleStage??"",ownerMemberId:company?.ownerMemberId??"",tags:company?.tags??[], taxCode: company?.taxCode ?? "", website: company?.website ?? "", phone: company?.phone ?? "", email: company?.email ?? "", address: company?.address ?? "", notes: company?.notes ?? "" }));
  function submit(event: FormEvent) { event.preventDefault(); if (input.name.trim() && !busy) void onSave({ ...input, name: input.name.trim() }); }
  return <form onSubmit={submit} className="max-h-[70vh] space-y-5 overflow-y-auto p-1">
    <div className="grid gap-4 sm:grid-cols-2">
    {fields.map(({ key, label, max }) => <label key={key} className={"block space-y-2 text-sm "+(key==="name"||key==="address"?"sm:col-span-2":"")}><span className="font-medium">{label}{key === "name" ? " *" : ""}</span><Input required={key === "name"} type={key === "email" ? "email" : "text"} maxLength={max} disabled={busy} value={input[key] ?? ""} onChange={(e) => setInput((prev) => ({ ...prev, [key]: e.target.value }))} /></label>)}
    </div>
    <ProfileFields value={input} onChange={patch=>setInput(prev=>({...prev,...patch}))} disabled={busy}/>
    <label className="block space-y-2 text-sm"><span>Tags</span><Input disabled={busy} defaultValue={company?.tags?.join(", ")??""} onChange={e=>setInput(prev=>({...prev,tags:e.target.value.split(",").map(t=>t.trim()).filter(Boolean)}))}/></label>
    <label className="block space-y-2 text-sm"><span className="font-medium">Ghi chú</span><Textarea maxLength={2000} disabled={busy} value={input.notes} onChange={(e) => setInput((prev) => ({ ...prev, notes: e.target.value }))} /></label>
    <div className="flex justify-end border-t pt-4"><Button type="submit" disabled={busy || !input.name.trim()}>{busy ? "Đang lưu..." : "Lưu doanh nghiệp"}</Button></div>
  </form>;
}
