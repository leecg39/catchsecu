from pathlib import Path
import csv
import json

root = Path(__file__).resolve().parents[1]
directory = root / 'docs/qa/R10-T01/source-field-audit'
original = json.loads((directory / 'field-map.json').read_text())
mapping = {}
def group(source, target, fields):
    for old, new in fields.items():
        mapping[source + old] = target + new
group('under14Info.', 'children.', {'privacyCollectPurpose':'purpose','mandatoryItems[]':'requiredItems[]','optionalItems[]':'optionalItems[]','period[].prefix':'periods[].prefix','period[].dateNumber':'periods[].amount','period[].dateType':'periods[].unit','period[].coupler':'periods[].condition','legalRepresentativeItems[]':'guardianItems[]'})
mapping.update(itServiceType='hosting.mode', devOutSourcingYn='development.enabled', privacyCollectYn='children.enabled', execDate='Document.effectiveDate', ecommerceRetentionItem='preservation.commerceItems', accessHistoryRetentionItem='preservation.accessItems', behavioralAdYn='behavioralAdvertising.enabled')
mapping['ecommerceRetentionItem[]'] = 'preservation.commerceItems[]'
mapping['accessHistoryRetentionItem[]'] = 'preservation.accessItems[]'
for source, target in [('itServiceTrustees[].','hosting.trustees[].'),('devOutSourcingTrustees[].','development.trustees[].')]:
    group(source,target,{'companyName':'name','country':'country','contact':'contact','serviceTrusteeType':'(parent section)','consignmentWork':'work','mandatoryEntrustItems[]':'requiredItems[]','optionalEntrustItems[]':'optionalItems[]','reconsignment[]':'subprocessors[]'})
group('notUsageInfo.', 'inactiveUsers.', {'notUsageProcessType':'action','notUsagePIProcessDetail.notUsageStorePeriod':'amount','notUsagePIProcessDetail.notUsageStorePeriodType':'unit','notUsagePIProcessDetail.notUsageStoreUserCustom':'customText'})
group('withDrawInfo.', 'withdrawals.', {'withDrawProcessType':'action','withDrawProcessDetail.withDrawStorePeriod':'amount','withDrawProcessDetail.withDrawStorePeriodType':'unit','withDrawProcessDetail.withDrawStoreInfo':'items[]'})
group('cctvInfo.', 'cctv.', {'cctvIsExists':'enabled','cctvInstallPurposes[]':'purposes[]','cctvInstallCustomPurpose':'customPurpose'})
group('cctvInstallInfoList[].', 'cctv.installations[].', {'installLocation':'location','totalAmount':'count','uptime':'operatingHours','cctvStorage.storagePeriod':'storagePeriod','cctvStorage.cctvStoragePeriodType':'storageUnit','cctvStorage.storageLocation':'storageLocation','cctvConsignment':'outsourced','cctvManageTrustee.trusteeName':'trustee.name','cctvManageTrustee.country':'trustee.country','cctvManageTrustee.contact':'trustee.contact'})
for prefix in ['cctvManagerInfo[].','cctvSubManagerInfo[].']:
    group(prefix,'cctv.managers[].',{'department':'department','managerInfo':'nameAndPosition','cctvManagerType':'role'})
