import { expect, test, vi } from "vitest";
import { FormPublicationSession } from "@/lib/form-publication";
import type { FormRecord } from "@/contracts/forms";

function record(version=1, hasDraft=true): FormRecord {
  return { id:"form",serviceId:"service",serviceName:"서비스",ownerName:"작성자",title:"폼",status:hasDraft ? "draft":"published",version,
    createdAt:"2026-10-03T00:00:00Z",updatedAt:"2026-10-03T00:00:00Z",content:{ body:"본문",questions:[],consentRequired:false,consentPurpose:"",retentionDays:30,maxResponses:5 },
    hasDraft,draftNumber:1,published:!hasDraft,favorite:false,publication:null,
    actions:{ preview:true,responses:false,edit:false,copy:false,registerTemplate:false,publish:hasDraft,share:!hasDraft,pause:!hasDraft,resume:false,archive:false,checkDeletion:false } };
}
test("캐시된 저장 결과의 게시 권한 대신 최신 GET을 확인한다",async () => {
  const saved=record(),current={ ...saved,actions:{ ...saved.actions!,publish:false } },write=vi.fn();
  const session=new FormPublicationSession({ read:async () => current,publish:write });
  await expect(session.publish(saved)).rejects.toMatchObject({ status:403 }); expect(write).not.toHaveBeenCalled();
});
test("다른 곳에서 변경한 version은 게시하지 않고 내 저장 결과를 보존한다",async () => {
  const saved=record(),write=vi.fn(),session=new FormPublicationSession({ read:async () => record(3),publish:write });
  await expect(session.publish(saved)).rejects.toMatchObject({ status:409 }); expect(write).not.toHaveBeenCalled(); expect(saved.version).toBe(1);
});
test("쓰기 응답을 받기 전의 유실은 같은 version과 키로 재시도한다",async () => {
  let published=false; const write=vi.fn().mockRejectedValueOnce(new TypeError("전송 유실")).mockImplementation(async () => { published=true; });
  const session=new FormPublicationSession({ read:async () => published ? record(2,false):record(),publish:write,makeKey:() => "same-key" });
  await expect(session.publish(record())).rejects.toThrow("전송 유실"); await expect(session.publish(record())).resolves.toMatchObject({ version:2,hasDraft:false });
  expect(write.mock.calls[0]).toEqual(write.mock.calls[1]); expect(write).toHaveBeenCalledTimes(2);
});
test("게시 성공 응답 유실 뒤에는 현재 공유 상태를 읽고 재게시하지 않는다",async () => {
  let published=false; const write=vi.fn(async () => { published=true; throw new TypeError("성공 응답 유실"); });
  const session=new FormPublicationSession({ read:async () => published ? record(2,false):record(),publish:write });
  await expect(session.publish(record())).rejects.toThrow("성공 응답 유실"); await expect(session.publish(record())).resolves.toMatchObject({ hasDraft:false });
  expect(write).toHaveBeenCalledTimes(1);
});
test("게시 확인 전에 공유 권한이 회수되면 공유 이동을 안내하지 않는다",async () => {
  let published=false; const write=vi.fn(async () => { published=true; });
  const session=new FormPublicationSession({ read:async () => published ? { ...record(2,false),actions:{ ...record(2,false).actions!,share:false } }:record(),publish:write });
  await expect(session.publish(record())).rejects.toMatchObject({ status:403 }); await expect(session.publish(record())).rejects.toMatchObject({ status:403 }); expect(write).toHaveBeenCalledTimes(1);
});
test("빠른 중복 게시 요청은 같은 진행 중 Promise와 한 번의 쓰기를 사용한다",async () => {
  let published=false,resolve!:() => void; const waiting=new Promise<void>(done => { resolve=done; });
  const write=vi.fn(async () => { await waiting;published=true; });
  const session=new FormPublicationSession({ read:async () => published ? record(2,false):record(),publish:write });
  const first=session.publish(record()),second=session.publish(record());expect(second).toBe(first);
  resolve(); await first;expect(write).toHaveBeenCalledTimes(1);
});
