import {apiFetch} from "./api-client";
export const leadLabels={new:"Mới",attempting:"Đang tiếp cận",connected:"Đã kết nối",qualified:"Đủ điều kiện",disqualified:"Không phù hợp",converted:"Đã chuyển đổi"} as const;
export const priorityLabels={low:"Thấp",medium:"Trung bình",high:"Cao"} as const;
export type LeadStatus=keyof typeof leadLabels;
export type Priority=keyof typeof priorityLabels;
export type LeadInput={title:string;companyId?:string;contactId?:string;description?:string;budgetMin?:string;budgetMax?:string;currency?:"VND"|"USD";expectedStartDate?:string;priority?:Priority;source?:string;ownerMemberId?:string;notes?:string};
export type Lead={id:string;title:string;companyId:string|null;contactId:string|null;companyName:string|null;contactName:string|null;ownerName:string|null;description:string|null;budgetMin:string|null;budgetMax:string|null;currency:"VND"|"USD";expectedStartDate:string|null;priority:Priority;source:string|null;ownerMemberId:string|null;notes:string|null;status:LeadStatus;disqualifiedReason:string|null;archivedAt:string|null;updatedAt:string;createdAt:string};
const base="/crm/leads";
const path=(id:string)=>base+"/"+encodeURIComponent(id);
export const crmLeadsApi={
 list:(params:Record<string,string|number|undefined>={})=>{const q=new URLSearchParams();Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!=="")q.set(k,String(v))});return apiFetch<{items:Lead[];total:number;page:number;limit:number}>(base+"?"+q)},
 get:(id:string)=>apiFetch<Lead>(path(id)),
 create:(v:LeadInput)=>apiFetch<Lead>(base,{method:"POST",body:JSON.stringify(v)}),
 update:(id:string,v:LeadInput)=>apiFetch<Lead>(path(id),{method:"PATCH",body:JSON.stringify(v)}),
 status:(id:string,status:Exclude<LeadStatus,"converted">,disqualifiedReason?:string)=>apiFetch<Lead>(path(id)+"/status",{method:"PATCH",body:JSON.stringify({status,disqualifiedReason})}),
 archive:(id:string,restore:boolean)=>apiFetch<Lead>(path(id)+(restore?"/restore":"/archive"),{method:"POST"})
};
export function budgetLabel(lead:Lead){const format=(v:string)=>new Intl.NumberFormat("vi-VN",{style:"currency",currency:lead.currency}).format(Number(v));return lead.budgetMin!==null&&lead.budgetMax!==null?format(lead.budgetMin)+" – "+format(lead.budgetMax):lead.budgetMin!==null?"Từ "+format(lead.budgetMin):lead.budgetMax!==null?"Tối đa "+format(lead.budgetMax):"Chưa xác định"}
