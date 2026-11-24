"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Building2, Users, Pencil, Archive, RotateCcw, ArrowLeft, Search, UserRound, Mail, Phone, Globe, MapPin, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@workspace/ui/components/dialog";
import { crmCompaniesApi, type CompanyDetail } from "@/lib/crm-companies-api";
import { crmContactsApi, type CrmContact } from "@/lib/crm-contacts-api";
import { CompanyForm } from "../company-form";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [contactError, setContactError] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);
  const [tab, setTab] = useState<"overview" | "contacts">("overview");
  const load = useCallback(async () => {
    setError(false);
    try { setCompany(await crmCompaniesApi.get(id)); } catch { setError(true); }
  }, [id]);
  useEffect(() => { setCompany(null); void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    setContacts([]);
    setContactError(false);
    setContactLoading(false);
    if (!search.trim()) return;
    setContactLoading(true);
    const timer = setTimeout(async () => {
      try { const result = await crmContactsApi.list({ search, limit: 20 }); if (!cancelled) setContacts(result.items); }
      catch { if (!cancelled) setContactError(true); }
      finally { if (!cancelled) setContactLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);
  async function mutate(action: () => Promise<unknown>, close = false) {
    setBusy(true);
    try { await action(); if (close) setEditing(false); toast.success("Đã cập nhật"); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Không thể cập nhật"); }
    finally { setBusy(false); }
  }
  if (error) return <main className="space-y-4 p-6"><Link href="/companies">Quay lại danh sách</Link><p>Không thể tải doanh nghiệp.</p><Button onClick={() => void load()}>Thử lại</Button></main>;
  if (!company) return <p className="p-6">Đang tải...</p>;
  const archived = Boolean(company.archivedAt);
  const available = contacts.filter(contact=>!company.contacts.some(linked=>linked.id===contact.id));
  return <main className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-8">
    <Link className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" href="/companies"><ArrowLeft className="size-4"/>Doanh nghiệp</Link>
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4"><div className="flex size-14 shrink-0 items-center justify-center rounded-xl border bg-muted/30"><Building2 className="size-7"/></div><div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1><span className="inline-flex rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">{archived?"Đã lưu trữ":"Đang hoạt động"}</span></div></div>
      <div className="flex gap-2">{!archived&&<Button disabled={busy} onClick={()=>setEditing(true)}><Pencil className="size-4"/>Chỉnh sửa</Button>}<Button variant="outline" disabled={busy} onClick={()=>{if(archived||window.confirm("Lưu trữ doanh nghiệp này? Dữ liệu và liên kết vẫn được giữ lại."))void mutate(()=>archived?crmCompaniesApi.restore(id):crmCompaniesApi.archive(id));}}>{archived?<RotateCcw className="size-4"/>:<Archive className="size-4"/>}{archived?"Khôi phục":"Lưu trữ"}</Button></div>
    </header>
    {archived&&<div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Hồ sơ đang được lưu trữ. Khôi phục để chỉnh sửa và quản lý liên kết.</div>}
    <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-xl border bg-card">
        <h2 className="border-b px-5 py-4 text-sm font-semibold">Thông tin doanh nghiệp</h2>
        <dl className="space-y-5 p-5">
          {([{label:"Mã số thuế",value:company.taxCode,Icon:FileText},{label:"Website",value:company.website,Icon:Globe},{label:"Email",value:company.email,Icon:Mail},{label:"Điện thoại",value:company.phone,Icon:Phone},{label:"Địa chỉ",value:company.address,Icon:MapPin}] as const).map(({label,value,Icon})=><div key={label} className="flex items-start gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground"/><div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value||"Chưa cập nhật"}</dd></div></div>)}
        </dl><div className="border-t px-5 py-4 text-xs text-muted-foreground">Cập nhật: {new Date(company.updatedAt).toLocaleString("vi-VN")}</div>
      </aside>
      <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <nav className="flex gap-6 border-b px-5" aria-label="Hồ sơ doanh nghiệp">{([{key:"overview",label:"Tổng quan"},{key:"contacts",label:"Người liên hệ ("+company.contacts.length+")"}] as const).map(({key,label})=><button key={key} type="button" aria-pressed={tab===key} onClick={()=>setTab(key)} className={"border-b-2 py-4 text-sm font-medium "+(tab===key?"border-foreground":"border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>)}</nav>
        {tab==="overview"?<div className="space-y-5 p-5">
          <div className="rounded-lg border p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Người liên hệ</span><Users className="size-4 text-muted-foreground"/></div><p className="mt-2 text-2xl font-semibold">{company.contacts.length}</p><Button variant="link" className="mt-1 h-auto p-0" onClick={()=>setTab("contacts")}>Quản lý người liên hệ</Button></div>
          <div className="rounded-lg border p-4"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Ghi chú hồ sơ</h2>{!archived&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>setEditing(true)}><Pencil className="size-4"/>Sửa</Button>}</div><p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{company.notes||"Chưa có ghi chú. Bổ sung bối cảnh và nhu cầu của khách hàng."}</p></div>
        </div>:<div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Người liên hệ</h2><p className="text-sm text-muted-foreground">Những cá nhân có liên quan đến doanh nghiệp.</p></div><Link className="text-sm underline" href="/contacts">Quản lý danh bạ</Link></div>
          {company.contacts.length===0&&<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Chưa có người liên hệ.</p>}
          {company.contacts.map(contact=><div key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"><UserRound className="size-4"/></span><div className="min-w-0"><Link className="font-medium hover:underline" href={"/contacts/"+encodeURIComponent(contact.id)}>{contact.displayName||"Chưa đặt tên"}</Link><p className="break-words text-xs text-muted-foreground">{[contact.email,contact.phone].filter(Boolean).join(" · ")||"Chưa có thông tin liên hệ"}</p></div></div>{!archived&&<Button disabled={busy} variant="outline" size="sm" onClick={()=>void mutate(()=>crmCompaniesApi.unlink(id,contact.id))}>Gỡ liên kết</Button>}</div>)}
          {!archived&&<div className="space-y-3 rounded-lg border bg-muted/20 p-4"><h3 className="text-sm font-medium">Liên kết người liên hệ có sẵn</h3><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-9" placeholder="Tìm theo tên, email hoặc SĐT..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          {contactLoading&&<p className="text-sm text-muted-foreground">Đang tìm...</p>}{contactError&&<p className="text-sm">Không thể tìm người liên hệ.</p>}{!contactLoading&&!contactError&&search.trim()&&available.length===0&&<p className="text-sm text-muted-foreground">Không tìm thấy người liên hệ chưa được liên kết.</p>}
          {available.map(contact=><div key={contact.id} className="flex items-center justify-between gap-2"><div className="min-w-0 text-sm"><p>{contact.displayName||contact.email||contact.phone||"Chưa đặt tên"}</p><p className="break-words text-xs text-muted-foreground">{[contact.email,contact.phone].filter(Boolean).join(" · ")}</p></div><Button disabled={busy} size="sm" variant="outline" onClick={()=>void mutate(()=>crmCompaniesApi.link(id,contact.id))}>Liên kết</Button></div>)}</div>}
        </div>}
      </section>
    </div>
    <Dialog open={editing} onOpenChange={(next) => { if (!busy) setEditing(next); }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Chỉnh sửa doanh nghiệp</DialogTitle><DialogDescription>Cập nhật hồ sơ khách hàng.</DialogDescription></DialogHeader>{editing && <CompanyForm company={company} busy={busy} onSave={(input) => mutate(() => crmCompaniesApi.update(id, input), true)} />}</DialogContent></Dialog>
  </main>;
}
