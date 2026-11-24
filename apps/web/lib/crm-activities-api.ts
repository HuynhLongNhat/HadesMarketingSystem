import { apiFetch } from "./api-client";
export const activityLabels={note:"Ghi chú",call:"Cuộc gọi",meeting:"Cuộc họp",email:"Email",message:"Tin nhắn"} as const;
export type ActivityType=keyof typeof activityLabels;
export type ActivityInput={type:ActivityType;subject:string;body?:string;outcome?:string;occurredAt:string;relatedId?:string};
export type Activity=Omit<ActivityInput,"body"|"outcome"|"relatedId">&{id:string;leadId:string|null;companyId:string|null;contactId:string|null;body:string|null;outcome:string|null;authorName:string|null;archivedAt:string|null;updatedAt:string};
export type ActivityTarget="company"|"contact"|"lead";
const base=(target:ActivityTarget,id:string)=>"/crm/"+(target==="company"?"companies":target==="lead"?"leads":"contacts")+"/"+encodeURIComponent(id)+"/activities";
export const crmActivitiesApi={
 list:(target:ActivityTarget,id:string,page:number,type:ActivityType|"",status:"active"|"archived")=>apiFetch<{items:Activity[];total:number;page:number;limit:number}>(base(target,id)+"?"+new URLSearchParams({page:String(page),status,...(type?{type}:{})})),
 create:(target:ActivityTarget,id:string,input:ActivityInput)=>apiFetch<Activity>(base(target,id),{method:"POST",body:JSON.stringify(input)}),
 update:(target:ActivityTarget,id:string,activityId:string,input:ActivityInput)=>apiFetch<Activity>(base(target,id)+"/"+encodeURIComponent(activityId),{method:"PATCH",body:JSON.stringify(input)}),
 archive:(target:ActivityTarget,id:string,activityId:string,restore:boolean)=>apiFetch<Activity>(base(target,id)+"/"+encodeURIComponent(activityId)+(restore?"/restore":"/archive"),{method:"POST"}),
};
