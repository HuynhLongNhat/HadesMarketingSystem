"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@workspace/ui/components/dialog";
import { crmCompaniesApi, type CrmCompany } from "@/lib/crm-companies-api";
import { CompanyForm } from "./company-form";

export default function CompaniesPage() {
  const [items, setItems] = useState<CrmCompany[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const timer = setTimeout(async () => {
      try {
        const result = await crmCompaniesApi.list(search, page, status);
        if (!cancelled) { setItems(result.items); setTotal(result.total); }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, status, page, revision]);
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">Doanh nghiệp khách hàng</h1><p className="text-sm text-muted-foreground">Quản lý hồ sơ công ty và người liên hệ.</p></div>
        <Button onClick={() => setOpen(true)}><Plus />Thêm doanh nghiệp</Button>
      </header>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" placeholder="Tìm tên, mã số thuế, email, điện thoại..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Button variant={status === "active" ? "default" : "outline"} onClick={() => { setStatus("active"); setPage(1); }}>Đang hoạt động</Button>
        <Button variant={status === "archived" ? "default" : "outline"} onClick={() => { setStatus("archived"); setPage(1); }}>Đã lưu trữ</Button>
      </div>
      {loading ? <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div> : error ? <div className="rounded-lg border p-6">Không thể tải dữ liệu. <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>Thử lại</Button></div> : (
        <>
          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-left text-sm"><thead className="bg-muted/40"><tr>{["Tên doanh nghiệp", "Mã số thuế", "Điện thoại", "Email", "Cập nhật"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
              <tbody>{items.map((item) => <tr key={item.id} className="border-t"><td className="p-3 font-medium"><Link className="hover:underline" href={"/companies/" + encodeURIComponent(item.id)}>{item.name}</Link></td><td className="p-3">{item.taxCode ?? "—"}</td><td className="p-3">{item.phone ?? "—"}</td><td className="p-3">{item.email ?? "—"}</td><td className="p-3">{new Date(item.updatedAt).toLocaleDateString("vi-VN")}</td></tr>)}</tbody>
            </table>
            {items.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Không có doanh nghiệp phù hợp.</p>}
          </div>
          <div className="flex items-center justify-between"><span className="text-sm">{total} doanh nghiệp</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Trước</Button><Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage((n) => n + 1)}>Sau</Button></div></div>
        </>
      )}
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent><DialogHeader><DialogTitle>Thêm doanh nghiệp</DialogTitle><DialogDescription>Nhập thông tin khách hàng doanh nghiệp.</DialogDescription></DialogHeader>
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
