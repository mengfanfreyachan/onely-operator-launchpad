"""Create the Chinese demo narration with macOS built-in TTS and ffmpeg.

Environment: FFMPEG_BIN, FFPROBE_BIN (optional), macOS `say`.
Writes individual temporary WAVs, concat list and a scene-timing JSON to /tmp.
"""
import json,os,pathlib,subprocess,wave
root=pathlib.Path(__file__).resolve().parent.parent
ffmpeg=os.environ.get('FFMPEG_BIN','ffmpeg')
scenes=json.loads((root/'demo/voice.json').read_text(encoding='utf-8'))
temp=pathlib.Path('/tmp/onely-video-voice');temp.mkdir(exist_ok=True)
def duration(path):
 with wave.open(str(path),'rb') as stream:return stream.getnframes()/stream.getframerate()
silence=temp/'silence.wav'
subprocess.run([ffmpeg,'-y','-f','lavfi','-i','anullsrc=channel_layout=mono:sample_rate=44100','-t','0.8','-c:a','pcm_s16le',str(silence)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
files=[]
for i,s in enumerate(scenes):
 raw=temp/f'{i:02}.aiff';wav=temp/f'{i:02}.wav'
 subprocess.run(['/usr/bin/say','-v','Tingting','-r','210','-o',str(raw),s['narration']],check=True)
 subprocess.run([ffmpeg,'-y','-i',str(raw),'-ar','44100','-ac','1','-c:a','pcm_s16le',str(wav)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 s['duration']=duration(wav)+duration(silence)
 files.extend([wav,silence])
 print(f"{i+1}. {s['scene']}: {s['duration']:.1f}s")
(temp/'timing.json').write_text(json.dumps(scenes,ensure_ascii=False,indent=2),encoding='utf-8')
(temp/'files.txt').write_text(''.join(f"file '{p}'\n" for p in files),encoding='utf-8')
subprocess.run([ffmpeg,'-y','-f','concat','-safe','0','-i',str(temp/'files.txt'),'-c:a','aac','-b:a','128k',str(temp/'narration.m4a')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print(f"TOTAL: {sum(s['duration'] for s in scenes):.1f}s")
