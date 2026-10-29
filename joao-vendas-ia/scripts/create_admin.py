"""Execute: ADMIN_EMAIL=... ADMIN_PASSWORD=... python -m scripts.create_admin"""
import os
from sqlalchemy import select
from app import Base, engine, DbSession, Admin, pwd_hash

email=os.getenv('ADMIN_EMAIL','').strip().lower()
password=os.getenv('ADMIN_PASSWORD','')
if not email or '@' not in email or len(password)<12:
    raise SystemExit('Defina ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 12 caracteres) no ambiente.')
Base.metadata.create_all(engine)
with DbSession() as db:
    admin=db.scalar(select(Admin).where(Admin.email==email))
    if admin: admin.pwd_hash=pwd_hash(password)
    else: db.add(Admin(email=email, pwd_hash=pwd_hash(password)))
    db.commit()
print('Acesso administrativo configurado. Não compartilhe sua senha.')
