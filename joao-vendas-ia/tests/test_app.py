import os
import sys
import tempfile
from pathlib import Path

TEST_DB = Path(tempfile.mkdtemp())/'test.sqlite'
os.environ['DATABASE_URL'] = f'sqlite:///{TEST_DB}'
os.environ['SESSION_SECRET'] = 'test-only-in-memory-secret-not-for-production-2026'
os.environ['COOKIE_SECURE'] = 'false'
os.environ['PUBLIC_BASE_URL'] = 'http://testserver'

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from sqlalchemy import select
from app import app, DbSession, Admin, pwd_hash, safe_external_url, extract_offer


def client_and_auth():
    client = TestClient(app)
    with DbSession() as db:
        if not db.scalar(select(Admin).where(Admin.email=='admin@test.com')):
            db.add(Admin(email='admin@test.com',pwd_hash=pwd_hash('strong-password-1234')))
            db.commit()
    resp=client.post('/api/login',json={'email':'admin@test.com','password':'strong-password-1234'})
    assert resp.status_code==200, resp.text
    return client, {'X-CSRF-Token':resp.json()['csrf']}


def test_auth_and_workflow():
    with TestClient(app) as _:
        pass
    client, headers=client_and_auth()
    assert client.get('/health').json()['status']=='ok'
    assert client.get('/api/products').status_code==200
    r=client.post('/api/products',json={'name':'Plano Internet 500 Mega','description':'Internet residencial','price':'R$ 89,90/mês','plans':'500 Mega: R$ 89,90/mês','active':True},headers=headers)
    assert r.status_code==200, r.text
    p=r.json();assert p['active']
    assert client.get('/api/dashboard').json()['active_products']>=1
    r=client.post('/api/simulate',json={'message':'Quero internet','history':[]},headers=headers)
    assert r.status_code==200, r.text
    assert r.json()['demo'] is True
    assert 'DEMONSTRAÇÃO' in r.json()['answer']
    assert client.put('/api/settings',json={'name':'João Vendas IA','business_name':'Minha loja','tone':'Amigável','enabled':False},headers=headers).status_code==200
    assert client.delete('/api/products/'+str(p['id']),headers=headers).status_code==200
    assert client.get('/api/products').json()==[]


def test_csrf_and_no_login():
    with TestClient(app) as client:
        assert client.get('/api/products').status_code==401
        assert client.post('/api/products',json={'name':'Falha'}).status_code==401
        assert client.get('/webhook/whatsapp').status_code==403
        assert client.post('/webhook/whatsapp',json={}).status_code==503
    client,headers=client_and_auth()
    assert client.post('/api/products',json={'name':'Falha'}).status_code==403
    assert client.post('/api/products',headers={'X-CSRF-Token':'fake'},json={'name':'Falha'}).status_code==403
    assert client.post('/api/products',headers={**headers,'Origin':'https://evil.example'},json={'name':'Falha'}).status_code==403


def test_import_parsing_and_ssrf_guard():
    html='''<html><head><title>Plano</title><meta name="description" content="Plano de celular"/><script type="application/ld+json">{"@type":"Product","name":"Plano Ouro","description":"50 GB","offers":{"price":"55.00","priceCurrency":"BRL"}}</script></head></html>'''
    offer=extract_offer(html,'https://example.com/p')
    assert offer['active'] is False
    assert offer['name']=='Plano Ouro'
    assert offer['price']=='BRL 55.00'
    for url in ['http://127.0.0.1','http://localhost','http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'https://example.com:8080/foo']:
        try:
            safe_external_url(url)
            assert False, f'Accepted {url}'
        except ValueError:
            pass
