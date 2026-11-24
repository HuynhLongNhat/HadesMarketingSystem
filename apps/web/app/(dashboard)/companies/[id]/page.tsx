"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
  const load = useCallback(async () => {
    setError(false);
    try { setCompany(await crmCompaniesApi.get(id)); } catch { setError(true); }
  }, [id]);
  useEffect(() => { setCompany(null); void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    setContacts([]);
    setContactError(false);
    if (!search.trim()) return;
    const timer = setTimeout(async () => {
      try { const result = await crmContactsApi.list({ search, limit: 20 }); if (!cancelled) setContacts(result.items); }
      catch { if (!cancelled) setContactError(true); }
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
  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <Link className="text-sm text-muted-foreground hover:underline" href="/companies">← Danh sách doanh nghiệp</Link>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{company.name}</h1><p className="text-sm text-muted-foreground">{archived ? "Đã lưu trữ" : "Đang hoạt động"}</p></div><div className="flex gap-2">
      {!archived && <Button disabled={busy} onClick={() => setEditing(true)}>Chỉnh sửa</Button>}
      <Button variant="outline" disabled={busy} onClick={() => { if (archived || window.confirm("Lưu trữ doanh nghiệp này? Dữ liệu và liên kết vẫn được giữ lại.")) void mutate(() => archived ? crmCompaniesApi.restore(id) : crmCompaniesApi.archive(id)); }}>{archived ? "Khôi phục" : "Lưu trữ"}</Button>
    </div></header>
    <section className="grid gap-4 rounded-lg border p-5 sm:grid-cols-2">
      {([["Mã số thuế", company.taxCode], ["Website", company.website], ["Điện thoại", company.phone], ["Email", company.email], ["Địa chỉ", company.address], ["Ghi chú", company.notes]] as const).map(([label, value]) => <div key={label} className="min-w-0"><p className="text-sm text-muted-foreground">{label}</p><p className="whitespace-pre-wrap break-words">{value || "—"}</p></div>)}
    </section>
    <section className="space-y-4 rounded-lg border p-5"><h2 className="font-semibold">Người liên hệ ({company.contacts.length})</h2>
      {company.contacts.length === 0 && <p className="text-sm text-muted-foreground">Chưa có người liên hệ.</p>}
      {company.contacts.map((contact) => <div key={contact.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-3"><div><Link className="font-medium hover:underline" href={"/contacts/" + encodeURIComponent(contact.id)}>{contact.displayName || "Chưa đặt tên"}</Link><p className="text-sm text-muted-foreground">{[contact.email, contact.phone].filter(Boolean).join(" · ")}</p></div>{!archived && <Button disabled={busy} variant="outline" onClick={() => void mutate(() => crmCompaniesApi.unlink(id, contact.id))}>Gỡ liên kết</Button>}</div>)}
      {!archived && <div className="space-y-2"><Input placeholder="Tìm người liên hệ đã có..." value={search} onChange={(e) => setSearch(e.target.value)} /><Link className="text-sm underline" href="/contacts">Quản lý / tạo người liên hệ</Link>
      {contactError && <p className="text-sm">Không thể tìm người liên hệ.</p>}
      {contacts.filter((contact) => !company.contacts.some((linked) => linked.id === contact.id)).map((contact) => <div key={contact.id} className="flex items-center justify-between gap-2"><span className="text-sm">{contact.displayName || contact.email || contact.phone || "Chưa đặt tên"}</span><Button disabled={busy} size="sm" variant="outline" onClick={() => void mutate(() => crmCompaniesApi.link(id, contact.id))}>Liên kết</Button></div>)}</div>}
    </section>
    <Dialog open={editing} onOpenChange={(next) => { if (!busy) setEditing(next); }}><DialogContent><DialogHeader><DialogTitle>Chỉnh sửa doanh nghiệp</DialogTitle><DialogDescription>Cập nhật hồ sơ khách hàng.</DialogDescription></DialogHeader>{editing && <CompanyForm company={company} busy={busy} onSave={(input) => mutate(() => crmCompaniesApi.update(id, input), true)} />}</DialogContent></Dialog>
  </main>;
}
