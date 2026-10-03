import json,pathlib
r=pathlib.Path(__file__).parent
items=[('TemplateGallery','template-detail-1440','/form/template','click tabs; scroll does not change active tab. Company tab shows empty message. Use button not clicked because it could create a remote form.','template-company-tab.json','3 columns at 1440, 2 at 768, 1 at 390; gap 24px.'),('FormList','manage-detail-1440','/form/manage','click detailed-search toggle expands local filters; search/sort controls. Empty account 0 rows.','manage-expanded.json','Table retains horizontal scroll; source mobile remains dense.'),('FixedUrlList','fixed-url-detail-1440','/form/fixed-url','Create click displays paid-license toast; no data created.','fixed-url-modal.json','Table retains horizontal scroll.'),('FormEditor','basic-frame-detail-1440','/form/ai/create, /form/ai/basic-frame','Local editor toolbar, text fields, question dropdown; no save/next operations executed.','create-detail.json','Editor toolbar wraps; desktop content column becomes narrow on mobile.'),('UploadLicenseGate','upload-detail-1440','/form/info-upload, /form/info-upload/agreement, /form/info-upload/recipient','License information link; blocked behind paid license.','N/A','Centered gate preserved; text wraps.'),('BasicLicenseGate','consent-gate-detail-1440','all 7 /basic/* routes','Static current-account access gate.','N/A','Centered gate preserved; text wraps.'),('MarketingConsentList','form_ad-manage','/form/ad-manage','Intro dialog with dismiss and do-not-show checkbox; table filters. Do not withdraw real consent.','N/A','Not separately inspected at tablet/mobile; table should retain horizontal scrolling, pending QA.')]
for title,source,routes,behavior,state,responsive in items:
 a=json.load(open(r/(source+'.json'))); body=a['text'].split('MY',1)[-1].replace('중소기업발전','데모 서비스'); unique=[]
 for e in a['dom']:
  if not e.get('text') or e['text'] in [x.get('text') for x in unique]:continue
  if e['tag'] in ('BUTTON','INPUT','TEXTAREA','TH','TD') or e['text'] in body:
   unique.append(e)
 css='\n'.join('- '+e['text'][:45].replace('\n',' ')+' — '+json.dumps(e['css'],ensure_ascii=False) for e in unique[-10:])
 text=f'''# {title} Specification
## Overview
- Routes: {routes}
- Target: src/components/forms/{title}.tsx
- Screenshot: docs/design-references/forms/{source}.png
- Evidence JSON: docs/research/forms/{source}.json
- Interaction model: click-driven local UI; no observed scroll-driven animation.
## DOM Structure
- Shared application sidebar/header, page heading, content region.
- Content order follows the verbatim text below; the JSON includes exact visible node classes/styles.
## Computed Styles
{css}
## States & Behaviors
- {behavior}
- Additional state evidence: {state}
- Primary buttons: #6558ff, border 1px solid #6558ff, radius 4px, height40px, padding12px; transition .15s cubic-bezier(.4,0,.2,1).
- Hover observed in template-hover.json; other hover states not individually exercised.
## Assets
- Original asset URLs are in the evidence JSON assets property.
- All rendering assets should be copied locally; do not copy account information.
## Text Content (verbatim with account name replaced)
{body}
## Responsive Behavior
- {responsive}
- Desktop/tablet/mobile evidence uses *-detail-1440/768/390 filenames where available.
## Limits
- No server mutations were performed. Real customer names must become demo data.
'''
 # preserve <=150 lines by collapsing redundant blank lines
 while '\n\n\n' in text:text=text.replace('\n\n\n','\n\n')
 (r/(title+'.spec.md')).write_text(text)
# gallery normalized data from actual DOM
x=json.load(open(r/'template-detail-1440.json'))
titles=[e['text'] for e in x['dom'] if 'subtitle-3 min-h-' in (e.get('cls') or '')]
descs=[e['text'] for e in x['dom'] if 'label-1-Weak-long-form' in (e.get('cls') or '')]
imgs=[e['src'] for e in x['assets'] if e['alt']=='filePreview']
(r/'template-content.json').write_text(json.dumps([dict(title=t,description=d,image=i) for t,d,i in zip(titles,descs,imgs)],ensure_ascii=False,indent=2))
