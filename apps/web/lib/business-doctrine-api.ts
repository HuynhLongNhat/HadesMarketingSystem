import { apiFetch } from "./api-client";
export type BusinessDoctrine={id:string;title:string;principles:string[];version:number;enabled:boolean;createdAt:string};
export const businessDoctrineApi={list:()=>apiFetch<BusinessDoctrine[]>("/business-doctrines"),create:(input:{title:string;principles:string[];enabled?:boolean})=>apiFetch<BusinessDoctrine>("/business-doctrines",{method:"POST",body:JSON.stringify(input)}),toggle:(id:string,enabled:boolean)=>apiFetch<BusinessDoctrine>(`/business-doctrines/${encodeURIComponent(id)}/enabled`,{method:"PATCH",body:JSON.stringify({enabled})})};
