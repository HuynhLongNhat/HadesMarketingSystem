"use client";
import { useEffect,useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { lifecycleLabels } from "@/lib/crm-companies-api";
import type { CrmContact } from "@/lib/crm-contacts-api";
export function useContactOwners(){
 const [owners,setOwners]=useState<Record<string,string>>({});
 useEffect(()=>{let active=true;apiFetch<{id:string;name:string}[]>("/crm/profile-owners").then(rows=>{if(active)setOwners(Object.fromEntries(rows.map(r=>[r.id,r.name])))}).catch(()=>{});return()=>{active=false}},[]);
 return owners;
}
export function ContactAvatar({name,large=false}:{name:string|null;large?:boolean}){
 const initials=(name??"").trim().split(/\s+/).filter(Boolean).slice(-2).map(s=>s[0]?.toUpperCase()).join("")||"?";
 return <span className={"flex shrink-0 items-center justify-center rounded-full border bg-muted font-semibold text-muted-foreground "+(large?"size-14 text-lg":"size-9 text-xs")}>{initials}</span>;
}
export function ContactStage({contact}:{contact:CrmContact}){
 return <span className="inline-flex whitespace-nowrap rounded-full border bg-muted/30 px-2.5 py-1 text-xs">{contact.archivedAt?"Đã lưu trữ":contact.lifecycleStage?lifecycleLabels[contact.lifecycleStage]:"Chưa phân loại"}</span>;
}
