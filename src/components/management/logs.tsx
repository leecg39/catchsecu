"use client";
import {useState} from 'react';import {defaultLogFilters,filterLogRows,type LogFilters} from './log-filter';import {PageHeading,Panel,ActionButton,DataTable} from '../shared';
const configs:Record<string,{title:string;description?:string;columns:string[];kind?:string}>= {
'/log/service':{title:'서비스 이용 로그',description:'권한이 있는 모든 서비스의 이용 로그를 확인합니다.',columns:['#','처리자명','처리일시','접속 IP','처리대상','처리내용','비고']},
'/log/info-monitoring':{title:'개인정보 처리로그',description:'구성원의 개인정보 조회, 다운로드, 파기 등의 로그를 확인할 수 있습니다. (‘26년 4월 이후의 외부 열람자 로그는 ‘외부 열람자 로그’ 화면에서 확인할 수 있습니다.)',columns:['#','서비스명','캐치폼·개인정보 업로드명','처리자명','처리일시','접속 IP','고객번호','처리내용','사유'],kind:'info'},
'/log/ad-monitoring':{title:'광고성 정보 수신동의 처리로그',columns:['#','서비스명','처리자명','처리일시','접속 IP','고객번호','처리내용','사유'],kind:'ad'},
'/log/customer':{title:'고객 이용 로그',columns:['#','서비스 명','캐치폼 명','고객번호','처리일시','접속 IP','수행내용'],kind:'customer'},
'/log/collect-destruction':{title:'개인정보 수집 및 파기 내역',description:'서비스별/캐치폼·개인정보 업로드 항목 별 개인정보 수집, 잔여, 파기 내역을 하루 단위로 확인할 수 있습니다.',columns:['#','일자','서비스 명','캐치폼·개인정보 업로드 명','수집한 개인정보','당일 수집','당일 파기','당일 잔여(수집-파기)'],kind:'collect'},
'/my-page/activity-log':{title:'나의 활동 로그',columns:['#','#','처리일시','접속 IP','수행내용'],kind:'activity'},
'/my-page/info-activity-log':{title:'개인정보 활동 검토 이력',columns:['#','수신일시','발신자','내용','구분','대상자','상태','메시지 발송'],kind:'review'}};
export function hasLog(path:string){return path in configs}
export function Logs({path}:{path:string}){
  const c=configs[path];
  const [draft,setDraft]=useState(defaultLogFilters);
  const [applied,setApplied]=useState(defaultLogFilters);
  const update=(patch:Partial<LogFilters>)=>setDraft(previous=>({...previous,...patch}));
  const sourceRows:(string|number)[][]=[];
  const rows=filterLogRows(sourceRows,c.columns,applied);
  const reset=()=>{setDraft(defaultLogFilters());setApplied(defaultLogFilters());};
  const fields=c.columns.filter(column=>['처리자명','접속 IP','처리내용','수행내용','내용','발신자'].includes(column));
  const download=()=>{
    const csv=[c.columns,...rows].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);anchor.download='로그.csv';anchor.click();URL.revokeObjectURL(anchor.href);
  };
  return <><PageHeading title={c.title}/>{c.description&&<p className="mg-description">{c.description}</p>}<Panel>
    {!['customer','collect','activity','review'].includes(c.kind||'')&&<div className="mg-tabs">{['기본조회','특정 시간 조회'].map((title,index)=><button className={draft.tab===index?'active':''} key={title} onClick={()=>update({tab:index})}>{title}</button>)}</div>}
    {c.kind!=='activity'&&<div className="mg-filters">
      {!['customer','review'].includes(c.kind||'')&&<div className="mg-flex">
        <label>{c.kind==='collect'?'시작일':'처리일시'}<input aria-label="시작일" className="cs-input" type="date" value={draft.start} onChange={event=>update({start:event.target.value})}/></label>
        <input aria-label="시작 시간" className="cs-input mg-time" type="time" value={draft.startTime} onChange={event=>update({startTime:event.target.value})}/>~
        <label>{c.kind==='collect'?'종료일':''}<input aria-label="종료일" className="cs-input" type="date" value={draft.end} onChange={event=>update({end:event.target.value})}/></label>
        <input aria-label="종료 시간" className="cs-input mg-time" type="time" value={draft.endTime} onChange={event=>update({endTime:event.target.value})}/>
        {draft.tab===1&&<label>조회 시간대 <input aria-label="조회 시간대" type="time" className="cs-input" value={draft.specificTime} onChange={event=>update({specificTime:event.target.value})}/></label>}
      </div>}
      <div className="mg-flex">
        {['info','ad','customer','collect'].includes(c.kind||'')&&<select aria-label="서비스" className="cs-input" value={draft.service} onChange={event=>update({service:event.target.value})}><option>전체</option><option>중소기업발전</option></select>}
        {['info','customer','collect'].includes(c.kind||'')&&<select className="cs-input" aria-label="캐치폼"><option>캐치폼·개인정보 업로드 전체</option></select>}
        <select className="cs-input" aria-label="검색 조건" value={draft.field} onChange={event=>update({field:event.target.value})}>{[...new Set(['처리자명',...fields])].map(field=><option key={field}>{field}</option>)}</select>
        <input className="cs-input" placeholder="검색어 입력" value={draft.search} onChange={event=>update({search:event.target.value})}/>
        <ActionButton secondary onClick={reset}>검색 조건 초기화</ActionButton><ActionButton onClick={()=>setApplied({...draft})}>검색</ActionButton>
      </div>
      {draft.start&&draft.end&&`${draft.start} ${draft.startTime}`>`${draft.end} ${draft.endTime}`&&<p role="alert">종료일시는 시작일시 이후로 선택해 주세요.</p>}
    </div>}
    <div className="mg-toolbar"><span>전체 {rows.length} 개</span>{c.kind!=='activity'&&<ActionButton secondary disabled={!rows.length} onClick={download}>엑셀 다운로드</ActionButton>}</div>
    <DataTable columns={c.columns} rows={rows} initialSize={10}/>
  </Panel></>;
}
