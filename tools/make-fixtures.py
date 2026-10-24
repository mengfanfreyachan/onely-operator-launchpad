"""Generate synthetic fixtures only: reserved example.com emails, no real prospects."""
import csv,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
names=['Mara Santos','Luca Reyes','Ada Okoro','Noah Bello','Mina Cruz','Eli Ade','Tala Ramos','Iris Eze','Remy Dela','Nia Obi','Ari Tan','Jude Cole','Cleo Diaz','Faye Nnam','Lena Sy','Theo Ayo','Sage Lim','Kira Udo','Zuri Cai','Milo Paz','Zoe Ali','Ivo Chua','Nova Eko','Leo Liao','Rae King','Ava Ola','Finn Uy','Nico Ene','Una Chan','Kai Obi']
sources=['Agency referral','Community opt-in','Talent marketplace','Content & referral']
seed=[]
for i,name in enumerate(names):
 strong=i%5!=4
 row=dict(name=name,email=f'operator{i+1}@example.com',profile_url=f'https://example.com/operators/{i+1}',source=sources[i%4],country='Philippines' if i%2==0 else 'Nigeria',timezone='Asia/Manila' if i%2==0 else 'Africa/Lagos',bio=('Managed Instagram Reels and TikTok content calendars, fan DMs and weekly audience analytics for US creators.' if strong else 'Administrative assistant with spreadsheets travel bookings and basic design. Interested in learning social media.'),months=12+i%4*6 if strong else 2,platforms='Instagram;TikTok' if strong else 'Facebook',markets='US;UK' if strong else 'Local',english=4 if strong else 3,hours=15 if strong else 6,portfolio=strong,community=strong,age18=True,permission=strong,demo_stage=('activated' if i<4 else 'accepted' if i<7 else 'qualified' if i<10 else 'applied' if i<14 else 'replied' if i<17 else 'contacted' if i<21 else 'sourced'))
 if not strong: row['demo_stage']='applied' if i<14 else 'sourced'
 seed.append(row)
(ROOT/'data/demo.json').write_text(json.dumps(seed,indent=2),encoding='utf-8')
fields=[k for k in seed[0] if k!='demo_stage']
new=[]
for i in range(6):
 r=seed[0].copy();r.update(name=f'Demo Applicant {i+31}',email=f'operator{i+31}@example.com',profile_url=f'https://example.com/operators/{i+31}',source=sources[i%4]);new.append(r)
new.extend([dict(seed[0],email=' OPERATOR1@EXAMPLE.COM ',profile_url='https://www.example.com/operators/1/?utm_source=demo'),seed[1].copy(),dict(seed[2],email='operator3@example.com')])
new.append(dict(seed[0],email='',profile_url='not-a-url'))
new.append(dict(seed[0],email='invalid@example.com',profile_url='https://example.com/new',source=''))
new.append(dict(seed[0],email=seed[0]['email'],profile_url=seed[1]['profile_url']))
with (ROOT/'data/import-example.csv').open('w',newline='',encoding='utf-8') as f:
 w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore',lineterminator='\n');w.writeheader();w.writerows(new)
print('30 synthetic seed leads; 12-row import: 6 new / 3 duplicate / 2 invalid / 1 conflict')
