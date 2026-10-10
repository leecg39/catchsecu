"""Align Prisma metadata with inspected applied SQL; never execute DDL or edit migrations."""
from pathlib import Path
import re
import json
import hashlib

root = Path(__file__).resolve().parents[1]
schema = root / 'prisma/schema.prisma'
source = schema.read_text()
observed = (root / '.local/rea-fullstack/schema-introspected.prisma').read_text()
diff = (root / 'docs/qa/R01-T01/db-rehearsal/current-schema-diff.log').read_text()
out = root / 'docs/qa/R01-T01/schema-alignment'
out.mkdir(parents=True, exist_ok=True)
before = out / 'schema-before.prisma'
if before.exists():
    raise RuntimeError('Reconciliation already recorded; inspect rather than overwrite its baseline.')
before.write_text(source)

def models(text):
    return {match[1]: match[2] for match in re.finditer(r'model (\w+) \{(.*?)\n\}', text, re.S)}

def attribute(line, name):
    start = line.find('@' + name + '(')
    if start < 0:
        return None
    depth, quoted, escaped = 0, False, False
    for pos in range(start + len(name) + 1, len(line)):
        char = line[pos]
        if quoted:
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == '"': quoted = False
        elif char == '"': quoted = True
        elif char == '(': depth += 1
        elif char == ')':
            depth -= 1
            if depth == 0: return line[start:pos + 1]
    raise RuntimeError('Unclosed attribute: ' + line)

blocks = models(observed)
changes = []
tables = re.findall(r'Changed the `(\w+)` table', diff)
column_defaults = {}
table = None
for line in diff.splitlines():
    match = re.search(r'Changed the `(\w+)` table', line)
    if match: table = match[1]
    match = re.search(r'Altered column `(\w+)` \(default changed', line)
    if match: column_defaults.setdefault(table, set()).add(match[1])

for name, body in models(source).items():
    if name not in tables: continue
    target_lines = blocks[name].splitlines()
    fields = {line.split()[0]: line for line in target_lines if line.strip() and not line.strip().startswith(('@@', '//'))}
    revised = []
    for line in body.splitlines():
        updated = line
        parts = line.split()
        if parts and parts[0] in fields:
            target = fields[parts[0]]
            relation = attribute(line, 'relation')
            if relation and 'fields:' in relation:
                target_relation = attribute(target, 'relation')
                if not target_relation or parts[1] != target.split()[1]:
                    raise RuntimeError('Unexpected relationship change: ' + name + '.' + parts[0])
                updated = updated.replace(relation, target_relation)
            if parts[0] in column_defaults.get(name, set()):
                old_default, actual_default = attribute(line, 'default'), attribute(target, 'default')
                if old_default: updated = updated.replace(old_default, actual_default or '')
                elif actual_default: updated += ' ' + actual_default
        if line.strip().startswith(('@@index(', '@@unique(')):
            key = re.match(r'\s*(@@\w+)\(\[([^]]+)\]', line)
            assert key
            candidates = [item for item in target_lines if 'where:' not in item and
                (match := re.match(r'\s*(@@\w+)\(\[([^]]+)\]', item)) and match[1] == key[1] and
                re.sub(r'\s', '', match[2]) == re.sub(r'\s', '', key[2])]
            if len(candidates) != 1: raise RuntimeError('Ambiguous index: ' + name + line)
            updated = '  ' + candidates[0].strip()
        if updated.strip() != line.strip():
            changes.append({'model': name, 'before': line.strip(), 'after': updated.strip()})
        revised.append(updated)
    additions = {
        'FileObject': ['@@index([campaignId, status], map: "FileObject_campaign")', '@@index([senderId, status], map: "FileObject_sender")'],
        'Job': ['@@index([campaignDeliveryId], map: "Job_campaign_delivery")', '@@index([marketingPreferenceId], map: "Job_marketing_preference")', '@@index([marketingSubmissionId], map: "Job_marketing_source")', '@@index([senderId, status], map: "Job_sender")'],
        # Company closure FK stays SQL-only: see prisma/sql-only-constraints.json and runtime regression evidence.
        'Membership': ['messageTemplateRevisions MessageTemplateRevision[] @relation("MessageTemplateRevisionActor")'],
        'MessageTemplateRevision': ['actor Membership @relation("MessageTemplateRevisionActor", fields: [tenantId, actorId], references: [tenantId, userId], onDelete: Restrict, onUpdate: NoAction, map: "MessageTemplateRevision_actor")'],
    }.get(name, [])
    for line in additions:
        revised.append('  ' + line)
        changes.append({'model': name, 'before': None, 'after': line})
    source = source.replace('model ' + name + ' {' + body + '\n}', 'model ' + name + ' {' + '\n'.join(revised) + '\n}')

schema.write_text(source)
(out / 'changes.json').write_text(json.dumps({'basis': 'read-only introspection plus original SQL constraints',
    'sourceBeforeSha256': hashlib.sha256(before.read_bytes()).hexdigest(),
    'sourceAfterSha256': hashlib.sha256(schema.read_bytes()).hexdigest(),
    'databaseModified': False, 'migrationsModified': False, 'changes': changes}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'changes': len(changes), 'models': len(set(item['model'] for item in changes))}))
