'use client';
import { useEffect, useState } from 'react';
export class ApiError extends Error {
  constructor(public status:number,message:string){super(message);}
}
async function result<T>(response:Response):Promise<T> {
  const body=await response.json();
  if(!response.ok) throw new ApiError(response.status,body.error||'No se pudo completar la operación.');
  return body.data as T;
}
export async function apiGet<T>(action:string,params:Record<string,string|number>={},signal?:AbortSignal) {
  const query=new URLSearchParams({action,...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))});
  return result<T>(await fetch('/api/registro?'+query,{cache:'no-store',signal}));
}
export async function apiPost<T>(action:string,input:unknown) {
  return result<T>(await fetch('/api/registro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input})}));
}
export function useRemote<T>(action:string,params:Record<string,string|number>={},enabled=true) {
  const key=JSON.stringify(params);
  const [data,setData]=useState<T>(); const [error,setError]=useState('');
  const [loading,setLoading]=useState(enabled); const [version,setVersion]=useState(0);
  useEffect(()=>{
    if(!enabled){setData(undefined);setError('');setLoading(false);return;}
    const controller=new AbortController();setData(undefined);setError('');setLoading(true);
    apiGet<T>(action,JSON.parse(key),controller.signal).then(d=>{if(!controller.signal.aborted)setData(d);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Error de conexión.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[action,key,version,enabled]);
  return {data,error,loading,reload:()=>setVersion(v=>v+1)};
}
export function downloadJson(name:string,data:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function formatDate(date:string) {
  return new Intl.DateTimeFormat('es-DO',{day:'numeric',month:'short',year:'numeric'}).format(new Date(date.slice(0,10)+'T12:00:00'));
}
export function errorText(e:unknown){return e instanceof Error?e.message:'No se pudo conectar. El borrador sigue disponible.';}
