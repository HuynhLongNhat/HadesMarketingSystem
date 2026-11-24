"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Loader2, Building2, Search, Archive, ArrowUpRight, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@workspace/ui/components/dialog";
import { crmCompaniesApi, type CrmCompany, type LifecycleStage, lifecycleLabels } from "@/lib/crm-companies-api";
import { CompanyForm } from "./company-form";

export default function CompaniesPage() {
  const [items, setItems] = useState<CrmCompany[]>([]);
  const [search, setSearch] = useState("");
  const [stage,setStage]=useState<LifecycleStage|"">("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<{ active: number; archived: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([crmCompaniesApi.list("", 1, "active"), crmCompaniesApi.list("", 1, "archived")]).then(([active, archived]) => { if (!cancelled) setCounts({ active: active.total, archived: archived.total }); }).catch(() => { if (!cancelled) setCounts(null); });
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const timer = setTimeout(async () => {
      try {
        const result = await crmCompaniesApi.list(search, page, status, stage||undefined);
        if (!cancelled) { setItems(result.items); setTotal(result.total); }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, status, page, revision, stage]);
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">CRM / Doanh nghiệp</p><h1 className="text-2xl font-semibold tracking-tight">Doanh nghiệp khách hàng</h1><p className="text-sm text-muted-foreground">Quản lý tài khoản khách hàng và tìm nhanh thông tin liên hệ.</p></div>
        <Button onClick={() => setOpen(true)}><Plus className="size-4" />Thêm doanh nghiệp</Button>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:max-w-lg">
        {([{key:"active",label:"Đang hoạt động",Icon:Building2},{key:"archived",label:"Đã lưu trữ",Icon:Archive}] as const).map(({key,label,Icon}) => <button key={key} type="button" onClick={() => {setStatus(key);setPage(1);}} className={"rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 "+(status===key?"border-foreground/40 bg-muted/30":"")} aria-pressed={status===key}><div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">{label}<Icon className="size-4"/></div><p className="mt-2 text-2xl font-semibold tabular-nums">{counts?.[key] ?? "—"}</p></button>)}
      </div>
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {([{key:"active",label:"Đang hoạt động"},{key:"archived",label:"Đã lưu trữ"}] as const).map(({key,label}) => <Button key={key} size="sm" variant={status===key?"default":"ghost"} onClick={()=>{setStatus(key);setPage(1);}}>{label}</Button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Lọc vòng đời" className="h-9 rounded-md border bg-background px-2 text-sm" value={stage} onChange={e=>{setStage(e.target.value as LifecycleStage|"");setPage(1)}}><option value="">Tất cả vòng đời</option>{Object.entries(lifecycleLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
            <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="w-full pl-9 sm:w-72" aria-label="Tìm doanh nghiệp" placeholder="Tìm tên, MST, email, SĐT..." value={search} onChange={(e)=>{setSearch(e.target.value);setPage(1);}}/></div>
            <Button variant="outline" size="icon" aria-label="Tải lại danh sách" onClick={()=>setRevision(n=>n+1)}><RefreshCw className="size-4"/></Button>
          </div>
        </div>
        {loading ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Đang tải doanh nghiệp...</div> : error ? <div className="space-y-3 p-12 text-center"><p>Không thể tải dữ liệu.</p><Button variant="outline" onClick={()=>setRevision(n=>n+1)}>Thử lại</Button></div> : <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr>{["Doanh nghiệp","Mã số thuế","Liên hệ","Website","Cập nhật",""].map((label,i)=><th key={i} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{items.map(item=><tr key={item.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3"><Link className="flex items-center gap-3 hover:underline" href={"/companies/"+encodeURIComponent(item.id)}><span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><Building2 className="size-4"/></span><span><span className="block font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{[item.industry,item.lifecycleStage?lifecycleLabels[item.lifecycleStage]:null].filter(Boolean).join(" · ")}</span></span></Link></td>
                <td className="px-4 py-3 font-mono text-xs">{item.taxCode || "—"}</td><td className="px-4 py-3"><div>{item.email || "—"}</div><div className="text-xs text-muted-foreground">{item.phone || ""}</div></td><td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{item.website || "—"}</td><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(item.updatedAt).toLocaleDateString("vi-VN")}</td><td className="px-4 py-3"><Link className="inline-flex rounded-md p-2 hover:bg-muted" aria-label={"Mở "+item.name} href={"/companies/"+encodeURIComponent(item.id)}><ArrowUpRight className="size-4"/></Link></td>
              </tr>)}</tbody>
            </table>
            {items.length===0 && <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center"><Building2 className="size-8 text-muted-foreground"/><p className="font-medium">{search?"Không tìm thấy doanh nghiệp":"Chưa có doanh nghiệp"}</p><p className="text-sm text-muted-foreground">{search?"Thử từ khóa khác.":status==="active"?"Thêm hồ sơ khách hàng đầu tiên để bắt đầu.":"Doanh nghiệp đã lưu trữ sẽ xuất hiện tại đây."}</p>{!search && status==="active" && <Button onClick={()=>setOpen(true)}><Plus/>Thêm doanh nghiệp</Button>}</div>}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground"><span>{total ? (page-1)*20+1 : 0}–{Math.min(page*20,total)} / {total} doanh nghiệp</span><div className="flex items-center gap-2"><Button size="icon" variant="outline" aria-label="Trang trước" disabled={page<=1} onClick={()=>setPage(n=>n-1)}><ChevronLeft className="size-4"/></Button><span>Trang {page}</span><Button size="icon" variant="outline" aria-label="Trang sau" disabled={page*20>=total} onClick={()=>setPage(n=>n+1)}><ChevronRight className="size-4"/></Button></div></footer>
        </>}
      </section>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Thêm doanh nghiệp</DialogTitle><DialogDescription>Nhập thông tin khách hàng doanh nghiệp.</DialogDescription></DialogHeader>
          {open && <CompanyForm busy={busy} onSave={async (input) => {
            setBusy(true);
            try { await crmCompaniesApi.create(input); toast.success("Đã thêm doanh nghiệp"); setOpen(false); setStatus("active"); setPage(1); setSearch(""); setRevision((n) => n + 1); }
            catch (e) { toast.error(e instanceof Error ? e.message : "Không thể lưu doanh nghiệp"); }
            finally { setBusy(false); }
          }} />}
        </DialogContent>
      </Dialog>
    </main>
  );
}
