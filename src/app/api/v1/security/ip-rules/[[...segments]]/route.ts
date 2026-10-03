import { z } from "zod";
import { ipAccessChange, ipRuleInput, ipRulePatch, ipRuleDelete, ipRuleQuery } from "@/contracts/ip-access";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { requestQuery, requireEmptyQuery } from "@/server/request-query";
import { confirmPassword } from "@/server/security-policy";
import { changeIpAccess, createIpRule, deleteIpRule, listIpRules, readIpRule, updateIpRule } from "@/server/ip-access";
const parts=(r:Request)=>new URL(r.url).pathname.split("/").slice(5).filter(Boolean);
export const GET=route(async request=>{
  const ctx=await requireContext(request.headers,"security.read"), path=parts(request);
  if(!path.length) return json(await listIpRules(ctx,ipRuleQuery.parse(requestQuery(request))));
  requireEmptyQuery(request); if(path.length===1) return json(await readIpRule(ctx,z.uuid().parse(path[0])));
  fail(404,"NOT_FOUND","경로를 찾을 수 없습니다.");
});
export const POST=route(async (request,requestId)=>{
  requireEmptyQuery(request); if(parts(request).length) fail(404,"NOT_FOUND","경로를 찾을 수 없습니다.");
  const ctx=await requireContext(request.headers,"security.write");
  const result=await createIpRule(ctx,await body(request,ipRuleInput),request.headers.get("idempotency-key"),requestId);
  return json(result.body,result.status);
});
export const PATCH=route(async (request,requestId)=>{
  requireEmptyQuery(request); const path=parts(request),ctx=await requireContext(request.headers,"security.write");
  if(path.length===1&&path[0]==="settings"){
    const {password,...input}=await body(request,ipAccessChange);
    if(ctx.member.role!=="owner"||ctx.member.accessKind!=="direct") fail(403,"FORBIDDEN","최상위 관리자만 설정을 변경할 수 있습니다.");
    await confirmPassword(ctx,request.headers,password); return json(await changeIpAccess(ctx,input,requestId));
  }
  if(path.length===1) return json(await updateIpRule(ctx,z.uuid().parse(path[0]),await body(request,ipRulePatch),requestId));
  fail(404,"NOT_FOUND","경로를 찾을 수 없습니다.");
});
export const DELETE=route(async (request,requestId)=>{
  requireEmptyQuery(request); const path=parts(request); if(path.length!==1) fail(404,"NOT_FOUND","경로를 찾을 수 없습니다.");
  const ctx=await requireContext(request.headers,"security.write");
  await deleteIpRule(ctx,z.uuid().parse(path[0]),await body(request,ipRuleDelete),requestId); return new Response(null,{status:204});
});
