#!/usr/bin/env python3
"""Generic pressure pen for a disposable Linux VM, never a vendor driver emulator.

Run only inside the isolated guest with INTERHUB_ISOLATED_PEN_VM=1.
The witness uses a loopback-forwarded guest controller; no host input is sent.
"""
import sys
import argparse
import fcntl,json,math,os,struct,time
from http.server import BaseHTTPRequestHandler,HTTPServer

def iow(n,size=4):return (1<<30)|(size<<16)|(ord('U')<<8)|n
EV_SYN,EV_KEY,EV_ABS=0,1,3
BTN_TOOL_PEN,BTN_TOOL_RUBBER,BTN_TOUCH,BTN_STYLUS,BTN_STYLUS2=320,321,330,331,332
axes={0:(0,17780,100),1:(0,11110,100),24:(0,16383,0),25:(0,255,0),26:(-60,60,0),27:(-60,60,0)}
if sys.platform != 'linux' or os.environ.get('INTERHUB_ISOLATED_PEN_VM') != '1':
 raise SystemExit('This input injector requires an explicitly isolated Linux test VM')
parser=argparse.ArgumentParser();parser.add_argument('--bind',default='127.0.0.1');args=parser.parse_args()
fd=os.open('/dev/uinput',os.O_WRONLY|os.O_NONBLOCK)
fcntl.ioctl(fd,iow(100),EV_KEY);fcntl.ioctl(fd,iow(100),EV_ABS)
for key in (BTN_TOOL_PEN,BTN_TOOL_RUBBER,BTN_TOUCH,BTN_STYLUS,BTN_STYLUS2):fcntl.ioctl(fd,iow(101),key)
for axis,(minimum,maximum,resolution) in axes.items():
 fcntl.ioctl(fd,iow(103),axis)
 fcntl.ioctl(fd,iow(4,28),struct.pack('H2xiiiiii',axis,0,minimum,maximum,0,0,resolution))
fcntl.ioctl(fd,iow(110),0)
fcntl.ioctl(fd,iow(3,92),struct.pack('HHHH80sI',6,0,0,1,b'InterHub Generic Pressure Pen 14-bit',0))
fcntl.ioctl(fd,0x5501)
last={}
def event(t,c,v):
 if last.get((t,c))==v:return
 os.write(fd,struct.pack('qqHHi',0,0,t,c,v));last[t,c]=v

def frame(value):
 proximity=bool(value.get('proximity',True));contact=bool(value.get('contact',False)) and proximity
 x=float(value.get('x',640));y=float(value.get('y',450));p=float(value.get('pressure',0)) if contact else 0
 assert all(math.isfinite(n) for n in (x,y,p)) and 0<=x<=1279 and 0<=y<=899 and 0<=p<=1
 event(EV_KEY,BTN_TOOL_PEN,int(proximity));event(EV_KEY,BTN_TOUCH,int(contact))
 event(EV_ABS,0,round(x/1279*17780));event(EV_ABS,1,round(y/899*11110))
 event(EV_ABS,24,round(p*16383));event(EV_ABS,25,0 if contact else 10 if proximity else 255)
 event(EV_ABS,26,15 if proximity else 0);event(EV_ABS,27,-10 if proximity else 0)
 os.write(fd,struct.pack('qqHHi',0,0,EV_SYN,0,0))
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  result={'source':'linux-uinput','device':'InterHub Generic Pressure Pen 14-bit','pressureLevels':16384,'screen':[1280,900],'nativeInput':True}
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(result).encode())
 def do_POST(self):
  try:
   assert self.headers.get('X-InterHub-Input-Source') == 'uinput-witness'
   size=int(self.headers['Content-Length']);assert 0 < size <= 131072
   data=json.loads(self.rfile.read(size));values=data if isinstance(data,list) else [data]
   assert len(values)<=1000
   for value in values:frame(value);time.sleep(.08)
   self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'frames':len(values),'source':'linux-uinput'}).encode())
  except Exception as ex:
   self.send_response(400);self.end_headers();self.wfile.write(type(ex).__name__.encode())
print(json.dumps({'created':True,'source':'linux-uinput','pressureLevels':16384}),flush=True)
try:HTTPServer((args.bind,8081),Handler).serve_forever()
finally:fcntl.ioctl(fd,0x5502);os.close(fd)
