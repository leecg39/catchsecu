import { mfaMemberQuery,mfaPolicyChange,mfaExceptionCreate,mfaExceptionPatch,mfaExceptionDelete } from "@/contracts/mfa-policy";
import { requireContext } from "@/server/context";
import { body,fail,json,route } from "@/server/http";
import { requestQuery,requireEmptyQuery } from "@/server/request-query";
import { confirmPassword } from "@/server/security-policy";
import { changeMfaPolicy,listMfaMembers,createMfaException,readMfaException,updateMfaException,deleteMfaException } from "@/server/mfa-policy";
function path(request:Request){return new URL(request.url).pathname.split("/").filter(Boolean).slice(4);}
export const GET=route(async request=>{
  const ctx=await requireContext(request.headers,"security.read"),parts=path(request);
  if(!parts.length)return json(await listMfaMembers(ctx,mfaMemberQuery.parse(requestQuery(request))));
  requireEmptyQuery(request);if(parts.length===2&&parts[0]==="exceptions")return json(await readMfaException(ctx,parts[1]));
  fail(404,"NOT_FOUND","경로를 찾을 수 없습니다.");
});
export const PATCH=route(async(request,requestId)=>{
  requireEmptyQuery(request);const ctx=await requireContext(request.headers,"security.write"),parts=path(request);
  if(!parts.length){const {password,...input}=await body(request,mfaPolicyChange);await confirmPassword(ctx,request.headers,password);return json(await changeMfaPolicy(ctx,input,requestId));}
  if(parts.length===2&&parts[0]==="exceptions"){const {password,...input}=await body(request,mfaExceptionPatch);await confirmPassword(ctx,request.headers,password);return json(await updateMfaException(ctx,parts[1],input,requestId));}
  fail(404,"NOT_FOUND","경로를 찾을 수 없습니다.");
});
export const POST=route(async(request,requestId)=>{
  requireEmptyQuery(request);const parts=path(request);if(parts.length!==1||parts[0]!=="exceptions")fail(404,"NOT_FOUND","경로를 찾을 수 없습니다.");
  const ctx=await requireContext(request.headers,"security.write"),{password,...input}=await body(request,mfaExceptionCreate);
  await confirmPassword(ctx,request.headers,password);
  const result=await createMfaException(ctx,input,request.headers.get("idempotency-key"),requestId);return json(result.body,result.status);
});
export const DELETE=route(async(request,requestId)=>{
  requireEmptyQuery(request);const parts=path(request);if(parts.length!==2||parts[0]!=="exceptions")fail(404,"NOT_FOUND","경로를 찾을 수 없습니다.");
  const ctx=await requireContext(request.headers,"security.write"),{password,...input}=await body(request,mfaExceptionDelete);
  await confirmPassword(ctx,request.headers,password);await deleteMfaException(ctx,parts[1],input,requestId);return new Response(null,{status:204});
});
