"use client";
import { useEffect, useState } from "react";
import { Input } from "@workspace/ui/components/input";
import { apiFetch } from "@/lib/api-client";
import { lifecycleLabels, type ProfileInput } from "@/lib/crm-companies-api";

export function ProfileFields({value,onChange,disabled}:{value:ProfileInput;onChange:(patch:ProfileInput)=>void;disabled:boolean}) {
  const [members,setMembers]=useState<{id:string;name:string}[]>([]);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{let active=true;apiFetch<{id:string;name:string}[]>("/crm/profile-owners").then(data=>{if(active)setMembers(data)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[]);
  return <div className="grid gap-4 sm:grid-cols-2">
    <label className="space-y-1 text-sm"><span>Nguồn khách hàng</span><Input disabled={disabled} maxLength={120} value={value.source??""} onChange={e=>onChange({source:e.target.value})} placeholder="Giới thiệu, Facebook, website..."/></label>
    <label className="space-y-1 text-sm"><span>Vòng đời</span><select className="h-9 w-full rounded-md border bg-background px-2" disabled={disabled} value={value.lifecycleStage??""} onChange={e=>onChange({lifecycleStage:e.target.value as ProfileInput["lifecycleStage"]})}><option value="">Chưa phân loại</option>{Object.entries(lifecycleLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label className="space-y-1 text-sm sm:col-span-2"><span>Người phụ trách</span><select className="h-9 w-full rounded-md border bg-background px-2" disabled={disabled||failed} value={value.ownerMemberId??""} onChange={e=>onChange({ownerMemberId:e.target.value})}><option value="">Chưa phân công</option>{value.ownerMemberId&&!members.some(m=>m.id===value.ownerMemberId)&&<option value={value.ownerMemberId}>Người phụ trách hiện tại</option>}{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>{failed&&<span className="text-xs text-muted-foreground">Không tải được danh sách thành viên.</span>}</label>
  </div>;
}
