"use client";
import { useState,type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { DialogFooter } from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { ProfileFields } from "../crm-profile-fields";
import type { ProfileInput } from "@/lib/crm-companies-api";
import { crmContactsApi,type ContactInput,type CrmContact } from "@/lib/crm-contacts-api";
export function ContactForm({ contact, busy, onSave }: { contact?: CrmContact | null; busy: boolean; onSave: (input: ContactInput) => Promise<void> }) {
  const [profile,setProfile]=useState<ProfileInput>({source:contact?.source??"",lifecycleStage:contact?.lifecycleStage??"",ownerMemberId:contact?.ownerMemberId??""});
  const [name, setName] = useState(contact?.displayName ?? ""); const [phone, setPhone] = useState(contact?.phone ?? ""); const [email, setEmail] = useState(contact?.email ?? ""); const [notes, setNotes] = useState(contact?.notes ?? ""); const [tags, setTags] = useState(contact?.tags.join(", ") ?? "");
  const [checking,setChecking]=useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (!name.trim()||busy||checking) return; setChecking(true); try {const duplicates=await crmContactsApi.duplicates(email,phone,contact?.id);if(duplicates.length&&!window.confirm("Có hồ sơ trùng email hoặc số điện thoại: "+duplicates.map(d=>d.displayName??d.id).join(", ")+". Vẫn tiếp tục?"))return;await onSave({...profile,displayName:name,phone,email,notes,tags:tags.split(",").map(t=>t.trim()).filter(Boolean)});}catch{toast.error("Không thể kiểm tra hồ sơ trùng hoặc lưu dữ liệu");} finally{setChecking(false)} }
  return <form className="space-y-4" onSubmit={submit}><label className="block space-y-1 text-sm">Họ tên *<Input required disabled={busy} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên khách hàng *" maxLength={200}/></label><div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1 text-sm">Điện thoại<Input disabled={busy} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Số điện thoại" maxLength={40}/></label><label className="block space-y-1 text-sm">Email<Input disabled={busy} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" maxLength={320}/></label></div><label className="block space-y-1 text-sm">Tags<Input disabled={busy} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, cách nhau bởi dấu phẩy" maxLength={400}/></label><label className="block space-y-1 text-sm">Ghi chú<Textarea disabled={busy} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú" maxLength={2000}/></label><ProfileFields value={profile} disabled={busy} onChange={patch=>setProfile(prev=>({...prev,...patch}))}/><DialogFooter><Button type="submit" disabled={busy || checking || !name.trim()}>{busy && <Loader2 className="animate-spin"/>}Lưu khách hàng</Button></DialogFooter></form>;
}

