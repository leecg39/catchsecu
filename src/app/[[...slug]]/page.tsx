import CloneApp from '@/components/CloneApp';
import {isRegisteredPage} from '@/lib/registered-page';
import {notFound, redirect} from 'next/navigation';
import {headers} from 'next/headers';
import {requireActor,requireContext} from '@/server/context';
import {HttpError} from '@/server/http';
import {db} from '@/server/db';
import {serviceScope} from '@/server/context';
import {isPublicPath} from '@/lib/public-paths';
import {accessDenialFromCode,accessDenialReason} from '@/lib/access-denial';
export async function generateMetadata({params}:{params:Promise<{slug?:string[]}>}) {
  const {slug=[]}=await params;
  return slug[0]==='document' ? { title:'공개 문서', robots:{index:false,follow:false}, referrer:'no-referrer' as const } : {};
}
export default async function Page({params,searchParams}:{params:Promise<{slug?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {slug=[]}=await params;
  const path='/'+slug.join('/');
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(await searchParams)){if(Array.isArray(value))value.forEach(item=>query.append(key,item));else if(value!==undefined)query.set(key,value);}
  const returnTo=path+(query.size?'?'+query.toString():'');
  const deniedReason=path==='/access-not-allow'?accessDenialReason(query.get('reason')):'general';
  const systemNotices=/^\/admin\/notices(?:\/(?:new|[A-Za-z0-9-]+(?:\/edit)?))?$/.test(path);
  const systemGuides=/^\/admin\/guides(?:\/(?:new|[A-Za-z0-9-]+\/edit))?$/.test(path);
  const systemSupport=/^\/admin\/support(?:\/[0-9a-f-]{36})?$/.test(path);
  const memberSupport=/^\/my-page\/support(?:\/(?:new|[0-9a-f-]{36}))?$/.test(path);
  const legacyImport=path==='/my-page/legacy-import';
  const systemExpert=path==='/admin/expert-assignments';
  const auditLog=/^\/log\/(?:service|info-monitoring|ad-monitoring|customer|member|authority|external-viewer|access-history|mail)$/.test(path);
  const selfPage=['/my-page/info','/my-page/info/edit','/my-page/delete','/my-page/activity-log'].includes(path);
  const legalPage=/^\/legal\/(?:privacy|terms)\/?$/.test(path);
  const kakaoCampaign=path==='/alimtalk/direct'||path==='/alimtalk/catchform';
  const known=path==='/security/sso/providers'||legalPage||systemNotices||systemGuides||systemSupport||systemExpert||memberSupport||legacyImport||kakaoCampaign||/^\/document\/view\/[A-Za-z0-9_-]{43}$/.test(path)||isRegisteredPage(path);
  if(!known)notFound();
  if(!isPublicPath(path)) {
    try {
      const requestHeaders=await headers();
      const actor=await requireActor(requestHeaders);
      if((systemNotices||systemGuides||systemSupport||systemExpert) && !actor.user.platformAdmin)redirect('/access-not-allow?reason=admin');
      if(!systemNotices&&!systemGuides&&!systemSupport&&!systemExpert&&!selfPage&&!['/company-info','/access-not-allow','/expert/select-company'].includes(path)){
        const ctx=await requireContext(requestHeaders,auditLog?'audit.read':undefined);
        if(['/', '/dashboard', '/IE'].includes(path) && !['owner','admin'].includes(ctx.member.role) &&
          !(await db.service.count({where:{...serviceScope(ctx),status:'active'}})))
          redirect(ctx.member.accessKind==='expert'?'/expert/select-company':'/service/none');
      }
    }
    catch(error) {
      if(error instanceof HttpError){
        if(error.status===401)redirect('/login?returnTo='+encodeURIComponent(returnTo));
        if(error.code==='COMPANY_REQUIRED'){
          const expert=await requireActor(await headers());
          if(await db.expertAssignment.count({where:{expertUserId:expert.user.id}}))redirect('/expert/select-company');
          redirect('/company-info');
        }
        if(['IP_NOT_ALLOWED','IP_ADDRESS_UNAVAILABLE'].includes(error.code))redirect('/not-allow-ip');
        if(error.code==='MFA_REQUIRED')redirect('/two-step-setting?returnTo='+encodeURIComponent(returnTo));
        if(error.code==='PASSWORD_CHANGE_REQUIRED')redirect('/password-change-rule?returnTo='+encodeURIComponent(returnTo));
        if(['GOOGLE_OAUTH_POLICY','MS_OAUTH_POLICY'].includes(error.code))redirect('/access-not-allow');
        if(error.status===403)redirect('/access-not-allow?reason='+accessDenialFromCode(error.code));
      }
      throw error;
    }
  }
  return <CloneApp path={path} accessReason={deniedReason}/>;
}
