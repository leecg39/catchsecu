"use client";
import { useState } from "react";
import { PageHeading, Panel, DataTable } from "../shared";
import { Filters, Tabs } from "./ui";
export function MessageHistory({email=false}:{email?:boolean}){const [tab,setTab]=useState(0);const columns=tab?(email?['#','예약일정','제목','출처','발신 주소','발송건수','담당자','관리']:['#','예약일정','제목','형식','예약건수','담당자','예약취소']):['#','발송일시','제목','출처',email?'발신 주소':'발신번호',...(email?[]:['형식']),'발송건수','성공/실패',...(email?['반송 (반송률)','수신거부 (수신거부율)']:[]),'진행상태','담당자'];return <><PageHeading title="발송 내역"/><Panel><Tabs items={['발송 요청 내역','예약 내역']} value={tab} onChange={setTab}/><Filters fields={['담당자',...(email?['발신 주소']:[]),...(!tab?['진행상태']:[]),...(tab&&!email?[]:['시작일','종료일'])]}/><DataTable columns={columns} rows={[]}/></Panel></>}
