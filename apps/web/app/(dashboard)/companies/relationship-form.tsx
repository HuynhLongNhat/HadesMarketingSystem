"use client";
import { useState } from "react";
import { Input } from "@workspace/ui/components/input";
import { Button } from "@workspace/ui/components/button";
import type { CompanyContact, RelationshipInput } from "@/lib/crm-companies-api";
export function RelationshipForm({contact,busy,onSave}:{contact:CompanyContact;busy:boolean;onSave:(input:RelationshipInput)=>Promise<void>}){
 const [value,setValue]=useState<RelationshipInput>({jobTitle:contact.jobTitle??"",department:contact.department??"",relationshipRole:contact.relationshipRole??"",isPrimary:contact.isPrimary});
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(!busy)void onSave(value)}}>
 {([{key:"jobTitle",label:"Chức vụ"},{key:"department",label:"Phòng ban"},{key:"relationshipRole",label:"Vai trò (ví dụ: ra quyết định, thanh toán)"}] as const).map(({key,label})=><label key={key} className="block space-y-1 text-sm">{label}<Input maxLength={120} disabled={busy} value={value[key]??""} onChange={e=>setValue(v=>({...v,[key]:e.target.value}))}/></label>)}
 <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={value.isPrimary??false} onChange={e=>setValue(v=>({...v,isPrimary:e.target.checked}))}/>Người liên hệ chính</label>
 <Button type="submit" disabled={busy}>Lưu vai trò</Button>
 </form>;
}
