"""Create only this project's isolated local databases and private configuration."""
from pathlib import Path
import os
import secrets
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
psql = shutil.which('psql') or '/Users/user01/homebrew/bin/psql'

def sql(statement):
    result = subprocess.run([psql, '-X', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-At'],
                            input=statement, text=True, capture_output=True, check=True)
    return result.stdout.strip()

if (root / '.env.local').exists():
    raise SystemExit('Existing .env.local preserved. Setup is already configured.')
if sql("SELECT rolname FROM pg_roles WHERE rolname='catchsecu_app';"):
    raise SystemExit('catchsecu_app already exists. Refusing to replace its credentials.')
password = secrets.token_hex(32)
sql("CREATE ROLE catchsecu_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + password + "';")
for name in ('catchsecu_dev', 'catchsecu_test', 'catchsecu_shadow'):
    if sql("SELECT datname FROM pg_database WHERE datname='" + name + "';"):
        raise SystemExit(name + ' already exists; refusing to change ownership.')
    sql('CREATE DATABASE ' + name + ' OWNER catchsecu_app;')

private = root / '.local'
private.mkdir(mode=0o700, exist_ok=True)
os.chmod(private, 0o700)
for filename, database, port in (('.env.local', 'catchsecu_dev', 3100),
                                  ('.env.test.local', 'catchsecu_test', 3101)):
    text = '\n'.join([
        f'DATABASE_URL=postgresql://catchsecu_app:{password}@localhost:5432/{database}',
        f'BETTER_AUTH_URL=http://localhost:{port}',
        f'BETTER_AUTH_SECRET={secrets.token_hex(32)}',
        f'DATA_ENCRYPTION_KEY={secrets.token_hex(32)}',
        'MAIL_TRANSPORT=local', 'MAIL_FROM=catchsecu@localhost.test',
        f'PRIVATE_STORAGE_DIR=.local/{database}/storage',
        f'LOCAL_MAIL_DIR=.local/{database}/mail',
        ''])
    target = root / filename
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(text)
print('Created isolated dev/test/shadow databases and private environment files. Secrets were not logged.')