group('autoDecisionInfo.', 'automatedDecisions.', {'autoDecisionYn':'enabled','autoDecisionDetail.decisionOverview':'overview','autoDecisionDetail.piTypeContent':'processedInformation','autoDecisionDetail.piTypeRelation':'decisionRelation','autoDecisionDetail.processProcedure':'procedure','autoDecisionDetail.specialPiYn':'specialInformation','autoDecisionDetail.sensitivePrivacyProcess.selected':'sensitive.selected','autoDecisionDetail.sensitivePrivacyProcess.purpose':'sensitive.purpose','autoDecisionDetail.sensitivePrivacyProcess.items[]':'sensitive.items[]','autoDecisionDetail.underFourteenPrivacyProcess.selected':'children.selected','autoDecisionDetail.underFourteenPrivacyProcess.purpose':'children.purpose','autoDecisionDetail.underFourteenPrivacyProcess.items[]':'children.items[]','autoDecisionDetail.requestContacts[].departmentName':'contacts[].department','autoDecisionDetail.requestContacts[].contact':'contacts[].contact'})
group('directorInfo.','officers.',{'directorName':'name','directorPos':'position','directorEmail':'email'})
group('userInfo.','officers.',{'hpUpdatePath':'updatePath','hpDeletePath':'deletePath'})
group('departmentInfo.','officers.',{'privacyDepartmentYN':'departmentEnabled','department.directorDepartment':'department.name','department.directorDepartmentContact':'department.contact','department.departmentDirectorName':'department.officerName'})
group('domesticInfo.','officers.',{'domainAgentYn':'domesticAgentEnabled','domesticAgents[].corporationName':'domesticAgents[].name','domesticAgents[].representativeName':'domesticAgents[].representative','domesticAgents[].emailAddress':'domesticAgents[].email','domesticAgents[].contact':'domesticAgents[].contact','domesticAgents[].address':'domesticAgents[].address'})
group('dpoInfo.','officers.',{'existsDpo':'dpoEnabled','dpoDetail.dpoName':'dpo.name','dpoDetail.dpoAddress':'dpo.address','dpoDetail.dpoContact':'dpo.contact'})
group('sensitiveInfo.','sensitiveDisclosure.',{'possibilitySensitivePrivacyYN':'enabled','sensitiveInfo.sensitiveOpenLocation':'locations','sensitiveInfo.sensitiveCloseMethod':'optOut'})
group('overseaTransferInfo.','overseasTransfer.',{'overseaTransferPrivacyYN':'enabled','overseaTransfer.overseaTransferRefuse':'refusal','overseaTransfer.overseaTransferRefuseEffect':'effect'})
group('deviceInternalInfo.','deviceProcessing.',{'deviceInternalYn':'enabled','deviceInternalDetail.deviceInternalFunction':'functions','deviceInternalDetail.deviceInternalItems[]':'items[]'})
rows=[]
for field in original['fields']:
    source=field['sourcePath']
    if source in ['initMandatoryItems[]','initOptionalItems[]']:
        target='ProcessingPurpose.items -> DocumentOptions.policyItems'; status='client_initialization_implemented'; note='서비스 전체 활성 목적의 필수/선택 항목을 조회해 신규 수탁자/재수탁자 초기값과 선택 목록으로 사용한다. 중복 제거·100개 초과 수동 선택은 독립 자원 제한이다.'
    else:
        target=mapping[source]; status='implemented_normalized'; note='독립 DTO·DB·게시 스냅샷·개별 입력 구현. 원본 API wire 형식과 동일하다는 의미가 아님.'
        if source.endswith('serviceTrusteeType'):
            status='derived_from_section'; note='원본 IT_SERVICE/OUT_SOURCING을 hosting/development 부모 구역으로 구분한다.'
    rows.append({'sourcePath':source,'target':target,'status':status,'note':note})
report={'sourceAudit':'field-map.json','initialStateFields':len(rows),'implementedNormalized':sum(r['status']=='implemented_normalized' for r in rows),'derivedFromSection':2,'clientInitializationReview':0,'clientInitializationImplemented':2,'allSourceParityAccepted':False,'fields':rows,
        'additionalObservedFields':['under14Info.period[].directPrefix','outsourcingInputType','linkText','linkUrl','piReasonType','reconsignment[].(direct/link fields)','reconsignment[].mandatoryEntrustItems[]','reconsignment[].optionalEntrustItems[]','reconsignment[].piReasonType'],
        'evidence':['../structured-policy/server-first.json','../../R10-T04/structured-policy/created.json','service-item-source.json','initialization-controls.json','../../R10-T02/trustee-items/tests-final.json']}
(directory/'implementation-map.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
with (directory/'implementation-map.csv').open('w',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=['sourcePath','target','status','note']);writer.writeheader();writer.writerows(rows)
print({k:v for k,v in report.items() if not isinstance(v,list)})
