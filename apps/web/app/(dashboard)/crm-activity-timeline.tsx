"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { Archive,CalendarDays,FileText,Mail,MessageSquare,Phone,Plus,Users,Loader2 } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from "@workspace/ui/components/dialog";
import { toast } from "sonner";
import { activityLabels,crmActivitiesApi,type Activity,type ActivityInput,type ActivityTarget,type ActivityType } from "@/lib/crm-activities-api";

const icons={note:FileText,call:Phone,meeting:Users,email:Mail,message:MessageSquare};
const localTime=(iso:string)=>{const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
const selectClass="h-9 w-full rounded-md border bg-background px-2 text-sm";
type Related={id:string;name:string};
function ActivityForm({activity,related,target,busy,onSave}:{activity?:Activity;related:Related[];target:ActivityTarget;busy:boolean;onSave:(v:ActivityInput)=>Promise<void>}) {
 const [type,setType]=useState<ActivityType>(activity?.type??"note");
 const [subject,setSubject]=useState(activity?.subject??"");
 const [body,setBody]=useState(activity?.body??"");
 const [outcome,setOutcome]=useState(activity?.outcome??"");
 const [occurredAt,setOccurredAt]=useState(()=>localTime(activity?.occurredAt??new Date().toISOString()));
 const [relatedId,setRelatedId]=useState("");
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(busy||!subject.trim()||!occurredAt)return;void onSave({type,subject,body,outcome,occurredAt:new Date(occurredAt).toISOString(),...(!activity&&relatedId?{relatedId}:{})})}}>
 <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1 text-sm">Loại tương tác<select className={selectClass} disabled={busy} value={type} onChange={e=>setType(e.target.value as ActivityType)}>{Object.entries(activityLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label className="block space-y-1 text-sm">Thời gian diễn ra<Input required type="datetime-local" max={localTime(new Date().toISOString())} disabled={busy} value={occurredAt} onChange={e=>setOccurredAt(e.target.value)}/></label></div>
 {!activity&&related.length>0&&<label className="block space-y-1 text-sm">{target==="company"?"Người liên hệ":"Doanh nghiệp liên quan"}<select className={selectClass} disabled={busy} value={relatedId} onChange={e=>setRelatedId(e.target.value)}><option value="">Không chọn</option>{related.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
 <label className="block space-y-1 text-sm">Tiêu đề *<Input required maxLength={200} disabled={busy} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Ví dụ: Tư vấn thiết kế website"/></label>
 <label className="block space-y-1 text-sm">Nội dung<Textarea rows={4} maxLength={10000} disabled={busy} value={body} onChange={e=>setBody(e.target.value)} placeholder="Khách hàng đã trao đổi những gì?"/></label>
 <label className="block space-y-1 text-sm">Kết quả<Textarea rows={2} maxLength={2000} disabled={busy} value={outcome} onChange={e=>setOutcome(e.target.value)} placeholder="Kết quả hoặc thỏa thuận sau trao đổi"/></label>
 <div className="flex justify-end border-t pt-3"><Button type="submit" disabled={busy||!subject.trim()}>{busy?"Đang lưu...":"Lưu tương tác"}</Button></div>
 </form>;
}
export function ActivityTimeline({target,id,archived,related=[]}:{target:ActivityTarget;id:string;archived:boolean;related?:Related[]}) {
 const [items,setItems]=useState<Activity[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[type,setType]=useState<ActivityType|"">(""),[status,setStatus]=useState<"active"|"archived">("active");
 const [loading,setLoading]=useState(true),[error,setError]=useState(false),[revision,setRevision]=useState(0),[dialog,setDialog]=useState<"create"|Activity|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setLoading(true);setError(false);crmActivitiesApi.list(target,id,page,type,status).then(r=>{if(active){setItems(r.items);setTotal(r.total)}}).catch(()=>{if(active)setError(true)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[target,id,page,type,status,revision]);
 async function mutate(action:()=>Promise<unknown>){setBusy(true);try{await action();setDialog(null);setPage(1);setRevision(n=>n+1);toast.success("Đã cập nhật tương tác")}catch(e){toast.error(e instanceof Error?e.message:"Không thể cập nhật tương tác")}finally{setBusy(false)}}
 return <section className="space-y-4 p-5">
 <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Lịch sử tương tác</h2><p className="text-sm text-muted-foreground">Ghi nhận các trao đổi đã diễn ra với khách hàng.</p></div>{!archived&&<Button disabled={busy} onClick={()=>setDialog("create")}><Plus className="size-4"/>Ghi nhận tương tác</Button>}</header>
 <div className="flex flex-wrap gap-2"><select aria-label="Loại tương tác" className={selectClass+" max-w-44"} value={type} onChange={e=>{setType(e.target.value as ActivityType|"");setPage(1)}}><option value="">Tất cả loại</option>{Object.entries(activityLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><Button size="sm" variant={status==="active"?"default":"outline"} onClick={()=>{setStatus("active");setPage(1)}}>Đang hoạt động</Button><Button size="sm" variant={status==="archived"?"default":"outline"} onClick={()=>{setStatus("archived");setPage(1)}}>Đã lưu trữ</Button></div>
 {loading?<div className="flex justify-center p-8"><Loader2 className="animate-spin"/></div>:error?<div className="rounded-lg border p-5 text-sm">Không thể tải lịch sử. <Button variant="outline" size="sm" onClick={()=>setRevision(n=>n+1)}>Thử lại</Button></div>:items.length===0?<div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-3 size-7"/>Chưa có tương tác phù hợp.</div>:<div className="space-y-4">{items.map(a=>{const Icon=icons[a.type];const relatedId=target==="company"?a.contactId:a.companyId;return <article key={a.id} className="relative flex gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted"><Icon className="size-4"/></span><div className="min-w-0 flex-1 rounded-lg border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs text-muted-foreground">{activityLabels[a.type]} · {new Date(a.occurredAt).toLocaleString("vi-VN")}</p><h3 className="mt-1 break-words font-medium">{a.subject}</h3></div>{!archived&&<div className="flex gap-1">{!a.archivedAt&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>setDialog(a)}>Sửa</Button>}<Button variant="ghost" size="sm" disabled={busy} onClick={()=>{if(a.archivedAt||window.confirm("Lưu trữ tương tác này?"))void mutate(()=>crmActivitiesApi.archive(target,id,a.id,!!a.archivedAt))}}><Archive className="size-4"/>{a.archivedAt?"Khôi phục":"Lưu trữ"}</Button></div>}</div>{a.body&&<p className="mt-3 whitespace-pre-wrap break-words text-sm">{a.body}</p>}{a.outcome&&<div className="mt-3 rounded-md bg-muted/40 p-3 text-sm"><p className="font-medium">Kết quả</p><p className="whitespace-pre-wrap break-words">{a.outcome}</p></div>}<div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground"><span>Ghi nhận bởi {a.authorName??"Thành viên đã xóa"}</span>{relatedId&&<Link className="underline" href={(target==="company"?"/contacts/":"/companies/")+encodeURIComponent(relatedId)}>{related.find(r=>r.id===relatedId)?.name??(target==="company"?"Người liên hệ":"Doanh nghiệp liên quan")}</Link>}</div></div></article>})}</div>}
 {!loading&&!error&&<footer className="flex items-center justify-between text-sm text-muted-foreground"><span>{total} tương tác</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>Trước</Button><Button size="sm" variant="outline" disabled={page*20>=total} onClick={()=>setPage(n=>n+1)}>Sau</Button></div></footer>}
 <Dialog open={dialog!==null} onOpenChange={open=>{if(!open&&!busy)setDialog(null)}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{dialog==="create"?"Ghi nhận tương tác":"Chỉnh sửa tương tác"}</DialogTitle><DialogDescription>Ghi nhận lịch sử, không gửi email hoặc tin nhắn tự động.</DialogDescription></DialogHeader>{dialog&&<ActivityForm key={dialog==="create"?"create":dialog.id} activity={dialog==="create"?undefined:dialog} related={related} target={target} busy={busy} onSave={input=>mutate(()=>dialog==="create"?crmActivitiesApi.create(target,id,input):crmActivitiesApi.update(target,id,dialog.id,input))}/>}</DialogContent></Dialog>
 </section>;
}
